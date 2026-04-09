/**
 * Pilot: allowlist-only Aryeo → GHL + Postgres orders.
 *
 * GHL contact payload = Aryeo customer GROUP + active `ghl_field_map` only (no order $ in GROUP flatten).
 * CSV `--csv=` adds preview columns (order counts / formatted $) for review; not written to GHL as currency math.
 *
 * Modes:
 *   --csv=path.csv   Export preview ONLY (Aryeo reads → file). No Postgres, no GHL.
 *                    Writes: path.csv (wide, ~50+ cols — open in Excel/Sheets for a table; raw text looks like one long line per row),
 *                    path-summary.csv (narrow meta columns; order id sample truncated; order $ totals included),
 *                    path-field-hints.csv (mapKey ↔ label ↔ Aryeo field).
 *                    Needs: `ARYEO_API_KEY` in `.env` + config/pilot-cohort.allowlist.json + config/ghlContactFieldRegistry.generated.json
 *   --dry-run        Console preview only; no writes (no DB, no GHL, no orders).
 *   (default)        Full sync: DATABASE_URL + GHL_ACCESS_TOKEN. GHL writes only to **5301 Alpha** (fixed id in script).
 *
 * Staging GHL: use a different sub-account — set GHL_ACCESS_TOKEN + GHL_LOCATION_ID to that location
 * (same code; production stays untouched).
 *
 *   PILOT_CSV_FULL_SCAN=1  Optional. CSV/dry-run fetch every customer id (slow). Default: skip GET when a partial
 *                          `/customers` list row has connection fields (owner/users/memberships) and none match
 *                          the allowlist; ids with no connection data on the list row still GET.
 *
 *   npx tsx scripts/pilot-sync-aryeo-to-ghl.ts [--csv=out.csv] [--dry-run]
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { escapeCsvField, writeCsvUtf8BomFileVerified } from "../src/lib/csv.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  aryeoParseDataArray,
  fetchAryeoCustomer,
  listAryeoCustomersPage,
  listAryeoOrdersPage,
} from "../src/integrations/aryeoClient.js";
import {
  ghlCreateContact,
  ghlGetContact,
  ghlExtractTags,
  ghlSearchDuplicateContact,
  ghlUpdateContact,
  mergeTagList,
} from "../src/integrations/ghlClient.js";
import { enrichAryeoFlatWithLeadMetrics } from "../src/domain/ghlLeadRollup.js";
import {
  buildGhlContactBodyFromAryeoGroup,
  buildGhlCreateEnvelope,
  flattenAryeoCustomerGroup,
  mergeCoreGhlIdentity,
} from "../src/domain/aryeoGroupToGhlPayload.js";
import {
  buildAryeoTeamAgentHaystack,
  collectConnectionEmailsFromAryeoGroup,
  groupHasConnectionSignalsForPreFilter,
  loadPilotAllowlist,
  pickPilotCohortFromGroup,
  summarizeAryeoCustomerTeamMemberships,
} from "../src/domain/pilotAllowlist.js";
import {
  buildRegistryColumnValues,
  getAllRegistryMapKeysSorted,
  getRegistryFieldHints,
} from "../src/domain/pilotExportColumns.js";
import { withTransaction } from "../src/db/transaction.js";
import {
  resolveLeadForAryeoCustomer,
  upsertAryeoOrderFromRestResource,
} from "../src/services/aryeoIngest.js";
import { pushOrderSummaryToGhl } from "../src/services/aryeoToGhlOutbound.js";
import { fetchLatestOrderInternalIdForLead } from "../src/db/repos/ordersRepo.js";
import { upsertLeadExternalId } from "../src/db/repos/externalIdsRepo.js";
import { insertSyncEvent } from "../src/db/repos/syncEventsRepo.js";
import { listActiveGhlFieldMapWithFallback } from "../src/db/repos/ghlFieldMapRepo.js";
import {
  ensureGhlCustomFieldCacheWarmed,
  resolveGhlOutboundCustomFieldId,
} from "../src/services/ghlFieldCacheWarm.js";
import { fetchGhlLocationCustomFields } from "../src/integrations/ghlLocationsApi.js";
import { resolvePhoneForGhl } from "../src/lib/normalize.js";

const ARYEO_CUSTOMER = "aryeo_customer";
const PILOT_SYSTEM = "pilot";

/** When false (default), CSV + dry-run skip GET if list partial has connection signals and allowlist cannot match. Set to 1 to fetch every id. Full sync always fetches all ids. */
const PILOT_CSV_FULL_SCAN =
  process.env.PILOT_CSV_FULL_SCAN === "1" || process.env.PILOT_CSV_FULL_SCAN === "true";

/** Merge `/customers` list rows into a partial GROUP shape for allowlist pre-filter (no order-embedded client). */
function mergeListRowIntoPreGroup(
  map: Map<string, Record<string, unknown>>,
  nid: string,
  row: Record<string, unknown>,
): void {
  const prev = map.get(nid) ?? {};
  const next: Record<string, unknown> = { ...prev, ...row };
  if (Array.isArray(row.users)) {
    next.users = [...(Array.isArray(prev.users) ? (prev.users as unknown[]) : []), ...row.users];
  }
  if (Array.isArray(row.customer_team_memberships)) {
    next.customer_team_memberships = [
      ...(Array.isArray(prev.customer_team_memberships)
        ? (prev.customer_team_memberships as unknown[])
        : []),
      ...row.customer_team_memberships,
    ];
  }
  if (Array.isArray(row.team_members)) {
    next.team_members = [...(Array.isArray(prev.team_members) ? (prev.team_members as unknown[]) : []), ...row.team_members];
  }
  if (isRecord(row.owner)) {
    next.owner = isRecord(prev.owner) ? { ...prev.owner, ...row.owner } : row.owner;
  }
  map.set(nid, next);
}

/** Canonical map/set key for Aryeo customer UUIDs (case-insensitive). */
function normCustomerId(id: string): string {
  return id.trim().toLowerCase();
}

/** Resolve which customer GROUP an order row belongs to (list responses may omit nested `customer`). */
function orderRowCustomerId(row: Record<string, unknown>): string | null {
  const c = row.customer;
  if (isRecord(c)) {
    const id = str(c.id);
    if (id) return id;
  }
  const flat = str(row.customer_id);
  if (flat) return flat;
  const cg = row.customer_group;
  if (isRecord(cg)) {
    const id = str(cg.id);
    if (id) return id;
  }
  return null;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function str(x: unknown): string | null {
  return typeof x === "string" ? x : null;
}

/** Long cells only: keeps editor-friendly summary rows readable. */
function truncateForPreviewCell(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return `${s.slice(0, Math.max(0, maxChars - 3))}...`;
}

function parseAryeoGroupFromFetchPayload(parsed: unknown): unknown {
  if (!isRecord(parsed)) return null;
  if ("data" in parsed && parsed.data !== undefined) return parsed.data;
  return parsed;
}

/** Aryeo `users` + `team_members` only (for CSV `team_users` + part of GHL notes). */
function teamSummaryForNotes(group: unknown): string {
  if (!isRecord(group)) return "";
  const lines: string[] = [];
  const users = group.users;
  if (Array.isArray(users)) {
    for (const u of users) {
      if (!isRecord(u)) continue;
      const n = str(u.full_name) || `${str(u.first_name) ?? ""} ${str(u.last_name) ?? ""}`.trim();
      const em = str(u.email);
      if (n || em) lines.push([n, em && `(${em})`].filter(Boolean).join(" "));
    }
  }
  const tm = group.team_members;
  if (Array.isArray(tm) && tm.length > 0) {
    lines.push(`team_members: ${JSON.stringify(tm).slice(0, 1500)}`);
  }
  return lines.length ? lines.join(" | ") : "";
}

function teamContextForGhlEnrichment(group: unknown): string {
  const rep = summarizeAryeoCustomerTeamMemberships(group);
  const users = teamSummaryForNotes(group);
  return [rep && `Customer team / rep (Aryeo): ${rep}`, users && `Platform users: ${users}`]
    .filter(Boolean)
    .join("\n\n");
}

function parseCsvPath(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--csv=")) return a.slice(6).trim();
    if (a.startsWith("--out=")) return a.slice(6).trim();
    if ((a === "--csv" || a === "--out") && argv[i + 1]) return argv[i + 1].trim();
  }
  return null;
}

type CustomerOrderBucket = {
  /** ORDER resources whose `customer.id` matches this bucket. */
  orders: unknown[];
  /** Up to 40 vanity labels for preview columns. */
  sampleLabels: string[];
};

function orderLabel(ord: Record<string, unknown>): string {
  return str(ord.identifier) || str(ord.title) || str(ord.id)?.slice(0, 8) || "";
}

/** Sum Aryeo `total_amount` (minor units) per ISO currency; format for display. */
type PilotOrderTotals = {
  /** Sum of `total_amount` when exactly one currency is present; else null (mixed or none). */
  totalMinorSingle: number | null;
  /** Single ISO currency, or `MIXED`, or null. */
  currency: string | null;
  /** Human-readable: one currency, or multiple like `$10.00; CA$5.00`. */
  formatted: string;
};

function aggregatePilotOrderTotals(orders: unknown[]): PilotOrderTotals {
  const byCurrency = new Map<string, number>();
  for (const o of orders) {
    if (!isRecord(o) || str(o.object) !== "ORDER") continue;
    const ta = o.total_amount;
    const curRaw = str(o.currency);
    const cur = curRaw?.trim() ? curRaw.trim() : "USD";
    if (typeof ta !== "number" || !Number.isFinite(ta)) continue;
    byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + ta);
  }
  if (byCurrency.size === 0) {
    return { totalMinorSingle: null, currency: null, formatted: "" };
  }
  const parts: string[] = [];
  for (const [cur, minor] of [...byCurrency.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    try {
      parts.push(
        new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(minor / 100),
      );
    } catch {
      parts.push(`${cur} ${(minor / 100).toFixed(2)}`);
    }
  }
  const formatted = parts.join("; ");
  if (byCurrency.size === 1) {
    const [cur, minor] = [...byCurrency.entries()][0];
    return { totalMinorSingle: minor, currency: cur, formatted };
  }
  return { totalMinorSingle: null, currency: "MIXED", formatted };
}

/** Merge all ORDER rows for the given customer ids (pilot-exported cohort) for footer totals. */
function aggregatePilotOrderTotalsForCustomerIds(
  ids: string[],
  ordersByCustomer: Map<string, CustomerOrderBucket>,
): PilotOrderTotals {
  const all: unknown[] = [];
  for (const id of ids) {
    const b = ordersByCustomer.get(normCustomerId(id));
    if (b?.orders.length) all.push(...b.orders);
  }
  return aggregatePilotOrderTotals(all);
}

function totalOrderCountForCustomerIds(
  ids: string[],
  ordersByCustomer: Map<string, CustomerOrderBucket>,
): number {
  let n = 0;
  for (const id of ids) {
    const b = ordersByCustomer.get(normCustomerId(id));
    if (b) n += b.orders.length;
  }
  return n;
}

function orderStatsForCustomer(
  m: Map<string, CustomerOrderBucket>,
  customerId: string,
): { count: number; summary: string; totals: PilotOrderTotals } {
  const b = m.get(normCustomerId(customerId));
  if (!b) {
    return { count: 0, summary: "", totals: { totalMinorSingle: null, currency: null, formatted: "" } };
  }
  return {
    count: b.orders.length,
    summary: b.sampleLabels.join("; "),
    totals: aggregatePilotOrderTotals(b.orders),
  };
}

/** List rows include `object` GROUP or CUSTOMER (case-insensitive); missing object is treated as a customer row. */
function isCustomerListRowObject(obj: string | null): boolean {
  if (!obj) return true;
  const u = obj.toUpperCase();
  return u === "GROUP" || u === "CUSTOMER";
}

function firstDataRowId(rows: unknown[]): string | null {
  const r = rows[0];
  if (!isRecord(r)) return null;
  return str(r.id);
}

/**
 * Collect Aryeo customer UUIDs from `/customers` AND from `/orders`, and **bucket orders by `customer.id`**.
 * Aryeo `GET /orders` is group-wide (no customer filter in the public API), so we scan once and index locally.
 */
async function collectPilotDiscovery(
  aryeoKey: string,
  aryeoBase: string | undefined,
): Promise<{
  ids: string[];
  listRows: number;
  orderPages: number;
  ordersByCustomer: Map<string, CustomerOrderBucket>;
  /** Partial GROUP fields from `/customers` list only — used to skip some GETs when we can prove no cohort match. */
  preGroupFragmentByCustomerId: Map<string, Record<string, unknown>>;
}> {
  const set = new Set<string>();
  const ordersByCustomer = new Map<string, CustomerOrderBucket>();
  const preGroupFragmentByCustomerId = new Map<string, Record<string, unknown>>();
  let listRows = 0;
  let prevCustomerPageFirstId: string | null = null;
  console.log("[pilot] fetching /customers pages…");
  for (let page = 1; page < 10_000; page++) {
    const list = await listAryeoCustomersPage(aryeoKey, page, aryeoBase, { perPage: 100 });
    if (!list.ok) {
      console.error(`[pilot] /customers page ${page} failed: HTTP ${list.status}`);
      break;
    }
    const rows = aryeoParseDataArray(list.data);
    if (rows.length === 0) break;
    const firstId = firstDataRowId(rows);
    if (page > 1 && firstId && firstId === prevCustomerPageFirstId) {
      console.warn(
        `[pilot] /customers page ${page} repeats the same first row as the previous page; stopping (pagination not advancing).`,
      );
      break;
    }
    prevCustomerPageFirstId = firstId;
    if (page === 1 || page % 5 === 0) {
      console.log(`[pilot] /customers page ${page} (${rows.length} rows in response)`);
    }
    for (const row of rows) {
      if (!isRecord(row)) continue;
      const id = str(row.id);
      if (!id) continue;
      const obj = str(row.object);
      if (!isCustomerListRowObject(obj)) continue;
      const nid = normCustomerId(id);
      set.add(nid);
      listRows++;
      mergeListRowIntoPreGroup(preGroupFragmentByCustomerId, nid, row);
    }
  }

  let orderPages = 0;
  let prevOrdersPageFirstId: string | null = null;
  console.log("[pilot] fetching /orders pages (group-wide, bucketed by customer)…");
  for (let page = 1; page < 10_000; page++) {
    const list = await listAryeoOrdersPage(aryeoKey, page, aryeoBase, {
      perPage: 250,
      include: "customer",
    });
    if (!list.ok) {
      console.error(`[pilot] /orders page ${page} failed: HTTP ${list.status}`);
      break;
    }
    const rows = aryeoParseDataArray(list.data);
    if (rows.length === 0) break;
    const firstId = firstDataRowId(rows);
    if (page > 1 && firstId && firstId === prevOrdersPageFirstId) {
      console.warn(
        `[pilot] /orders page ${page} repeats the same first row as the previous page; stopping (pagination not advancing).`,
      );
      break;
    }
    prevOrdersPageFirstId = firstId;
    orderPages++;
    if (page === 1 || page % 5 === 0) {
      console.log(`[pilot] /orders page ${page} (${rows.length} rows in response)`);
    }
    for (const row of rows) {
      if (!isRecord(row) || str(row.object) !== "ORDER") continue;
      const rawCid = orderRowCustomerId(row);
      if (!rawCid) continue;
      const cid = normCustomerId(rawCid);
      set.add(cid);
      let bucket = ordersByCustomer.get(cid);
      if (!bucket) {
        bucket = { orders: [], sampleLabels: [] };
        ordersByCustomer.set(cid, bucket);
      }
      bucket.orders.push(row);
      if (bucket.sampleLabels.length < 40) {
        const lab = orderLabel(row);
        if (lab) bucket.sampleLabels.push(lab);
      }
    }
  }

  return {
    ids: [...set],
    listRows,
    orderPages,
    ordersByCustomer,
    preGroupFragmentByCustomerId,
  };
}

async function writePilotDebugSample(
  path: string,
  sampleIds: string[],
  aryeoKey: string,
  aryeoBase: string | undefined,
): Promise<void> {
  const lines: string[] = [
    "Sample of customers (no allowlist match yet). Connection emails (owner/users/memberships) + legacy haystack snippet.",
    "",
  ];
  for (const id of sampleIds.slice(0, 12)) {
    const ar = await fetchAryeoCustomer(aryeoKey, id, aryeoBase);
    if (!ar.ok) {
      lines.push(`${id}: FETCH ${ar.status}`);
      continue;
    }
    const groupPayload = parseAryeoGroupFromFetchPayload(ar.data);
    const hay = groupPayload ? buildAryeoTeamAgentHaystack(groupPayload) : "";
    const emails = groupPayload ? [...collectConnectionEmailsFromAryeoGroup(groupPayload)].join("; ") : "";
    const name = groupPayload && isRecord(groupPayload) ? str(groupPayload.name) : "";
    lines.push(`${id} | name=${name ?? ""}`);
    lines.push(`  connection_emails: ${emails.slice(0, 300)}`);
    lines.push(`  team_agent_haystack: ${hay.slice(0, 180)}`);
    lines.push("");
  }
  writeFileSync(path, lines.join("\n"), "utf8");
}

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const csvPath = parseCsvPath(argv);

const databaseUrl = process.env.DATABASE_URL?.trim();
const aryeoKey = process.env.ARYEO_API_KEY?.trim();
const ghlToken = process.env.GHL_ACCESS_TOKEN?.trim();
const ghlLocationId = process.env.GHL_LOCATION_ID?.trim();

/** GHL sub-account for pilot outbound only — 5301 Alpha (not Full Package Media or other locations). */
const PILOT_GHL_LOCATION_ID = "EkuOnGu2b5wBIzLX6FZ9";
const aryeoBase = process.env.ARYEO_API_BASE_URL?.trim();
const profileTpl =
  process.env.ARYEO_CUSTOMER_PROFILE_URL?.trim() ||
  "https://app.aryeo.com/customers/{{id}}";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const allowPath =
  process.env.PILOT_ALLOWLIST_PATH?.trim() || join(root, "config", "pilot-cohort.allowlist.json");

const allow = loadPilotAllowlist(allowPath);
const assignedToDefault = process.env.GHL_BOOTSTRAP_ASSIGNED_TO?.trim() || null;

if (!aryeoKey) {
  console.error("Missing ARYEO_API_KEY — add it to `.env` (see `.env.example`).");
  process.exit(1);
}

/** Excel-friendly preview: Aryeo only → CSV. No DB, no GHL. Includes every GHL registry map column (empty = no customer-level API data → hook needed). */
async function runCsvExport(): Promise<void> {
  const mapKeys = getAllRegistryMapKeysSorted();
  const metaKeys = [
    "cohort_id",
    "team_tag",
    "aryeo_customer_id",
    "aryeo_display_name",
    "order_count",
    "orders_currency",
    "orders_total_formatted",
    "order_list_sample",
    "team_users",
    "sales_rep_customer_team",
    "ghl_tags_would_apply",
    "profile_url",
  ];
  const headers = [...metaKeys, ...mapKeys];

  const hintsPath = csvPath!.replace(/\.csv$/i, "-field-hints.csv");
  const hintRows = getRegistryFieldHints();
  const hintLines = [
    ["mapKey", "ghl_label", "fieldNameInAryeo"].map(escapeCsvField).join(","),
    ...hintRows.map((h) =>
      [h.mapKey, h.label, h.fieldNameInAryeo].map(escapeCsvField).join(","),
    ),
  ];
  writeCsvUtf8BomFileVerified(hintsPath, hintLines);
  console.log(`Field definitions (join to wide CSV by mapKey): ${hintsPath}`);

  const discovery = await collectPilotDiscovery(aryeoKey, aryeoBase);
  console.log(
    `Discovered ${discovery.ids.length} unique customer ids (${discovery.listRows} rows from /customers, ${discovery.orderPages} non-empty /orders pages)`,
  );
  if (!PILOT_CSV_FULL_SCAN) {
    console.log(
      "[pilot] CSV fast path: skip GET when list partial has connection emails/teams and no cohort matches (set PILOT_CSV_FULL_SCAN=1 to fetch every id — slow).",
    );
  } else {
    console.log("[pilot] CSV full scan: fetching every customer id (PILOT_CSV_FULL_SCAN).");
  }

  const rows: string[] = [headers.map(escapeCsvField).join(",")];
  const exportedCustomerIds: string[] = [];
  const summaryHeaders = [
    "cohort_id",
    "team_tag",
    "aryeo_customer_id",
    "aryeo_display_name",
    "email",
    "phone",
    "order_count",
    "orders_currency",
    "orders_total_formatted",
    "order_list_sample_truncated",
    "team_users",
    "sales_rep_customer_team_truncated",
    "ghl_tags_would_apply",
    "profile_url",
  ];
  const summaryRows: string[] = [summaryHeaders.map(escapeCsvField).join(",")];
  let scanned = discovery.ids.length;
  let exported = 0;

  for (const customerId of discovery.ids) {
    const partial = discovery.preGroupFragmentByCustomerId.get(customerId);
    if (
      !PILOT_CSV_FULL_SCAN &&
      partial &&
      groupHasConnectionSignalsForPreFilter(partial) &&
      !pickPilotCohortFromGroup(partial, allow.cohorts)
    ) {
      continue;
    }

    const ar = await fetchAryeoCustomer(aryeoKey, customerId, aryeoBase);
    if (!ar.ok) continue;
    const groupPayload = parseAryeoGroupFromFetchPayload(ar.data);
    if (groupPayload == null) continue;

    const cohort = pickPilotCohortFromGroup(groupPayload, allow.cohorts);
    if (!cohort) continue;

    const flat = flattenAryeoCustomerGroup(groupPayload);
    if (!flat?.aryeo_customer_id) continue;

    const tagBundle = mergeTagList([], [...allow.globalTags, cohort.teamTag]);
    const { count, summary, totals } = orderStatsForCustomer(discovery.ordersByCustomer, customerId);
    const profileUrl = profileTpl.includes("{{id}}")
      ? profileTpl.replace(/\{\{\s*id\s*\}\}/g, customerId)
      : `${profileTpl.replace(/\/$/, "")}/${customerId}`;

    const registryVals = buildRegistryColumnValues(
      mapKeys,
      flat,
      customerId,
      profileTpl,
    );

    const salesRepTeam = summarizeAryeoCustomerTeamMemberships(groupPayload);
    const meta = [
      cohort.id,
      cohort.teamTag,
      customerId,
      str((groupPayload as Record<string, unknown>).name) ?? "",
      String(count),
      totals.currency ?? "",
      totals.formatted,
      summary,
      teamSummaryForNotes(groupPayload),
      salesRepTeam,
      tagBundle.join("; "),
      profileUrl,
    ];

    const line = [...meta, ...mapKeys.map((k) => registryVals[k] ?? "")]
      .map(escapeCsvField)
      .join(",");

    rows.push(line);
    const summaryLine = [
      cohort.id,
      cohort.teamTag,
      customerId,
      str((groupPayload as Record<string, unknown>).name) ?? "",
      flat.email ?? "",
      resolvePhoneForGhl(flat) ?? "",
      String(count),
      totals.currency ?? "",
      totals.formatted,
      truncateForPreviewCell(summary, 500),
      teamSummaryForNotes(groupPayload),
      truncateForPreviewCell(salesRepTeam, 600),
      tagBundle.join("; "),
      profileUrl,
    ]
      .map(escapeCsvField)
      .join(",");
    summaryRows.push(summaryLine);
    exportedCustomerIds.push(customerId);
    exported++;
    console.log(
      `[export] ${cohort.id} ${customerId} ${flat.email ?? ""} orders=${count} total=${totals.formatted || "—"}`,
    );
  }

  if (exportedCustomerIds.length > 0) {
    const totalOrders = totalOrderCountForCustomerIds(exportedCustomerIds, discovery.ordersByCustomer);
    const aggTotals = aggregatePilotOrderTotalsForCustomerIds(exportedCustomerIds, discovery.ordersByCustomer);
    const metaFooter = metaKeys.map(() => "");
    const put = (key: string, val: string) => {
      const i = metaKeys.indexOf(key);
      if (i >= 0) metaFooter[i] = val;
    };
    put("cohort_id", "TOTAL");
    put("order_count", String(totalOrders));
    put("orders_currency", aggTotals.currency ?? "");
    put("orders_total_formatted", aggTotals.formatted);
    rows.push([...metaFooter, ...mapKeys.map(() => "")].map(escapeCsvField).join(","));

    const sumFooter = summaryHeaders.map(() => "");
    const putS = (key: string, val: string) => {
      const i = summaryHeaders.indexOf(key);
      if (i >= 0) sumFooter[i] = val;
    };
    putS("cohort_id", "TOTAL");
    putS("order_count", String(totalOrders));
    putS("orders_currency", aggTotals.currency ?? "");
    putS("orders_total_formatted", aggTotals.formatted);
    summaryRows.push(sumFooter.map(escapeCsvField).join(","));
    console.log(
      `\n[pilot] Footer: ${totalOrders} orders across ${exportedCustomerIds.length} exported customers; amounts: ${aggTotals.formatted || "—"}`,
    );
  }

  writeCsvUtf8BomFileVerified(csvPath!, rows);
  const summaryPath = csvPath!.replace(/\.csv$/i, "-summary.csv");
  writeCsvUtf8BomFileVerified(summaryPath, summaryRows);

  console.log(
    `\nWrote ${exported} data rows to ${csvPath} (${mapKeys.length} GHL map columns; empty cell = no value from Aryeo customer API for that key)`,
  );
  console.log(
    `Narrow preview (few columns, order sample truncated): ${summaryPath} — use this to skim in Cursor; use the wide file in Excel for the full field grid.`,
  );
  console.log(`Scanned ${scanned} customer ids`);
  if (exported === 0) {
    if (discovery.ids.length === 0) {
      console.error(
        "\n0 customer ids from /customers and /orders — check ARYEO_API_KEY, ARYEO_API_BASE_URL, and that this key has data.",
      );
    } else {
      console.error(
        "\nNo allowlist matches: 0 data rows. Check allowlist (emails, team UUIDs, customer UUIDs) — see debug file.",
      );
      if (!PILOT_CSV_FULL_SCAN) {
        console.error(
          "Fast CSV path was on: if team fields only appear after GET, retry with PILOT_CSV_FULL_SCAN=1 (slow).",
        );
      }
      const debugPath = csvPath!.replace(/\.csv$/i, "-debug-sample.txt");
      await writePilotDebugSample(debugPath, discovery.ids, aryeoKey, aryeoBase);
      console.error(`Wrote ${debugPath} (first customers + haystack preview for tuning).`);
    }
  }
}

/** Console-only: reads Aryeo, no DB, no GHL. */
async function runDryConsoleOnly(): Promise<void> {
  const discovery = await collectPilotDiscovery(aryeoKey, aryeoBase);
  console.log(
    `Discovered ${discovery.ids.length} unique customer ids (${discovery.listRows} from /customers, ${discovery.orderPages} order pages)`,
  );
  if (!PILOT_CSV_FULL_SCAN) {
    console.log(
      "[pilot] dry-run fast path: same as CSV list partial (set PILOT_CSV_FULL_SCAN=1 to fetch every id).",
    );
  }
  let matched = 0;
  for (const customerId of discovery.ids) {
    const partial = discovery.preGroupFragmentByCustomerId.get(customerId);
    if (
      !PILOT_CSV_FULL_SCAN &&
      partial &&
      groupHasConnectionSignalsForPreFilter(partial) &&
      !pickPilotCohortFromGroup(partial, allow.cohorts)
    ) {
      continue;
    }

    const ar = await fetchAryeoCustomer(aryeoKey, customerId, aryeoBase);
    if (!ar.ok) continue;
    const groupPayload = parseAryeoGroupFromFetchPayload(ar.data);
    if (groupPayload == null) continue;
    const cohort = pickPilotCohortFromGroup(groupPayload, allow.cohorts);
    if (!cohort) continue;
    matched++;
    const flat = flattenAryeoCustomerGroup(groupPayload);
    const tags = mergeTagList([], [...allow.globalTags, cohort.teamTag]).join(", ");
    const { count } = orderStatsForCustomer(discovery.ordersByCustomer, customerId);
    console.log(
      `[dry-run] ${cohort.id} | ${customerId} | ${flat?.email ?? ""} | orders=${count} | tags=${tags}`,
    );
  }
  console.log(
    `\nDone dry-run: unique_ids=${discovery.ids.length} matched=${matched} (no DB/GHL writes)`,
  );
}

/** Sub-accounts this PIT can access (for 403 “wrong location” debugging). */
async function fetchGhlLocationsForToken(token: string): Promise<{ id: string; name: string }[]> {
  const res = await fetch("https://services.leadconnectorhq.com/locations/search", {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      Accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) return [];
  try {
    const j = JSON.parse(text) as { locations?: { id?: string; name?: string }[] };
    const rows = Array.isArray(j.locations) ? j.locations : [];
    return rows
      .map((r) => ({
        id: typeof r.id === "string" ? r.id : "",
        name: typeof r.name === "string" ? r.name : "",
      }))
      .filter((r) => r.id);
  } catch {
    return [];
  }
}

async function probeGhlDuplicateContact(
  token: string,
  locationId: string,
): Promise<{ ok: true } | { ok: false; status: number; body: string }> {
  return ghlSearchDuplicateContact(token, {
    locationId,
    email: "__fpm_pilot_probe__@invalid",
  });
}

/**
 * Pilot sync only writes to the 5301 Alpha sub-account (`PILOT_GHL_LOCATION_ID`).
 * PIT must be created in that location.
 */
async function assertPilotGhlLocation(token: string): Promise<string> {
  const id = PILOT_GHL_LOCATION_ID;
  const probe = await probeGhlDuplicateContact(token, id);
  if (probe.ok) return id;

  console.error(`[pilot] GHL Contacts API rejected the request (HTTP ${probe.status}) for 5301 Alpha only (${id}).`);
  console.error(probe.body.slice(0, 2000));

  if (probe.status === 401) {
    console.error(
      [
        "",
        "401: invalid or expired token. Create a Private Integration in the **5301 Alpha** sub-account with Contacts access.",
        "Update GHL_ACCESS_TOKEN in .env.",
      ].join("\n"),
    );
    process.exit(1);
  }

  if (probe.status === 403) {
    let cfCount = 0;
    try {
      const cfRows = await fetchGhlLocationCustomFields(token, id);
      cfCount = cfRows.length;
    } catch {
      /* ignore */
    }
    if (cfCount > 0) {
      console.error("");
      console.error(
        [
          "Diagnosis: `npm run ghl:refresh-fields` can work while pilot fails — your PIT can read **location custom fields**,",
          "but **Contacts** APIs (duplicate search / create / update) are not allowed for this token.",
          "",
          "Fix: GHL → 5301 Alpha sub-account → Settings → Integrations → Private Integrations → open this PIT →",
          "enable **Contacts** (View + Edit, or equivalent) for this location. Save, then update GHL_ACCESS_TOKEN if GHL issues a new one.",
        ].join("\n"),
      );
    } else {
      const locs = await fetchGhlLocationsForToken(token);
      if (locs.length > 0) {
        console.error("");
        console.error("GET /locations/search (if available for this token):");
        for (const L of locs) {
          console.error(`    ${L.id}  (${L.name})`);
        }
        console.error("");
      }
      console.error(
        [
          "403: this PIT cannot use Contacts for the 5301 Alpha sub-account. Create the token inside **5301 Alpha**,",
          "or edit the Private Integration so this location is included with Contacts access.",
        ].join("\n"),
      );
    }
  }
  process.exit(1);
}

async function runFullSync(): Promise<void> {
  if (!databaseUrl || !ghlToken) {
    console.error(
      "Full sync requires DATABASE_URL, GHL_ACCESS_TOKEN (use --csv=… for Excel preview without GHL). Pilot uses 5301 Alpha sub-account only.",
    );
    process.exit(1);
  }

  if (ghlLocationId && ghlLocationId !== PILOT_GHL_LOCATION_ID) {
    console.warn(
      `[pilot] GHL_LOCATION_ID=${ghlLocationId} in .env — pilot sync ignores this and only uses 5301 Alpha (${PILOT_GHL_LOCATION_ID}).`,
    );
    console.warn(
      "[pilot] Set GHL_LOCATION_ID to that id for ghl:refresh-fields / other scripts, or remove the line to avoid confusion.",
    );
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });

  async function logPilot(
    client: pg.PoolClient,
    eventType: string,
    externalId: string,
    leadId: string | null,
    action: string,
    details: unknown,
  ): Promise<void> {
    await insertSyncEvent(client, {
      system: PILOT_SYSTEM,
      eventType,
      externalId,
      leadId,
      action,
      details,
    });
  }

  try {
    const ghlLocationForSync = await assertPilotGhlLocation(ghlToken);

    await ensureGhlCustomFieldCacheWarmed(pool, ghlToken, ghlLocationForSync);

    const fieldMapRows = await listActiveGhlFieldMapWithFallback(pool);
    const resolveId = (mapKey: string, explicit: string | null) =>
      resolveGhlOutboundCustomFieldId(pool, {
        locationId: ghlLocationForSync,
        mapKey,
        mapRowId: explicit,
      });

    const discovery = await collectPilotDiscovery(aryeoKey, aryeoBase);
    console.log(
      `Discovered ${discovery.ids.length} unique customer ids (${discovery.listRows} from /customers, ${discovery.orderPages} order pages)`,
    );
    console.log(
      "[pilot] Discovery done — nothing was written to GHL yet above; next: fetch each customer + allowlist match + create/update GHL contacts.",
    );

    let scanned = discovery.ids.length;
    let synced = 0;
    let skipped = 0;

    for (const customerId of discovery.ids) {
      const ar = await fetchAryeoCustomer(aryeoKey, customerId, aryeoBase);
      if (!ar.ok) {
        console.error("  aryeo detail fetch failed", ar.status);
        continue;
      }
      const groupPayload = parseAryeoGroupFromFetchPayload(ar.data);
      if (groupPayload == null) continue;

      const cohort = pickPilotCohortFromGroup(groupPayload, allow.cohorts);
      if (!cohort) {
        skipped++;
        continue;
      }

      console.log(
        `\n[match] ${cohort.id} ← ${customerId} (client name: ${str((groupPayload as Record<string, unknown>).name) ?? "?"})`,
      );

      const flat = flattenAryeoCustomerGroup(groupPayload);
        if (!flat?.aryeo_customer_id) {
          console.error("  bad detail payload");
          continue;
        }

        const teamNote = teamContextForGhlEnrichment(groupPayload);
        const rowIngest = {
          first_name: flat.first_name,
          last_name: flat.last_name,
          email: flat.email,
          phone: resolvePhoneForGhl(flat),
          phone_raw: flat.phone_raw,
          company_name: flat.company_name,
          license_number: flat.license_number,
        };

        const tagBundle = mergeTagList([], [...allow.globalTags, cohort.teamTag]);

        let leadId = "";
        try {
          await withTransaction(pool, async (c) => {
            const { leadId: lid } = await resolveLeadForAryeoCustomer(c, customerId, rowIngest);
            leadId = lid;
            const conflict = await upsertLeadExternalId(c, lid, ARYEO_CUSTOMER, customerId, {
              source: "pilot-sync",
              cohort: cohort.id,
            });
            if (conflict) {
              throw new Error(`aryeo ${customerId} linked to other lead ${conflict.existingLeadId}`);
            }
            await logPilot(c, "pilot_customer", customerId, lid, "lead_ready", {
              cohort: cohort.id,
              teamTag: cohort.teamTag,
            });
          });
        } catch (e) {
          console.error("  db error", e);
          continue;
        }

        const enrichmentNote = [
          teamNote,
          `Pilot cohort: ${cohort.id} (${cohort.teamTag})`,
          `Aryeo customer ID: ${customerId}`,
          `Imported: ${new Date().toISOString()}`,
        ]
          .filter(Boolean)
          .join("\n\n");

        const bucket = discovery.ordersByCustomer.get(customerId);
        const ordersForCustomer = bucket?.orders ?? [];
        let ordersUpserted = 0;
        for (const ord of ordersForCustomer) {
          if (!isRecord(ord) || str(ord.object) !== "ORDER") continue;
          await withTransaction(pool, async (c) => {
            await upsertAryeoOrderFromRestResource(c, ord, leadId);
            ordersUpserted++;
          });
        }
        console.log(`  orders: ${ordersUpserted} upserted`);

        const flatForGhl = await enrichAryeoFlatWithLeadMetrics(pool, leadId, flat);

        const ghlBody = await buildGhlContactBodyFromAryeoGroup({
          flat: flatForGhl,
          customerUuid: customerId,
          profileUrlTemplate: profileTpl,
          fieldMapRows,
          resolveCustomFieldId: resolveId,
          assignedTo: assignedToDefault,
          enrichmentNote,
        });

        mergeCoreGhlIdentity(ghlBody, flatForGhl);
        ghlBody.tags = [...tagBundle];
        ghlBody.source = "FPM pilot (Aryeo)";

        const dup = await ghlSearchDuplicateContact(ghlToken, {
          locationId: ghlLocationForSync,
          email: flat.email,
          phone: resolvePhoneForGhl(flat),
        });

        if (!dup.ok) {
          console.error("  ghl duplicate failed", dup.status);
          if (dup.status === 401 || dup.status === 403 || dup.status === 422) {
            console.error("  ghl body:", dup.body.slice(0, 600));
          }
          await withTransaction(pool, async (c) => {
            await logPilot(c, "pilot_ghl", customerId, leadId, "error", { step: "duplicate", dup });
          });
          continue;
        }

        let contactId = dup.contactId;

        if (!contactId) {
          const createBody = buildGhlCreateEnvelope(ghlLocationForSync, { ...ghlBody });
          const created = await ghlCreateContact(ghlToken, createBody);
          if (!created.ok) {
            console.error("  ghl create failed", created.status, created.body.slice(0, 400));
            await withTransaction(pool, async (c) => {
              await logPilot(c, "pilot_ghl", customerId, leadId, "error", {
                step: "create",
                created,
              });
            });
            continue;
          }
          contactId = created.contactId;
          console.log("  created GHL", contactId);
        } else {
          const got = await ghlGetContact(ghlToken, contactId);
          const existingTags = got.ok ? ghlExtractTags(got.contact) : [];
          const mergedTags = mergeTagList(existingTags, tagBundle);
          const { tags: _drop, ...rest } = ghlBody;
          void _drop;
          const upd = await ghlUpdateContact(ghlToken, contactId, { ...rest, tags: mergedTags });
          if (!upd.ok) {
            console.error("  ghl update failed", upd.status);
            await withTransaction(pool, async (c) => {
              await logPilot(c, "pilot_ghl", customerId, leadId, "error", {
                step: "update",
                contactId,
                upd,
              });
            });
            continue;
          }
          console.log("  updated GHL", contactId);
        }

        await withTransaction(pool, async (c) => {
          await upsertLeadExternalId(c, leadId, "ghl", contactId!, { locationId: ghlLocationForSync });
          await logPilot(c, "pilot_ghl", customerId, leadId, "ok", {
            ghl_contact_id: contactId,
            cohort: cohort.id,
          });
        });

        if (ordersUpserted > 0) {
          const latestOrderId = await fetchLatestOrderInternalIdForLead(pool, leadId);
          if (latestOrderId) {
            const pushed = await pushOrderSummaryToGhl(
              pool,
              {
                ghlAccessToken: ghlToken,
                ghlLocationId: ghlLocationForSync,
                aryeoCustomerProfileUrlTemplate: profileTpl,
              },
              {
                leadId,
                orderInternalId: latestOrderId,
                eventType: "pilot_sync_order_summary",
                externalId: customerId,
                requireAutomationToggle: false,
              },
            );
            console.log(
              pushed
                ? "  ghl order summary (rolling + latest amount): updated"
                : "  ghl order summary: skipped or failed (see sync_events for ghl / AryeoOrderPush)",
            );
          }
        }

        synced++;
    }

    console.log(`\nDone. scanned=${scanned} synced=${synced} skipped_no_match=${skipped}`);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  if (csvPath) {
    await runCsvExport();
    return;
  }
  if (dryRun) {
    await runDryConsoleOnly();
    return;
  }
  await runFullSync();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
