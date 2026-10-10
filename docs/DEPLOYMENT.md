# Developer3 deployment handoff

**Status: live hosted deployment is UNVERIFIED. Live Gemini is UNVERIFIED.** The Fly.io config, container and smoke checks below were written and checked locally where possible (see "What has and has not been verified"). Nobody has deployed this to a real Fly account or called Gemini with a real key from this branch yet.

The app runs as one same-origin Fastify service that also serves the built React app. Do not modify application contracts to deploy it. Hosted data must stay fictional: no real bridge or volunteer measurements on a public demo (hosted mode rejects Presage sessions). Role selection is demonstration identity, not production authorization.

## Requirements (any host)

- Node 24.7+; run from the repository root (SQL migrations and `apps/web/dist` are read from there). Migrations run automatically at API startup.
- `HOST=0.0.0.0`, `PORT`, `HOSTED=true`, `DEMO_MODE=true`.
- Strong, independent `COOKIE_SECRET` (32+ chars) and `MEASUREMENT_TOKEN` (16+ chars). Hosted mode refuses to start without both.
- TLS in front of the app: hosted cookies are `Secure` and the app sends HSTS.
- SQLite needs a mounted persistent volume and **exactly one** API process (`SQLITE_PATH=/data/siteguard.sqlite`). Never run SQLite on ephemeral storage. Alternatively set `DATABASE_URL` for PostgreSQL/Tiger Data, still with one process (measurement sources and subscriptions live in-process; startup finalizes interrupted sessions). A database outage fails visibly; there is no fallback to another database.
- Optional: `GEMINI_API_KEY` and `GEMINI_MODEL`. Both are read only on the server. Without either one, or on any Gemini failure, explanations use the deterministic facts (`origin: "deterministic"`).
- Health endpoint: `/api/health`. Browser routes fall back to the SPA.
- Secrets go in the host's secret store. Never put them in `fly.toml`, Docker build args, the image, or git.

## Chosen host: Fly.io (HTTPS + persistent volume)

Files:

- `fly.toml`: app config. HTTPS is forced, port 3001, health check on `/api/health`, a 1 GB volume `siteguard_data` mounted at `/data`, auto-stop turned off, one machine.
- `deploy/Dockerfile`: Node 24 image. It runs `npm ci` and `npm run build`, then starts `node apps/api/dist/server.js` directly so SIGTERM reaches the server.
- `deploy/docker-entrypoint.sh`: Fly mounts volumes owned by root. The entrypoint starts as root, `chown`s `/data` to the `node` user, then drops to `node` with `setpriv`. The server itself never runs as root.
- `scripts/deployment-smoke.mjs`: runs the app smoke (health, frontend, 6 fictional workers). For a non-loopback URL it also requires `https://`, an HSTS header, and a redirect from plain HTTP to HTTPS.

### Exact human steps

Run everything from the repository root on your own machine.

1. **Check locally first.**
   ```bash
   npm ci
   npm run typecheck && npm run test && npm run build && npm run test:production
   ```
2. **Verify Gemini locally (optional; skip it to deploy with deterministic explanations).** Put the key and model in `.env`. `.env` is gitignored and excluded from Docker builds:
   ```
   GEMINI_API_KEY=<your key from https://aistudio.google.com/apikey>
   GEMINI_MODEL=<a model id your key can use, e.g. gemini-3.8-flash; gemini-2.5-flash is retired for new keys>
   ```
   Then run `npm run verify:gemini`. It sends fictional synthetic facts through the app's real server-side adapter and prints whether the key is set (never its value), the model, `origin`, latency and the rendered observations. It exits 0 only when `origin` is `gemini`. If it fails, the last line gives the fallback reason (missing variable, HTTP error such as 400/403/404/429, timeout, or output rejected by validation). Fix that before you set the secrets on Fly.
3. **Create a Fly account and install the CLI.** Sign up at https://fly.io/app/sign-up (Fly may ask for a payment card even for small apps). Install flyctl: `brew install flyctl` on macOS, or `curl -L https://fly.io/install.sh | sh` on Linux/macOS, or `pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"` on Windows. Then run:
   ```bash
   fly auth login
   ```
4. **Name the app.** Change `app = "siteguard-adaptivebreak-demo"` in `fly.toml` to a globally unique name (shown below as `<app>`). Change `primary_region` too if you want a different region (`fly platform regions` lists them). Then run:
   ```bash
   fly apps create <app>
   fly volumes create siteguard_data --app <app> --region ewr --size 1
   ```
   Fly warns that a single volume has no redundancy. Accept it: this is a single-instance demo.
5. **Set secrets in Fly's secret store.** `--stage` stores them without restarting anything:
   ```bash
   fly secrets set --app <app> --stage \
     COOKIE_SECRET="$(openssl rand -hex 32)" \
     MEASUREMENT_TOKEN="$(openssl rand -hex 32)"
   # Optional Gemini, only after step 2 passed. Reads from .env, so the key never goes on the command line:
   grep -E '^(GEMINI_API_KEY|GEMINI_MODEL)=' .env | fly secrets import --app <app> --stage
   fly secrets list --app <app>   # shows names and digests only, never values
   ```
6. **Deploy one machine:**
   ```bash
   fly deploy --app <app> --ha=false
   fly scale count 1 --app <app>
   fly status --app <app>          # expect 1 machine, state started, health check passing
   ```
7. **Run the smoke test against the HTTPS URL:**
   ```bash
   SMOKE_URL=https://<app>.fly.dev node scripts/deployment-smoke.mjs
   ```
   It should print `Smoke passed: health, frontend, fictional roster. Database: sqlite` and then `Deployment smoke passed: HTTPS, HSTS, HTTP->HTTPS redirect.`
8. **Check that data persists:** run `fly machine restart --app <app>`, then run the smoke test again. Demo records created before the restart should still be there.
9. **Check Gemini on the host (optional):** in the hosted app, finish a synthetic session or commit a schedule, then open the explanation. The badge reads **"Gemini fact selection"** (session summary) or `gemini` (supervisor) when Gemini answered. It reads "Deterministic explanation" / `deterministic` when the app fell back. You can also try `fly ssh console --app <app> -C "node scripts/verify-gemini.mjs"`. That command is UNVERIFIED: it depends on Fly SSH sessions inheriting the machine's secrets as environment variables.

Rollback: `fly releases --app <app>`, then `fly deploy --app <app> --image <previous image ref> --ha=false`. Back up first with `fly ssh console` plus the steps in RUNBOOK.md.

Teardown: `fly apps destroy <app>`. This deletes the volume and all demo data.

## What has and has not been verified

Verified in the agent sandbox on 2026-10-10:

- `npm run typecheck`, `npm run test`, `npm run build`, and `npm run test:production` pass.
- The built server starts with `HOSTED=true`, and `deployment-smoke.mjs` passes against it on loopback over HTTP. HSTS and CSP headers are present.
- The entrypoint's root-owned-volume `chown` and privilege drop were tested with a temporary unprivileged user (not inside the container). Environment secrets survive the drop.
- `npm run verify:gemini` without a key prints `origin: deterministic`, gives the reason, and exits 1.

**Not verified:**

- `docker build`: the sandbox's egress policy blocks Docker Hub (`403 Forbidden` on `registry-1.docker.io`). CI's new `container` job builds the image, runs it with a root-owned bind mount, smokes it, restarts it, and smokes again. Its first green run is the first real container verification.
- `fly.toml` against a live Fly account. flyctl is not installed here, so `fly config validate` was not run. The file was checked only as valid TOML.
- Live HTTPS, the HTTP->HTTPS redirect, and volume persistence on Fly.
- Live Gemini with a real key and model: no key was available, by design.

Before hosting, always run `npm run test:production` after the build. It checks the production landing page, SPA deep links, assets, health, and missing-resource handling on an isolated database and port.
