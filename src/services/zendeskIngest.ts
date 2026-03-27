import type { PoolClient } from "pg";
import {
  findLeadIdByExternalId,
  leadHasSystemLink,
  upsertLeadExternalId,
} from "../db/repos/externalIdsRepo.js";
import {
  findLeadIdsByEmail,
  findLeadIdsByNameCompany,
  findLeadIdsByPhone,
  getLeadCore,
  setLeadZendeskSnapshot,
} from "../db/repos/leadsRepo.js";
import { insertSyncEvent } from "../db/repos/syncEventsRepo.js";
import { upsertTicket } from "../db/repos/ticketsRepo.js";
import {
  mergeDistinctTags,
  normalizeEmail,
  normalizePhoneE164,
  parseTimestamptz,
  splitFullName,
} from "../lib/normalize.js";

const ZD_USER = "zendesk_support";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function str(x: unknown): string | null {
  return typeof x === "string" ? x : null;
}

function num(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

function strArr(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.filter((v): v is string => typeof v === "string");
}

export function isZendeskTicketEvent(envelope: Record<string, unknown>): boolean {
  const t = str(envelope.type) ?? "";
  if (t.includes("ticket")) return true;
  const sub = str(envelope.subject) ?? "";
  return sub.includes("/ticket:");
}

function mergeZendeskUserIntoLead(
  existing: NonNullable<Awaited<ReturnType<typeof getLeadCore>>>,
  zdName: string | null,
  zdEmail: string | null,
  zdPhoneRaw: string | null,
  zdPhoneE164: string | null,
  zdTimezone: string | null,
  zdNotes: string | null,
  zdTags: string[],
  zdCreated: Date | null,
  zdUpdated: Date | null,
  hasGhl: boolean,
) {
  const split = splitFullName(zdName);
  const zFirst = split.first;
  const zLast = split.last;

  let first = existing.first_name;
  let last = existing.last_name;
  let email = existing.email;
  let phone = existing.phone;
  let phone_raw = existing.phone_raw;
  let timezone = existing.timezone;
  let notes = existing.notes ?? "";
  let tags = [...(existing.tags ?? [])];

  if (hasGhl) {
    first = first ?? zFirst;
    last = last ?? zLast;
    email = email ?? normalizeEmail(zdEmail);
    phone = phone ?? zdPhoneE164;
    phone_raw = phone_raw ?? zdPhoneRaw;
    timezone = timezone ?? zdTimezone;
    if (zdNotes?.trim()) {
      notes =
        !notes.trim()
          ? zdNotes
          : `${notes}\n\n(zendesk) ${zdNotes}`;
    }
    tags = mergeDistinctTags(tags, zdTags);
  } else {
    first = zFirst ?? first;
    last = zLast ?? last;
    email = normalizeEmail(zdEmail) ?? email;
    phone = zdPhoneE164 ?? phone;
    phone_raw = zdPhoneRaw ?? phone_raw;
    timezone = zdTimezone ?? timezone;
    notes = zdNotes ?? notes;
    tags = zdTags.length ? zdTags : tags;
  }

  const created_at =
    hasGhl && existing.created_at
      ? existing.created_at
      : zdCreated ?? existing.created_at;

  return {
    first_name: first,
    last_name: last,
    email,
    phone,
    phone_raw,
    timezone,
    notes,
    tags,
    created_at,
    updated_at: zdUpdated ?? new Date(),
  };
}

async function resolveLeadForZendeskUser(
  client: PoolClient,
  zdUserId: string,
  emailNorm: string | null,
  phoneE164: string | null,
  firstName: string | null,
  lastName: string | null,
  company: string | null,
): Promise<string> {
  const byExt = await findLeadIdByExternalId(client, ZD_USER, zdUserId);
  if (byExt) return byExt;

  if (emailNorm) {
    const ids = await findLeadIdsByEmail(client, emailNorm);
    if (ids.length === 1) return ids[0];
  }
  if (phoneE164) {
    const ids = await findLeadIdsByPhone(client, phoneE164);
    if (ids.length === 1) return ids[0];
  }
  const f = firstName ?? "";
  const l = lastName ?? "";
  const c = company ?? "";
  if (f.trim() && l.trim() && c.trim()) {
    const ids = await findLeadIdsByNameCompany(client, f, l, c);
    if (ids.length === 1) return ids[0];
  }

  throw new Error(
    "cannot_create_lead_from_zendesk_user_only; link via GHL or seed lead first",
  );
}

export async function ingestZendeskUserFromDetail(
  client: PoolClient,
  detail: Record<string, unknown>,
  envelope: Record<string, unknown>,
): Promise<void> {
  const id = num(detail.id);
  if (id == null) {
    await insertSyncEvent(client, {
      system: "zendesk_support",
      eventType: str(envelope.type) ?? "unknown",
      externalId: null,
      leadId: null,
      action: "skipped",
      details: { reason: "missing_user_id" },
    });
    return;
  }

  const zdUserId = String(id);
  const name = str(detail.name);
  const emailNorm = normalizeEmail(str(detail.email));
  const phoneRaw = str(detail.phone);
  const phoneE164 = normalizePhoneE164(phoneRaw);
  const zdTimezone =
    str(detail.iana_time_zone)?.trim() ||
    str(detail.time_zone)?.trim() ||
    null;
  const zdNotes = str(detail.notes) ?? null;
  const zdTags = strArr(detail.tags);
  const zdCreated = parseTimestamptz(str(detail.created_at));
  const zdUpdated = parseTimestamptz(str(detail.updated_at));
  const nameParts = splitFullName(name);
  const zFirst = nameParts.first;
  const zLast = nameParts.last;

  let leadId: string;
  try {
    leadId = await resolveLeadForZendeskUser(
      client,
      zdUserId,
      emailNorm,
      phoneE164,
      zFirst,
      zLast,
      null,
    );
  } catch {
    await insertSyncEvent(client, {
      system: "zendesk_support",
      eventType: str(envelope.type) ?? "user",
      externalId: zdUserId,
      leadId: null,
      action: "skipped",
      details: {
        reason: "no_matching_lead_create_policy",
        hint: "Create GHL contact first or extend policy to insert leads from Zendesk",
      },
    });
    return;
  }

  const hasGhl = await leadHasSystemLink(client, leadId, "ghl");
  const existing = await getLeadCore(client, leadId);
  if (!existing) {
    await insertSyncEvent(client, {
      system: "zendesk_support",
      eventType: str(envelope.type) ?? "user",
      externalId: zdUserId,
      leadId,
      action: "error",
      details: { reason: "lead_row_missing" },
    });
    return;
  }

  const merged = mergeZendeskUserIntoLead(
    existing,
    name,
    emailNorm,
    phoneRaw,
    phoneE164,
    zdTimezone,
    zdNotes,
    zdTags,
    zdCreated,
    zdUpdated,
    hasGhl,
  );

  await setLeadZendeskSnapshot(client, leadId, merged);

  const meta = {
    organization_id: num(detail.organization_id),
    external_id: str(detail.external_id),
  };
  const conflict = await upsertLeadExternalId(
    client,
    leadId,
    ZD_USER,
    zdUserId,
    meta,
  );
  if (conflict) {
    await insertSyncEvent(client, {
      system: "zendesk_support",
      eventType: str(envelope.type) ?? "user",
      externalId: zdUserId,
      leadId,
      action: "error",
      details: {
        reason: "external_id_conflict",
        existingLeadId: conflict.existingLeadId,
      },
    });
    throw new Error(`zendesk user ${zdUserId} mapped to different lead`);
  }

  await insertSyncEvent(client, {
    system: "zendesk_support",
    eventType: str(envelope.type) ?? "user",
    externalId: zdUserId,
    leadId,
    action: "updated",
    details: { hasGhl },
  });
}

export async function ingestZendeskTicketFromDetail(
  client: PoolClient,
  detail: Record<string, unknown>,
  envelope: Record<string, unknown>,
): Promise<void> {
  const ticketId = num(detail.id);
  if (ticketId == null) {
    await insertSyncEvent(client, {
      system: "zendesk_support",
      eventType: str(envelope.type) ?? "unknown",
      externalId: null,
      leadId: null,
      action: "skipped",
      details: { reason: "missing_ticket_id" },
    });
    return;
  }

  const requesterId = num(detail.requester_id);
  let leadId: string | null = null;
  if (requesterId != null) {
    leadId = await findLeadIdByExternalId(
      client,
      ZD_USER,
      String(requesterId),
    );
  }

  const via = isRecord(detail.via) ? detail.via : null;
  const channel =
    via && str(via.channel) ? str(via.channel)! : str(detail.channel);

  await upsertTicket(client, {
    zendeskTicketId: ticketId,
    leadId,
    subject: str(detail.subject),
    description: str(detail.description),
    status: str(detail.status),
    priority: str(detail.priority),
    type: str(detail.type),
    channel: channel ?? null,
    assigneeId: num(detail.assignee_id),
    groupId: num(detail.group_id),
    organizationId: num(detail.organization_id),
    tags: strArr(detail.tags),
    createdAt: parseTimestamptz(str(detail.created_at)),
    updatedAt: parseTimestamptz(str(detail.updated_at)),
    rawPayload: envelope,
  });

  await insertSyncEvent(client, {
    system: "zendesk_support",
    eventType: str(envelope.type) ?? "ticket",
    externalId: String(ticketId),
    leadId,
    action: leadId ? "updated" : "skipped",
    details: {
      requester_id: requesterId,
      linkage: leadId ? "linked" : "no_zendesk_user_link",
    },
  });
}

export async function ingestZendeskWebhook(
  client: PoolClient,
  raw: unknown,
): Promise<void> {
  if (!isRecord(raw)) {
    await insertSyncEvent(client, {
      system: "zendesk_support",
      eventType: "unknown",
      externalId: null,
      leadId: null,
      action: "skipped",
      details: { reason: "payload_not_object" },
    });
    return;
  }

  const detail = raw.detail;
  if (!isRecord(detail)) {
    await insertSyncEvent(client, {
      system: "zendesk_support",
      eventType: str(raw.type) ?? "unknown",
      externalId: null,
      leadId: null,
      action: "skipped",
      details: { reason: "missing_detail" },
    });
    return;
  }

  if (isZendeskTicketEvent(raw)) {
    await ingestZendeskTicketFromDetail(client, detail, raw);
    return;
  }

  if ((str(raw.type) ?? "").includes("user")) {
    await ingestZendeskUserFromDetail(client, detail, raw);
    return;
  }

  await insertSyncEvent(client, {
    system: "zendesk_support",
    eventType: str(raw.type) ?? "unknown",
    externalId: null,
    leadId: null,
    action: "skipped",
    details: { reason: "unsupported_zendesk_event" },
  });
}
