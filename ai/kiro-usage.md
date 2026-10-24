# Actual Kiro usage

Codex prepared the starter and Gemini/backend integration. The entries below are
work done in Kiro (Autopilot, Vibe session) on October 24, 2026. Gemini is the
runtime model, not evidence of Kiro usage. Hooks, MCP servers, and sub-agents
were not used.

| Kiro feature | Task completed / files changed | How it helped | Check run |
| --- | --- | --- | --- |
| Steering (`.kiro/steering/nextclue.md`, always included) | Constraints applied throughout: ownership, no diagnosis/probabilities, keys out of output, unknown ≠ absent. Updated its evidence status line. | Kept edits inside `ai/` plus small, flagged integration points in Daniel's files | Key never printed; `git status` shows `ai/.env` untracked and ignored |
| Spec (`.kiro/specs/ai-evidence/`) | Reviewed draft against `contracts.py`; added requirements 9–10, rewrote `design.md` to the built design, checked off tasks 1–4 with remaining items | Spec gaps (live labeling, evidence applicability) became validator rules and tests | Tasks file lists what is not done (re-seed, real Supabase flow) |
| Agent terminal | Ran `check_setup`, `--ping`, extraction, all real analyses, scenarios, PubMed and PMC E-utilities | Real provider failures (HTTP 503 ×3, invalid-key HTTP 400) reported, not hidden | See `ai/evaluation.md` |
| Agent source review (terminal + E-utilities; web fetch was blocked by NCBI's browser check) | `backend/data/sources.json` → `evidence-2026-10-24.1`: 4 real sources, 23 exact excerpts; placeholder replaced with PMID 29112785; IDs preserved or documented in `ai/evidence/starting-sources.md` | Found that the old paraphrases overstated chloroquine phenocopy and mixed GI into classic features | `ai.evidence_tool check --online` → 23/23 verbatim |
| Agent code edits | New: `ai/pubmed.py`, `ai/retrieval.py`, `ai/evidence_tool.py`, `ai/scenarios.py`. Changed: `ai/pipeline.py`, `ai/gemini_client.py`, `ai/run.py`, `ai/check_setup.py`, prompts, `ai/.env.example`, `backend/app/pipeline.py` (real evidence mode), `backend/app/config.py` + `.env.example` (prompt version), `backend/README.md` (2 stale lines) | Bounded PubMed ranking over registered PMIDs; validator-driven correction attempt; same-model retry | 65 tests + 7 subtests pass |
| Agent tests | New `ai/tests/test_evidence.py`, `ai/tests/test_api_flow.py`, `ai/tests/conftest.py`; updated `test_pipeline.py`, `test_gemini_client.py` | Each real-run failure became a regression test | `pytest -c backend/pytest.ini backend/tests ai/tests` |
| Agent evaluation loop | Ran Sarah, James, exclusion, 5 scenarios, live PubMed; fixed prompt/schema/reference failures found | e.g. quotes from observations, evidence-less rare hypothesis for James, invented source ID | Results and open issues in `ai/evaluation.md` |

At the end of this initial Kiro session, Supabase re-seeding, the real-database
API flow, and Mike's UI checks were still open. Codex subsequently completed
the database and API checks documented below; frontend integration remains open.

## Subsequent implementation with Codex — October 24

Codex added retrieval mode to cache identity, one shared cancellation-aware
deadline, explicit disabling of SDK retries, and incomplete full-text audit
failures. Regression coverage increased to 80 tests and 7 subtests, all passing.
Codex connected the hosted Supabase project, updated its source registry to
`evidence-2026-10-24.1`, and completed real HTTP API/Gemini/database checks for
Sarah and James, including source lookups and repeat-request cache reuse.
These are Codex contributions. Frontend integration and UI checks remain open.

## Verification review in Kiro — October 24

Kiro reviewed the Codex changes above (cache identity, `ai/budget.py`, SDK retry
settings, incomplete full-text audit). No application code was changed, no
Gemini requests were made, and no `.env` values were read into the report.

| Kiro feature | Verification performed | Result |
| --- | --- | --- |
| Agent terminal: pytest | Full backend + AI suite, default temp and a fresh workspace `--basetemp` (removed afterward), with a temporary plugin that blocks non-loopback sockets | 80 passed, 7 subtests; 0 outbound connection attempts |
| Agent code review | Read diffs of `analyses.py`, `validation.py`, `config.py`, and `ai/budget.py`, `gemini_client.py`, `pubmed.py`, `evidence_tool.py`, plus google-genai 2.33.0 `retry_args` source | Mapped which behaviors tests cover only through mocks |
| Agent terminal: local SDK probe | Real google-genai client and `generate_json` against a 127.0.0.1 server (dummy key) | SDK sent 1 request with `attempts=1` and 1 with retry options omitted (5 only for `HttpRetryOptions()`); `generate_json` made 3 total on persistent 503; 1.5 s budget ended slow calls at about 1.55 s (5/5) but a trickled response ran 4.2 s before rejection |
| Agent terminal: API probes (db stubbed, providers mocked) | Invalid settings, PubMed failure then repeat request | Invalid `EVIDENCE_RETRIEVAL` and non-numeric `ANALYSIS_TIMEOUT_SECONDS` return HTTP 500; timeout 0 is labeled `model_error`; a pubmed-mode run that fell back to cached is reused on repeat without retrying PubMed |
| Agent terminal: evidence audit | `check --online` without review copy (real PubMed/PMC, no Gemini); `--fulltext` edge cases | 15 chapter excerpts reported incomplete, exit 1. Missing file, missing `=`, or invalid XML exit nonzero with an unhandled traceback; a mistyped source ID is silently ignored |

Coverage gaps found: no test of real SDK transport retries; no backend unit test
of `retrieval_mode` in `compute_cache_key`; no test of invalid settings at the
API boundary; no test of reuse after PubMed fallback; `app.config` loads
`backend/.env` at import and the AI conftest does not isolate it.

## Codex fixes after Kiro's review — October 24

Codex implemented the review fixes; this entry records Codex work, not additional
Kiro development. PubMed fallback runs allow a fresh lookup on the next request,
while live results and in-progress requests remain reusable. Invalid settings
return actionable HTTP 503 errors; configuration failures on queued runs are
non-retryable `internal` errors, preserving the run schema.

Gemini and PubMed use async HTTP inside the synchronous worker with a total
deadline, so stalled headers/bodies and trickled bytes release the connection
and worker. Real loopback transport tests also caught and fixed an early-timer
classification race on Windows. SDK attempts are explicitly one; omitted SDK
retry options already default to one in version 2.33.0.

Both pytest configurations load an isolation plugin before collection: developer
`.env` files are disabled, dummy settings replace inherited values, and outbound
DNS/connections are blocked. Evidence-tool malformed mappings, missing files,
invalid XML, duplicate mappings, and unknown source IDs fail cleanly as incomplete.

Validation: 120 tests and 7 subtests passed, including real SDK/HTTP tests against
loopback servers, with deliberately invalid parent model/retrieval/timeout values.
The backend-only isolation checks also passed. Dependency and tracked-diff checks
passed. No paid Gemini calls or database writes were made for these fixes.

## Document exports implemented in Kiro — October 24

Kiro (Autopilot, Vibe session) designed and implemented the handoff brief and
referral draft features: a code-built brief and a specialty-specific Gemini
letter, both exportable as Markdown or print-ready HTML, with clinician editing
and reference checks for the referral.

The implementation files remain local and uncommitted. This publication updates
only `ai/kiro-usage.md`; it does not publish the new code, specs, schemas, or
integration guide. The verification results below are Kiro's recorded results.
No Gemini, PubMed, or hosted-database requests were made during this feature
implementation; every model response in the tests was mocked. Hooks and MCP
servers were not used.

| Kiro feature | Task completed / files changed | How it helped | Check run |
| --- | --- | --- | --- |
| Steering (`.kiro/steering/nextclue.md`) | Applied ownership and wording rules: Daniel's contracts stay the source of truth, no diagnosis, probability, treatment, or urgency wording, unknown ≠ absent, check existing records first | New contracts are additive (section 6 of `contracts.py`); `AnalysisRun`, `AnalysisOutput`, and the pipeline are unchanged | The 5 existing schemas regenerate unchanged |
| Spec (`.kiro/specs/document-exports/design.md`) | Design written before code: shared run context, both features, error codes, tasks | Settled version checks, review-hash binding, and in-memory draft limits before implementation | Tasks ticked; remaining items listed |
| Agent code edits | New `backend/app/documents/` (context, errors, model, render, handoff, referral, store, service), `backend/app/fixtures.py`, `ai/referral.py`, `ai/prompts/referral.md`, 6 JSON schemas. Changed `backend/app/contracts.py`, `backend/app/main.py` (6 routes, error handler, exposed CORS headers), `ai/gemini_client.py` (prompt name), `backend/scripts/export_schemas.py` | The handoff is built by code with zero model calls. The referral is validated against the run, with one correction at most | See tests |
| Agent tests | New `ai/tests/document_fakes.py`, `ai/tests/test_handoff.py`, `ai/tests/test_referral.py`, `backend/tests/test_schemas.py` (100 new tests) | Found a bug: the correction attempt reused the first request's payload dict. Fixed by building a new payload per attempt | 220 passed + 7 subtests, outbound network blocked; backend-only 23 passed |
| Agent terminal: headless Edge | Rendered mocked Sarah handoff and referral exports on screen and printed them to PDF; rendered PDF pages to images with the Windows PDF API | Found the closing notes splitting across pages; fixed with print CSS. Escaped hostile text, long URLs, and Unicode rendered correctly | Page images inspected; scratch files deleted |
| Agent review of the validator against the data | Checked wording-guard terms against all synthetic records | Emergency-medicine visits (Priya, Kevin) and "immediate family" would have been flagged as urgency. Narrowed the rule and added tests | Included in the 220 |
| Agent docs | `docs/document-exports-integration.md` (for Mike/Claude), `backend/README.md`, `CLAUDE.md`, `ai/README.md`, `ai/evaluation.md` | The frontend is not in this checkout, so the guide is the integration contract | — |

Not verified: no real Gemini referral draft (prompt `referral-v1` has not been
run against the model), no hosted Supabase run, no frontend, and no print check
outside headless Edge. Valid citations do not prove each sentence is supported,
and the wording guard is lexical.
