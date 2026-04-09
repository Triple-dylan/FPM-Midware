import type pg from "pg";
import { listAutomationToggles } from "./automationRepo.js";

type Db = pg.Pool | pg.PoolClient;

export type DashboardMetrics = {
  /** Rows in `sync_events` with occurred_at in the last 60 minutes. */
  sync_events_last_hour: number;
  /** Orders linked to a lead with `synced_at` in the last 60 minutes (webhook / ingest activity). */
  orders_linked_synced_last_hour: number;
  /** Enabled vs total pipeline toggles (see /admin). */
  automations_enabled: number;
  automations_total: number;
};

export type DashboardAutomationRow = {
  id: string;
  label: string;
  enabled: boolean;
};

export type DashboardSnapshot = {
  metrics: DashboardMetrics;
  automations: DashboardAutomationRow[];
};

export async function getDashboardSnapshot(db: Db): Promise<DashboardSnapshot> {
  const [ev, ord, toggles] = await Promise.all([
    db.query<{ n: string }>(
      `select count(*)::text as n from sync_events where occurred_at > now() - interval '1 hour'`,
    ),
    db.query<{ n: string }>(
      `select count(*)::text as n
       from orders
       where lead_id is not null
         and synced_at > now() - interval '1 hour'`,
    ),
    listAutomationToggles(db),
  ]);

  const automations_enabled = toggles.filter((t) => t.enabled).length;
  const automations: DashboardAutomationRow[] = toggles.map((t) => ({
    id: t.id,
    label: t.label,
    enabled: t.enabled,
  }));

  return {
    metrics: {
      sync_events_last_hour: Number(ev.rows[0]?.n ?? 0),
      orders_linked_synced_last_hour: Number(ord.rows[0]?.n ?? 0),
      automations_enabled,
      automations_total: toggles.length,
    },
    automations,
  };
}
