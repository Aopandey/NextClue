# Avinash — AI and evidence

**Your goal:** turn Sarah's scattered history into a trustworthy brief for the next clinician.

For **H3 healthcare coordination**, the useful result is a clearer neurology-to-genetics handoff: known findings, unresolved questions, and records worth checking next.

## Own these pieces

- Extract findings, dates, and short source excerpts from the synthetic records. Keep patient findings, family history, negatives, and unknowns separate.
- Retrieve a small set of relevant medical sources; cache them for a reliable demo.
- Explain what previous tests established and what they left uncertain.
- Produce a short investigation brief with evidence links and missing reports to check first. Show no more than three possible explanations.

Agree on the JSON contract with Daniel first; give Mike a realistic sample immediately. Use one LLM with two bounded steps: extraction, then evidence review.

## Use Kiro

Build the pipeline with Kiro using the shared spec and steering guidance. Commit genuine artifacts into the root `.kiro/` folder. Give Sean a short note on the features you actually used and how they helped.

## Your schedule

**October 24, Eastern; team milestones, not extra event deadlines.**

| By | Deliver |
| --- | --- |
| 12:30 PM | JSON contract and sample output |
| 2:30 PM | Real AI output in Mike's interface |
| 4 PM | Complete evidence-to-handoff demo |
| 5 PM | Source review and essential fixes; feature freeze |
| 6 PM | Stable demo output and Kiro notes for submission |

After 5 PM, help with fixes and rehearsal. Submission closes at **8 PM**; no changes to the submitted version afterward without organizer approval.

## Demo check

Sarah's old normal enzyme screen does not settle the case. Highlight the question: **does the relevant genetic testing report already exist?** Keep the case unconfirmed.

**Done means:** important claims trace back to a record and medical source; uncertainty stays visible; the brief helps a clinician continue the investigation.

**Skip:** model training, complex agent systems, fake probabilities, broad disease coverage, and treatment advice.
