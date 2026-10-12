-- One-time links so a person can choose their own password. The raw token is never stored.
-- RLS on with no policies: Supabase REST returns nothing; the Express role bypasses RLS.

CREATE TABLE password_setup_token (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES portal_user(id),
  token_hash           text NOT NULL UNIQUE,
  purpose              text NOT NULL CHECK (purpose IN ('reset', 'invite')),
  expires_at           timestamptz NOT NULL,
  used_at              timestamptz,
  created_by_user_id   uuid REFERENCES portal_user(id),
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_setup_token_user_idx ON password_setup_token (user_id);

ALTER TABLE password_setup_token ENABLE ROW LEVEL SECURITY;

INSERT INTO notification_template (template_code, template_name, description, channel, subject_template, body_template, version) VALUES
('PasswordReset', 'Password reset', 'Sent when IT Admin emails a reset link to someone who already has a password', 'Email',
 'Choose a new password',
 E'Dear {{Name}},\n\nUse this link to choose a new password for the Holiday Dialysis Coordination Portal. The link works once and expires in 24 hours.\n\n{{Setup Link}}\n\nIf you did not expect this, you can ignore it. Your current password still works until you set a new one.',
 1),
('PasswordInvite', 'Set your password', 'Sent when IT Admin creates an account and emails a link to choose a first password', 'Email',
 'Set your Holiday Dialysis Coordination Portal password',
 E'Dear {{Name}},\n\nAn administrator created your account. Use this link to choose your password. The link works once and expires in 24 hours.\n\n{{Setup Link}}\n\nThen sign in with your email, that password, and your clinic.',
 1);
