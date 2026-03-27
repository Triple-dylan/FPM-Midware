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
