# NextClue

**Connect years of medical clues. Help a clinician decide what to investigate next.**

Built for a four-person, nine-hour Hackachusetts healthcare project. **Current status: project plan; the application has not been implemented.**

## The idea, simply

A patient might see one doctor for nerve pain, another for stomach problems, and another for a kidney issue. Important clues can remain scattered across their records.

NextClue brings that history together, connects relevant findings, and highlights the questions that still need answers. The clinician can inspect the original records and medical sources before choosing a next step.

## What the demo should do

1. **Connect the history:** show one synthetic patient's findings on a clear timeline and small clue graph.
2. **Review the evidence:** compare possible explanations and show what previous tests actually established.
3. **Clarify the next step:** identify missing information, explain why it matters, and check for existing reports first.

Every important claim should link to both the patient evidence and an appropriate medical source.

## The memorable example

Sarah is a fictional patient with years of nerve pain, stomach symptoms, and kidney findings. An old normal enzyme screen looked reassuring. NextClue explains why that result may not fully exclude Fabry disease in a woman, then highlights the next question: **does a relevant genetic testing report already exist?** The case remains unconfirmed.

Rare-disease AI already exists. Our focus is making previous results, unresolved evidence, and the next investigation easy to review.

## Build only what matters

**Stack:** Next.js + TypeScript, React Flow, Python + FastAPI, SQLite, one LLM, and PubMed with cached evidence. Use Kiro as required by the event.

**Cut:** real EHR integration, accounts, treatment advice, complex agent systems, and vector databases.

## Team and finish line

| Teammate | Ownership |
| --- | --- |
| [Avinash](team/avinash.md) | AI, extraction, retrieval, evidence reasoning |
| [Mike](team/mike.md) | Interface, timeline, graph, demo polish |
| [Daniel](team/daniel.md) | APIs, contracts, persistence, reliable integration |
| [Sean](team/sean.md) | Story, sources, testing, slides, submission |

Agree on JSON contracts first. Show real AI output in the interface by **Hour 3**, complete the demo by **Hour 4.5**, and freeze features at **Hour 6**. Use the remaining time for fixes, evaluation, and rehearsal.

**Clinical decision support only.** Use synthetic data, show uncertainty, keep clinicians in control, and make no claims of clinical validation.

## How NextClue works

![NextClue high-level flowchart showing patient history, timeline structure, evidence retrieval, review of prior results, missing evidence, and clinician follow-up.](assets/nextclue-flowchart.png)
