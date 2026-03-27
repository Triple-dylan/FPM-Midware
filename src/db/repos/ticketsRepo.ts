import type { PoolClient } from "pg";

export async function upsertTicket(
  client: PoolClient,
  row: {
    zendeskTicketId: number;
    leadId: string | null;
    subject: string | null;
    description: string | null;
    status: string | null;
    priority: string | null;
    type: string | null;
    channel: string | null;
    assigneeId: number | null;
    groupId: number | null;
    organizationId: number | null;
    tags: string[];
    createdAt: Date | null;
    updatedAt: Date | null;
    rawPayload: unknown;
  },
): Promise<void> {
  await client.query(
    `insert into tickets (
       zendesk_ticket_id, lead_id, subject, description, status, priority, type,
       channel, assignee_id, group_id, organization_id, tags,
       created_at, updated_at, raw_payload
     ) values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb
     )
     on conflict (zendesk_ticket_id) do update set
       lead_id = coalesce(excluded.lead_id, tickets.lead_id),
       subject = coalesce(excluded.subject, tickets.subject),
       description = coalesce(excluded.description, tickets.description),
       status = coalesce(excluded.status, tickets.status),
       priority = coalesce(excluded.priority, tickets.priority),
       type = coalesce(excluded.type, tickets.type),
       channel = coalesce(excluded.channel, tickets.channel),
       assignee_id = coalesce(excluded.assignee_id, tickets.assignee_id),
       group_id = coalesce(excluded.group_id, tickets.group_id),
       organization_id = coalesce(excluded.organization_id, tickets.organization_id),
       tags = coalesce(excluded.tags, tickets.tags),
       created_at = coalesce(tickets.created_at, excluded.created_at),
       updated_at = coalesce(excluded.updated_at, tickets.updated_at),
       raw_payload = excluded.raw_payload,
       synced_at = now()`,
    [
      row.zendeskTicketId,
      row.leadId,
      row.subject,
      row.description,
      row.status,
      row.priority,
      row.type,
      row.channel,
      row.assigneeId,
      row.groupId,
      row.organizationId,
      row.tags,
      row.createdAt,
      row.updatedAt,
      row.rawPayload ?? null,
    ],
  );
}
