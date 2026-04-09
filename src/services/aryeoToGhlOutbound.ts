import type pg from "pg";
import { getStandardGhlBodyKey } from "../config/ghlRegistry.js";
import { buildLeadTransactionRollupForOutbound } from "../domain/ghlLeadRollup.js";
import { formatMapValueForGhl } from "../domain/ghlMapValueFormat.js";
import { valueForOrderMapKey } from "../domain/ghlOrderOutboundValues.js";
import { isAutomationEnabled } from "../db/repos/automationRepo.js";
import { getExternalIdForLead } from "../db/repos/externalIdsRepo.js";
import { listActiveGhlFieldMapWithFallback } from "../db/repos/ghlFieldMapRepo.js";
import {
  fetchLeadLatestOrderForOutbound,
  fetchOrderOutboundContext,
  stubOrderOutboundContextForGhl,
} from "../db/repos/ordersRepo.js";
import {
  ghlExtractCustomFields,
  ghlGetContact,
  ghlUpdateContact,
  mergeGhlCustomFieldsForUpdate,
} from "../integrations/ghlClient.js";
import {
  ensureGhlCustomFieldCacheWarmed,
  resolveGhlOutboundCustomFieldId,
} from "./ghlFieldCacheWarm.js";
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

export type PushOrderSummaryToGhlInput = {
  leadId: string;
  /** Internal `orders.id` (UUID string). Pass `null` when the lead has no orders (rollup-only GHL update). */
  orderInternalId: string | null;
  eventType: string;
  externalId: string | null;
  /**
   * Webhook path: respect `aryeo_push_order_summary_to_ghl`.
   * Pilot / manual: pass false so order fields always push when token + GHL link exist.
   */
  requireAutomationToggle: boolean;
};

/**
 * Push mapped Aryeo order fields to the linked GHL contact (rolling aggregates + latest order amount).
 * Used by webhook ingest and by pilot sync to refresh GHL after DB upserts.
 *
 * @returns true if GHL accepted the contact update; false if skipped or errored (see `sync_events`).
 */
export async function pushOrderSummaryToGhl(
  pool: pg.Pool,
  opts: AryeoToGhlOutboundOptions,
  input: PushOrderSummaryToGhlInput,
): Promise<boolean> {
  if (
    input.requireAutomationToggle &&
    !(await isAutomationEnabled(pool, "aryeo_push_order_summary_to_ghl"))
  ) {
    return false;
  }

  if (!opts.ghlAccessToken?.trim()) {
    await insertOutboundSyncEvent(pool, {
      eventType: input.eventType,
      externalId: input.externalId,
      leadId: input.leadId,
      action: "skipped",
      details: { reason: "GHL_ACCESS_TOKEN_not_configured" },
    });
    return false;
  }

  const ghlContactId = await getExternalIdForLead(pool, input.leadId, "ghl");
  if (!ghlContactId) {
    await insertOutboundSyncEvent(pool, {
      eventType: input.eventType,
      externalId: input.externalId,
      leadId: input.leadId,
      action: "skipped",
      details: { reason: "no_ghl_contact_linked" },
    });
    return false;
  }

  const order =
    input.orderInternalId == null
      ? stubOrderOutboundContextForGhl(input.leadId)
      : await fetchOrderOutboundContext(pool, input.orderInternalId);
  if (!order) {
    await insertOutboundSyncEvent(pool, {
      eventType: input.eventType,
      externalId: input.externalId,
      leadId: input.leadId,
      action: "error",
      details: { reason: "order_row_missing" },
    });
    return false;
  }

  const latestForLead = await fetchLeadLatestOrderForOutbound(pool, input.leadId);
  const transactionRollup = await buildLeadTransactionRollupForOutbound(pool, input.leadId);

  const locationId = opts.ghlLocationId?.trim() || "";
  await ensureGhlCustomFieldCacheWarmed(pool, opts.ghlAccessToken.trim(), locationId);
  const rows = await listActiveGhlFieldMapWithFallback(pool);
  const body: Record<string, unknown> = {};
  const customFields: Array<{ id: string; value: string }> = [];

  for (const row of rows) {
    let v = valueForOrderMapKey(
      row.map_key,
      { order, latestForLead, transactionRollup },
      opts.aryeoCustomerProfileUrlTemplate,
    );
    if (v == null || v === "") continue;
    v = formatMapValueForGhl(row.map_key, v);

    const stdKey = getStandardGhlBodyKey(row.map_key);
    if (stdKey) {
      body[stdKey] = v;
      continue;
    }

    if (!locationId) {
      continue;
    }

    const fieldId = await resolveGhlOutboundCustomFieldId(pool, {
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
      eventType: input.eventType,
      externalId: input.externalId,
      leadId: input.leadId,
      action: "skipped",
      details: {
        reason: "no_resolved_fields",
        hint: "Run scripts/ghl-refresh-custom-field-ids.ts after seed; enable map rows in /admin",
      },
    });
    return false;
  }

  const token = opts.ghlAccessToken.trim();
  const payload: Record<string, unknown> = { ...body };

  if (locationId && customFields.length > 0) {
    const got = await ghlGetContact(token, ghlContactId);
    if (!got.ok) {
      await insertOutboundSyncEvent(pool, {
        eventType: input.eventType,
        externalId: input.externalId,
        leadId: input.leadId,
        action: "error",
        details: {
          reason: "ghl_get_failed_for_custom_field_merge",
          status: got.status,
          response: got.body.slice(0, 2000),
        },
      });
      return false;
    }
    const existingCf = ghlExtractCustomFields(got.contact);
    payload.customFields = mergeGhlCustomFieldsForUpdate(existingCf, customFields);
  }

  const result = await ghlUpdateContact(token, ghlContactId, payload);

  if (!result.ok) {
    await insertOutboundSyncEvent(pool, {
      eventType: `AryeoOrderPush:${input.eventType}`,
      externalId: input.externalId,
      leadId: input.leadId,
      action: "error",
      details: {
        ghl_contact_id: ghlContactId,
        status: result.status,
        response: result.body.slice(0, 2000),
      },
    });
    return false;
  }

  await insertOutboundSyncEvent(pool, {
    eventType: `AryeoOrderPush:${input.eventType}`,
    externalId: input.externalId,
    leadId: input.leadId,
    action: "updated",
    details: {
      ghl_contact_id: ghlContactId,
      top_level_keys: Object.keys(body).filter((k) => k !== "customFields"),
      custom_field_count: customFields.length,
    },
  });

  if (
    input.requireAutomationToggle &&
    (await isAutomationEnabled(pool, "aryeo_push_rep_assignment_to_ghl"))
  ) {
    await insertOutboundSyncEvent(pool, {
      eventType: `AryeoRepAssignment:${input.eventType}`,
      externalId: input.externalId,
      leadId: input.leadId,
      action: "skipped",
      details: { reason: "requires_acting_user_to_ghl_user_mapping" },
    });
  }

  return true;
}

/**
 * After Aryeo order ingest commits: optionally push mapped fields to GHL contact.
 * Aryeo stays read-only; only GHL receives writes.
 */
export async function runAryeoOrderOutboundToGhl(
  pool: pg.Pool,
  opts: AryeoToGhlOutboundOptions,
  outcome: Extract<AryeoIngestOutcome, { handled: true }>,
): Promise<void> {
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

  await pushOrderSummaryToGhl(pool, opts, {
    leadId: outcome.leadId,
    orderInternalId: outcome.orderUuid,
    eventType: outcome.activityName,
    externalId: outcome.aryeoOrderId,
    requireAutomationToggle: true,
  });
}
