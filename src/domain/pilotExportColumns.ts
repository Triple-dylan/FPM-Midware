import { loadGhlContactFieldRegistry } from "../config/ghlRegistry.js";
import { formatAryeoCustomerProfileUrl } from "./ghlOrderOutboundValues.js";
import type { AryeoGroupFlat } from "./aryeoGroupToGhlPayload.js";

/**
 * Every GHL map key from the generated registry (standard + custom definitions).
 * Sorted for stable CSV column order.
 */
export function getAllRegistryMapKeysSorted(): string[] {
  const reg = loadGhlContactFieldRegistry();
  const keys = new Set<string>();
  for (const k of Object.keys(reg.standardBodyKeys)) {
    keys.add(k);
  }
  for (const f of reg.fields) {
    if (f.mapKey?.trim()) keys.add(f.mapKey.trim());
  }
  return [...keys].sort((a, b) => a.localeCompare(b));
}

export type RegistryFieldHint = {
  mapKey: string;
  label: string;
  fieldNameInAryeo: string;
};

/** One row per field — for joining / understanding gaps (not the wide contact row). */
export function getRegistryFieldHints(): RegistryFieldHint[] {
  const reg = loadGhlContactFieldRegistry();
  const byKey = new Map<string, RegistryFieldHint>();
  for (const k of Object.keys(reg.standardBodyKeys)) {
    if (!byKey.has(k)) {
      byKey.set(k, { mapKey: k, label: `(standard) ${k}`, fieldNameInAryeo: "" });
    }
  }
  for (const f of reg.fields) {
    byKey.set(f.mapKey, {
      mapKey: f.mapKey,
      label: f.label,
      fieldNameInAryeo: f.fieldNameInAryeo ?? "",
    });
  }
  return getAllRegistryMapKeysSorted().map((k) => byKey.get(k) ?? { mapKey: k, label: "", fieldNameInAryeo: "" });
}

/**
 * Value for each registry map key from **customer GROUP** context only.
 * Order/shoot/LTV aggregates are empty here — surfaces where hooks/jobs are needed.
 */
export function buildRegistryColumnValues(
  mapKeys: string[],
  flat: AryeoGroupFlat,
  customerUuid: string,
  profileUrlTemplate: string,
): Record<string, string> {
  const flatRec = flat as Record<string, string | null | undefined>;
  const out: Record<string, string> = {};

  for (const mapKey of mapKeys) {
    if (mapKey === "aryeo_customer_profile_link") {
      const u = formatAryeoCustomerProfileUrl(profileUrlTemplate, customerUuid);
      out[mapKey] = u.trim() ? u : "";
      continue;
    }

    const raw = flatRec[mapKey];
    if (raw != null && String(raw).trim() !== "") {
      out[mapKey] = String(raw);
      continue;
    }

    out[mapKey] = "";
  }

  return out;
}
