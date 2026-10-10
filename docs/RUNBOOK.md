# Demo runbook

Before rehearsal: verify Node/npm, install dependencies, build and run tests, then health/frontend smoke. Keep5173/3001 free for Playwright. Start from root; no Docker needed.

- Expired fictional break: supervisor local reset, or stop API and CLI reset.
- API outage: visible request failure; never imply assistance delivered. Restore service and retry.
- Database outage: restore configured database. No auto-switch to SQLite. SQLite file/volume must persist.
- Stream interrupted: visible error/reconnect; saved readings replay. Measurement failure implies neither safety nor danger.
- Presage unavailable: confirm native bridge/token/camera setup. Stop failed session; separately choose synthetic source. Never relabel mock as real.
- Bridge stop failure: confirm camera is stopped, then retry; app does not finalize until stop confirmed.
- API restart: active sessions finalize with an interruption limitation. Start a fresh session.
- Gemini unavailable: deterministic facts keep the app usable. Every failure (missing key or model, HTTP error, 5 s timeout, output that fails validation or leaves out a fact) returns `origin: "deterministic"`. Run `npm run verify:gemini` locally to see the reason; it never prints the key.
- Stale scheduling revision: preview again; never force old proposal over a new request.
- Unfilled coverage: display gaps, preserve breaks and human needs; do not override safety constraints.
- Reset blocked: stop active sessions; any real measurement prevents demo reset. Real records require deliberate manual data administration outside this demo control.

Developer2 verifies native hardware/protocol. Developer3 verifies hosted service and persistent DB. Developer4 runs demo/bridge/failure tests and coordinates claimed files before critical fixes.

## SQLite backup and restore

`npm run db:backup -- /private/new-snapshot.sqlite` creates an online WAL-safe snapshot, verifies SQLite integrity/foreign keys, and restricts the file to owner read/write. It refuses existing destination files. `npm run test:backup` verifies restore isolation, WAL content, and permissions using fictional test records.
For recovery, stop the API, preserve the failed database and its WAL/SHM files, then point SQLITE_PATH at a copy of the verified snapshot and restart. Do not restore over a running database. Preserve source labels; a restored active session is explicitly marked interrupted at startup. Protect backups as physiological data. PostgreSQL/Tiger Data backups and restoration must be validated with the service provider separately.
Retention/deletion policy for real personnel data needs an explicit organization policy before deployment; demo reset is not a retention mechanism.

## Hosted demo on Fly.io (UNVERIFIED live)

Full setup steps are in docs/DEPLOYMENT.md. Replace `<app>` with your Fly app name.

- **Before the demo:** run `fly status --app <app>` (expect 1 machine, started, check passing), then `SMOKE_URL=https://<app>.fly.dev node scripts/deployment-smoke.mjs`. If either fails, use the local demo (`npm run build && npm run start`). Live deployment and sponsor connectivity are never required for the demo.
- **Logs:** `fly logs --app <app>`. Secret values never appear in logs or in `fly secrets list`.
- **Health check failing / machine stopped:** `fly machine restart --app <app>`. Active sessions finalize as interrupted on restart; start a fresh one.
- **Start fails with "Hosted mode requires COOKIE_SECRET and MEASUREMENT_TOKEN":** `fly secrets set --app <app> COOKIE_SECRET="$(openssl rand -hex 32)" MEASUREMENT_TOKEN="$(openssl rand -hex 32)"`. Rotating `COOKIE_SECRET` signs out every demo identity.
- **Gemini badge shows "Deterministic explanation" when you expected Gemini:** run `npm run verify:gemini` locally with the same key and model to get the reason. To update the secrets on Fly, run `grep -E '^(GEMINI_API_KEY|GEMINI_MODEL)=' .env | fly secrets import --app <app>` (this restarts the machine). To turn Gemini off, run `fly secrets unset --app <app> GEMINI_API_KEY`.
- **Volume or permissions:** the entrypoint `chown`s `/data` on every start. If SQLite reports an error, check `fly volumes list --app <app>`. There must be exactly one `siteguard_data` volume in the machine's region, attached to the one machine. Never scale beyond 1 machine.
- **Backup from Fly:**
  ```bash
  STAMP=$(date +%Y%m%d%H%M)
  fly ssh console --app <app> -C "node scripts/backup.mjs /data/backup-$STAMP.sqlite"
  fly ssh sftp get /data/backup-$STAMP.sqlite ./backup-$STAMP.sqlite --app <app>
  ```
  This is UNVERIFIED on Fly. The backup script's behavior is covered locally by `npm run test:backup`.
- **Reset the hosted demo:** use the supervisor's demo reset. To wipe everything, run `fly apps destroy <app>` and redeploy following DEPLOYMENT.md.
