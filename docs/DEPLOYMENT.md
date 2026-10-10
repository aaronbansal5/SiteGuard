# Developer3 deployment handoff

No hosted deployment is claimed. The app supports one same-origin Fastify service serving the built React app. Do not modify application contracts to deploy it.

Use Node24.7+; `npm ci`, `npm run build`, `npm run db:migrate`, `npm run start`. Run from repository root; SQL migration files and apps/web/dist must exist. Health: `/api/health`. Static fallback supports browser routes.
Configure HOST=0.0.0.0, PORT, HOSTED=true, DEMO_MODE=true, strong independent COOKIE_SECRET and MEASUREMENT_TOKEN. TLS ingress required for Secure cookies. Hosted data must remain fictional. No real bridge/volunteer measurements on public demo. Role selection is demonstration identity, not production authorization.
SQLite requires a mounted persistent volume and exactly one API replica; use SQLITE_PATH=/data/siteguard.sqlite. Otherwise provide DATABASE_URL for PostgreSQL/Tiger Data. Never run SQLite on ephemeral storage. Database outage fails explicitly, with no fallback.
Set Gemini key/model only after an account-specific smoke test; optional. Presage bridge remains laptop-local.
Docker and CI templates are initial scaffolds for Developer3; Docker runtime/hosting needs independent verification because local Docker daemon was unavailable during implementation.

## Single-process requirement

Use exactly one API process/replica for both SQLite and PostgreSQL. Measurement sources and subscriptions are local to the API, and startup explicitly finalizes interrupted sessions. Multiple concurrent instances require separate coordination before support can be claimed.

Container scaffold: `docker build -f deploy/Dockerfile -t siteguard .`. Root `.dockerignore` excludes keys, database files, Git metadata and installed dependencies. The image defaults to hosted mode and requires COOKIE_SECRET/MEASUREMENT_TOKEN supplied at runtime. Mount a writable persistent `/data` owned by the container's node user. Do not put secrets into build arguments or image layers.

Before hosting, run `npm run test:production` after the build. It verifies the production landing page, SPA deep links, assets, health, and missing-resource handling on an isolated database/port. Docker and cloud runtime remain separately unverified.
