import type { Pool, PoolClient } from "pg";
import { getStandardGhlBodyKey } from "../config/ghlRegistry.js";
import type { GhlFieldMapRow } from "../db/repos/ghlFieldMapRepo.js";
import {
  fetchLeadLatestOrderForOutbound,
  fetchOrderOutboundContext,
  stubOrderOutboundContextForGhl,
} from "../db/repos/ordersRepo.js";
import { buildLeadTransactionRollupForOutbound } from "./ghlLeadRollup.js";
import { formatMapValueForGhl } from "./ghlMapValueFormat.js";
import type { AryeoGroupFlat, ResolvedGhlFieldIds } from "./aryeoGroupToGhlPayload.js";
import { bootstrapValueForGhlMapKey } from "./aryeoGroupToGhlPayload.js";
import { valueForOrderMapKey } from "./ghlOrderOutboundValues.js";

type Db = Pool | PoolClient;

/**
 * Single GHL contact PUT body: Aryeo bootstrap values + Postgres order rollups.
 * Order/rollup wins when both paths produce a value (e.g. `last_order_*`, LTV from DB).
 * Date-like values are normalized for GHL (see `formatMapValueForGhl`).
 */
export async function buildGhlContactBodyFromAryeoGroupAndOrders(
  pool: Db,
  options: {
    flat: AryeoGroupFlat;
    customerUuid: string;
    profileUrlTemplate: string;
    fieldMapRows: GhlFieldMapRow[];
    resolveCustomFieldId: ResolvedGhlFieldIds;
    enrichmentNote: string;
    leadId: string;
    orderInternalId: string | null;
    assignedTo?: string | null;
  },
): Promise<Record<string, unknown>> {
  const {
    flat,
    customerUuid,
    profileUrlTemplate,
    fieldMapRows,
    resolveCustomFieldId,
    enrichmentNote,
    leadId,
    orderInternalId,
    assignedTo,
  } = options;

  const order =
    orderInternalId == null
      ? stubOrderOutboundContextForGhl(leadId)
      : await fetchOrderOutboundContext(pool, orderInternalId);
  if (!order) {
    throw new Error("order_context_missing_for_ghl_merge");
  }

  const latestForLead = await fetchLeadLatestOrderForOutbound(pool, leadId);
  const transactionRollup = await buildLeadTransactionRollupForOutbound(pool, leadId);

  const body: Record<string, unknown> = {};
  const customFields: Array<{ id: string; value: string }> = [];

  if (assignedTo?.trim()) {
    body.assignedTo = assignedTo.trim();
  }

  const baseNotes = [flat.notes, enrichmentNote].filter(Boolean).join("\n\n");
  const flatWithNotes = { ...flat, notes: baseNotes || flat.notes };

  for (const row of fieldMapRows) {
    let v =
      valueForOrderMapKey(
        row.map_key,
        { order, latestForLead, transactionRollup },
        profileUrlTemplate,
      ) ??
      bootstrapValueForGhlMapKey(row.map_key, flatWithNotes, customerUuid, profileUrlTemplate);
    if (v == null || v === "") continue;
    v = formatMapValueForGhl(row.map_key, v);

    const std = getStandardGhlBodyKey(row.map_key);
    if (std) {
      body[std] = v;
      continue;
    }

    const fieldId = await resolveCustomFieldId(row.map_key, row.ghl_custom_field_id);
    if (fieldId) {
      customFields.push({ id: fieldId, value: v });
    }
  }

  if (customFields.length > 0) {
    body.customFields = customFields;
  }

  return body;
}
