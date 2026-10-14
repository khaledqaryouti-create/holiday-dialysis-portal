-- 009_alternative_dates.sql — the receiving clinic or provider can propose other dates instead of declining.
-- New status AlternativeDatesProposed: waiting for the requesting clinic to accept one option, ask for other dates,
-- or withdraw. Up to 3 options per proposal; every proposal and answer is kept.

-- 1) status values
ALTER TABLE holiday_dialysis_request DROP CONSTRAINT holiday_dialysis_request_current_status_check;
ALTER TABLE holiday_dialysis_request ADD CONSTRAINT holiday_dialysis_request_current_status_check CHECK (current_status IN
  ('Draft','PendingClinicResponse','PendingProviderEmail','SentToProviderAwaitingResponse','AlternativeDatesProposed',
   'Confirmed','Rejected','Withdrawn','Completed'));

-- 2) SLA stage for the requester's answer (default: 2 days, reminder every day)
ALTER TABLE sla_rule DROP CONSTRAINT sla_rule_stage_code_check;
ALTER TABLE sla_rule ADD CONSTRAINT sla_rule_stage_code_check CHECK (stage_code IN
  ('PendingClinicResponse','PendingProviderEmail','SentToProviderAwaitingResponse','AlternativeDatesProposed','Completion'));
INSERT INTO sla_rule (stage_code, target_days, reminder_frequency_days) VALUES ('AlternativeDatesProposed', 2, 1)
  ON CONFLICT (stage_code) DO NOTHING;

-- 3) proposals and their date options
CREATE TABLE request_date_proposal (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id            uuid NOT NULL REFERENCES holiday_dialysis_request(id),
  round_no              integer NOT NULL CHECK (round_no BETWEEN 1 AND 3),
  proposal_source       text NOT NULL CHECK (proposal_source IN ('ReceivingDiaverumClinic','ExternalProvider')),
  message               text,
  reply_document_id     uuid REFERENCES request_document(id),
  proposed_by_user_id   uuid NOT NULL REFERENCES portal_user(id),
  proposed_at           timestamptz NOT NULL DEFAULT now(),
  -- the requesting clinic's answer
  outcome               text NOT NULL DEFAULT 'Open' CHECK (outcome IN ('Open','Accepted','OtherDatesRequested','Withdrawn')),
  accepted_option_id    uuid,
  response_note         text,
  responded_by_user_id  uuid REFERENCES portal_user(id),
  responded_at          timestamptz,
  UNIQUE (request_id, round_no)
);
CREATE UNIQUE INDEX rdp_one_open ON request_date_proposal (request_id) WHERE outcome = 'Open';

CREATE TABLE request_date_option (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id   uuid NOT NULL REFERENCES request_date_proposal(id),
  option_no     integer NOT NULL CHECK (option_no BETWEEN 1 AND 3),
  start_date    date NOT NULL,
  end_date      date NOT NULL,
  sessions      integer CHECK (sessions IS NULL OR sessions BETWEEN 1 AND 60),
  note          text,
  CONSTRAINT option_dates_order CHECK (end_date > start_date),
  UNIQUE (proposal_id, option_no)
);
ALTER TABLE request_date_proposal ADD CONSTRAINT rdp_accepted_option_fk FOREIGN KEY (accepted_option_id) REFERENCES request_date_option(id);

-- Options never change once proposed (the proposal row only records the answer).
CREATE TRIGGER request_date_option_append_only BEFORE UPDATE OR DELETE ON request_date_option FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

ALTER TABLE request_date_proposal ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_date_option ENABLE ROW LEVEL SECURITY;

-- 4) email templates (editable in Admin Settings → Notification Templates)
INSERT INTO notification_template (template_code, template_name, description, subject_template, body_template, version)
SELECT 'DatesProposed', 'Other dates proposed', 'Sent to the requester when the receiving clinic or provider proposes other dates',
  'Other dates proposed for request {{Request ID}}',
  E'Dear {{Requester}},\n\n{{Provider Name}} cannot take {{Patient Initials}} on the requested dates ({{Travel Dates}}) and has proposed other dates.\n\nPlease sign in to the Holiday Dialysis Coordination Portal to accept one of the options, ask for other dates, or withdraw the request.',
  1
WHERE NOT EXISTS (SELECT 1 FROM notification_template WHERE template_code = 'DatesProposed');

INSERT INTO notification_template (template_code, template_name, description, subject_template, body_template, version)
SELECT 'OtherDatesRequested', 'Other dates requested', 'Sent when the requester asks for different dates',
  'Different dates requested for {{Request ID}}',
  E'Dear team,\n\nThe requesting clinic could not use the dates proposed for request {{Request ID}} (patient {{Patient Initials}}).\n\nReason: {{Reason}}\n\nPlease sign in to the portal to review the request and propose other dates, approve, or decline.',
  1
WHERE NOT EXISTS (SELECT 1 FROM notification_template WHERE template_code = 'OtherDatesRequested');
