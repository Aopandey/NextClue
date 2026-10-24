# AI integration — design

Daniel's `backend/app/contracts.py` owns the public models. The backend supplies
an already-filtered PatientRecord and its registered, evidence-versioned Source
list to `app.pipeline.run_pipeline`, which delegates to `ai.pipeline.run_analysis`.

1. Gemini extracts at most 12 Finding objects. Record IDs, nonempty exact
   excerpts, and exclusions are validated before reasoning. Structured
   observations are passed as `observations_not_quotable`.
2. Evidence selection (`ai/retrieval.py`) uses only verified, placeholder-free
   registered sources. Default `cached`: all of them. `EVIDENCE_RETRIEVAL=pubmed`:
   one PubMed esearch restricted to the registered PMIDs (`[uid]`) ranks which
   sources match the findings. `live` only if that query ran and matched; any
   PubMed failure or empty match falls back to the cache, labeled `cached`.
3. Gemini receives records, findings, and the selected evidence with explicit
   `cite_as` pairs and no URLs. It returns claims, prior_results, hypotheses,
   missing_evidence, and clinician_questions.
4. `check_output` runs Daniel's validator against exactly the selected sources,
   then AI-side rules: no blank quotes; prior-result limitations cite that test's
   records; a claim supports at most one hypothesis; every hypothesis links a
   claim; existing-record checks have record reasons and come first.
5. On a validation failure, one correction attempt sends the validator messages
   (locations only for schema errors). A second failure raises.
6. `PipelineResult.evidence_mode` carries the real label. The backend owns
   Supabase, timeouts, provenance, replay, timeline, graph, and API responses.

No public schema, table, or route changed. Stage envelopes and payload views are
private. `ai/run.py` runs against canonical JSON plus `ai/scenarios.py` edits.

## Evidence lifecycle

Candidates come from `ai/evidence_tool.py search`. `add` writes verbatim abstract
text as unverified with a new evidence_version. A reviewer verifies and Daniel
re-seeds. Because runs read the registry the backend already versioned at
`start_analysis`, every cited source is registered and evidence-versioned before
the run's cache key is recorded. Live ranking only narrows that set.

Open question for Daniel: the cache key does not include the retrieval mode, so
a cached-mode run can be reused when live mode is later enabled (and the reverse).
Options: include the mode in `evidence_version` or in `compute_cache_key`.

## Configuration

MODEL_NAME, when explicit, overrides GEMINI_MODEL in requests and cache metadata.
Prompt version default `extract-v3+handoff-v3`. Optional `EVIDENCE_RETRIEVAL`,
`PUBMED_TIMEOUT_SECONDS`, `NCBI_EMAIL`, `NCBI_API_KEY` (server env or ai/.env).
Gemini 429/5xx gets two same-model retries. Keep secrets out of logs and Git.
