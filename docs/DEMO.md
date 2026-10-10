# Judge demonstration

Developer 4 (Integration/QA, Hitayu) owns final rehearsal, integration and presentation. Start with the credential-free local path and verify every sponsor integration separately before showing it. The spoken script is in `docs/PRESENTATION_SCRIPT.md`; current integration status is in `docs/READINESS_REPORT.md`.

## Pre-flight (10 minutes before)

1. `npm ci`, `npm run build`, `npm run test:production` (all must pass on the demo laptop).
2. Stop any running API. `npm run demo:reset`, then `npm run dev`. Fictional breaks are seeded relative to startup: worker W-01's protected break starts two minutes before reset and lasts 15 minutes, so reset no earlier than about 10 minutes before presenting.
3. Open `http://127.0.0.1:5173` in two browser windows: one worker, one supervisor (separate profile or private window so the role cookies differ).
4. Check `/api/health`: `database` and `insightsMode` must match what you intend to claim. `insightsMode: "configured"` means credentials are present, not that Gemini works.

## Core path (synthetic, always available)

1. Landing page: introduce the fictional workforce and the source labels.
2. Supervisor window, "Open safety operations": six workers, protected 15-minute break intervals, two staffed tasks.
3. Worker window, W-01, "Start voluntary check-in": read collection/limitations, tick "I understand the limitations", leave sharing off or explicitly opt in. Choose the synthetic source.
4. "Begin check-in": one-second pulse/breathing charts with the "Synthetic demo" and "No camera required" badges. Point out the invalid segment and gap at 20 to 24 seconds. Wait 60 seconds, then "Finish check-in".
5. Summary: initial/final window medians and the comparison with four matching synthetic prior sessions. No recovery, clearance or safety claim.
6. "Request additional rest", 5 minutes. Supervisor: "Approve rest", confirm; approved rest is placed after the current protected break.
7. "Preview coverage proposal", "Commit coverage proposal": "Coverage updated. Protected breaks preserved." Show the deterministic factual explanation (show Gemini wording only if live Gemini is verified).
8. Worker: "Report a symptom", send. Supervisor sees "Human assistance requested". Acknowledge it, then preview/commit again: the assistance remains unresolved and the worker stays unassigned. Resolution needs an explicit human note.

The browser test `tests/integration/demo.spec.ts` runs exactly this path at real cadence; `tests/integration/api-journey.spec.ts` checks the same journey at API level.

## Optional segments (only once verified; see READINESS_REPORT.md)

- Real Presage: start the bridge on the same laptop, set `PRESAGE_BRIDGE_TOKEN`/`PRESAGE_BRIDGE_URL`, restart the API and begin a separate Presage check-in. The badge reads "Presage measurement" and there is no synthetic history comparison. If the bridge fails, the session shows the failure; stop it and begin a separate synthetic session. Never relabel.
- Tiger Data: only if `/api/health` reports `database: "postgres"` against the Tiger service and `npm run test:postgres` passed against the test service.
- Gemini: only if `npm run verify:gemini` (deploy branch) or the session explanation returns `origin: "gemini"` on the demo network.
- Hosted URL: only fictional data; real measurements are refused in hosted mode by design.

## Fallbacks

- Bridge, Gemini, Tiger Data or hosting failure: continue the core path locally with SQLite. Do not claim the failed integration.
- Break expired: supervisor reset (local demo only) or stop the API and `npm run demo:reset`.
- Reset refused: an active session exists (finish it) or a real Presage session is stored (reset refuses to delete real measurements).
- Stale proposal: preview again; never force an old proposal.

Show accurate integration status, not prize or clinical-validation claims.
