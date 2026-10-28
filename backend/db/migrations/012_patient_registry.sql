-- 012_patient_registry.sql — My Requests → Patients: register patients so New Request finds them by MRN or name.
-- Patients are never deleted (requests point to them); "Inactive" hides them from the New Request search.
ALTER TABLE patient_reference ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE patient_reference ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE patient_reference ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES portal_user(id);
ALTER TABLE patient_reference ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES portal_user(id);
ALTER TABLE patient_reference ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Safe to run more than once (e.g. pasted in the SQL editor and later run by npm run migrate).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_reference_name_len') THEN
    ALTER TABLE patient_reference ADD CONSTRAINT patient_reference_name_len CHECK (char_length(full_name) BETWEEN 2 AND 150) NOT VALID;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS patient_reference_mrn_idx ON patient_reference (mrn text_pattern_ops);
