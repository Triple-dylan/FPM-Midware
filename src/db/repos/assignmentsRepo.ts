import type { PoolClient } from "pg";

export async function replaceCurrentGhlAssignment(
  client: PoolClient,
  leadId: string,
  repId: string,
): Promise<void> {
  await client.query(
    `update lead_assignments set is_current = false
     where lead_id = $1 and is_current = true`,
    [leadId],
  );
  await client.query(
    `insert into lead_assignments (lead_id, rep_id, is_current)
     values ($1, $2, true)`,
    [leadId, repId],
  );
}
