# Setup and architecture

Use Node24.7+ (built-in SQLite is experimental in24.7), npm workspaces, one Fastify backend, one React/Vite frontend. `npm ci` uses locked dependency versions. Install Chromium for Playwright.
`npm run dev` runs API3001/web5173 from the repo root. Production-style `npm run build && npm run start` serves web/API together on3001. Root `.env` is read; no sponsor keys enter the browser.

## Configuration

See `.env.example`. `DATABASE_URL` is required for normal development and deployment and must point to Tiger Cloud. Missing or unreachable Tiger configuration fails startup; it never silently switches stores. SQLite requires `SITEGUARD_ALLOW_SQLITE=true` and is reserved for isolated tests/rehearsals. `HOST` defaults to 127.0.0.1. `HOSTED=true` requires strong COOKIE_SECRET/MEASUREMENT_TOKEN and makes cookies Secure. `DEMO_MODE=false` disables demo login/mock/seed. Supabase account login is configured in [SUPABASE_AUTH.md](SUPABASE_AUTH.md). Demo role selection is only for isolated demonstrations.
Gemini requires both key/model. Presage requires token and independently supplied local bridge. Optional integrations are not verified against live accounts/hardware.

## Storage

Relational identity/reference/status columns and SQL foreign keys enforce record relationships. Operational model fields are stored together in a JSON text payload to keep SQLite/PostgreSQL representations identical; rates, source, quality, sequence and timestamp use native time-series columns. `reading_receipts` enforces sequence replay identity separately from hypertable keys. Zod validates API writes; transactions serialize scheduling revisions and state changes.
PostgreSQL serializes mutations with a transaction-scoped advisory lock. SQLite serializes transactions within the API process; run one API process per SQLite file and do not run CLI reset while serving.
Historical analytics use the same TypeScript rules across stores. Sponsor-specific aggregation is not required for the demo.

## Commands

`npm run db:migrate`, `npm run demo:reset`, `npm run dev`, `npm run typecheck`, `npm run test`, `npm run test:e2e`, `npm run build`, `npm run start`, `npm run smoke`.
PostgreSQL: set DATABASE_URL, `npm run db:migrate:postgres`, `POSTGRES_TEST_DATABASE_URL` then `npm run test:postgres` (isolated generated schema, never the app DATABASE_URL). Timescale: administrator enables extension, then `npm run db:enable-timescale` verifies it and converts readings using a timestamp-inclusive primary key.

## Hardening verification

Read docs/PRODUCTION_READINESS.md for verified controls and remaining real-workforce deployment gates. `npm run test:production` checks a built API/frontend against an isolated SQLite database. `npm run test:backup` verifies online snapshot restoration. Browser accessibility checks use axe WCAG AA rules without suppressing contrast findings. Initial route JavaScript is split from chart-heavy pages.

## Sponsor account setup

Tiger Data's [five-minute quickstart](https://www.tigerdata.com/docs/get-started/quickstart/quickstart-5-minutes) creates a cloud service and provides its database connection configuration. Save the downloaded configuration securely, then put its PostgreSQL connection URL in the root untracked `.env` as `DATABASE_URL`. Keep the provider's TLS settings. SiteGuard connects through `pg`; installing `psql` is optional.

Stop the running API before changing database configuration. Run `npm run db:migrate:postgres`, then `npm run db:enable-timescale` to convert SiteGuard's existing `vital_readings` table. Do not create the tutorial's example `conditions` table for this app. The Timescale command requires the extension to be installed and reports a failure explicitly. Restart the app and run `npm run smoke`. For behavioral verification, configure `POSTGRES_TEST_DATABASE_URL` separately and run `npm run test:postgres`; it creates and removes an isolated test schema.

Gemini's [getting-started guide](https://ai.google.dev/gemini-api/docs/get-started) links to Google AI Studio for an API key. Add `GEMINI_API_KEY` and an account-verified `GEMINI_MODEL` to root `.env`, then restart the API. SiteGuard currently uses the installed SDK's GenerateContent interface; the current quickstart illustrates the Interactions interface. A documentation example model is not evidence that the model is available to your account. A successful `/api/insights/explain` response with `origin: "gemini"` verifies the application's live structured-selection path; `origin: "deterministic"` means fallback was used.

Keep credentials out of chat, version control, and frontend `VITE_*` variables. Account provisioning, live PostgreSQL/Timescale verification, and live Gemini verification remain pending until local credentials are configured. Presage SDK setup belongs to the independently supplied bridge; see `docs/PRESAGE_CONTRACT.md` and `integrations/presage-bridge/README.md`.
