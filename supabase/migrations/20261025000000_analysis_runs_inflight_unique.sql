-- Pre-check (Daniel runs this on hosted first):
-- select cache_key, count(*) from analysis_runs
--  where provenance = 'live' and status in ('queued','running') group by 1 having count(*) > 1;
-- If it returns rows, fail the stale in-flight duplicates the way the app's expiry does:
-- update analysis_runs set status = 'failed', completed_at = now(),
--   error = '{"code":"timeout","message":"The analysis was interrupted before it finished.","retryable":true}'::jsonb
--  where provenance = 'live' and status in ('queued','running') and created_at < now() - interval '3 minutes';
-- Apply only after every backend that writes to this database runs this code (older code returns 500 on the unique violation).
create unique index if not exists analysis_runs_cache_key_inflight
  on analysis_runs (cache_key) where provenance = 'live' and status in ('queued','running');
