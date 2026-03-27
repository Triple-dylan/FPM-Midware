import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = join(root, "schema", "schema.sql");
const migrationsDir = join(root, "schema", "migrations");

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is required (see .env.example)");
  process.exit(1);
}

function applyFile(filePath: string): void {
  execFileSync(
    "psql",
    ["-d", databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", filePath],
    { stdio: "inherit", env: process.env },
  );
}

try {
  applyFile(schemaPath);
  let migrationFiles: string[] = [];
  try {
    migrationFiles = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    /* no migrations directory */
  }
  for (const f of migrationFiles) {
    applyFile(join(migrationsDir, f));
  }
} catch {
  process.exit(1);
}
