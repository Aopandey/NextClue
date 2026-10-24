# NextClue frontend

The patient health screen: a constellation of one patient's findings, earlier tests and missing reports, around up to three open questions. Next.js 16 (App Router), React 19, TypeScript, Tailwind v4.

## Setup

```bash
cd frontend
npm install
cp .env.example .env.local   # then pick a data mode
npm run dev
```

Open <http://localhost:3000> (it redirects to `/patients/sarah-001`). Use `localhost`, not `127.0.0.1`: the backend's CORS default is `CORS_ORIGINS=http://localhost:3000`, so `127.0.0.1:3000` is blocked in `fixture` and `live` modes.

## Data modes

Set `NEXT_PUBLIC_DATA_MODE`:

| Mode | Source | Needs backend |
| --- | --- | --- |
| `fixture` (default) | `GET /fixtures/analyses/{id}` | yes |
| `live` | `POST /analyses`, then poll `GET /analyses/{run_id}` | yes |
| `offline` | bundled JSON in `frontend/fixtures/` | no |

Use `offline` when no backend is running, and for a backend-less Vercel deploy.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://127.0.0.1:8000` | Backend base URL |
| `NEXT_PUBLIC_DATA_MODE` | `fixture` | `fixture`, `live` or `offline` |

## Tests

| Command | What it runs |
| --- | --- |
| `npm test` | Vitest unit and component tests (offline mode, no backend) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run build` | Production build |
| `npm run test:e2e` | Playwright, headless, desktop (1280x800) and phone (390x844) projects |

The e2e run starts its own dev server in `offline` mode on port 3100 and never reuses another server, so a dev server you already have running on 3000 (for example in `fixture` mode) cannot affect it. First run: `npx playwright install chromium`.
