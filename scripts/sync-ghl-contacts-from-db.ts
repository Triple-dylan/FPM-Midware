/**
 * Walk **every** contact in a GHL location (`/contacts/search`), resolve their Aryeo customer, then
 * push mapped fields into GHL (live Aryeo `GET /customers`, order rollups, date normalization).
 *
 * **Postgres** is still used for `ghl_field_map` + custom-field id cache — not for requiring a “lead” row.
 * Resolution order for Aryeo customer id:
 * 1. UUID embedded in GHL contact (e.g. `aryeo_customer_profile_link` / any `aryeo.com/customers/{uuid}` text)
 * 2. If linked in DB: `lead_external_ids` (`aryeo_customer`)
 * 3. Email match via paginated Aryeo `GET /customers`
 *
 * Config: **`.env`** — `DATABASE_URL`, `GHL_ACCESS_TOKEN`, `GHL_LOCATION_ID`, `ARYEO_API_KEY`, optional `ARYEO_API_BASE_URL`, `ARYEO_CUSTOMER_PROFILE_URL`.
 *
 *   npx tsx scripts/sync-ghl-contacts-from-db.ts [--dry-run] [--limit=N] [--orders-only]
 *
 * - **`--orders-only`**: only contacts that **have** a canonical lead in Postgres get Postgres-backed order fields (legacy).
 * - **`--limit`**: max contacts **pulled from search** to process (stops early).
 */
import "dotenv/config";
import pg from "pg";
import { extractAryeoCustomerIdFromGhlContact, findAryeoCustomerIdByEmail } from "../src/domain/ghlContactAryeoResolve.js";
import { findLeadIdByExternalId, getExternalIdForLead } from "../src/db/repos/externalIdsRepo.js";
import { fetchLatestOrderInternalIdForLead } from "../src/db/repos/ordersRepo.js";
import { ghlGetContact, ghlSearchContactsPage } from "../src/integrations/ghlClient.js";
import { pushOrderSummaryToGhl } from "../src/services/aryeoToGhlOutbound.js";
import {
  pushFullLeadToGhlFromAryeoAndDb,
  pushGhlContactUpdateFromAryeoStandalone,
} from "../src/services/ghlLeadFullOutbound.js";
import { ensureGhlCustomFieldCacheWarmed } from "../src/services/ghlFieldCacheWarm.js";

const GHL = "ghl";
const ARYEO_CUSTOMER = "aryeo_customer";

function str(x: unknown): string | null {
  return typeof x === "string" ? x : null;
}

function parseLimit(argv: string[]): number | null {
  for (const a of argv) {
    if (a.startsWith("--limit=")) {
      const n = Number(a.slice(8).trim());
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const ordersOnly = process.argv.includes("--orders-only");
  const maxContacts = parseLimit(process.argv);

  const databaseUrl = process.env.DATABASE_URL?.trim();
  const token = process.env.GHL_ACCESS_TOKEN?.trim();
  const locationId = process.env.GHL_LOCATION_ID?.trim();
  const profileTpl =
    process.env.ARYEO_CUSTOMER_PROFILE_URL?.trim() ||
    "https://app.aryeo.com/customers/{{id}}";
  const aryeoKey = process.env.ARYEO_API_KEY?.trim();
  const aryeoBase = process.env.ARYEO_API_BASE_URL?.trim();

  if (!databaseUrl || !token || !locationId) {
    console.error(
      "Missing DATABASE_URL, GHL_ACCESS_TOKEN, or GHL_LOCATION_ID — set them in `.env` (see `.env.example`).",
    );
    process.exit(1);
  }

  if (!ordersOnly && !aryeoKey) {
    console.error(
      "Set `ARYEO_API_KEY` in `.env` for Aryeo→GHL updates, or use `--orders-only` (Postgres order fields only; needs a lead row in the DB).",
    );
    process.exit(1);
  }

  const aryeoApiKeyResolved = aryeoKey ?? "";

  const pool = new pg.Pool({ connectionString: databaseUrl });

  await ensureGhlCustomFieldCacheWarmed(pool, token, locationId);

  let page = 1;
  const pageLimit = 100;
  let totalIds = 0;
  let noAryeoResolve = 0;
  let pushedOk = 0;
  let pushedFail = 0;
  let contactsHandled = 0;
  let dryRunCount = 0;

  const fullOpts = {
    ghlAccessToken: token,
    ghlLocationId: locationId,
    aryeoCustomerProfileUrlTemplate: profileTpl,
    aryeoApiKey: aryeoApiKeyResolved,
    aryeoApiBaseUrl: aryeoBase,
  };

  try {
    outer: for (let guard = 0; guard < 10_000; guard++) {
      const res = await ghlSearchContactsPage(token, { locationId, page, pageLimit });
      if (!res.ok) {
        console.error(`GHL /contacts/search failed HTTP ${res.status}`);
        console.error(res.body.slice(0, 2000));
        process.exit(1);
      }

      if (res.contactIds.length === 0) {
        break;
      }

      totalIds += res.contactIds.length;

      for (const ghlContactId of res.contactIds) {
        if (maxContacts != null && contactsHandled >= maxContacts) {
          console.log(`Stopped: reached --limit=${maxContacts} contacts.`);
          break outer;
        }
        contactsHandled++;

        const leadId = await findLeadIdByExternalId(pool, GHL, ghlContactId);

        if (ordersOnly) {
          if (!leadId) {
            continue;
          }
          const latestOrderId = await fetchLatestOrderInternalIdForLead(pool, leadId);
          if (dryRun) {
            dryRunCount++;
            console.log(
              `[dry-run] orders-only ghl=${ghlContactId} lead=${leadId} latest_pg_order=${latestOrderId ?? "none"}`,
            );
            continue;
          }
          const ok = await pushOrderSummaryToGhl(
            pool,
            {
              ghlAccessToken: token,
              ghlLocationId: locationId,
              aryeoCustomerProfileUrlTemplate: profileTpl,
            },
            {
              leadId,
              orderInternalId: latestOrderId,
              eventType: "sync_ghl_contacts_from_db",
              externalId: ghlContactId,
              requireAutomationToggle: false,
            },
          );
          if (ok) {
            pushedOk++;
          } else {
            pushedFail++;
            console.error(`  order-summary failed ghl=${ghlContactId} lead=${leadId}`);
          }
          continue;
        }

        const got = await ghlGetContact(token, ghlContactId);
        if (!got.ok) {
          pushedFail++;
          console.error(`  ghl get failed ${ghlContactId} HTTP ${got.status}`);
          continue;
        }

        let aryeoId = extractAryeoCustomerIdFromGhlContact(got.contact);
        if (!aryeoId && leadId) {
          aryeoId = (await getExternalIdForLead(pool, leadId, ARYEO_CUSTOMER)) ?? null;
        }
        if (!aryeoId) {
          aryeoId = await findAryeoCustomerIdByEmail(aryeoApiKeyResolved, str(got.contact.email), aryeoBase);
        }

        if (!aryeoId) {
          noAryeoResolve++;
          continue;
        }

        if (dryRun) {
          dryRunCount++;
          const latestOrderId = leadId ? await fetchLatestOrderInternalIdForLead(pool, leadId) : null;
          console.log(
            `[dry-run] ghl=${ghlContactId} aryeo=${aryeoId} lead=${leadId ?? "none"} latest_pg_order=${latestOrderId ?? "none"}`,
          );
          continue;
        }

        if (leadId) {
          const r = await pushFullLeadToGhlFromAryeoAndDb(pool, fullOpts, {
            leadId,
            ghlContactId,
            aryeoCustomerId: aryeoId,
          });
          if (r.ok) {
            pushedOk++;
          } else {
            pushedFail++;
            console.error(`  full sync (db lead) failed ghl=${ghlContactId} ${r.reason} ${r.detail ?? ""}`);
          }
        } else {
          const r = await pushGhlContactUpdateFromAryeoStandalone(pool, fullOpts, {
            ghlContactId,
            aryeoCustomerId: aryeoId,
          });
          if (r.ok) {
            pushedOk++;
          } else {
            pushedFail++;
            console.error(`  standalone sync failed ghl=${ghlContactId} ${r.reason} ${r.detail ?? ""}`);
          }
        }
      }

      const stopPaging = !res.hasMore || res.contactIds.length < pageLimit;
      if (stopPaging) {
        break;
      }
      page++;
    }

    console.log(
      `Done. ghl_contacts_seen=${totalIds} contacts_processed=${contactsHandled} could_not_resolve_aryeo=${noAryeoResolve} updated_ok=${pushedOk} updated_fail=${pushedFail} dry_run=${dryRun} dry_run_rows=${dryRunCount}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
