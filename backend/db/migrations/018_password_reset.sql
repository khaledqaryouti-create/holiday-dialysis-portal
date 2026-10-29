-- 018_password_reset.sql — "Forgot password?" on the sign-in page (portal passwords only).
-- A reset link holds a random token; only its SHA-256 hash is stored. Links expire after 30 minutes and work once.
-- password_reset_at signs out every portal-password session that started before the reset. Safe to run twice.
CREATE TABLE IF NOT EXISTS password_reset_token (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES portal_user(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  requested_ip  text
);
CREATE INDEX IF NOT EXISTS prt_user_idx ON password_reset_token (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS prt_ip_idx ON password_reset_token (requested_ip, created_at DESC);
ALTER TABLE password_reset_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_user ADD COLUMN IF NOT EXISTS password_reset_at timestamptz;
