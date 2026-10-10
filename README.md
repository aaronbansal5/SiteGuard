# SiteGuard AdaptiveBreak

Contactless recovery visibility and safety-conscious break planning for physically demanding worksites.

A persistent worker/supervisor demo: voluntary check-ins → descriptive pulse/breathing trends → symptom/rest requests → protected staffing coordination. All seeded measurements and history are clearly synthetic. The application consumes a separately implemented native Presage bridge; it does not include the SDK itself.

## Run locally

Requires Node 24.7+ and npm. No Docker or external credentials required.

```bash
npm ci
npm run db:migrate
npm run demo:reset
npm run dev
```

Open http://127.0.0.1:5173 . Select Worker W-01, begin a voluntary check-in, wait 60 seconds, finish, and request additional rest. Open safety operations in a second browser context; approve rest and preview/commit coverage. Protected breaks cannot move or shrink. Demo identity selection is not production authentication.

Production-style local run:

```bash
npm run build
npm run start
npm run smoke
```

Open http://127.0.0.1:3001 . SQLite persists in `.data/siteguard.sqlite`. Stop the API before CLI reset; reset refuses real data and active sessions. The supervisor's local reset control recreates today's fictional schedule if the demo break has expired.

## Verify

```bash
npm run typecheck
npm run test
npx playwright install chromium
npm run test:e2e
npm run build
npm run test:production
```

Playwright starts isolated dev servers and `.data/e2e.sqlite`; keep ports 3001/5173 free. Its full demo test waits for 60 real-time mock observations; it does not accelerate time or inject synthetic readings into a real source.

## Optional integrations

Copy `.env.example` to `.env` and configure only the required adapters. Secrets stay server-side.

- PostgreSQL/Tiger Data: `DATABASE_URL`; run `npm run db:migrate:postgres`. Explicit Timescale enable command checks extension presence. No automatic fallback on connection failure.
- Gemini: `GEMINI_API_KEY` and an account-verified `GEMINI_MODEL`. Selects server-approved factual sentences, with deterministic fallback. No schedule/medical decisions.
- Presage: separately supplied native bridge plus `PRESAGE_BRIDGE_TOKEN`. Local app only. Source remains fixed within each session.

## Phones

- Phone web layout: open `/mobile` for reminder-driven voluntary check-ins (60-second demo interval, consent every time, synthetic readings because browsers cannot run the Presage SDK). To try it from a phone on a trusted Wi-Fi network: `HOST=0.0.0.0 npm run dev`, then `http://<laptop-ip>:5173/mobile`.
- Native iOS scaffold using the SmartSpectra Swift SDK: `apps/mobile-ios` (unbuilt here; no upload yet). Design and proposed phone ingestion contract: [docs/MOBILE_APP.md](docs/MOBILE_APP.md).

Real Presage hardware, live Gemini, Tiger Data, and hosted deployment require separate verification; fixture tests are not sponsor-integration evidence.

## Handoff documents

- [Product](docs/PROJECT_SPEC.md), [API](docs/API_CONTRACT.md), [bridge](docs/PRESAGE_CONTRACT.md)
- [Setup](docs/SETUP.md), [demo](docs/DEMO.md), [deployment](docs/DEPLOYMENT.md), [runbook](docs/RUNBOOK.md)
- [Agent ownership](AGENTS.md), [readiness assessment](docs/PRODUCTION_READINESS.md)

No diagnosis, risk score, medical clearance, or medically optimal rest claim. Data sufficiency rules and fictional break fixtures are not medical or legal guidance. SiteGuard does not store camera footage or identify faces.
