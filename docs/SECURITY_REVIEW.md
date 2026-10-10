# Security review

Independent security and bug-hunting pass over the whole repository on 2026-10-10 (branch `feature/security-audit`, based on `b5c5832`). Scope: `apps/api`, `apps/web`, `packages/contracts`, `integrations/presage-bridge`, `integrations/fall-detection`, `deploy/`, `fly.toml`, `.github/workflows`, `scripts/`, and dependencies.

SiteGuard remains a fictional hackathon demonstration. Demo role selection is not authentication (see PRODUCTION_READINESS.md). The findings below are judged against that model: on the hosted demo, anyone can become any worker or the supervisor. That makes availability and invariant-integrity bugs reachable by anonymous visitors.

Line numbers refer to `b5c5832` (before the fixes).

## Summary

| ID   | Severity | Area                    | Finding                                                                                             | Status                             |
| ---- | -------- | ----------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------- |
| SR-0 | Medium   | API CSRF defence        | Cross-origin write rejection set 403 but still ran the handler (writes and login cookies happened)  | Fixed                              |
| SR-2 | Medium   | API availability        | Schedule commit of thousands of tiny assignments blocks the event loop on every later overview      | Fixed                              |
| SR-3 | Medium   | Break invariant         | `PATCH /api/breaks/:id` could move approved rest on top of the worker's protected break             | Fixed                              |
| SR-4 | Medium   | Rate limits             | Behind Fly's proxy all clients shared one quota; one IPv6 /64 could mint unlimited quota keys       | Fixed (Fly header unverified live) |
| SR-5 | Medium   | Secrets in output       | `npm run verify:tiger` printed the full `DATABASE_URL`, password included, for a malformed URL      | Fixed                              |
| SR-1 | Low      | API errors              | Malformed/empty JSON, poisoned JSON, wrong media type and oversized bodies returned 503 "retry"     | Fixed                              |
| SR-6 | Low      | Container build context | Root `.dockerignore` excluded `.env` only at the root; nested `.env` files would enter the image    | Fixed                              |
| SR-7 | Medium   | Fall-detection deps     | Python 3.9 camera lock pins 57 known-vulnerable versions (torch, pillow, urllib3, filelock, fsspec) | Open                               |
| SR-8 | Low      | Presage bridge          | No Host-header check (DNS-rebinding defence in depth); the bearer token still blocks it             | Open                               |
| SR-9 | Low      | Hosted demo quotas      | SSE quota is per fictional persona; anyone can hold all six streams of a persona                    | Open (by design)                   |
| —    | Info     | Various                 | See "Informational observations"                                                                    | Open                               |

No critical or high-severity issue was found. Authorization was correct on every route, including the new `/api/integrations`, personal-insights, self-report and personal-trend endpoints (see the authorization matrix below).

## Findings

### SR-0 Medium: Origin rejection did not stop the request (fixed)

- **Where:** `apps/api/src/app.ts:84-114` (`onRequest` hook).
- **Impact:** The hook detected a foreign `Origin` on POST/PATCH/DELETE, set status 403 and _returned an object_. In an async Fastify hook a returned value is ignored; only `reply.send()` stops the request. The route handler ran anyway. A cross-origin `POST /api/demo/login` returned 403 _with_ a valid `Set-Cookie`, and a cross-origin `POST /api/rest-requests` returned 201 and created the record. The existing test only checked the status of the login call, so it passed. The documented "cross-origin writes are not allowed" control was ineffective. Practical CSRF was still blocked by the `SameSite=Strict` cookie and the JSON-only bodies (a cross-origin JSON POST needs a CORS preflight that the API never grants), so this was a broken defence-in-depth layer rather than an open CSRF.
- **Repro (before fix):** `app.inject({method:"POST", url:"/api/rest-requests", headers:{cookie, origin:"https://evil.example", host:"localhost"}, payload:{sessionId:null,kind:"assistance",requestedMinutes:null}})` returned 201 and inserted a request.
- **Fix:** the hook now uses `return reply.code(403).send(...)`.
- **Regression test:** `apps/api/test/security-regressions.test.ts` "SR-0" (four foreign/`null` origins: 403, no record created, no cookie issued; same-origin still 201).

### SR-2 Medium: Unbounded-cost schedule commit (fixed)

- **Where:** `packages/contracts/src/api.ts:63` (`assignments.max(5000)`), with `validateAssignments`/`coverageGaps` in `apps/api/src/domain/scheduling.ts` and `GET /api/supervisor/overview`.
- **Impact:** Validation and coverage-gap computation are super-linear in the number of assignments, and they run synchronously on the event loop. A demo supervisor (anyone, on the hosted demo) could commit thousands of valid 1-second assignments. Measured on this sandbox:

  | Assignments | Commit  | Each overview afterwards | Each preview afterwards |
  | ----------- | ------- | ------------------------ | ----------------------- |
  | 500         | 148 ms  | 96 ms                    | 441 ms                  |
  | 1000        | 554 ms  | 340 ms                   | 1507 ms                 |
  | 2000        | 1655 ms | 1316 ms                  | 3312 ms                 |

  The slowdown persists: the supervisor dashboard polls the overview every 2 s, and hosted mode has no demo reset. About 4000 assignments still fit in the 1 MiB body limit.

- **Fix:** `CommitSchema` now allows at most `MAX_COMMIT_ASSIGNMENTS = 500`. The planner's own proposal for the demo roster stays under 100. `docs/API_CONTRACT.md` documents the limit.
- **Regression test:** "SR-2": 501 assignments return 400 with nothing stored; the preview stays far below the bound.
- **Residual:** 500 assignments still cost about 0.4 s per preview. A production planner needs incremental or indexed gap computation and per-tenant limits.

### SR-3 Medium: Approved rest could be moved onto the protected break (fixed)

- **Where:** `apps/api/src/routes.ts:609-648` (`PATCH /api/breaks/:id`).
- **Impact:** Approval (`PATCH /api/rest-requests/:id`) rejects additional rest that overlaps the worker's protected break (`REST_OVERLAPS_PROTECTED`). The later move endpoint checked only the duration and that the rest was not in the past. A supervisor could approve rest after the protected break, then move it on top of it. The worker would end up with less total rest than approved, which defeats the "additional rest is separate" invariant.
- **Repro (before fix):** worker W-02 (protected break 15-30 min from seed) requests 5 min, the supervisor approves it after the break, then moves it to start 1 min into the protected break: 200.
- **Fix:** the move endpoint applies the same protected-overlap check (409 `REST_OVERLAPS_PROTECTED`).
- **Regression test:** "SR-3" (409, and both breaks unchanged).

### SR-4 Medium: Rate-limit identity behind a proxy and over IPv6 (fixed; Fly header unverified live)

- **Where:** `apps/api/src/app.ts:51` (`key = req.ip`).
- **Impact:**
  - On the chosen host (Fly.io) every request reaches the app from Fly's proxy, so `req.ip` is the proxy address. All visitors shared one 30-logins/min and one 120-writes/min bucket: a single client sending 31 logins a minute locked everyone out of the hosted demo.
  - Conversely, IPv6 clients were keyed by full address. One host owning a /64 could use unlimited keys, both to bypass its own quota and to fill the 10,000-entry limiter table. A full table makes the limiter fail closed for every new client.
- **Fix:**
  - New optional `CLIENT_IP_HEADER` setting (validated as a single header name). When set, the limiter uses that header if it holds a valid IP, and otherwise falls back to the socket address. `fly.toml` sets it to `fly-client-ip`, the header Fly's proxy sets to the connecting client's address.
  - When unset, forwarding headers are ignored, so direct deployments cannot be spoofed.
  - IPv6 addresses are keyed by /64, and IPv4-mapped IPv6 addresses are folded to IPv4 (`apps/api/src/client-ip.ts`).
  - `X-Forwarded-For` hop counting was considered and rejected. Fastify 5.12 deliberately fails closed for numeric `trustProxy`, and a left-most XFF entry is client-controlled.
- **Regression tests:** "SR-4": separate quotas per `fly-client-ip` behind one proxy address; forwarding headers ignored by default; one /64 shares a quota; key normalization; config validation.
- **Not verified:** that a live Fly proxy overwrites a client-supplied `Fly-Client-IP`. If it did not, a client could choose its own quota key, which is no worse than the shared bucket. Verify with a live deployment before relying on it. `docs/DEPLOYMENT.md` documents the setting and that it must not be set when clients can connect directly.

### SR-5 Medium: `verify:tiger` printed database credentials (fixed)

- **Where:** `apps/api/src/db/verify.ts:11`.
- **Impact:** `new URL(DATABASE_URL)` throws `ERR_INVALID_URL` for a malformed URL. Node prints the uncaught error together with its `input` property, which is the full URL including the password. Malformed URLs are common when a password contains unencoded special characters (space, `@`, `/`). The output reaches terminals, `verify:all` output and CI logs.
- **Repro (before fix):** `DATABASE_URL='postgres://u:s3cretpw@ho st:5432/db' npx tsx apps/api/src/db/verify.ts` printed `input: 'postgres://u:s3cretpw@ho st:5432/db'`.
- **Checked and not affected:** the API server and `db:migrate` with malformed or unreachable URLs (three variants) never printed the secret.
- **Fix:** the parse is caught, and the script prints "DATABASE_URL is not a valid URL (value hidden)" and exits 1.
- **Regression test:** "SR-5" spawns the script with a secret-bearing malformed URL and asserts that the secret is absent from stdout and stderr.

### SR-1 Low: Client errors reported as a retryable 503 (fixed)

- **Where:** `apps/api/src/app.ts:116-147` (error handler).
- **Impact:** Fastify's own 4xx errors fell through to the generic branch and returned 503 `DEPENDENCY_UNAVAILABLE` ("A service is unavailable. Retry"). This covered malformed JSON, an empty JSON body, `__proto__` poisoning (correctly refused by the parser), an unsupported `Content-Type` and bodies over 1 MiB. Each one was also logged at error level. The response misdescribed the failure, invited retries of bad requests and polluted operational alerting.
- **Fix:** errors carrying a 4xx `statusCode` map to fixed, generic codes and messages: 400 `VALIDATION`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 405, 413 `PAYLOAD_TOO_LARGE` and 415 `UNSUPPORTED_MEDIA_TYPE`. They are logged at info level. Parser text is never echoed. Database and other dependency failures still return 503 (`tests/integration/api-dependencies.spec.ts` still passes).
- **Regression test:** "SR-1" (five cases, and no `FST_`/stack text in responses).

### SR-6 Low: Nested secrets could enter the container image (fixed)

- **Where:** `.dockerignore:5-6`.
- **Impact:** Docker ignore patterns are anchored at the context root, so `.env` excluded only `./.env`. `.gitignore` ignores `.env` at any depth, so a developer's `apps/web/.env` or `apps/api/.env` would be untracked but still copied into the image by `COPY . .`, and `VITE_*` values would be compiled into the public bundle. Local `.data/` under subdirectories was not excluded either.
- **Fix:** the root `.dockerignore` adds `**/.env`, `**/.env.*`, `**/.data`, `*.pem`/`*.key`, `.npmrc` and `.claude/settings.local.json` (no tracked file matches these).
- **Regression test:** "SR-6" asserts the patterns.
- **Not verified:** no Docker daemon was available in the sandbox, so `docker build` was not run. CI's `container` job builds the image.
- **Note:** `deploy/.dockerignore` is never read. The build context is the repository root, and Docker reads only `<context>/.dockerignore` or `<Dockerfile>.dockerignore`. It is misleading and should be deleted or renamed `deploy/Dockerfile.dockerignore` and kept in sync. It is left unchanged here because `deploy/` belongs to Developer 3.

### SR-7 Medium: Vulnerable pins in the fall-detection Python 3.9 lock (open)

- **Where:** `integrations/fall-detection/requirements-camera.py39.lock.txt`.
- **Result:** `pip-audit --no-deps --disable-pip -r requirements-camera.py39.lock.txt` reports **57 known vulnerabilities in 6 packages**: torch 2.8.0, pillow 11.3.0, urllib3 2.6.3, filelock 3.19.1, fsspec 2025.10.0 and others. Most fixes require Python ≥ 3.10, and Python 3.9 is end-of-life. The Python 3.13 lock reports **no known vulnerabilities**.
- **Impact:** limited to the optional local camera environment. Ultralytics downloads model weights over HTTP(S) and decodes images with Pillow.
- **Recommendation:** drop Python 3.9 from the supported camera matrix, or regenerate the 3.9 lock with the newest versions that still support it and document what remains. Owned by the fall-detection maintainers, so it is not changed here.

### SR-8 Low: Presage bridge accepts any Host header (open)

- **Where:** `integrations/presage-bridge/src/server.ts:160-176`.
- **What is in place:** the bridge binds `127.0.0.1`, refuses non-loopback peers, refuses any request carrying `Origin`, and compares SHA-256 digests of the bearer token with `timingSafeEqual`. A same-origin GET after DNS rebinding carries no `Origin` and would pass the Origin check, but it still needs the token, which browsers never have. Tested: oversized body (413, bridge stays up), `Origin: null` with a valid token (403), deeply nested JSON (400), and malformed `Authorization` variants (401).
- **Recommendation (defence in depth):** reject `Host` values other than `127.0.0.1:<port>` and `[::1]:<port>`. Also bound concurrent SSE streams per session and check `res.write` backpressure. Today these are reachable only by token holders.

### SR-9 Low: Persona-wide SSE quotas on the hosted demo (open, by design)

The stream quota is keyed by identity (`worker:<id>` or the single key `supervisor`). On the hosted demo everyone shares six fictional personas, so a visitor can open six streams as W-01 and block W-01's live view for other visitors. The per-worker (12) and per-process (64) caps cannot be reached with six workers. This is inherent to demo identity and acceptable for the hackathon. Real accounts would make the quota per user.

## Informational observations (open)

- **Hosted demo growth:** hosted mode disables demo reset, and request/symptom writes are capped only at 120/min per client. The SQLite volume grows without bound under abuse. Recommendation: periodic hosted reset or retention for fictional data.
- **Approval bounds:** approval accepts arbitrarily far-future intervals (year 9999) and overlapping additional rests. Neither breaks a stated invariant.
- **Supervisor existence oracle:** a supervisor gets 403 instead of 404 for an existing unshared session. The IDs are random UUIDs, so the impact is negligible.
- **Client-side path traversal:** `apps/web` interpolates route parameters into API paths without encoding (`SessionSummary.tsx`, `Measurement.tsx`). React Router decodes `%2F`, so a crafted link can make the page issue GETs to other `/api/*` paths. Mutating calls use server-returned IDs, and every write endpoint uses strict schemas, so no write is reachable. Recommendation: `encodeURIComponent` or UUID-validate the parameters.
- **SSE cursor parsing:** `Last-Event-ID` is parsed with `Number()`, which accepts `""`, `0x10` and `1e3`. Browsers only echo IDs the server sent. Recommendation: `/^-?\d+$/`.
- **CSP:** sent only in hosted mode, and it includes `style-src 'unsafe-inline'`. No `dangerouslySetInnerHTML`, `innerHTML` or `eval` exists in `apps/web/src`. The fall-detection dashboard writes only through `textContent`.
- **Container:** the base image is tag-pinned, not digest-pinned. The image is single-stage, so it ships devDependencies, tests and docs. It runs as `node` after `setpriv`. Application files are root-owned and not writable by the server. The entrypoint `chown` of the data directory is not recursive, so files left by an older root-run image would fail visibly rather than silently.
- **CI:** `permissions: contents: read`, `push`/`pull_request` triggers only (no `pull_request_target`), and no untrusted `${{ }}` interpolation into `run:`. Actions are pinned by major tag (`@v4`, `@v5`), not by commit SHA. Recommendation: SHA-pin the actions and add `npm audit` and `pip-audit` jobs.
- **Integrations panel:** `/api/integrations` shows supervisors the last Gemini fallback reason. It is key-redacted and limited to 500 characters, but it can include upstream error text.
- **Fall-detection server:** `BaseHTTPRequestHandler` has no socket timeout, so a client that declares a longer `Content-Length` than it sends holds a thread. Loopback-only, and other requests continue (tested). The Host, Origin and `Sec-Fetch-Site` checks rejected every cross-site read and write shape tried, including another port on the same host (`Sec-Fetch-Site: same-site`).

## What was tested

Active tests (permanent ones live in the repository):

- **Authorization matrix:** `apps/api/test/authz-matrix.test.ts`, permanent. Every registered `/api` route (35 rows covering 27 routes) × anonymous / worker A / worker B / supervisor. It includes shared versus unshared sessions, ingest with cookies but no token, and SSE over a real listener. A coverage test fails if a route is added without a matrix row. Mutation check: making personal-insights consent-based, or relaxing `/api/integrations` to any identity, makes the matrix fail.
- **Concurrency (SQLite and PostgreSQL):** eight simultaneous schedule commits on one base revision produce exactly one 200 and seven 409s, with one audit event. Six simultaneous check-in starts produce exactly one 201. Four simultaneous supervisor actions on one request revision apply exactly one.
- **Hostile input:** SQL meta-characters, NUL, lone surrogates, HTML/script, RTL override and `__proto__` strings round-trip verbatim through SQLite and PostgreSQL. Non-UUID, traversal and SQL-shaped IDs and a 5,000-character cursor return 400 without internals. All SQL in `apps/api/src/db/**` is parameterized; table names are compile-time constants.
- **Cookies:** HttpOnly and SameSite=Strict (Secure when hosted: code review only). A tampered signed value, or an expired but correctly signed value, returns 401.
- **Static serving (hosted mode):** encoded traversal attempts return 403/404, and CSP is present on every response.
- **Web bundle:** `apps/web/dist` contains no secret markers (`GEMINI_API_KEY`, `AIza`, tokens, `postgres://`). `import.meta.env` is unused.
- **Presage bridge:** probes as listed in SR-8, plus the existing contract suite.
- **Fall-detection:** cross-site, same-site-other-port, `localhost` Host, `text/plain`, bad Content-Length, slow body, nested JSON and path traversal probes.
- **Scripts:** `verify:gemini` and `verify-all` never print key values. `verify:tiger` was fixed (SR-5). Backup scripts print paths only.

Commands run on the final tree (results in the hand-off report): `npm run typecheck`, `npm run test`, `npm run build`, `npx prettier --check .`, `npm run format:check`, `POSTGRES_TEST_DATABASE_URL=… npm run test:postgres`, the Playwright suite via `.data/pw.local.config.ts` (in an isolated network namespace so ports 3001/5173 did not collide with other worktrees), the bridge's `npx vitest run` and `npx tsc --noEmit`, the fall-detection `python3 -m unittest discover -s tests`, `npm audit` (root and bridge: 0 vulnerabilities), and `pip-audit` on both fall-detection lock files.

Results on the final tree:

| Check                                            | Result                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| `npm run typecheck`, `npm run build`             | Pass                                                                  |
| `npm run test`                                   | 190 passed, 5 skipped (PostgreSQL tests without credentials)          |
| `npm run test:postgres` (local PostgreSQL)       | 6 passed                                                              |
| Playwright (`.data/pw.local.config.ts`)          | 51 passed (see the note below)                                        |
| `npm run test:production`, `npm run test:backup` | Pass                                                                  |
| Hosted-mode built server and `deployment-smoke`  | Pass; 31st login from one `fly-client-ip` got 429, another client 200 |
| Prettier (`--check .` and `format:check`)        | Pass                                                                  |
| Bridge `vitest run` / `tsc --noEmit`             | 50 passed / pass                                                      |
| Fall-detection `unittest`                        | 35 passed                                                             |
| `npm audit` (root, bridge)                       | 0 vulnerabilities                                                     |
| `pip-audit` (py313 lock / py39 lock)             | 0 / 57 known vulnerabilities (SR-7)                                   |

Playwright note: the first full run with the fixes timed out once, in `hardening.spec.ts:66` on the landing page. That spec passed in isolation and in two later full runs, and the unmodified base passed 51/51, so the timeout is treated as flaky. The run shares one demo login quota (30 per minute from 127.0.0.1) across the whole suite. Docker image build and live Fly behavior were not verified: there was no Docker daemon and no Fly account.

## Residual risks and recommendations

1. Demo identity is self-selected. Every "supervisor-only" control protects only against accidental misuse on the hosted demo. Real deployment needs authentication, per-user quotas and account management (PRODUCTION_READINESS.md).
2. Rate limits and SSE quotas are process-local. Multi-instance or production use needs a shared limiter at ingress.
3. Verify on a live Fly deployment that `Fly-Client-IP` is set by the proxy and cannot be supplied by clients (SR-4), and run `docker build` to confirm the context exclusions (SR-6).
4. Resolve SR-7 (Python 3.9 lock), then add `npm audit --audit-level=high` and `pip-audit` on the 3.13 lock to CI.
5. Harden the bridge with a Host allowlist and stream bounds (SR-8). Delete or rename `deploy/.dockerignore` (SR-6 note).
6. Encode route parameters in web API paths. Tighten `Last-Event-ID` parsing. Consider a retention or reset policy for hosted fictional data.
