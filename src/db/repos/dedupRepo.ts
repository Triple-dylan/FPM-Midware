import type { PoolClient } from "pg";
import { orderedLeadPair } from "../../lib/dedup.js";

export async function insertDedupCandidate(
  client: PoolClient,
  a: string,
  b: string,
  matchReason: string,
  confidence: string,
): Promise<void> {
  const { leadIdA, leadIdB } = orderedLeadPair(a, b);
  await client.query(
    `insert into dedup_candidates (lead_id_a, lead_id_b, match_reason, confidence)
     values ($1, $2, $3, $4)
     on conflict (lead_id_a, lead_id_b) do update set
       match_reason = excluded.match_reason,
       confidence = excluded.confidence,
       resolved = false`,
    [leadIdA, leadIdB, matchReason, confidence],
  );
}
