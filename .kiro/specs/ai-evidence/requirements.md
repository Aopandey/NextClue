# AI evidence pipeline — requirements

Drafted with Codex; reviewed and extended in Kiro on October 24, 2026 against
Daniel's implemented backend/app/contracts.py, which remains the source of truth.

1. WHEN synthetic records are supplied, the pipeline SHALL extract dated findings
   with real record IDs and exact excerpts, separating patient facts, family
   history, explicit negatives, and unknowns.
2. WHEN reviewing a prior test, the pipeline SHALL use supplied medical evidence
   and show both the record ID and source ID for its interpretation. Its
   limitation claims SHALL cite that test's own record.
3. WHEN preparing a handoff, the pipeline SHALL summarize known findings,
   unresolved questions, and existing reports worth checking first, ranked ahead
   of newly obtained information. It SHALL NOT confirm a diagnosis, invent
   probabilities, or recommend treatment.
4. WHEN either stage returns output, the pipeline SHALL use Daniel's Finding
   and AnalysisOutput types. Unknown IDs, blank quotes, and mismatched excerpts
   SHALL fail validation. Internal envelopes SHALL NOT change the public API.
5. WHEN Gemini or retrieval fails, the pipeline SHALL report the failure honestly.
   A prepared fixture SHALL NOT be presented as a successful model run. Retries
   SHALL use the same model and SHALL be bounded.
6. WHEN a result is shown, patient claims SHALL trace to records and clinical
   interpretations SHALL also trace to reviewed evidence. Insufficient evidence
   SHALL remain explicit.
7. WHEN development is complete, the team SHALL record actual Kiro work and run
   the changed-input checks in ai/evaluation.md. These are not clinical validation.
8. WHEN a medical claim is generated, its source SHALL be reviewed and registered.
   Placeholder text SHALL NOT be treated as verified evidence, even if flagged verified.
9. WHEN live retrieval is enabled, PubMed SHALL only select among registered,
   evidence-versioned sources. A run SHALL be labeled live only when that
   retrieval ran and determined its evidence; otherwise cached.
10. WHEN evidence is applied, sex-, assay-, or phenotype-specific excerpts SHALL
    match the patient's documented details; competing explanations SHALL NOT
    share the same evidence-backed claim.

Review notes: requirements 1–8 matched the implementation's contract. Gaps found
and added: live/cached labeling (9), evidence applicability (10), limitation
traceability (2), existing-first ordering (3), and same-model retries (5).
