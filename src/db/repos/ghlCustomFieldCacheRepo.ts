import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

export async function upsertGhlCustomFieldCacheRow(
  db: Db,
  row: { locationId: string; fieldKey: string; ghlFieldId: string; name: string | null },
): Promise<void> {
  await db.query(
    `insert into ghl_custom_field_cache (location_id, field_key, ghl_field_id, name, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (location_id, field_key) do update set
       ghl_field_id = excluded.ghl_field_id,
       name = excluded.name,
       updated_at = now()`,
    [row.locationId, row.fieldKey, row.ghlFieldId, row.name],
  );
}

export async function getGhlFieldIdForKey(
  db: Db,
  locationId: string,
  fieldKey: string,
): Promise<string | null> {
  const r = await db.query<{ ghl_field_id: string }>(
    `select ghl_field_id from ghl_custom_field_cache
     where location_id = $1 and field_key = $2`,
    [locationId, fieldKey],
  );
  return r.rows[0]?.ghl_field_id ?? null;
}

/** Prefer explicit ghl_field_map.ghl_custom_field_id, else cache. */
export async function resolveGhlCustomFieldId(
  db: Db,
  options: {
    locationId: string;
    mapKey: string;
    mapRowId: string | null;
  },
): Promise<string | null> {
  if (options.mapRowId?.trim()) {
    return options.mapRowId.trim();
  }
  return getGhlFieldIdForKey(db, options.locationId, options.mapKey);
}
