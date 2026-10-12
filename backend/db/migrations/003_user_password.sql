-- Development sign-in stores a pgcrypto bcrypt hash. Null until a password is set.
-- Production sign-in is Microsoft Entra ID; this column is unused when AUTH_MODE=entra.

ALTER TABLE portal_user ADD COLUMN password_hash text;
