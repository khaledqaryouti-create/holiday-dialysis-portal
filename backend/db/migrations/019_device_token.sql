-- 019_device_token.sql — mobile app push notifications: each signed-in device registers its push token.
-- A device belongs to one user; tokens are unique. Removed on sign-out or when the push service reports it's gone.
CREATE TABLE IF NOT EXISTS device_token (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES portal_user(id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE,
  platform     text CHECK (platform IS NULL OR platform IN ('ios','android','web')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS device_token_user_idx ON device_token (user_id);
ALTER TABLE device_token ENABLE ROW LEVEL SECURITY;
