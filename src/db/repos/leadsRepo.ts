import type { PoolClient } from "pg";

export async function findLeadIdsByEmail(
  client: PoolClient,
  email: string,
): Promise<string[]> {
  const r = await client.query<{ id: string }>(
    `select id from leads where is_deleted = false and email = $1 limit 3`,
    [email],
  );
  return r.rows.map((x) => x.id);
}

export async function findLeadIdsByPhone(
  client: PoolClient,
  phoneE164: string,
): Promise<string[]> {
  const r = await client.query<{ id: string }>(
    `select id from leads where is_deleted = false and phone = $1 limit 3`,
    [phoneE164],
  );
  return r.rows.map((x) => x.id);
}

export async function findLeadIdsByNameCompany(
  client: PoolClient,
  first: string,
  last: string,
  company: string,
): Promise<string[]> {
  const r = await client.query<{ id: string }>(
    `select id from leads
     where is_deleted = false
       and lower(trim(coalesce(first_name,''))) = lower(trim($1::text))
       and lower(trim(coalesce(last_name,''))) = lower(trim($2::text))
       and lower(trim(coalesce(company_name,''))) = lower(trim($3::text))
     limit 5`,
    [first, last, company],
  );
  return r.rows.map((x) => x.id);
}

export type GhlLeadInsert = {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  phone_raw: string | null;
  company_name: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  website: string | null;
  timezone: string | null;
  date_of_birth: string | null;
  source: string | null;
  tags: string[];
  dnd: boolean;
  created_at: Date | null;
  updated_at: Date | null;
};

export async function insertLeadAryeoCustomer(
  client: PoolClient,
  row: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    phone_raw: string | null;
    company_name: string | null;
    license_number: string | null;
  },
): Promise<string> {
  const r = await client.query<{ id: string }>(
    `insert into leads (
       first_name, last_name, email, phone, phone_raw, company_name, license_number, tags, dnd
     ) values ($1,$2,$3,$4,$5,$6,$7,'{}', false)
     returning id`,
    [
      row.first_name,
      row.last_name,
      row.email,
      row.phone,
      row.phone_raw,
      row.company_name,
      row.license_number,
    ],
  );
  return r.rows[0].id;
}

export async function insertLeadFromGhl(
  client: PoolClient,
  row: GhlLeadInsert,
): Promise<string> {
  const r = await client.query<{ id: string }>(
    `insert into leads (
       first_name, last_name, email, phone, phone_raw, company_name,
       address_line1, city, state, postal_code, country, website,
       timezone, date_of_birth, source, tags, dnd,
       created_at, updated_at
     ) values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::date,$14,$15,$16,
       coalesce($17, now()), coalesce($18, now())
     )
     returning id`,
    [
      row.first_name,
      row.last_name,
      row.email,
      row.phone,
      row.phone_raw,
      row.company_name,
      row.address_line1,
      row.city,
      row.state,
      row.postal_code,
      row.country,
      row.website,
      row.timezone,
      row.date_of_birth,
      row.source,
      row.tags,
      row.dnd,
      row.created_at,
      row.updated_at,
    ],
  );
  return r.rows[0].id;
}

export async function updateLeadFullGhl(
  client: PoolClient,
  leadId: string,
  row: GhlLeadInsert,
): Promise<void> {
  await client.query(
    `update leads set
       first_name = $2,
       last_name = $3,
       email = $4,
       phone = $5,
       phone_raw = $6,
       company_name = $7,
       address_line1 = $8,
       city = $9,
       state = $10,
       postal_code = $11,
       country = $12,
       website = $13,
       timezone = $14,
       date_of_birth = $15::date,
       source = $16,
       tags = $17,
       dnd = $18,
       created_at = coalesce(leads.created_at, $19),
       updated_at = coalesce($20, now())
     where id = $1`,
    [
      leadId,
      row.first_name,
      row.last_name,
      row.email,
      row.phone,
      row.phone_raw,
      row.company_name,
      row.address_line1,
      row.city,
      row.state,
      row.postal_code,
      row.country,
      row.website,
      row.timezone,
      row.date_of_birth,
      row.source,
      row.tags,
      row.dnd,
      row.created_at,
      row.updated_at,
    ],
  );
}

export async function softDeleteLead(client: PoolClient, leadId: string): Promise<void> {
  await client.query(
    `update leads set is_deleted = true, updated_at = now() where id = $1`,
    [leadId],
  );
}

export async function setLeadDnd(
  client: PoolClient,
  leadId: string,
  dnd: boolean,
): Promise<void> {
  await client.query(
    `update leads set dnd = $2, updated_at = now() where id = $1`,
    [leadId, dnd],
  );
}

export type LeadCoreRow = {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  phone_raw: string | null;
  timezone: string | null;
  notes: string | null;
  tags: string[];
  created_at: Date | null;
};

export async function getLeadCore(
  client: PoolClient,
  leadId: string,
): Promise<LeadCoreRow | null> {
  const r = await client.query<LeadCoreRow>(
    `select first_name, last_name, email, phone, phone_raw, timezone, notes,
            coalesce(tags, '{}') as tags, created_at
     from leads where id = $1 and is_deleted = false`,
    [leadId],
  );
  return r.rows[0] ?? null;
}

/** After computing merged Zendesk values in the service (GHL-wins rules). */
export async function setLeadZendeskSnapshot(
  client: PoolClient,
  leadId: string,
  row: LeadCoreRow & { updated_at: Date },
): Promise<void> {
  await client.query(
    `update leads set
       first_name = $2,
       last_name = $3,
       email = $4,
       phone = $5,
       phone_raw = $6,
       timezone = $7,
       notes = $8,
       tags = $9,
       created_at = coalesce(leads.created_at, $10),
       updated_at = $11
     where id = $1`,
    [
      leadId,
      row.first_name,
      row.last_name,
      row.email,
      row.phone,
      row.phone_raw,
      row.timezone,
      row.notes,
      row.tags,
      row.created_at,
      row.updated_at,
    ],
  );
}

export async function patchLeadFromAryeoCustomer(
  client: PoolClient,
  leadId: string,
  patch: {
    company_name: string | null;
    license_number: string | null;
    phone: string | null;
    phone_raw: string | null;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
  },
): Promise<void> {
  await client.query(
    `update leads set
       company_name = coalesce($2, company_name),
       license_number = coalesce($3, license_number),
       phone = coalesce(phone, $4),
       phone_raw = coalesce(phone_raw, $5),
       email = coalesce(email, $6),
       first_name = coalesce(first_name, $7),
       last_name = coalesce(last_name, $8),
       updated_at = now()
     where id = $1`,
    [
      leadId,
      patch.company_name,
      patch.license_number,
      patch.phone,
      patch.phone_raw,
      patch.email,
      patch.first_name,
      patch.last_name,
    ],
  );
}
