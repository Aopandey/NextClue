# Tech: `frontend/`

## Stack
- Next.js 16 (App Router) + React 19 + TypeScript, npm. Tailwind CSS v4 + shadcn/ui (radix-nova, neutral) — only `Sheet` and `Button`.
- `d3-zoom` + `d3-selection` for pan/zoom; system icons are custom SVG (not lucide).
- Vitest + @testing-library/react + jsdom (unit/component); Playwright (e2e). Dependency versions pinned exactly.
- Pure TS modules do the work (systems, citations, layout); SVG components draw; one `useAnalysis` hook owns fetching and run states. Scope: Sarah's 10-record view only (no clustering, no synthetic stress data).
- Data contract: `contracts/README.md`, `contracts/schema/*.json`, `backend/app/contracts.py`. Never modify `backend/`, `contracts/`, `supabase/`.

## Data modes (`NEXT_PUBLIC_DATA_MODE`)
- `fixture` (default): `GET /fixtures/analyses/{id}`.
- `live`: `POST /analyses`, then poll `GET /analyses/{run_id}`.
- `offline`: bundled JSON in `frontend/fixtures/`, no backend. Default for e2e and a backend-less Vercel deploy (unit tests may stub other modes).

## Env (`frontend/.env.example`)
- `NEXT_PUBLIC_API_URL` — default `http://127.0.0.1:8000`. Run the app at `http://localhost:3000` (backend CORS default).
- `NEXT_PUBLIC_DATA_MODE` — `fixture` | `live` | `offline`.

## Commands (run in `frontend/`)
- `npm run dev` · `npm run build` · `npm start`
- `npm test` (vitest run, once; excludes `e2e/**`) · `npm test -- <name>` for one file
- `npm run test:e2e` (Playwright; starts `npm run dev` in offline mode; projects `desktop` 1280×800, `phone` 390×844)
- `npm run typecheck` (`tsc --noEmit`) · `npm run lint`

## Folder map
- `app/` — `layout.tsx` (fonts, metadata), `globals.css` (tokens), `page.tsx` (→ `/patients/sarah-001`), `patients/[id]/page.tsx`
- `lib/contracts.ts` — contract types; `lib/api/` — `client.ts`, `useAnalysis.ts`
- `lib/constellation/` — `systems.ts`, `citations.ts`, `layout.ts` (pure, unit-tested)
- `components/constellation/` — `Constellation`, `ConstellationView`, `Hub`, `Node`, `Edge`, `CheckFirst`, `icons`, `useZoom`, `ZoomControls`, `constellation.css`
- `components/detail/` — `DetailPanel`, `RecordMore`, `DiseaseMore`, `CitationLine`
- `components/screen/` — `HealthScreen`, `PatientHeader`, `RunStatus`; `components/ui/` — shadcn `sheet`, `button`
- `fixtures/` — `sarah-001.run.json`, `sarah-001.patient.json`, `sources.json`
- `e2e/` — Playwright specs. Tests sit in `__tests__/` next to the code they cover.

## Workflow
- TDD: failing test first, then code. One commit per task: `feat(frontend): <task name>`. Stage files by name.
