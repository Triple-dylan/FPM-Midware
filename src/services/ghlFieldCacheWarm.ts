import type pg from "pg";
import {
  fieldKeyToMapKey,
  fetchGhlLocationCustomFields,
} from "../integrations/ghlLocationsApi.js";
import { getGhlFieldIdForKey, upsertGhlCustomFieldCacheRow } from "../db/repos/ghlCustomFieldCacheRepo.js";

/** One warm per Node process per location (sync touches many contacts). */
const warmed = new Map<string, Promise<{ ok: true; count: number } | { ok: false; error: string }>>();

/** In-memory mapKey → GHL field UUID for this process (survives if DB read races the upsert). */
const memoryFieldIdsByLocation = new Map<string, Map<string, string>>();

/**
 * Resolve custom field UUID: explicit map row → warm memory → Postgres cache.
 * Use for all GHL outbound pushes after `ensureGhlCustomFieldCacheWarmed`.
 */
export async function resolveGhlOutboundCustomFieldId(
  pool: pg.Pool,
  options: { locationId: string; mapKey: string; mapRowId: string | null },
): Promise<string | null> {
  const explicit = options.mapRowId?.trim();
  if (explicit) return explicit;
  const loc = options.locationId.trim();
  const mk = options.mapKey.trim();
  const map = memoryFieldIdsByLocation.get(loc);
  let mem = map?.get(mk);
  if (!mem && (mk === "whale_" || mk === "whale")) {
    mem = map?.get("whale_") ?? map?.get("whale");
  }
  if (mem) return mem;
  let db = await getGhlFieldIdForKey(pool, loc, mk);
  if (!db && (mk === "whale_" || mk === "whale")) {
    db =
      (await getGhlFieldIdForKey(pool, loc, "whale_")) ??
      (await getGhlFieldIdForKey(pool, loc, "whale"));
  }
  return db;
}

export async function warmGhlCustomFieldCacheFromApi(
  pool: pg.Pool,
  accessToken: string,
  locationId: string,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const fields = await fetchGhlLocationCustomFields(accessToken, locationId);
    const loc = locationId.trim();
    const mem = new Map<string, string>();
    memoryFieldIdsByLocation.set(loc, mem);

    let n = 0;
    for (const f of fields) {
      const fk = (f.fieldKey ?? "").trim();
      const name = f.name?.trim() ?? "";
      if (!fk && !name) continue;

      let mapKey = "";
      if (fk) {
        mapKey = fieldKeyToMapKey(fk);
        if (mapKey === "whale") {
          mapKey = "whale_";
        }
      }
      if (!mapKey && name.toLowerCase().includes("whale")) {
        mapKey = "whale_";
      }
      if (!mapKey) continue;

      mem.set(mapKey, f.id);
      if (mapKey === "whale_") {
        mem.set("whale", f.id);
      }
      await upsertGhlCustomFieldCacheRow(pool, {
        locationId: loc,
        fieldKey: mapKey,
        ghlFieldId: f.id,
        name: f.name ?? null,
      });
      n++;
    }
    return { ok: true, count: n };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/**
 * Fetches GHL location custom field definitions once per process and fills `ghl_custom_field_cache`
 * so `resolveGhlOutboundCustomFieldId` can resolve UUIDs without a prior manual refresh.
 */
export async function ensureGhlCustomFieldCacheWarmed(
  pool: pg.Pool,
  accessToken: string,
  locationId: string,
): Promise<void> {
  const loc = locationId.trim();
  if (!loc) return;
  let p = warmed.get(loc);
  if (!p) {
    p = warmGhlCustomFieldCacheFromApi(pool, accessToken, loc);
    warmed.set(loc, p);
  }
  const r = await p;
  if (!r.ok) {
    console.warn(`[ghl] custom field cache warm failed for ${loc}: ${r.error}`);
  }
}
