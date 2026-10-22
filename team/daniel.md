# Daniel — Backend and Integration

**Your job:** make the frontend, patient data, and AI work together reliably from the beginning.

## What you own

- Agree on the shared input/output JSON with Avinash and Mike.
- Serve the synthetic patient and an explicitly labeled UI fixture.
- Run the AI pipeline and validate its output before the frontend receives it.
- Store versioned analyses and cached evidence using SQLite and JSON files.
- Handle timeouts, failures, deployment, and a tested local presentation setup.

Use Python, FastAPI, and Pydantic. Keep orchestration in one backend process.

## The minimum API

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Check readiness |
| `GET /patients/{id}` | Return the versioned synthetic record |
| `POST /analyses` | Start or retrieve an analysis |
| `GET /analyses/{run_id}` | Return status or completed output |
| `GET /sources/{source_id}` | Return registered medical evidence |

Give Mike the sample response immediately. Give Avinash a clear input contract and a place to connect his pipeline.

## Your schedule

| Time | Deliverable |
| --- | --- |
| Hour 0–1 | API skeleton, sample data, deployment path |
| Hour 1–2 | Analysis endpoint, polling, schema validation |
| Hour 2–3 | Real AI response visible in Mike's interface |
| Hour 3–4.5 | Persistent runs and complete end-to-end flow |
| Hour 4.5–6 | Timeouts, cache checks, restart and fallback testing |
| After Hour 6 | Reliability, release, and submission support |

## Reliability rules

Cache identity includes the patient input, exclusions, schema, model, prompt, and evidence versions. Changed records invalidate previous results.

If retrieval fails, use labeled cached evidence. If inference fails, offer a matching previously validated run. If none exists, show an honest failure. A hand-authored fixture is never a previous AI run.

Keep API keys server-side and out of Git. Use synthetic data only.

## Done means

The team can complete the demo after a restart, every ID resolves, and fallback behavior is clearly labeled.

**Skip:** EHR integration, authentication, Redis/Celery, vector databases, and unfamiliar infrastructure.
