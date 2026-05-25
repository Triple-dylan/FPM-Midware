/**
 * Periodic refresh: scans the Aryeo group order list ONCE, buckets each order by
 * customer.id, and upserts only the orders whose customer is linked to a lead in
 * lead_external_ids. One group scan instead of N per-customer scans.
 *
 * Respects `aryeo_push_order_summary_to_ghl` automation toggle.
 * Runs on a configurable interval from src/index.ts.
 */
import type pg from "pg";
import { aryeoGetJson, aryeoParseDataArray } from "../integrations/aryeoClient.js";
import { withTransaction } from "../db/transaction.js";
import { upsertLeadExternalId } from "../db/repos/externalIdsRepo.js";
import { fetchLatestOrderInternalIdForLead } from "../db/repos/ordersRepo.js";
import { parseAryeoCustomerRow, resolveLeadForAryeoCustomer, upsertAryeoOrderFromRestResource } from "./aryeoIngest.js";
import { pushOrderSummaryToGhl, type AryeoToGhlOutboundOptions } from "./aryeoToGhlOutbound.js";

// Aryeo customer IDs to never include in syncs or commission metrics.
// Mirrors EXCLUDED_CUSTOMER_IDS in dashboardRepo.ts — keep these two lists in sync.
const SKIP_ARYEO_CUSTOMER_IDS = new Set([
  "0199a18d-c37d-73de-ac49-9d771842f6c1", // houstonteam@empowerhome.com — test account
  // Empower Homes DFW (not managed by Dylan Dahl):
  "408175cc-816e-4d46-8252-6901002a76ce", // Stephen Collins III
  "dea6b9a2-22c9-482c-8e78-aab04f616827", // Meredith Butler
  "0191fbc2-e6c8-70a4-be4f-6440ee89836b", // Dylan Palmer
  "01903230-e43f-7055-a059-2670df7e4965", // Kevin Foster
  "01903156-c818-7131-afaa-9287ae5478ba", // Andrew Burns
  "a1b4d443-17ba-435f-8137-2cac904782bb", // Emily Harris
  "0190279b-8185-722b-9dcd-d9262068ace3", // Heather Schmitt
  "01980f2a-d2ac-724e-9699-13007cef43d2", // Laurie Andres
  "42e4ebdd-094f-436f-baf1-882247247c71", // Peachy Choochan
]);

async function buildCustomerLeadMap(pool: pg.Pool): Promise<Map<string, string>> {
  const r = await pool.query<{ lead_id: string; external_id: string }>(
    `SELECT lead_id, external_id FROM lead_external_ids WHERE system = 'aryeo_customer'`,
  );
  const m = new Map<string, string>();
  for (const row of r.rows) {
    if (!SKIP_ARYEO_CUSTOMER_IDS.has(row.external_id)) {
      m.set(row.external_id.trim().toLowerCase(), row.lead_id);
    }
  }
  return m;
}

export async function runPeriodicAryeoRefresh(
  pool: pg.Pool,
  aryeoApiKey: string,
  ghlOpts: AryeoToGhlOutboundOptions,
  aryeoBaseUrl?: string,
): Promise<void> {
  const customerLeadMap = await buildCustomerLeadMap(pool);

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      msg: "periodic_aryeo_refresh_start",
      tracked_customers: customerLeadMap.size,
    }),
  );

  const baseUrl = aryeoBaseUrl?.trim() || "https://api.aryeo.com/v1";
  const updatedLeads = new Set<string>();
  const newLeadIds = new Set<string>();
  let ordersProcessed = 0;
  let leadsCreated = 0;
  let errors = 0;

  // Single pass through all group orders — distribute by customer.id.
  // Aryeo caps per_page at 100; use meta.last_page to drive pagination.
  // Unknown customers are auto-created as leads (commission_tracked = false).
  for (let page = 1; page <= 500; page++) {
    let r;
    try {
      r = await aryeoGetJson(
        aryeoApiKey,
        `/orders?page=${page}&per_page=100&include=customer`,
        { baseUrl },
      );
    } catch (e) {
      errors++;
      console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", msg: "aryeo_page_fetch_error", page, error: String(e) }));
      break;
    }
    if (!r.ok) break;

    const rows = aryeoParseDataArray(r.data);
    if (rows.length === 0) break;

    for (const ord of rows) {
      if (typeof ord !== "object" || ord === null || Array.isArray(ord)) continue;
      const o = ord as Record<string, unknown>;
      const customer = o.customer;
      if (typeof customer !== "object" || customer === null || Array.isArray(customer)) continue;
      const custObj = customer as Record<string, unknown>;
      const custId = custObj.id;
      if (typeof custId !== "string") continue;

      const normCustId = custId.trim().toLowerCase();

      // Hard-skip excluded customer IDs (test accounts, DFW agents, etc.)
      if (SKIP_ARYEO_CUSTOMER_IDS.has(custId.trim())) continue;

      let leadId = customerLeadMap.get(normCustId);

      if (!leadId) {
        // Auto-create lead for this Aryeo customer (commission_tracked defaults to false)
        try {
          const row = parseAryeoCustomerRow(custObj);
          const result = await withTransaction(pool, async (c) => {
            const res = await resolveLeadForAryeoCustomer(c, custId.trim(), row);
            await upsertLeadExternalId(c, res.leadId, "aryeo_customer", custId.trim(), null);
            return res;
          });
          leadId = result.leadId;
          customerLeadMap.set(normCustId, leadId);
          if (result.created) {
            newLeadIds.add(leadId);
            leadsCreated++;
          }
        } catch (e) {
          errors++;
          console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", msg: "lead_create_error", custId, error: String(e) }));
          continue;
        }
      }

      try {
        await withTransaction(pool, (c) => upsertAryeoOrderFromRestResource(c, o, leadId!));
        updatedLeads.add(leadId);
        ordersProcessed++;
      } catch (e) {
        errors++;
        console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", msg: "order_upsert_error", error: String(e) }));
      }
    }

    const meta = typeof r.data === "object" && r.data !== null && !Array.isArray(r.data)
      ? (r.data as Record<string, unknown>).meta : null;
    const lastPage = typeof meta === "object" && meta !== null && typeof (meta as Record<string, unknown>).last_page === "number"
      ? (meta as Record<string, unknown>).last_page as number : null;
    if (lastPage !== null ? page >= lastPage : rows.length < 100) break;
  }

  // Push GHL summaries for leads that already have a GHL contact linked.
  // New leads without a GHL contact get one created lazily when their next
  // order arrives via webhook — no bulk GHL API calls here.
  for (const leadId of updatedLeads) {
    try {
      const latestOrderId = await fetchLatestOrderInternalIdForLead(pool, leadId);
      if (latestOrderId) {
        await pushOrderSummaryToGhl(pool, ghlOpts, {
          leadId,
          orderInternalId: latestOrderId,
          eventType: "periodic_aryeo_refresh",
          externalId: leadId,
          requireAutomationToggle: true,
        });
      }
    } catch (e) {
      errors++;
      console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", msg: "ghl_push_error", leadId, error: String(e) }));
    }
  }

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      msg: "periodic_aryeo_refresh_done",
      orders_processed: ordersProcessed,
      leads_updated: updatedLeads.size,
      leads_created: leadsCreated,
      errors,
    }),
  );
}
