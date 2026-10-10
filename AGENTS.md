# SiteGuard agent instructions

Read skill.md and docs/PROJECT_SPEC.md before changes. The user's approved implementation request supersedes the brief's initial Plan Mode instruction.
docs/API_CONTRACT.md and docs/PRESAGE_CONTRACT.md are canonical interfaces.
Do not overwrite the brief or claim unverified integrations.

## Ownership

Developer 1: apps/web, apps/api, packages/contracts, packages/mock-data, canonical specifications, root workspace configuration and lockfile.
Developer 2: integrations/presage-bridge and its independent lockfile. Do not implement their native SDK work here.
Developer 3: deploy, .github/workflows, deployment/runbook documentation, scripts/deployment-smoke.mjs.
Developer 4: tests/integration, docs/DEMO.md, presentation materials.
The approved implementation authorizes initial application smoke tests and handoff documentation. Coordinate later changes outside ownership boundaries.

## Invariants

Synthetic measurements are always labeled; source never changes mid-session.
Required breaks cannot move or shrink. Unresolved assistance is never cleared by scheduling or acknowledgment.
Measurement quality and symptoms are independent. No diagnosis, medical clearance, safety score, or medically optimal rest claim.
No application storage of camera footage; no browser sponsor API secrets.
Use parameterized SQL and Zod validation at external boundaries. Never silently change database or measurement source after failure.

## Verification

npm run typecheck
npm run test
npm run build
npm run test:e2e
Run relevant checks after changes; do not describe unrun checks as successful.
Use fixtures for SDK and Gemini tests; real integrations require separate credential/hardware verification.
