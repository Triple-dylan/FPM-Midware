import { describe, expect, it } from "vitest";
import {
  buildRegistryColumnValues,
  getAllRegistryMapKeysSorted,
} from "./pilotExportColumns.js";
import { resetGhlRegistryCache } from "../config/ghlRegistry.js";

describe("pilotExportColumns", () => {
  it("includes all map keys and fills empty for unknown API fields", () => {
    resetGhlRegistryCache();
    const keys = getAllRegistryMapKeysSorted();
    expect(keys.length).toBeGreaterThan(10);
    expect(keys).toContain("email");
    expect(keys).toContain("last_order_placed");

    const flat = {
      first_name: "Jane",
      last_name: "Doe",
      email: "j@e.com",
      phone: "+12065550100",
      phone_raw: "2065550100",
      company_name: "Acme",
      business_name: "Acme",
      license_number: null,
      website: null,
      timezone: "America/Los_Angeles",
      notes: null,
      type: "Customer",
      aryeo_customer_id: "uuid",
      aryeo_customer_type: "AGENT",
    };

    const vals = buildRegistryColumnValues(
      keys,
      flat,
      "uuid",
      "https://app.aryeo.com/customers/{{id}}",
    );

    expect(vals.email).toBe("j@e.com");
    expect(vals.last_order_placed).toBe("");
    expect(vals.aryeo_customer_profile_link).toContain("uuid");
  });
});
