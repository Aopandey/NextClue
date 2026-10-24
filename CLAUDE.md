# NextClue — frontend and integration handoff

## Goal and current state

NextClue is an H3 healthcare-coordination prototype: connect scattered synthetic
patient records into an evidence-linked handoff from neurology to genetics.
The clinician reviews unresolved questions and decides what happens next.

Backend and AI are implemented on `main` (baseline `cd4ee42`). Mike is building
the frontend with Claude; integration happens on **Mike's PC**. Preserve his
existing interface and inspect its framework, scripts, and API configuration
before editing. Avinash owns AI/evidence, Daniel owns API/contracts/Supabase,
and Sean owns demo/QA/submission.

## Read these first

- [backend/app/contracts.py](backend/app/contracts.py): authoritative Pydantic
  models. [contracts/schema/](contracts/schema/) contains generated JSON schemas.
  Some illustrative examples in `contracts/README.md` have older version/label
  descriptions; use the models and current routes when they differ.
- [backend/README.md](backend/README.md): first-time setup on Mike's PC.
- [backend/app/main.py](backend/app/main.py): routes; `/docs` exposes OpenAPI.
- [ai/next-steps.md](ai/next-steps.md): remaining integration checklist.
- [ai/evaluation.md](ai/evaluation.md): checks performed and open wording issues.

## What is already built

Flow: frontend → FastAPI → hosted Supabase records → Gemini finding extraction
→ reviewed evidence selection → Gemini handoff → schema/reference validation
→ persisted run with backend-built timeline and graph.

- `ai/pipeline.py`, `ai/prompts/`: two model stages, with one handoff correction
  attempt after validation errors. Record quotations and citation IDs are checked.
- `backend/app/analyses.py`: background runs, cache, timeouts, and labeled replay
  of earlier validated output if inference fails. No new API is needed.
- `backend/data/sources.json`: four reviewed sources, 23 exact excerpts,
  version `evidence-2026-10-24.1`. Default evidence is the registered cache.
  Opt-in `EVIDENCE_RETRIEVAL=pubmed` ranks only registered PMIDs; it does not
  automatically add papers. Outage/no matches uses the cache and retries retrieval
  on the next analysis request.
- Shared deadlines cancel stalled/trickling HTTP responses. Gemini has two
  bounded same-model retries for transient provider errors; SDK attempts are one.
- Last backend/AI check: **120 tests + 7 subtests passed**, outbound network
  blocked. Earlier real Gemini + hosted database checks passed for Sarah/James;
  the full frontend flow after the latest fixes still needs verification.

## Frontend API contract

| Request | Use |
| --- | --- |
| `GET /health` | Backend/database readiness |
| `GET /patients` | Patient summaries |
| `GET /patients/{patient_id}` | Full record and original documents |
| `POST /analyses` | Start or reuse an `AnalysisRun` |
| `GET /analyses/{run_id}` | Poll the run |
| `GET /sources/{source_id}` | Source metadata and exact excerpts |
| `GET /fixtures/analyses/sarah-001` | Explicitly labeled hand-authored UI sample |

POST body: `{"patient_id":"sarah-001","excluded_record_ids":[],"force_refresh":false}`.
Optional `record_version` selects a particular record version. `202` means a new
run; `200` means reuse, which may still be queued/running. Poll either until
`completed` or `failed`; use a loading state and stop stale polls on patient change.
Avoid repeated POSTs/automatic `force_refresh`: fresh analyses spend Gemini quota
and have taken about 15–45 seconds. The default total backend budget is 90 seconds.

Render `run.output` (`findings`, `claims`, `prior_results`, `hypotheses`,
`missing_evidence`, `clinician_questions`), `run.timeline`, and `run.graph`.
Handle null output/timeline/graph and empty arrays. Preserve IDs; for React Flow,
map `node_id` → `id`, retain edge `source`/`target`, and map `edge_id` → `id`.
Resolve record references against the patient's documents; source references pair
`source_id` with `excerpt_id`. Sort missing evidence by priority (1 first).

Keep these labels distinct:

- `provenance=live`: model-generated run; a repeat request can reuse this same run.
- `provenance=replayed`: older validated output after a failed attempt. Show
  `fallback_reason` and `error` even when status is `completed`.
- `provenance=fixture`: hand-authored sample, visibly labeled as such.
- `evidence_mode=cached`: reviewed registered evidence, either default or fallback.
  `live`: PubMed successfully selected evidence for that run. Wait for completion
  before presenting the evidence label as final.

Handle HTTP errors separately from `run.error`. Invalid server settings return
HTTP 503 with `detail: {code: "configuration_error", message, retryable: false}`.
Queued-run configuration failures use `run.error.code=internal`, retryable false.

## Setup and checks on Mike's PC

Follow `backend/README.md`: Python 3.11+, a virtual environment, install
`backend/requirements.txt` and editable `./ai`, then create local environment files.
Put Daniel's hosted Supabase URL/service key in `backend/.env`, and the Gemini key
in `ai/.env`. Explicitly set `GEMINI_MODEL=gemini-3.5-flash-lite` as in the template;
leave backend `MODEL_NAME` blank to use it. Existing environment values take precedence.
The shared database is already seeded; Docker is optional. Re-seed only for data
changes and bump record/evidence versions as appropriate.

With the virtual environment activated, from the repo root:

```bash
python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
# Separate terminal:
python -m pytest
```

Point the frontend's existing API setting at `http://127.0.0.1:8000`.
Default CORS origin is `http://localhost:3000`; for another origin, update
`CORS_ORIGINS` in `backend/.env` and restart the backend. Keep all model/database
calls server-side. Never put service-role/Gemini keys in public frontend variables,
logs, commits, or chat. Tests disable local `.env` loading and allow loopback only;
real AI checks are separate and should address a specific integration question.

## Finish the integration

1. Check `/health`, then Sarah → start/poll → timeline/graph → original record and
   source excerpt → handoff brief. Check whether the **2019 outside genetics report**
   exists before suggesting new testing; keep her case unconfirmed. Do not hard-code
   findings, report status, or a diagnosis into the UI.
2. Repeat with `james-002`: common explanations are documented; avoid a rare-disease
   conclusion invented by the interface. Other synthetic patients are not as well evaluated.
3. Check loading, failed, reused, fixture, and replayed states. Test exclusions if
   the interface offers them. Review wording: validators do not guarantee clinical
   correctness; known issues include overconfident language and evidence relevance.

Preserve shared schemas and backend validation. If contracts must change, update
models, generated schemas, consumers, and relevant checks together. Keep synthetic
data, uncertainty, source links, and the backend disclaimer visible; clinicians decide.
Keep root `.kiro/` and the accurate contribution history in
[ai/kiro-usage.md](ai/kiro-usage.md). Record Claude work as Claude work; do not
attribute it to Kiro. This is a prototype, without clinical-validation claims.
