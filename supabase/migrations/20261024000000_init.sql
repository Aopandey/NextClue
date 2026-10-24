-- NextClue schema. Mirrors contracts/README.md and backend/app/contracts.py.
-- Only the FastAPI backend (service-role key) touches these tables: RLS is
-- enabled with no policies, so the public anon key cannot read or write them.

create table patients (
  patient_id      text primary key,
  current_version integer not null default 1 check (current_version >= 1),
  display_name    text not null,
  sex_at_birth    text not null check (sex_at_birth in ('female', 'male', 'intersex', 'unknown')),
  birth_year      integer not null,
  synthetic       boolean not null default true check (synthetic),
  created_at      timestamptz not null default now()
);

-- One row per document per record version. A record version is the full set of
-- documents sharing that version number; editing a document means writing a new version.
create table patient_documents (
  patient_id     text not null references patients (patient_id) on delete cascade,
  record_version integer not null check (record_version >= 1),
  record_id      text not null check (record_id ~ '^rec-[a-z0-9-]+$'),
  date           date not null,
  type           text not null check (type in (
                   'clinic_note', 'lab_result', 'imaging', 'pathology',
                   'referral', 'genetic_report', 'other')),
  specialty      text not null,
  title          text not null,
  author_role    text,
  text           text not null,
  observations   jsonb not null default '[]'::jsonb,
  primary key (patient_id, record_version, record_id)
);

create table sources (
  source_id           text primary key check (source_id ~ '^src-[a-z0-9-]+$'),
  evidence_version    text not null,
  source_type         text not null check (source_type in ('genereviews', 'pubmed', 'guideline', 'hpo', 'other')),
  title               text not null,
  publisher           text not null,
  year                integer,
  url                 text not null check (url like 'https://%'),
  pmid                text,
  excerpts            jsonb not null,
  verification_status text not null check (verification_status in ('verified', 'unverified')),
  retrieved_on        date
);

-- AI runs only. Hand-authored fixtures are served from files and can never be
-- stored here, so a fixture can never be replayed as if it were an AI run.
create table analysis_runs (
  run_id               text primary key,
  status               text not null check (status in ('queued', 'running', 'completed', 'failed')),
  provenance           text not null check (provenance in ('live', 'replayed')),
  replayed_from_run_id text references analysis_runs (run_id),
  fallback_reason      text,
  evidence_mode        text not null check (evidence_mode in ('live', 'cached')),
  patient_id           text not null references patients (patient_id) on delete cascade,
  record_version       integer not null,
  excluded_record_ids  jsonb not null default '[]'::jsonb,
  cache_key            text not null,  -- patient + exclusions + schema/model/prompt/evidence versions
  input_key            text not null,  -- patient + exclusions only; finds fallback runs after a failure
  versions             jsonb not null,
  created_at           timestamptz not null default now(),
  completed_at         timestamptz,
  error                jsonb,
  output               jsonb,
  timeline             jsonb,
  graph                jsonb
);

create index analysis_runs_cache_lookup on analysis_runs (cache_key, status, created_at desc);
create index analysis_runs_input_lookup on analysis_runs (input_key, status, created_at desc);

alter table patients          enable row level security;
alter table patient_documents enable row level security;
alter table sources           enable row level security;
alter table analysis_runs     enable row level security;
