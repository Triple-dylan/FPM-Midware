import type pg from "pg";

type Db = pg.Pool | pg.PoolClient;

export type MonitorSyncEventRow = {
  id: string;
  system: string;
  event_type: string;
  external_id: string | null;
  lead_id: string | null;
  lead_email: string | null;
  action: string;
  occurred_at: string | null;
};

export type MonitorOrderRow = {
  id: string;
  aryeo_order_id: string;
  aryeo_identifier: string | null;
  order_status: string | null;
  fulfillment_status: string | null;
  lead_id: string | null;
  lead_email: string | null;
  synced_at: string | null;
};

function clampLimit(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(200, Math.floor(n));
}

export async function listRecentMonitorSyncEvents(db: Db, limit: number): Promise<MonitorSyncEventRow[]> {
  const lim = clampLimit(limit);
  const r = await db.query<{
    id: string;
    system: string;
    event_type: string;
    external_id: string | null;
    lead_id: string | null;
    lead_email: string | null;
    action: string;
    occurred_at: Date | null;
  }>(
    `select s.id::text as id, s.system, s.event_type, s.external_id, s.lead_id::text,
            l.email::text as lead_email, s.action, s.occurred_at
     from sync_events s
     left join leads l on l.id = s.lead_id
     order by s.occurred_at desc nulls last
     limit $1`,
    [lim],
  );
  return r.rows.map((row) => ({
    ...row,
    occurred_at: row.occurred_at ? row.occurred_at.toISOString() : null,
  }));
}

/** Recent order rows linked to a lead — watch `synced_at` as Aryeo webhooks land. */
export async function listRecentMonitorOrders(db: Db, limit: number): Promise<MonitorOrderRow[]> {
  const lim = clampLimit(limit);
  const r = await db.query<{
    id: string;
    aryeo_order_id: string;
    aryeo_identifier: string | null;
    order_status: string | null;
    fulfillment_status: string | null;
    lead_id: string | null;
    lead_email: string | null;
    synced_at: Date | null;
  }>(
    `select o.id::text as id, o.aryeo_order_id::text, o.aryeo_identifier, o.order_status, o.fulfillment_status,
            o.lead_id::text as lead_id, l.email::text as lead_email, o.synced_at
     from orders o
     left join leads l on l.id = o.lead_id
     where o.lead_id is not null
     order by o.synced_at desc nulls last, o.updated_at desc nulls last
     limit $1`,
    [lim],
  );
  return r.rows.map((row) => ({
    ...row,
    synced_at: row.synced_at ? row.synced_at.toISOString() : null,
  }));
}
