import "dotenv/config";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const require = createRequire(import.meta.url);
/** CJS module — avoids `connectionString` + `ssl` merge bugs in pg’s ConnectionParameters. */
const parsePgUrl = require("pg-connection-string") as (s: string) => PgUrlParts;
const { serialize } = require("pg-protocol") as { serialize: { startup: (c: Record<string, string>) => Buffer } };

type PgUrlParts = {
  user?: string;
  password?: string | (() => string | Promise<string>);
  host?: string | undefined;
  port?: string | number | undefined;
  database?: string | null;
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = join(root, "schema", "schema.sql");
const migrationsDir = join(root, "schema", "migrations");

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is required (see .env.example)");
  process.exit(1);
}

function isRailwayPublicHost(host: string | undefined): boolean {
  if (!host) return false;
  return (
    host.endsWith(".rlwy.net") ||
    host.endsWith(".up.railway.app") ||
    host.includes("proxy.rlwy.net")
  );
}

/**
 * `*.proxy.rlwy.net` is used for **many** Railway TCP services. If host:port is actually an HTTP
 * edge (e.g. same name as your **web** service), Postgres startup gets `HTTP/1.1 ...` back.
 */
async function assertHostSpeaksPostgres(host: string, port: number): Promise<void> {
  const net = await import("node:net");
  await new Promise<void>((resolve, reject) => {
    const s = net.createConnection({ host, port }, () => {
      s.write(serialize.startup({ user: "preflight", database: "preflight" }));
    });
    const fail = (msg: string) => {
      try {
        s.destroy();
      } catch {
        /* ignore */
      }
      reject(new Error(msg));
    };
    const ok = () => {
      try {
        s.destroy();
      } catch {
        /* ignore */
      }
      resolve();
    };
    s.setTimeout(8000, () => fail("timeout waiting for PostgreSQL response (check host/port)."));
    s.once("data", (buf: Buffer) => {
      if (buf.length >= 4 && buf.subarray(0, 4).toString("ascii") === "HTTP") {
        fail(
          `This host:port answered with HTTP, not PostgreSQL. You are using the wrong URL — often the public **web** proxy (e.g. same name as your Node service) instead of the **PostgreSQL** service’s public TCP URL.\n\nOpen Railway → **PostgreSQL** (database) → **Connect** / **Variables** → copy **Database public URL** / **TCP** (host + port must be for Postgres only, not your app’s \`*.proxy.rlwy.net\` unless it is explicitly listed on the Postgres service).`,
        );
        return;
      }
      ok();
    });
    s.once("error", (err: Error) => fail(err.message));
  });
}

/**
 * Railway public TCP proxy: pg merges `parse(connectionString)` over top-level `ssl`, which can
 * drop TLS options. Pass host/user/port/database explicitly + ssl (no `connectionString` key).
 * Set DATABASE_RAILWAY_SSL_PLAIN=1 to force non-TLS (rare; proxy usually expects TLS).
 */
function pgClientConfig(url: string): pg.ClientConfig {
  if (process.env.DATABASE_SSL_STRICT === "1") {
    return { connectionString: url };
  }

  let parsed: PgUrlParts;
  try {
    parsed = parsePgUrl(url);
  } catch {
    return { connectionString: url };
  }

  const host = typeof parsed.host === "string" ? parsed.host : "";
  if (!isRailwayPublicHost(host)) {
    return { connectionString: url };
  }

  const portRaw = parsed.port;
  const port =
    typeof portRaw === "number"
      ? portRaw
      : portRaw !== undefined && portRaw !== ""
        ? Number.parseInt(String(portRaw), 10)
        : 5432;

  const password = parsed.password as string | undefined;

  const plain =
    process.env.DATABASE_RAILWAY_SSL_PLAIN === "1" ||
    process.env.PGSSLMODE === "disable";

  const ssl: pg.ClientConfig["ssl"] = plain ? false : { rejectUnauthorized: false, servername: host };

  return {
    user: parsed.user,
    password,
    host,
    port,
    database: parsed.database ?? undefined,
    ssl,
  };
}

async function applyFile(client: pg.Client, filePath: string): Promise<void> {
  const sql = readFileSync(filePath, "utf8");
  await client.query(sql);
}

async function main(): Promise<void> {
  try {
    const p = parsePgUrl(databaseUrl);
    const h = p.host;
    const pr = p.port;
    if (typeof h === "string" && h && !h.startsWith("/") && pr !== undefined && pr !== "") {
      const pt = typeof pr === "number" ? pr : Number.parseInt(String(pr), 10);
      if (Number.isFinite(pt)) await assertHostSpeaksPostgres(h, pt);
    }
  } catch (e: unknown) {
    const m = e instanceof Error ? e.message : String(e);
    if (m.includes("answered with HTTP") || m.includes("timeout waiting for PostgreSQL")) {
      console.error(m);
      process.exit(1);
    }
  }

  const client = new Client(pgClientConfig(databaseUrl));
  try {
    await client.connect();
  } catch (e) {
    console.error(e);
    console.error(
      '\nUse **Database public URL** from the **PostgreSQL** service in Railway (not the Node app). If the host matches your **web** service name, it is the wrong URL.\n',
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
