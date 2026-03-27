import type { OrderOutboundContext } from "../db/repos/ordersRepo.js";

function formatMoney(cents: number | null, currency: string | null): string | null {
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

/**
 * Values we can set from a **single** Aryeo order ingest (no cross-order aggregates yet).
 * Aggregate fields (LTV, AOV, shoot dates) stay null until those jobs exist.
 */
export function valueForOrderMapKey(
  mapKey: string,
  order: OrderOutboundContext,
  profileUrlTemplate: string,
): string | null {
  const customerId = extractAryeoCustomerIdFromOrderPayload(order.raw_payload);

  switch (mapKey) {
    case "last_order_placed":
      return (
        order.aryeo_identifier ??
        order.title ??
        order.aryeo_order_id ??
        null
      );
    case "last_order_amount":
      return formatMoney(order.total_amount, order.currency);
    case "aryeo_customer_profile_link":
      if (!customerId) return null;
      return formatAryeoCustomerProfileUrl(profileUrlTemplate, customerId);
    case "type":
      return "Customer";
    case "average_order_value":
    case "lifetime_value":
    case "last_shoot_date":
    case "1st_shoot_appointment_date":
    case "2nd_shoot_appointment_date":
    case "3rd_shoot_appointment_date":
    case "whale_":
      return null;
    default:
      return null;
  }
}
