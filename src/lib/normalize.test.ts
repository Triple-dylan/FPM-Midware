import { describe, expect, it } from "vitest";
import {
  mergeDistinctTags,
  normalizeEmail,
  normalizePhoneE164,
  normalizePhoneForGhl,
  resolvePhoneForGhl,
  splitFullName,
} from "./normalize.js";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Jane@EXAMPLE.com ")).toBe("jane@example.com");
  });
  it("returns null for empty", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});

describe("normalizePhoneE164", () => {
  it("normalizes US numbers", () => {
    expect(normalizePhoneE164("+1 206-555-0100")).toBe("+12065550100");
    expect(normalizePhoneE164("2065550100", "US")).toBe("+12065550100");
  });
  it("returns null for junk", () => {
    expect(normalizePhoneE164("")).toBeNull();
    expect(normalizePhoneE164("abc")).toBeNull();
  });
});

describe("normalizePhoneForGhl", () => {
  it("strips extensions and normalizes US", () => {
    expect(normalizePhoneForGhl("(713) 742-3086 ext 12")).toBe("+17137423086");
    expect(normalizePhoneForGhl("713.742.3086 x99")).toBe("+17137423086");
  });
  it("takes first number when multiple", () => {
    expect(normalizePhoneForGhl("7137423086; 2145550000")).toBe("+17137423086");
  });
  it("normalizes 10-digit US without +1", () => {
    expect(normalizePhoneForGhl("2065550100")).toBe("+12065550100");
  });
  it("resolvePhoneForGhl prefers flat.phone then raw", () => {
    expect(
      resolvePhoneForGhl({
        phone: "+12065550100",
        phone_raw: "garbage",
      }),
    ).toBe("+12065550100");
    expect(
      resolvePhoneForGhl({
        phone: null,
        phone_raw: "(214) 555-0199",
      }),
    ).toBe("+12145550199");
  });
});

describe("splitFullName", () => {
  it("splits on first space", () => {
    expect(splitFullName("Jane Smith")).toEqual({
      first: "Jane",
      last: "Smith",
    });
    expect(splitFullName("Mary Van Buren")).toEqual({
      first: "Mary",
      last: "Van Buren",
    });
  });
});

describe("mergeDistinctTags", () => {
  it("dedupes and sorts", () => {
    expect(mergeDistinctTags(["b", "a"], ["a", "c"])).toEqual(["a", "b", "c"]);
  });
});
