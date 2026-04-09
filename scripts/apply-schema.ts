import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = join(root, "schema", "schema.sql");
const migrationsDir = join(root, "schema", "migrations");

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is required (see .env.example)");
  process.exit(1);
}

async function applyFile(client: pg.Client, filePath: string): Promise<void> {
  const sql = readFileSync(filePath, "utf8");
  await client.query(sql);
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await applyFile(client, schemaPath);
    let migrationFiles: string[] = [];
    try {
      migrationFiles = readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql"))
        .sort();
    } catch {
      /* no migrations directory */
    }
    for (const f of migrationFiles) {
      await applyFile(client, join(migrationsDir, f));
    }
  } finally {
    await client.end();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
