-- Pre-check (Daniel runs this on hosted first):
-- select cache_key, count(*) from analysis_runs
--  where provenance = 'live' and status in ('queued','running') group by 1 having count(*) > 1;
create unique index if not exists analysis_runs_cache_key_inflight
  on analysis_runs (cache_key) where provenance = 'live' and status in ('queued','running');
