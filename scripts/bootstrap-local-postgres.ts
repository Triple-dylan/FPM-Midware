/**
 * One-time local dev helper: create DATABASE_URL role + database when missing.
 * Uses a superuser connection (trust auth on TCP localhost is typical for Homebrew Postgres).
 *
 *   npm run db:local:bootstrap
 *
 * Optional: POSTGRES_ADMIN_URL=postgresql://user:pass@127.0.0.1:5432/postgres
 * If unset, tries: $USER, then postgres, on 127.0.0.1:5432/postgres
 */
import "dotenv/config";
import pg from "pg";

const { Client } = pg;

const SAFE_IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function sqlIdent(s: string): string {
  if (!SAFE_IDENT.test(s)) {
    throw new Error(`Unsafe database identifier in DATABASE_URL: ${s}`);
  }
  return `"${s.replace(/"/g, '""')}"`;
}

function sqlLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function toPostgresqlUrl(url: string): string {
  if (url.startsWith("postgres://")) {
    return `postgresql://${url.slice("postgres://".length)}`;
  }
  return url;
}

function parseDatabaseUrl(raw: string): {
  user: string;
  password: string;
  host: string;
  port: string;
  database: string;
} {
  const u = new URL(toPostgresqlUrl(raw.trim()));
  const database = u.pathname.replace(/^\//, "");
  if (!database) throw new Error("DATABASE_URL must include a database name");
  return {
    user: decodeURIComponent(u.username || ""),
    password: decodeURIComponent(u.password || ""),
    host: u.hostname || "127.0.0.1",
    port: u.port || "5432",
    database,
  };
}

function adminCandidates(): string[] {
  const fromEnv = process.env.POSTGRES_ADMIN_URL?.trim();
  if (fromEnv) return [toPostgresqlUrl(fromEnv)];
  const user = process.env.USER || "postgres";
  return [
    `postgresql://${encodeURIComponent(user)}@127.0.0.1:5432/postgres`,
    `postgresql://postgres@127.0.0.1:5432/postgres`,
  ];
}

async function tryConnect(url: string): Promise<pg.Client | null> {
  const c = new Client({
    connectionString: url,
    connectionTimeoutMillis: 8000,
  });
  try {
    await c.connect();
    return c;
  } catch {
    try {
      await c.end();
    } catch {
      /* ignore */
    }
    return null;
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error("DATABASE_URL is required (see .env.example)");
    process.exit(1);
  }

  const target = parseDatabaseUrl(databaseUrl);
  if (!target.user) {
    console.error("DATABASE_URL must include a username");
    process.exit(1);
  }

  const direct = await tryConnect(databaseUrl);
  if (direct) {
    await direct.end();
    console.log("Database already reachable with DATABASE_URL — nothing to bootstrap.");
    return;
  }

  let admin: pg.Client | null = null;
  for (const url of adminCandidates()) {
    admin = await tryConnect(url);
    if (admin) {
      console.log(`Using admin connection: ${url.replace(/:[^:@/]+@/, ":****@")}`);
      break;
    }
  }
  if (!admin) {
    console.error(
      [
        "Could not connect to PostgreSQL as a superuser.",
        "",
        "Install and start Postgres locally, then retry:",
        "  brew install postgresql@16",
        "  brew services start postgresql@16",
        "",
        "Or set POSTGRES_ADMIN_URL to a superuser URL (e.g. postgresql://postgres:…@127.0.0.1:5432/postgres).",
      ].join("\n"),
    );
    process.exit(1);
  }

  try {
    const uq = sqlIdent(target.user);
    const dq = sqlIdent(target.database);
    const pw = sqlLiteral(target.password);

    const roleExists = await admin.query(
      "SELECT 1 AS x FROM pg_roles WHERE rolname = $1",
      [target.user],
    );
    if (roleExists.rowCount === 0) {
      await admin.query(`CREATE ROLE ${uq} WITH LOGIN PASSWORD ${pw}`);
      console.log(`Created role ${target.user}.`);
    } else {
      await admin.query(`ALTER ROLE ${uq} WITH LOGIN PASSWORD ${pw}`);
      console.log(`Role ${target.user} exists — password updated to match DATABASE_URL.`);
    }

    const dbExists = await admin.query(
      "SELECT 1 AS x FROM pg_database WHERE datname = $1",
      [target.database],
    );
    if (dbExists.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${dq} OWNER ${uq}`);
      console.log(`Created database ${target.database}.`);
    } else {
      await admin.query(`ALTER DATABASE ${dq} OWNER TO ${uq}`);
      console.log(`Database ${target.database} exists — ownership set to ${target.user}.`);
    }
  } finally {
    await admin.end();
  }

  const verify = await tryConnect(databaseUrl);
  if (!verify) {
    console.error("Bootstrap finished but DATABASE_URL still does not connect. Check password/host/port.");
    process.exit(1);
  }
  await verify.end();
  console.log("Bootstrap OK — you can run npm run db:apply");
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
