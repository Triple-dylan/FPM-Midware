/**
 * Upserts `ghl_field_map` rows from config/ghlContactFieldRegistry.generated.json.
 * Turns on sensible defaults for Aryeo→GHL order push; run after db:apply.
 *
 *   DATABASE_URL=... npx tsx scripts/seed-ghl-field-map-from-registry.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { GhlContactFieldRegistry } from "../src/config/ghlRegistry.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const regPath = join(root, "config", "ghlContactFieldRegistry.generated.json");

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const ACTIVE_DEFAULT = new Set([
  "last_order_placed",
  "last_order_amount",
  "aryeo_customer_profile_link",
  "type",
]);

const pool = new pg.Pool({ connectionString: databaseUrl });

async function main(): Promise<void> {
  const reg = JSON.parse(readFileSync(regPath, "utf8")) as GhlContactFieldRegistry;
  let n = 0;
  let sort = 0;
  for (const f of reg.fields) {
    sort += 10;
    const active = ACTIVE_DEFAULT.has(f.mapKey);
    await pool.query(
      `insert into ghl_field_map (map_key, ghl_custom_field_id, label, active, sort_order, notes)
       values ($1, null, $2, $3, $4, $5)
       on conflict (map_key) do update set
         label = excluded.label,
         active = excluded.active,
         sort_order = excluded.sort_order,
         notes = excluded.notes,
         updated_at = now()`,
      [
        f.mapKey,
        f.label,
        active,
        sort,
        [f.definition, f.fieldNameInAryeo].filter(Boolean).join(" | ").slice(0, 2000),
      ],
    );
    n++;
  }
  console.log(`Upserted ${n} ghl_field_map rows (${ACTIVE_DEFAULT.size} active by default)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
