-- Resolved GHL custom field UUIDs per location (from API refresh).
CREATE TABLE IF NOT EXISTS ghl_custom_field_cache (
  location_id      TEXT        NOT NULL,
  field_key        TEXT        NOT NULL,
  ghl_field_id     TEXT        NOT NULL,
  name             TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, field_key)
);

CREATE INDEX IF NOT EXISTS ghl_custom_field_cache_location_idx
  ON ghl_custom_field_cache (location_id);
