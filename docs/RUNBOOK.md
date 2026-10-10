# Demo runbook

Before rehearsal: verify Node/npm, install dependencies, build and run tests, then health/frontend smoke. Keep5173/3001 free for Playwright. Start from root; no Docker needed.

- Expired fictional break: supervisor local reset, or stop API and CLI reset.
- API outage: visible request failure; never imply assistance delivered. Restore service and retry.
- Database outage: restore configured database. No auto-switch to SQLite. SQLite file/volume must persist.
- Stream interrupted: visible error/reconnect; saved readings replay. Measurement failure implies neither safety nor danger.
- Presage unavailable: confirm native bridge/token/camera setup. Stop failed session; separately choose synthetic source. Never relabel mock as real.
- Bridge stop failure: confirm camera is stopped, then retry; app does not finalize until stop confirmed.
- API restart: active sessions finalize with an interruption limitation. Start a fresh session.
- Gemini unavailable: deterministic facts keep app usable.
- Stale scheduling revision: preview again; never force old proposal over a new request.
- Unfilled coverage: display gaps, preserve breaks and human needs; do not override safety constraints.
- Reset blocked: stop active sessions; any real measurement prevents demo reset. Real records require deliberate manual data administration outside this demo control.

Developer2 verifies native hardware/protocol. Developer3 verifies hosted service and persistent DB. Developer4 runs demo/bridge/failure tests and coordinates claimed files before critical fixes.

## SQLite backup and restore

`npm run db:backup -- /private/new-snapshot.sqlite` creates an online WAL-safe snapshot, verifies SQLite integrity/foreign keys, and restricts the file to owner read/write. It refuses existing destination files. `npm run test:backup` verifies restore isolation, WAL content, and permissions using fictional test records.
For recovery, stop the API, preserve the failed database and its WAL/SHM files, then point SQLITE_PATH at a copy of the verified snapshot and restart. Do not restore over a running database. Preserve source labels; a restored active session is explicitly marked interrupted at startup. Protect backups as physiological data. PostgreSQL/Tiger Data backups and restoration must be validated with the service provider separately.
Retention/deletion policy for real personnel data needs an explicit organization policy before deployment; demo reset is not a retention mechanism.
