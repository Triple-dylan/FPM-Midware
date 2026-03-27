/**
 * List custom field definitions for a GHL location (resolves merge keys → UUIDs).
 * API paths vary by account/version; we try known patterns.
 */

export type GhlCfApiRow = { id: string; name?: string; fieldKey?: string };

function extractArray(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== "object") return [];
  const o = json as Record<string, unknown>;
  if (Array.isArray(o.customFields)) return o.customFields;
  if (Array.isArray(o.customValues)) return o.customValues;
  if (Array.isArray(o.custom_fields)) return o.custom_fields;
  if (Array.isArray(o.data)) return o.data;
  return [];
}

function normalizeCfRows(rows: unknown[]): GhlCfApiRow[] {
  const out: GhlCfApiRow[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id =
      typeof o.id === "string"
        ? o.id
        : typeof o._id === "string"
          ? o._id
          : null;
    if (!id) continue;
    const fieldKey =
      typeof o.fieldKey === "string"
        ? o.fieldKey
        : typeof o.key === "string"
          ? o.key
          : "";
    const name = typeof o.name === "string" ? o.name : undefined;
    out.push({ id, name, fieldKey });
  }
  return out;
}

export function fieldKeyToMapKey(fieldKey: string): string {
  const t = fieldKey.trim();
  const m = t.match(/contact\.(.+)/i);
  return (m ? m[1] : t).trim();
}

export async function fetchGhlLocationCustomFields(
  accessToken: string,
  locationId: string,
): Promise<GhlCfApiRow[]> {
  const base = "https://services.leadconnectorhq.com";
  const urls = [
    `${base}/locations/${encodeURIComponent(locationId)}/customFields`,
    `${base}/locations/${encodeURIComponent(locationId)}/custom-values`,
  ];
  const errors: string[] = [];

  for (const url of urls) {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: "2021-07-28",
        Accept: "application/json",
      },
    });
    const text = await res.text();
    if (!res.ok) {
      errors.push(`${url} → ${res.status}: ${text.slice(0, 200)}`);
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      errors.push(`${url} → invalid JSON`);
      continue;
    }
    const rows = normalizeCfRows(extractArray(json));
    if (rows.length > 0) return rows;
  }

  throw new Error(
    `Could not list GHL custom fields. Tried: ${urls.join(", ")}. ${errors.join(" | ")}`,
  );
}
