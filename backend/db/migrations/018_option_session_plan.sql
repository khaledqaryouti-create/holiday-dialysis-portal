-- 018_option_session_plan.sql — treatment days & shifts on each proposed date option.
-- [{ "date": "2026-11-19", "shift": "Morning" }, …]. sessions stays and is set to the number of days chosen.
-- Existing options keep an empty list. Safe to run more than once.
ALTER TABLE request_date_option ADD COLUMN IF NOT EXISTS session_plan jsonb NOT NULL DEFAULT '[]'::jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rdo_session_plan_is_array') THEN
    ALTER TABLE request_date_option ADD CONSTRAINT rdo_session_plan_is_array CHECK (jsonb_typeof(session_plan) = 'array') NOT VALID;
  END IF;
END $$;
