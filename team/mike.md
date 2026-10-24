# Mike — Interface and demo

**Your goal:** make the next clinician understand Sarah's history and open questions in seconds.

For **H3 healthcare coordination**, the interface should make a neurology-to-genetics handoff easier to review.

## Own these pieces

Build one workspace with three clear areas:

1. **History:** a readable timeline of symptoms, visits, and tests.
2. **Evidence:** a small clue graph and a drawer showing original records and medical sources.
3. **Handoff brief:** key findings, unresolved questions, and missing reports to check first.

Use Next.js, TypeScript, Tailwind, and React Flow. Keep the graph to roughly 8–12 fixed nodes. Start with Daniel's sample JSON and connect Avinash's real output early.

Preserve source IDs, show loading and failure states, and label any cached result clearly. Keep clinician review visible.

## Use Kiro

Use Kiro to build the workspace from the shared spec and steering guidance. Commit genuine artifacts into the root `.kiro/` folder. Give Sean a short example of how Kiro helped and screenshots of the finished flow.

## Your schedule

**October 24, Eastern; team milestones, not extra event deadlines.**

| By | Deliver |
| --- | --- |
| 12:30 PM | Workspace shell using sample JSON |
| 2:30 PM | Timeline, source drawer, and real AI output |
| 4 PM | Complete graph-to-handoff demo |
| 5 PM | Readability and error-state polish; feature freeze |
| 6 PM | Recording-ready interface |

After 5 PM, fix demo blockers and rehearse with Sean. Submission closes at **8 PM**; no changes to the submitted version afterward without organizer approval.

## Demo check

Click a finding → see related events → open the old normal test → read its limitation → see the missing-report question in the handoff brief.

**Done means:** the story is easy to follow, evidence opens correctly, uncertainty is clear, and the demo works reliably.

**Skip:** extra pages, chat, graph physics, elaborate animation, accounts, and a new design system.
