-- 015_job_runs.sql — background jobs (integration retries + scheduled patient fetches, SLA reminders) run inside the
-- portal's own server — no Vercel cron or internet service needed. This table records each job's last run so the
-- Integrations page can show it. Safe to run more than once.
CREATE TABLE IF NOT EXISTS job_run (
  job_name        text PRIMARY KEY,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_ok         boolean,
  last_result     text,
  last_error      text,
  host            text,
  run_count       bigint NOT NULL DEFAULT 0
);
ALTER TABLE job_run ENABLE ROW LEVEL SECURITY;
