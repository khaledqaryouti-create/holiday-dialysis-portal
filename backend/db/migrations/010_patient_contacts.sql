-- 010_patient_contacts.sql — patient and relative mobile numbers on the request (Patient & Destination step).
-- Numbers are personal data: stored encrypted with pgcrypto (FIELD_ENCRYPTION_KEY), like the national ID.
-- Kept on the request (not the patient record) because the number to reach during a trip can differ.
ALTER TABLE holiday_dialysis_request ADD COLUMN patient_mobile_enc  bytea;
ALTER TABLE holiday_dialysis_request ADD COLUMN relative_mobile_enc bytea;
ALTER TABLE holiday_dialysis_request ADD COLUMN relative_name       text CHECK (relative_name IS NULL OR length(relative_name) <= 100);
