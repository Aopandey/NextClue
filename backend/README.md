# NextClue Backend

FastAPI + local Supabase (Postgres). Implements the contracts in [../contracts/README.md](../contracts/README.md).

## First-time setup

Requires Docker Desktop (running), Node 18+, and Python 3.11+.

```bash
# from the repo root: start local Supabase (applies supabase/migrations automatically)
npx supabase start -x realtime,storage-api,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor
npx supabase status            # shows the API URL and the service-role / secret key

# from backend/
python -m venv .venv
.venv/Scripts/activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
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

Edit the JSON files in `data/`, bump `record_version` when a patient's documents change, and re-run `python -m scripts.seed`. Source excerpts are unverified paraphrases until Sean checks them against the original text.

## For Avinash: connecting the AI

Replace `run_pipeline` in [app/pipeline.py](app/pipeline.py). Return a `PipelineResult`, and raise on failure. The backend handles everything around it:

- the timeout (`ANALYSIS_TIMEOUT_SECONDS`)
- schema and reference validation, in [app/validation.py](app/validation.py)
- the timeline and graph, in [app/views.py](app/views.py)
- persistence
- fallback

Set `MODEL_NAME` and `PROMPT_VERSION` in `.env`. Both are part of the cache key.

## Reliability behavior

- **Cache.** The key covers the full patient record, exclusions, schema, model, prompt, and evidence versions. A matching live run, finished or in progress, is reused unless `force_refresh` is true.
- **Inference failure.** The run is replayed from the latest validated live run for the same patient input. It is labeled `provenance: "replayed"` and carries `replayed_from_run_id`, `fallback_reason`, and the original `error`. If no such run exists, `status: "failed"` with an honest `error`.
- **Fixtures.** They are served from files and are blocked from the runs table by a database constraint, so they can never be replayed as AI output.
- **Access.** RLS is on with no policies, so only the backend's service-role key can reach the tables. Keys live in `.env`, which is gitignored.

## Tests and schemas

```bash
python -m pytest                   # offline: contracts, data files, validator, cache key
python -m scripts.export_schemas   # regenerate ../contracts/schema/*.json after changing contracts.py
```
