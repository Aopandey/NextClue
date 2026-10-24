# Hover + detail panel polish — implementation plan

**Spec:** `docs/superpowers/specs/2026-10-24-health-screen-constellation-design.md`, as amended by the user's approval of the mock `.lavish/panel-hover.html` on 2026-10-24. The approved mock overrides the spec where they conflict, as listed in "Spec amendments". The mock is the visual reference: open it in a browser, or read its CSS, for any value this plan doesn't state.

**Worktree:** `/Users/mikehuynh/Documents/NextClue/.claude/worktrees/panel-polish` (branch `panel-polish`). The frontend is in `frontend/`.

## Global Constraints

- Commands (run from `frontend/`): `npm test` (vitest), `npm run typecheck`, `npm run lint`, `npm run test:e2e` (Playwright; it starts its own offline server on :3100).
- Colours come only from the tokens in `app/globals.css` (`--bg --ink --mut --faint --line --sig` and the system colours). These literals from the mock are the only exceptions: `#fffdf8` (chip background), `#c9d6ec` / `#eef3fb` (ID tag border / background), `#f0c4aa` / `#fdf1ea` (unverified badge border / background).
- Fonts: `var(--font-ui)`, `var(--font-mono)`, `var(--font-serif)` only.
- **No bordered or left-accent boxes around content blocks.** The source block is plain stacked lines (user feedback, 2026-10-24).
- Never use the word "diagnosis" in UI copy. Never invent a PMID. Every source with `verification_status: "unverified"` shows "Unverified paraphrase".
- All motion stays inside the existing `@media (prefers-reduced-motion: no-preference)` guard. State changes (dim, lit, hover size) still apply without it, just without transitions.
- Match the surrounding code style: Tailwind arbitrary values in TSX (`text-[13.5px]`), shared rules in `app/globals.css` under `.detail-panel`, short "why" comments only.
- Do not change data logic: `resolve()`, `claimForFinding()`, `shortClaim()`, `citationFor()` and layout or label placement stay as they are. Only presentation and hover state change.
- Existing tests that encode a behaviour this plan deliberately changes get updated. Every other existing test must keep passing unchanged.

## Spec amendments (approved by the user)

1. Spec §6, "Disclosures, all collapsed by default" now reads: on hub (disease) panels, **Supporting findings** and **Missing evidence** are open by default; Summary, Supporting claims, Contradicting claims and Questions for the clinician are collapsed. Finding, prior and missing panels keep every disclosure collapsed.
2. Spec §6 line 3: on hub panels the label reads "Something you might have missed". Other panels keep "Why it matters". The text is still the ≤14-word `shortClaim`.
3. Spec §12, "at most 2 animated transitions": the hover transition now covers dim, lit edges, ring and node growth together. It still counts as one transition: the hover.
4. Spec §12, "no pills": the square-cornered (4px / 3px radius) count chips, ID tag and unverified badge from the mock are approved.

---

## Task 1: Hover — highlight, grace, lit edges, timing, drag (H1–H6)

**Files:** `components/constellation/Constellation.tsx`, `Node.tsx`, `Hub.tsx`, `Edge.tsx`, `constellation.css`, `components/constellation/__tests__/Constellation.test.tsx`.

**Behaviour:**

- **H1 highlight + growth.** The hovered node gets `data-hover` on its `NodeButton` `<g>`. On hover:
  - Its ring shows: opacity 1, solid (`stroke-dasharray: none`), stroke-width 2.
  - Its shape (and only its shape) scales so its radius equals `HOVER_GROW = 0.85` × the largest hub radius in the layout (`Math.max(...layout.hubs.map(h => h.r))`; with no hubs, or a node already that big, it stays at its own r). (User change 2026-10-24: "a little smaller" than hub size.)
  - Its label slides outward by `growth = hubR - node.r` layout units, away from the node on the label's placed side: `l` → `translate(-growth, 0)`, `r` → `(growth, 0)`, `t` → `(0, -growth)`, `b` → `(0, growth)`.
  - Its ring scales to `(hubR + 6) / (node.r + 6)`.
  - Hubs get the ring but no growth.
- **Structure.** In `Node`, wrap `<Shape>` in `<g className="cn-shape">` and `<NodeLabel>` in an outer `<g className="cn-lab">`. The wrapper must sit outside NodeLabel's own `scale(1/scale)` `<g>`, because a CSS transform would override that SVG transform attribute. `NodeButton` sets these as inline CSS custom properties on its root `<g>`: `--grow-s` (shape scale), `--ring-s` (ring scale), `--lab-x` and `--lab-y` (px, layout units). Default every one to the identity (1 / 0) so hubs and nodes without growth are unaffected.
- **H2 grace.** In `Constellation`, a pointer leave doesn't clear hover straight away. It starts a `HOVER_GRACE_MS = 100` timer that clears it. Any pointer enter cancels the timer and sets the new id. Clear the timer on unmount. Focus/blur (`focusId`) is unchanged, with no grace.
- **H3 lit edges.** `Edge` gets a `lit` boolean prop → `data-lit` attribute (same pattern as `data-dim`). An edge is lit when the active node's connected set contains it.
- **H4 timing (CSS, inside the reduced-motion guard):**
  - `.cn-node, .cn-edge`: `transition: opacity 260ms ease, stroke-width 260ms ease`
  - `[data-dim]` and `.cn-edge[data-lit]`: `transition-duration: 180ms`
  - `.cn-shape, .cn-lab`, and the ring's transform: `transition: transform 280ms cubic-bezier(.34,1.25,.64,1)`
  - ring opacity: 180ms ease
  - At rest, a ring that is neither selected nor focus-visible sits at `scale(.85)`, so it grows outward when hovered.
- **State CSS (outside the guard):**
  - `.cn [data-dim]` opacity `.2` (was `.25`)
  - `.cn-edge[data-lit]` opacity 1
  - `.cn-edge-supports[data-lit]` stroke-width `2.25px`. Leave the dotted `previously_tested` and dashed `would_clarify` widths alone.
  - `.cn-node[data-hover] .cn-shape { transform: scale(var(--grow-s, 1)) }`
  - `.cn-node[data-hover] .cn-lab { transform: translate(var(--lab-x, 0), var(--lab-y, 0)) }`
  - `.cn-node[data-hover] .cn-ring { opacity: 1; stroke-dasharray: none; stroke-width: 2; transform: scale(var(--ring-s, 1)) }`
  - When not hovered, selected rings (dashed 2 4, width 1.5) and focus-visible rings look exactly as they do today, at full scale.
- **H5 drag.** In `NodeButton`, `onPointerEnter` calls `onHover` only when `e.pointerType === "mouse" && e.buttons === 0`.
- **H6.** The `.cn-reveal` load animation is unchanged.
- **Transform origin.** SVG CSS transforms use the element's local origin, which here is the node centre because `NodeButton` translates. Verify in a real browser that growth is centred, and set `transform-box`/`transform-origin` explicitly if it isn't.

**Tests:**

- Update "hover or focus dims every node and edge…": after `unhover`, dims clear only after the grace period. Use `vi.useFakeTimers()` with `vi.advanceTimersByTime(100)`, or `waitFor`.
- Add: hovered node has `data-hover`; edges touching it have `data-lit`; others don't.
- Add: unhover A then hover B within 100ms → at no point are all dims cleared, and B's connected set is the one shown.
- Add: a `pointerenter` with `buttons: 1` sets no hover.
- Add: a finding node's `NodeButton` carries `--grow-s` equal to `hubR / node.r` (e.g. 50 / 26) and the right `--lab-x`/`--lab-y` sign for its side. A hub carries `--grow-s: 1`.

---

## Task 2: Detail panel — header, type scale, why label, source block

**Files:** `components/detail/DetailPanel.tsx`, `components/detail/CitationLine.tsx`, `app/globals.css` (`.detail-panel` rules), `components/detail/__tests__/DetailPanel.test.tsx`.

**Layout of the condensed part, top to bottom:**

1. **Scroll padding:** 20px desktop (`p-5`), 16px in the narrow sheet.
2. **Title:** 19px, bold, leading 1.25, `pr-10` (clears the Close button). The meta line (date · specialty · Uncertain) sits on its own line under the title, mono 11.5px `--mut`, 4px top margin.
3. **Hub stats:** for hubs, replace the sentence "N supporting findings across M specialties" with two chips: `<b>N</b> finding(s)` and `<b>M</b> specialty/specialties` (singular when 1). Chip: mono 11.5px `--mut`, `1px solid var(--line)`, radius 4px, padding 2px 7px, background `#fffdf8`, number semibold `--ink`; flex-wrap, 6px gap, 8px top margin. Missing items keep their "Check existing records first" line as plain 13.5px `--mut` text.
4. **Record quote:** unchanged (serif 15px plus mono `record_id`), 12px top margin.
5. **Why block:** a block label above the text. Label: mono 10.5px, uppercase, letter-spacing .09em, `--mut`, margin 20px 0 6px. Text: 15px, line-height 1.55, `--ink`. Label copy: hubs "Something you might have missed", every other kind "Why it matters". Make this a shared `.detail-panel .hd` style (the current `.hd` is 10px with margin 9px 0 2px; update it, since Task 3 reuses it for section content).
6. **Source block** (label "Source", same `.hd` style), rendered by `CitationLine` with a new `variant="block"` (the default stays the current inline line until Task 3 switches the claim lists to `variant="short"`):
   - line 1: publisher, 12px `--mut`
   - line 2: one link to `href`: the title in semibold 13.5px `var(--eye)`, then ` › <location>` in regular weight `--ink`, then ` ↗`. No underline at rest; underline on hover. Without `href`, the same text as plain `--ink`.
   - line 3, flex-wrap, 6px gap, 8px top margin:
     - the ID as a tag linking to `idHref`: mono 11px `var(--eye)`, border `#c9d6ec`, background `#eef3fb`, radius 3px, padding 1px 6px, text `<idLabel> ↗`
     - then, when `unverified`, a badge: mono 10px semibold uppercase, letter-spacing .06em, `--sig`, border `#f0c4aa`, background `#fdf1ea`, radius 3px, padding 1px 6px, text "Unverified paraphrase"
   - Pending sources: publisher line, a "PMID pending" tag without a link, and a "Search PubMed ↗" link. A placeholder title is never shown (same rule as today).
   - **No border, background or left bar around the block.**
   - Keep `data-testid="citation"` on the block's root.
7. **Source quote** stays a `<details>` directly under the source block (8px top margin). Summary: 12.5px, regular weight, `--mut`, with the existing ▸/▾ marker. Body unchanged.

All links keep `target="_blank" rel="noopener noreferrer"`. The phone bottom sheet uses the same `Body`, so it gets all of this automatically. Check it at 390px.

**Tests:** update the tests whose asserted copy or structure changes (the hub count sentence → chips; "Why it matters" text on hubs → "Something you might have missed"). Add:

- the hub chips show 7 / 5 for the sample Fabry hub
- a finding panel still labels "Why it matters"
- the citation block puts the ID tag and the unverified badge in the block

Keep the ≤14-word test.

---

## Task 3: Detail panel — section rows, disease sections open, short citations, spec update

**Files:** `components/detail/DiseaseMore.tsx`, `components/detail/RecordMore.tsx`, `components/detail/CitationLine.tsx` (add `variant="short"`), `app/globals.css`, `components/detail/__tests__/DetailPanel.test.tsx`, `e2e/health-screen.spec.ts`, and the spec doc.

**Section rows:**
- A shared section style for these disclosures: `<details className="sx">`.
  - Full width, `border-top: 1px solid var(--line)`; the last one in a group also gets a `border-bottom`.
  - The summary is a 46px-min-height flex row, `justify-content: space-between`, 14px semibold `--ink`, with an optional count after the title in mono 11.5px regular `--mut` (6px left margin).
  - A chevron on the right drawn with CSS (8px box, 1.6px `--mut` right and bottom borders, rotated 45° closed and 225° open, 160ms transform transition inside the reduced-motion guard). Hide the native marker.
  - Body: padding-bottom 14px.
  - 18px of space above the first section row.
  - Keyboard: native `<details>`, so Enter/Space toggles.
- **Hub panel** (`DiseaseMore`): replace the single "More about this disease" disclosure with these rows, in order. Omit a row when its list is empty (same rule as today):
  1. **Supporting findings** (count), **open**. One row per finding: a 9px dot in the finding's system colour (`var(--${systemFor(finding)})`), then the label as the existing select button (13.5px, dotted underline in `--faint`, `onSelect(finding_id)`, min-height 40px tap target), then the specialty right-aligned in mono 11px `--mut`. Keep `data-testid="supporting-finding"`. No `max-height` scroll.
  2. **Missing evidence** (count), **open**, sorted by priority as today. Each item:
     - a `P<n>` tag (mono 10.5px semibold `--sig`, border `#f0c4aa`, radius 3px, padding 0 5px) and the description in 14px semibold
     - `why_it_matters` in 13.5px `--ink`
     - the possible outcomes as a list instead of a table: each `<li>` has a 2px `--line` left border, 10px left padding, the outcome in semibold 12.5px, then the implication in `--mut` on its own line
     - dashed `--line` separators between items
     - keep `data-testid="missing-item"`, and put `data-testid="outcome-row"` on each outcome `<li>`
  3. **Summary**, collapsed: `hypothesis.summary` in 13.5px `--ink`.
  4. **Supporting claims** (count), collapsed. Each claim: text in 13.5px, then `<CitationLine variant="short">`.
  5. **Contradicting claims** (count), collapsed, same format.
  6. **Questions for the clinician** (count), collapsed.
- **Finding/prior/missing panels** (`RecordMore`): "More about this record" becomes one `.sx` row, collapsed, with the same body as today. "Also in this record" keeps its select buttons.
- **`CitationLine variant="short"`**, one line in 11.5px `--mut`:
  - the publisher with any trailing parenthetical removed ("GeneReviews (NCBI Bookshelf)" → "GeneReviews")
  - ` · <location>` when present
  - ` · ` then the ID as a plain `var(--eye)` link (`<idLabel> ↗`, no tag box)
  - then, when unverified, the same badge as the block variant
  - pending sources: publisher · "PMID pending" · "Search PubMed ↗"

**Tests:**
- Update "disclosures are closed by default": on a hub, Supporting findings and Missing evidence are open and the rest closed; on a finding, every disclosure is closed.
- Update the "More about this disease …" tests to the new rows: 7 supporting findings, 3 outcome rows for GLA, missing evidence ordered by priority.
- Update e2e "disclosures show an open/closed marker and open from the keyboard": use the "Supporting claims" row; assert it starts without `open`, that Enter opens it, and that the chevron's computed transform changes.
- Update e2e "every citation link has a real href…": open the Supporting claims row instead of "More about this disease" before collecting links.
- Add: a short citation renders "GeneReviews · Clinical Description · NBK1292 ↗" for a GeneReviews claim.

**Spec doc:** edit `docs/superpowers/specs/2026-10-24-health-screen-constellation-design.md` §6 and §12 to say what "Spec amendments" 1–4 above say, in the spec's own terse style. Change nothing else in the spec.
