-- =============================================================================
-- FPM DataTool — Canonical Database Schema
-- Phase 0
-- =============================================================================
-- Design principles:
--   - Every record ties back to an internal lead_id (UUID). Never use external
--     system IDs as a primary key or foreign key.
--   - All external IDs are stored in lead_external_ids for cross-referencing.
--   - Monetary values are stored in the smallest currency unit (cents).
--   - Raw payloads (JSONB) are preserved on records sourced from external APIs
--     so the data can be reprocessed without re-fetching.
--   - Soft deletes only — never hard-delete a lead.
--   - Everything is logged in sync_events.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- EXTENSIONS
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive text for email


-- ---------------------------------------------------------------------------
-- LEADS  (canonical contact / person record)
-- ---------------------------------------------------------------------------

CREATE TABLE leads (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  first_name        TEXT,
  last_name         TEXT,
  email             CITEXT,                  -- case-insensitive; primary match key
  phone             TEXT,                    -- normalized E.164 (e.g. +12065550100)
  phone_raw         TEXT,                    -- original value before normalization

  -- Professional
  company_name      TEXT,
  title             TEXT,
  license_number    TEXT,                    -- real estate agent license (Aryeo)
  website           TEXT,

  -- Address
  address_line1     TEXT,
  city              TEXT,
  state             TEXT,
  postal_code       TEXT,
  country           TEXT,

  -- Profile
  timezone          TEXT,
  date_of_birth     DATE,
  source            TEXT,                    -- lead origin (GHL source field)
  tags              TEXT[]      DEFAULT '{}',
  notes             TEXT,

  -- Flags
  dnd               BOOLEAN     DEFAULT false,  -- do-not-disturb (GHL)
  is_deleted        BOOLEAN     DEFAULT false,

  -- Timestamps
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX leads_email_idx       ON leads (email);
CREATE INDEX leads_phone_idx       ON leads (phone);
CREATE INDEX leads_company_idx     ON leads (company_name);
CREATE INDEX leads_is_deleted_idx  ON leads (is_deleted);


-- ---------------------------------------------------------------------------
-- COMPANIES  (organizations — Zendesk Sell orgs, Aryeo brokerages, GHL companies)
-- ---------------------------------------------------------------------------

CREATE TABLE companies (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  name          TEXT        NOT NULL,
  website       TEXT,
  phone         TEXT,
  email         CITEXT,
  industry      TEXT,
  address       JSONB,      -- { line1, city, state, postal_code, country }
  notes         TEXT,
  tags          TEXT[]      DEFAULT '{}',

  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX companies_name_idx ON companies (name);


-- Associate leads to companies (a lead may belong to one company)
ALTER TABLE leads ADD COLUMN company_id UUID REFERENCES companies (id);


-- ---------------------------------------------------------------------------
-- LEAD_EXTERNAL_IDS  (cross-reference: internal lead_id ↔ external system IDs)
-- ---------------------------------------------------------------------------
-- system values:
--   'ghl'                   → GHL contact.id (string)
--   'zendesk_support'       → Zendesk Support user.id (integer as text)
--   'zendesk_sell_contact'  → Zendesk Sell contact.id (integer as text)
--   'zendesk_sell_lead'     → Zendesk Sell lead.id (integer as text)
--   'aryeo_customer'        → Aryeo Group.id (UUID)
--   'aryeo_customer_user'   → Aryeo CustomerUser.id (UUID)

CREATE TABLE lead_external_ids (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID        NOT NULL REFERENCES leads (id),
  system       TEXT        NOT NULL,
  external_id  TEXT        NOT NULL,
  meta         JSONB,      -- optional: locationId for GHL, etc.
  created_at   TIMESTAMPTZ DEFAULT now(),

  UNIQUE (system, external_id)
);

CREATE INDEX lead_external_ids_lead_id_idx ON lead_external_ids (lead_id);
CREATE INDEX lead_external_ids_lookup_idx  ON lead_external_ids (system, external_id);


-- ---------------------------------------------------------------------------
-- LEAD_ASSIGNMENTS  (rep + team ownership, sourced from GHL)
-- ---------------------------------------------------------------------------

CREATE TABLE lead_assignments (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID        NOT NULL REFERENCES leads (id),

  rep_id       TEXT,       -- GHL user ID
  rep_name     TEXT,
  team_id      TEXT,
  team_name    TEXT,

  assigned_at  TIMESTAMPTZ DEFAULT now(),
  is_current   BOOLEAN     DEFAULT true,   -- only one row per lead should be true

  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX lead_assignments_lead_id_idx ON lead_assignments (lead_id);
CREATE INDEX lead_assignments_current_idx ON lead_assignments (lead_id, is_current);


-- ---------------------------------------------------------------------------
-- ORDERS  (sourced from Aryeo)
-- ---------------------------------------------------------------------------

CREATE TABLE orders (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  aryeo_order_id       UUID        NOT NULL UNIQUE,

  lead_id              UUID        REFERENCES leads (id),
  aryeo_identifier     TEXT,       -- vanity order identifier (e.g. "Order #2")
  title                TEXT,

  order_status         TEXT,       -- DRAFT | OPEN | CANCELED
  fulfillment_status   TEXT,       -- FULFILLED | UNFULFILLED
  payment_status       TEXT,       -- PAID | PARTIALLY_PAID | UNPAID

  total_amount         INTEGER,    -- cents
  balance_amount       INTEGER,    -- cents outstanding
  total_tax_amount     INTEGER,
  total_discount_amount INTEGER,
  currency             TEXT        DEFAULT 'USD',

  property_address     JSONB,      -- Aryeo Address object
  internal_notes       TEXT,
  tags                 TEXT[]      DEFAULT '{}',

  fulfilled_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ,
  synced_at            TIMESTAMPTZ DEFAULT now(),

  raw_payload          JSONB       -- full Aryeo Order object
);

CREATE INDEX orders_lead_id_idx         ON orders (lead_id);
CREATE INDEX orders_payment_status_idx  ON orders (payment_status);
CREATE INDEX orders_fulfillment_idx     ON orders (fulfillment_status);
CREATE INDEX orders_created_at_idx      ON orders (created_at);


-- ---------------------------------------------------------------------------
-- ORDER_ITEMS  (Aryeo line items)
-- ---------------------------------------------------------------------------

CREATE TABLE order_items (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  aryeo_item_id        UUID        NOT NULL UNIQUE,
  order_id             UUID        NOT NULL REFERENCES orders (id),

  title                TEXT,
  purchasable_type     TEXT,       -- PRODUCT_VARIANT | FEE | CUSTOM
  unit_price_amount    INTEGER,    -- cents
  quantity             INTEGER,
  gross_total_amount   INTEGER,    -- cents (unit_price × quantity)
  is_canceled          BOOLEAN     DEFAULT false,
  is_serviceable       BOOLEAN,

  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX order_items_order_id_idx ON order_items (order_id);


-- ---------------------------------------------------------------------------
-- TICKETS  (Zendesk Support)
-- ---------------------------------------------------------------------------

CREATE TABLE tickets (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  zendesk_ticket_id    BIGINT      NOT NULL UNIQUE,

  lead_id              UUID        REFERENCES leads (id),

  subject              TEXT,
  description          TEXT,
  status               TEXT,       -- new | open | pending | hold | solved | closed
  priority             TEXT,       -- urgent | high | normal | low
  type                 TEXT,       -- problem | incident | question | task
  channel              TEXT,       -- via.channel from Zendesk

  assignee_id          BIGINT,
  group_id             BIGINT,
  organization_id      BIGINT,
  tags                 TEXT[]      DEFAULT '{}',

  created_at           TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ,
  synced_at            TIMESTAMPTZ DEFAULT now(),

  raw_payload          JSONB       -- full Zendesk Ticket object
);

CREATE INDEX tickets_lead_id_idx          ON tickets (lead_id);
CREATE INDEX tickets_status_idx           ON tickets (status);
CREATE INDEX tickets_zendesk_ticket_idx   ON tickets (zendesk_ticket_id);


-- ---------------------------------------------------------------------------
-- SELL_DEALS  (Zendesk Sell — migration only, read-only after import)
-- ---------------------------------------------------------------------------

CREATE TABLE sell_deals (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sell_deal_id         BIGINT      NOT NULL UNIQUE,

  lead_id              UUID        REFERENCES leads (id),   -- matched lead

  name                 TEXT,
  value                BIGINT,     -- cents (converted from Sell's mixed int/string)
  currency             TEXT,
  stage_id             BIGINT,
  status               TEXT,       -- open | won | lost | unqualified
  source_id            BIGINT,
  owner_id             BIGINT,     -- Sell user ID

  estimated_close_date DATE,
  last_stage_change_at TIMESTAMPTZ,
  last_activity_at     TIMESTAMPTZ,

  tags                 TEXT[]      DEFAULT '{}',
  custom_fields        JSONB,

  sell_created_at      TIMESTAMPTZ,
  sell_updated_at      TIMESTAMPTZ,
  migrated_at          TIMESTAMPTZ DEFAULT now(),

  raw_payload          JSONB       -- full Zendesk Sell Deal object
);

CREATE INDEX sell_deals_lead_id_idx ON sell_deals (lead_id);


-- ---------------------------------------------------------------------------
-- DEDUP_CANDIDATES  (flagged potential duplicate leads for review)
-- ---------------------------------------------------------------------------

CREATE TABLE dedup_candidates (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  lead_id_a        UUID        NOT NULL REFERENCES leads (id),
  lead_id_b        UUID        NOT NULL REFERENCES leads (id),

  match_reason     TEXT        NOT NULL,  -- 'email' | 'phone' | 'name_company'
  confidence       TEXT,                  -- 'high' | 'medium' | 'low'
  match_score      NUMERIC,               -- optional numeric confidence 0.0–1.0

  resolved         BOOLEAN     DEFAULT false,
  resolution       TEXT,                  -- 'merged' | 'not_duplicate'
  resolved_by      TEXT,                  -- user or 'system'
  resolved_at      TIMESTAMPTZ,

  created_at       TIMESTAMPTZ DEFAULT now(),

  UNIQUE (lead_id_a, lead_id_b)
);

CREATE INDEX dedup_candidates_unresolved_idx ON dedup_candidates (resolved) WHERE resolved = false;


-- ---------------------------------------------------------------------------
-- SYNC_EVENTS  (immutable audit log of every sync, webhook, and migration op)
-- ---------------------------------------------------------------------------

CREATE TABLE sync_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  system       TEXT        NOT NULL,  -- 'ghl' | 'zendesk_support' | 'zendesk_sell' | 'aryeo'
  event_type   TEXT        NOT NULL,  -- e.g. 'ContactCreate', 'ORDER_CREATED', 'migration'
  external_id  TEXT,                  -- external record ID that triggered the event

  lead_id      UUID        REFERENCES leads (id),

  -- What the sync engine did with this event
  action       TEXT,                  -- 'created' | 'updated' | 'matched' | 'skipped' | 'error' | 'dedup_flagged'
  details      JSONB,                 -- additional context (e.g. match reason, error message)

  occurred_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX sync_events_lead_id_idx    ON sync_events (lead_id);
CREATE INDEX sync_events_system_idx     ON sync_events (system);
CREATE INDEX sync_events_occurred_idx   ON sync_events (occurred_at);
CREATE INDEX sync_events_action_idx     ON sync_events (action);


-- ---------------------------------------------------------------------------
-- COMMISSIONS  (Phase 5 — stub table, schema finalized in that phase)
-- ---------------------------------------------------------------------------

CREATE TABLE commissions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  lead_id       UUID        NOT NULL REFERENCES leads (id),
  order_id      UUID        REFERENCES orders (id),
  rep_id        TEXT,                  -- GHL user ID
  rep_name      TEXT,

  amount        INTEGER,               -- cents
  currency      TEXT        DEFAULT 'USD',
  period_start  DATE,
  period_end    DATE,

  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX commissions_lead_id_idx ON commissions (lead_id);
CREATE INDEX commissions_rep_id_idx  ON commissions (rep_id);
CREATE INDEX commissions_period_idx  ON commissions (period_start, period_end);
