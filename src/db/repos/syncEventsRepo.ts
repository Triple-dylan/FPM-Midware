import type { PoolClient } from "pg";

export async function insertSyncEvent(
  client: PoolClient,
  row: {
    system: string;
    eventType: string;
    externalId: string | null;
    leadId: string | null;
    action: string;
    details: unknown;
  },
): Promise<void> {
  await client.query(
    `insert into sync_events (system, event_type, external_id, lead_id, action, details)
     values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      row.system,
      row.eventType,
      row.externalId,
      row.leadId,
      row.action,
      JSON.stringify(row.details ?? null),
    ],
  );
}
