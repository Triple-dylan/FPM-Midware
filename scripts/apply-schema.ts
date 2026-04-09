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

/** Railway public TCP / proxy hosts need relaxed TLS; internal .railway.internal is plain TCP (CLI from laptop cannot resolve it). */
function pgClientConfig(connectionString: string): pg.ClientConfig {
  if (process.env.DATABASE_SSL_STRICT === "1") {
    return { connectionString };
  }
  let host: string;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    return { connectionString };
  }
  const railwayPublic =
    host.endsWith(".rlwy.net") ||
    host.endsWith(".up.railway.app") ||
    host.includes("proxy.rlwy.net");
  if (railwayPublic) {
    return {
      connectionString,
      ssl: { rejectUnauthorized: false },
    };
  }
  return { connectionString };
}

async function applyFile(client: pg.Client, filePath: string): Promise<void> {
  const sql = readFileSync(filePath, "utf8");
  await client.query(sql);
}

async function main(): Promise<void> {
  const client = new Client(pgClientConfig(databaseUrl));
  try {
    await client.connect();
  } catch (e) {
    console.error(e);
    console.error(
      "\nIf you see \"Connection terminated unexpectedly\", the host/port is usually wrong: copy DATABASE_URL from the **PostgreSQL** service in Railway (Connect / Variables), not from the web app. The hostname should match that database’s public TCP endpoint.\n",
    );
    process.exit(1);
  }
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
