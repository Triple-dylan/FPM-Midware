import pg from "pg";

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl });
}

export async function checkDb(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("select 1");
  } finally {
    client.release();
  }
}
