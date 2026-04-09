import type pg from "pg";
import { applyRollupFromAryeoOrderResourcesToFlat } from "../domain/aryeoApiOrderRollup.js";
import {
  mergeCoreGhlIdentity,
  buildGhlContactBodyFromAryeoGroup,
  flattenAryeoCustomerGroup,
  type AryeoGroupFlat,
} from "../domain/aryeoGroupToGhlPayload.js";
import { buildGhlContactBodyFromAryeoGroupAndOrders } from "../domain/ghlMergedContactBody.js";
import { enrichAryeoFlatWithLeadMetrics } from "../domain/ghlLeadRollup.js";
import { getExternalIdForLead } from "../db/repos/externalIdsRepo.js";
import { listActiveGhlFieldMapWithFallback } from "../db/repos/ghlFieldMapRepo.js";
import { fetchLatestOrderInternalIdForLead } from "../db/repos/ordersRepo.js";
import { fetchAryeoCustomer, fetchOrderObjectsForAryeoCustomer } from "../integrations/aryeoClient.js";
import {
  ghlExtractCustomFields,
  ghlExtractTags,
  ghlGetContact,
  ghlUpdateContact,
  mergeGhlCustomFieldsForUpdate,
} from "../integrations/ghlClient.js";
import {
  ensureGhlCustomFieldCacheWarmed,
  resolveGhlOutboundCustomFieldId,
} from "./ghlFieldCacheWarm.js";

const ARYEO_CUSTOMER = "aryeo_customer";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function parseAryeoGroupFromFetchPayload(parsed: unknown): unknown {
  if (!isRecord(parsed)) return null;
  if ("data" in parsed && parsed.data !== undefined) return parsed.data;
  return parsed;
}

export type PushFullLeadToGhlOptions = {
  ghlAccessToken: string;
  ghlLocationId: string;
  aryeoCustomerProfileUrlTemplate: string;
  aryeoApiKey: string;
  aryeoApiBaseUrl?: string;
};

export type PushFullLeadToGhlInput = {
  leadId: string;
  ghlContactId: string;
  /** When set, uses this Aryeo customer id; otherwise loads from `lead_external_ids` (`aryeo_customer`). */
  aryeoCustomerId?: string | null;
};

export type PushFullLeadToGhlResult =
  | { ok: true }
  | { ok: false; reason: string; detail?: string };

/**
 * Refresh a GHL contact from live Aryeo customer data + canonical DB rollups (orders).
 * Preserves existing GHL tags. Intended for middleware-linked leads.
 */
export async function pushFullLeadToGhlFromAryeoAndDb(
  pool: pg.Pool,
  opts: PushFullLeadToGhlOptions,
  input: PushFullLeadToGhlInput,
): Promise<PushFullLeadToGhlResult> {
  const token = opts.ghlAccessToken.trim();
  const locationId = opts.ghlLocationId.trim();
  if (!token || !locationId) {
    return { ok: false, reason: "missing_token_or_location" };
  }

  const customerId =
    input.aryeoCustomerId?.trim() ||
    (await getExternalIdForLead(pool, input.leadId, ARYEO_CUSTOMER));
  if (!customerId) {
    return { ok: false, reason: "no_aryeo_customer_linked", detail: input.leadId };
  }

  const ar = await fetchAryeoCustomer(opts.aryeoApiKey, customerId, opts.aryeoApiBaseUrl);
  if (!ar.ok) {
    return {
      ok: false,
      reason: "aryeo_fetch_failed",
      detail: `${ar.status} ${ar.body.slice(0, 500)}`,
    };
  }

  const groupPayload = parseAryeoGroupFromFetchPayload(ar.data);
  const flatBase = flattenAryeoCustomerGroup(groupPayload);
  if (!flatBase?.aryeo_customer_id) {
    return { ok: false, reason: "aryeo_payload_not_group" };
  }

  const flat: AryeoGroupFlat = await enrichAryeoFlatWithLeadMetrics(pool, input.leadId, flatBase);
  const latestOrderId = await fetchLatestOrderInternalIdForLead(pool, input.leadId);

  await ensureGhlCustomFieldCacheWarmed(pool, token, locationId);
  const fieldMapRows = await listActiveGhlFieldMapWithFallback(pool);
  const resolveId = (mapKey: string, explicit: string | null) =>
    resolveGhlOutboundCustomFieldId(pool, {
      locationId,
      mapKey,
      mapRowId: explicit,
    });

  const enrichmentNote = [
    `Middleware sync ${new Date().toISOString()}`,
    `Aryeo customer: ${customerId}`,
  ].join("\n");

  let body: Record<string, unknown>;
  try {
    body = await buildGhlContactBodyFromAryeoGroupAndOrders(pool, {
      flat,
      customerUuid: customerId,
      profileUrlTemplate: opts.aryeoCustomerProfileUrlTemplate,
      fieldMapRows,
      resolveCustomFieldId: resolveId,
      enrichmentNote,
      leadId: input.leadId,
      orderInternalId: latestOrderId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: "build_body_failed", detail: msg };
  }

  mergeCoreGhlIdentity(body, flat);

  const outgoingCustom = Array.isArray(body.customFields)
    ? (body.customFields as Array<{ id: string; value: string }>)
    : [];

  const got = await ghlGetContact(token, input.ghlContactId);
  if (!got.ok && outgoingCustom.length > 0) {
    return {
      ok: false,
      reason: "ghl_get_failed",
      detail: `cannot merge custom fields without GET: HTTP ${got.status} ${got.body.slice(0, 500)}`,
    };
  }

  const existingCf = got.ok ? ghlExtractCustomFields(got.contact) : [];

  const { tags: _t, customFields: _c, ...rest } = body;
  void _t;
  void _c;

  let mergedCf: Array<{ id: string; value: string }> | undefined;
  if (outgoingCustom.length > 0) {
    mergedCf = mergeGhlCustomFieldsForUpdate(existingCf, outgoingCustom);
  }

  /** `PUT /contacts/:id` must not include `locationId` — API returns 422 "property locationId should not exist". */
  const payload: Record<string, unknown> = { ...rest };
  if (got.ok) {
    payload.tags = ghlExtractTags(got.contact);
  }
  if (mergedCf !== undefined && mergedCf.length > 0) {
    payload.customFields = mergedCf;
  }

  const upd = await ghlUpdateContact(token, input.ghlContactId, payload);

  if (!upd.ok) {
    return {
      ok: false,
      reason: "ghl_update_failed",
      detail: `${upd.status} ${upd.body.slice(0, 800)}`,
    };
  }

  return { ok: true };
}

/**
 * Update a GHL contact from Aryeo **without** a canonical `lead_id` in Postgres (no `lead_external_ids`).
 * Pulls orders from the Aryeo API for rollups. Still requires Postgres for `ghl_field_map` / custom field ids.
 */
export async function pushGhlContactUpdateFromAryeoStandalone(
  pool: pg.Pool,
  opts: PushFullLeadToGhlOptions,
  input: { ghlContactId: string; aryeoCustomerId: string },
): Promise<PushFullLeadToGhlResult> {
  const token = opts.ghlAccessToken.trim();
  const locationId = opts.ghlLocationId.trim();
  if (!token || !locationId) {
    return { ok: false, reason: "missing_token_or_location" };
  }

  const ar = await fetchAryeoCustomer(opts.aryeoApiKey, input.aryeoCustomerId, opts.aryeoApiBaseUrl);
  if (!ar.ok) {
    return {
      ok: false,
      reason: "aryeo_fetch_failed",
      detail: `${ar.status} ${ar.body.slice(0, 500)}`,
    };
  }

  const groupPayload = parseAryeoGroupFromFetchPayload(ar.data);
  const flatBase = flattenAryeoCustomerGroup(groupPayload);
  if (!flatBase?.aryeo_customer_id) {
    return { ok: false, reason: "aryeo_payload_not_group" };
  }

  const orders = await fetchOrderObjectsForAryeoCustomer(
    opts.aryeoApiKey,
    input.aryeoCustomerId,
    opts.aryeoApiBaseUrl,
  );
  const flat: AryeoGroupFlat = { ...flatBase };
  applyRollupFromAryeoOrderResourcesToFlat(flat, orders);

  await ensureGhlCustomFieldCacheWarmed(pool, token, locationId);
  const fieldMapRows = await listActiveGhlFieldMapWithFallback(pool);
  const resolveId = (mapKey: string, explicit: string | null) =>
    resolveGhlOutboundCustomFieldId(pool, {
      locationId,
      mapKey,
      mapRowId: explicit,
    });

  const enrichmentNote = [
    `GHL sync (standalone) ${new Date().toISOString()}`,
    `Aryeo customer: ${input.aryeoCustomerId}`,
  ].join("\n");

  let body: Record<string, unknown>;
  try {
    body = await buildGhlContactBodyFromAryeoGroup({
      flat,
      customerUuid: input.aryeoCustomerId,
      profileUrlTemplate: opts.aryeoCustomerProfileUrlTemplate,
      fieldMapRows,
      resolveCustomFieldId: resolveId,
      enrichmentNote,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: "build_body_failed", detail: msg };
  }

  mergeCoreGhlIdentity(body, flat);

  const outgoingCustom = Array.isArray(body.customFields)
    ? (body.customFields as Array<{ id: string; value: string }>)
    : [];

  const got = await ghlGetContact(token, input.ghlContactId);
  if (!got.ok && outgoingCustom.length > 0) {
    return {
      ok: false,
      reason: "ghl_get_failed",
      detail: `cannot merge custom fields without GET: HTTP ${got.status} ${got.body.slice(0, 500)}`,
    };
  }

  const existingCf = got.ok ? ghlExtractCustomFields(got.contact) : [];

  const { tags: _t, customFields: _c, ...rest } = body;
  void _t;
  void _c;

  let mergedCf: Array<{ id: string; value: string }> | undefined;
  if (outgoingCustom.length > 0) {
    mergedCf = mergeGhlCustomFieldsForUpdate(existingCf, outgoingCustom);
  }

  const payload: Record<string, unknown> = { ...rest };
  if (got.ok) {
    payload.tags = ghlExtractTags(got.contact);
  }
  if (mergedCf !== undefined && mergedCf.length > 0) {
    payload.customFields = mergedCf;
  }

  const upd = await ghlUpdateContact(token, input.ghlContactId, payload);

  if (!upd.ok) {
    return {
      ok: false,
      reason: "ghl_update_failed",
      detail: `${upd.status} ${upd.body.slice(0, 800)}`,
    };
  }

  return { ok: true };
}
