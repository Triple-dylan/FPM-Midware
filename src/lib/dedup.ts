/** Canonical ordering for `dedup_candidates (lead_id_a, lead_id_b)`. */
export function orderedLeadPair(a: string, b: string): { leadIdA: string; leadIdB: string } {
  return a < b ? { leadIdA: a, leadIdB: b } : { leadIdA: b, leadIdB: a };
}
