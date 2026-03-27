import { describe, expect, it } from "vitest";
import {
  mergeDistinctTags,
  normalizeEmail,
  normalizePhoneE164,
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
