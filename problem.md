# SiteGuard: peer handoff and remaining work

## What we are building

SiteGuard connects voluntary worker check-ins with manager follow-up and protected break scheduling. Workers review pulse and breathing observations, request rest or assistance, and control sharing. Managers coordinate coverage without shortening required breaks. A separate camera detector flags possible-person-down observations for human review.

Measurements do not establish medical recovery, diagnose injuries, or clear a worker to return to work. Anonymous camera track IDs do not identify workers.

## Current codebase

The remote `main` branch now combines the team's worker/mobile web screens, manager dashboard, Presage adapter, Tiger Data adapter, Gemini explanations, personal-history features, privacy controls, fall-detector hardening, and test/rehearsal tooling.

The local `feature/auth-and-role-experience` branch combines that work with account authentication, worker/manager route separation, revocable sessions, worker invitations, native-login handoff, and manager incident/assistance linkage. Treat this branch as integration work until its final checks pass and it is pushed. Do not assume local commits are already in remote `main`.

## User experience

- **Worker web portal:** protected break, voluntary check-in, consent, source selection, pulse/breathing charts, results, history, personal observations, sharing controls, symptoms, rest and assistance requests.
- **Phone web view:** a smaller worker layout with optional reminders. Reminders do not start measurement or grant consent. Phone browser measurements are explicitly synthetic until a supported native integration is connected.
- **Manager dashboard:** requests, protected schedule, staffing proposals, integration status and human incident review. Physiological access requires session-specific worker sharing.
- **Standalone fall detector:** synthetic, recorded-video and camera modes; local preview, anonymous tracks and explicit incident actions. Real camera mode requires dashboard consent and stays off until started.
- **Native iPhone code:** the team's `apps/mobile-ios` scaffold and the account-client work in `apps/ios` are not yet a single verified distributable application. Choose one target and merge deliberately; do not advertise both as complete.

## Authentication decisions

Use Auth0 Universal Login with Google enabled, through the server's OpenID Connect integration. SiteGuard stores authorization roles and worker links; provider role claims cannot create manager access. There is no public manager signup.

The first manager is bootstrapped by an administrator using their verified provider issuer, subject and email. Managers invite workers by verified email and link them to an existing worker record. Sessions are revocable; logout must invalidate replay. Local demo login remains clearly labeled and is prohibited in hosted mode.

Each deployment/database is bound to one `SITE_ID`. This is single-site isolation, not a shared-database multitenant product. See `docs/AUTH.md` for configuration and account commands. Never paste credentials into chat or commit `.env` files.

## Integration owners and acceptance evidence

| Owner            | Task                                                    | Evidence required                                                                                                               |
| ---------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Presage          | Verify native SDK and the complete worker check-in      | An observed camera session; source-correct persisted pulse/breathing readings; quality/timing mapping; stop/reconnect behavior  |
| Tiger Data       | Verify cloud storage and persistence                    | Migration/hypertable check, separate test database results, restart persistence and backup/restore rehearsal                    |
| Gemini           | Verify factual explanations with the real account/model | Successful application response with `origin: "gemini"`; deterministic fallback on failure                                      |
| Auth/application | Finish account setup and role UX                        | Google login, manager bootstrap, worker invitation, logout/replay rejection, worker isolation, manager API denial               |
| Fall detection   | Connect metadata events and human assistance            | Authenticated deduplicated delivery; explicit worker association; unresolved assistance remains after incident closure/planning |
| Mobile           | Consolidate and verify the iPhone target                | Simulator build; login; worker requests/history; documented native Presage path; physical-device verification separately        |
| QA/deployment    | Verify the merged product                               | Passing checks, repeatable demo, persistent hosted storage, HTTPS and deployment smoke                                          |

A status panel saying “configured” or “bridge ready” is not proof of a complete real measurement session. Fixture tests do not prove live service success.

## Immediate sequence

1. Finish merging the authentication branch with remote `main`; preserve both privacy/security fixes and account protections.
2. Run typecheck, tests, build, production/backup checks and browser tests.
3. Configure Auth0 callbacks and Google login, then bootstrap the first manager and invite one fictional worker.
4. Verify the worker-to-manager journey using two independent accounts.
5. Connect real Presage locally, confirm Tiger persistence and verify Gemini output.
6. Rehearse the labeled synthetic path and dependency failures before the presentation.
7. Consolidate the native app after the shared APIs and permissions are stable.

## Commands

```bash
npm ci
npm run typecheck
npm run test
npm run build
npm run test:production
npm run test:backup
npx playwright install chromium
npm run test:e2e
npm run dev
```

Presage package is independent: install and test it from `integrations/presage-bridge`. `npm run dev:live` starts the real bridge; do not run it without coordinating camera ownership and credentials. Starting a real measurement must remain voluntary.

Standalone fall detector:

```bash
cd integrations/fall-detection
python3 -m unittest discover -s tests -v
python3 -m fall_detection.server
```

The default is synthetic and uses no camera. Read its README before enabling camera mode.

## Team rules

Work in individual branches, claim shared files before editing, and merge through the agreed integration branch. Keep sponsor keys on the server/bridge. Preserve protected breaks, consent and unresolved assistance. Report the exact environment and observed result for every integration claim. Real workforce deployment additionally needs approved data-retention/privacy policies and operational monitoring.
