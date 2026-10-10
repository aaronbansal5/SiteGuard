# Readiness report (release candidate)

Assessed on 2026-10-10 at release commit `53adfb69d19bce885b509538b1756b2ce619eaf2`. Status terms are strict: **live-verified** means the named external component was contacted in this environment; **fixture-verified** means application or bridge behavior passed against synthetic/local substitutes; **CI-verified** means GitHub Actions passed at this exact commit; **unverified** means the required gate has not passed.

## Go/no-go summary

- **Go: core synthetic demo.** The release CI application job passed typecheck, 96 unit/API tests (5 credential-dependent tests skipped), build, production and backup checks, and 49 browser tests. The browser suite includes the 60-second synthetic worker-to-supervisor journey.
- **No-go for the optional Gemini segment; live adapter verified.** Two release-verifier runs contacted the configured account/model and returned `origin: "gemini"` in 2.736 and 3.509 seconds using fictional synthetic facts. During the timed app rehearsal, the real `/api/insights/explain` request reached its 12-second deadline and correctly returned deterministic fallback text. Keep the optional Gemini presentation segment disabled until the running app returns `origin: "gemini"` on the presentation network.
- **Partial: Tiger Data.** A read-only release verifier connected to the configured Tiger Cloud service over TLS 1.3 and confirmed PostgreSQL 18.6, TimescaleDB 2.30.2, the application tables, and a `vital_readings` hypertable. Migrations and the same checks are also recorded in `docs/TIGER_DATA_VERIFICATION.md`. `npm run test:postgres` against a separate Tiger test service and restart persistence on Tiger have not been run, so full end-to-end Tiger persistence is not claimed.
- **No-go: real Presage segment.** The native bridge package passes typecheck, 37 tests, and fixture smoke. A hardware smoke loaded the pinned real SDK, reported a ready camera, started a session, and enforced idempotent start/camera-busy behavior, but emitted **zero readings in the first 60 seconds**. The run was stopped after that decisive failure. No in-app Presage check-in has been verified; do not present real Presage readings as working.
- **No-go: hosted URL claim.** CI verifies the Docker image locally, including unprivileged execution, local smoke, and SQLite persistence across a container restart. No demo-day HTTPS deployment URL or external smoke was verified.

## Evidence

GitHub Actions run [38075673921](https://github.com/aaronbansal5/SiteGuard/actions/runs/38075673921) completed successfully for the exact release SHA:

| Evidence                                     | Result                       | What it proves                                                                                                                                                                                     |
| -------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application job                              | **CI-verified**              | `npm ci`, typecheck, 96 tests passed / 5 skipped, build, production check, backup restore check, deterministic Gemini fallback without credentials, and 49 Playwright tests passed in 2.1 minutes. |
| Local release verification                   | **Verified**                 | Under Node 25.9, typecheck, 96 tests passed / 5 skipped, and build passed. After installing the matching Chromium build, all 49 Playwright tests passed locally in 2.1 minutes.                    |
| Container job                                | **CI-verified locally**      | Docker build, local deployment smoke, UID 1000, and SQLite data surviving a container restart. It does not prove HTTPS hosting.                                                                    |
| Presage bridge typecheck/tests/fixture smoke | **Fixture-verified**         | 37/37 tests and the synthetic bridge smoke passed locally. Fixtures are hand-authored and are not camera measurements.                                                                             |
| Presage SDK/camera smoke                     | **Failed live gate**         | SDK/camera health and session start worked; zero readings arrived in the first 60 seconds. The optional presentation segment stays disabled.                                                       |
| Tiger read-only verifier                     | **Live-verified, partial**   | TLS connection, engine/extension versions, schema, and hypertable were observed. Separate test database coverage and Tiger restart persistence remain open.                                        |
| Gemini verifier and running app              | **Partial / failed UI gate** | The configured model twice selected server-approved facts from fictional data. The timed running-app request then hit the 12-second deadline and displayed deterministic fallback as designed.     |

CI's skipped tests are credential-dependent PostgreSQL behavior tests. They are not evidence of Tiger behavioral verification. CI's Gemini step intentionally runs without a key and proves deterministic fallback, not a live Gemini call. Root CI does not run the independently packaged Presage bridge tests; those were run separately above.

## Presentation readiness

`docs/PRESENTATION_SCRIPT.md` is present and correctly treats sponsor integrations as optional gated segments. The synthetic path depends on a successful demo reset, two browser contexts, an active seeded break for W-01, and 60 real one-second mock observations before completion. Invalid readings at seconds 20–24, source labels, same-source history, rest approval, coverage preview/commit, and unresolved assistance are covered by automated tests.

A two-context, human-driven browser run-through of the full core sequence completed in **3 minutes 34 seconds**, inside the script's 3-to-4-minute target. It covered the landing/worker flow, a 76-second synthetic session, summary, five-minute rest request and approval, coverage preview/commit, symptom report, assistance acknowledgment, and a second coverage commit. The assistance request remained acknowledged rather than resolved, and protected breaks remained intact. The script was followed operationally but was not spoken aloud, so presenter narration and handoff pacing still need one rehearsal.

The same run showed the Gemini UI gate fail safely: the app displayed deterministic facts after the live request timed out. Presage was not shown after its hardware gate failed, and Tiger was not used for rehearsal writes. Before presenting:

1. Activate a supported Node runtime first. The default shell here is Node 20.14, below the repository's `>=24.7` requirement; use Node 24.x for the app and bridge tooling.
2. Complete one spoken two-presenter rehearsal. Keep the 60-second measurement running while narrating and target the verified 3:34 operator cadence.
3. Re-exercise the Gemini explanation through the running app on the presentation network before enabling that optional segment; the latest app-path attempt timed out.
4. Keep real Presage, Tiger persistence, and hosted-URL claims out of the live script until their remaining gates above pass. The core synthetic path is the reliable fallback and must remain explicitly labeled synthetic.

Nothing here supports diagnosis, medical clearance, a safety score, or a medically necessary break duration. Fixture tests and configured credentials are never sponsor-integration evidence by themselves.
