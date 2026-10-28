-- 016_terminology.sql — Admin Settings → Terminology: your own words for the portal's standard terms
-- (e.g. "Clinic" instead of "My Requests"). The original wording is built into the portal and is never changed;
-- this table only stores the alternatives. Starts SWITCHED OFF. Safe to run more than once.
CREATE TABLE IF NOT EXISTS terminology_settings (
  id                  smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled             boolean NOT NULL DEFAULT false,
  terms               jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by_user_id  uuid REFERENCES portal_user(id),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
INSERT INTO terminology_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE terminology_settings ENABLE ROW LEVEL SECURITY;
