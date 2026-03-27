/**
 * PREREQ: npm run db:apply
 *
 * Fetches custom field UUIDs from GHL for GHL_LOCATION_ID and upserts ghl_custom_field_cache.
 * Map keys match your CSV/registry (e.g. last_order_placed, whale_).
 *
 *   DATABASE_URL=... GHL_ACCESS_TOKEN=... GHL_LOCATION_ID=... npx tsx scripts/ghl-refresh-custom-field-ids.ts
 */
import "dotenv/config";
import pg from "pg";
import {
  fieldKeyToMapKey,
  fetchGhlLocationCustomFields,
} from "../src/integrations/ghlLocationsApi.js";
import { upsertGhlCustomFieldCacheRow } from "../src/db/repos/ghlCustomFieldCacheRepo.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
const token = process.env.GHL_ACCESS_TOKEN?.trim();
const locationId = process.env.GHL_LOCATION_ID?.trim();

if (!databaseUrl || !token || !locationId) {
  console.error(
    "Requires DATABASE_URL, GHL_ACCESS_TOKEN, GHL_LOCATION_ID in environment",
  );
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });

async function main(): Promise<void> {
  const fields = await fetchGhlLocationCustomFields(token, locationId);
  let n = 0;
  for (const f of fields) {
    const fk = f.fieldKey ?? "";
    if (!fk && !f.name) continue;
    const mapKey = fk ? fieldKeyToMapKey(fk) : "";
    if (!mapKey) continue;
    await upsertGhlCustomFieldCacheRow(pool, {
      locationId,
      fieldKey: mapKey,
      ghlFieldId: f.id,
      name: f.name ?? null,
    });
    n++;
  }
  console.log(`Cached ${n} GHL custom field id(s) for location ${locationId}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
