-- 007_branding_header_text.sql — what to show next to the logo in the portal header.
-- full = company · clinic + portal title; title = portal title only; none = logo only.
ALTER TABLE branding_settings ADD COLUMN header_text text NOT NULL DEFAULT 'full'
  CHECK (header_text IN ('full','title','none'));
