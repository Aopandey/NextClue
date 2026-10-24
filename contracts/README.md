# NextClue JSON Contracts — Draft v1

**Status: draft for team agreement.** Avinash and Mike: please review before Hour 1 ends. Once we agree, Daniel turns this into Pydantic models (the source of truth) and exported JSON Schema files in `contracts/schema/`.

## How data flows

```
GET /patients/{id}  ──► PatientRecord ──► AI pipeline (Avinash) ──► AnalysisOutput
                                                                       │ backend validates every ID
                                                                       ▼
Frontend (Mike) ◄── GET /analyses/{run_id} ◄── AnalysisRun = status + provenance + output + timeline + graph
       │
       └── GET /sources/{source_id} ──► Source (for the evidence drawer)
```

## Ground rules

- **Typed ID prefixes.** Never rename or regenerate IDs. Mike uses them for highlighting, and the backend uses them for validation.

  | Prefix | Object |
  | --- | --- |
  | `rec-` | patient document |
  | `fnd-` | finding |
  | `clm-` | claim |
  | `hyp-` | hypothesis |
  | `pri-` | prior result review |
  | `mis-` | missing evidence |
  | `q-` | clinician question |
  | `src-` | source |
  | `exc-` | source excerpt |

- **Patient excerpts are verbatim.** Every `record_refs[].excerpt` must appear word for word in that document's `text`. The backend rejects output where it doesn't.
- **Every claim links to both kinds of evidence:** at least one patient record and at least one source excerpt.
- **No probabilities.** Hypotheses use a qualitative `status` only.
- **Unknown stays unknown.** Gaps go in `missing_evidence` and are never filled with guesses.
- **Unknown keys are rejected.** Every contract is strict, so extra fields fail validation.
- **Dates** use `YYYY-MM-DD`. **Timestamps** use ISO 8601 UTC.

---

## 1. PatientRecord — `GET /patients/{id}`

The input to the AI pipeline. Synthetic data only.

```jsonc
{
  "schema_version": "patient.v1",
  "patient_id": "sarah-001",
  "record_version": 1,              // bump whenever any document changes
  "synthetic": true,                // always true
  "demographics": { "display_name": "Sarah (synthetic)", "sex_at_birth": "female", "birth_year": 1986 },
  "documents": [
    {
      "record_id": "rec-2016-enzyme",
      "date": "2016-03-01",
      "type": "lab_result",         // clinic_note | lab_result | imaging | pathology | referral | genetic_report | other
      "specialty": "neurology",
      "title": "Alpha-galactosidase A enzyme activity",
      "author_role": "Reference laboratory",   // role only, never a name
      "text": "Leukocyte alpha-galactosidase A enzyme activity within the laboratory reference range. No molecular testing performed on this sample.",
      "observations": [             // optional structured values
        { "name": "Alpha-galactosidase A activity (leukocytes)", "value": "within reference range",
          "unit": null, "reference_range": "laboratory-specific", "interpretation": "normal" }
      ]
    }
  ]
}
```

## 2. AnalysisRequest — `POST /analyses`

```jsonc
{
  "patient_id": "sarah-001",
  "record_version": 1,              // optional; omit for latest
  "excluded_record_ids": [],        // documents the clinician chose to leave out
  "force_refresh": false            // true skips the cache
}
```

The response is an `AnalysisRun` (section 4). If a matching validated run already exists, the backend returns it immediately.

## 3. AnalysisOutput — what the AI pipeline returns

Avinash's two steps, **extract findings** and then **synthesize evidence**, together produce this object. Daniel validates it before the frontend receives it.

```jsonc
{
  "findings": [
    {
      "finding_id": "fnd-limb-pain",
      "label": "Burning pain in hands and feet since adolescence",   // short display text
      "kind": "symptom",            // symptom | sign | lab_result | imaging | pathology | diagnosis | family_history
      "assertion": "present",       // present | absent (a documented negative) | uncertain
      "date": "2012-05-10",
      "specialty": "primary care",
      "record_refs": [{ "record_id": "rec-2012-pcp", "excerpt": "burning pain in her hands and feet since adolescence" }],
      "hpo_id": null                // optional, only if verified
    }
  ],

  "claims": [
    {
      "claim_id": "clm-enzyme-limit",
      "text": "A normal enzyme result does not exclude Fabry disease in a woman, because heterozygous females can have enzyme activity in the normal range.",
      "record_refs": [{ "record_id": "rec-2016-enzyme", "excerpt": "within the laboratory reference range" }],
      "source_refs": [{ "source_id": "src-genereviews-fabry", "excerpt_id": "exc-fabry-female-enzyme" }]
    }
  ],

  "prior_results": [                // the key demo moment
    {
      "prior_result_id": "pri-enzyme-2016",
      "test_name": "2016 alpha-Gal A enzyme screen",
      "record_refs": [{ "record_id": "rec-2016-neuro-fu", "excerpt": "Fabry disease considered unlikely" }],
      "result_summary": "Enzyme activity within reference range",
      "interpretation_at_the_time": "Fabry disease considered unlikely",
      "what_it_established": "Enzyme activity was not low. No genetic test was performed.",
      "limitation_claim_ids": ["clm-enzyme-limit"],
      "hypothesis_ids": ["hyp-fabry"]
    }
  ],

  "hypotheses": [                   // 1–3 items; at least one must be a non-rare alternative
    {
      "hypothesis_id": "hyp-fabry",
      "name": "Fabry disease",
      "is_rare_disease": true,
      "status": "open",             // open | less_supported | excluded
      "summary": "Findings across four specialties are compatible with Fabry disease. Unconfirmed.",
      "supporting_finding_ids": ["fnd-limb-pain"],
      "supporting_claim_ids": ["clm-enzyme-limit"],
      "contradicting_claim_ids": []
    }
  ],

  "missing_evidence": [
    {
      "missing_id": "mis-gla-report",
      "priority": 1,                // 1 = investigate first
      "description": "GLA gene molecular testing report",
      "why_it_matters": "Molecular testing identifies heterozygous females, which the 2016 enzyme screen could not do.",
      "check_existing_first": true, // the record hints that this may already exist
      "existing_record_refs": [{ "record_id": "rec-2024-pcp", "excerpt": "no report from that visit is in our chart" }],
      "claim_ids": ["clm-enzyme-limit"],
      "hypothesis_ids": ["hyp-fabry"],
      "possible_outcomes": [
        { "outcome": "Report exists with a pathogenic GLA variant", "implication": "Fabry disease becomes the leading question, pending clinician confirmation." },
        { "outcome": "Report exists with no variant found", "implication": "Fabry disease becomes much less likely." },
        { "outcome": "No report exists", "implication": "The clinician decides whether testing is warranted." }
      ]
    }
  ],

  "clinician_questions": [
    { "question_id": "q-outside-report", "text": "Can the 2019 outside genetics report be obtained, and did it include GLA testing?", "missing_ids": ["mis-gla-report"] }
  ]
}
```

## 4. AnalysisRun — `POST /analyses`, `GET /analyses/{run_id}`

This is the envelope Mike renders. Poll it until `status` is `completed` or `failed`.

```jsonc
{
  "schema_version": "analysis.v1",
  "run_id": "run-01J...",
  "status": "completed",            // queued | running | completed | failed
  "provenance": "live",             // live | replayed | fixture   (show this label in the UI)
  "replayed_from_run_id": null,     // set when provenance = replayed
  "fallback_reason": null,          // e.g. "Model timed out; showing previous validated run"
  "evidence_mode": "live",          // live | cached   (cached = retrieval failed, labeled cache used)
  "patient_id": "sarah-001",
  "record_version": 1,
  "excluded_record_ids": [],
  "cache_key": "sha256:...",
  "versions": { "schema_version": "analysis.v1", "model": "...", "prompt": "extract-v1+synth-v1", "evidence": "evidence-draft-1" },
  "created_at": "2026-10-24T15:00:00Z",
  "completed_at": "2026-10-24T15:00:40Z",
  "error": null,                    // { "code": "timeout|model_error|validation_failed|retrieval_failed|not_found|internal", "message": "...", "retryable": true }
  "output": { /* AnalysisOutput */ },
  "timeline": [                     // built by the backend: one entry per document, sorted by date
    { "record_id": "rec-2012-pcp", "date": "2012-05-10", "specialty": "primary care", "title": "Primary care visit: limb pain", "finding_ids": ["fnd-limb-pain"] }
  ],
  "graph": {                        // built by the backend: typically 6–12 nodes; hypothesis-linked findings only (see Graph scope); node_id equals the object's ID
    "nodes": [{ "node_id": "fnd-limb-pain", "type": "finding", "label": "Burning pain in hands and feet" }],
    "edges": [{ "edge_id": "fnd-limb-pain--supports--hyp-fabry", "source": "fnd-limb-pain", "target": "hyp-fabry", "relation": "supports" }]
                                    // relation: supports | previously_tested | would_clarify
  },
  "disclaimer": "Clinical decision support prototype using synthetic data. Not clinically validated."
}
```

**Graph scope.** `graph.nodes` of type `finding` include only findings that support at least one hypothesis; every hypothesis, prior result and missing-evidence item is always a node. Unlinked findings are intentionally omitted to keep the graph small and connected, so a run can have far fewer graph nodes than `output.findings` (e.g. 12 findings, 6 nodes). They remain complete in `output.findings` and `timeline[].finding_ids`; a client that shows them draws them itself, using the finding's `finding_id`, without edges.

**Provenance labels:**

| Label | Meaning |
| --- | --- |
| `live` | Produced by this request. |
| `replayed` | An earlier validated AI run whose cache key matches. Used as a fallback when inference fails. |
| `fixture` | A hand-authored sample for UI development. **Never** presented as AI output. |

**Cache key** = hash of (full patient record + exclusions + schema version + model + prompt version + evidence version). Changing any record invalidates earlier runs.

## 5. Source — `GET /sources/{source_id}`

```jsonc
{
  "source_id": "src-genereviews-fabry",
  "source_type": "genereviews",     // genereviews | pubmed | guideline | hpo | other
  "title": "Fabry Disease",
  "publisher": "GeneReviews (NCBI Bookshelf)",
  "year": null,
  "url": "https://www.ncbi.nlm.nih.gov/books/NBK1292/",
  "pmid": null,
  "excerpts": [{ "excerpt_id": "exc-fabry-female-enzyme", "text": "...exact quote...", "location": "Diagnosis" }],
  "verification_status": "unverified",   // Sean sets this to "verified" after checking every quote
  "retrieved_on": null
}
```

Sources are stored in a registry file with an `evidence_version`, which feeds into the cache key. Source URLs and run metadata are controlled by the backend; the LLM only references `source_id` and `excerpt_id`.

---

## Open questions for the team

1. **Avinash:**
   - Does the two-step split fit your prompts? Step 1 returns `findings`. Step 2 returns everything else.
   - Should step 2 receive the source registry, or only the excerpts you retrieve?
2. **Mike:**
   - Is a backend-built `timeline` and `graph` enough, or do you want layout hints (x/y or column) on the graph nodes?
3. **Both:**
   - Is `kind` + `assertion` enough to keep patient findings, family history, and negatives visually separate?

## Next steps (after agreement)

1. `backend/app/contracts.py`: Pydantic v2 models, strict.
2. Export JSON Schema to `contracts/schema/`. Optionally generate TypeScript types for Mike.
3. Cross-reference validator and cache-key function.
4. Synthetic Sarah record, source registry, and a labeled `fixture` run for Mike to build against.
