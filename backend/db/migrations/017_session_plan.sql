-- 017_session_plan.sql — Treatment days & shifts: the exact dialysis days during the trip, each with a preferred shift.
-- [{ "date": "2026-11-19", "shift": "Morning" }, …]. sessions_required is kept and set to the number of days chosen.
-- Safe to run more than once.
ALTER TABLE holiday_dialysis_request ADD COLUMN IF NOT EXISTS session_plan jsonb NOT NULL DEFAULT '[]'::jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hdr_session_plan_is_array') THEN
    ALTER TABLE holiday_dialysis_request ADD CONSTRAINT hdr_session_plan_is_array CHECK (jsonb_typeof(session_plan) = 'array') NOT VALID;
  END IF;
END $$;
