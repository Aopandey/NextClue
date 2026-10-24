# Daniel — Backend and integration

**Your goal:** make the complete demo work reliably from patient history to clinician handoff.

For **H3 healthcare coordination**, preserve the evidence behind every item in the referral-ready brief.

## Own these pieces

- Agree on JSON contracts with Avinash and Mike immediately; provide a synthetic patient and sample response.
- Build FastAPI endpoints for health, patient records, analysis, and source lookup.
- Validate AI output with Pydantic. Preserve finding IDs, source links, uncertainties, and missing-report questions.
- Save the small demo dataset and results in SQLite.
- Handle timeouts, failures, restart recovery, and deployment.

Keep keys on the server. Use synthetic data only. A fallback may use a clearly labeled, matching real prior analysis; never silently substitute a prepared answer for a failed live run.

## Use Kiro

Use Kiro to build the API and validation from the shared spec. Keep genuine artifacts in the root `.kiro/` folder and ensure it is tracked, not ignored. Send Sean a short note explaining actual Kiro use and its benefit.

Add accurate setup/run instructions when the app works. Make the demo freely accessible to judges, with simple testing instructions.

## Your schedule

**October 24, Eastern; team milestones, not extra event deadlines.**

| By | Deliver |
| --- | --- |
| 12:30 PM | Contracts, API skeleton, and sample response |
| 2:30 PM | Real AI connected to the interface |
| 4 PM | Complete flow with persistence |
| 5 PM | Failure handling and deployment checks; feature freeze |
| 6 PM | Stable demo URL and verified run instructions |

After 5 PM, fix blockers and support submission. Submission closes at **8 PM**; no changes to the submitted version afterward without organizer approval.

## Demo check

Load Sarah → run analysis → inspect evidence → open the handoff brief → refresh without losing the result.

**Done means:** a teammate can run the app, source links resolve, results survive a restart, and failures are explained honestly.

**Skip:** EHR integration, authentication, queues, vector databases, and extra infrastructure.
