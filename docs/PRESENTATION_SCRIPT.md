# Presentation script (3 to 4 minutes)

One presenter drives the worker window, one drives the supervisor window. Follow `docs/DEMO.md` pre-flight first. Timings are targets; the 60-second check-in is the fixed cost, so talk over it.

Wording rules: say "observations", "measured change", "request", "protected break". Never say "diagnose", "recovered", "safe to return", "fatigue score", "optimal break" or "predict". Call synthetic data synthetic every time.

## Core demo: synthetic, always shown (about 3 minutes)

**0:00 to 0:20 · Problem (landing page)**
"Construction crews get scheduled breaks, but the break length tells nobody how a worker's pulse and breathing actually change while they rest. SiteGuard lets a worker do a voluntary, contactless check-in during a protected break, and gives supervisors a way to respond without ever shortening required rest."

**0:20 to 0:35 · Protected schedule (supervisor window)**
"Six fictional workers, two staffed tasks, and staggered 15-minute protected breaks. These breaks are fixed constraints. The planner cannot move or shrink them."

**0:35 to 0:55 · Consent (worker window, W-01)**
"Check-in is voluntary. The worker sees exactly what is collected, and sharing with the supervisor is off unless they opt in. For this demo we choose the synthetic source. It is labeled synthetic everywhere and uses no camera."
Click "Begin check-in".

**0:55 to 1:55 · Measurement (talk over the 60 seconds)**
"Pulse and breathing arrive once a second. The badge says Synthetic demo. This dip around 20 seconds is a deliberately invalid segment. Invalid or missing readings are shown as gaps and left out of the calculations. A failed measurement means neither safe nor unsafe."
"In real use, Presage SmartSpectra supplies these observations from a camera through a local bridge. The app never stores footage, and the source can't change in the middle of a session."
At 60 readings, click "Finish check-in".

**1:55 to 2:15 · Summary**
"We compare the first and last 15-second windows using medians, and only when there are enough valid observations. Otherwise it says insufficient data. The comparison uses only prior sessions from the same source and context, here four synthetic ones. This describes what was measured. It is not a recovery score."

**2:15 to 2:40 · Request and approval**
Worker: "Request additional rest", 5 minutes, send. Supervisor: "Approve rest", confirm.
"The approval creates separate additional rest after the protected break. The protected break itself never changes."

**2:40 to 3:00 · Coverage**
Supervisor: "Preview coverage proposal", "Commit coverage proposal".
"The planner reassigns task coverage around protected breaks and open worker requests. Any gaps it can't fill are shown, not hidden. The explanation panel lists only facts the server computed."

**3:00 to 3:20 · Human assistance**
Worker: "Report a symptom", send. Supervisor: acknowledge it, then preview/commit again.
"Symptoms and assistance don't depend on any measurement. Acknowledging a request doesn't close it, and the planner can't close it either. This worker stays off the schedule until a person resolves it with a note."

**3:20 to 3:30 · Close**
"Presage provides the contactless observations. SiteGuard turns them into a record the worker controls, a request path, and staffing changes that keep required rest in place. Decisions stay with people."

## Optional segments: show ONLY once verified

Each segment has a gate. If the gate has not passed on the demo laptop on demo day, skip the segment and don't mention the integration as working. Status lives in `docs/READINESS_REPORT.md`.

**[OPTIONAL · REAL PRESAGE · about 45 s]** Gate: a bridge build with the real SDK adapter (not the fixture adapter) has produced a camera session on this laptop, and a Presage check-in in the app showed readings.
"Now the same flow with a real camera measurement." Begin a new check-in, choose Presage. "The badge now says Presage measurement, and the summary does not compare against synthetic history." If it fails: "The bridge reports unavailable. The session says so, and we don't substitute synthetic data." Then return to the core demo.

**[OPTIONAL · TIGER DATA · about 15 s]** Gate: `/api/health` shows `database: "postgres"` against the Tiger service, `npm run test:postgres` passed against the separate test service, and the readings table has been converted with `npm run db:enable-timescale`.
"Readings are stored in a Tiger Data TimescaleDB hypertable. If the database is unreachable, the app fails explicitly and never falls back to a different store on its own."

**[OPTIONAL · GEMINI · about 15 s]** Gate: an explanation on the demo network returned `origin: "gemini"`.
"Gemini picks and orders sentences from facts the server computed. It can't add claims of its own, and if it fails or times out we show the same facts deterministically."

**[OPTIONAL · HOSTED URL · about 10 s]** Gate: the deployment smoke check passed against the HTTPS URL that day.
"The fictional demo is also hosted at this URL. Real measurements are refused in hosted mode by design."

## If something breaks live

- Check-in past the break window: "Check-ins are only available during a scheduled break." Reset from the supervisor screen and continue.
- Any sponsor integration fails: say "that integration isn't verified in this environment" and continue on the synthetic path.
