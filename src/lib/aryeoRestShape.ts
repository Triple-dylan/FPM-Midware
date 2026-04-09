/**
 * Aryeo JSON may use snake_case (webhooks / docs) or camelCase (some REST responses).
 * Read the first matching alias that is present with a usable value.
 */

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function toCamelAlias(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** First non-empty string among snake_key and camelCase equivalent. */
export function aryeoPickStr(o: Record<string, unknown>, snakeKey: string): string | null {
  const keys = [snakeKey, toCamelAlias(snakeKey)];
  for (const k of keys) {
    if (!(k in o)) continue;
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** Number or numeric string (amounts in cents); tries snake + camel key names. */
export function aryeoPickNum(o: Record<string, unknown>, snakeKey: string): number | null {
  const keys = [snakeKey, toCamelAlias(snakeKey)];
  for (const k of keys) {
    if (!(k in o)) continue;
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v.trim().replace(/,/g, ""));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** First string among several possible field names (snake + camel for each). */
export function aryeoPickStrAny(o: Record<string, unknown>, ...snakeKeys: string[]): string | null {
  for (const sk of snakeKeys) {
    const v = aryeoPickStr(o, sk);
    if (v) return v;
  }
  return null;
}

/**
 * Aryeo `GroupCustomer.custom_field_entries` is an array in the OpenAPI spec but entry properties are
 * not documented; runtime payloads typically include a slug/key plus a scalar `value` (see REST responses).
 */
function extractCustomFieldEntryScalar(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v;
  if (isRecord(v)) {
    if ("value" in v) return extractCustomFieldEntryScalar(v.value);
    const sv = v.string_value ?? v.stringValue;
    if (typeof sv === "string" && sv.trim()) return sv.trim();
    const lv = v.label;
    if (typeof lv === "string" && lv.trim()) return lv.trim();
  }
  return null;
}

function normalizeCustomFieldMergedScalar(v: string | number | boolean): string | number {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return v;
}

function customFieldEntryMapKey(entry: Record<string, unknown>): string | null {
  const direct = aryeoPickStrAny(entry, "slug", "key", "field_key");
  if (direct) return direct;
  const nm = aryeoPickStr(entry, "name");
  if (nm) return nm;
  const cf = entry.custom_field ?? entry.customField;
  if (isRecord(cf)) {
    const nested = aryeoPickStrAny(cf, "slug", "key", "field_key");
    if (nested) return nested;
    const lab = aryeoPickStr(cf, "label");
    if (lab) return lab;
    const id = aryeoPickStr(cf, "id");
    if (id) return id;
  }
  return null;
}

function recordFromCustomFieldEntriesArray(arr: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!Array.isArray(arr)) return out;
  for (const item of arr) {
    if (!isRecord(item)) continue;
    const key = customFieldEntryMapKey(item);
    if (!key?.trim()) continue;
    const raw =
      extractCustomFieldEntryScalar(item.value) ??
      extractCustomFieldEntryScalar(item.string_value ?? item.stringValue) ??
      extractCustomFieldEntryScalar(item.boolean_value ?? item.booleanValue) ??
      extractCustomFieldEntryScalar(item.number_value ?? item.numberValue);
    if (raw === null) continue;
    const norm = normalizeCustomFieldMergedScalar(raw);
    if (!(key in out)) out[key] = norm;
  }
  return out;
}

export function aryeoMergeCustomFields(
  group: Record<string, unknown>,
): Record<string, unknown> | null {
  const fromEntries = {
    ...recordFromCustomFieldEntriesArray(group.custom_field_entries),
    ...recordFromCustomFieldEntriesArray(group.customFieldEntries),
  };

  const a = group.custom_fields;
  const b = group.customFields;
  let base: Record<string, unknown> | null = null;
  if (isRecord(a) && Object.keys(a).length > 0) base = { ...a };
  else if (isRecord(b) && Object.keys(b).length > 0) base = { ...b };
  else if (isRecord(a)) base = { ...a };
  else if (isRecord(b)) base = { ...b };

  const merged = { ...fromEntries, ...(base ?? {}) };
  if (Object.keys(merged).length === 0) return null;
  return merged;
}
