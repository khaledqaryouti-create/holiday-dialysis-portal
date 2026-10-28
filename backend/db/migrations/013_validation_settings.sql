-- 013_validation_settings.sql — Admin Settings → Validation Rules: length / characters / starting digits for
-- MRN, National ID / Iqama, passport, patient name and mobile numbers. Empty rules = the portal's original checks.
CREATE TABLE IF NOT EXISTS validation_settings (
  id                  smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  rules               jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by_user_id  uuid REFERENCES portal_user(id),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
INSERT INTO validation_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE validation_settings ENABLE ROW LEVEL SECURITY;
