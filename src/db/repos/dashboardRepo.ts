import type pg from "pg";
import { listAutomationToggles } from "./automationRepo.js";

type Db = pg.Pool | pg.PoolClient;

// Aryeo customer IDs excluded from all commission/reporting queries.
// Group 1: test accounts
// Group 2: Empower Homes DFW (Dan Harker / Stephen Collins team) — not managed by Dylan Dahl
const EXCLUDED_CUSTOMER_IDS = [
  "0199a18d-c37d-73de-ac49-9d771842f6c1", // houstonteam@empowerhome.com — test account
  // Empower Homes DFW agents (no "Team Lead Empower Houston" note in pilot CSV):
  "408175cc-816e-4d46-8252-6901002a76ce", // Stephen Collins III — Dan Harker's team, 469 DFW
  "dea6b9a2-22c9-482c-8e78-aab04f616827", // Meredith Butler — 972 Dallas
  "0191fbc2-e6c8-70a4-be4f-6440ee89836b", // Dylan Palmer — 214 Dallas
  "01903230-e43f-7055-a059-2670df7e4965", // Kevin Foster — 214 Dallas
  "01903156-c818-7131-afaa-9287ae5478ba", // Andrew Burns — 214 Dallas
  "a1b4d443-17ba-435f-8137-2cac904782bb", // Emily Harris — 214 Dallas, referred by Stephen Collins
  "0190279b-8185-722b-9dcd-d9262068ace3", // Heather Schmitt — 903 East TX
  "01980f2a-d2ac-724e-9699-13007cef43d2", // Laurie Andres — no Houston team notes
  "42e4ebdd-094f-436f-baf1-882247247c71", // Peachy Choochan — New York timezone, no Houston ties
];

// Filters applied to all commission/order-value queries:
//   1. exclude known test-account Aryeo customer IDs
//   2. only include leads with commission_tracked = true
// $1 = EXCLUDED_CUSTOMER_IDS array
const commissionFilter = `
  and o.lead_id in (select id from leads where commission_tracked = true)
  and o.lead_id not in (
    select lead_id from lead_external_ids
    where system = 'aryeo_customer'
      and external_id = any($1::text[])
  )`;

export type OrderWindow = {
  orders_total: number;
  order_value_cents: number;
  commission_cents: number;
};

export type MonthlyBucket = {
  month: string;
  orders: number;
  value_cents: number;
};

export type TopCustomerRow = {
  name: string;
  email: string | null;
  orders: number;
  value_cents: number;
};

export type OrderStatusCounts = {
  open: number;
  confirmed: number;
  fulfilled: number;
  canceled: number;
  other: number;
};

export type LeadSummaryRow = {
  id: string;
  name: string;
  email: string | null;
  orders: number;
  value_cents: number;
  last_order_at: string | null;
  commission_tracked: boolean;
};

export type DashboardAutomationRow = {
  id: string;
  label: string;
  enabled: boolean;
};

export type DashboardMetrics = {
  sync_events_last_hour: number;
  orders_linked_synced_last_hour: number;
  automations_enabled: number;
  automations_total: number;
  leads_total: number;
  tracked_leads_count: number;
  orders_this_month: number;
  avg_order_value_cents: number;
  ytd_order_value_cents: number;
  /** All-time totals (backward compat + commission banner default). */
  orders_total: number;
  order_value_cents: number;
  commission_cents: number;
  windows: {
    all_time: OrderWindow;
    h24: OrderWindow;
    d7: OrderWindow;
    d30: OrderWindow;
    mo6: OrderWindow;
    yr1: OrderWindow;
  };
};

export type DashboardSnapshot = {
  metrics: DashboardMetrics;
  automations: DashboardAutomationRow[];
  monthly_trend: MonthlyBucket[];
  top_customers: TopCustomerRow[];
  order_status_counts: OrderStatusCounts;
  leads: LeadSummaryRow[];
};

function toWindow(count: string, value: string): OrderWindow {
  const order_value_cents = Number(value);
  return {
    orders_total: Number(count),
    order_value_cents,
    commission_cents: Math.round(order_value_cents * 0.04),
  };
}

export async function getDashboardSnapshot(db: Db): Promise<DashboardSnapshot> {
  const excl = EXCLUDED_CUSTOMER_IDS;

  const [ev, ord, toggles, windows, kpi, trend, topCustomers, statusRows, leadRows] =
    await Promise.all([
      db.query<{ n: string }>(
        `select count(*)::text as n from sync_events where occurred_at > now() - interval '1 hour'`,
      ),
      db.query<{ n: string }>(
        `select count(*)::text as n from orders where lead_id is not null and synced_at > now() - interval '1 hour'`,
      ),
      listAutomationToggles(db),

      // Commission windows (all-time + time buckets)
      db.query<{
        all_count: string; all_value: string;
        h24_count: string; h24_value: string;
        d7_count: string;  d7_value: string;
        d30_count: string; d30_value: string;
        mo6_count: string; mo6_value: string;
        yr1_count: string; yr1_value: string;
      }>(
        `select
           count(*)::text as all_count,
           coalesce(sum(o.total_amount), 0)::text as all_value,
           count(*) filter (where o.created_at > now() - interval '24 hours')::text as h24_count,
           coalesce(sum(o.total_amount) filter (where o.created_at > now() - interval '24 hours'), 0)::text as h24_value,
           count(*) filter (where o.created_at > now() - interval '7 days')::text as d7_count,
           coalesce(sum(o.total_amount) filter (where o.created_at > now() - interval '7 days'), 0)::text as d7_value,
           count(*) filter (where o.created_at > now() - interval '30 days')::text as d30_count,
           coalesce(sum(o.total_amount) filter (where o.created_at > now() - interval '30 days'), 0)::text as d30_value,
           count(*) filter (where o.created_at > now() - interval '6 months')::text as mo6_count,
           coalesce(sum(o.total_amount) filter (where o.created_at > now() - interval '6 months'), 0)::text as mo6_value,
           count(*) filter (where o.created_at > now() - interval '1 year')::text as yr1_count,
           coalesce(sum(o.total_amount) filter (where o.created_at > now() - interval '1 year'), 0)::text as yr1_value
         from orders o
         where o.lead_id is not null and o.order_status != 'CANCELED'${commissionFilter}`,
        [excl],
      ),

      // KPI tile metrics
      db.query<{
        leads_total: string;
        orders_this_month: string;
        avg_order_value: string;
        ytd_value: string;
      }>(
        `select
           (select count(*)::text from leads) as leads_total,
           count(*) filter (where o.created_at >= date_trunc('month', now()))::text as orders_this_month,
           coalesce(avg(o.total_amount), 0)::text as avg_order_value,
           coalesce(sum(o.total_amount) filter (where o.created_at >= date_trunc('year', now())), 0)::text as ytd_value
         from orders o
         where o.lead_id is not null and o.order_status != 'CANCELED'${commissionFilter}`,
        [excl],
      ),

      // Monthly revenue trend (last 13 months)
      db.query<{ month: Date; orders: string; value_cents: string }>(
        `select date_trunc('month', o.created_at) as month,
                count(*)::text as orders,
                coalesce(sum(o.total_amount), 0)::text as value_cents
         from orders o
         where o.lead_id is not null
           and o.order_status != 'CANCELED'
           and o.created_at is not null
           and o.created_at >= date_trunc('month', now()) - interval '12 months'${commissionFilter}
         group by 1 order by 1 asc`,
        [excl],
      ),

      // Top 10 customers by order value
      db.query<{ name: string; email: string | null; orders: string; value_cents: string }>(
        `select coalesce(nullif(trim(l.first_name || ' ' || l.last_name), ''), l.email, 'Unknown') as name,
                l.email,
                count(o.id)::text as orders,
                coalesce(sum(o.total_amount), 0)::text as value_cents
         from leads l
         join orders o on o.lead_id = l.id
         where o.order_status != 'CANCELED'
           and l.id not in (
             select lead_id from lead_external_ids
             where system = 'aryeo_customer' and external_id = any($1::text[])
           )
         group by l.id
         order by value_cents desc
         limit 10`,
        [excl],
      ),

      // Order status breakdown
      db.query<{ order_status: string | null; n: string }>(
        `select order_status, count(*)::text as n from orders where lead_id is not null group by 1`,
      ),

      // All leads summary
      db.query<{
        id: string;
        name: string;
        email: string | null;
        orders: string;
        value_cents: string;
        last_order_at: Date | null;
        commission_tracked: boolean;
      }>(
        `select l.id::text,
                coalesce(nullif(trim(l.first_name || ' ' || l.last_name), ''), l.email, 'Unknown') as name,
                l.email,
                l.commission_tracked,
                count(o.id)::text as orders,
                coalesce(sum(o.total_amount) filter (where o.order_status != 'CANCELED'), 0)::text as value_cents,
                max(o.created_at) filter (where o.order_status != 'CANCELED') as last_order_at
         from leads l
         left join orders o on o.lead_id = l.id
         where l.is_deleted = false
           and l.commission_tracked = true
           and l.id not in (
             select lead_id from lead_external_ids
             where system = 'aryeo_customer' and external_id = any($1::text[])
           )
         group by l.id
         order by value_cents desc`,
        [excl],
      ),
    ]);

  const automations_enabled = toggles.filter((t) => t.enabled).length;
  const automations: DashboardAutomationRow[] = toggles.map((t) => ({
    id: t.id,
    label: t.label,
    enabled: t.enabled,
  }));

  const wr = windows.rows[0];
  const allTime = toWindow(wr?.all_count ?? "0", wr?.all_value ?? "0");

  const kr = kpi.rows[0];

  const monthly_trend: MonthlyBucket[] = trend.rows.map((r) => ({
    month: r.month instanceof Date ? r.month.toISOString() : String(r.month),
    orders: Number(r.orders),
    value_cents: Number(r.value_cents),
  }));

  const top_customers: TopCustomerRow[] = topCustomers.rows.map((r) => ({
    name: r.name,
    email: r.email,
    orders: Number(r.orders),
    value_cents: Number(r.value_cents),
  }));

  const statusMap: Record<string, number> = {};
  for (const r of statusRows.rows) {
    statusMap[(r.order_status ?? "UNKNOWN").toUpperCase()] = Number(r.n);
  }
  const order_status_counts: OrderStatusCounts = {
    open: statusMap["OPEN"] ?? 0,
    confirmed: statusMap["CONFIRMED"] ?? 0,
    fulfilled: statusMap["FULFILLED"] ?? 0,
    canceled: statusMap["CANCELED"] ?? 0,
    other: Object.entries(statusMap)
      .filter(([k]) => !["OPEN", "CONFIRMED", "FULFILLED", "CANCELED"].includes(k))
      .reduce((s, [, v]) => s + v, 0),
  };

  const leads: LeadSummaryRow[] = leadRows.rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    orders: Number(r.orders),
    value_cents: Number(r.value_cents),
    last_order_at: r.last_order_at instanceof Date ? r.last_order_at.toISOString() : (r.last_order_at ?? null),
    commission_tracked: r.commission_tracked,
  }));

  return {
    metrics: {
      sync_events_last_hour: Number(ev.rows[0]?.n ?? 0),
      orders_linked_synced_last_hour: Number(ord.rows[0]?.n ?? 0),
      automations_enabled,
      automations_total: toggles.length,
      leads_total: Number(kr?.leads_total ?? 0),
      tracked_leads_count: leads.length,
      orders_this_month: Number(kr?.orders_this_month ?? 0),
      avg_order_value_cents: Math.round(Number(kr?.avg_order_value ?? 0)),
      ytd_order_value_cents: Number(kr?.ytd_value ?? 0),
      orders_total: allTime.orders_total,
      order_value_cents: allTime.order_value_cents,
      commission_cents: allTime.commission_cents,
      windows: {
        all_time: allTime,
        h24: toWindow(wr?.h24_count ?? "0", wr?.h24_value ?? "0"),
        d7:  toWindow(wr?.d7_count  ?? "0", wr?.d7_value  ?? "0"),
        d30: toWindow(wr?.d30_count ?? "0", wr?.d30_value ?? "0"),
        mo6: toWindow(wr?.mo6_count ?? "0", wr?.mo6_value ?? "0"),
        yr1: toWindow(wr?.yr1_count ?? "0", wr?.yr1_value ?? "0"),
      },
    },
    automations,
    monthly_trend,
    top_customers,
    order_status_counts,
    leads,
  };
}
