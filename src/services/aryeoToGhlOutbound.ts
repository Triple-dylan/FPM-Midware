import type pg from "pg";
import { getStandardGhlBodyKey } from "../config/ghlRegistry.js";
import { valueForOrderMapKey } from "../domain/ghlOrderOutboundValues.js";
import { isAutomationEnabled } from "../db/repos/automationRepo.js";
import { resolveGhlCustomFieldId } from "../db/repos/ghlCustomFieldCacheRepo.js";
import { getExternalIdForLead } from "../db/repos/externalIdsRepo.js";
import { listActiveGhlFieldMap } from "../db/repos/ghlFieldMapRepo.js";
import { fetchOrderOutboundContext } from "../db/repos/ordersRepo.js";
import { ghlUpdateContact } from "../integrations/ghlClient.js";
import type { AryeoIngestOutcome } from "./aryeoIngest.js";

async function insertOutboundSyncEvent(
  pool: pg.Pool,
  row: {
    eventType: string;
    externalId: string | null;
    leadId: string | null;
    action: string;
    details: unknown;
  },
): Promise<void> {
  await pool.query(
    `insert into sync_events (system, event_type, external_id, lead_id, action, details)
     values ('ghl', $1, $2, $3, $4, $5::jsonb)`,
    [
      row.eventType,
      row.externalId,
      row.leadId,
      row.action,
      JSON.stringify(row.details ?? null),
    ],
  );
}

export type AryeoToGhlOutboundOptions = {
  ghlAccessToken: string | undefined;
  ghlLocationId: string | undefined;
  /** e.g. https://app.aryeo.com/customers/{{id}} */
  aryeoCustomerProfileUrlTemplate: string;
};

/**
 * After Aryeo order ingest commits: optionally push mapped fields to GHL contact.
 * Aryeo stays read-only; only GHL receives writes.
 */
export async function runAryeoOrderOutboundToGhl(
  pool: pg.Pool,
  opts: AryeoToGhlOutboundOptions,
  outcome: Extract<AryeoIngestOutcome, { handled: true }>,
): Promise<void> {
  if (!(await isAutomationEnabled(pool, "aryeo_push_order_summary_to_ghl"))) {
    return;
  }

  if (!opts.ghlAccessToken?.trim()) {
    await insertOutboundSyncEvent(pool, {
      eventType: outcome.activityName,
      externalId: outcome.aryeoOrderId,
      leadId: outcome.leadId,
      action: "skipped",
      details: { reason: "GHL_ACCESS_TOKEN_not_configured" },
    });
    return;
  }

  if (!outcome.leadId) {
    await insertOutboundSyncEvent(pool, {
      eventType: outcome.activityName,
      externalId: outcome.aryeoOrderId,
      leadId: null,
      action: "skipped",
      details: { reason: "no_lead_id_after_aryeo_ingest" },
    });
    return;
  }

  const ghlContactId = await getExternalIdForLead(pool, outcome.leadId, "ghl");
  if (!ghlContactId) {
    await insertOutboundSyncEvent(pool, {
      eventType: outcome.activityName,
      externalId: outcome.aryeoOrderId,
      leadId: outcome.leadId,
      action: "skipped",
      details: { reason: "no_ghl_contact_linked" },
    });
    return;
  }

  const order = await fetchOrderOutboundContext(pool, outcome.orderUuid);
  if (!order) {
    await insertOutboundSyncEvent(pool, {
      eventType: outcome.activityName,
      externalId: outcome.aryeoOrderId,
      leadId: outcome.leadId,
      action: "error",
      details: { reason: "order_row_missing_after_ingest" },
    });
    return;
  }

  const locationId = opts.ghlLocationId?.trim() || "";
  const rows = await listActiveGhlFieldMap(pool);
  const body: Record<string, unknown> = {};
  const customFields: Array<{ id: string; value: string }> = [];

  for (const row of rows) {
    const v = valueForOrderMapKey(
      row.map_key,
      order,
      opts.aryeoCustomerProfileUrlTemplate,
    );
    if (v == null || v === "") continue;

    const stdKey = getStandardGhlBodyKey(row.map_key);
    if (stdKey) {
      body[stdKey] = v;
      continue;
    }

    if (!locationId) {
      continue;
    }

    const fieldId = await resolveGhlCustomFieldId(pool, {
      locationId,
      mapKey: row.map_key,
      mapRowId: row.ghl_custom_field_id,
    });
    if (!fieldId) continue;
    customFields.push({ id: fieldId, value: v });
  }

  if (customFields.length > 0) {
    body.customFields = customFields;
  }

  if (Object.keys(body).length === 0) {
    await insertOutboundSyncEvent(pool, {
      eventType: outcome.activityName,
      externalId: outcome.aryeoOrderId,
      leadId: outcome.leadId,
      action: "skipped",
      details: {
        reason: "no_resolved_fields",
        hint: "Run scripts/ghl-refresh-custom-field-ids.ts after seed; enable map rows in /admin",
      },
    });
    return;
  }

  const result = await ghlUpdateContact(opts.ghlAccessToken.trim(), ghlContactId, body);

  if (!result.ok) {
    await insertOutboundSyncEvent(pool, {
      eventType: `AryeoOrderPush:${outcome.activityName}`,
      externalId: outcome.aryeoOrderId,
      leadId: outcome.leadId,
      action: "error",
      details: {
        ghl_contact_id: ghlContactId,
        status: result.status,
        response: result.body.slice(0, 2000),
      },
    });
    return;
  }

  await insertOutboundSyncEvent(pool, {
    eventType: `AryeoOrderPush:${outcome.activityName}`,
    externalId: outcome.aryeoOrderId,
    leadId: outcome.leadId,
    action: "updated",
    details: {
      ghl_contact_id: ghlContactId,
      top_level_keys: Object.keys(body).filter((k) => k !== "customFields"),
      custom_field_count: customFields.length,
    },
  });

  if (await isAutomationEnabled(pool, "aryeo_push_rep_assignment_to_ghl")) {
    await insertOutboundSyncEvent(pool, {
      eventType: `AryeoRepAssignment:${outcome.activityName}`,
      externalId: outcome.aryeoOrderId,
      leadId: outcome.leadId,
      action: "skipped",
      details: { reason: "requires_acting_user_to_ghl_user_mapping" },
    });
  }
}
