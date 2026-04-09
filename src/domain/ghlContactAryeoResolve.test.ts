import { describe, expect, it } from "vitest";
import { extractAryeoCustomerIdFromGhlContact } from "./ghlContactAryeoResolve.js";

describe("extractAryeoCustomerIdFromGhlContact", () => {
  it("finds uuid in profile URL on customFields", () => {
    const id = "019a31d5-f66d-703d-9883-1818e4935169";
    const c = {
      customFields: [
        { id: "x", value: `https://app.aryeo.com/customers/${id}` },
      ],
    };
    expect(extractAryeoCustomerIdFromGhlContact(c)).toBe(id);
  });
});
