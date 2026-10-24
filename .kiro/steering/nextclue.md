---
inclusion: always
---

# NextClue project guidance

- Product: H3 healthcare coordination. Connect scattered records and prepare a
  concise, evidence-linked handoff from neurology to genetics. Clinicians decide.
- Use synthetic records only. Show uncertainty; no autonomous diagnosis,
  diagnostic probabilities, treatment advice, or claims of clinical validation.
- Ownership: Avinash owns ai/; Daniel owns shared JSON models, API, and database;
  Mike owns the frontend; Sean owns story, QA, and submission. Preserve teammates'
  work. Do not introduce a competing API contract.
- Runtime: Gemini through the official google-genai Python SDK. One model,
  bounded extraction and evidence-review steps. Avoid extra agent frameworks.
- Use Daniel's real record and source IDs. Validate citations and exact excerpts
  against supplied records and reviewed medical evidence. Unknown is not absent.
- The first coordination step is checking existing records when appropriate,
  not automatically ordering a new test. Do not hard-code the demo's conclusion.
- Keep API keys in the server environment or ignored ai/.env. Never commit keys,
  patient data, local environments, or raw provider exceptions.
- Kiro artifacts remain tracked under root .kiro/. Record actual Kiro work in
  ai/kiro-usage.md; starter preparation does not prove meaningful Kiro use.

## Implemented integration

- Current workflow: Codex handles primary implementation. Use Kiro for focused
  verification and additional tests; do not change application code unless the
  user asks. Record each tool's actual contributions accurately.

- backend/app/contracts.py is the source of truth. The database is now
  Supabase/Postgres, not SQLite. The pipeline hook delegates to ai/pipeline.py.
- Use backend/data/patients/ as canonical input; old Markdown examples are retired.
- Evidence registry is reviewed (`evidence-2026-10-24.1`, exact quotes, real PMIDs;
  see ai/evidence/starting-sources.md). Default mode is cached; opt-in PubMed
  ranking (`EVIDENCE_RETRIEVAL=pubmed`) selects only among registered sources and
  is the only path labeled live. Unverified or placeholder sources never reach a run.
