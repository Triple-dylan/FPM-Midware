import { getStandardGhlBodyKey } from "../config/ghlRegistry.js";
import { formatMapValueForGhl } from "./ghlMapValueFormat.js";
import { formatAryeoCustomerProfileUrl } from "./ghlOrderOutboundValues.js";
import {
  normalizeCompanyName,
  normalizeEmail,
  normalizePersonNamePart,
  normalizePhoneForGhl,
  resolvePhoneForGhl,
  splitFullName,
} from "../lib/normalize.js";
import type { GhlFieldMapRow } from "../db/repos/ghlFieldMapRepo.js";
import { aryeoMergeCustomFields, aryeoPickNum, aryeoPickStr } from "../lib/aryeoRestShape.js";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function str(x: unknown): string | null {
  return typeof x === "string" ? x : null;
}

/** Strip simple HTML (Aryeo internal_notes often uses div wrappers). */
export function stripHtmlToText(raw: string | null | undefined): string | null {
  const t = raw?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return t || null;
}

export type AryeoGroupFlat = Record<string, string | null>;

/** Leading portion of `internal_notes` / `flat.notes` scanned for emoji (ops usually put 🐳 at the top). */
const WHALE_NOTE_HEAD_CHARS = 500;

/** Sperm / blue whale emoji — primary signal in customer notes. */
const WHALE_NOTE_EMOJIS = ["🐳", "🐋"] as const;

/**
 * True when notes start with a whale marker (emoji in the first ~500 chars, or the word Whale on the first line).
 * Used to set GHL `whale_` to Yes when Aryeo custom fields are missing or stale.
 */
export function leadNotesIndicateWhale(notes: string | null | undefined): boolean {
  const t = notes?.trim();
  if (!t) return false;
  const head = t.slice(0, WHALE_NOTE_HEAD_CHARS);
  for (const e of WHALE_NOTE_EMOJIS) {
    if (head.includes(e)) return true;
  }
  const firstLine = t.split(/\r?\n/)[0]?.trim() ?? "";
  return /^whale\b/i.test(firstLine);
}

/**
 * When lead notes show a whale marker near the top, set `whale_` to Yes (overrides prior flat value so notes win).
 */
export function promoteWhaleFromNotesNearTop(flat: AryeoGroupFlat): void {
  if (leadNotesIndicateWhale(flat.notes)) {
    flat.whale_ = "Yes";
  }
}

/** Known keys Aryeo may use for the Whale value before we normalize to GHL map key `whale_`. */
const ARYEO_WHALE_FLAT_ALIASES = [
  "whale_",
  "whale",
  "is_whale",
  "isWhale",
  "contact_whale",
] as const;

/**
 * Copy the Aryeo whale value onto `flat.whale_` (GHL registry key) so it carries through to GHL unchanged.
 * Handles root/custom field keys like `whale`, `whale_`, `Whale`, `is_whale`, etc.
 */
export function promoteAryeoWhaleToGhlMapKey(flat: AryeoGroupFlat): void {
  if (flat.whale_ != null && String(flat.whale_).trim() !== "") return;
  for (const k of ARYEO_WHALE_FLAT_ALIASES) {
    const v = flat[k];
    if (v != null && String(v).trim() !== "") {
      flat.whale_ = String(v).trim();
      return;
    }
  }
  for (const key of Object.keys(flat)) {
    if (key === "whale_") continue;
    const kl = key.toLowerCase();
    if (kl === "whale" || kl === "is_whale") {
      const v = flat[key];
      if (v != null && String(v).trim() !== "") {
        flat.whale_ = String(v).trim();
        return;
      }
    }
  }
}

/** Normalize Aryeo `GET /customers/{id}` GROUP payload for DB + GHL mapping. */
export function flattenAryeoCustomerGroup(group: unknown): AryeoGroupFlat | null {
  if (!isRecord(group)) return null;
  const owner = isRecord(group.owner) ? group.owner : null;
  const fullName = aryeoPickStr(group, "name");
  const sp = splitFullName(fullName);
  const phoneRaw = aryeoPickStr(group, "phone");
  const ownerFirst =
    (owner ? aryeoPickStr(owner, "first_name") : null) ?? sp.first;
  const ownerLast = (owner ? aryeoPickStr(owner, "last_name") : null) ?? sp.last;
  const flat: AryeoGroupFlat = {
    first_name: normalizePersonNamePart(ownerFirst),
    last_name: normalizePersonNamePart(ownerLast),
    email: normalizeEmail(aryeoPickStr(group, "email")),
    phone: normalizePhoneForGhl(phoneRaw),
    phone_raw: phoneRaw,
    company_name: normalizeCompanyName(aryeoPickStr(group, "office_name")),
    business_name: normalizeCompanyName(aryeoPickStr(group, "office_name")),
    license_number: normalizePersonNamePart(aryeoPickStr(group, "license_number")),
    website: aryeoPickStr(group, "website_url")?.trim() || null,
    timezone: aryeoPickStr(group, "timezone")?.trim() || null,
    notes: stripHtmlToText(aryeoPickStr(group, "internal_notes")),
    type: "Customer",
    aryeo_customer_id: str(group.id),
    aryeo_customer_type: aryeoPickStr(group, "type"),
  };
  mergeScalarFieldsFromAryeoGroup(group, flat, [
    "whale",
    "whale_",
    "is_whale",
    "rre_number_of_annual_listings",
    "rre_average_listing_price",
    "rre_brokerage",
  ]);
  mergeAllStringLikeCustomFieldsFromAryeo(group, flat);
  promoteAryeoWhaleToGhlMapKey(flat);
  promoteWhaleFromNotesNearTop(flat);
  return flat;
}

/** Copy string/number fields from Aryeo `custom_fields` into the flat map (CSV / GHL map keys). */
function mergeAllStringLikeCustomFieldsFromAryeo(group: Record<string, unknown>, flat: AryeoGroupFlat): void {
  const cf = aryeoMergeCustomFields(group);
  if (!cf) return;
  for (const [k, v] of Object.entries(cf)) {
    if (flat[k] != null && String(flat[k]).trim() !== "") continue;
    if (typeof v === "string" && v.trim()) {
      flat[k] = v.trim();
    } else if (typeof v === "number" && Number.isFinite(v)) {
      flat[k] = String(v);
    } else if (typeof v === "boolean") {
      flat[k] = v ? "Yes" : "No";
    }
  }
}

/** Copy known GHL-mapped scalars from Aryeo customer root or `custom_fields`. */
function mergeScalarFieldsFromAryeoGroup(
  group: Record<string, unknown>,
  flat: AryeoGroupFlat,
  keys: readonly string[],
): void {
  for (const k of keys) {
    const s = aryeoPickStr(group, k);
    if (s) {
      flat[k] = s;
      continue;
    }
    const n = aryeoPickNum(group, k);
    if (n != null) {
      flat[k] = String(n);
    }
  }
  const cf = aryeoMergeCustomFields(group);
  if (isRecord(cf)) {
    for (const k of keys) {
      if (flat[k]) continue;
      const v = cf[k];
      if (typeof v === "string" && v.trim()) {
        flat[k] = v.trim();
      } else if (typeof v === "number" && Number.isFinite(v)) {
        flat[k] = String(v);
      } else if (typeof v === "boolean") {
        flat[k] = v ? "Yes" : "No";
      }
    }
  }
}

/** Value from flattened Aryeo customer for an active `ghl_field_map` row (no order rollups). */
export function bootstrapValueForGhlMapKey(
  mapKey: string,
  flat: AryeoGroupFlat,
  customerUuid: string,
  profileUrlTemplate: string,
): string | null {
  if (mapKey === "aryeo_customer_profile_link") {
    return formatAryeoCustomerProfileUrl(profileUrlTemplate, customerUuid);
  }
  const v = flat[mapKey];
  if (v != null && String(v).trim() !== "") return String(v);
  return null;
}

export type ResolvedGhlFieldIds = (
  mapKey: string,
  explicitUuid: string | null,
) => Promise<string | null>;

/**
 * Build GHL contact PUT/POST body from flattened Aryeo customer + active field map.
 * Sets standard keys and customFields with pre-resolved UUIDs.
 */
export async function buildGhlContactBodyFromAryeoGroup(options: {
  flat: AryeoGroupFlat;
  customerUuid: string;
  profileUrlTemplate: string;
  fieldMapRows: GhlFieldMapRow[];
  resolveCustomFieldId: ResolvedGhlFieldIds;
  assignedTo?: string | null;
  /** Appended to notes */
  enrichmentNote: string;
}): Promise<Record<string, unknown>> {
  const {
    flat,
    customerUuid,
    profileUrlTemplate,
    fieldMapRows,
    resolveCustomFieldId,
    assignedTo,
    enrichmentNote,
  } = options;

  const body: Record<string, unknown> = {};
  const customFields: Array<{ id: string; value: string }> = [];

  if (assignedTo?.trim()) {
    body.assignedTo = assignedTo.trim();
  }

  const baseNotes = [flat.notes, enrichmentNote].filter(Boolean).join("\n\n");
  const flatWithNotes = { ...flat, notes: baseNotes || flat.notes };

  for (const row of fieldMapRows) {
    let v = bootstrapValueForGhlMapKey(
      row.map_key,
      flatWithNotes,
      customerUuid,
      profileUrlTemplate,
    );
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

/**
 * Apply Aryeo identity to standard GHL contact keys on create/update.
 * Overwrites when Aryeo has a non-empty value so existing GHL contacts stay aligned with source.
 */
export function mergeCoreGhlIdentity(body: Record<string, unknown>, flat: AryeoGroupFlat): void {
  const core: Record<string, string | null | undefined> = {
    firstName: flat.first_name,
    lastName: flat.last_name,
    email: flat.email,
    phone: resolvePhoneForGhl(flat),
    companyName: flat.company_name,
    website: flat.website,
    timezone: flat.timezone,
  };
  for (const [k, v] of Object.entries(core)) {
    if (v != null && String(v).trim() !== "") {
      body[k] = v;
    }
  }
}

/** Minimal GHL create payload (required location + identity). */
export function buildGhlCreateEnvelope(
  locationId: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  return {
    locationId: locationId.trim(),
    ...body,
    source: typeof body.source === "string" ? body.source : "FPM middleware (Aryeo)",
    tags: Array.isArray(body.tags) ? body.tags : ["aryeo-bootstrap"],
  };
}
