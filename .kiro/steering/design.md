# Design rules (from the plan's Global Constraints + controller rulings)

Visual reference `docs/design/constellation/reference.html` governs the look; the plan governs positions, behaviour, thresholds and copy. Never copy the reference's hand-written SHORT/WHY/HUB_NAME maps — canvas text is derived from data.

## Tokens (`frontend/app/globals.css` `:root`, copied exactly; use `var(--…)`, never raw hex)
- Surfaces and text: `--bg:#fbf8f2` `--ink:#24211c` `--mut:#6f675b` `--faint:#a39a8b` `--line:#e7e0d3` `--sig:#d4520c` (signal)
- Body systems: `--nerve:#6d4aa8` `--sweat:#0d7c80` `--gut:#a0700a` `--kidney:#a8385f` `--eye:#2c63b2` `--family:#4b7b2c` `--blood:#5d6a7a` `--heart:#b23a3a` `--lung:#2f7894` `--joint:#7a6a2a` `--other:#8a8378` (fallback)

## Fonts (`next/font/google`, CSS variables on `<html>`)
- `--font-ui` Atkinson Hyperlegible Next (all UI; body default) · `--font-mono` Atkinson Hyperlegible Mono (IDs, dates) · `--font-serif` Source Serif 4 (hub names only).
- Banned: Inter, Lexend, Poppins, DM Sans, Space Grotesk, Plus Jakarta.

## Bans
- No card grids, pills, drop shadows or decorative gradients. Light theme only (no `.dark`, no dark-mode media query).
- Never invent clinical content or a PMID. Every label, quote and claim comes from `AnalysisRun.output`, `PatientRecord.documents` or `Source`.
- Never the word "diagnosis" in UI copy; hypotheses are "open", never "likely" or a percentage.
- Excerpts: strip the `"[Unverified paraphrase] "` prefix; show "Unverified paraphrase" while `verification_status === "unverified"`.

## Text budget (canvas)
- ≤ 70 visible words in the constellation region at rest. Hubs ≤ 3 (open only, by supporting-finding count desc, ties by array order).
- R1 truncation: cut at the last word boundary within 28 chars (fallback hard 28-char cut), trim trailing punctuation, append "…"; full text in the panel.
- R2 Check first second line: `<first word> <last word of description> · may already exist` (e.g. "GLA report · may already exist").
- R3 negative labels: label starting "No " → its first two words without punctuation ("No diabetes"); else "No " + first word lowercased ("No celiac").
- Semantic zoom: scale > 1.6 shows finding detail; < 0.8 hides labels; extent [0.5, 4]. > 16 findings with a graph node → body-system clusters.

## Motion
- At most 2 transitions: a one-time load reveal and the hover dim, both only inside `@media (prefers-reduced-motion: no-preference)`.

## Phone (390px)
- No horizontal page scroll, every tap target ≥ 40px, detail panel is a bottom sheet, one-word labels.
