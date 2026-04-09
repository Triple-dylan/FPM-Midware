import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

export async function findLeadIdByExternalId(
  db: Db,
  system: string,
  externalId: string,
): Promise<string | null> {
  const r = await db.query<{ lead_id: string }>(
    `select lead_id from lead_external_ids where system = $1 and external_id = $2`,
    [system, externalId],
  );
  return r.rows[0]?.lead_id ?? null;
}

export type ExternalIdConflict = {
  kind: "conflict";
  existingLeadId: string;
  requestedLeadId: string;
};

export async function upsertLeadExternalId(
  client: PoolClient,
  leadId: string,
  system: string,
  externalId: string,
  meta: unknown,
): Promise<ExternalIdConflict | null> {
  const existing = await client.query<{ lead_id: string }>(
    `select lead_id from lead_external_ids where system = $1 and external_id = $2`,
    [system, externalId],
  );
  if (existing.rows[0] && existing.rows[0].lead_id !== leadId) {
    return {
      kind: "conflict",
      existingLeadId: existing.rows[0].lead_id,
      requestedLeadId: leadId,
    };
  }
  await client.query(
    `insert into lead_external_ids (lead_id, system, external_id, meta)
     values ($1, $2, $3, $4::jsonb)
     on conflict (system, external_id) do update set
       lead_id = excluded.lead_id,
       meta = excluded.meta`,
    [leadId, system, externalId, JSON.stringify(meta ?? null)],
  );
  return null;
}

export async function getExternalIdForLead(
  db: Db,
  leadId: string,
  system: string,
): Promise<string | null> {
  const r = await db.query<{ external_id: string }>(
    `select external_id from lead_external_ids
     where lead_id = $1 and system = $2
     limit 1`,
    [leadId, system],
  );
  return r.rows[0]?.external_id ?? null;
}

export async function leadHasSystemLink(
  client: PoolClient,
  leadId: string,
  system: string,
): Promise<boolean> {
  const r = await client.query<{ ok: boolean }>(
    `select exists(
       select 1 from lead_external_ids where lead_id = $1 and system = $2
     ) as ok`,
    [leadId, system],
  );
  return Boolean(r.rows[0]?.ok);
}
