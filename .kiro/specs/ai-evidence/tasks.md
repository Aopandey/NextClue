# AI evidence tasks

Codex prepared the Gemini client, two-stage adapter, backend hook, and offline
checks. Tasks 1–4 were completed in Kiro on October 24, 2026; see
ai/kiro-usage.md and ai/evaluation.md for what was actually run.

- [x] 1. Review the spec against Daniel's actual models and run connection and
  extraction checks. Preserve the configured key/model and shared schema.
- [x] 2. Verify/replace medical evidence and the placeholder paper. Preserve
  meaningful IDs, bump evidence_version (`evidence-2026-10-24.1`).
  - [x] 2a. Codex connected the hosted Supabase project and updated the source
    registry to evidence-2026-10-24.1; canonical patient rows were preserved.
- [x] 3. Build bounded PubMed lookup with real PMIDs and a reviewed registry cache.
  Register and version evidence before citing it; keep live/cached labels honest.
- [x] 4. Run real Sarah/James analyses and changed-input/prompt-injection checks.
  Fix failures without hard-coding a conclusion or replaying the UI fixture.
- [x] 5a. Codex verified the real HTTP API against Gemini and hosted Supabase:
  Sarah/James completed, citations resolved, and stored runs were reused.
- [ ] 5b. Connect Mike's frontend and verify source drawers and result labels.
  Kiro work is recorded in ai/kiro-usage.md for Sean.
- [ ] 6. Open quality issues from ai/evaluation.md: claims that restate the
  record, occasional evidence misfit, "test is necessary" wording.
