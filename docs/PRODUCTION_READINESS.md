# Readiness assessment

SiteGuard is a hardened, persistent fictional hackathon demonstration. It is not authorized or configured for real workforce production use.

## Parallel verification

Backend and frontend hardening agents implemented fixes in separate ownership areas. A third agent independently reviewed the implementation and reproduced the planner preservation issue before confirming its correction. The primary agent integrated changes and verifies the built server, browser flows, accessibility, and backup restoration.

Covered controls include transactional SQLite isolation, PostgreSQL transaction timeouts, protected-break invariants, preserved valid assignment portions, revision-checked commits, source-safe idempotent ingestion, signed expiring demo identity, bounded login/write limits and SSE quotas, loopback-only bridge URLs without redirects, hosted refusal of real measurement records, server security headers, versioned base migration, bounded historical SQL selection, stale frontend request protection, deadlines, consent checks, keyboard dialogs, chart gaps, and lazy routes.

## Verification commands

```bash
npm ci
npm run format:check
npm run typecheck
npm run test
npm run build
npm run test:production
npm run test:backup
npm run test:e2e
npm audit
```

The full browser demonstration waits for 60 actual one-second synthetic observations. Additional tests cover privacy, skipped consent, outages, stale proposals, failed session loading with independent assistance, keyboard focus, narrow screens, slow requests, and automated WCAG AA checks. Automated accessibility scans supplement keyboard/layout tests; they are not a complete accessibility certification.

SQLite snapshots are tested for WAL capture, restored integrity, foreign keys, isolation, restricted permissions, and no overwrite. PostgreSQL behavioral QA uses only POSTGRES_TEST_DATABASE_URL and an isolated generated schema; it is skipped without credentials. Live Tiger Data, Gemini, native Presage hardware, Docker, and hosted service are not claimed verified.

## Before real workforce deployment

- Replace public role selection with genuine authentication and accountable authorization. Add revocation/account management; a signed demo cookie is not identity verification.
- Establish consent withdrawal, retention/deletion, backup handling, and privacy policies for actual personnel data. Hosted mode currently rejects Presage sessions.
- Validate PostgreSQL behavioral tests and Tiger Data migrations against a dedicated environment, and rehearse provider backup restoration.
- Verify native camera runtime, timestamp/validity mapping, bridge replay/stop, and vendor data processing/telemetry. No native SDK implementation is included here.
- Verify account-specific Gemini model, credentials, latency and structured responses. Deterministic facts remain the default fallback.
- Validate TLS ingress, secrets management, persistent storage, monitoring, operational alerts and restore procedures on the chosen host.
- Configure deployment-aware shared rate limits and trusted proxy handling. Current per-process limits intentionally serve a single-instance demonstration.
- Keep exactly one API process for either database until measurement ownership and restart recovery are coordinated across instances.

No measurement constitutes diagnosis, medical clearance, a safety score, or a medically necessary break duration. Required-break fixtures are fictional site policy, not legal or medical guidance.
