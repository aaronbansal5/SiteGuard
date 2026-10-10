# Team Assignments — SiteGuard AdaptiveBreak

Base branch: `feature/siteguard-adaptivebreak`. Everyone branches from it and reads `AGENTS.md` before starting. Ownership stays separate; each person works on their own feature branch and merges back through Gravit's review.

| Person | Role | Branch | Area owned |
|---|---|---|---|
| Gravit | Tiger Data owner + main app owner | `feature/tiger-data` | Database provisioning/verification; approves app-file and contract changes; reviews merges |
| Aaron | Gemini + deployment owner | `feature/deploy-gemini` | Gemini config, `deploy/`, `.github/workflows`, deployment/runbook docs, hosting account |
| Mohit | Presage owner | `feature/presage-bridge` | `integrations/presage-bridge` |
| Hitayu | Integration / QA owner | `feature/integration-qa` | `tests/integration`, demo rehearsal, presentation script |

## Accounts and access

- **Aaron:** choose and set up the hosting account; add repo/Actions secrets; give Hitayu read access to the deployed environment.
- **Gravit:** create the Tiger Data account with two separate services/databases — app (`DATABASE_URL`) and test (`POSTGRES_TEST_DATABASE_URL`). Share credentials privately.
- **Aaron:** create the Google AI Studio account and API key (server-side only).
- **Mohit:** obtain Presage SDK credentials and `PRESAGE_BRIDGE_TOKEN`; share the token with Hitayu securely.
- **Never commit secrets** or paste them in chat; use a password manager or secret store.

## Rehearsal order (Hitayu runs)

1. Synthetic demo only
2. Presage bridge alone
3. Tiger Data alone
4. Gemini + deployed environment alone
5. Full end-to-end run

---

## Gravit — Tiger Data owner + main app owner

**Deliver:** a dedicated Tiger service; local `DATABASE_URL` configured; migrations and Timescale conversion run; persistence and PostgreSQL tests verified.

> Provision and verify Tiger Data for the existing SiteGuard PostgreSQL adapter. Read docs/SETUP.md. Configure DATABASE_URL locally, run `npm run db:migrate:postgres` and `npm run db:enable-timescale`. Configure POSTGRES_TEST_DATABASE_URL separately, then run `npm run test:postgres`. Verify restart persistence and report the extension version and test results. Do not reset shared data. As main app owner, approve any contract changes proposed by the Presage owner and review merges back to `feature/siteguard-adaptivebreak`.

## Aaron — Gemini + deployment owner

**Deliver:** server-side Gemini credentials/model configured; explanations verified to return `origin: "gemini"`; fictional demo deployed with HTTPS, persistent storage, secrets and a working smoke check.

> Verify SiteGuard's existing server-side Gemini adapter using GEMINI_API_KEY and an account-supported GEMINI_MODEL. Confirm an application explanation returns `origin: "gemini"` and that failure preserves deterministic explanations. Own `deploy/`, `.github/workflows`, and deployment/runbook documentation. Deploy fictional data only, with HTTPS and persistent storage. Read docs/DEPLOYMENT.md and docs/PRODUCTION_READINESS.md; report verification evidence and remaining limitations. Coordinate with Gravit before touching application files.

## Mohit — Presage owner

**Deliver:** a working native camera bridge that follows docs/PRESAGE_CONTRACT.md; verified pulse/breathing fields, validity mapping, timestamps, start/stop and reconnect behavior. Document SDK version and vendor processing/privacy.

> Implement the independently owned native Presage bridge in `integrations/presage-bridge`. Read skill.md, AGENTS.md, and docs/PRESAGE_CONTRACT.md. Do not invent SDK fields or infer measurement validity from numeric values. Keep credentials in the bridge and bind it to loopback. Deliver fixtures, contract tests, a standalone smoke command, and an observed camera session. Coordinate contract changes with the main app owner (Gravit).

## Hitayu — Integration / QA owner

**Deliver:** tested worker → supervisor journey; verified Presage bridge integrated; failures exercised; protected breaks and unresolved assistance verified intact; presentation script.

> Independently verify SiteGuard from `feature/siteguard-adaptivebreak`. Read the canonical contracts and docs/DEMO.md. Run typecheck, unit/API tests, build, production smoke, backup check and browser tests. Test the real bridge once delivered. Verify source labels, consent restrictions, assistance without measurement, protected breaks, stale schedule commits and dependency failures. Claim individual application files (with Gravit) before fixing them. Deliver a rehearsed demo and an honest readiness report.

---

## Remaining scope and limits

The remaining work is live integration verification, deployment verification and rehearsal. Fixture tests are not sponsor-integration evidence. The app uses demo identity; real workforce use would additionally require production authentication and personnel-data policies.
