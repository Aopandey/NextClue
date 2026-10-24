# Health Screen (Constellation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **For kiro-cli:** Run this plan from the repo root on a branch cut from `origin/main`. Do the tasks in order, one commit per task. Task 1 writes the `.kiro/steering/` files, and every later task follows them. Read the spec and open the visual reference before Task 1.

**Goal:** Build NextClue's patient health screen in a new `frontend/` Next.js app. The screen is a zoomable "constellation" of a patient's AI-analysis findings around up to 3 open disease questions, with a cited, hyperlinked detail panel. It renders Daniel's real backend contract.

**Architecture:**
- **Pure TypeScript modules** do the work: body-system mapping, citations, deterministic layout, clustering and synthetic stress data. Each is unit-tested in isolation.
- **SVG React components** draw the layout.
- **One `useAnalysis` hook** owns data fetching and the backend run states (fixture / live polling / offline bundle).
- **The page** composes header, constellation, detail panel and run status.

**Tech Stack:**
- Next.js (App Router, latest) + TypeScript + Tailwind CSS v4 + shadcn/ui (Sheet, Button only)
- `d3-zoom` + `d3-selection` for pan/zoom
- `lucide-react` is not used for system icons (custom SVG)
- Vitest + @testing-library/react + jsdom for unit and component tests
- Playwright for e2e
- npm

**Spec:** `docs/superpowers/specs/2026-10-24-health-screen-constellation-design.md`
**Visual reference:** `docs/design/constellation/reference.html` (open it in a browser; it runs offline) and `docs/design/constellation/*.png`.
- **Which source governs what.** The reference governs the *look*: node shapes, icons, palette, type, the panel's structure, the zoom controls, and the 10 / 60 / 250 switch (a dev-only `?stress=` param in the app). This plan governs *positions and behaviour*: Task 5 geometry, thresholds and copy. Where they differ, follow the plan. The faint per-hub guide circles in the reference are optional decoration.
**Data contract:** `contracts/README.md`, `contracts/schema/*.json`, `backend/app/contracts.py` (on `main`).

## Global Constraints

- Frontend lives in `frontend/`. The backend is untouched.
- Backend base URL comes from `NEXT_PUBLIC_API_URL`, default `http://127.0.0.1:8000`. Run the frontend at `http://localhost:3000`, because backend CORS defaults to `CORS_ORIGINS=http://localhost:3000`.
- Data mode comes from `NEXT_PUBLIC_DATA_MODE`: `fixture` (default, `GET /fixtures/analyses/{id}`), `live` (`POST /analyses`, then poll `GET /analyses/{run_id}`), or `offline` (bundled JSON in `frontend/fixtures/`, no backend needed). Use offline for e2e and for a backend-less Vercel deploy.
- Never invent clinical content. Every label, quote and claim on screen comes from `AnalysisRun.output`, `PatientRecord.documents` or `Source`.
- Never invent a PMID. Never use the word "diagnosis" in UI copy (data text may contain it). Hypotheses read "open", never "likely" or a percentage.
- Source excerpts start with `"[Unverified paraphrase] "`: strip that prefix for display, and show the label "Unverified paraphrase" while `verification_status === "unverified"`.
- Visible words in the constellation region at rest: **≤ 70**.
- Hubs: at most **3**, only `status === "open"` hypotheses, ordered by number of supporting findings (descending), ties broken by array order.
- Cluster threshold: findings with a graph node, **> 16**, collapse into body-system clusters.
- Semantic zoom thresholds: scale **> 1.6** shows finding detail; scale **< 0.8** hides labels. Zoom extent **[0.5, 4]**.
- Transitions: at most 2 (one-time load reveal, hover dim), both under `@media (prefers-reduced-motion: no-preference)`.
- Fonts (`next/font/google`): Atkinson Hyperlegible Next (UI), Atkinson Hyperlegible Mono (IDs, dates), Source Serif 4 (hub names). Never use Inter, Lexend, Poppins, DM Sans, Space Grotesk or Plus Jakarta.
- No card grids, pills, drop shadows or decorative gradients. Light theme only.
- Colour tokens (CSS variables in `frontend/app/globals.css`, copied exactly):
  - surfaces and text: `--bg:#fbf8f2 --ink:#24211c --mut:#6f675b --faint:#a39a8b --line:#e7e0d3 --sig:#d4520c`
  - body systems: `--nerve:#6d4aa8 --sweat:#0d7c80 --gut:#a0700a --kidney:#a8385f --eye:#2c63b2 --family:#4b7b2c --blood:#5d6a7a --heart:#b23a3a --lung:#2f7894 --joint:#7a6a2a --other:#8a8378`
- Phone: at 390px there is no horizontal page scroll, every tap target is ≥ 40px, and the detail panel is a bottom sheet.
- Commit after every task with a message `feat(frontend): <task name>`.

## Review Focus

1. **Live AI output whose finding IDs are not in the fixture lookup** must still be coloured via keyword and specialty rules, falling back to `other`, and must never throw. Pinned in Task 3: `systemFor` with an unknown ID.
2. **A run with 0 open hypotheses, or `status:"failed"` with `output:null`** must show a calm centre message ("No open questions in this run" / the failed state) with no hubs and no crash. Pinned in Task 5 (`layoutConstellation` with no open hypotheses) and Task 9 (failed state render).
3. **A source with no `url`, no `pmid` and a non-placeholder title, or an `excerpt_id` missing from the source,** must produce a citation line with publisher and title as plain text, no link, and never the text "undefined". Pinned in Task 3.
4. **Very long finding labels or quotes** (200+ chars) are truncated on the canvas to 28 chars plus "…", appear in full in the panel, and keep 0 label overlaps. Pinned in Task 6.
5. **Backend unreachable** (network error in fixture or live mode) shows "Can't reach the backend at <url>" with Retry and a hint to set `NEXT_PUBLIC_DATA_MODE=offline`, not a blank screen. Pinned in Task 2.

---

### Task 1: Scaffold `frontend/`, design tokens, fonts, test tooling, Kiro steering

**Files:**
- Create: `frontend/` (Next.js app), `frontend/app/globals.css`, `frontend/app/layout.tsx`, `frontend/vitest.config.ts`, `frontend/vitest.setup.ts`, `frontend/playwright.config.ts`, `frontend/.env.example`
- Create: `.kiro/steering/product.md`, `.kiro/steering/tech.md`, `.kiro/steering/design.md`
- Copy: `docs/design/constellation/reference.html` stays as the visual reference (already committed)
- Test: `frontend/app/__tests__/tokens.test.ts`

**Interfaces:**
- Produces:
  - CSS variables from Global Constraints.
  - Font CSS variables `--font-ui`, `--font-mono`, `--font-serif` on `<html>`.
  - npm scripts `dev`, `build`, `start`, `test` (vitest run), `test:e2e` (playwright), `typecheck` (`tsc --noEmit`), `lint`.

- [ ] **Step 1: Scaffold.** `npx create-next-app@latest frontend --ts --tailwind --eslint --app --src-dir=false --import-alias "@/*" --use-npm --yes`, then `cd frontend && npx shadcn@latest init --yes --base-color neutral && npx shadcn@latest add sheet button --yes`, then `npm i d3-zoom d3-selection && npm i -D @types/d3-zoom @types/d3-selection vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test`.
- [ ] **Step 2: Write the failing test** `frontend/app/__tests__/tokens.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
const css = readFileSync("app/globals.css", "utf8");
describe("design tokens", () => {
  it.each([
    ["--bg", "#fbf8f2"], ["--ink", "#24211c"], ["--sig", "#d4520c"], ["--nerve", "#6d4aa8"],
    ["--sweat", "#0d7c80"], ["--gut", "#a0700a"], ["--kidney", "#a8385f"], ["--eye", "#2c63b2"],
    ["--family", "#4b7b2c"], ["--blood", "#5d6a7a"], ["--other", "#8a8378"],
  ])("%s is %s", (name, hex) => expect(css).toContain(`${name}:${hex}`));
  it("bans generic AI fonts", () => expect(css).not.toMatch(/Inter|Lexend|Poppins|DM Sans|Space Grotesk|Plus Jakarta/));
});
```

- [ ] **Step 3: Run** `npm test -- tokens`. Expected: FAIL (tokens missing).
- [ ] **Step 4: Implement.**
  - Add all tokens to `:root` in `globals.css`, written without spaces after the colon, set `body{background:var(--bg);color:var(--ink);font-family:var(--font-ui)}`, and remove the dark-mode block.
  - Load the three fonts in `layout.tsx` with `next/font/google` and the `variable` option.
  - Set `<html lang="en">` and the metadata title "NextClue".
  - `vitest.config.ts`: environment `jsdom`, setup file imports `@testing-library/jest-dom/vitest`, alias `@` to the project root.
  - `playwright.config.ts`: `webServer: { command: "npm run dev", url: "http://localhost:3000", env: { NEXT_PUBLIC_DATA_MODE: "offline" }, reuseExistingServer: true }`, projects `desktop` (1280×800) and `phone` (390×844).
  - `.env.example`: `NEXT_PUBLIC_API_URL=http://127.0.0.1:8000` and `NEXT_PUBLIC_DATA_MODE=fixture`.
- [ ] **Step 5: Write Kiro steering.** Each file is under 40 lines:
  - `product.md`: the story paragraph and Decisions 1–13 from the spec, condensed to one line each.
  - `tech.md`: the stack, data modes, env vars, commands and folder map from this plan.
  - `design.md`: the tokens, fonts, bans, text budget and motion rules from Global Constraints.
- [ ] **Step 6: Run** `npm test && npm run typecheck && npm run build`. Expected: all pass.
- [ ] **Step 7: Commit** `feat(frontend): scaffold app, tokens, fonts, test tooling, Kiro steering`.

### Task 2: Contract types, API client, offline fixtures, `useAnalysis`

**Files:**
- Create: `frontend/lib/contracts.ts`, `frontend/lib/api/client.ts`, `frontend/lib/api/useAnalysis.ts`
- Create: `frontend/fixtures/sarah-001.run.json`, `frontend/fixtures/sarah-001.patient.json`, `frontend/fixtures/sources.json`
- Test: `frontend/lib/api/__tests__/client.test.ts`, `frontend/lib/api/__tests__/useAnalysis.test.tsx`

**Interfaces:**
- Produces in `lib/contracts.ts`: hand-written TS types mirroring `backend/app/contracts.py` field-for-field. Keep the exact field names and Literal unions:
  - `Observation`, `PatientDocument`, `PatientRecord`
  - `RecordRef`, `SourceRef`
  - `Finding`, `Claim`, `PriorResultReview`, `Hypothesis`, `PossibleOutcome`, `MissingEvidence`, `ClinicianQuestion`
  - `AnalysisOutput`
  - `TimelineEvent`, `GraphNode`, `GraphEdge`, `ClueGraph`
  - `RunError`, `RunVersions`, `AnalysisRun`
  - `SourceExcerpt`, `Source`
- Produces in `lib/api/client.ts`:
  - `apiBase(): string`
  - `getPatient(id: string): Promise<PatientRecord>`
  - `getSource(id: string): Promise<Source>`
  - `getFixtureRun(id: string): Promise<AnalysisRun>`
  - `startAnalysis(patientId: string): Promise<AnalysisRun>`
  - `getRun(runId: string): Promise<AnalysisRun>`
  - `pollRun(runId: string, opts: { intervalMs?: number; timeoutMs?: number; onStatus?: (r: AnalysisRun) => void }): Promise<AnalysisRun>` (defaults 1500 / 120000)
  - `class ApiUnreachable extends Error { url: string }`
- Produces in `lib/api/useAnalysis.ts`:
  - `useAnalysis(patientId: string): { phase: "loading"|"queued"|"running"|"completed"|"failed"|"unreachable"; run: AnalysisRun|null; patient: PatientRecord|null; sources: Record<string, Source>; elapsedMs: number; error: string|null; retry: () => void }`
  - It loads the run per data mode, then the patient record, then every `source_id` referenced by `output.claims[].source_refs`.

- [ ] **Step 1: Create offline fixtures.**
  - With the backend running (`backend/README.md`), save `GET /fixtures/analyses/sarah-001` to `sarah-001.run.json` and `GET /patients/sarah-001` to `sarah-001.patient.json`.
  - Save `{ "<source_id>": Source }` for `src-genereviews-fabry` and `src-sfn-review` to `sources.json`.
  - If the backend is not available, build them from `backend/data/fixtures/sarah-001.analysis-output.json`, `backend/data/patients/sarah-001.json` and `backend/data/sources.json`, wrapping the output in an AnalysisRun envelope exactly as `backend/app/main.py:get_fixture_analysis` does. `timeline` and `graph` must match `backend/app/views.py`: 10 timeline events, 12 graph nodes, 13 edges.
- [ ] **Step 2: Write failing tests** `client.test.ts`:

```ts
it("pollRun returns when status leaves queued/running and reports each status", async () => { /* mock fetch: queued, running, completed */ expect(statuses).toEqual(["queued","running","completed"]); expect(final.status).toBe("completed"); });
it("pollRun rejects after timeoutMs", async () => { await expect(pollRun("run-1",{intervalMs:5,timeoutMs:20})).rejects.toThrow(/timed out/); });
it("network failure raises ApiUnreachable with the base url", async () => { fetchMock.mockRejectedValue(new TypeError("fetch failed")); await expect(getFixtureRun("sarah-001")).rejects.toMatchObject({ name:"ApiUnreachable", url:"http://127.0.0.1:8000" }); });
it("fixture JSON has 10 timeline events, 12 nodes, 13 edges, 2 open hypotheses", () => { expect(run.timeline).toHaveLength(10); expect(run.graph.nodes).toHaveLength(12); expect(run.graph.edges).toHaveLength(13); expect(run.output!.hypotheses.filter(h=>h.status==="open")).toHaveLength(2); });
```

  `useAnalysis.test.tsx`:
  - in offline mode → `phase` goes `loading` → `completed`, `run.provenance === "fixture"`, `Object.keys(sources)` equals `["src-genereviews-fabry","src-sfn-review"]`
  - in fixture mode with fetch rejecting → `phase === "unreachable"`, and `error` contains `"Can't reach the backend at http://127.0.0.1:8000"`
- [ ] **Step 3: Run** `npm test -- lib/api`. Expected: FAIL.
- [ ] **Step 4: Implement** the types, the client (`fetch` with JSON, non-2xx → `Error` with status and detail, network `TypeError` → `ApiUnreachable`) and the hook. In `live` mode:
  - `startAnalysis` returns 200 → done.
  - 202 → `pollRun`, setting `phase` from `onStatus`, with `elapsedMs` updated by a 250ms interval while `queued`/`running` that is cleared on settle and on unmount.
- [ ] **Step 5: Run** `npm test -- lib/api && npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(frontend): contract types, API client, offline fixtures, useAnalysis`.

### Task 3: Body systems, citations, short claims (pure)

**Files:**
- Create: `frontend/lib/constellation/systems.ts`, `frontend/lib/constellation/citations.ts`
- Test: `frontend/lib/constellation/__tests__/systems.test.ts`, `.../citations.test.ts`

**Interfaces:**
- Produces:
  - `type BodySystem = "nerve"|"sweat"|"gut"|"kidney"|"eye"|"family"|"blood"|"heart"|"lung"|"joint"|"other"`
  - `SYSTEM_ORDER: BodySystem[]` (that order)
  - `SYSTEM_LABEL: Record<BodySystem,string>`: Nerves, Skin, Gut, Kidney, Eye, Family, Blood, Heart, Lungs, Joints, Other
  - `systemFor(f: Finding): BodySystem`
  - `citationFor(source: Source|undefined, excerptId: string): Citation`, where `Citation = { text: string; href: string|null; idLabel: string|null; idHref: string|null; searchHref: string|null; unverified: boolean; quote: string|null; location: string|null }`
  - `shortClaim(text: string, maxWords = 14): string`
  - `stripUnverified(text: string): string`
- `systemFor` rules, first match wins:
  1. Exact ID map: `fnd-limb-pain`→nerve, `fnd-small-fiber-neuropathy`→nerve, `fnd-reduced-sweating`→sweat, `fnd-gi-symptoms`→gut, `fnd-celiac-negative`→gut, `fnd-proteinuria`→kidney, `fnd-father-dialysis`→family, `fnd-cornea-verticillata`→eye, `fnd-enzyme-normal`→blood, `fnd-diabetes-absent`→blood.
  2. `kind === "family_history"` → family.
  3. Case-insensitive keywords on `label`:
     - nerve: `neuropath|nerve|burning|numb|tingl|limb pain`
     - sweat: `sweat|skin|rash|angiokeratoma`
     - gut: `abdominal|diarrh|bowel|gut|celiac|nausea`
     - kidney: `protein|kidney|renal|uacr|creatinine|dialysis`
     - eye: `cornea|eye|vision|retina`
     - heart: `heart|cardi|palpitation|arrhythm`
     - lung: `lung|breath|pulmon`
     - joint: `joint|arthr`
     - blood: `enzyme|hba1c|blood|anemia|lab`
  4. `specialty`: neurology→nerve, dermatology→sweat, gastroenterology→gut, nephrology→kidney, ophthalmology→eye, cardiology→heart, pulmonology→lung, rheumatology→joint.
  5. Otherwise `other`.

- [ ] **Step 1: Write failing tests:**

```ts
it("maps every Sarah finding", () => expect(run.output!.findings.map(systemFor)).toEqual(["nerve","sweat","gut","gut","nerve","blood","blood","kidney","family","eye"]));
it("unknown live finding uses keywords then specialty then other", () => {
  expect(systemFor({ ...base, finding_id:"fnd-x", label:"Recurrent palpitations" })).toBe("heart");
  expect(systemFor({ ...base, finding_id:"fnd-y", label:"Fatigue", specialty:"nephrology" })).toBe("kidney");
  expect(systemFor({ ...base, finding_id:"fnd-z", label:"Fatigue", specialty:null })).toBe("other");
});
it("GeneReviews citation uses NBK id, no PMID", () => expect(citationFor(sources["src-genereviews-fabry"], "exc-fabry-female-enzyme")).toMatchObject({ text:"GeneReviews (NCBI Bookshelf) · Fabry Disease · Diagnosis", href:"https://www.ncbi.nlm.nih.gov/books/NBK1292/", idLabel:"NBK1292", idHref:"https://www.ncbi.nlm.nih.gov/books/NBK1292/", unverified:true }));
it("placeholder PubMed source says PMID pending and offers search", () => { const c = citationFor(sources["src-sfn-review"], "exc-sfn-causes"); expect(c.idLabel).toBe("PMID pending"); expect(c.idHref).toBeNull(); expect(c.searchHref).toMatch(/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\?term=/); });
it("real pmid links to PubMed", () => expect(citationFor({ ...srcBase, pmid:"12345678" }, "e1").idHref).toBe("https://pubmed.ncbi.nlm.nih.gov/12345678/"));
it("degrades without url, pmid or excerpt and never prints undefined", () => { const c = citationFor({ ...srcBase, url:"", pmid:null, title:"Some review" }, "missing"); expect(c.href).toBeNull(); expect(c.quote).toBeNull(); expect(JSON.stringify(c)).not.toContain("undefined"); });
it("citationFor(undefined) returns a 'Source unavailable' text", () => expect(citationFor(undefined,"e").text).toBe("Source unavailable"));
it("shortClaim cuts at ' because ' then 14 words", () => {
  expect(shortClaim("A normal enzyme result does not exclude Fabry disease in a woman, because heterozygous females can have enzyme activity in the normal range.")).toBe("A normal enzyme result does not exclude Fabry disease in a woman.");
  expect(shortClaim("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen")).toBe("one two three four five six seven eight nine ten eleven twelve thirteen fourteen…");
});
it("strips the unverified prefix", () => expect(stripUnverified("[Unverified paraphrase] In females…")).toBe("In females…"));
```

- [ ] **Step 2: Run** `npm test -- constellation/__tests__/systems constellation/__tests__/citations`. Expected: FAIL.
- [ ] **Step 3: Implement.** Citation details:
  - `text` = `publisher · title · location` (skip empty parts).
  - The NBK id comes from `/\/books\/(NBK\d+)\//` on the url.
  - A placeholder is a title starting with `PLACEHOLDER`. Its search term is the title after `PLACEHOLDER:`, with "(to be selected and verified)" removed and URL-encoded.
  - `unverified` = `verification_status === "unverified"`.
- [ ] **Step 4: Run** the same tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): body systems, citations, short claims`.

### Task 4: Deterministic synthetic stress records

**Files:**
- Create: `frontend/lib/constellation/synthetic.ts`
- Test: `frontend/lib/constellation/__tests__/synthetic.test.ts`

**Interfaces:**
- Produces: `makeSyntheticRun(n: 60 | 250, seed = 7): { run: AnalysisRun; patient: PatientRecord; sources: Record<string, Source> }`.
  - Uses mulberry32 seeded RNG.
  - `run.provenance = "fixture"`, `run.run_id = "synthetic-" + n`, `patient.patient_id = "synthetic-" + n`, `patient.demographics.display_name = "Synthetic stress test"`.
  - Every label is generic and system-named, e.g. "Nerve finding 12", "Kidney finding 3". There are no disease claims beyond hypothesis names "Condition A", "Condition B", "Condition C" (and "Condition D" at 250).
  - Every source has `pmid: null`, `url: ""` and `verification_status: "unverified"`.
  - The graph is built like `backend/app/views.py:build_graph`, so every hypothesis-supporting finding has a node.

- [ ] **Step 1: Write failing tests.**

```ts
it.each([[60,60,3],[250,250,4]])("n=%i → %i findings, %i open hypotheses", (n, f, h) => { const { run } = makeSyntheticRun(n as 60|250); expect(run.output!.findings).toHaveLength(f); expect(run.output!.hypotheses.filter(x=>x.status==="open")).toHaveLength(h); });
it("is deterministic", () => expect(JSON.stringify(makeSyntheticRun(60))).toBe(JSON.stringify(makeSyntheticRun(60))));
it("covers at least 8 body systems", () => expect(new Set(makeSyntheticRun(60).run.output!.findings.map(systemFor)).size).toBeGreaterThanOrEqual(8));
it("has 5 missing items at 250", () => expect(makeSyntheticRun(250).run.output!.missing_evidence).toHaveLength(5));
it("never contains a PMID or a real disease name", () => { const s = JSON.stringify(makeSyntheticRun(250)); expect(s).not.toMatch(/"pmid":"\d|Fabry/); });
it("all record_refs excerpts appear verbatim in their document text", () => { /* same rule as backend validation */ });
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): deterministic synthetic stress records`.

### Task 5: Layout and clustering (pure)

**Files:**
- Create: `frontend/lib/constellation/layout.ts`
- Test: `frontend/lib/constellation/__tests__/layout.test.ts`

**Interfaces:**
- Consumes: `systemFor`, `SYSTEM_ORDER` (Task 3); `makeSyntheticRun` (Task 4, tests only).
- Produces:

```ts
export const VIEW = { w: 1200, h: 760 } as const;
export type HubPos = { id: string; name: string; x: number; y: number; r: 50; supportCount: number };
export type NodeKind = "finding" | "negative" | "prior" | "missing" | "missingMore" | "cluster";
export type NodePos = { id: string; kind: NodeKind; system: BodySystem; x: number; y: number; r: number; label: string; year: string | null; count?: number; memberIds?: string[] };
export type EdgePos = { id: string; from: string; to: string; relation: "supports" | "previously_tested" | "would_clarify"; width: number; d: string };
export type Layout = { hubs: HubPos[]; nodes: NodePos[]; edges: EdgePos[]; clustered: boolean; extraHypotheses: number; emptyMessage: string | null };
export function layoutConstellation(run: AnalysisRun, opts?: { expandCluster?: BodySystem | null; yearRange?: [number, number] | null; linkedOnly?: boolean }): Layout;
```

- **Fixed geometry**, in VIEW coordinates (the SVG scales to its container):
  - Hub positions by count:
    - 1 hub: (600,380)
    - 2 hubs: (480,380) and (720,380)
    - 3 hubs: (600,300), (490,470) and (710,470)
  - Ring: ellipse centred at (600,380) with rx 400, ry 285.
  - Findings, negatives and clusters go on the ring at angles evenly spaced across the arcs 35°→145° and 215°→325°, measured clockwise from 3 o'clock. Order them by `SYSTEM_ORDER`, then date.
  - Prior results: x = 120, with y values evenly spaced around 380 at 90px apart.
  - Missing items: an item whose `hypothesis_ids` include **2 or more hubs** sits at the centroid of those hubs. For Sarah, `mis-gla-report` sits at (600,380), between Fabry and Separate common conditions, as in the reference. Every other missing item goes in a right column at x = 1080, ordered by priority, 90px apart. If there are more than 3 missing items in total, show the first 2 by priority plus one `missingMore` node whose `count` is the rest.
  - Node r: finding 26, negative 14, prior 26, missing 26, cluster `22 + 4*sqrt(count)`.
  - Edge `d`: a cubic Bézier whose control points are pulled 35% toward the hub.
  - Edge width: 1.5. For a bundled cluster→hub edge, use `1.5 + 0.6*supportingCount`, capped at 10.
- **Rules:**
  - A "negative" is a finding with `assertion === "absent"` and no graph node (Sarah: `fnd-celiac-negative`, `fnd-diabetes-absent`); it has no edges.
  - `fnd-enzyme-normal` has no graph node and is not drawn separately. It is represented by the prior node.
  - Clustering happens when graph findings exceed 16. With `expandCluster` set, that cluster's members are placed on a sub-ring of radius 120 around the cluster's position, and the other clusters stay.
  - `yearRange` and `linkedOnly` filter findings before clustering.
  - With no open hypotheses, `hubs = []` and `emptyMessage = "No open questions in this run"`.
  - With `run.output === null`, the layout is empty and `emptyMessage = null`; the page shows the run state.

- [ ] **Step 1: Write failing tests:**

```ts
const sarah = layoutConstellation(fixtureRun);
it("Sarah: 2 hubs side by side, Fabry first", () => { expect(sarah.hubs.map(h=>[h.id,h.x,h.y])).toEqual([["hyp-fabry",480,380],["hyp-separate-conditions",720,380]]); });
it("Sarah: GLA report sits between the two hubs it would clarify; father's diagnosis in the right column", () => { const m = (id:string)=>sarah.nodes.find(n=>n.id===id)!; expect([m("mis-gla-report").x, m("mis-gla-report").y]).toEqual([600,380]); expect(m("mis-father-diagnosis").x).toBe(1080); });
it("Sarah: 7 findings, 2 negatives, 1 prior, 2 missing, not clustered", () => { const k = (t:string)=>sarah.nodes.filter(n=>n.kind===t).length; expect([k("finding"),k("negative"),k("prior"),k("missing"),sarah.clustered]).toEqual([7,2,1,2,false]); });
it("Sarah: 13 graph edges kept with their relations", () => expect(sarah.edges.map(e=>e.relation).sort()).toEqual([...Array(9).fill("supports"),"previously_tested",...Array(3).fill("would_clarify")].sort()));
it("no two nodes overlap (gap ≥ 8px) for Sarah, 60 expanded and 250", () => { for (const L of [sarah, layoutConstellation(s60, { expandCluster: "nerve" }), layoutConstellation(s250)]) expect(minGap(L)).toBeGreaterThanOrEqual(8); });
it("60: clustered, 3 hubs in a triangle", () => { const L = layoutConstellation(s60); expect(L.clustered).toBe(true); expect(L.hubs.map(h=>[h.x,h.y])).toEqual([[600,300],[490,470],[710,470]]); });
it("250: 4 open hypotheses → 3 hubs + extraHypotheses 1; missing collapses to 2 + more(3)", () => { const L = layoutConstellation(s250); expect(L.hubs).toHaveLength(3); expect(L.extraHypotheses).toBe(1); expect(L.nodes.find(n=>n.kind==="missingMore")?.count).toBe(3); });
it("cluster counts sum to graph findings and edge width grows with support", () => { const L = layoutConstellation(s60); expect(L.nodes.filter(n=>n.kind==="cluster").reduce((a,n)=>a+(n.count??0),0)).toBe(graphFindingCount(s60)); });
it("no open hypotheses → empty message", () => expect(layoutConstellation(withAllExcluded(fixtureRun)).emptyMessage).toBe("No open questions in this run"));
it("failed run → empty layout, no throw", () => expect(layoutConstellation({ ...fixtureRun, status:"failed", output:null }).nodes).toEqual([]));
it("is deterministic", () => expect(layoutConstellation(fixtureRun)).toEqual(layoutConstellation(fixtureRun)));
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): deterministic constellation layout and clustering`.

### Task 6: Constellation SVG

**Files:**
- Create: `frontend/components/constellation/Constellation.tsx`, `.../icons.tsx`, `.../Hub.tsx`, `.../Node.tsx`, `.../Edge.tsx`, `.../CheckFirst.tsx`, `.../constellation.css`
- Test: `frontend/components/constellation/__tests__/Constellation.test.tsx`

**Interfaces:**
- Consumes: `Layout` and `layoutConstellation` (Task 5); `SYSTEM_LABEL` (Task 3).
- Produces: `<Constellation run={AnalysisRun} layout={Layout} selectedId={string|null} onSelect={(id: string) => void} zoomScale={number} />`. It renders `<svg viewBox="0 0 1200 760" role="img" aria-label="Clue constellation">`. Every node is a `<g role="button" tabIndex={0} data-node-id={id} aria-label={label}>`, and Enter or Space calls `onSelect`. Hubs are nodes too: `data-node-id={hypothesis_id}` and `data-testid="hub"`. Edges carry `data-edge-id`. Text labels carry `data-label`.
- Produces: `truncate(label: string, max = 28): string`.
- Visuals, matching `docs/design/constellation/reference.html`:
  - **Hubs:** a circle with a 2px ink stroke on `--bg`, the name in Source Serif 4 at 20px across up to 2 lines, and under it "open · N findings" in mono 11px.
  - **Findings:** a filled `var(--<system>)` circle with a white system icon (icons ported from the reference). The label goes outside the ring (bold 13px) with the year in mono 11px.
  - **Negatives:** a hollow 14px ring in the system colour, labelled "No …" from the finding label.
  - **Prior:** a half-filled `--blood` circle with a test-tube icon. The label "<year> test · normal" sits above "not conclusive" in `--sig`.
  - **Missing:** a dashed `--sig` circle with a document or ? icon, labelled with the description's first 3 words, plus "missing?".
  - **Cluster:** a circle in the system colour, sized by count, with the count number centred in white 15px bold and the system name below.
  - **CheckFirst:** fixed top-right in the SVG. A dashed `--sig` rectangle holds the mono "CHECK FIRST" over `<description first 3 words> · may already exist` when `check_existing_first` is true.
- **Zoom-dependent labels:** at `zoomScale > 1.6` add a detail line (specialty · first 8 words of the first record_ref excerpt in quotes). At `< 0.8` hide all text except hub names.
- **Hover/focus dim:** hovering or focusing a node sets every node and edge not connected to it to opacity .25 (transition 150ms, under the reduced-motion guard).
- **Load reveal:** nodes fade and scale from .85 to 1, staggered 40ms in ring order, one time only, under the reduced-motion guard.

- [ ] **Step 1: Write failing tests:**

```ts
it("renders 2 hubs, 12 graph nodes + 2 negatives, 13 edges for Sarah", () => { render(<Constellation run={fixtureRun} layout={layoutConstellation(fixtureRun)} selectedId={null} onSelect={vi.fn()} zoomScale={1}/>); expect(screen.getAllByTestId("hub")).toHaveLength(2); expect(document.querySelectorAll("[data-node-id]")).toHaveLength(14); expect(document.querySelectorAll("[data-edge-id]")).toHaveLength(13); });
it("Enter on a node calls onSelect with its id", async () => { /* focus fnd-proteinuria, press Enter */ expect(onSelect).toHaveBeenCalledWith("fnd-proteinuria"); });
it("shows CHECK FIRST for mis-gla-report", () => expect(screen.getByText("CHECK FIRST")).toBeInTheDocument());
it("at rest shows ≤ 70 words", () => expect(visibleWords(container)).toBeLessThanOrEqual(70));
it("zoom > 1.6 adds quote snippets; zoom < 0.8 hides finding labels", () => { /* rerender with 2 and 0.6 */ });
it("truncates long labels to 28 chars + …", () => expect(truncate("x".repeat(200))).toBe("x".repeat(28) + "…"));
it("never renders the word diagnosis outside data-quote text", () => expect(container.textContent).not.toMatch(/diagnosis/i));
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement** by porting shapes and icons from the reference. **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): constellation SVG`.

### Task 7: Detail panel (condensed, cited, expandable)

**Files:**
- Create: `frontend/components/detail/DetailPanel.tsx`, `.../RecordMore.tsx`, `.../DiseaseMore.tsx`, `.../CitationLine.tsx`
- Test: `frontend/components/detail/__tests__/DetailPanel.test.tsx`

**Interfaces:**
- Consumes: `citationFor`, `shortClaim`, `stripUnverified` (Task 3); contract types (Task 2).
- Produces: `<DetailPanel run={AnalysisRun} patient={PatientRecord} sources={Record<string,Source>} nodeId={string} onClose={() => void} onSelect={(id: string) => void} />`.
- **Resolution rules:**
  - **Finding:** use its first `record_refs` entry as the quote. The linking claim is the first claim whose `record_refs` share that `record_id`, preferring claims in an open hypothesis's `supporting_claim_ids`.
  - **Prior:** use `record_refs[0]`. "Why" = `what_it_established`. The citation comes from the first `limitation_claim_ids` claim's `source_refs[0]`.
  - **Missing:** "Why" = `why_it_matters`. The quote is `existing_record_refs[0]` when present.
  - **Hub:** line 2 = the count of supporting findings and their distinct specialties, computed. "Why" = the first sentence of `summary`.
  - **Negative:** the quote plus the label. No citation line when no claim links it; the line is omitted, not shown empty.
- **Condensed body:** exactly 4 lines at most.
  1. **Bold label**, then `date · specialty` in mono. Date format: "19 Apr 2023".
  2. `“<excerpt>” rec-id`.
  3. `Why it matters: <shortClaim>`.
  4. `<CitationLine>` with these links:
     - `text` links to `href` when non-null.
     - The ID link uses `idLabel`/`idHref`.
     - "Search PubMed ↗" appears when `searchHref` is set.
     - "Unverified paraphrase" shows as a small `--sig` label.
     - All links use `target="_blank" rel="noopener noreferrer"`, are underlined, and carry a ↗ suffix.
- **Disclosures** (`<details>`, all closed by default):
  - **"Source quote":** the stripped quote with its `location`.
  - **"More about this record":**
    - The full document `text`, with the excerpt wrapped in `<mark>`.
    - `title · author_role · date · specialty · record_id`.
    - Observations as a table with the columns Name, Value, Reference and Interpretation.
    - "Also in this record": buttons for the other findings with the same record_id, each calling `onSelect`.
  - **"More about this disease"** (hubs only):
    - `summary`.
    - Supporting findings as buttons.
    - Supporting and contradicting claims, each with its CitationLine.
    - Missing evidence linked to this hypothesis: `description`, `why_it_matters`, and a 3-column outcomes table (Outcome · What it would mean).
    - The `clinician_questions` whose `missing_ids` intersect those missing items.
- Desktop: a right-side panel 380px wide with a hairline left border. Phone (<640px): a shadcn `Sheet` with `side="bottom"`. Esc and × close it.

- [ ] **Step 1: Write failing tests:**

```ts
it("finding panel: 4 lines with verbatim quote and NBK citation link", () => { renderPanel("fnd-cornea-verticillata"); expect(screen.getByText(/“bilateral whorl-like corneal opacities \(cornea verticillata\)”/)).toBeInTheDocument(); expect(screen.getByRole("link", { name: /NBK1292/ })).toHaveAttribute("href", "https://www.ncbi.nlm.nih.gov/books/NBK1292/"); expect(screen.getByText("Unverified paraphrase")).toBeInTheDocument(); expect(lines(panel)).toBeLessThanOrEqual(4); });
it("prior panel shows what_it_established and PMID-free citation", () => { renderPanel("pri-enzyme-2016"); expect(screen.getByText(/Enzyme activity was not low/)).toBeInTheDocument(); expect(screen.queryByText(/PMID \d/)).toBeNull(); });
it("placeholder source shows PMID pending + Search PubMed", () => { renderPanel("hyp-separate-conditions"); openDetails("More about this disease"); expect(screen.getAllByText("PMID pending").length).toBeGreaterThan(0); expect(screen.getAllByRole("link", { name: /Search PubMed/ })[0]).toHaveAttribute("href", expect.stringMatching(/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\?term=/)); });
it("More about this record shows full text with the excerpt marked and the observations table", () => { renderPanel("fnd-proteinuria"); openDetails("More about this record"); expect(document.querySelector("mark")?.textContent).toBe("Urine albumin-to-creatinine ratio 410 mg/g"); expect(screen.getByRole("table")).toBeInTheDocument(); });
it("More about this disease lists 7 supporting findings and 3 possible outcomes for GLA", () => { renderPanel("hyp-fabry"); openDetails("More about this disease"); expect(screen.getAllByTestId("supporting-finding")).toHaveLength(7); expect(screen.getAllByTestId("outcome-row").length).toBeGreaterThanOrEqual(3); });
it("every link opens safely", () => screen.getAllByRole("link").forEach(a => { expect(a).toHaveAttribute("target","_blank"); expect(a).toHaveAttribute("rel","noopener noreferrer"); }));
it("Escape closes", async () => { await user.keyboard("{Escape}"); expect(onClose).toHaveBeenCalled(); });
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): condensed, cited, expandable detail panel`.

### Task 8: Zoom, semantic zoom, cluster fan-out, filters

**Files:**
- Create: `frontend/components/constellation/useZoom.ts`, `.../ZoomControls.tsx`, `.../ScaleFilters.tsx`
- Modify: `frontend/components/constellation/Constellation.tsx` (wrap content in `<g data-zoom-layer transform=…>`)
- Test: `frontend/components/constellation/__tests__/zoom.test.tsx`

**Interfaces:**
- Produces:
  - `useZoom(svgRef: RefObject<SVGSVGElement>): { scale: number; zoomIn(): void; zoomOut(): void; fit(): void; zoomTo(x: number, y: number, k?: number): void }`. It wraps `d3-zoom` with `scaleExtent([0.5, 4])`. Buttons step ×1.4 with a 200ms ease (none under reduced motion). `fit()` resets to the identity transform. Double-click on a node calls `zoomTo(node.x, node.y, 2)`.
  - `<ZoomControls>`: three 40px buttons labelled "Zoom in", "Zoom out" and "Fit", at the bottom right.
  - `<ScaleFilters>`: shown only when the graph has ≥ 60 findings. It has two year `<select>`s (min to max year) and a checkbox "Only linked to open questions". These feed `layoutConstellation({ yearRange, linkedOnly })`.
  - Cluster click sets `expandCluster`. A "Back" button appears at the top left while one is expanded. Non-member nodes dim to .25.

- [ ] **Step 1: Write failing tests:**

```ts
it("zoom in/out/fit change scale within [0.5,4]", async () => { await click("Zoom in"); expect(scale()).toBeCloseTo(1.4); for (let i=0;i<10;i++) await click("Zoom in"); expect(scale()).toBe(4); await click("Fit"); expect(scale()).toBe(1); });
it("scale > 1.6 shows quote snippets", async () => { await click("Zoom in"); await click("Zoom in"); expect(screen.getAllByTestId("finding-detail").length).toBe(7); });
it("60 records: clicking the nerve cluster fans out its members and shows Back", async () => { renderPage({ stress: 60 }); await user.click(cluster("nerve")); expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument(); expect(fannedMembers()).toBe(clusterCount("nerve")); });
it("250 records shows year filter and linked-only toggle; Sarah does not", () => { /* query both */ });
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): zoom, semantic zoom, clusters, filters`.

### Task 9: Health screen page, run states, phone layout

**Files:**
- Create: `frontend/app/patients/[id]/page.tsx`, `frontend/components/screen/HealthScreen.tsx`, `.../PatientHeader.tsx`, `.../RunStatus.tsx`
- Modify: `frontend/app/page.tsx` (redirect to `/patients/sarah-001`)
- Test: `frontend/components/screen/__tests__/HealthScreen.test.tsx`

**Interfaces:**
- Consumes: `useAnalysis` (Task 2); `layoutConstellation` (Task 5); `Constellation`, `useZoom`, `ZoomControls`, `ScaleFilters` (Tasks 6, 8); `DetailPanel` (Task 7); `makeSyntheticRun` (Task 4).
- Produces: `<HealthScreen patientId={string} stress={60|250|null} />`. The page reads `params.id` and `searchParams.stress`, and accepts `stress` only when `process.env.NODE_ENV !== "production"` or `NEXT_PUBLIC_ALLOW_STRESS === "1"`.
- **PatientHeader:** one line, `<Name> · <age = 2026 − birth_year> · <F|M> · <n> records <firstYear>–<lastYear>`, plus a provenance tag:
  - fixture: "Sample data · not AI output"
  - live: "Live analysis · <versions.model>"
  - replayed: "Replayed run"
  - stress mode: "Synthetic stress test, not backend data"
  
  Add "Evidence: cached" when `evidence_mode === "cached"`. When `extraHypotheses > 0`, show the text button "+N more open questions", which opens the panel listing them.
- **RunStatus** (by phase):
  - `loading`: "Loading analysis…"
  - `queued` / `running`: "Analysing <id> · <mm:ss>" with a 2px `--sig` hairline progress that is indeterminate, not a percentage
  - `failed`: `error.message` and `error.code`, with a "Retry" button when `error.retryable`; no constellation drawn
  - `replayed`: a notice showing `fallback_reason`, with a "Retry live" button that calls `retry`
  - `unreachable`: "Can't reach the backend at <url>", with a Retry button and the hint "Set NEXT_PUBLIC_DATA_MODE=offline to use the bundled sample."
- **Footer:** `run.disclaimer`, plus the line "The clinician decides; nothing here is confirmed."

- [ ] **Step 1: Write failing tests** (mock `useAnalysis`):

```ts
it.each([
  ["loading", "Loading analysis…"], ["running", /Analysing sarah-001 · 00:0/],
  ["unreachable", "Can't reach the backend at http://127.0.0.1:8000"],
])("phase %s shows %s", (phase, text) => { mockPhase(phase); render(<HealthScreen patientId="sarah-001" stress={null}/>); expect(screen.getByText(text)).toBeInTheDocument(); });
it("failed: shows error and Retry, draws no nodes", () => { mockFailed({ code:"timeout", message:"Model did not respond within 60 s.", retryable:true }); expect(screen.getByText(/Model did not respond/)).toBeInTheDocument(); expect(screen.getByRole("button",{name:"Retry"})).toBeInTheDocument(); expect(document.querySelectorAll("[data-node-id]")).toHaveLength(0); });
it("replayed: shows fallback reason and Retry live", () => { /* … */ });
it("fixture: header shows 'Sarah · 40 · F · 10 records 2012–2024' and 'Sample data · not AI output'", () => { /* … */ });
it("clicking a node opens the panel; Escape closes it", async () => { /* … */ });
it("stress=60 shows the synthetic label and 3 hubs", () => { /* … */ });
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): health screen page and run states`.

### Task 10: End-to-end checks and README

**Files:**
- Create: `frontend/e2e/health-screen.spec.ts`, `frontend/README.md`
- Modify: `README.md` (root): add a "Run the frontend" section

**Interfaces:**
- Consumes: the running app in offline mode (`playwright.config.ts` from Task 1).

- [ ] **Step 1: Write the e2e spec.** It runs in both the desktop and phone projects:

```ts
test("demo path", async ({ page }) => {
  await page.goto("/patients/sarah-001");
  await page.getByRole("button", { name: /Small fiber neuropathy/ }).click();            // a finding
  await expect(page.getByText(/reduced intraepidermal nerve fiber density/)).toBeVisible();
  await page.getByRole("button", { name: /alpha-Gal A enzyme screen/ }).click();         // old normal test
  await expect(page.getByText(/Enzyme activity was not low/)).toBeVisible();
  await page.getByRole("button", { name: /GLA gene molecular testing report/ }).click(); // missing report
  await expect(page.getByText(/Molecular testing identifies heterozygous females/)).toBeVisible();
  await expect(page.getByText(/no report from that visit is in our chart/)).toBeVisible();     // existing_record_refs quote
});
test("no horizontal overflow and no page errors", async ({ page }) => { /* scrollWidth - clientWidth === 0; collect pageerror === [] */ });
test("no label overlaps at default zoom", async ({ page }) => { /* bounding boxes of all [data-label] pairwise non-intersecting */ });
test("visible words in the constellation ≤ 70", async ({ page }) => { /* count words in svg text at rest */ });
test("tap targets ≥ 40px on phone", async ({ page }, info) => { test.skip(info.project.name !== "phone"); /* all [role=button] boxes ≥ 40×40 */ });
test("stress 250: clusters, filters, 3 hubs", async ({ page }) => { await page.goto("/patients/synthetic-250?stress=250"); /* … */ });
test("every citation link has a real href; no fake PMID", async ({ page }) => { /* open hyp-fabry → More about this disease; all a[href] start with https://; no /pubmed\.ncbi\.nlm\.nih\.gov\/\d+/ for null-pmid sources */ });
```

- [ ] **Step 2: Run** `npm run test:e2e`. Expected: PASS for both projects. Fix layout issues in the owning component (Tasks 5–9), not in the test.
- [ ] **Step 3: Write `frontend/README.md`** covering setup, the 3 data modes, env vars and `localhost:3000` (not `127.0.0.1:3000`, because of CORS), plus the test commands. Add a 6-line "Run the frontend" section to the root README.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build && npm run test:e2e`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(frontend): e2e checks and README`.
