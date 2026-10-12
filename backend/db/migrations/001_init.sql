-- 001_init.sql — Holiday Dialysis Coordination Portal core schema
-- Logical design: spec §14. Works on plain PostgreSQL 14+ and on Supabase.
-- Conventions: snake_case, uuid keys for business records, bigserial for append-only logs,
-- timestamps in UTC (timestamptz), dates as DATE, controlled values enforced with CHECK.

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- Supabase: already installed in the "extensions" schema

-- ---------------------------------------------------------------- identity & access
CREATE TABLE portal_user (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entra_object_id  text UNIQUE,                 -- filled when Entra ID SSO is switched on
  email            text NOT NULL,
  display_name     text NOT NULL,
  account_status   text NOT NULL DEFAULT 'Active' CHECK (account_status IN ('Active','Inactive')),
  last_sign_in_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX portal_user_email_uq ON portal_user (lower(email));

CREATE TABLE role (
  role_code  text PRIMARY KEY,
  role_name  text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true
);

CREATE TABLE user_role (
  id              bigserial PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES portal_user(id),
  role_code       text NOT NULL REFERENCES role(role_code),
  effective_from  date NOT NULL DEFAULT current_date,
  effective_to    date,
  UNIQUE (user_id, role_code, effective_from)
);

-- ---------------------------------------------------------------- reference data
CREATE TABLE country (
  country_code  char(2) PRIMARY KEY,
  country_name  text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true
);

CREATE TABLE city (
  id            serial PRIMARY KEY,
  country_code  char(2) NOT NULL REFERENCES country(country_code),
  city_name     text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  UNIQUE (country_code, city_name)
);

CREATE TABLE provider (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code  text NOT NULL UNIQUE,
  provider_name  text NOT NULL,
  provider_type  text NOT NULL CHECK (provider_type IN ('ExternalKSA','International')),
  is_active      boolean NOT NULL DEFAULT true
);

CREATE TABLE facility (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_code     text NOT NULL UNIQUE,
  facility_name     text NOT NULL,
  facility_type     text NOT NULL CHECK (facility_type IN ('DiaverumClinic','ExternalKSAProviderBranch','InternationalFacility')),
  provider_id       uuid REFERENCES provider(id),
  country_code      char(2) NOT NULL REFERENCES country(country_code),
  city_id           integer REFERENCES city(id),
  branch_name       text,
  contact_email     text,
  cc_email          text,
  is_active         boolean NOT NULL DEFAULT true,
  source_system     text NOT NULL DEFAULT 'Portal' CHECK (source_system IN ('Portal','DCare','ExcelImport')),
  last_verified_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT facility_provider_required CHECK (facility_type <> 'ExternalKSAProviderBranch' OR provider_id IS NOT NULL)
);
CREATE INDEX facility_type_active_idx ON facility (facility_type, is_active);

CREATE TABLE user_clinic_scope (
  id              bigserial PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES portal_user(id),
  facility_id     uuid NOT NULL REFERENCES facility(id),
  scope_type      text NOT NULL DEFAULT 'Member' CHECK (scope_type IN ('Member')),
  effective_from  date NOT NULL DEFAULT current_date,
  effective_to    date,
  UNIQUE (user_id, facility_id, effective_from)
);

-- ---------------------------------------------------------------- patients (minimal local reference; d.care is master)
CREATE TABLE patient_reference (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dcare_patient_id            text UNIQUE,                -- immutable d.care id once integrated (Phase 2)
  mrn                         text NOT NULL CHECK (mrn ~ '^[0-9]+$'),
  identifier_type             text NOT NULL CHECK (identifier_type IN ('NationalId','Passport')),
  national_identifier_enc     bytea NOT NULL,             -- pgp_sym_encrypt(value, FIELD_ENCRYPTION_KEY)
  national_identifier_hash    text NOT NULL,              -- hmac-sha256 hex, for exact-match lookup without decrypting
  national_identifier_last2   text NOT NULL,              -- for masked display only
  full_name                   text NOT NULL,              -- TODO(phase 3): encrypt per spec §14.6 once search design is approved
  home_facility_id            uuid NOT NULL REFERENCES facility(id),
  modality                    text,
  source_system               text NOT NULL DEFAULT 'Manual' CHECK (source_system IN ('Manual','DCare')),
  source_retrieved_at         timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mrn, home_facility_id)
);
CREATE INDEX patient_reference_hash_idx ON patient_reference (national_identifier_hash);
CREATE INDEX patient_reference_name_idx ON patient_reference (lower(full_name) text_pattern_ops);

-- ---------------------------------------------------------------- requests
CREATE SEQUENCE request_number_seq START 1000;

CREATE TABLE holiday_dialysis_request (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number          text NOT NULL UNIQUE,
  patient_reference_id    uuid REFERENCES patient_reference(id),          -- null only while Draft
  requesting_facility_id  uuid NOT NULL REFERENCES facility(id),
  receiving_facility_id   uuid REFERENCES facility(id),                   -- facility chosen in the wizard
  selected_facility_id    uuid REFERENCES facility(id),                   -- facility actually emailed (external)
  destination_type        text CHECK (destination_type IN ('Internal','ExternalKSA','International')),  -- may be empty while Draft
  destination_country     char(2) REFERENCES country(country_code),
  destination_city        text,
  free_text_facility      text,
  travel_start_date       date,
  travel_end_date         date,
  sessions_required       integer,
  mod_applies             boolean NOT NULL DEFAULT false,
  -- Manually typed patient details while the request is still a Draft (spec: "Save as Draft" works with partial data).
  -- On submit these resolve to patient_reference_id and are cleared.
  draft_patient_name      text,
  draft_patient_mrn       text,
  draft_identifier_type   text CHECK (draft_identifier_type IS NULL OR draft_identifier_type IN ('NationalId','Passport')),
  draft_identifier_enc    bytea,
  current_status          text NOT NULL DEFAULT 'Draft' CHECK (current_status IN
                            ('Draft','PendingClinicResponse','PendingProviderEmail','SentToProviderAwaitingResponse',
                             'Confirmed','Rejected','Withdrawn','Completed')),
  status_changed_at       timestamptz NOT NULL DEFAULT now(),
  created_by_user_id      uuid NOT NULL REFERENCES portal_user(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  submitted_at            timestamptz,
  confirmed_at            timestamptz,
  completed_at            timestamptz,
  row_version             integer NOT NULL DEFAULT 1,
  CONSTRAINT travel_dates_order CHECK (travel_end_date IS NULL OR travel_start_date IS NULL OR travel_end_date > travel_start_date),
  CONSTRAINT sessions_positive  CHECK (sessions_required IS NULL OR sessions_required > 0),
  -- §14.5 conditional destination: enforced once the request leaves Draft
  CONSTRAINT submitted_complete CHECK (current_status = 'Draft' OR (
      patient_reference_id IS NOT NULL AND destination_type IS NOT NULL AND travel_start_date IS NOT NULL AND travel_end_date IS NOT NULL
      AND sessions_required IS NOT NULL AND destination_city IS NOT NULL)),
  CONSTRAINT internal_needs_clinic CHECK (current_status = 'Draft' OR destination_type <> 'Internal' OR receiving_facility_id IS NOT NULL),
  CONSTRAINT external_needs_facility CHECK (current_status = 'Draft' OR destination_type <> 'ExternalKSA' OR receiving_facility_id IS NOT NULL),
  CONSTRAINT international_needs_target CHECK (current_status = 'Draft' OR destination_type <> 'International'
      OR receiving_facility_id IS NOT NULL OR (free_text_facility IS NOT NULL AND destination_country IS NOT NULL))
);
CREATE INDEX hdr_patient_idx          ON holiday_dialysis_request (patient_reference_id);
CREATE INDEX hdr_status_updated_idx   ON holiday_dialysis_request (current_status, updated_at DESC);
CREATE INDEX hdr_requesting_idx       ON holiday_dialysis_request (requesting_facility_id, created_at DESC);
CREATE INDEX hdr_receiving_idx        ON holiday_dialysis_request (receiving_facility_id, current_status);
CREATE INDEX hdr_dest_status_idx      ON holiday_dialysis_request (destination_type, current_status);
CREATE INDEX hdr_travel_start_idx     ON holiday_dialysis_request (travel_start_date);

CREATE TABLE request_status_history (
  id                  bigserial PRIMARY KEY,
  request_id          uuid NOT NULL REFERENCES holiday_dialysis_request(id),
  from_status         text NOT NULL,
  to_status           text NOT NULL,
  action_code         text NOT NULL,
  title               text NOT NULL,
  note                text,
  changed_by_user_id  uuid REFERENCES portal_user(id),
  changed_at          timestamptz NOT NULL DEFAULT now(),
  correlation_id      uuid
);
CREATE INDEX rsh_request_idx ON request_status_history (request_id, changed_at);

CREATE TABLE request_decision (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id           uuid NOT NULL REFERENCES holiday_dialysis_request(id),
  decision_type        text NOT NULL CHECK (decision_type IN ('Approved','Rejected','Declined')),
  decision_source      text NOT NULL CHECK (decision_source IN ('ReceivingDiaverumClinic','ExternalProvider')),
  confirmed_start_date date,
  confirmed_end_date   date,
  reason               text,
  notes                text,
  decided_by_user_id   uuid NOT NULL REFERENCES portal_user(id),
  decided_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_needs_dates CHECK (decision_type <> 'Approved' OR (confirmed_start_date IS NOT NULL AND confirmed_end_date IS NOT NULL AND confirmed_end_date >= confirmed_start_date)),
  CONSTRAINT refusal_needs_reason CHECK (decision_type = 'Approved' OR length(trim(coalesce(reason,''))) >= 10)
);
CREATE INDEX rd_request_idx ON request_decision (request_id, decided_at);

CREATE TABLE request_document (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id           uuid NOT NULL REFERENCES holiday_dialysis_request(id),
  document_type        text NOT NULL CHECK (document_type IN ('MOHApproval','MODApproval','MedicalReport','SerologyReport','IDCopy','ProviderReply','ConfirmationLetter','OtherApproved')),
  file_name            text NOT NULL,
  storage_key          text NOT NULL,
  content_type         text NOT NULL,
  file_size_bytes      integer NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),
  file_hash            text NOT NULL,
  source_system        text NOT NULL DEFAULT 'PortalUpload' CHECK (source_system IN ('PortalUpload','DCareReference','GeneratedByPortal','ProviderEmail')),
  dcare_document_id    text,
  uploaded_by_user_id  uuid NOT NULL REFERENCES portal_user(id),
  uploaded_at          timestamptz NOT NULL DEFAULT now(),
  malware_scan_status  text NOT NULL DEFAULT 'NotScanned' CHECK (malware_scan_status IN ('NotScanned','Pending','Clean','Infected','Failed')),
  is_current           boolean NOT NULL DEFAULT true
);
CREATE INDEX rdoc_request_idx ON request_document (request_id, uploaded_at);
CREATE UNIQUE INDEX rdoc_one_current_per_type ON request_document (request_id, document_type)
  WHERE is_current AND document_type NOT IN ('ProviderReply','OtherApproved');

CREATE TABLE request_comment (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id          uuid NOT NULL REFERENCES holiday_dialysis_request(id),
  comment_text        text NOT NULL CHECK (length(trim(comment_text)) BETWEEN 1 AND 2000),
  created_by_user_id  uuid NOT NULL REFERENCES portal_user(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  is_deleted          boolean NOT NULL DEFAULT false
);
CREATE INDEX rcom_request_idx ON request_comment (request_id, created_at);

CREATE TABLE provider_communication (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id           uuid NOT NULL REFERENCES holiday_dialysis_request(id),
  facility_id          uuid REFERENCES facility(id),
  direction            text NOT NULL CHECK (direction IN ('Outbound','Inbound')),
  message_type         text NOT NULL CHECK (message_type IN ('Send','Resend','Reminder','Reply')),
  subject              text,
  body                 text,
  recipient_to         text,
  recipient_cc         text,
  sent_by_user_id      uuid REFERENCES portal_user(id),
  sent_at              timestamptz NOT NULL DEFAULT now(),
  delivery_status      text NOT NULL DEFAULT 'Sent' CHECK (delivery_status IN ('Sent','Failed','Logged','Recorded')),
  external_message_id  text,
  reply_document_id    uuid REFERENCES request_document(id)
);
CREATE INDEX pcomm_request_idx ON provider_communication (request_id, sent_at);

-- ---------------------------------------------------------------- notifications, templates, SLA, letters
CREATE TABLE notification (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES portal_user(id),
  request_id         uuid REFERENCES holiday_dialysis_request(id),
  notification_type  text NOT NULL,
  title              text NOT NULL,
  message            text NOT NULL,
  channel            text NOT NULL DEFAULT 'InPortal' CHECK (channel IN ('InPortal','Email')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  sent_at            timestamptz,
  read_at            timestamptz,
  delivery_status    text NOT NULL DEFAULT 'Pending' CHECK (delivery_status IN ('Pending','Sent','Failed','NotRequired'))
);
CREATE INDEX notif_user_idx ON notification (user_id, created_at DESC);
CREATE INDEX notif_request_type_idx ON notification (request_id, notification_type, created_at DESC);

CREATE TABLE notification_template (
  id                  bigserial PRIMARY KEY,
  template_code       text NOT NULL,
  template_name       text NOT NULL,
  description         text,
  channel             text NOT NULL DEFAULT 'Email' CHECK (channel IN ('Email','SMS')),
  subject_template    text NOT NULL,
  body_template       text NOT NULL,
  version             integer NOT NULL,
  is_active           boolean NOT NULL DEFAULT true,
  updated_by_user_id  uuid REFERENCES portal_user(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_code, version)
);
CREATE UNIQUE INDEX ntpl_one_active ON notification_template (template_code) WHERE is_active;

CREATE TABLE sla_rule (
  stage_code                text PRIMARY KEY CHECK (stage_code IN ('PendingClinicResponse','PendingProviderEmail','SentToProviderAwaitingResponse','Completion')),
  target_days               integer NOT NULL CHECK (target_days BETWEEN 1 AND 60),
  reminder_frequency_days   integer NOT NULL CHECK (reminder_frequency_days BETWEEN 1 AND 30),
  updated_by_user_id        uuid REFERENCES portal_user(id),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE generated_letter (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id            uuid NOT NULL REFERENCES holiday_dialysis_request(id),
  decision_id           uuid NOT NULL REFERENCES request_decision(id),
  template_version      integer NOT NULL DEFAULT 1,
  generated_at          timestamptz NOT NULL DEFAULT now(),
  generated_by_user_id  uuid REFERENCES portal_user(id)
);

-- ---------------------------------------------------------------- operations & audit
CREATE TABLE integration_log (
  id                       bigserial PRIMARY KEY,
  interface_name           text NOT NULL,
  direction                text NOT NULL,
  entity_type              text,
  entity_key               text,
  started_at               timestamptz NOT NULL DEFAULT now(),
  completed_at             timestamptz,
  result                   text,
  attempt_number           integer NOT NULL DEFAULT 1,
  correlation_id           uuid,
  error_code               text,
  error_message_sanitized  text
);

CREATE TABLE reference_import_batch (
  id                   bigserial PRIMARY KEY,
  import_type          text NOT NULL,
  file_name            text NOT NULL,
  file_hash            text NOT NULL,
  imported_by_user_id  uuid REFERENCES portal_user(id),
  imported_at          timestamptz NOT NULL DEFAULT now(),
  total_rows           integer NOT NULL DEFAULT 0,
  accepted_rows        integer NOT NULL DEFAULT 0,
  rejected_rows        integer NOT NULL DEFAULT 0,
  status               text NOT NULL DEFAULT 'Completed'
);

CREATE TABLE audit_event (
  id               bigserial PRIMARY KEY,
  event_timestamp  timestamptz NOT NULL DEFAULT now(),
  actor_user_id    uuid REFERENCES portal_user(id),
  actor_type       text NOT NULL DEFAULT 'User' CHECK (actor_type IN ('User','System')),
  action_code      text NOT NULL,
  entity_type      text NOT NULL,
  entity_id        text NOT NULL,
  detail           jsonb,
  result           text NOT NULL DEFAULT 'Success',
  correlation_id   uuid,
  ip_address       text
);
CREATE INDEX audit_ts_idx ON audit_event (event_timestamp DESC);
CREATE INDEX audit_entity_idx ON audit_event (entity_type, entity_id);

-- ---------------------------------------------------------------- append-only enforcement (§14.5 Immutability)
CREATE OR REPLACE FUNCTION forbid_update_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER audit_event_append_only           BEFORE UPDATE OR DELETE ON audit_event            FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER request_status_history_append_only BEFORE UPDATE OR DELETE ON request_status_history FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER request_decision_append_only      BEFORE UPDATE OR DELETE ON request_decision       FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER provider_communication_append_only BEFORE UPDATE OR DELETE ON provider_communication FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER generated_letter_append_only      BEFORE UPDATE OR DELETE ON generated_letter       FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
