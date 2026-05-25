/**
 * Find or create a GHL contact for a lead.
 * Dedup strategy: search by email first, then phone. If a match is found, link
 * the existing contact. If no match, create a new contact.
 * Always stores the result in lead_external_ids (system = 'ghl').
 */
import type pg from "pg";
import { getExternalIdForLead } from "../db/repos/externalIdsRepo.js";
import {
  ghlCreateContact,
  ghlSearchDuplicateContact,
} from "../integrations/ghlClient.js";
import type { AryeoToGhlOutboundOptions } from "./aryeoToGhlOutbound.js";

async function logSyncEvent(
  pool: pg.Pool,
  leadId: string,
  externalId: string | null,
  action: string,
  details: unknown,
): Promise<void> {
  await pool.query(
    `insert into sync_events (system, event_type, external_id, lead_id, action, details)
     values ('ghl', 'ghl_contact_auto_create', $1, $2, $3, $4::jsonb)`,
    [externalId, leadId, action, JSON.stringify(details ?? null)],
  );
}

async function storGhlLink(pool: pg.Pool, leadId: string, ghlContactId: string): Promise<void> {
  await pool.query(
    `insert into lead_external_ids (lead_id, system, external_id, meta)
     values ($1, 'ghl', $2, null)
     on conflict (system, external_id) do update set lead_id = excluded.lead_id`,
    [leadId, ghlContactId],
  );
}

export type FindOrCreateGhlContactResult =
  | { ok: true; ghlContactId: string; created: boolean }
  | { ok: false; reason: string };

/**
 * Ensure a GHL contact exists and is linked to this lead.
 * Safe to call repeatedly — returns immediately if the link already exists.
 */
export async function findOrCreateGhlContactForLead(
  pool: pg.Pool,
  opts: AryeoToGhlOutboundOptions,
  leadId: string,
): Promise<FindOrCreateGhlContactResult> {
  const token = opts.ghlAccessToken?.trim();
  const locationId = opts.ghlLocationId?.trim();
  if (!token || !locationId) {
    return { ok: false, reason: "ghl_not_configured" };
  }

  // Already linked — nothing to do
  const existing = await getExternalIdForLead(pool, leadId, "ghl");
  if (existing) {
    return { ok: true, ghlContactId: existing, created: false };
  }

  // Read the lead's contact info
  const r = await pool.query<{
    email: string | null;
    phone: string | null;
    first_name: string | null;
    last_name: string | null;
    company_name: string | null;
    timezone: string | null;
  }>(
    `select email, phone, first_name, last_name, company_name, timezone
     from leads where id = $1 and is_deleted = false`,
    [leadId],
  );
  const lead = r.rows[0];
  if (!lead) {
    return { ok: false, reason: "lead_not_found" };
  }

  // Search GHL for an existing contact by email/phone
  const searchResult = await ghlSearchDuplicateContact(token, {
    locationId,
    email: lead.email,
    phone: lead.phone,
  });

  if (searchResult.ok && searchResult.contactId) {
    await storGhlLink(pool, leadId, searchResult.contactId);
    await logSyncEvent(pool, leadId, searchResult.contactId, "linked", {
      reason: "matched_existing_ghl_contact",
    });
    return { ok: true, ghlContactId: searchResult.contactId, created: false };
  }

  if (!searchResult.ok) {
    await logSyncEvent(pool, leadId, null, "error", {
      reason: "ghl_search_failed",
      status: searchResult.status,
      body: searchResult.body.slice(0, 500),
    });
    // Non-fatal — fall through to create
  }

  // Create a new GHL contact
  const body: Record<string, unknown> = {
    locationId,
    firstName: lead.first_name ?? undefined,
    lastName: lead.last_name ?? undefined,
    email: lead.email ?? undefined,
    phone: lead.phone ?? undefined,
    companyName: lead.company_name ?? undefined,
    timezone: lead.timezone ?? undefined,
    tags: ["Aryeo-Customer"],
  };
  // Strip undefined/null so GHL doesn't complain
  for (const key of Object.keys(body)) {
    if (body[key] == null) delete body[key];
  }

  const createResult = await ghlCreateContact(token, body);
  if (!createResult.ok) {
    await logSyncEvent(pool, leadId, null, "error", {
      reason: "ghl_create_failed",
      status: createResult.status,
      body: createResult.body.slice(0, 500),
    });
    return { ok: false, reason: "ghl_create_failed" };
  }

  await storGhlLink(pool, leadId, createResult.contactId);
  await logSyncEvent(pool, leadId, createResult.contactId, "created", {
    reason: "new_aryeo_customer",
  });
  return { ok: true, ghlContactId: createResult.contactId, created: true };
}
