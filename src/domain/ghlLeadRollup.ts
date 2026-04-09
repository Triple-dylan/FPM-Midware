import type { Pool, PoolClient } from "pg";
import {
  promoteAryeoWhaleToGhlMapKey,
  promoteWhaleFromNotesNearTop,
  type AryeoGroupFlat,
} from "./aryeoGroupToGhlPayload.js";

type Db = Pool | PoolClient;
import {
  fetchLeadOpenFulfilledRollup,
  fetchOrderRawPayloadsForLeadOrderByCreatedAtAsc,
} from "../db/repos/ordersRepo.js";
import { formatMoneyCentsForGhl, type LeadTransactionRollupForOutbound } from "./ghlOrderOutboundValues.js";
import { aryeoPickStr, aryeoPickStrAny } from "../lib/aryeoRestShape.js";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function parseIsoToDate(s: string): Date | null {
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return new Date(t);
}

/** Collect candidate shoot / appointment timestamps from one Aryeo ORDER `raw_payload`. */
export function collectShootDatesFromAryeoOrderRaw(raw: unknown): Date[] {
  const out: Date[] = [];
  if (!isRecord(raw)) return out;

  for (const k of [
    "service_date",
    "scheduled_service_at",
    "appointment_date",
    "shoot_date",
    "scheduled_at",
  ]) {
    const v = aryeoPickStr(raw, k);
    if (v) {
      const d = parseIsoToDate(v);
      if (d) out.push(d);
    }
  }

  const apps = raw.appointments;
  if (Array.isArray(apps)) {
    for (const a of apps) {
      if (!isRecord(a)) continue;
      for (const k of ["starts_at", "start_at", "scheduled_at", "service_date", "start_time"]) {
        const v = aryeoPickStr(a, k);
        if (v) {
          const d = parseIsoToDate(v);
          if (d) out.push(d);
        }
      }
    }
  }

  const shoots = raw.shoots;
  if (Array.isArray(shoots)) {
    for (const s of shoots) {
      if (!isRecord(s)) continue;
      for (const k of ["scheduled_at", "starts_at", "service_date", "date"]) {
        const v = aryeoPickStr(s, k);
        if (v) {
          const d = parseIsoToDate(v);
          if (d) out.push(d);
        }
      }
    }
  }

  return out;
}

/** Per GHL: use scheduled (or unlabeled) shoots/appointments; skip canceled/postponed when status is present. */
function rowCountsForScheduledShoot(r: Record<string, unknown>): boolean {
  const s = (aryeoPickStrAny(r, "status", "appointment_status", "state") ?? "").toLowerCase();
  if (!s) return true;
  if (s.includes("cancel")) return false;
  if (s.includes("postpon")) return false;
  if (s.includes("void")) return false;
  return true;
}

function collectDatesFromAppointmentOrShootRecord(r: Record<string, unknown>): Date[] {
  const out: Date[] = [];
  for (const k of ["starts_at", "start_at", "scheduled_at", "service_date", "start_time", "date"]) {
    const v = aryeoPickStr(r, k);
    if (v) {
      const d = parseIsoToDate(v);
      if (d) out.push(d);
    }
  }
  return out;
}

/**
 * Earliest calendar date (YYYY-MM-DD) for a **scheduled** shoot/appointment on one ORDER payload.
 * Uses `appointments` / `shoots` when present (status-filtered); otherwise falls back to root-level dates
 * (`collectShootDatesFromAryeoOrderRaw`).
 */
export function earliestScheduledShootYmdFromAryeoOrderRaw(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  const candidates: Date[] = [];

  const apps = raw.appointments;
  if (Array.isArray(apps)) {
    for (const a of apps) {
      if (!isRecord(a)) continue;
      if (!rowCountsForScheduledShoot(a)) continue;
      for (const d of collectDatesFromAppointmentOrShootRecord(a)) {
        candidates.push(d);
      }
    }
  }

  const shoots = raw.shoots;
  if (Array.isArray(shoots)) {
    for (const s of shoots) {
      if (!isRecord(s)) continue;
      if (!rowCountsForScheduledShoot(s)) continue;
      for (const d of collectDatesFromAppointmentOrShootRecord(s)) {
        candidates.push(d);
      }
    }
  }

  const hadNestedAppointmentLists =
    (Array.isArray(raw.appointments) && raw.appointments.length > 0) ||
    (Array.isArray(raw.shoots) && raw.shoots.length > 0);

  if (candidates.length === 0) {
    if (hadNestedAppointmentLists) {
      for (const k of [
        "service_date",
        "scheduled_service_at",
        "appointment_date",
        "shoot_date",
        "scheduled_at",
      ]) {
        const v = aryeoPickStr(raw, k);
        if (v) {
          const d = parseIsoToDate(v);
          if (d) candidates.push(d);
        }
      }
    } else {
      for (const d of collectShootDatesFromAryeoOrderRaw(raw)) {
        candidates.push(d);
      }
    }
  }

  if (candidates.length === 0) return null;
  const min = candidates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
  return min.toISOString().slice(0, 10);
}

/**
 * GHL 1st / 2nd / 3rd shoot appointment: **one date per order**, orders in chronological order (`created_at` asc).
 * Skips orders with no schedulable shoot date; 2nd/3rd must be from later orders (not the same order).
 */
export function firstThreeScheduledShootYmdsByOrderChronology(
  orderPayloadsOldestFirst: unknown[],
): [string | null, string | null, string | null] {
  const found: string[] = [];
  for (const raw of orderPayloadsOldestFirst) {
    if (found.length >= 3) break;
    const ymd = earliestScheduledShootYmdFromAryeoOrderRaw(raw);
    if (ymd) found.push(ymd);
  }
  return [found[0] ?? null, found[1] ?? null, found[2] ?? null];
}

/** Writes GHL map keys `1st_shoot_appointment_date` … `3rd_shoot_appointment_date` on the flat map. */
export function applyFirstThreeShootAppointmentDatesToFlat(
  flat: AryeoGroupFlat,
  orderPayloadsOldestFirst: unknown[],
): void {
  const [a, b, c] = firstThreeScheduledShootYmdsByOrderChronology(orderPayloadsOldestFirst);
  if (a) flat["1st_shoot_appointment_date"] = a;
  if (b) flat["2nd_shoot_appointment_date"] = b;
  if (c) flat["3rd_shoot_appointment_date"] = c;
}

export function extractLatestShootYmdFromOrderPayloads(payloads: unknown[]): string | null {
  let best: Date | null = null;
  for (const p of payloads) {
    for (const d of collectShootDatesFromAryeoOrderRaw(p)) {
      if (!best || d.getTime() > best.getTime()) best = d;
    }
  }
  if (!best) return null;
  return best.toISOString().slice(0, 10);
}

export function parseAnnualListings(raw: string | null | undefined): number | null {
  if (raw == null || !String(raw).trim()) return null;
  const n = Number(String(raw).replace(/,/g, "").trim());
  if (!Number.isFinite(n)) return null;
  return n;
}

/** Parse currency-ish strings e.g. `$1,000,000` or `1000000`. */
export function parseMoneyAmountToNumber(raw: string | null | undefined): number | null {
  if (raw == null || !String(raw).trim()) return null;
  const s = String(raw).replace(/[$,\s]/g, "").trim();
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

/** Aryeo / GHL may use snake_case or camelCase for the same RRE attributes. */
const RRE_LISTINGS_KEYS = [
  "rre_number_of_annual_listings",
  "rreNumberOfAnnualListings",
  "number_of_annual_listings",
  "annual_listings",
] as const;

const RRE_AVG_KEYS = [
  "rre_average_listing_price",
  "rreAverageListingPrice",
  "average_listing_price",
] as const;

function firstNonEmptyFlatValue(f: AryeoGroupFlat, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = f[k];
    if (v != null && String(v).trim() !== "") return String(v);
  }
  return null;
}

/**
 * GHL “Whale? 🐳”: 12+ annual listings OR average listing price ≥ $1M (from RRE fields when present).
 * Returns `null` only when **no** RRE-style values are found on the flat map.
 */
export function computeWhaleYesNo(f: AryeoGroupFlat): string | null {
  const listingsRaw = firstNonEmptyFlatValue(f, RRE_LISTINGS_KEYS);
  const avgRaw = firstNonEmptyFlatValue(f, RRE_AVG_KEYS);
  const listings = parseAnnualListings(listingsRaw ?? undefined);
  const avg = parseMoneyAmountToNumber(avgRaw ?? undefined);
  const hasSignal = listings != null || avg != null;
  if (!hasSignal) return null;
  if (listings != null && listings >= 12) return "Yes";
  if (avg != null && avg >= 1_000_000) return "Yes";
  return "No";
}

/**
 * Sets `flat.whale_` for GHL.
 * **Aryeo wins:** if the customer payload already has a whale field, it is promoted to `whale_` and left unchanged.
 * **RRE:** when annual listings / avg price exist on the flat map, applies 12+ listings or $1M+ avg → Yes, else No.
 * **Notes:** if `flat.notes` has a whale marker near the top (🐳 / 🐋 or “Whale” on the first line), `whale_` is set to **Yes** (see `promoteWhaleFromNotesNearTop`).
 * **Unknown (no Aryeo whale, no RRE values, no notes signal):** does **not** set `whale_` so we do not stamp everyone "No".
 *   Set `GHL_WHALE_DEFAULT_NO=1` to restore the old behavior (default No for unknown so GHL always gets a picklist value).
 */
export function applyWhaleToFlatForGhl(flat: AryeoGroupFlat): void {
  promoteAryeoWhaleToGhlMapKey(flat);
  promoteWhaleFromNotesNearTop(flat);
  if (flat.whale_ != null && String(flat.whale_).trim() !== "") {
    return;
  }
  const w = computeWhaleYesNo(flat);
  if (w != null) {
    flat.whale_ = w;
    return;
  }
  if (process.env.GHL_WHALE_DEFAULT_NO === "1") {
    flat.whale_ = "No";
  }
}

/**
 * Merge LTV, AOV, last shoot (from orders), and whale (Aryeo field or RRE-derived) for GHL contact mapping.
 */
export async function enrichAryeoFlatWithLeadMetrics(
  pool: Db,
  leadId: string,
  flat: AryeoGroupFlat,
): Promise<AryeoGroupFlat> {
  const rollup = await fetchLeadOpenFulfilledRollup(pool, leadId);
  const payloadsAsc = await fetchOrderRawPayloadsForLeadOrderByCreatedAtAsc(pool, leadId);
  const lastShoot = extractLatestShootYmdFromOrderPayloads(payloadsAsc);

  const out: AryeoGroupFlat = { ...flat };
  if (rollup && rollup.qualifying_order_count > 0) {
    const lv = formatMoneyCentsForGhl(rollup.ltv_cents, rollup.currency);
    const aovCents = Math.round(rollup.ltv_cents / rollup.qualifying_order_count);
    const av = formatMoneyCentsForGhl(aovCents, rollup.currency);
    if (lv) out.lifetime_value = lv;
    if (av) out.average_order_value = av;
  }
  if (lastShoot) {
    out.last_shoot_date = lastShoot;
  }
  applyFirstThreeShootAppointmentDatesToFlat(out, payloadsAsc);
  applyWhaleToFlatForGhl(out);
  return out;
}

/** Rollup for `valueForOrderMapKey` when pushing order-driven GHL fields after ingest. */
export async function buildLeadTransactionRollupForOutbound(
  pool: Db,
  leadId: string,
): Promise<LeadTransactionRollupForOutbound | null> {
  const rollup = await fetchLeadOpenFulfilledRollup(pool, leadId);
  const payloadsAsc = await fetchOrderRawPayloadsForLeadOrderByCreatedAtAsc(pool, leadId);
  const lastShoot = extractLatestShootYmdFromOrderPayloads(payloadsAsc);
  const [d1, d2, d3] = firstThreeScheduledShootYmdsByOrderChronology(payloadsAsc);

  let lifetime_value: string | null = null;
  let average_order_value: string | null = null;
  if (rollup && rollup.qualifying_order_count > 0) {
    lifetime_value = formatMoneyCentsForGhl(rollup.ltv_cents, rollup.currency);
    const aovCents = Math.round(rollup.ltv_cents / rollup.qualifying_order_count);
    average_order_value = formatMoneyCentsForGhl(aovCents, rollup.currency);
  }

  const hasSignal =
    !!lifetime_value ||
    !!average_order_value ||
    !!lastShoot ||
    !!d1 ||
    !!d2 ||
    !!d3;

  if (!hasSignal) {
    return null;
  }

  return {
    lifetime_value,
    average_order_value,
    last_shoot_date: lastShoot,
    whale: null,
    "1st_shoot_appointment_date": d1,
    "2nd_shoot_appointment_date": d2,
    "3rd_shoot_appointment_date": d3,
  };
}
