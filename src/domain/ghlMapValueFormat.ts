/**
 * Normalize values for GHL contact fields — dates, money-like text, and picklists (e.g. Whale Yes/No).
 * Aryeo may send ISO datetimes, US dates, alternate casing for Yes/No, or raw numbers for money.
 */

const WHALE_MAP_KEY = "whale_";

/** Custom fields that should display as USD in GHL (matches registry / outbound rollups). */
const MONEY_MAP_KEYS = new Set([
  "lifetime_value",
  "average_order_value",
  "last_order_amount",
  "rre_average_listing_price",
]);

/** Map keys that should be coerced to calendar dates for GHL (text or DATE custom fields). */
export function isLikelyGhlDateMapKey(mapKey: string): boolean {
  const k = mapKey.toLowerCase();
  if (k === "date_of_birth") return true;
  if (k === "last_order_placed" || k === "last_order_date") return true;
  if (k.includes("shoot") && k.includes("date")) return true;
  if (k.includes("appointment") && (k.includes("date") || k.includes("shoot"))) return true;
  if (k.endsWith("_date")) return true;
  return false;
}

export function isGhlMoneyMapKey(mapKey: string): boolean {
  return MONEY_MAP_KEYS.has(mapKey);
}

/**
 * GHL single-select for Whale expects option labels **Yes** / **No** (title case).
 * Normalizes common Aryeo / spreadsheet variants.
 */
export function normalizeWhalePicklistForGhl(value: string): string {
  const t = value.trim();
  if (!t) return t;
  const lower = t.toLowerCase();
  if (lower === "yes" || lower === "y" || lower === "true" || lower === "1") return "Yes";
  if (lower === "no" || lower === "n" || lower === "false" || lower === "0") return "No";
  if (t === "Yes" || t === "No") return t;
  return t;
}

/**
 * Ensures money-like values sent to GHL use a consistent **$x,xxx.xx** display when possible.
 * Values already containing `$` are returned trimmed; unparsed strings are unchanged.
 */
export function normalizeMoneyDisplayForGhl(value: string): string {
  const t = value.trim();
  if (!t) return t;
  if (/^\s*\$/.test(t)) return t;
  const n = Number(t.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return t;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(n);
  } catch {
    return t;
  }
}

/**
 * Parse flexible date strings to `YYYY-MM-DD` (UTC date portion for ISO strings).
 * Returns `null` if parsing fails.
 */
export function normalizeFlexibleDateToYmd(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) {
    const [, y, mo, d] = ymd;
    return `${y}-${mo}-${d}`;
  }

  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const mo = us[1].padStart(2, "0");
    const day = us[2].padStart(2, "0");
    return `${us[3]}-${mo}-${day}`;
  }

  const parsed = Date.parse(s);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

/**
 * Apply per-field GHL formatting for outbound map keys (dates, Whale, money text).
 */
export function formatMapValueForGhl(mapKey: string, value: string): string {
  const t = value.trim();
  if (!t) return t;

  if (mapKey === WHALE_MAP_KEY || mapKey.toLowerCase() === "whale") {
    return normalizeWhalePicklistForGhl(t);
  }

  if (isGhlMoneyMapKey(mapKey)) {
    return normalizeMoneyDisplayForGhl(t);
  }

  if (!isLikelyGhlDateMapKey(mapKey)) return t;
  const y = normalizeFlexibleDateToYmd(t);
  return y ?? t;
}
