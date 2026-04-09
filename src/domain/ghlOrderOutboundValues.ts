import type {
  LeadLatestOrderForOutbound,
  OrderOutboundContext,
} from "../db/repos/ordersRepo.js";

/** Formatted currency for GHL text / money custom fields (`total_amount` is cents). */
export function formatMoneyCentsForGhl(cents: number | null, currency: string | null): string | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(cents / 100);
  } catch {
    return String(cents / 100);
  }
}

export function extractAryeoCustomerIdFromOrderPayload(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const c = (raw as { customer?: { id?: string } }).customer;
  return typeof c?.id === "string" ? c.id : null;
}

/** Build deep link / profile URL for GHL custom field `aryeo_customer_profile_link`. */
export function formatAryeoCustomerProfileUrl(
  template: string,
  customerId: string,
): string {
  const t = template.trim();
  if (!t) return "";
  if (t.includes("{{id}}")) return t.replace(/\{\{\s*id\s*\}\}/g, customerId);
  if (t.endsWith("/")) return `${t}${customerId}`;
  return `${t}/${customerId}`;
}

/** ISO date (YYYY-MM-DD) for GHL date / text fields — rolling “last order” from DB. */
export function formatLastOrderDateYmd(d: Date | string | null | undefined): string | null {
  if (d == null) return null;
  const t = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(t.getTime())) return null;
  return t.toISOString().slice(0, 10);
}

/** LTV / AOV / last shoot / whale / 1–3 shoot dates from Postgres order payloads (order push path). */
export type LeadTransactionRollupForOutbound = {
  lifetime_value: string | null;
  average_order_value: string | null;
  last_shoot_date: string | null;
  whale: string | null;
  "1st_shoot_appointment_date": string | null;
  "2nd_shoot_appointment_date": string | null;
  "3rd_shoot_appointment_date": string | null;
};

/**
 * Context for mapping Aryeo order → GHL custom fields after ingest.
 * `latestForLead` is the **newest** order row for this lead in Postgres (rolling), so each
 * webhook updates last order date/amount even when the ingested event is not the chronologically latest file replay.
 * `transactionRollup` adds open+fulfilled LTV/AOV and last shoot date from all orders for the lead.
 */
export type OrderMapValueContext = {
  order: OrderOutboundContext;
  latestForLead: LeadLatestOrderForOutbound | null;
  transactionRollup?: LeadTransactionRollupForOutbound | null;
};

/**
 * Values pushed to GHL when `aryeo_push_order_summary_to_ghl` is enabled.
 * Last-order fields use **rolling** aggregates from `orders` for the lead (`latestForLead`).
 */
export function valueForOrderMapKey(
  mapKey: string,
  ctx: OrderMapValueContext,
  profileUrlTemplate: string,
): string | null {
  const { order, latestForLead, transactionRollup } = ctx;
  const customerId = extractAryeoCustomerIdFromOrderPayload(order.raw_payload);

  const amountCents = latestForLead?.total_amount ?? order.total_amount;
  const currency = latestForLead?.currency ?? order.currency;

  switch (mapKey) {
    case "last_order_placed":
    case "last_order_date":
      return formatLastOrderDateYmd(latestForLead?.created_at ?? null);
    case "last_order_amount":
      return formatMoneyCentsForGhl(amountCents, currency);
    case "aryeo_customer_profile_link":
      if (!customerId) return null;
      return formatAryeoCustomerProfileUrl(profileUrlTemplate, customerId);
    case "type":
      return "Customer";
    case "lifetime_value":
      return transactionRollup?.lifetime_value ?? null;
    case "average_order_value":
      return transactionRollup?.average_order_value ?? null;
    case "last_shoot_date":
      return transactionRollup?.last_shoot_date ?? null;
    case "whale_":
      return transactionRollup?.whale ?? null;
    case "1st_shoot_appointment_date":
      return transactionRollup?.["1st_shoot_appointment_date"] ?? null;
    case "2nd_shoot_appointment_date":
      return transactionRollup?.["2nd_shoot_appointment_date"] ?? null;
    case "3rd_shoot_appointment_date":
      return transactionRollup?.["3rd_shoot_appointment_date"] ?? null;
    default:
      return null;
  }
}
