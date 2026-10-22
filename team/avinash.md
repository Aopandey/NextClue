# Avinash — AI and Evidence

**Your job:** turn the patient's history into an understandable, source-backed explanation of what deserves investigation next.

## What you own

- Extract findings from notes, including dates and exact source excerpts.
- Keep patient findings, family history, negatives, and unknowns separate.
- Retrieve a small set of useful medical sources; prepare cached evidence.
- Compare up to three possible explanations, including an alternative to the rare-disease hypothesis.
- Explain limitations of earlier results and identify the next evidence worth verifying.

Use one strong model with two bounded steps: **extract findings, then synthesize evidence**. Use a small verified HPO subset only if it is quick to implement.

## What you hand off

Agree with Daniel on the patient input and analysis output JSON before building. Return structured findings, evidence-linked claims, candidate explanations, missing information, and suggested clinician questions.

Every claim must reference real record and source IDs. Daniel validates the response; Mike renders it. Keep source URLs and execution metadata under backend control.

## Your schedule

| Time | Deliverable |
| --- | --- |
| Hour 0–1 | Working model access, agreed schema, extraction prompt |
| Hour 1–2 | Validated analysis using curated evidence |
| Hour 2–3 | Retrieval connected; real output reaches the interface |
| Hour 3–5 | Reliable missing-evidence reasoning and source review |
| Hour 5–6 | Run evaluation scenarios with Sean; fix failures |
| After Hour 6 | Bug fixes and demo support only |

## The key demo result

Explain why Sarah's old normal enzyme screen does not independently settle the illustrated Fabry question, then flag the missing molecular report. Start by checking whether that report already exists.

## Done means

The output is readable, every displayed claim is traceable, unknowns stay unknown, and the clinician has a justified next question. Record actual evaluation outcomes without inventing accuracy figures.

**Skip:** model training, multi-agent loops, broad disease coverage, unsupported probabilities, and treatment recommendations.
