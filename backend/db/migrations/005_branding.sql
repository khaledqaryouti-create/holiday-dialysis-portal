-- 005_branding.sql — Admin Settings → Branding: logo, company / clinic name, contact details.
-- Shown on the sign-in page and in the portal header. Starts SWITCHED OFF: the portal keeps its standard look until
-- IT ticks "Show this branding" and saves.

CREATE TABLE branding_settings (
  id                      smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled                 boolean NOT NULL DEFAULT false,
  company_name            text,
  clinic_name             text,
  portal_title            text NOT NULL DEFAULT 'Holiday Dialysis Coordination Portal',
  login_headline          text,
  login_message           text,
  -- contact details
  contact_phone           text,
  contact_email           text,
  contact_address         text,
  contact_website         text,
  contact_hours           text,
  show_contact_on_login   boolean NOT NULL DEFAULT true,
  show_contact_in_header  boolean NOT NULL DEFAULT true,
  -- logo (small image kept in the database so it survives redeploys and needs no public bucket)
  logo_bytes              bytea,
  logo_mime               text CHECK (logo_mime IS NULL OR logo_mime IN ('image/png','image/jpeg','image/webp','image/svg+xml')),
  logo_on_white           boolean NOT NULL DEFAULT true,
  logo_updated_at         timestamptz,
  updated_by_user_id      uuid REFERENCES portal_user(id),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
INSERT INTO branding_settings (id) VALUES (1);
ALTER TABLE branding_settings ENABLE ROW LEVEL SECURITY;
