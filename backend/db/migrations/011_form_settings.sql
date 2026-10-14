-- 011_form_settings.sql — Admin Settings → Form Fields: which New Request fields and attachments are Required,
-- Optional or Hidden, and the colours used to mark them. Empty rules = the portal's original behaviour.

CREATE TABLE form_settings (
  id                  smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  rules               jsonb NOT NULL DEFAULT '{}'::jsonb,
  required_color      text NOT NULL DEFAULT '#a12a1d' CHECK (required_color ~* '^#[0-9a-f]{6}$'),
  optional_color      text NOT NULL DEFAULT '#2a5a8f' CHECK (optional_color ~* '^#[0-9a-f]{6}$'),
  highlight_required  boolean NOT NULL DEFAULT false,
  updated_by_user_id  uuid REFERENCES portal_user(id),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
INSERT INTO form_settings (id) VALUES (1);
ALTER TABLE form_settings ENABLE ROW LEVEL SECURITY;
