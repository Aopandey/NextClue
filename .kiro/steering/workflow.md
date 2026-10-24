---
inclusion: always
---

# How Mike runs agent work

Drawn from Mike's own prompts across past Kiro sessions. Applies to every task in this repo.

## Git
- Work only in the branch or worktree you were given. Other sessions are often active in this repo at the same time; never touch their files or uncommitted changes.
- Commit locally in small commits, staging files by name. Never push, merge or open a PR without asking first. (`.kiro/hooks/ask-before-push.json` asks before any `git push`/`git merge`.)
- Never commit keys or `.env` files. (`.kiro/hooks/block-secrets.json` blocks such commits.)

## Authority
- For frontend work, `team/mike.md` is Mike's brief and wins on any conflict. The spec named in a task beats its plan.
- When Mike cuts scope ("keep it 10 for now"), apply the cut everywhere — plan, tests, steering — and record it.

## How to work with Mike
- Show mocks, options and questions in `/lavish`, and ask questions there rather than in a long chat reply.
- Multi-step builds: use `/subagent-driven-development` with its progress ledger under `.superpowers/sdd/`. On a new session, read that ledger before doing anything.
- Do not run schedule or deadline checks unless asked; reminders run elsewhere.
- Show the command output before saying something works.
- Rejected directions: remove them from the working view, but keep them recoverable in git (note the commit).
- Keep replies short; Mike asks for detail when he wants it.

<!-- Sources (Kiro session IDs): 01f9bda5, bd2b50b2, b6259a3f, a063fc78, 747870b1 -->
