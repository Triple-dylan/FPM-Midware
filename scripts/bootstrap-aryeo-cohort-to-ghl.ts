/**
 * For each Aryeo customer UUID in a CSV: fetch full GROUP from Aryeo, upsert canonical lead,
 * create or update GHL contact (standard + active custom fields from `ghl_field_map`).
 *
 *   DATABASE_URL=... ARYEO_API_KEY=... GHL_ACCESS_TOKEN=... GHL_LOCATION_ID=... \\
 *   npx tsx scripts/bootstrap-aryeo-cohort-to-ghl.ts path/to/cohort.csv
 *
 * CSV columns:
 *   - aryeo_customer_id (required)
 *   - assigned_to (optional GHL user id) — also set GHL_BOOTSTRAP_ASSIGNED_TO for a default
 *
 * Flags:
 *   --dry-run — fetch + DB lead/link, print GHL payload keys; no GHL writes
 *
 * Prerequisites: `npm run db:apply`, `npm run seed:ghl-fields`, `npm run ghl:refresh-fields`
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import pg from "pg";
import { fetchAryeoCustomer } from "../src/integrations/aryeoClient.js";
import {
  ghlCreateContact,
  ghlSearchDuplicateContact,
  ghlUpdateContact,
} from "../src/integrations/ghlClient.js";
import { enrichAryeoFlatWithLeadMetrics } from "../src/domain/ghlLeadRollup.js";
import {
  buildGhlContactBodyFromAryeoGroup,
  buildGhlCreateEnvelope,
  flattenAryeoCustomerGroup,
  mergeCoreGhlIdentity,
} from "../src/domain/aryeoGroupToGhlPayload.js";
import { withTransaction } from "../src/db/transaction.js";
import { resolveLeadForAryeoCustomer } from "../src/services/aryeoIngest.js";
import { upsertLeadExternalId } from "../src/db/repos/externalIdsRepo.js";
import { insertSyncEvent } from "../src/db/repos/syncEventsRepo.js";
import { listActiveGhlFieldMapWithFallback } from "../src/db/repos/ghlFieldMapRepo.js";
import {
  ensureGhlCustomFieldCacheWarmed,
  resolveGhlOutboundCustomFieldId,
} from "../src/services/ghlFieldCacheWarm.js";
import { resolvePhoneForGhl } from "../src/lib/normalize.js";

const ARYEO_CUSTOMER = "aryeo_customer";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function parseAryeoGroupFromFetchPayload(parsed: unknown): unknown {
  if (!isRecord(parsed)) return null;
  if ("data" in parsed && parsed.data !== undefined) return parsed.data;
  return parsed;
}

function usage(): never {
  console.error(
    "Usage: npx tsx scripts/bootstrap-aryeo-cohort-to-ghl.ts [--dry-run] path/to/cohort.csv",
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const fileArg = argv.filter((a) => !a.startsWith("-")).pop();
if (!fileArg) usage();

const databaseUrl = process.env.DATABASE_URL?.trim();
const aryeoKey = process.env.ARYEO_API_KEY?.trim();
const ghlToken = process.env.GHL_ACCESS_TOKEN?.trim();
const ghlLocationId = process.env.GHL_LOCATION_ID?.trim();
const aryeoBase = process.env.ARYEO_API_BASE_URL?.trim();
const profileTpl =
  process.env.ARYEO_CUSTOMER_PROFILE_URL?.trim() ||
  "https://app.aryeo.com/customers/{{id}}";

if (!databaseUrl || !aryeoKey || !ghlToken || !ghlLocationId) {
  console.error(
    "Missing DATABASE_URL, ARYEO_API_KEY, GHL_ACCESS_TOKEN, or GHL_LOCATION_ID — set in `.env` (see `.env.example`).",
  );
  process.exit(1);
}

type CsvRow = { aryeo_customer_id?: string; assigned_to?: string };
const raw = readFileSync(fileArg, "utf8");
const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true }) as CsvRow[];

const pool = new pg.Pool({ connectionString: databaseUrl });

async function logBootstrap(
  client: pg.PoolClient,
  eventType: string,
  externalId: string,
  leadId: string | null,
  action: string,
  details: unknown,
): Promise<void> {
  await insertSyncEvent(client, {
    system: "bootstrap",
    eventType,
    externalId,
    leadId,
    action,
    details,
  });
}

try {
  await ensureGhlCustomFieldCacheWarmed(pool, ghlToken, ghlLocationId!);
  const fieldMapRows = await listActiveGhlFieldMapWithFallback(pool);
  const resolveId = (mapKey: string, explicit: string | null) =>
    resolveGhlOutboundCustomFieldId(pool, {
      locationId: ghlLocationId!,
      mapKey,
      mapRowId: explicit,
    });

  for (const row of rows) {
    const customerId = row.aryeo_customer_id?.trim();
    if (!customerId) continue;

    console.log("\n===", customerId, "===");

    const ar = await fetchAryeoCustomer(aryeoKey, customerId, aryeoBase);
    if (!ar.ok) {
      console.error("aryeo fetch failed", ar.status, ar.body.slice(0, 400));
      continue;
    }
    const groupPayload = parseAryeoGroupFromFetchPayload(ar.data);
    const flat = flattenAryeoCustomerGroup(groupPayload);
    if (!flat?.aryeo_customer_id) {
      console.error("unexpected Aryeo payload (no customer id)");
      continue;
    }

    const rowIngest = {
      first_name: flat.first_name,
      last_name: flat.last_name,
      email: flat.email,
      phone: resolvePhoneForGhl(flat),
      phone_raw: flat.phone_raw,
      company_name: flat.company_name,
      license_number: flat.license_number,
    };

    let leadId = "";
    try {
      await withTransaction(pool, async (c) => {
        const { leadId: lid } = await resolveLeadForAryeoCustomer(c, customerId, rowIngest);
        leadId = lid;
        const conflict = await upsertLeadExternalId(c, lid, ARYEO_CUSTOMER, customerId, {
          source: "bootstrap-aryeo-cohort",
        });
        if (conflict) {
          throw new Error(
            `aryeo_customer ${customerId} already linked to lead ${conflict.existingLeadId}`,
          );
        }
        await logBootstrap(c, "aryeo_cohort_row", customerId, lid, "lead_ready", {
          email: flat.email,
          dryRun,
        });
      });
    } catch (e) {
      console.error("db error", e);
      continue;
    }

    const enrichmentNote = [
      `Aryeo customer ID: ${customerId}`,
      flat.aryeo_customer_type ? `Aryeo type: ${flat.aryeo_customer_type}` : null,
      `Imported: ${new Date().toISOString()}`,
    ]
      .filter(Boolean)
      .join("\n");

    const assignedTo =
      row.assigned_to?.trim() || process.env.GHL_BOOTSTRAP_ASSIGNED_TO?.trim() || null;

    const flatForGhl = await enrichAryeoFlatWithLeadMetrics(pool, leadId, flat);

    const ghlBody = await buildGhlContactBodyFromAryeoGroup({
      flat: flatForGhl,
      customerUuid: customerId,
      profileUrlTemplate: profileTpl,
      fieldMapRows,
      resolveCustomFieldId: resolveId,
      assignedTo,
      enrichmentNote,
    });

    mergeCoreGhlIdentity(ghlBody, flatForGhl);

    if (dryRun) {
      console.log("dry-run GHL keys:", Object.keys(ghlBody).join(", "));
      continue;
    }

    const dup = await ghlSearchDuplicateContact(ghlToken, {
      locationId: ghlLocationId,
      email: flat.email,
      phone: resolvePhoneForGhl(flat),
    });

    if (!dup.ok) {
      console.error("ghl duplicate search failed", dup.status, dup.body.slice(0, 400));
      await withTransaction(pool, async (c) => {
        await logBootstrap(c, "aryeo_cohort_ghl", customerId, leadId, "error", {
          step: "duplicate",
          status: dup.status,
          body: dup.body.slice(0, 1500),
        });
      });
      continue;
    }

    let contactId = dup.contactId;

    if (!contactId) {
      const createBody = buildGhlCreateEnvelope(ghlLocationId, { ...ghlBody });
      const created = await ghlCreateContact(ghlToken, createBody);
      if (!created.ok) {
        console.error("ghl create failed", created.status, created.body.slice(0, 600));
        await withTransaction(pool, async (c) => {
          await logBootstrap(c, "aryeo_cohort_ghl", customerId, leadId, "error", {
            step: "create",
            status: created.status,
            body: created.body.slice(0, 1500),
          });
        });
        continue;
      }
      contactId = created.contactId;
      console.log("created GHL contact", contactId);
    } else {
      const { tags: _drop, ...updatePayload } = ghlBody;
      void _drop;
      const upd = await ghlUpdateContact(ghlToken, contactId, updatePayload);
      if (!upd.ok) {
        console.error("ghl update failed", upd.status, upd.body.slice(0, 600));
        await withTransaction(pool, async (c) => {
          await logBootstrap(c, "aryeo_cohort_ghl", customerId, leadId, "error", {
            step: "update",
            contactId,
            status: upd.status,
            body: upd.body.slice(0, 1500),
          });
        });
        continue;
      }
      console.log("updated GHL contact", contactId);
    }

    await withTransaction(pool, async (c) => {
      await upsertLeadExternalId(c, leadId, "ghl", contactId!, {
        locationId: ghlLocationId,
      });
      await logBootstrap(c, "aryeo_cohort_ghl", customerId, leadId, "ok", {
        ghl_contact_id: contactId,
      });
    });
  }
} finally {
  await pool.end();
}
