import { describe, expect, it } from "vitest";
import {
  formatMapValueForGhl,
  normalizeFlexibleDateToYmd,
  normalizeMoneyDisplayForGhl,
} from "./ghlMapValueFormat.js";

describe("normalizeFlexibleDateToYmd", () => {
  it("keeps YYYY-MM-DD prefix", () => {
    expect(normalizeFlexibleDateToYmd("2026-03-15")).toBe("2026-03-15");
    expect(normalizeFlexibleDateToYmd("2026-03-15T14:00:00.000Z")).toBe("2026-03-15");
  });

  it("parses US slash dates", () => {
    expect(normalizeFlexibleDateToYmd("3/5/2026")).toBe("2026-03-05");
    expect(normalizeFlexibleDateToYmd("12/31/2025")).toBe("2025-12-31");
  });
});

describe("formatMapValueForGhl", () => {
  it("formats whale_ to title-case Yes/No", () => {
    expect(formatMapValueForGhl("whale_", "yes")).toBe("Yes");
    expect(formatMapValueForGhl("whale_", "NO")).toBe("No");
  });

  it("formats money map keys for plain numeric strings", () => {
    expect(formatMapValueForGhl("lifetime_value", "1234.5")).toMatch(/^\$/);
    expect(formatMapValueForGhl("lifetime_value", "$99.00")).toBe("$99.00");
  });

  it("normalizes last_order date strings", () => {
    expect(formatMapValueForGhl("last_order_placed", "2026-04-01T12:00:00.000Z")).toBe("2026-04-01");
  });
});

describe("normalizeMoneyDisplayForGhl", () => {
  it("leaves already-prefixed currency strings", () => {
    expect(normalizeMoneyDisplayForGhl("$1,234.56")).toBe("$1,234.56");
  });
});
