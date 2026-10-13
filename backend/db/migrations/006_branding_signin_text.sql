-- 006_branding_signin_text.sql — more sign-in page text under Admin Settings → Branding.
-- Empty = the sign-in page keeps its own standard text. Only used while branding is switched on.
ALTER TABLE branding_settings ADD COLUMN sign_in_title     text;
ALTER TABLE branding_settings ADD COLUMN sign_in_subtitle  text;
ALTER TABLE branding_settings ADD COLUMN login_step_1      text;
ALTER TABLE branding_settings ADD COLUMN login_step_2      text;
ALTER TABLE branding_settings ADD COLUMN login_step_3      text;
ALTER TABLE branding_settings ADD COLUMN sign_in_note      text;
ALTER TABLE branding_settings ADD COLUMN show_sign_in_note boolean NOT NULL DEFAULT true;
