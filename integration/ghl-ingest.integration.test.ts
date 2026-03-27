import "dotenv/config";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestGhlContactPayload } from "../src/services/ghlIngest.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
const here = dirname(fileURLToPath(import.meta.url));

describe("GHL contact ingest (integration)", () => {
  let pool: pg.Pool | undefined;

  beforeAll(() => {
    if (databaseUrl) pool = new pg.Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it.skipIf(!databaseUrl)("creates lead, external id, assignment, sync_event in one transaction", async () => {
    const raw = JSON.parse(
      await readFile(join(here, "fixtures/ghl-contact-create.json"), "utf8"),
    ) as unknown;

    const client = await pool!.connect();
    try {
      await client.query("BEGIN");

      await ingestGhlContactPayload(client, raw);

      const leads = await client.query(
        `select count(*)::text as n from leads where email = $1`,
        ["jane.smith.fpm.ingest.test@example.com"],
      );
      expect(Number(leads.rows[0].n)).toBe(1);

      const ext = await client.query(
        `select lead_id from lead_external_ids where system = 'ghl' and external_id = $1`,
        ["test-ghl-contact-ingest-001"],
      );
      expect(ext.rows).toHaveLength(1);

      const ev1 = await client.query(
        `select action from sync_events where system = 'ghl' and external_id = $1 order by occurred_at asc`,
        ["test-ghl-contact-ingest-001"],
      );
      expect(ev1.rows[0]?.action).toBe("created");

      await ingestGhlContactPayload(client, raw);
      const leads2 = await client.query(
        `select count(*)::text as n from leads where email = $1`,
        ["jane.smith.fpm.ingest.test@example.com"],
      );
      expect(Number(leads2.rows[0].n)).toBe(1);

      const ev2 = await client.query(
        `select action from sync_events where system = 'ghl' and external_id = $1 order by occurred_at desc limit 1`,
        ["test-ghl-contact-ingest-001"],
      );
      expect(ev2.rows[0]?.action).toBe("updated");

      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
