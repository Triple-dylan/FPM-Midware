/**
 * Verification harness: Aryeo-shaped JSON → flattened customer + order rollup → GHL PUT body
 * (standard keys + customFields with stable test ids). Run `npm test` before production deploys.
 */
import { describe, expect, it } from "vitest";
import { GHL_OUTBOUND_FALLBACK_MAP_KEYS } from "../db/repos/ghlFieldMapRepo.js";
import { applyRollupFromAryeoOrderResourcesToFlat } from "./aryeoApiOrderRollup.js";
import {
  buildGhlContactBodyFromAryeoGroup,
  flattenAryeoCustomerGroup,
  mergeCoreGhlIdentity,
} from "./aryeoGroupToGhlPayload.js";
import { normalizeFlexibleDateToYmd, normalizeWhalePicklistForGhl } from "./ghlMapValueFormat.js";

/** Mimics `resolveGhlOutboundCustomFieldId` when map rows have no explicit GHL uuid. */
async function resolveTestCustomFieldId(
  _mapKey: string,
  explicit: string | null,
): Promise<string | null> {
  return explicit?.trim() || null;
}

describe("Aryeo → GHL required-field mapping (verification)", () => {
  it("maps camelCase Aryeo REST customer + orders to GHL-standard keys and formatted custom fields", async () => {
    const customer = {
      id: "019a0000-0000-7000-8000-000000000099",
      type: "CUSTOMER",
      name: "Ignored When Owner Present",
      email: "VERIFIED@EXAMPLE.COM",
      phone: "(206) 555-0100",
      owner: {
        firstName: "Jordan",
        lastName: "River",
      },
      officeName: "Acme Realty",
      websiteUrl: "https://acme.example",
      timezone: "America/Los_Angeles",
      internalNotes: "<div>note</div>",
      customFields: {
        rre_number_of_annual_listings: "15",
        rre_average_listing_price: "850000",
      },
    };

    const orders = [
      {
        totalAmount: 50_000,
        orderStatus: "OPEN",
        fulfillmentStatus: "FULFILLED",
        currency: "USD",
        createdAt: "2026-02-10T18:30:00.000Z",
      },
    ];

    const flatBase = flattenAryeoCustomerGroup(customer);
    expect(flatBase).not.toBeNull();
    const flat = { ...flatBase! };
    applyRollupFromAryeoOrderResourcesToFlat(flat, orders);

    expect(flat.email).toBe("verified@example.com");
    expect(flat.first_name).toBe("Jordan");
    expect(flat.last_name).toBe("River");
    expect(flat.phone).toMatch(/^\+/);

    const fieldMapRows = GHL_OUTBOUND_FALLBACK_MAP_KEYS.map((map_key) => ({
      map_key,
      ghl_custom_field_id: `test-cf-${map_key}`,
      label: null,
    }));

    const body = await buildGhlContactBodyFromAryeoGroup({
      flat,
      customerUuid: flat.aryeo_customer_id!,
      profileUrlTemplate: "https://app.aryeo.com/customers/{{id}}",
      fieldMapRows,
      resolveCustomFieldId: resolveTestCustomFieldId,
      enrichmentNote: "verification run",
    });

    mergeCoreGhlIdentity(body, flat);

    expect(body.firstName).toBe("Jordan");
    expect(body.lastName).toBe("River");
    expect(body.email).toBe("verified@example.com");
    expect(typeof body.phone).toBe("string");
    expect(String(body.phone).length).toBeGreaterThan(5);

    const cf = body.customFields as Array<{ id: string; value: string }>;
    expect(Array.isArray(cf)).toBe(true);

    const byId = Object.fromEntries(cf.map((r) => [r.id, r.value]));

    expect(byId["test-cf-whale_"]).toBe("Yes");
    expect(byId["test-cf-last_order_placed"]).toBe(
      normalizeFlexibleDateToYmd("2026-02-10T18:30:00.000Z"),
    );
    expect(byId["test-cf-last_order_date"]).toBe(
      normalizeFlexibleDateToYmd("2026-02-10T18:30:00.000Z"),
    );
    expect(byId["test-cf-lifetime_value"]).toMatch(/^\$/);
    expect(byId["test-cf-average_order_value"]).toMatch(/^\$/);
    expect(byId["test-cf-last_order_amount"]).toMatch(/^\$/);
  });

  it("normalizes Whale picklist variants to GHL Yes/No", () => {
    expect(normalizeWhalePicklistForGhl("yes")).toBe("Yes");
    expect(normalizeWhalePicklistForGhl("NO")).toBe("No");
    expect(normalizeWhalePicklistForGhl("Yes")).toBe("Yes");
  });

  it("reads Whale from Aryeo custom_field_entries when there is no custom_fields map", () => {
    const customer = {
      id: "019a0000-0000-7000-8000-000000000088",
      type: "CUSTOMER",
      name: "CF Entry Customer",
      email: "cfentry@example.com",
      custom_field_entries: [{ slug: "whale", value: true }],
    };
    const flat = flattenAryeoCustomerGroup(customer);
    expect(flat?.whale_).toBe("Yes");
  });
});
