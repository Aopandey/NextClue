# Product: NextClue health screen (Constellation)

Binding spec: `docs/superpowers/specs/2026-10-24-health-screen-constellation-design.md`. Visual reference: `docs/design/constellation/reference.html`.

## Story
The patient health screen for one patient. Its centre is a constellation: the AI analysis's findings drawn as coloured nodes around the open disease questions (hypotheses). The 2016 "normal" test is drawn as looked normal, not conclusive; the missing GLA report is an empty, dashed "check first" slot. Clicking any node opens a short panel with the verbatim record quote and a cited, hyperlinked source.
For judges: seven findings from five specialties point at Fabry disease. A normal 2016 enzyme test does not rule it out in a woman. A genetics report from 2019 may already exist. Nothing is confirmed, and the clinician decides.

## Decisions
1. Visual-first: at most 70 visible words at rest; detail lives in the panel and its disclosures.
2. Hubs: up to 3 open hypotheses (`status: "open"` only), equal ~100px circles — 1 centred, 2 side by side, 3 a triangle; never invent a hypothesis.
3. Findings coloured by body system with one icon each; `assertion: "absent"` is hollow; edges `supports` solid/system colour, `previously_tested` dotted grey, `would_clarify` dashed signal colour.
4. Prior result: half-filled node labelled "<year> test · normal / not conclusive".
5. Missing evidence: dashed empty nodes; a persistent Check first marker for the priority-1 item ("GLA report · may already exist").
6. Detail panel, 4 lines (label + date · specialty; verbatim quote + `record_id`; "Why it matters" ≤ 14 words; citation line) plus collapsed disclosures: Source quote, More about this record, More about this disease.
7. Citations are hyperlinks: `url` plus "PMID n" (PubMed) or an NCBI Bookshelf ID; PLACEHOLDER titles show "PMID pending" + "Search PubMed"; "Unverified paraphrase" while unverified; never invent a PMID.
8. Zoom: wheel/pinch, drag pan, `+` `−` Fit, double-click zooms to a node; > 1.6× shows label, year, specialty, first 8 quote words; < 0.8× icons only.
9. Scale: > 16 findings collapse into body-system clusters (count inside, bundled edges, click fans out, Back returns); ≥ 60 adds year filter + "Only linked to open questions"; > 3 missing → "+N missing"; dev-only `?stress=60|250` labelled synthetic.
10. Backend states are honest: loading, queued/running with elapsed time, completed by provenance (fixture / live · model / replayed + Retry live), failed with message + code (+ Retry if retryable), "Evidence: cached"; `run.disclaimer` always in the footer.
11. Copy: never the word "diagnosis"; hypotheses are "open", never "likely" or a percentage.
12. Look: light only on `#fbf8f2`; Atkinson Hyperlegible Next / Mono, Source Serif 4; no banned fonts, card grids, pills, shadows or decorative gradients; ≤ 2 transitions, off under reduced motion.
13. Phone (390px): panel is a bottom sheet, tap targets ≥ 40px, one-word labels, clusters only above 16, no horizontal scroll.

Out of scope: dashboard/patient list, accounts, chat, treatment advice.
