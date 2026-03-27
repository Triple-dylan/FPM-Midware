import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

export type GhlFieldMapRow = {
  map_key: string;
  ghl_custom_field_id: string | null;
  label: string | null;
};

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
