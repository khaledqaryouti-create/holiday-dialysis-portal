-- 002_guards_and_rls.sql
-- 1) Only Draft requests may ever be deleted (discarding a draft). Submitted requests are permanent.
CREATE OR REPLACE FUNCTION forbid_delete_submitted_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.current_status <> 'Draft' THEN
    RAISE EXCEPTION 'Request % is %, only drafts can be deleted', OLD.request_number, OLD.current_status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER hdr_delete_only_drafts BEFORE DELETE ON holiday_dialysis_request
  FOR EACH ROW EXECUTE FUNCTION forbid_delete_submitted_request();

-- 2) Status can never go back to Draft, and terminal statuses never change.
CREATE OR REPLACE FUNCTION guard_status_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_status IS DISTINCT FROM OLD.current_status THEN
    IF NEW.current_status = 'Draft' THEN
      RAISE EXCEPTION 'A submitted request cannot return to Draft' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.current_status IN ('Rejected','Withdrawn','Completed') THEN
      RAISE EXCEPTION 'Request % is % and cannot change status', OLD.request_number, OLD.current_status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hdr_guard_status BEFORE UPDATE ON holiday_dialysis_request
  FOR EACH ROW EXECUTE FUNCTION guard_status_change();

-- 3) Supabase exposes every table in "public" through its auto-generated REST API (anon / authenticated keys).
--    This portal talks to Postgres only through the Express backend, so lock the REST API out completely:
--    RLS on with no policies = no rows for anon/authenticated. The backend's database role owns the tables
--    (or is "postgres", which bypasses RLS), so it is unaffected.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
