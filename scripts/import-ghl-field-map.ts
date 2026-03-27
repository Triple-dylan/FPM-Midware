/**
 * Import GHL field targets from CSV into ghl_field_map.
 * CSV columns: map_key, ghl_custom_field_id, label, active, sort_order (optional)
 *
 *   DATABASE_URL=... npx tsx scripts/import-ghl-field-map.ts config/your-fields.csv
 */
import { readFileSync } from "node:fs";
import pg from "pg";

function parseSimpleCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(",").map((v) => v.trim());
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = vals[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

const databaseUrl = process.env.DATABASE_URL?.trim();
const path = process.argv[2];
if (!databaseUrl || !path) {
  console.error("Usage: DATABASE_URL=... npx tsx scripts/import-ghl-field-map.ts <file.csv>");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const raw = readFileSync(path, "utf8");
const rows = parseSimpleCsv(raw);

async function main(): Promise<void> {
  let n = 0;
  for (const r of rows) {
    const mapKey = r.map_key?.trim();
    if (!mapKey) continue;
    const fieldId = r.ghl_custom_field_id?.trim() || null;
    const label = r.label?.trim() || null;
    const active =
      r.active === undefined || r.active === ""
        ? true
        : ["1", "true", "yes"].includes(String(r.active).toLowerCase());
    const sortOrder = Number.parseInt(r.sort_order ?? "0", 10) || 0;

    await pool.query(
      `insert into ghl_field_map (map_key, ghl_custom_field_id, label, active, sort_order)
       values ($1, $2, $3, $4, $5)
       on conflict (map_key) do update set
         ghl_custom_field_id = excluded.ghl_custom_field_id,
         label = excluded.label,
         active = excluded.active,
         sort_order = excluded.sort_order,
         updated_at = now()`,
      [mapKey, fieldId, label, active, sortOrder],
    );
    n++;
  }
  console.log(`Imported ${n} row(s) into ghl_field_map`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
