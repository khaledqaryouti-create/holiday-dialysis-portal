-- 008_branding_photo_colour.sql — sign-in page photo and brand colour (Admin Settings → Branding).
ALTER TABLE branding_settings ADD COLUMN login_image_bytes      bytea;
ALTER TABLE branding_settings ADD COLUMN login_image_mime       text CHECK (login_image_mime IS NULL OR login_image_mime IN ('image/png','image/jpeg','image/webp'));
ALTER TABLE branding_settings ADD COLUMN login_image_updated_at timestamptz;
ALTER TABLE branding_settings ADD COLUMN accent_color           text CHECK (accent_color IS NULL OR accent_color ~* '^#[0-9a-f]{6}$');
