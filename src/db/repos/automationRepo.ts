import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

export async function isAutomationEnabled(db: Db, id: string): Promise<boolean> {
  const r = await db.query<{ enabled: boolean }>(
    `select enabled from automation_toggles where id = $1`,
    [id],
  );
  return Boolean(r.rows[0]?.enabled);
}

export type AutomationToggleRow = {
  id: string;
  label: string;
  description: string | null;
  enabled: boolean;
  updated_at: Date;
};

export async function listAutomationToggles(db: Db): Promise<AutomationToggleRow[]> {
  const r = await db.query<AutomationToggleRow>(
    `select id, label, description, enabled, updated_at
     from automation_toggles
     order by id`,
  );
  return r.rows;
}

export async function setAutomationEnabled(
  db: Db,
  id: string,
  enabled: boolean,
): Promise<void> {
  await db.query(
    `update automation_toggles set enabled = $2, updated_at = now() where id = $1`,
    [id, enabled],
  );
}
