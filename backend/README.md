# NextClue Backend

FastAPI + Supabase (Postgres). Implements the contracts in [../contracts/README.md](../contracts/README.md).

## Shared hosted Supabase

Docker is not needed when using Daniel's hosted project. Fill `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` in ignored `backend/.env`; keep the server key out of
frontend settings. Gemini remains configured in `ai/.env`.

On Mike's Windows PC, commit any frontend work locally before pulling `main`.
Then run from the repo root (Python 3.11+):

```powershell
git pull origin main
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt -e ./ai
if (-not (Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
if (-not (Test-Path ai/.env)) { Copy-Item ai/.env.example ai/.env }
```

Fill Daniel's hosted Supabase URL/server key in `backend/.env` and your Gemini
key in `ai/.env` locally. The AI template uses our verified model,
`gemini-3.5-flash-lite`. Then start the backend:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000/health` and `/docs`. Point the frontend's existing API
setting at `http://127.0.0.1:8000` and run its dev server separately. The default
allowed browser origin is `http://localhost:3000`; if the frontend uses another
origin, set that exact origin in `CORS_ORIGINS` in `backend/.env` and restart the
backend. Server keys belong only in the backend/AI environment files.

The hosted project now contains all four
reviewed sources (`evidence-2026-10-24.1`); Sarah and James match the canonical
files. Re-seed only when data changes and coordinate with the team.

## Optional local Supabase setup

Requires Docker Desktop (running), Node 18+, and Python 3.11+.

```bash
# from the repo root: start local Supabase (applies supabase/migrations automatically)
npx supabase start -x realtime,storage-api,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor
npx supabase status            # shows the API URL and the service-role / secret key

# from backend/
python -m venv .venv
.venv/Scripts/activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt -e ../ai
cp .env.example .env            # paste the service-role key into SUPABASE_SERVICE_ROLE_KEY
python -m scripts.seed          # validates and loads synthetic patients + sources
uvicorn app.main:app --reload   # http://127.0.0.1:8000/docs
```

Supabase Studio, for browsing tables: http://127.0.0.1:54323

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Readiness, including the database connection |
| `GET /patients` | List synthetic patients |
| `GET /patients/{id}?record_version=` | Versioned synthetic record |
| `POST /analyses` | Start an analysis, or reuse a matching one (`202` new, `200` reused) |
| `GET /analyses/{run_id}` | Poll status / get the completed output |
| `GET /sources/{source_id}` | Registered medical evidence |
| `GET /fixtures/analyses/{id}` | Hand-authored UI sample, labeled `provenance: "fixture"` |

## Synthetic data

| Patient | Purpose |
| --- | --- |
| `sarah-001` | Demo case. Scattered Fabry-compatible clues, a misleading normal enzyme screen, and a possibly existing 2019 genetics report. |
| `james-002` | Negative control. Neuropathy, GI symptoms, and kidney disease, all with documented common causes (diabetes, GERD). Use it to check that the AI does not over-call a rare disease. |

Edit the JSON files in `data/`, bump `record_version` when a patient's documents change, and re-run `python -m scripts.seed`. Source excerpts in `data/sources.json` (`evidence-2026-10-24.1`) are exact quotations checked against the originals; see [ai/evidence/starting-sources.md](../ai/evidence/starting-sources.md).

## For Avinash: connecting the AI

`run_pipeline` in [app/pipeline.py](app/pipeline.py) delegates to the Gemini adapter in `ai/pipeline.py`, using these shared models. The backend handles everything around it:

- the timeout (`ANALYSIS_TIMEOUT_SECONDS`)
- schema and reference validation, in [app/validation.py](app/validation.py)
- the timeline and graph, in [app/views.py](app/views.py)
- persistence
- fallback

Configure Gemini in `ai/.env`. A blank `MODEL_NAME` in `backend/.env` uses `GEMINI_MODEL`; an explicit value overrides it for both the call and the cache metadata. Bump `PROMPT_VERSION` when prompts change.

The pipeline uses only verified registered sources. By default it labels runs `evidence_mode: "cached"`; with `EVIDENCE_RETRIEVAL=pubmed` a bounded PubMed query ranks the registered sources and the run is `"live"` only when that query succeeded. Re-seed after any `sources.json` change. For an AI-only check without Supabase, see [ai/README.md](../ai/README.md).

## Reliability behavior

- **Cache.** The key covers the full patient record, exclusions, schema, model, prompt, evidence version, and requested retrieval mode. Matching runs are reused unless `force_refresh` is true. A completed PubMed request that fell back to cached evidence starts fresh on the next request so retrieval can recover; in-progress runs are still reused.
- **Deadline.** One budget covers the worker, Gemini requests/retries, and PubMed requests. Async HTTP cancellation closes in-flight connections when the deadline expires, including responses that trickle bytes. SDK attempts are explicitly set to one; only our bounded outer loop retries.
- **Configuration.** Invalid retrieval/timeout settings return HTTP 503 with a clear, non-retryable `configuration_error`, before creating a run. If configuration changes after queuing, the run carries an `internal` error with `retryable: false`. The public run schema is unchanged.
- **Inference failure.** The run is replayed from the latest validated live run for the same patient input. It is labeled `provenance: "replayed"` and carries `replayed_from_run_id`, `fallback_reason`, and the original `error`. If no such run exists, `status: "failed"` with an honest `error`.
- **Fixtures.** They are served from files and are blocked from the runs table by a database constraint, so they can never be replayed as AI output.
- **Access.** RLS is on with no policies, so only the backend's service-role key can reach the tables. Keys live in `.env`, which is gitignored.

## Tests and schemas

```bash
python -m pytest                   # offline: contracts, data files, validator, cache key
python -m scripts.export_schemas   # regenerate ../contracts/schema/*.json after changing contracts.py
```

From the repository root, `python -m pytest` runs both suites. Both pytest configs
load isolation before importing the app: local `.env` files are disabled, settings
use dummy credentials, and network requests are limited to loopback test servers.
