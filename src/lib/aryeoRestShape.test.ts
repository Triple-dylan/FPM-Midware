import { describe, expect, it } from "vitest";
import { aryeoMergeCustomFields, aryeoPickNum, aryeoPickStr } from "./aryeoRestShape.js";

describe("aryeoRestShape", () => {
  it("reads camelCase when snake is absent", () => {
    const o = { totalAmount: 12345, createdAt: "2025-01-01T00:00:00.000Z" };
    expect(aryeoPickNum(o, "total_amount")).toBe(12345);
    expect(aryeoPickStr(o, "created_at")).toBe("2025-01-01T00:00:00.000Z");
  });

  it("aryeoMergeCustomFields flattens custom_field_entries (snake + camel) and overlays custom_fields", () => {
    expect(
      aryeoMergeCustomFields({
        custom_field_entries: [{ slug: "whale", value: true }],
      }),
    ).toEqual({ whale: "Yes" });

    expect(
      aryeoMergeCustomFields({
        customFieldEntries: [{ slug: "is_whale", value: false }],
      }),
    ).toEqual({ is_whale: "No" });

    const overlaid = aryeoMergeCustomFields({
      custom_field_entries: [{ slug: "whale", value: true }],
      custom_fields: { whale: "No" },
    });
    expect(overlaid).toEqual({ whale: "No" });
  });

  it("aryeoMergeCustomFields reads nested custom_field + value on entry", () => {
    expect(
      aryeoMergeCustomFields({
        custom_field_entries: [
          {
            custom_field: { slug: "whale_", id: "cf-1" },
            value: "1",
          },
        ],
      }),
    ).toEqual({ whale_: "1" });
  });
});
