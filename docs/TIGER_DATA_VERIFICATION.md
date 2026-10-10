# Tiger Data / PostgreSQL verification

**Status: Tiger Cloud itself is UNVERIFIED.** No Tiger Cloud database connection string was available. A Tiger public API key is not a database connection string and cannot be used by SiteGuard. Everything in "Verified locally" was run against a local PostgreSQL server with a locally built TimescaleDB extension, not against Tiger Cloud.

## Verified locally (2026-10-10)

Environment: Ubuntu 24.04 container, Node v24.21.0, `pg` 8.23.1, PostgreSQL 16.15 (Ubuntu package), TimescaleDB 2.17.2 built from the `2.17.2` git tag (the Timescale apt repository was blocked by the network policy). `shared_preload_libraries = 'timescaledb'`. Two databases: `siteguard` (app) and `siteguard_test` (tests). Connection URLs were passed as command-line environment variables only; nothing was written to `.env`.

| Check                       | Command                                                                                                                                               | Result                                                                                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base migration              | `DATABASE_URL=…/siteguard npm run db:migrate:postgres`                                                                                                | `Migration complete: postgres`                                                                                                                                  |
| Migration idempotency       | same command again                                                                                                                                    | `Migration complete: postgres`, no error                                                                                                                        |
| Missing `DATABASE_URL`      | `npm run db:migrate:postgres` with no URL                                                                                                             | exit 1, `DATABASE_URL is required; no SQLite fallback`                                                                                                          |
| Timescale without extension | `npm run db:enable-timescale` before `CREATE EXTENSION`                                                                                               | exit 1, `TimescaleDB extension must be enabled by your database administrator`; table unchanged                                                                 |
| Timescale conversion        | `CREATE EXTENSION timescaledb;` then `npm run db:enable-timescale` (run twice)                                                                        | both exit 0, `TimescaleDB version 2.17.2`; `timescaledb_information.hypertables` lists `vital_readings`                                                         |
| Behavioral tests            | `POSTGRES_TEST_DATABASE_URL=…/siteguard_test npm run test:postgres`                                                                                   | 2 files, 6 tests passed (seed, ingestion replay and conflict, foreign keys, request approval, stale-revision commit, driver resilience)                         |
| Restart persistence         | `npm run demo:reset`, start API, create mock session (10 readings), complete it, file additional-rest request, stop API with SIGTERM, start API again | after restart: health `database: "postgres"`, same session `completed`, 10 readings, pending request and summary returned; readings stored in hypertable chunks |
| No SQLite fallback          | start API with unreachable port or wrong password                                                                                                     | process exits with `ECONNREFUSED` / `password authentication failed`; no server, no SQLite file                                                                 |
| Dropped idle connection     | `pg_terminate_backend` on the API's pooled connection                                                                                                 | before fix: API process crashed; after fix: error logged, API keeps serving from a new connection                                                               |

### TLS behavior (local CA)

`pg` 8.23.1 treats `sslmode=require` (and `prefer`, `verify-ca`) as `verify-full`: the certificate chain and host name are checked, and it prints a warning that libpq semantics arrive in pg 9. Measured locally:

- No `sslmode`: connects without TLS. Do not remove the provider's `sslmode`.
- `sslmode=require` against a self-signed or unknown CA: connection fails (`self-signed certificate` / `unable to verify the first certificate`). There is no silent downgrade to plaintext.
- `sslmode=verify-full&sslrootcert=<local CA>`: connects with TLSv1.3.
- `sslmode=require` with the CA trusted through `NODE_EXTRA_CA_CERTS`: connects with TLSv1.3.

Whether Tiger Cloud's certificate verifies against Node's built-in CA store is **not verified**. If it fails, supply the provider's CA (`sslrootcert=` or `NODE_EXTRA_CA_CERTS`). Do not use `sslmode=no-verify`.

## Bugs fixed in `apps/api/src/db/postgres.ts`

Tests in `apps/api/test/postgres-driver.test.ts`. Three of them failed against the previous driver.

1. **Idle connection errors crashed the API.** The pool had no `error` listener. When the server closed an idle connection, which managed services do, Node treated the event as uncaught and exited. The driver now logs the error and lets the pool replace the connection. A checked-out transaction client also gets a listener, so a connection lost mid-transaction rejects that transaction instead of crashing.
2. **Concurrent queries on one transaction connection.** `Repository.schedule()` issues `Promise.all` reads inside transactions. That relied on pg's implicit client queue, which is deprecated and will be removed in pg 9 (`DeprecationWarning` seen during `test:postgres`). Transaction queries are now serialized explicitly.
3. **Broken connections went back to the pool.** If `ROLLBACK` failed, its error replaced the original failure, and the dead client was released as reusable. The original error is now rethrown and the client is destroyed.
4. **Nested transactions** produced a confusing `BEGIN IMMEDIATE` syntax error on PostgreSQL. They now fail with an explicit message. No current caller nests transactions.

Reviewed with no change needed: all values use `$n` parameters (table and column names come from fixed internal lists only). The base migration is recorded in `schema_migrations` and runs under an advisory transaction lock. `002_timescale.sql` uses `if_not_exists`, and its primary key includes the time column. There is no SQLite fallback when `DATABASE_URL` is set.

## Steps a human must do on Tiger Cloud

1. Sign in at https://console.cloud.timescale.com and create a service for the app. Wait until its status is running.
2. Open the service's connection info and copy the **service connection string**, the direct one rather than a connection pooler URL. The pooler is untested here. PgBouncer-style poolers may reject the startup parameters `pg` sends: `statement_timeout`, and the `options` that the test uses. It should contain `sslmode=require`; keep it, or use `sslmode=verify-full`.
3. Put it in the repository root `.env`. That file is untracked; never commit it or paste it in chat.
   ```
   DATABASE_URL=postgres://tsdbadmin:<password>@<host>:<port>/tsdb?sslmode=require
   ```
4. Create a **separate** test service (or at least a separate database) and set `POSTGRES_TEST_DATABASE_URL` to it in `.env`. The test creates and drops a temporary schema there. Never point it at the app database.
5. Stop any running API, then run:
   ```bash
   npm run db:migrate:postgres
   npm run db:enable-timescale     # expect "TimescaleDB version <x>"; fails explicitly if the extension is missing
   npm run test:postgres           # expect 2 files / 6 tests passed, none skipped
   npm run demo:reset
   npm run dev                     # /api/health must report "database":"postgres"
   ```
6. Verify persistence: create a check-in or a rest request, stop the API, start it again, and confirm the data is still there. Then run `npm run smoke`.
7. Record the extension version, test output and any TLS error in this file. Until then, Tiger Cloud stays unverified.
