# SiteGuard AdaptiveBreak

**People first. Every shift.**

SiteGuard connects proactive worker check-ins with rapid human response for physically demanding worksites. Workers can complete a voluntary, contactless camera check-in, understand their pulse and breathing trends in context, and request rest or assistance. Safety teams receive the information they need to respond while protected breaks stay protected.

## Watch the demo

[![Watch the SiteGuard AdaptiveBreak demo](https://img.youtube.com/vi/CzoFM4OR6TA/maxresdefault.jpg)](https://www.youtube.com/watch?v=CzoFM4OR6TA)

**[Watch SiteGuard on YouTube →](https://www.youtube.com/watch?v=CzoFM4OR6TA)**

## Our mission

Workplace safety should adapt around people—not force people to adapt around rigid schedules. Our mission is to give workers a simple way to speak up before fatigue becomes an incident and give safety teams clear, privacy-conscious context for timely human decisions.

SiteGuard creates two connected safety loops:

1. **Proactive check-ins:** Presage camera observations capture pulse and breathing trends; worker history adds context; Gemini explains approved evidence in plain language; the worker chooses whether to request support.
2. **Rapid response:** Scene monitoring can surface a possible fall for immediate human review, helping the safety team see the event and coordinate a response.

## How it works

```text
Camera / Presage + check-in history
                 ↓
        Rest-support model
                 ↓
 Confidence + uncertainty + evidence
                 ↓
   Gemini plain-language explanation
                 ↓
 Worker choice + safety-team response
```

The persistent worker/supervisor experience connects voluntary check-ins → descriptive pulse and breathing trends → symptom/rest requests → protected staffing coordination. Tiger Data and TimescaleDB store time-series history, Supabase provides role-scoped authentication, and the React web app and native iOS scaffold share the same Fastify API.

All seeded measurements and history are clearly synthetic. The application consumes a separately implemented native Presage bridge; it does not include the SDK itself.

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

Put the Tiger Cloud `DATABASE_URL` in the untracked root `.env`, run `npm run db:migrate:postgres` and `npm run db:enable-timescale`, then open http://127.0.0.1:3001. Normal app startup fails closed if Tiger is not configured; SQLite is reserved for isolated automated tests and rehearsals. Stop the API before CLI reset; reset refuses real data and active sessions. The supervisor's local reset control recreates today's fictional schedule if the demo break has expired.

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

- PostgreSQL/Tiger Data: `DATABASE_URL`; run `npm run db:migrate:postgres`. Explicit Timescale enable command checks extension presence. Completed-session reports use TimescaleDB `time_bucket` for ten-second observation evidence when `vital_readings` is a verified hypertable. No automatic fallback on connection failure.
- Gemini: `GEMINI_API_KEY` and an account-verified `GEMINI_MODEL`. Selects server-approved factual sentences, with deterministic fallback. No schedule/medical decisions.
- Presage: separately supplied native bridge plus `PRESAGE_BRIDGE_TOKEN`. Local app only. Source remains fixed within each session.

## Phones

- Phone web layout: open `/mobile` for reminder-driven voluntary check-ins. On trusted HTTPS it can relay consented iPhone-camera frames transiently to the local Presage bridge; synthetic mode remains separately labeled. Plain LAN HTTP cannot access the iPhone camera. Local HTTPS setup and unverified live-measurement status: [docs/MOBILE_APP.md](docs/MOBILE_APP.md).
- Native iOS scaffold using the SmartSpectra Swift SDK: `apps/mobile-ios` (physical-iOS arm64 build passed; on-device measurement and upload not yet verified). See [docs/MOBILE_APP.md](docs/MOBILE_APP.md).

Real Presage hardware, live Gemini, Tiger Data, and hosted deployment require separate verification; fixture tests are not sponsor-integration evidence.

## Handoff documents

- [Product](docs/PROJECT_SPEC.md), [API](docs/API_CONTRACT.md), [bridge](docs/PRESAGE_CONTRACT.md)
- [Setup](docs/SETUP.md), [demo](docs/DEMO.md), [deployment](docs/DEPLOYMENT.md), [runbook](docs/RUNBOOK.md)
- [Agent ownership](AGENTS.md), [readiness assessment](docs/PRODUCTION_READINESS.md)

No diagnosis, risk score, medical clearance, or medically optimal rest claim. Data sufficiency rules and fictional break fixtures are not medical or legal guidance. SiteGuard does not store camera footage or identify faces.

Supabase email/password authentication and worker/admin setup: [docs/SUPABASE_AUTH.md](docs/SUPABASE_AUTH.md).
