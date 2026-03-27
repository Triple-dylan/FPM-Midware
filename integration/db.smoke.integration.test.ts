import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL?.trim();

describe("database smoke (integration)", () => {
  let pool: pg.Pool | undefined;

  beforeAll(() => {
    if (databaseUrl) {
      pool = new pg.Pool({ connectionString: databaseUrl });
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  it.skipIf(!databaseUrl)("connects", async () => {
    const result = await pool!.query("select 1 as ok");
    expect(result.rows[0].ok).toBe(1);
  });

  it.skipIf(!databaseUrl)(
    "has core canonical tables (apply schema if this fails)",
    async () => {
      const result = await pool!.query<{ n: string }>(
        `select count(*)::text as n
         from information_schema.tables
         where table_schema = 'public'
           and table_name in ('leads', 'lead_external_ids', 'sync_events')`,
      );
      expect(Number(result.rows[0].n)).toBe(3);
    },
  );
});
