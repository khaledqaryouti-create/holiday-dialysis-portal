-- 003_email_settings.sql — SMTP settings managed from Admin Settings → Email (SMTP).
-- One row (id = 1). The password is encrypted with pgcrypto using FIELD_ENCRYPTION_KEY and is never returned to the browser.
CREATE TABLE email_settings (
  id                     smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled                boolean NOT NULL DEFAULT false,      -- false = use the .env fallback (MAIL_TRANSPORT)
  host                   text,
  port                   integer CHECK (port IS NULL OR port BETWEEN 1 AND 65535),
  security               text NOT NULL DEFAULT 'ssl' CHECK (security IN ('ssl','starttls','none')),
  auth_required          boolean NOT NULL DEFAULT true,
  username               text,
  password_enc           bytea,
  from_name              text,
  from_email             text,
  reply_to               text,
  allow_self_signed      boolean NOT NULL DEFAULT false,
  timeout_seconds        integer NOT NULL DEFAULT 20 CHECK (timeout_seconds BETWEEN 5 AND 120),
  last_test_at           timestamptz,
  last_test_ok           boolean,
  last_test_message      text,
  updated_by_user_id     uuid REFERENCES portal_user(id),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enabled_needs_basics CHECK (NOT enabled OR (host IS NOT NULL AND port IS NOT NULL AND from_email IS NOT NULL)),
  CONSTRAINT auth_needs_user CHECK (NOT enabled OR NOT auth_required OR username IS NOT NULL)
);
INSERT INTO email_settings (id) VALUES (1);
ALTER TABLE email_settings ENABLE ROW LEVEL SECURITY;

-- Delivery details for email notifications (shown in the email delivery log).
ALTER TABLE notification ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE notification ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS notif_email_status_idx ON notification (channel, delivery_status, created_at DESC);
