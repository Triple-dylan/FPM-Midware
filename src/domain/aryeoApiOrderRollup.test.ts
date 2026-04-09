import { describe, expect, it } from "vitest";
import { applyRollupFromAryeoOrderResourcesToFlat } from "./aryeoApiOrderRollup.js";

describe("applyRollupFromAryeoOrderResourcesToFlat", () => {
  it("counts orders when object is omitted but row looks like an order", () => {
    const flat: Record<string, string | null> = {};
    applyRollupFromAryeoOrderResourcesToFlat(flat, [
      {
        created_at: "2025-06-01T12:00:00.000Z",
        total_amount: 10000,
        order_status: "OPEN",
        fulfillment_status: "FULFILLED",
        currency: "USD",
      },
    ]);
    expect(flat.lifetime_value).toMatch(/\$/);
    expect(flat.average_order_value).toMatch(/\$/);
  });

  it("parses string total_amount", () => {
    const flat: Record<string, string | null> = {};
    applyRollupFromAryeoOrderResourcesToFlat(flat, [
      {
        object: "ORDER",
        total_amount: "25000",
        order_status: "OPEN",
        fulfillment_status: "FULFILLED",
        currency: "USD",
      },
    ]);
    expect(flat.lifetime_value).toMatch(/\$/);
  });

  it("reads camelCase Aryeo REST order fields", () => {
    const flat: Record<string, string | null> = {};
    applyRollupFromAryeoOrderResourcesToFlat(flat, [
      {
        totalAmount: 50000,
        orderStatus: "OPEN",
        fulfillmentStatus: "FULFILLED",
        currency: "USD",
        createdAt: "2025-03-15T10:00:00.000Z",
      },
    ]);
    expect(flat.last_order_placed).toBe("2025-03-15");
    expect(flat.lifetime_value).toMatch(/\$/);
  });

  it("fills 1st/2nd shoot appointment dates from earliest scheduled appointment per order (oldest order first)", () => {
    const flat: Record<string, string | null> = {};
    applyRollupFromAryeoOrderResourcesToFlat(flat, [
      {
        object: "ORDER",
        created_at: "2025-01-01T00:00:00.000Z",
        order_status: "OPEN",
        fulfillment_status: "FULFILLED",
        total_amount: 10000,
        currency: "USD",
        appointments: [{ status: "SCHEDULED", starts_at: "2025-02-10T15:00:00.000Z" }],
      },
      {
        object: "ORDER",
        created_at: "2025-06-01T00:00:00.000Z",
        order_status: "OPEN",
        fulfillment_status: "FULFILLED",
        total_amount: 10000,
        currency: "USD",
        appointments: [{ status: "SCHEDULED", starts_at: "2025-07-01T12:00:00.000Z" }],
      },
    ]);
    expect(flat["1st_shoot_appointment_date"]).toBe("2025-02-10");
    expect(flat["2nd_shoot_appointment_date"]).toBe("2025-07-01");
  });

  it("does not use canceled-only appointments when root order has no other shoot dates", () => {
    const flat: Record<string, string | null> = {};
    applyRollupFromAryeoOrderResourcesToFlat(flat, [
      {
        object: "ORDER",
        created_at: "2025-01-01T00:00:00.000Z",
        order_status: "OPEN",
        fulfillment_status: "FULFILLED",
        total_amount: 10000,
        currency: "USD",
        appointments: [{ status: "CANCELED", starts_at: "2025-02-10T15:00:00.000Z" }],
      },
    ]);
    expect(flat["1st_shoot_appointment_date"]).toBeUndefined();
  });
});
