# Next steps — connect the interface

Backend implementation and real-database checks are ready. Codex handles main
implementation; Kiro is used for focused verification and additional tests.
Keep the record of actual contributions accurate.

1. Integrate on Mike's PC. Commit his frontend work locally, pull `main`, and
   follow [backend/README.md](../backend/README.md) to create the Python environment
   and configure local Supabase/Gemini keys. Point his existing API setting at
   `http://127.0.0.1:8000`. Open the frontend on `http://localhost:3000`, the
   default allowed origin; update `CORS_ORIGINS` if needed. Keep keys on the server.
2. Through the UI: load Sarah, start an analysis, poll its run, open source
   excerpts, and check the missing-report question. Repeat with James.
3. Check loading, failure, cached-result, and replay behavior. `provenance=live`
   means a fresh model run; `evidence_mode=cached` means registered research was
   used. Those labels describe different things.
4. Review wording and evidence relevance before recording the demo. Passing
   reference checks does not establish clinical correctness.
5. After integration, commit and push the tested frontend changes. Keep `.env`,
   local runs, and `.venv` out of Git; keep `.kiro` included.

## Optional Kiro verification prompt

```text
Review the latest Codex changes without changing application code. Run the
backend and AI tests (python -m pytest from the root), focusing on PubMed
recovery after fallback, configuration errors, early environment isolation,
real local transport cancellation/retries, and evidence CLI errors. Use a fresh
workspace --basetemp folder if Windows blocks the default pytest temp path.
Report concrete failures and coverage gaps. Don't run repeated paid Gemini
evaluations unless they address a specific unresolved issue. Record actual
verification work in ai/kiro-usage.md without attributing Codex implementation
to Kiro. Never print keys or read .env values into the report.
```

## Current evidence

- 120 tests and 7 subtests passed with outbound connections blocked and invalid
  parent settings; dependency check passed. No Gemini calls were made for these fixes.
- Real HTTP API + Gemini + hosted Supabase: Sarah and James completed as fresh
  runs, citations resolved, and repeat requests reused their stored results.
- Registered evidence: `evidence-2026-10-24.1`, four reviewed sources, 23 excerpts.
- Full-text audit needs the original GeneReviews review copy; bare `check --online`
  now reports missing text as incomplete rather than silently passing.
- PubMed fallback recovery, invalid settings, malformed review-copy arguments,
  and trickled-response cancellation are fixed. Prior real-service checks above
  predate this patch; repeat the end-to-end check through Mike's interface.
- Avinash's updated local API returned HTTP 200 on `/health`, with the hosted
  database connected. Repeat this check on Mike's PC after setup.
