import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

export type GhlFieldMapRow = {
  map_key: string;
  ghl_custom_field_id: string | null;
  label: string | null;
};

/**
 * Core identity + rollup keys always participate in outbound mapping even if absent from `ghl_field_map`
 * (e.g. seed not run); custom field UUIDs still come from cache / explicit map id.
 * Used by tests and `listActiveGhlFieldMapWithFallback`.
 */
export const GHL_OUTBOUND_FALLBACK_MAP_KEYS: readonly string[] = [
  "first_name",
  "last_name",
  "email",
  "phone",
  "whale_",
  "last_shoot_date",
  "1st_shoot_appointment_date",
  "2nd_shoot_appointment_date",
  "3rd_shoot_appointment_date",
  "last_order_placed",
  "last_order_date",
  "last_order_amount",
  "lifetime_value",
  "average_order_value",
];

/** Active targets; UUID may come from `ghl_custom_field_id` or `ghl_custom_field_cache` after refresh. */
export async function listActiveGhlFieldMap(db: Db): Promise<GhlFieldMapRow[]> {
  const r = await db.query<GhlFieldMapRow>(
    `select map_key, ghl_custom_field_id, label
     from ghl_field_map
     where active = true
     order by sort_order, map_key`,
  );
  return r.rows;
}

/** Like `listActiveGhlFieldMap` but guarantees required outbound keys are present for mapping loops. */
export async function listActiveGhlFieldMapWithFallback(db: Db): Promise<GhlFieldMapRow[]> {
  const rows = await listActiveGhlFieldMap(db);
  const seen = new Set(rows.map((r) => r.map_key));
  const extra: GhlFieldMapRow[] = [];
  for (const k of GHL_OUTBOUND_FALLBACK_MAP_KEYS) {
    if (!seen.has(k)) {
      extra.push({ map_key: k, ghl_custom_field_id: null, label: null });
    }
  }
  return [...rows, ...extra];
}
