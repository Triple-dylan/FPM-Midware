import type { AryeoGroupFlat } from "./aryeoGroupToGhlPayload.js";
import {
  applyFirstThreeShootAppointmentDatesToFlat,
  applyWhaleToFlatForGhl,
  collectShootDatesFromAryeoOrderRaw,
} from "./ghlLeadRollup.js";
import { aryeoPickNum, aryeoPickStr, aryeoPickStrAny } from "../lib/aryeoRestShape.js";
import { formatMoneyCentsForGhl, formatLastOrderDateYmd } from "./ghlOrderOutboundValues.js";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function parseTs(s: string | null | undefined): number {
  if (!s) return NaN;
  const t = Date.parse(s);
  return Number.isNaN(t) ? NaN : t;
}

/**
 * List/detail payloads may omit `object` or use camelCase (`totalAmount`, `createdAt`).
 */
function isAryeoOrderResource(o: unknown): o is Record<string, unknown> {
  if (!isRecord(o)) return false;
  const obj = aryeoPickStr(o, "object");
  if (obj) {
    return obj.toUpperCase() === "ORDER";
  }
  return (
    aryeoPickNum(o, "total_amount") != null ||
    aryeoPickStrAny(o, "order_status", "status") != null ||
    aryeoPickStr(o, "fulfillment_status") != null ||
    aryeoPickStr(o, "created_at") != null
  );
}

/**
 * Derive GHL transaction fields from raw Aryeo ORDER resources (REST list / include).
 * Mutates `flat` with `lifetime_value`, `average_order_value`, `last_shoot_date`, `last_order_placed`,
 * `last_order_date`, `last_order_amount`, and `whale_` when RRE data exists on flat.
 */
export function applyRollupFromAryeoOrderResourcesToFlat(
  flat: AryeoGroupFlat,
  orderResources: unknown[],
): void {
  const rows = orderResources.filter(isAryeoOrderResource);

  let ltvCents = 0;
  let qualCount = 0;
  let currency = "USD";

  for (const o of rows) {
    const os = aryeoPickStrAny(o, "order_status", "status");
    const fs = aryeoPickStr(o, "fulfillment_status");
    if (String(os ?? "").toLowerCase() !== "open") continue;
    if (String(fs ?? "").toLowerCase() !== "fulfilled") continue;
    const cents = aryeoPickNum(o, "total_amount");
    if (cents == null || !Number.isFinite(cents)) continue;
    ltvCents += cents;
    qualCount++;
    const cur = aryeoPickStr(o, "currency");
    if (cur) currency = cur;
  }

  if (qualCount === 0) {
    for (const o of rows) {
      const os = (aryeoPickStrAny(o, "order_status", "status") ?? "").toLowerCase();
      if (os === "canceled" || os === "cancelled") continue;
      const cents = aryeoPickNum(o, "total_amount");
      if (cents == null || !Number.isFinite(cents)) continue;
      ltvCents += cents;
      qualCount++;
      const cur = aryeoPickStr(o, "currency");
      if (cur) currency = cur;
    }
  }

  if (qualCount > 0) {
    flat.lifetime_value = formatMoneyCentsForGhl(ltvCents, currency) ?? flat.lifetime_value;
    const aov = Math.round(ltvCents / qualCount);
    flat.average_order_value = formatMoneyCentsForGhl(aov, currency) ?? flat.average_order_value;
  }

  let bestShoot: Date | null = null;
  let bestOrderTs = -Infinity;
  let latestForLastOrder: Record<string, unknown> | null = null;

  for (const o of rows) {
    const raw = o;
    for (const d of collectShootDatesFromAryeoOrderRaw(raw)) {
      if (!bestShoot || d.getTime() > bestShoot.getTime()) bestShoot = d;
    }
    const ca = parseTs(aryeoPickStr(o, "created_at"));
    if (!Number.isNaN(ca) && ca >= bestOrderTs) {
      bestOrderTs = ca;
      latestForLastOrder = o;
    }
  }

  if (bestShoot) {
    flat.last_shoot_date = bestShoot.toISOString().slice(0, 10);
  }

  if (latestForLastOrder) {
    const d = aryeoPickStr(latestForLastOrder, "created_at");
    const ymd = d ? formatLastOrderDateYmd(d) : null;
    if (ymd) {
      flat.last_order_placed = ymd;
      flat.last_order_date = ymd;
    }
    const cents = aryeoPickNum(latestForLastOrder, "total_amount");
    const cur = aryeoPickStr(latestForLastOrder, "currency") ?? currency;
    if (cents != null) {
      flat.last_order_amount = formatMoneyCentsForGhl(cents, cur);
    }
  }

  const sortedRows = [...rows].sort((a, b) => {
    const ta = parseTs(aryeoPickStr(a, "created_at"));
    const tb = parseTs(aryeoPickStr(b, "created_at"));
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return ta - tb;
  });
  applyFirstThreeShootAppointmentDatesToFlat(flat, sortedRows);

  applyWhaleToFlatForGhl(flat);
}
