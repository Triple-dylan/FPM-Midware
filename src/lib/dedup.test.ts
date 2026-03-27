import { describe, expect, it } from "vitest";
import { orderedLeadPair } from "./dedup.js";

describe("orderedLeadPair", () => {
  it("orders UUIDs lexically", () => {
    const x = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const y = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    expect(orderedLeadPair(y, x)).toEqual({ leadIdA: x, leadIdB: y });
  });
});
