import type { PoolClient } from "pg";
import { replaceCurrentGhlAssignment } from "../db/repos/assignmentsRepo.js";
import { insertDedupCandidate } from "../db/repos/dedupRepo.js";
import {
  findLeadIdByExternalId,
  upsertLeadExternalId,
} from "../db/repos/externalIdsRepo.js";
import {
  findLeadIdsByEmail,
  findLeadIdsByNameCompany,
  findLeadIdsByPhone,
  type GhlLeadInsert,
  insertLeadFromGhl,
  setLeadDnd,
  softDeleteLead,
  updateLeadFullGhl,
} from "../db/repos/leadsRepo.js";
import { insertSyncEvent } from "../db/repos/syncEventsRepo.js";
import {
  normalizeCompanyName,
  normalizeEmail,
  normalizePersonNamePart,
  normalizePhoneE164,
  parseIsoDateOnly,
  parseTimestamptz,
} from "../lib/normalize.js";

const SYSTEM = "ghl";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function str(x: unknown): string | null {
  return typeof x === "string" ? x : null;
}

function bool(x: unknown): boolean | null {
  return typeof x === "boolean" ? x : null;
}

function strArr(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.filter((v): v is string => typeof v === "string");
}

export function ghlPayloadToLeadRow(p: Record<string, unknown>): GhlLeadInsert {
  const phoneRaw = str(p.phone);
  const emailNorm = normalizeEmail(str(p.email));
  const company =
    normalizeCompanyName(str(p.companyName)) ??
    normalizeCompanyName(str(p.businessName));
  const phoneE164 = normalizePhoneE164(phoneRaw);

  return {
    first_name: normalizePersonNamePart(str(p.firstName)),
    last_name: normalizePersonNamePart(str(p.lastName)),
    email: emailNorm,
    phone: phoneE164,
    phone_raw: phoneRaw,
    company_name: company,
    address_line1: normalizePersonNamePart(str(p.address1)),
    city: normalizePersonNamePart(str(p.city)),
    state: normalizePersonNamePart(str(p.state)),
    postal_code: normalizePersonNamePart(str(p.postalCode)),
    country: normalizePersonNamePart(str(p.country)),
    website: str(p.website)?.trim() || null,
    timezone: str(p.timezone)?.trim() || null,
    date_of_birth: parseIsoDateOnly(str(p.dateOfBirth)),
    source: str(p.source)?.trim() || null,
    tags: strArr(p.tags),
    dnd: bool(p.dnd) ?? false,
    created_at: parseTimestamptz(str(p.dateAdded)),
    updated_at: parseTimestamptz(str(p.dateUpdated)),
  };
}

async function resolveLeadIdForGhl(
  client: PoolClient,
  row: GhlLeadInsert,
  ghlContactId: string,
): Promise<{ leadId: string; matchReason: string | null }> {
  const existing = await findLeadIdByExternalId(client, SYSTEM, ghlContactId);
  if (existing) return { leadId: existing, matchReason: "ghl_external_id" };

  if (row.email) {
    const ids = await findLeadIdsByEmail(client, row.email);
    if (ids.length === 1) return { leadId: ids[0], matchReason: "email" };
  }

  if (row.phone) {
    const ids = await findLeadIdsByPhone(client, row.phone);
    if (ids.length === 1) return { leadId: ids[0], matchReason: "phone" };
  }

  const f = row.first_name ?? "";
  const l = row.last_name ?? "";
  const c = row.company_name ?? "";
  if (f.trim() && l.trim() && c.trim()) {
    const ids = await findLeadIdsByNameCompany(client, f, l, c);
    if (ids.length === 1) return { leadId: ids[0], matchReason: "name_company" };
    const newId = await insertLeadFromGhl(client, row);
    if (ids.length > 1) {
      for (const other of ids) {
        await insertDedupCandidate(client, newId, other, "name_company", "low");
      }
    }
    return { leadId: newId, matchReason: "created" };
  }

  const newId = await insertLeadFromGhl(client, row);
  return { leadId: newId, matchReason: "created" };
}

export async function ingestGhlContactPayload(
  client: PoolClient,
  raw: unknown,
): Promise<void> {
  if (!isRecord(raw)) {
    await insertSyncEvent(client, {
      system: SYSTEM,
      eventType: "unknown",
      externalId: null,
      leadId: null,
      action: "skipped",
      details: { reason: "payload_not_object" },
    });
    return;
  }

  const type = str(raw.type);
  const id = str(raw.id);
  if (!type || !id) {
    await insertSyncEvent(client, {
      system: SYSTEM,
      eventType: type ?? "unknown",
      externalId: id,
      leadId: null,
      action: "skipped",
      details: { reason: "missing_type_or_id" },
    });
    return;
  }

  if (type === "ContactDelete") {
    const leadId = await findLeadIdByExternalId(client, SYSTEM, id);
    if (!leadId) {
      await insertSyncEvent(client, {
        system: SYSTEM,
        eventType: type,
        externalId: id,
        leadId: null,
        action: "skipped",
        details: { reason: "no_lead_for_ghl_id" },
      });
      return;
    }
    await softDeleteLead(client, leadId);
    await insertSyncEvent(client, {
      system: SYSTEM,
      eventType: type,
      externalId: id,
      leadId,
      action: "updated",
      details: { is_deleted: true },
    });
    return;
  }

  if (type === "ContactDndUpdate") {
    const leadId = await findLeadIdByExternalId(client, SYSTEM, id);
    if (!leadId) {
      await insertSyncEvent(client, {
        system: SYSTEM,
        eventType: type,
        externalId: id,
        leadId: null,
        action: "skipped",
        details: { reason: "no_lead_for_ghl_id" },
      });
      return;
    }
    const dnd = bool(raw.dnd) ?? false;
    await setLeadDnd(client, leadId, dnd);
    await insertSyncEvent(client, {
      system: SYSTEM,
      eventType: type,
      externalId: id,
      leadId,
      action: "updated",
      details: { dnd },
    });
    return;
  }

  if (
    type !== "ContactCreate" &&
    type !== "ContactUpdate" &&
    type !== "ContactTagUpdate"
  ) {
    await insertSyncEvent(client, {
      system: SYSTEM,
      eventType: type,
      externalId: id,
      leadId: null,
      action: "skipped",
      details: { reason: "unsupported_type" },
    });
    return;
  }

  const row = ghlPayloadToLeadRow(raw);
  const meta = { locationId: str(raw.locationId) };

  const linked = await findLeadIdByExternalId(client, SYSTEM, id);
  let leadId: string;
  let action: string;
  let matchReason: string | null;

  if (linked) {
    leadId = linked;
    await updateLeadFullGhl(client, leadId, row);
    const c = await upsertLeadExternalId(client, leadId, SYSTEM, id, meta);
    if (c) {
      await insertSyncEvent(client, {
        system: SYSTEM,
        eventType: type,
        externalId: id,
        leadId,
        action: "error",
        details: {
          reason: "external_id_conflict",
          existingLeadId: c.existingLeadId,
        },
      });
      throw new Error(
        `ghl external id ${id} already mapped to a different lead`,
      );
    }
    action = "updated";
    matchReason = "ghl_external_id";
  } else {
    const resolved = await resolveLeadIdForGhl(client, row, id);
    leadId = resolved.leadId;
    matchReason = resolved.matchReason;
    if (matchReason === "created") {
      action = "created";
    } else {
      action = "matched";
    }
    const c = await upsertLeadExternalId(client, leadId, SYSTEM, id, meta);
    if (c) {
      await insertSyncEvent(client, {
        system: SYSTEM,
        eventType: type,
        externalId: id,
        leadId,
        action: "error",
        details: {
          reason: "external_id_conflict",
          existingLeadId: c.existingLeadId,
        },
      });
      throw new Error(
        `ghl external id ${id} already mapped to a different lead`,
      );
    }
    if (matchReason !== "created") {
      await updateLeadFullGhl(client, leadId, row);
    }
  }

  const assignedTo = str(raw.assignedTo);
  if (assignedTo) {
    await replaceCurrentGhlAssignment(client, leadId, assignedTo);
  }

  const customFields = raw.customFields;
  await insertSyncEvent(client, {
    system: SYSTEM,
    eventType: type,
    externalId: id,
    leadId,
    action,
    details: {
      match_reason: matchReason,
      customFields,
    },
  });
}
