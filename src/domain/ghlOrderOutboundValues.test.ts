import { describe, expect, it } from "vitest";
import {
  formatLastOrderDateYmd,
  valueForOrderMapKey,
} from "./ghlOrderOutboundValues.js";
import type { LeadLatestOrderForOutbound, OrderOutboundContext } from "../db/repos/ordersRepo.js";

function minimalOrder(over: Partial<OrderOutboundContext>): OrderOutboundContext {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    aryeo_order_id: "00000000-0000-4000-8000-000000000002",
    lead_id: "00000000-0000-4000-8000-000000000003",
    aryeo_identifier: "Order #1",
    title: "T",
    order_status: "OPEN",
    fulfillment_status: "UNFULFILLED",
    payment_status: "PAID",
    currency: "USD",
    total_amount: 10000,
    raw_payload: { customer: { id: "cust-1" } },
    ...over,
  };
}

describe("formatLastOrderDateYmd", () => {
  it("formats Date to YYYY-MM-DD (UTC)", () => {
    expect(formatLastOrderDateYmd(new Date("2026-04-06T15:30:00.000Z"))).toBe("2026-04-06");
  });
});

describe("valueForOrderMapKey rolling aggregates", () => {
  const latest: LeadLatestOrderForOutbound = {
    created_at: new Date("2026-05-01T12:00:00.000Z"),
    total_amount: 25000,
    currency: "USD",
    aryeo_identifier: "Order #99",
    title: "Latest",
  };

  const order = minimalOrder({ total_amount: 5000 });

  it("last_order_placed uses latest order date, not current row only", () => {
    expect(
      valueForOrderMapKey(
        "last_order_placed",
        { order, latestForLead: latest },
        "https://app.aryeo.com/customers/{{id}}",
      ),
    ).toBe("2026-05-01");
  });

  it("last_order_date matches last_order_placed", () => {
    const ctx = { order, latestForLead: latest };
    const tpl = "https://app.aryeo.com/customers/{{id}}";
    expect(valueForOrderMapKey("last_order_date", ctx, tpl)).toBe(
      valueForOrderMapKey("last_order_placed", ctx, tpl),
    );
  });

  it("last_order_amount uses latest row amount", () => {
    expect(
      valueForOrderMapKey(
        "last_order_amount",
        { order, latestForLead: latest },
        "https://app.aryeo.com/customers/{{id}}",
      ),
    ).toBe("$250.00");
  });

  it("lifetime_value and last_shoot_date use transactionRollup when provided", () => {
    const ctx = {
      order,
      latestForLead: latest,
      transactionRollup: {
        lifetime_value: "$1,000.00",
        average_order_value: "$250.00",
        last_shoot_date: "2026-02-01",
        whale: "Yes",
        "1st_shoot_appointment_date": "2026-01-05",
        "2nd_shoot_appointment_date": null,
        "3rd_shoot_appointment_date": null,
      },
    };
    const tpl = "https://app.aryeo.com/customers/{{id}}";
    expect(valueForOrderMapKey("lifetime_value", ctx, tpl)).toBe("$1,000.00");
    expect(valueForOrderMapKey("average_order_value", ctx, tpl)).toBe("$250.00");
    expect(valueForOrderMapKey("last_shoot_date", ctx, tpl)).toBe("2026-02-01");
    expect(valueForOrderMapKey("whale_", ctx, tpl)).toBe("Yes");
    expect(valueForOrderMapKey("1st_shoot_appointment_date", ctx, tpl)).toBe("2026-01-05");
  });
});
