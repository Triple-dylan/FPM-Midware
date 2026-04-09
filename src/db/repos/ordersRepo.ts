import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

export type OrderSummaryRow = {
  id: string;
  aryeo_order_id: string;
  lead_id: string | null;
  aryeo_identifier: string | null;
  title: string | null;
  order_status: string | null;
  fulfillment_status: string | null;
  payment_status: string | null;
  currency: string | null;
};

export type OrderOutboundContext = OrderSummaryRow & {
  total_amount: number | null;
  raw_payload: unknown;
};

/** Latest order row for a lead (by `created_at`, then `updated_at`, then `aryeo_order_id`) — rolling GHL fields. */
export type LeadLatestOrderForOutbound = {
  created_at: Date | null;
  total_amount: number | null;
  currency: string | null;
  aryeo_identifier: string | null;
  title: string | null;
};

export async function fetchLeadLatestOrderForOutbound(
  db: Db,
  leadId: string,
): Promise<LeadLatestOrderForOutbound | null> {
  const r = await db.query<{
    created_at: Date | null;
    total_amount: number | null;
    currency: string | null;
    aryeo_identifier: string | null;
    title: string | null;
  }>(
    `select created_at, total_amount, currency, aryeo_identifier, title
     from orders
     where lead_id = $1::uuid
     order by created_at desc nulls last, updated_at desc nulls last, aryeo_order_id desc
     limit 1`,
    [leadId],
  );
  return r.rows[0] ?? null;
}

/** Sum LTV / AOV per GHL: orders with status Open + fulfillment Fulfilled (any payment status). */
export type LeadOpenFulfilledRollup = {
  ltv_cents: number;
  qualifying_order_count: number;
  currency: string;
};

export async function fetchLeadOpenFulfilledRollup(
  db: Db,
  leadId: string,
): Promise<LeadOpenFulfilledRollup | null> {
  const r = await db.query<{
    ltv_cents: string;
    qualifying_order_count: string;
    currency: string | null;
  }>(
    `select coalesce(sum(total_amount), 0)::text as ltv_cents,
            count(*)::text as qualifying_order_count,
            max(currency) as currency
     from orders
     where lead_id = $1::uuid
       and lower(trim(coalesce(order_status, ''))) = 'open'
       and lower(trim(coalesce(fulfillment_status, ''))) = 'fulfilled'`,
    [leadId],
  );
  const row = r.rows[0];
  if (!row) return null;
  const n = Number(row.qualifying_order_count);
  if (!n || n === 0) return null;
  return {
    ltv_cents: Number(row.ltv_cents),
    qualifying_order_count: n,
    currency: row.currency?.trim() || "USD",
  };
}

export async function fetchOrderRawPayloadsForLead(db: Db, leadId: string): Promise<unknown[]> {
  const r = await db.query<{ raw_payload: unknown }>(
    `select raw_payload from orders where lead_id = $1::uuid`,
    [leadId],
  );
  return r.rows.map((x) => x.raw_payload);
}

/** Same payloads as stored orders, oldest first — for 1st/2nd/3rd shoot (one date per distinct order). */
export async function fetchOrderRawPayloadsForLeadOrderByCreatedAtAsc(
  db: Db,
  leadId: string,
): Promise<unknown[]> {
  const r = await db.query<{ raw_payload: unknown }>(
    `select raw_payload from orders
     where lead_id = $1::uuid
     order by created_at asc nulls last, aryeo_order_id asc`,
    [leadId],
  );
  return r.rows.map((x) => x.raw_payload);
}

/** Placeholder row when a lead has no orders but GHL still needs rollup-only field resolution. */
export function stubOrderOutboundContextForGhl(leadId: string): OrderOutboundContext {
  const z = "00000000-0000-4000-8000-000000000000";
  return {
    id: z,
    aryeo_order_id: z,
    lead_id: leadId,
    aryeo_identifier: null,
    title: null,
    order_status: null,
    fulfillment_status: null,
    payment_status: null,
    currency: "USD",
    total_amount: null,
    raw_payload: {},
  };
}

/** Internal `orders.id` for the newest row for this lead (same ordering as `fetchLeadLatestOrderForOutbound`). */
export async function fetchLatestOrderInternalIdForLead(
  db: Db,
  leadId: string,
): Promise<string | null> {
  const r = await db.query<{ id: string }>(
    `select id::text as id
     from orders
     where lead_id = $1::uuid
     order by created_at desc nulls last, updated_at desc nulls last, aryeo_order_id desc
     limit 1`,
    [leadId],
  );
  return r.rows[0]?.id ?? null;
}

export async function fetchOrderSummaryById(
  db: Db,
  internalId: string,
): Promise<OrderSummaryRow | null> {
  const r = await db.query<OrderSummaryRow>(
    `select id, aryeo_order_id, lead_id, aryeo_identifier, title,
            order_status, fulfillment_status, payment_status, currency
     from orders where id = $1::uuid`,
    [internalId],
  );
  return r.rows[0] ?? null;
}

export async function fetchOrderOutboundContext(
  db: Db,
  internalId: string,
): Promise<OrderOutboundContext | null> {
  const r = await db.query<OrderOutboundContext>(
    `select id, aryeo_order_id, lead_id, aryeo_identifier, title,
            order_status, fulfillment_status, payment_status, currency,
            total_amount, raw_payload
     from orders where id = $1::uuid`,
    [internalId],
  );
  return r.rows[0] ?? null;
}

export async function upsertAryeoOrder(
  client: PoolClient,
  row: {
    aryeoOrderId: string;
    leadId: string | null;
    aryeoIdentifier: string | null;
    title: string | null;
    orderStatus: string | null;
    fulfillmentStatus: string | null;
    paymentStatus: string | null;
    totalAmount: number | null;
    balanceAmount: number | null;
    totalTaxAmount: number | null;
    totalDiscountAmount: number | null;
    currency: string;
    propertyAddress: unknown;
    internalNotes: string | null;
    tags: string[];
    fulfilledAt: Date | null;
    createdAt: Date | null;
    updatedAt: Date | null;
    rawPayload: unknown;
  },
): Promise<string> {
  const r = await client.query<{ id: string }>(
    `insert into orders (
       aryeo_order_id, lead_id, aryeo_identifier, title,
       order_status, fulfillment_status, payment_status,
       total_amount, balance_amount, total_tax_amount, total_discount_amount, currency,
       property_address, internal_notes, tags,
       fulfilled_at, created_at, updated_at, raw_payload
     ) values (
       $1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19::jsonb
     )
     on conflict (aryeo_order_id) do update set
       lead_id = coalesce(excluded.lead_id, orders.lead_id),
       aryeo_identifier = coalesce(excluded.aryeo_identifier, orders.aryeo_identifier),
       title = coalesce(excluded.title, orders.title),
       order_status = coalesce(excluded.order_status, orders.order_status),
       fulfillment_status = coalesce(excluded.fulfillment_status, orders.fulfillment_status),
       payment_status = coalesce(excluded.payment_status, orders.payment_status),
       total_amount = coalesce(excluded.total_amount, orders.total_amount),
       balance_amount = coalesce(excluded.balance_amount, orders.balance_amount),
       total_tax_amount = coalesce(excluded.total_tax_amount, orders.total_tax_amount),
       total_discount_amount = coalesce(excluded.total_discount_amount, orders.total_discount_amount),
       currency = excluded.currency,
       property_address = coalesce(excluded.property_address, orders.property_address),
       internal_notes = coalesce(excluded.internal_notes, orders.internal_notes),
       tags = coalesce(excluded.tags, orders.tags),
       fulfilled_at = coalesce(excluded.fulfilled_at, orders.fulfilled_at),
       created_at = coalesce(orders.created_at, excluded.created_at),
       updated_at = coalesce(excluded.updated_at, orders.updated_at),
       raw_payload = excluded.raw_payload,
       synced_at = now()
     returning id`,
    [
      row.aryeoOrderId,
      row.leadId,
      row.aryeoIdentifier,
      row.title,
      row.orderStatus,
      row.fulfillmentStatus,
      row.paymentStatus,
      row.totalAmount,
      row.balanceAmount,
      row.totalTaxAmount,
      row.totalDiscountAmount,
      row.currency,
      row.propertyAddress ?? null,
      row.internalNotes,
      row.tags,
      row.fulfilledAt,
      row.createdAt,
      row.updatedAt,
      row.rawPayload ?? null,
    ],
  );
  return r.rows[0].id;
}

export async function replaceOrderItems(
  client: PoolClient,
  orderUuid: string,
  items: Array<{
    aryeoItemId: string;
    title: string | null;
    purchasableType: string | null;
    unitPriceAmount: number | null;
    quantity: number | null;
    grossTotalAmount: number | null;
    isCanceled: boolean;
    isServiceable: boolean | null;
  }>,
): Promise<void> {
  await client.query(`delete from order_items where order_id = $1::uuid`, [orderUuid]);
  for (const it of items) {
    await client.query(
      `insert into order_items (
         aryeo_item_id, order_id, title, purchasable_type,
         unit_price_amount, quantity, gross_total_amount,
         is_canceled, is_serviceable
       ) values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9)
       on conflict (aryeo_item_id) do update set
         order_id = excluded.order_id,
         title = excluded.title,
         purchasable_type = excluded.purchasable_type,
         unit_price_amount = excluded.unit_price_amount,
         quantity = excluded.quantity,
         gross_total_amount = excluded.gross_total_amount,
         is_canceled = excluded.is_canceled,
         is_serviceable = excluded.is_serviceable`,
      [
        it.aryeoItemId,
        orderUuid,
        it.title,
        it.purchasableType,
        it.unitPriceAmount,
        it.quantity,
        it.grossTotalAmount,
        it.isCanceled,
        it.isServiceable,
      ],
    );
  }
}
