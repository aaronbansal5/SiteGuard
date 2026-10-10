# Judge demonstration

Developer 4 (Integration/QA, Hitayu) owns final rehearsal, integration and presentation. Start with the credential-free local path and verify every sponsor integration separately before showing it. The spoken script is in `docs/PRESENTATION_SCRIPT.md`; current integration status is in `docs/READINESS_REPORT.md`.

## Pre-flight (10 minutes before)

1. `npm ci`, `npm run build`, `npm run test:production` (all must pass on the demo laptop).
2. `npm run verify:all` (reads `.env`). It checks Tiger Data (`verify:tiger`), Gemini (`verify:gemini`) and the Presage bridge health and prints a `PASS`/`FAIL`/`SKIP` summary. A `SKIP` means the variable for that check is not set, so the check did not run. Claim only the integrations marked `PASS`.
3. Stop any running API. `npm run demo:reset`, then either:
   - `npm run dev` for the synthetic-only path, or
   - `npm run dev:live` to start the Presage bridge, API and web together (only when you intend to show Presage).

   Fictional breaks are seeded relative to startup: worker W-01's protected break starts two minutes before reset and lasts 15 minutes, so reset no earlier than about 10 minutes before presenting.

   To rehearse the whole core path plus the fall-detection segment headlessly first, run `npm run demo:rehearse` (builds, starts its own API on port 3622 with `.data/rehearsal.sqlite` and the fall-detection demo on 4362, never touching the presentation database). It writes beat timings and a screenshot per beat to `.data/rehearsal/<timestamp>/`; `--out <dir>`, `--port`, `--fall-port`, `--skip-fall`, `--headed` and `--chromium <path>` (or `DEMO_CHROMIUM_PATH`) are optional. The last recorded run is in `docs/DEMO_RUN_REPORT.md`.

4. Open `http://127.0.0.1:5173` in two browser windows: one worker, one supervisor (separate profile or private window so the role cookies differ).
5. Supervisor window: check the **Integrations** panel. It shows the database (local SQLite, or PostgreSQL with TimescaleDB version and whether readings are in a hypertable), explanations (deterministic only / configured, and the origin of the last explanation) and the Presage camera bridge status. "Configured" means credentials are present, not that Gemini works. `/api/health` shows the same `database` and `insightsMode`.

## Core path (synthetic, always available)

1. Landing page: introduce the fictional workforce and the source labels.
2. Supervisor window, "Open safety operations": six workers, protected 15-minute break intervals, two staffed tasks, and the Integrations panel.
3. Worker window, W-01, "Start voluntary check-in": read collection/limitations, tick "I understand the limitations", leave sharing off or explicitly opt in. Choose the synthetic source.
4. "Begin check-in": one-second pulse/breathing charts with the "Synthetic demo" and "No camera required" badges. Point out the gap at about 20 to 25 seconds: readings 20–24 are marked invalid (and pulse is missing at 25), so the line breaks rather than dips. Wait 60 seconds, then "Finish check-in".
5. Summary: initial/final window medians and the comparison with four matching synthetic prior sessions (same source, heavy workload, 26 °C). No recovery, clearance or safety claim.
6. Summary, worker-only **"Compared with your own usual"** (experimental): pulse and breathing change compared with all 12 of this worker's own past synthetic sessions (any context, so the count differs from the four above), and **"How tired do you feel?"**, an optional 1–5 rating that can be removed. The demo history and its ratings are synthetic seed data. The supervisor never sees this panel, the rating or the trend.
7. Worker history: **"Your recent sessions"** shows the personal trend for one source at a time (synthetic demo sessions or Presage sessions, never mixed).
8. "Request additional rest", 5 minutes. Supervisor: "Approve rest", confirm; approved rest is placed after the current protected break (the API rejects rest that overlaps it).
9. "Preview coverage proposal", "Commit coverage proposal": "Coverage updated. Protected breaks preserved." Show the deterministic factual explanation (show Gemini wording only if live Gemini is verified).
10. Worker: "Report a symptom", send. Supervisor sees "Human assistance requested". Acknowledge it, then preview/commit again: the assistance remains unresolved and the worker stays unassigned. Resolution needs an explicit human note.

The browser test `tests/integration/demo.spec.ts` runs the main path at real cadence. `tests/integration/api-journey.spec.ts` checks the same journey at API level, and `tests/integration/personal-insights.spec.ts` covers the worker-only panels and confirms the supervisor cannot see them.

## Optional segments (only once verified; see READINESS_REPORT.md)

- **Real Presage** (partially verified: start/stop/reconnect observed on Mohit's Mac with SmartSpectra SDK 3.4.0, steady readings not yet confirmed). Show only if steady readings have appeared in an app Presage check-in on the demo laptop that day. Run `npm run dev:live` with `PRESAGE_BRIDGE_TOKEN`/`PRESAGE_BRIDGE_URL` and the SDK key in the bridge environment, then begin a separate Presage check-in. The badge reads "Presage measurement" and there is no synthetic history comparison. If the bridge fails, the session shows the failure; stop it and begin a separate synthetic session. Never relabel.
- **Tiger Data** (verified on Tiger Cloud: PostgreSQL 18.6, TLS 1.3, TimescaleDB 2.30.2, `verify:tiger` PASS). On the day, `/api/health` must report `database: "postgres"` and the Integrations panel must show "Readings stored in a hypertable".
- **Gemini** (live check pending after the 12 s deadline fix). Show only if `npm run verify:gemini` or a session explanation returns `origin: "gemini"` on the demo network. The Integrations panel then shows that the last explanation came from Gemini fact selection.
- **Fall detection** (standalone, synthetic only). `cd integrations/fall-detection && python3 -m fall_detection.server`, then open `http://127.0.0.1:4322`. Click **Standing upright**, then **Horizontal pose**, wait at least 1.5 seconds, then review, acknowledge and resolve the incident with a note. It is not connected to the main app. Do **not** use live camera mode: it has known false positives and its consent notice is still being fixed. Call it an experimental heuristic, not verified fall detection.
- **Hosted URL**: not deployed yet. Skip it. Once deployed, it will show only fictional data, and real measurements are refused in hosted mode by design.

## Fallbacks

- Bridge, Gemini, Tiger Data or hosting failure: continue the core path locally with SQLite. Do not claim the failed integration.
- Break expired: supervisor reset (local demo only) or stop the API and `npm run demo:reset`.
- Reset refused: an active session exists (finish it) or a real Presage session is stored (reset refuses to delete real measurements).
- Stale proposal: preview again; never force an old proposal.
- Personal panel says not enough data: that is expected for a source with too little own history. Say so and move on.

Show accurate integration status, not prize or clinical-validation claims.
