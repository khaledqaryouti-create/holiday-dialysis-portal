-- 014_integrations.sql — Admin Settings → Integrations: connections to EMR / hospital systems
-- (FHIR R4, HL7 v2 MLLP/HTTP, CDA, REST/JSON, SFTP, Email) and a log of every message exchanged.
-- Every connection starts SWITCHED OFF. Passwords / tokens / keys are stored encrypted (pgcrypto).
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS integration_connection (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  protocol            text NOT NULL CHECK (protocol IN ('FHIR_R4','HL7V2_MLLP','HL7V2_HTTP','CDA','REST_JSON','SFTP','EMAIL')),
  enabled             boolean NOT NULL DEFAULT false,
  flows               text[] NOT NULL DEFAULT '{}',
  config              jsonb NOT NULL DEFAULT '{}'::jsonb,
  secrets_enc         bytea,                       -- pgp_sym_encrypt(json, FIELD_ENCRYPTION_KEY)
  inbound_key_hash    text,                        -- sha256 of the inbound API key (the key itself is shown once)
  inbound_key_hint    text,                        -- last 4 characters, for display
  last_pull_at        timestamptz,
  last_success_at     timestamptz,
  last_error_at       timestamptz,
  last_error          text,
  created_by_user_id  uuid REFERENCES portal_user(id),
  updated_by_user_id  uuid REFERENCES portal_user(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE integration_connection ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS integration_message (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id    uuid NOT NULL REFERENCES integration_connection(id) ON DELETE CASCADE,
  direction        text NOT NULL CHECK (direction IN ('Outbound','Inbound')),
  flow             text NOT NULL CHECK (flow IN ('patientsInbound','requestEvents','documents','mrnLookup','test')),
  event            text,                            -- Submitted, Confirmed, … / document type / ADT^A08 …
  request_id       uuid REFERENCES holiday_dialysis_request(id),
  document_ref     text,                            -- 'letter' or a request_document id
  status           text NOT NULL CHECK (status IN ('Queued','Sent','Failed','Received','Processed','Rejected')),
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz,
  payload_format   text,
  payload_enc      bytea,                           -- message content, encrypted (contains patient data)
  summary          text,                            -- short, no patient identifiers
  response         text,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS integration_message_due_idx ON integration_message (next_attempt_at) WHERE status IN ('Queued','Failed') AND next_attempt_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS integration_message_conn_idx ON integration_message (connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS integration_message_req_idx ON integration_message (request_id);
ALTER TABLE integration_message ENABLE ROW LEVEL SECURITY;

-- Patients can now come from an EMR connection.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'patient_reference'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%source_system%';
  IF c IS NOT NULL AND c <> 'patient_reference_source_system_check2' THEN
    EXECUTE format('ALTER TABLE patient_reference DROP CONSTRAINT %I', c);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_reference_source_system_check2') THEN
    ALTER TABLE patient_reference ADD CONSTRAINT patient_reference_source_system_check2 CHECK (source_system IN ('Manual','DCare','EMR'));
  END IF;
END $$;
ALTER TABLE patient_reference ADD COLUMN IF NOT EXISTS source_connection_id uuid REFERENCES integration_connection(id) ON DELETE SET NULL;
