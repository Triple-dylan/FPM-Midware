-- Automation toggles (admin UI + API). Safe to re-run: seed uses ON CONFLICT DO NOTHING.

CREATE TABLE IF NOT EXISTS automation_toggles (
  id            TEXT        PRIMARY KEY,
  label         TEXT        NOT NULL,
  description   TEXT,
  enabled       BOOLEAN     NOT NULL DEFAULT true,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS automation_toggles_enabled_idx
  ON automation_toggles (enabled);

INSERT INTO automation_toggles (id, label, description, enabled) VALUES
  ('inbound_ghl_webhooks', 'Ingest GHL webhooks → Postgres',
   'Process ContactCreate/Update and related events into the canonical database.', true),
  ('inbound_zendesk_support_webhooks', 'Ingest Zendesk Support webhooks → Postgres',
   'Process ticket/user webhook envelopes into tickets and lead enrichment.', true),
  ('aryeo_webhook_ingest_postgres', 'Ingest Aryeo webhooks → Postgres',
   'Store orders and customer linkage (Aryeo remains read-only; we only write to our DB).', true),
  ('aryeo_push_order_summary_to_ghl', 'Push Aryeo order context → GHL contact',
   'After an order is ingested: update contact in GHL (custom fields / notes per ghl_field_map). Requires GHL_ACCESS_TOKEN and a linked GHL contact.', false),
  ('aryeo_push_rep_assignment_to_ghl', 'Map Aryeo acting user → GHL assignedTo',
   'Optional: sync salesperson assignment from Aryeo activity to GHL (needs GHL user mapping — not fully implemented).', false),
  ('zendesk_sell_migration_batch', 'Zendesk Sell migration jobs',
   'Reserved: large Sell export/migration (run as its own phase, off by default).', false)
ON CONFLICT (id) DO NOTHING;

-- Target GHL custom fields / logical keys (populate from your CSV via import script or SQL).
CREATE TABLE IF NOT EXISTS ghl_field_map (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  map_key                TEXT        NOT NULL UNIQUE,
  ghl_custom_field_id    TEXT,
  label                  TEXT,
  active                 BOOLEAN     NOT NULL DEFAULT true,
  sort_order             INT         NOT NULL DEFAULT 0,
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ghl_field_map_active_idx
  ON ghl_field_map (active) WHERE active = true;
