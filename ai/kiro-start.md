# Your updated first task in Kiro

Historical initial prompt: this work has now been completed. Kept here as a
record of the original task. Use the verification prompt in [next-steps.md](next-steps.md)
for the current Codex implementation / Kiro review workflow.

```text
I own NextClue's AI/evidence work. Read .kiro/steering/nextclue.md,
.kiro/specs/ai-evidence/, ai/README.md, and backend/app/contracts.py.
Review the draft spec, then implement the remaining evidence work with me.

Daniel's backend is here. ai/pipeline.py connects Gemini to his Finding and
AnalysisOutput types through backend/app/pipeline.py. Preserve the shared
schema, record/source IDs, database, and frontend. My key/model is configured
locally; never display or commit the key.

First run the connection and extraction checks in ai/README.md. Report actual
provider failures; do not fabricate output or silently switch models.

The next substantial task is evidence. backend/data/sources.json contains
unverified paraphrases and a placeholder neuropathy paper. Verify against the
original sources and replace the placeholder with a real paper. Preserve IDs
whose meaning remains unchanged, bump evidence_version, and coordinate
re-seeding with Daniel. Do not merely mark unreviewed text verified.

Implement a bounded PubMed API lookup with real PMIDs and a reviewed registry
cache. Sources must resolve through the backend and be evidence-versioned
before a run uses them. Do not silently inject unregistered live search results.
The current adapter uses cached evidence; label retrieval live only when it ran.

Run Sarah, James, and the changed-input scenarios in ai/evaluation.md. Fix
prompt/schema/reference failures. Keep exact record quotations, at least one
non-rare alternative, uncertainty, and checking existing reports first.
Do not hard-code Sarah's expected conclusion or reuse the UI fixture as AI output.

Run backend and AI tests. Record actual Kiro features, changed files, benefits,
and checks in ai/kiro-usage.md. Coordinate the full API flow with Daniel and Mike.
```

Codex prepared the starter and adapter. Kiro's subsequent source review,
retrieval implementation, and evaluations are recorded in [kiro-usage.md](kiro-usage.md).
