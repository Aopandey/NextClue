# Health screen: Constellation design

**Status:** approved direction, 2026-10-24. Mike picked V · Constellation in Lavish Round 8.
**Visual reference:** `docs/design/constellation/reference.html`. It is a standalone page that runs offline, built from the real Sarah fixture. Screenshots are in the same folder.
**Data contract:** `contracts/README.md` and `contracts/schema/*.json`, both on `main`, from Daniel's backend (commit 89c3f0a).

## What it is
The patient health screen for one patient. Its main element is a **constellation**: the AI analysis's findings drawn as coloured nodes around the open disease questions (hypotheses). The 2016 "normal" test is drawn as *looked normal, not conclusive*. The missing GLA report is drawn as an empty, dashed "check first" slot. Clicking any node opens a short detail panel, which shows the verbatim record quote and a cited, hyperlinked source.

Story for judges: seven findings from five specialties point at Fabry disease. A normal 2016 enzyme test does not rule it out in a woman. A genetics report from 2019 may already exist. Nothing is confirmed, and the clinician decides.

## Decisions (each was asked for by Mike or follows from the contract)
1. **Visual-first, little text.** At rest the screen shows at most 70 visible words. The detail lives in the panel and its disclosures.
2. **Disease hubs.** Up to **3** open hypotheses show at once as equal, modest circles about 100px across. The layout depends on the count:
   - 1 hub: centred.
   - 2 hubs: side by side.
   - 3 hubs: a triangle.
   
   Only hypotheses with `status: "open"` are hubs. The app never invents a hypothesis. Sarah has 2.
3. **Findings** are coloured by **body system**, with one icon per system:
   - nerve, sweat (skin), gut, kidney, eye, family, blood
   - heart, lung, joint (used only by larger records)

   Findings with `assertion: "absent"` are drawn hollow. Edges come from `run.graph.edges`:
   - `supports`: solid, in the system colour
   - `previously_tested`: dotted, grey
   - `would_clarify`: dashed, in the signal colour
4. **Prior result** (`prior_results[]`): a half-filled node with the label "<year> test · normal / not conclusive".
5. **Missing evidence** (`missing_evidence[]`): dashed empty nodes. A persistent **Check first** marker shows the priority-1 item: "GLA report · may already exist".
6. **Detail panel**, condensed, with 4 lines:
   1. the label, then date · specialty
   2. one verbatim record quote, with its `record_id`
   3. "Why it matters": at most 14 words, the first clause of the linking claim
   4. a citation line: publisher · title · location, with an ID and a link

   Disclosures, all collapsed by default:
   - **Source quote:** the full paraphrase.
   - **More about this record:** the full note text with the excerpt highlighted, its metadata, the observations table, and other findings from the same record.
   - **More about this disease** (on hubs): the summary, supporting findings, supporting and contradicting claims with links, missing evidence with its why-it-matters and possible-outcomes table, and the related clinician questions.
7. **Citations are hyperlinks.** Link to `url`, plus an ID link:
   - when `pmid` is set: "PMID n", linking to `https://pubmed.ncbi.nlm.nih.gov/n/`
   - otherwise an NCBI Bookshelf ID parsed from the url, such as `NBK1292`, linking to the url
   - a source whose title starts with `PLACEHOLDER`: "PMID pending" plus a "Search PubMed" link
   
   **Never invent a PMID.** Every source shows "Unverified paraphrase" while `verification_status` is `"unverified"`, and the excerpt text has its `[Unverified paraphrase] ` prefix stripped.
8. **Zoom.** Wheel or pinch zooms and dragging pans. Buttons provide `+`, `−` and Fit. Double-clicking a node zooms to it. Above 1.6× scale, each finding also shows its label, year, specialty and the first 8 words of its quote (semantic zoom). Below 0.8× scale, labels hide and only icons remain.
9. **Scale.** With more than 16 findings, findings collapse into **body-system clusters**:
   - Each cluster is one node sized by its count, with the count number inside.
   - Edges from a cluster to a hub are bundled, with width proportional to the number of supporting findings.
   - Clicking a cluster fans out its findings and dims everything else; a Back control returns.
   - At 60 or more findings, a year-range filter and an "Only linked to open questions" toggle appear.
   - More than 3 missing items collapse to "+N missing".
   - A dev-only `?stress=60|250` query renders a deterministic synthetic record, labelled "Synthetic stress test, not backend data".
10. **Backend states** are visible and honest:
    - loading
    - `queued` / `running`, with elapsed time while polling
    - `completed`, labelled by `provenance`:
      - fixture: "Sample data · not AI output"
      - live: "Live analysis · <model>"
      - replayed: a notice showing `fallback_reason` with a "Retry live" button
    - `failed`: `error.message` and `error.code`, plus Retry if `retryable`; no findings drawn
    - `evidence_mode: "cached"`: "Evidence: cached"
    
    `run.disclaimer` is always visible in the footer.
11. **Copy rules.** Never use the word "diagnosis" in UI copy. Hypotheses are "open", never "likely" or a percentage.
12. **Look.**
    - Light only, with background `#fbf8f2`.
    - Atkinson Hyperlegible Next for UI, Atkinson Hyperlegible Mono for IDs and dates, Source Serif 4 for hub names.
    - No Inter, Lexend, Poppins, DM Sans, Space Grotesk or Plus Jakarta.
    - No card grids, pills, drop shadows or decorative gradients.
    - At most 2 animated transitions: a one-time reveal on load, and the hover dim. Both are disabled under `prefers-reduced-motion`.
13. **Phone (390px).** The panel becomes a bottom sheet. Tap targets are at least 40px. Hub and node labels shorten to one word. Clusters only above 16 findings. No horizontal page scroll.

## Out of scope today
The dashboard or patient list (parked; Round 7 drafts exist), accounts, chat and treatment advice.
