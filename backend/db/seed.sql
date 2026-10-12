-- seed.sql — development/sample data. Run with `npm run db:seed` (sets app.field_key from FIELD_ENCRYPTION_KEY).
-- All people, patients, emails and identifiers below are fictional. Provider emails use the reserved .example domain.

INSERT INTO role (role_code, role_name) VALUES
  ('CLINIC_STAFF','Clinic Staff'),
  ('COORD_INTERNAL','Coordination Team – Internal'),
  ('COORD_INTERNATIONAL','Coordination Team – International'),
  ('IT_ADMIN','IT Admin');

INSERT INTO country (country_code, country_name) VALUES
  ('SA','Saudi Arabia'),('BH','Bahrain'),('EG','Egypt'),('IN','India'),('ID','Indonesia'),('JO','Jordan'),
  ('MY','Malaysia'),('MA','Morocco'),('PK','Pakistan'),('TR','Turkey'),('AE','United Arab Emirates'),('GB','United Kingdom');

INSERT INTO city (country_code, city_name) VALUES
  ('SA','Riyadh'),('SA','Jeddah'),('SA','Makkah'),('SA','Madinah'),('SA','Dammam'),('SA','Khobar'),('SA','Abha'),('SA','Tabuk'),('SA','Taif'),
  ('TR','Istanbul'),('EG','Cairo'),('AE','Dubai'),('GB','London'),('MY','Kuala Lumpur'),('JO','Amman');

INSERT INTO provider (provider_code, provider_name, provider_type) VALUES
  ('DAVITA','DaVita','ExternalKSA'),('ALMUWASAT','Al Muwasat','ExternalKSA'),('BUPA','Bupa','ExternalKSA'),
  ('INTL','International facilities','International');

-- facilities: (code, name, type, provider_code, country, city, branch, email, cc, active)
INSERT INTO facility (facility_code, facility_name, facility_type, provider_id, country_code, city_id, branch_name, contact_email, cc_email, is_active, last_verified_at, source_system)
SELECT v.code, v.name, v.ftype, p.id, v.cc2, c.id, v.branch, v.email, NULLIF(v.cc,''), v.active, now() - interval '21 days', 'ExcelImport'
FROM (VALUES
  ('RUH-N','Riyadh North Clinic','DiaverumClinic',NULL,'SA','Riyadh','Al Malqa','riyadh.north@clinics.example','',true),
  ('JED-C','Jeddah Central Clinic','DiaverumClinic',NULL,'SA','Jeddah','Al Hamra','jeddah.central@clinics.example','',true),
  ('DMM-E','Dammam East Clinic','DiaverumClinic',NULL,'SA','Dammam','Al Nuzha','dammam.east@clinics.example','',true),
  ('MED-K','Madinah Clinic','DiaverumClinic',NULL,'SA','Madinah','King Fahd','madinah@clinics.example','',true),
  ('AHB-S','Abha Clinic','DiaverumClinic',NULL,'SA','Abha','Al Soudah','abha@clinics.example','',true),
  ('MKK-A','Makkah Clinic','DiaverumClinic',NULL,'SA','Makkah','Al Aziziyah','makkah@clinics.example','',true),
  ('TUU-U','Tabuk Clinic','DiaverumClinic',NULL,'SA','Tabuk','Al Ulaya','tabuk@clinics.example','',false),
  ('DV-JED','DaVita Jeddah','ExternalKSAProviderBranch','DAVITA','SA','Jeddah','Al Rawdah','holiday.jeddah@davita-provider.example','dialysis.ops@davita-provider.example',true),
  ('DV-RUH','DaVita Riyadh','ExternalKSAProviderBranch','DAVITA','SA','Riyadh','Olaya','holiday.riyadh@davita-provider.example','dialysis.ops@davita-provider.example',true),
  ('DV-MKK','DaVita Makkah','ExternalKSAProviderBranch','DAVITA','SA','Makkah','Al Awali','holiday.makkah@davita-provider.example','',true),
  ('AM-JED','Al Muwasat Jeddah','ExternalKSAProviderBranch','ALMUWASAT','SA','Jeddah','Al Safa','intl.desk.jeddah@almuwasat-provider.example','dialysis@almuwasat-provider.example',true),
  ('AM-MED','Al Muwasat Madinah','ExternalKSAProviderBranch','ALMUWASAT','SA','Madinah','Quba','intl.desk.madinah@almuwasat-provider.example','',true),
  ('BP-RUH','Bupa Riyadh','ExternalKSAProviderBranch','BUPA','SA','Riyadh','King Abdullah Rd','renal.riyadh@bupa-provider.example','',true),
  ('BP-KHB','Bupa Khobar','ExternalKSAProviderBranch','BUPA','SA','Khobar','Corniche','renal.khobar@bupa-provider.example','',true),
  ('INT-IST','Bosphorus Dialysis Centre','InternationalFacility','INTL','TR','Istanbul','Şişli','travel@bosphorus-dialysis.example','',true),
  ('INT-CAI','Nile Kidney Care','InternationalFacility','INTL','EG','Cairo','Heliopolis','bookings@nilekidney.example','',true),
  ('INT-DXB','Gulf Renal Centre Dubai','InternationalFacility','INTL','AE','Dubai','Al Barsha','holiday@gulfrenal.example','',true),
  ('INT-LON','Thames Holiday Dialysis Unit','InternationalFacility','INTL','GB','London','Paddington','visitors@thamesdialysis.example','',true),
  ('INT-KUL','Klang Valley Dialysis','InternationalFacility','INTL','MY','Kuala Lumpur','Bangsar','intl@klangdialysis.example','',true),
  ('INT-AMM','Amman Renal Clinic','InternationalFacility','INTL','JO','Amman','Abdoun','visitors@ammanrenal.example','',true)
) AS v(code,name,ftype,pcode,cc2,city,branch,email,cc,active)
LEFT JOIN provider p ON p.provider_code = v.pcode
LEFT JOIN city c ON c.country_code = v.cc2 AND c.city_name = v.city;

-- users (fixed ids so the dev login list is stable)
INSERT INTO portal_user (id, email, display_name, account_status, last_sign_in_at) VALUES
  ('a0000000-0000-4000-8000-000000000001','laila.alharbi@clinics.example','Laila Al-Harbi','Active', now() - interval '1 day'),
  ('a0000000-0000-4000-8000-000000000002','omar.khan@clinics.example','Omar Khan','Active', now() - interval '1 day'),
  ('a0000000-0000-4000-8000-000000000003','sara.ahmed@clinics.example','Sara Ahmed','Active', now() - interval '1 day'),
  ('a0000000-0000-4000-8000-000000000004','faisal.mahmoud@clinics.example','Faisal Mahmoud','Active', now() - interval '1 day'),
  ('a0000000-0000-4000-8000-000000000005','noor.alqahtani@clinics.example','Noor Al-Qahtani','Active', now() - interval '3 days'),
  ('a0000000-0000-4000-8000-000000000006','ziad.almutairi@clinics.example','Ziad Al-Mutairi','Active', now() - interval '1 day'),
  ('a0000000-0000-4000-8000-000000000007','reem.alotaibi@clinics.example','Reem Al-Otaibi','Inactive', now() - interval '40 days'),
  ('a0000000-0000-4000-8000-000000000008','hana.saleh@clinics.example','Hana Saleh','Active', now() - interval '2 days'),
  ('a0000000-0000-4000-8000-000000000009','majed.alshamrani@clinics.example','Majed Al-Shamrani','Active', now() - interval '1 day');

INSERT INTO user_role (user_id, role_code, effective_from)
SELECT u.id, v.role, current_date - 365 FROM (VALUES
  ('laila.alharbi@clinics.example','CLINIC_STAFF'),('omar.khan@clinics.example','CLINIC_STAFF'),
  ('sara.ahmed@clinics.example','COORD_INTERNAL'),('faisal.mahmoud@clinics.example','COORD_INTERNATIONAL'),
  ('noor.alqahtani@clinics.example','CLINIC_STAFF'),('ziad.almutairi@clinics.example','IT_ADMIN'),
  ('reem.alotaibi@clinics.example','CLINIC_STAFF'),('hana.saleh@clinics.example','CLINIC_STAFF'),
  ('majed.alshamrani@clinics.example','CLINIC_STAFF')
) AS v(email, role) JOIN portal_user u ON u.email = v.email;

INSERT INTO user_clinic_scope (user_id, facility_id, effective_from)
SELECT u.id, f.id, current_date - 365 FROM (VALUES
  ('laila.alharbi@clinics.example','RUH-N'),('omar.khan@clinics.example','JED-C'),('noor.alqahtani@clinics.example','DMM-E'),
  ('reem.alotaibi@clinics.example','AHB-S'),('hana.saleh@clinics.example','MED-K'),('majed.alshamrani@clinics.example','MKK-A')
) AS v(email, code) JOIN portal_user u ON u.email = v.email JOIN facility f ON f.facility_code = v.code;

-- patients (identifiers encrypted with the app key)
INSERT INTO patient_reference (mrn, identifier_type, national_identifier_enc, national_identifier_hash, national_identifier_last2, full_name, home_facility_id, modality, source_system, source_retrieved_at)
SELECT v.mrn, v.idtype,
       pgp_sym_encrypt(v.nid, current_setting('app.field_key')),
       encode(hmac(upper(v.nid), current_setting('app.field_key'), 'sha256'), 'hex'),
       right(v.nid, 2), v.name, f.id, v.modality, 'Manual', now()
FROM (VALUES
  ('248211','NationalId','1048293751','Ahmad Saleh Al-Ghamdi','RUH-N','Haemodialysis'),
  ('239174','NationalId','1093827465','Fatimah Ali Al-Zahrani','RUH-N','Haemodialysis'),
  ('251356','NationalId','2384756190','Mohammed Yusuf Rahman','RUH-N','Haemodiafiltration'),
  ('262198','NationalId','1102938475','Huda Abdullah Al-Shehri','RUH-N','Haemodialysis'),
  ('246420','NationalId','1029384756','Khalid Nasser Al-Dossary','DMM-E','Haemodialysis'),
  ('270903','Passport','P4829174','Maryam Hassan Qureshi','JED-C','Haemodialysis'),
  ('241284','NationalId','1065748392','Abdulrahman Saad Al-Otaibi','RUH-N','Haemodialysis'),
  ('255678','NationalId','1076859403','Noura Fahad Al-Subaie','JED-C','Haemodiafiltration'),
  ('233451','NationalId','1087695041','Yousef Ibrahim Al-Harthi','DMM-E','Haemodialysis'),
  ('268812','NationalId','2109384756','Aisha Omar Bakr','MED-K','Haemodialysis'),
  ('244907','NationalId','1012398475','Saleh Mansour Al-Qahtani','RUH-N','Haemodialysis'),
  ('259033','NationalId','1056473829','Reem Tariq Al-Amri','JED-C','Haemodialysis'),
  ('236690','NationalId','1034987162','Ibrahim Khalil Hakami','RUH-N','Haemodialysis')
) AS v(mrn, idtype, nid, name, home, modality) JOIN facility f ON f.facility_code = v.home;

INSERT INTO sla_rule (stage_code, target_days, reminder_frequency_days) VALUES
  ('PendingClinicResponse',2,1),('PendingProviderEmail',1,1),('SentToProviderAwaitingResponse',3,2),('Completion',3,1);

INSERT INTO notification_template (template_code, template_name, description, subject_template, body_template, version) VALUES
('Submitted','Submitted','Sent to the requester on submission','Request {{Request ID}} submitted',
 E'Dear {{Requester}},\n\nYour holiday dialysis request {{Request ID}} for patient {{Patient Initials}} has been submitted.\n\nDestination: {{Destination}}\nTravel dates: {{Travel Dates}}\n\nYou can follow progress in the Holiday Dialysis Coordination Portal.',1),
('ClinicActionRequired','Clinic action required','Sent to the receiving clinic','Action required: holiday dialysis request {{Request ID}}',
 E'Dear {{Clinic Name}} team,\n\nA holiday dialysis request is waiting for your response.\n\nPatient: {{Patient Initials}} (MRN {{MRN Masked}})\nTravel dates: {{Travel Dates}}\nSessions: {{Sessions}}\n\nPlease sign in to the portal to approve or reject the request.',1),
('NewProviderRequest','New request for coordination','Sent to the Coordination Team – International','New request to email: {{Request ID}}',
 E'Dear team,\n\nRequest {{Request ID}} ({{Destination Type}}) for {{Patient Initials}} is ready to send to {{Provider Name}}.\n\nTravel dates: {{Travel Dates}}',1),
('ProviderEmail','Provider email','Sent to external providers by "Send to Provider"','Dialysis coordination request – Patient {{Patient Initials}} – Travel {{Travel Dates}}',
 E'Dear {{Provider Name}} team,\n\nPlease find attached a request for holiday dialysis for our patient, who will be travelling to {{Destination}}. We kindly ask you to confirm availability and acceptance for the requested period.\n\nPatient: {{Patient Initials}} (MRN {{MRN Masked}})\nTravel dates: {{Travel Dates}}\nSessions requested: {{Sessions}}\nModality: {{Modality}}\n\nAttached: MOH approval, medical report and supporting documents.\n\nPlease reply to this email with the confirmed session dates, or let us know if you cannot accept the patient.\n\nKind regards,\nHoliday Dialysis Coordination Team',1),
('Reminder','Reminder','Sent when a step passes its SLA target','Reminder: action required for request {{Request ID}}',
 E'Dear team,\n\nRequest {{Request ID}} for patient {{Patient Initials}} has been at "{{Status}}" for {{Days Pending}} days, past the {{Target Days}}-day target.\n\nDestination: {{Destination}}\nTravel dates: {{Travel Dates}}\n\nPlease sign in to the portal to review it.',1),
('Confirmed','Confirmed','Sent to the requester when sessions are confirmed','Confirmed: holiday dialysis request {{Request ID}}',
 E'Dear {{Requester}},\n\nSessions for {{Patient Initials}} at {{Provider Name}} have been confirmed: {{Confirmed Dates}}.\n\nThe confirmation letter is available in the portal.',1),
('Rejected','Rejected','Sent to the requester when a request is rejected or declined','Not accepted: holiday dialysis request {{Request ID}}',
 E'Dear {{Requester}},\n\nRequest {{Request ID}} for {{Patient Initials}} was not accepted by {{Provider Name}}.\n\nReason: {{Reason}}\n\nYou can submit a new request to rebook.',1),
('Withdrawn','Withdrawn','Sent to the coordination team (and receiving clinic) on withdrawal','Withdrawn: request {{Request ID}}',
 E'Dear team,\n\nRequest {{Request ID}} has been withdrawn by {{Requester}}. No further action is needed.',1),
('Completed','Completed','Sent to the requester on completion','Completed: request {{Request ID}}',
 E'Dear {{Requester}},\n\nRequest {{Request ID}} has been marked as completed.',1),
('AccountCreated','Account created','Sent to a new user when IT adds them','Your Holiday Dialysis Coordination Portal access',
 E'Dear {{Name}},\n\nYou now have access to the Holiday Dialysis Coordination Portal. Sign in with your organisation account at {{Portal Link}}.',1);

-- ---------------------------------------------------------------- sample requests with realistic history
CREATE OR REPLACE FUNCTION pg_temp.seed_request(
  p_mrn text, p_creator text, p_dest text, p_fac text, p_start int, p_len int, p_sessions int,
  p_final text, p_created_ago numeric, p_final_ago numeric, p_reason text DEFAULT NULL, p_mod boolean DEFAULT false, p_serology boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_req uuid; v_num text; v_creator uuid; v_home uuid; v_pat uuid; v_fac facility%ROWTYPE; v_city text;
  v_path text[]; v_prev text := 'Draft'; v_at timestamptz; v_actor uuid; v_title text; v_note text; v_i int; v_n int;
  v_cx uuid := 'a0000000-0000-4000-8000-000000000004'; v_ci uuid := 'a0000000-0000-4000-8000-000000000003';
  v_dec uuid; v_ext boolean := p_dest <> 'Internal'; v_doc text; v_created timestamptz;
BEGIN
  SELECT u.id, s.facility_id INTO v_creator, v_home FROM portal_user u JOIN user_clinic_scope s ON s.user_id = u.id WHERE u.email = p_creator;
  SELECT id INTO v_pat FROM patient_reference WHERE mrn = p_mrn;
  SELECT * INTO v_fac FROM facility WHERE facility_code = p_fac;
  SELECT city_name INTO v_city FROM city WHERE id = v_fac.city_id;
  v_num := 'HD-' || to_char(now(),'YYYY') || '-' || lpad(nextval('request_number_seq')::text, 5, '0');
  v_created := now() - make_interval(secs => (p_created_ago * 86400)::int);
  INSERT INTO holiday_dialysis_request (request_number, patient_reference_id, requesting_facility_id, receiving_facility_id, destination_type,
      destination_country, destination_city, travel_start_date, travel_end_date, sessions_required, mod_applies, created_by_user_id,
      created_at, updated_at, status_changed_at)
  VALUES (v_num, v_pat, v_home, v_fac.id, p_dest, v_fac.country_code, v_city, current_date + p_start, current_date + p_start + p_len,
      p_sessions, p_mod, v_creator, v_created, v_created, v_created)
  RETURNING id INTO v_req;

  FOREACH v_doc IN ARRAY ARRAY['MOHApproval','MedicalReport','IDCopy'] || CASE WHEN p_serology THEN ARRAY['SerologyReport'] ELSE ARRAY[]::text[] END
                                                                 || CASE WHEN p_mod THEN ARRAY['MODApproval'] ELSE ARRAY[]::text[] END LOOP
    INSERT INTO request_document (request_id, document_type, file_name, storage_key, content_type, file_size_bytes, file_hash, uploaded_by_user_id, uploaded_at, malware_scan_status)
    VALUES (v_req, v_doc, v_doc || '_' || v_num || '.pdf', 'seed/sample.pdf', 'application/pdf', 131072, 'seed', v_creator, v_created, 'Clean');
  END LOOP;

  v_path := CASE
    WHEN p_final = 'Draft' THEN ARRAY[]::text[]
    WHEN p_final IN ('PendingClinicResponse','PendingProviderEmail') THEN ARRAY[p_final]
    WHEN p_final = 'SentToProviderAwaitingResponse' THEN ARRAY['PendingProviderEmail','SentToProviderAwaitingResponse']
    WHEN p_final = 'Withdrawn' THEN (CASE WHEN v_ext THEN ARRAY['PendingProviderEmail'] ELSE ARRAY['PendingClinicResponse'] END) || ARRAY['Withdrawn']
    ELSE (CASE WHEN v_ext THEN ARRAY['PendingProviderEmail','SentToProviderAwaitingResponse'] ELSE ARRAY['PendingClinicResponse'] END)
         || CASE WHEN p_final = 'Completed' THEN ARRAY['Confirmed','Completed'] ELSE ARRAY[p_final] END
  END;
  v_n := coalesce(array_length(v_path,1),0);

  FOR v_i IN 1..v_n LOOP
    v_at := CASE WHEN v_i = v_n THEN now() - make_interval(secs => (p_final_ago * 86400)::int)
                 ELSE v_created + make_interval(secs => (LEAST(v_i * 1.3, (p_created_ago - p_final_ago) * v_i / v_n) * 86400)::int) END;
    v_actor := v_creator; v_note := NULL;
    CASE v_path[v_i]
      WHEN 'PendingClinicResponse' THEN v_title := 'Request submitted'; v_note := 'Sent to ' || v_fac.facility_name || ' for a response.';
        UPDATE holiday_dialysis_request SET submitted_at = v_at WHERE id = v_req;
      WHEN 'PendingProviderEmail' THEN v_title := 'Request submitted'; v_note := 'Sent to Coordination Team – International.';
        UPDATE holiday_dialysis_request SET submitted_at = v_at WHERE id = v_req;
      WHEN 'SentToProviderAwaitingResponse' THEN v_actor := v_cx; v_title := 'Emailed to provider'; v_note := 'Sent to ' || v_fac.facility_name || ' (' || v_fac.contact_email || ').';
        UPDATE holiday_dialysis_request SET selected_facility_id = v_fac.id WHERE id = v_req;
        INSERT INTO provider_communication (request_id, facility_id, direction, message_type, subject, recipient_to, recipient_cc, sent_by_user_id, sent_at, delivery_status)
        VALUES (v_req, v_fac.id, 'Outbound', 'Send', 'Dialysis coordination request – ' || v_num, v_fac.contact_email, v_fac.cc_email, v_cx, v_at, 'Logged');
      WHEN 'Confirmed' THEN
        v_actor := CASE WHEN v_ext THEN v_cx ELSE coalesce((SELECT s.user_id FROM user_clinic_scope s JOIN portal_user u ON u.id = s.user_id WHERE s.facility_id = v_fac.id ORDER BY u.account_status LIMIT 1), v_ci) END;
        v_title := CASE WHEN v_ext THEN 'Provider response recorded – Approved' ELSE 'Approved by receiving clinic' END;
        v_note := 'Confirmed sessions ' || to_char(current_date + p_start,'DD Mon') || ' – ' || to_char(current_date + p_start + p_len,'DD Mon YYYY') || '.';
        INSERT INTO request_decision (request_id, decision_type, decision_source, confirmed_start_date, confirmed_end_date, decided_by_user_id, decided_at)
        VALUES (v_req, 'Approved', CASE WHEN v_ext THEN 'ExternalProvider' ELSE 'ReceivingDiaverumClinic' END, current_date + p_start, current_date + p_start + p_len, v_actor, v_at)
        RETURNING id INTO v_dec;
        INSERT INTO generated_letter (request_id, decision_id, generated_at, generated_by_user_id) VALUES (v_req, v_dec, v_at, v_actor);
        UPDATE holiday_dialysis_request SET confirmed_at = v_at WHERE id = v_req;
      WHEN 'Rejected' THEN
        v_actor := CASE WHEN v_ext THEN v_cx ELSE coalesce((SELECT s.user_id FROM user_clinic_scope s WHERE s.facility_id = v_fac.id LIMIT 1), v_ci) END;
        v_title := CASE WHEN v_ext THEN 'Provider response recorded – Declined' ELSE 'Rejected by receiving clinic' END; v_note := p_reason;
        INSERT INTO request_decision (request_id, decision_type, decision_source, reason, decided_by_user_id, decided_at)
        VALUES (v_req, CASE WHEN v_ext THEN 'Declined' ELSE 'Rejected' END, CASE WHEN v_ext THEN 'ExternalProvider' ELSE 'ReceivingDiaverumClinic' END, p_reason, v_actor, v_at);
      WHEN 'Completed' THEN v_actor := CASE WHEN v_ext THEN v_cx ELSE v_ci END; v_title := 'Marked as completed';
        UPDATE holiday_dialysis_request SET completed_at = v_at WHERE id = v_req;
      WHEN 'Withdrawn' THEN v_title := 'Request withdrawn'; v_note := coalesce(p_reason, 'Withdrawn by the requesting clinic.');
    END CASE;
    INSERT INTO request_status_history (request_id, from_status, to_status, action_code, title, note, changed_by_user_id, changed_at)
    VALUES (v_req, v_prev, v_path[v_i], 'seed', v_title, v_note, v_actor, v_at);
    INSERT INTO audit_event (event_timestamp, actor_user_id, action_code, entity_type, entity_id, detail)
    VALUES (v_at, v_actor, 'StatusChange', 'Request', v_num, jsonb_build_object('from', v_prev, 'to', v_path[v_i], 'source', 'seed'));
    UPDATE holiday_dialysis_request SET current_status = v_path[v_i], status_changed_at = v_at, updated_at = v_at, row_version = row_version + 1 WHERE id = v_req;
    v_prev := v_path[v_i];
  END LOOP;
  RETURN v_req;
END $$;

-- historical, for reports (older than 5 weeks)
SELECT pg_temp.seed_request(m, c, d, f, -ago + 14, len, ceil(len / 7.0 * 3)::int,
         CASE WHEN i % 5 = 3 THEN 'Rejected' ELSE 'Completed' END, ago,
         CASE WHEN i % 5 = 3 THEN ago - 2.5 - (i % 3) ELSE ago - 14 - len - 1 - (i % 2) END,
         CASE WHEN i % 5 = 3 THEN 'No capacity for the requested dates.' END)
FROM (SELECT i, 36 + i * 8 AS ago, 7 + (i % 3) * 3 AS len, m, c, d, f FROM (VALUES
  (0,'248211','laila.alharbi@clinics.example','Internal','JED-C'),(1,'233451','noor.alqahtani@clinics.example','ExternalKSA','BP-KHB'),
  (2,'259033','omar.khan@clinics.example','Internal','MKK-A'),(3,'262198','laila.alharbi@clinics.example','International','INT-AMM'),
  (4,'268812','hana.saleh@clinics.example','Internal','RUH-N'),(5,'246420','noor.alqahtani@clinics.example','Internal','JED-C'),
  (6,'255678','omar.khan@clinics.example','ExternalKSA','DV-JED'),(7,'244907','laila.alharbi@clinics.example','ExternalKSA','BP-RUH'),
  (8,'270903','omar.khan@clinics.example','International','INT-DXB'),(9,'236690','laila.alharbi@clinics.example','Internal','DMM-E'),
  (10,'239174','laila.alharbi@clinics.example','Internal','MED-K'),(11,'233451','noor.alqahtani@clinics.example','International','INT-KUL'),
  (12,'241284','laila.alharbi@clinics.example','ExternalKSA','AM-JED'),(13,'268812','hana.saleh@clinics.example','Internal','MKK-A')
) AS t(i, m, c, d, f)) x;

-- current work, covering every status
SELECT pg_temp.seed_request('259033','omar.khan@clinics.example','Internal','RUH-N',-30,10,4,'Completed',50,18);
SELECT pg_temp.seed_request('233451','noor.alqahtani@clinics.example','ExternalKSA','BP-RUH',-40,10,4,'Completed',60,28);
SELECT pg_temp.seed_request('241284','laila.alharbi@clinics.example','Internal','JED-C',-12,10,4,'Confirmed',30,22);
SELECT pg_temp.seed_request('268812','hana.saleh@clinics.example','Internal','JED-C',5,7,3,'Confirmed',15,8);
SELECT pg_temp.seed_request('244907','laila.alharbi@clinics.example','International','INT-DXB',10,10,4,'Confirmed',20,6);
SELECT pg_temp.seed_request('236690','laila.alharbi@clinics.example','Internal','AHB-S',20,5,2,'Rejected',9,7,'No chair capacity on the requested dates. Earliest availability is the following week.');
SELECT pg_temp.seed_request('270903','omar.khan@clinics.example','International','INT-CAI',15,10,4,'Rejected',14,5,'Provider declined: unit fully booked over the requested period.');
SELECT pg_temp.seed_request('239174','laila.alharbi@clinics.example','Internal','MED-K',40,5,2,'Withdrawn',12,10,'Patient postponed travel.');
SELECT pg_temp.seed_request('251356','laila.alharbi@clinics.example','International','INT-IST',30,14,6,'SentToProviderAwaitingResponse',6,4.3,NULL,true,true);
SELECT pg_temp.seed_request('255678','omar.khan@clinics.example','ExternalKSA','DV-RUH',20,10,4,'SentToProviderAwaitingResponse',3,2.1);
SELECT pg_temp.seed_request('268812','hana.saleh@clinics.example','International','INT-LON',35,14,6,'PendingProviderEmail',2.6,2.5);
SELECT pg_temp.seed_request('262198','laila.alharbi@clinics.example','ExternalKSA','AM-JED',25,14,6,'PendingProviderEmail',1.1,0.9);
SELECT pg_temp.seed_request('239174','laila.alharbi@clinics.example','Internal','MKK-A',30,7,3,'PendingClinicResponse',1.4,1.2);
SELECT pg_temp.seed_request('246420','noor.alqahtani@clinics.example','Internal','RUH-N',12,7,3,'PendingClinicResponse',0.6,0.4);
SELECT pg_temp.seed_request('248211','laila.alharbi@clinics.example','Internal','JED-C',18,10,4,'PendingClinicResponse',4,3.2,NULL,false,true);
SELECT pg_temp.seed_request('241284','laila.alharbi@clinics.example','Internal','DMM-E',45,7,3,'Draft',2,2);

INSERT INTO request_comment (request_id, comment_text, created_by_user_id, created_at)
SELECT r.id, 'Patient prefers morning sessions if possible.', r.created_by_user_id, now() - interval '1 day'
FROM holiday_dialysis_request r JOIN patient_reference p ON p.id = r.patient_reference_id
WHERE p.mrn = '248211' AND r.current_status = 'PendingClinicResponse';

INSERT INTO notification (user_id, request_id, notification_type, title, message, created_at, channel, delivery_status)
SELECT s.user_id, r.id, 'ClinicActionRequired', 'Your clinic has a request to review',
       r.request_number || ' is waiting for your clinic''s response.', r.status_changed_at, 'InPortal', 'NotRequired'
FROM holiday_dialysis_request r JOIN user_clinic_scope s ON s.facility_id = r.receiving_facility_id
WHERE r.current_status = 'PendingClinicResponse';

INSERT INTO notification (user_id, request_id, notification_type, title, message, created_at, channel, delivery_status)
SELECT 'a0000000-0000-4000-8000-000000000004', r.id, 'NewProviderRequest', 'New request to email',
       r.request_number || ' is ready to send to the provider.', r.status_changed_at, 'InPortal', 'NotRequired'
FROM holiday_dialysis_request r WHERE r.current_status = 'PendingProviderEmail';
