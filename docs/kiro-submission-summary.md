# NextClue - How we used Kiro

Hackachusetts 2026 | October 24, 2026

## Tools and team workflow

We used Kiro CLI for coding and review, including conversational sessions and one /autonomous session. Kiro Crew supported deadline reminders, team-chat summaries, and flagging an exposed Supabase credential in a screenshot. Crew did not write application code. Gemini powers the application at runtime; Kiro helped develop it.

## Specifications and steering

The evidence pipeline used requirements, design, and tasks in `.kiro/specs/ai-evidence/`. The health-screen spec and ten-task plan made frontend requirements testable: limited visible text, up to three open hypotheses, and defined zoom behaviour. Steering files preserved synthetic-data rules, uncertainty, citation requirements, code ownership, and visual design. The team replaced an early vibe-coded workspace with a focused, spec-led ten-record view.

## Evidence pipeline and validation

Kiro reviewed four medical sources and 23 exact excerpts, replaced a placeholder paper, and implemented bounded PubMed lookups restricted to registered PMIDs. It revised prompts and checks for record quotations, citation IDs, evidence applicability, and existing-report questions. Sarah, James, and changed-input scenarios tested missing results, family history, sex-related evidence, and prompt injection. Observed failures became prompt fixes and regression tests.

## Review and document exports

Kiro reviewed Codex changes and found five concrete problems, including cached fallback reuse and trickling responses outlasting deadlines; Codex implemented the fixes. In a separate local build, Kiro implemented code-formatted handoff briefs and specialty-specific Gemini referral drafts with clinician editing, reference checks, and Markdown/print-ready HTML exports. That checkout reported 220 passing tests plus seven subtests with outbound network blocked, and headless Edge print checks. The export code was not included in the inspected main snapshot.

## Experiments and testing limits

Push-confirmation, secret-blocking, and contribution-log hooks were prototyped in a separate worktree but were not active during the main build. Vercel MCP was connected and checked by listing projects. Workflow skills supported planning, review, and worktree isolation; no Kiro Powers were installed. Testing was example-based and scenario-based, not property-based. These checks do not establish clinical accuracy.

## Attribution

Kiro contributed evidence handling, specification-driven work, evaluation, review, and local export features. Codex contributed the starter integration, hosted-database checks, and reliability fixes. Claude contributed frontend implementation, integration, and later refinements. The team made product decisions, reviewed outputs, and controlled scope. Detailed contributions remain recorded by stage in [ai/kiro-usage.md](../ai/kiro-usage.md).

---

Reviewed main: [`58fd098`](https://github.com/Aopandey/NextClue/commit/58fd0987b6478d1ae59ab03171b933f4c694a6ba). CLI/Crew activity and experiments are team-reported.
