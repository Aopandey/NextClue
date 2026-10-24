# Avinash — Gemini + Daniel's backend

The AI uses Daniel's types in `backend/app/contracts.py`: first extract Finding
objects, then build the rest of AnalysisOutput. The backend owns Supabase,
registered sources, cache/replay, timeline, graph, and API responses.

## Checks — repo root, PowerShell

For first-time setup on Mike's PC, follow [backend/README.md](../backend/README.md).
Existing keys/models in local `.env` files take precedence over the templates.

```powershell
.\.venv\Scripts\python.exe -m ai.check_setup            # offline
.\.venv\Scripts\python.exe -m ai.check_setup --ping     # one real Gemini call
.\.venv\Scripts\python.exe -m ai.run --patient sarah-001 --extract-only
.\.venv\Scripts\python.exe -m ai.run --patient sarah-001
.\.venv\Scripts\python.exe -m ai.run --patient james-002
.\.venv\Scripts\python.exe -m ai.run --scenario male     # see ai/evaluation.md
.\.venv\Scripts\python.exe -m pytest -c backend/pytest.ini backend/tests ai/tests -q
```

Runs make real calls, validate every quote and ID, and write to ignored `ai/runs/`.
They need no Docker or database. `--exclude RECORD_ID` tests changed input.

## Evidence

`backend/data/sources.json` (`evidence-2026-10-24.1`) holds four reviewed sources
with real PMIDs and 23 exact excerpts. See the [review record](evidence/starting-sources.md).

- **cached** (default): the model sees every verified registered source.
- **live** (`EVIDENCE_RETRIEVAL=pubmed`): one bounded PubMed query, restricted to
  the registered PMIDs with `[uid]`, picks which registered sources match the
  extracted findings. Labeled `live` only if that query succeeded and matched;
  otherwise the run uses the cache and is labeled `cached`. Unregistered search
  results can never reach the model or the output.

Curation: `python -m ai.evidence_tool search|show|add|check|genereviews-copy`.
`add` only writes verbatim abstract text, always as unverified, with a new
`evidence_version`. A reviewer marks it verified, then Daniel re-seeds.

## Reliability

- Handoff output that fails validation gets one correction attempt with the
  validator's messages; a second failure is reported, never patched.
- Gemini HTTP 429/500/503/504 is retried twice with the same model. Other
  errors fail immediately with a sanitized message.
- One run is two or three Gemini calls (about 15–45 s here). Keep
  `ANALYSIS_TIMEOUT_SECONDS` at 90 or more.

## Team integration

Codex follow-up: cache identity now includes the requested retrieval mode. API
and CLI analyses share one deadline across model/retrieval calls; async HTTP
cancellation also stops stalled or trickling responses. SDK attempts are set to
one so they cannot multiply the explicit retry loop. A PubMed fallback is retried
on the next API request. Invalid settings produce clear configuration errors.
An online evidence check reports missing or malformed review copies and unknown
source IDs as incomplete, without a traceback.

Real hosted-Supabase API checks for Sarah and James passed, including persistence,
source endpoints, and repeat-request cache reuse. See [next steps](next-steps.md).

- `backend/app/pipeline.py` calls `ai.pipeline.run_analysis` and passes the real
  evidence mode to the run. The public schema is unchanged.
- An explicit `MODEL_NAME` in `backend/.env` overrides `GEMINI_MODEL`. The prompt
  default is now `extract-v3+handoff-v3`; bump `PROMPT_VERSION` when prompts change.
- Mike uses `POST /analyses` then `GET /analyses/{run_id}`; citations resolve via
  `GET /sources/{source_id}`. Model and NCBI keys stay on the server.

On another machine: Python 3.11+, create `.venv`, then from the repo root run
`python -m pip install -r backend/requirements.txt -e ./ai`.

Kiro work is recorded in [kiro-usage.md](kiro-usage.md).
