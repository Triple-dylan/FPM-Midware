import { describe, expect, it } from "vitest";
import { ghlPayloadToLeadRow } from "./ghlIngest.js";

describe("ghlPayloadToLeadRow", () => {
  it("maps doc-shaped payload", () => {
    const row = ghlPayloadToLeadRow({
      firstName: "Jane",
      lastName: "Smith",
      email: "Jane@Example.com",
      phone: "+1 206-555-0100",
      companyName: "Acme",
      businessName: "Acme LLC",
      address1: "1 St",
      city: "Seattle",
      state: "WA",
      postalCode: "98101",
      country: "US",
      dateOfBirth: "1985-06-15T00:00:00.000Z",
      dnd: true,
      tags: ["a", "b"],
    } as Record<string, unknown>);
    expect(row.email).toBe("jane@example.com");
    expect(row.phone).toBe("+12065550100");
    expect(row.company_name).toBe("Acme");
    expect(row.date_of_birth).toBe("1985-06-15");
    expect(row.dnd).toBe(true);
    expect(row.tags).toEqual(["a", "b"]);
  });

  it("prefers companyName then businessName", () => {
    const a = ghlPayloadToLeadRow({ businessName: "LLC" } as Record<string, unknown>);
    expect(a.company_name).toBe("LLC");
    const b = ghlPayloadToLeadRow({
      companyName: "Co",
      businessName: "LLC",
    } as Record<string, unknown>);
    expect(b.company_name).toBe("Co");
  });
});
