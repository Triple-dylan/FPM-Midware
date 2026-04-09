import { describe, expect, it } from "vitest";
import {
  applyWhaleToFlatForGhl,
  computeWhaleYesNo,
  extractLatestShootYmdFromOrderPayloads,
  parseAnnualListings,
  parseMoneyAmountToNumber,
} from "./ghlLeadRollup.js";
import {
  flattenAryeoCustomerGroup,
  leadNotesIndicateWhale,
  promoteAryeoWhaleToGhlMapKey,
  type AryeoGroupFlat,
} from "./aryeoGroupToGhlPayload.js";

describe("computeWhaleYesNo", () => {
  it("returns Yes when annual listings >= 12", () => {
    const f: AryeoGroupFlat = { rre_number_of_annual_listings: "15" };
    expect(computeWhaleYesNo(f)).toBe("Yes");
  });

  it("returns Yes when average listing price >= 1M", () => {
    const f: AryeoGroupFlat = { rre_average_listing_price: "$1,200,000" };
    expect(computeWhaleYesNo(f)).toBe("Yes");
  });

  it("returns No when below thresholds but RRE present", () => {
    const f: AryeoGroupFlat = {
      rre_number_of_annual_listings: "5",
      rre_average_listing_price: "400000",
    };
    expect(computeWhaleYesNo(f)).toBe("No");
  });

  it("returns null when no RRE signals", () => {
    expect(computeWhaleYesNo({})).toBeNull();
  });

  it("reads camelCase RRE keys on flat", () => {
    const f: AryeoGroupFlat = { rreNumberOfAnnualListings: "14" };
    expect(computeWhaleYesNo(f)).toBe("Yes");
    const g: AryeoGroupFlat = { rreAverageListingPrice: "2000000" };
    expect(computeWhaleYesNo(g)).toBe("Yes");
  });
});

describe("applyWhaleToFlatForGhl", () => {
  it("does not set whale_ when unknown (no Aryeo whale, no RRE)", () => {
    const f: AryeoGroupFlat = {};
    applyWhaleToFlatForGhl(f);
    expect(f.whale_).toBeUndefined();
  });

  it("sets Yes from 🐳 in notes without RRE", () => {
    const f: AryeoGroupFlat = { notes: "🐳 — enterprise" };
    applyWhaleToFlatForGhl(f);
    expect(f.whale_).toBe("Yes");
  });

  it("defaults whale_ to No when GHL_WHALE_DEFAULT_NO=1 (legacy picklist fill)", () => {
    const prev = process.env.GHL_WHALE_DEFAULT_NO;
    try {
      process.env.GHL_WHALE_DEFAULT_NO = "1";
      const f: AryeoGroupFlat = {};
      applyWhaleToFlatForGhl(f);
      expect(f.whale_).toBe("No");
    } finally {
      if (prev === undefined) {
        delete process.env.GHL_WHALE_DEFAULT_NO;
      } else {
        process.env.GHL_WHALE_DEFAULT_NO = prev;
      }
    }
  });

  it("keeps Aryeo whale and does not replace with RRE heuristics", () => {
    const f: AryeoGroupFlat = {
      whale_: "No",
      rre_number_of_annual_listings: "99",
    };
    applyWhaleToFlatForGhl(f);
    expect(f.whale_).toBe("No");
  });

});

describe("leadNotesIndicateWhale", () => {
  it("detects 🐳 in the leading notes (first ~500 chars)", () => {
    expect(leadNotesIndicateWhale("🐳 VIP")).toBe(true);
    expect(leadNotesIndicateWhale(`${"a".repeat(600)}🐳`)).toBe(false);
  });

  it("detects Whale as the first line label", () => {
    expect(leadNotesIndicateWhale("Whale\nSecond line")).toBe(true);
    expect(leadNotesIndicateWhale("Not a whale")).toBe(false);
  });
});

describe("flatten + whale from notes", () => {
  it("sets whale_ Yes from internal_notes with 🐳", () => {
    const f = flattenAryeoCustomerGroup({
      id: "019a0000-0000-7000-8000-000000000001",
      internal_notes: "🐳 Priority — see billing",
    });
    expect(f?.whale_).toBe("Yes");
  });
});

describe("promoteAryeoWhaleToGhlMapKey", () => {
  it("copies camelCase whale onto whale_", () => {
    const f: AryeoGroupFlat = { isWhale: "true" };
    promoteAryeoWhaleToGhlMapKey(f);
    expect(f.whale_).toBe("true");
  });
});

describe("parseAnnualListings / parseMoneyAmountToNumber", () => {
  it("parses listings with commas", () => {
    expect(parseAnnualListings("12")).toBe(12);
    expect(parseAnnualListings("1,200")).toBe(1200);
  });

  it("parses money", () => {
    expect(parseMoneyAmountToNumber("$1,000,000")).toBe(1_000_000);
  });
});

describe("extractLatestShootYmdFromOrderPayloads", () => {
  it("picks max date from service_date strings", () => {
    const ymd = extractLatestShootYmdFromOrderPayloads([
      { service_date: "2025-01-15T00:00:00.000Z" },
      { service_date: "2026-03-01T12:00:00.000Z" },
    ]);
    expect(ymd).toBe("2026-03-01");
  });
});
