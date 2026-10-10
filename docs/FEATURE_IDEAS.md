# Feature ideas: what to build next

Branch `feature/feature-ideas`, 2026-10-10. This is a proposal list, not a status report. Only **A1** is implemented (on this branch, with tests). Every other idea is unbuilt and unverified. Sponsor tie-ins describe how an idea _would_ use Presage, Tiger Data or Gemini. They are not evidence that those integrations work (see `docs/READINESS_REPORT.md` for that).

Each idea was checked against the invariants in `AGENTS.md` and `docs/PROJECT_SPEC.md`: no diagnosis, medical clearance, fatigue/risk/safety score or medically optimal rest; physiology is worker-only unless the worker shares a session; consent first; protected breaks cannot move or shrink; unresolved assistance is never cleared by scheduling or acknowledgment; synthetic data is always labeled. Where an idea needs a spec or contract **addition**, it says so. None of them needs an invariant relaxed. If one appears to, it is out of scope.

## Sources

| Key            | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[osha-fs]`    | OSHA, _Heat Injury and Illness Prevention_ proposed-rule fact sheet. Initial trigger at 80 °F heat index: water, cooled break areas, acclimatization, paid rest breaks when needed, "regular, effective two-way communication". High trigger at 90 °F: "rest breaks of 15 minutes at least every two hours", observation for signs and symptoms, a hazard alert. https://www.osha.gov/sites/default/files/publications/heat-rulemaking-factsheet.pdf           |
| `[osha-rm]`    | OSHA heat rulemaking page (NPRM published 2024-08-30). https://www.osha.gov/heat-exposure/rulemaking                                                                                                                                                                                                                                                                                                                                                           |
| `[od-2026]`    | Ogletree Deakins, "OSHA's Heat Program to Expire While Heat Standard Stalls", 2026-04-08. The National Emphasis Program was set to expire on 2026-04-08. The proposed standard "has stalled with no target date for finalization" but has not been withdrawn. State standards (for example CA, WA and CO) are unaffected. https://ogletree.com/insights-resources/blog-posts/oshas-heat-program-to-expire-while-heat-standard-stalls/                          |
| `[niosh-rec]`  | NIOSH heat-stress workplace recommendations: "drink 1 cup (8 oz.) of water every 15–20 minutes" for moderate activity under 2 hours, "Use a buddy system", "Permit rest and water breaks when a worker feels heat discomfort", and "Use a heat alert program whenever the weather service forecasts a heat wave". https://www.cdc.gov/niosh/heat-stress/recommendations/index.html                                                                             |
| `[niosh-acc]`  | NIOSH acclimatization: new workers "no more than a 20% exposure on day 1 and an increase of no more than 20% on each additional day". Returning workers: 50/60/80/100 %. https://www.cdc.gov/niosh/heat-stress/recommendations/acclimatization.html                                                                                                                                                                                                            |
| `[heat-app]`   | OSHA-NIOSH Heat Safety Tool app: hourly heat-index forecast with precautions, Spanish available, "not receiving updates at this time". https://www.cdc.gov/niosh/heat-stress/communication-resources/app.html                                                                                                                                                                                                                                                  |
| `[nws-hi]`     | NWS Weather Prediction Center, heat index equation (Rothfusz regression and adjustments). https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml                                                                                                                                                                                                                                                                                                          |
| `[nws-hr]`     | NWS HeatRisk fact sheet: a 0–4 area forecast that accounts for how unusual the heat is, its duration and overnight relief. https://www.weather.gov/media/tbw/heat/NWS%20HeatRisk%20Fact%20Sheet.pdf                                                                                                                                                                                                                                                            |
| `[mmwr-hr]`    | CDC MMWR 74(18), 2025-05-22: in New York (outside NYC), higher HeatRisk levels corresponded with higher heat-related ED visit rates. https://www.cdc.gov/mmwr/volumes/74/wr/mm7418a2.htm                                                                                                                                                                                                                                                                       |
| `[eeoc]`       | EEOC, _Wearables in the Workplace_ fact sheet (Dec 2024). Wearables that measure physical condition may be ADA "medical examinations". Collection is allowed when it is "voluntary and part of an employee health program". The data must be kept confidential and separate. It warns about disparate treatment and impact, and about retaliatory monitoring. https://www.eeoc.gov/sites/default/files/2024-12/Wearables_Fact_Sheet_V10_%28002%29_508FINAL.pdf |
| `[bipa]`       | Hinshaw & Culbertson, _Employer's Guide to the Illinois BIPA_ (2019): a public written retention policy, informed written consent, and destruction when the purpose is satisfied. "Face geometry" scans are covered. https://www.hinshawlaw.com/en/insights/insights-for-employers-alert/employers-guide-to-the-illinois-biometric-information-privacy-act                                                                                                     |
| `[cdt]`        | CDT, _Warning: Bossware May Be Hazardous to Your Health_ (2021). Constant monitoring removes "micro rests" and raises job strain. https://cdt.org/wp-content/uploads/2021/07/2021-07-29-Warning-Bossware-May-Be-Hazardous-To-Your-Health-Final.pdf                                                                                                                                                                                                             |
| `[cpwr]`       | Safety+Health, 2025-01-31, on CPWR data. Hispanic workers were 34 % of the construction workforce in 2023. Hispanic construction deaths rose 107 % from 2011 to 2022. CPWR cites language barriers and a lack of Spanish-language training as possible causes. https://safetyandhealthmagazine.com/articles/26416-report-details-surge-in-hispanic-construction-worker-deaths                                                                                  |
| `[mmwr-sui]`   | CDC MMWR 72(50), 2023-12-15. Men in construction and extraction occupations had a suicide rate of 65.6 per 100,000 in 2021, the highest of any major occupation group for men. https://www.cdc.gov/mmwr/volumes/72/wr/pdfs/mm7250a2-H.pdf                                                                                                                                                                                                                      |
| `[kenzen]`     | For Construction Pros, Kenzen product page: an arm patch estimates core temperature; supervisors get alerts on a web dashboard; a "back to work" alert fires when the estimate returns to a safe level. https://www.forconstructionpros.com/business/construction-safety/product/21132231/kenzen-realtime-body-heat-monitoring-system                                                                                                                          |
| `[open-meteo]` | Open-Meteo forecast API: hourly `temperature_2m`, `relative_humidity_2m` and `apparent_temperature`. No key for non-commercial use; commercial use needs a key. https://open-meteo.com/en/docs                                                                                                                                                                                                                                                                 |
| `[tiger-ret]`  | Tiger Data `add_retention_policy`. https://www.tigerdata.com/docs/api/latest/data-retention/add_retention_policy/ and continuous-aggregate policies https://www.tigerdata.com/docs/api/latest/continuous-aggregates/add_continuous_aggregate_policy/                                                                                                                                                                                                           |
| `[gemini-so]`  | Gemini API structured output (response schema). https://ai.google.dev/gemini-api/docs/structured-output                                                                                                                                                                                                                                                                                                                                                        |
| `[presage]`    | `docs/PRESAGE_OPPORTUNITIES.md` (vendor docs and SDK 3.4.0 type declarations, cited there)                                                                                                                                                                                                                                                                                                                                                                     |

**Why this matters now.** The federal heat standard is proposed but stalled `[od-2026]`, and the heat NEP was set to expire in April 2026. Many sites will run heat programs voluntarily or under state rules. A tool that makes rest, water, observation and two-way communication easy to run, and easy to prove, fills that gap `[osha-fs]` `[niosh-rec]`. The main commercial alternative streams worker physiology to supervisors and issues "back to work" alerts `[kenzen]`. SiteGuard is designed the other way round: physiology stays with the worker, and the supervisor coordinates rest. These ideas build on that difference.

Effort: **S** ≤ ½ day, **M** ≈ 1 day, **L** > 1 day, for one developer with an agent. Demo impact: 1–5.

---

## A. Worker experience

### A1. "What safety operations can see" + stop sharing — **IMPLEMENTED on this branch**

- **What.** A card on the worker portal mirrors, live, every record about this worker that the supervisor workspace receives: breaks, assignments, requests with supervisor notes, symptom reports, and the check-ins they shared. It also lists what supervisors never receive. Each shared check-in has a **Stop sharing** button. Withdrawing sharing ends supervisor access to the readings, summary, live stream and explanation for that check-in.
- **Why.** The EEOC treats physiological wearables data as confidential medical information that may be collected only under narrow conditions, such as a voluntary program `[eeoc]`. BIPA-style law expects a stated purpose, consent and destruction `[bipa]`. Surveillance without transparency erodes rest and raises strain `[cdt]`. Workers can _verify_ the privacy claim instead of trusting it, and they can take consent back.
- **Invariants.** It adds no new exposure; the worker sees only their own records. Supervisors get 403 on the mirror. Withdrawal only narrows access. Requests, symptom reports, protected breaks and the assistance staffing block are untouched (tested). Granting sharing after the fact is rejected (400), because consent belongs on the versioned consent screen. The worker action is audited.
- **Sponsors.** None directly. It works with Tiger Data storage unchanged.
- **Effort / impact.** S / 4.
- **Implementation (done).** `packages/contracts/src/privacy.ts` (schemas, `SUPERVISOR_NEVER_SEES`), `apps/api/src/routes.ts` (`supervisorOverview()` shared by both views, `GET /api/workers/:id/supervisor-view`, `PATCH /api/sessions/:id/sharing`, SSE heartbeat ends supervisor streams with `SHARING_WITHDRAWN`), `apps/api/src/domain/requests.ts` (audit actor), `apps/web/src/components/SupervisorMirror.tsx` on `WorkerHome.tsx`, `apps/web/src/lib/session-stream.ts`, `docs/API_CONTRACT.md`. Tests: `apps/api/test/supervisor-view.test.ts` (6) and `tests/integration/supervisor-view.spec.ts` (browser and axe).

### A2. "Before you head back" prompt

- **What.** In the last 2 minutes of a protected break, the worker portal shows a gentle, optional prompt: "Anything feel off? Dizzy · Nauseated · Headache · Other · I'm fine". Any symptom tap goes into the existing symptom → assistance workflow. "I'm fine" records nothing.
- **Why.** The proposed rule's high-heat tier requires observing for signs and symptoms `[osha-fs]`. NIOSH recommends worker self-monitoring and rest when a worker feels discomfort `[niosh-rec]`. One tap at the moment of return is the cheapest observation there is.
- **Invariants.** It is not clearance. The copy never says "cleared" or "ready". "I'm fine" is not stored, so it can't become a de facto fitness record. Symptoms stay independent of vitals.
- **Sponsors.** None.
- **Effort / impact.** S / 3.
- **Sketch.** `apps/web/src/pages/WorkerHome.tsx`: when `br` ends within 120 s, render a prompt that reuses `HelpActions`' symptom path (`apps/web/src/components/ui.tsx`) with preset codes. No API change.

### A3. Break-time cool-down companion

- **What.** During a protected break, a worker-only panel offers NIOSH's plain guidance ("about 1 cup of water every 15–20 minutes", shade and cool areas) and an optional "I had water" tap that stays on the worker's device.
- **Why.** `[niosh-rec]` hydration and rest guidance. It makes the break useful even for a worker who doesn't want a measurement.
- **Invariants.** Guidance is attributed to NIOSH, not presented as a personal prescription. Taps are kept in `localStorage` only and never sent. It doesn't change the duration of any break.
- **Sponsors.** Optional Presage: shown as a "while you rest" alternative to the check-in, never a requirement.
- **Effort / impact.** S / 3.
- **Sketch.** New `apps/web/src/components/CoolDown.tsx` in `WorkerHome.tsx`'s break hero. Strings sit beside the existing `SafetyNote`.

### A4. Support beyond the shift (static resources)

- **What.** A "Support" link in the worker portal with 988 (Suicide & Crisis Lifeline), the site EAP (configurable) and how to ask for human assistance now. It asks no questions and records nothing.
- **Why.** Men in construction and extraction occupations have the highest suicide rate of any major occupation group `[mmwr-sui]`.
- **Invariants.** There is no screening, inference or score, and no data. It is not connected to vitals in any way. That separation keeps it ethical. Get copy reviewed by someone qualified before shipping.
- **Effort / impact.** S / 2. Its value is real but it should not be used as a demo prop.
- **Sketch.** Static section in `apps/web/src/pages/WorkerHome.tsx`. The EAP text comes from config through `/api/health` or a new `/api/site` read-only endpoint.

## B. Supervisor coordination without physiology

### B1. Heat-day protective break template

- **What.** A supervisor picks a site-policy template, for example "High-heat day: add a 15-minute protected break at least every 2 hours" (mirroring the proposed OSHA high-heat tier `[osha-fs]`). The server **adds** protected breaks for the selected workers, and then the existing planner re-covers tasks around them. A preview shows the new breaks and the resulting coverage gaps before commit.
- **Why.** It turns the most concrete requirement in the proposed rule into one click. It also shows that the planner keeps rest fixed and lets coverage absorb the cost.
- **Invariants.** It only adds rest. Added protected breaks are immutable like all others, so a mistaken template can't be undone by deleting breaks. That is why preview comes first. Labels must say "Fictional site policy modelled on the proposed OSHA rule. Not legal guidance." **Spec addition:** `POST /api/breaks` (supervisor, protected, revision-checked) in `docs/API_CONTRACT.md`. No invariant changes.
- **Sponsors.** Gemini explains the resulting schedule change from server facts (existing `/insights/explain` schedule path).
- **Effort / impact.** M / 5.
- **Sketch.** `packages/contracts/src/api.ts`: add `BreakTemplateSchema {workerIds, everyMinutes, durationMinutes, from, to, baseRevision}`. In `apps/api/src/domain/scheduling.ts`, a pure `templateBreaks(schedule, template)` skips intervals that overlap existing breaks or approved rest and returns new `Break[]`. Unit tests go in `apps/api/test/scheduling.test.ts`. Route in `routes.ts` with `tx.bump()` and an `audit` call. UI goes in the "Coverage coordination" card in `apps/web/src/pages/Supervisor.tsx`.

### B2. Open-assistance clock and second-responder escalation

- **What.** Each open assistance request shows "open 7 min · acknowledged 4 min ago by …". After a site-configured interval with no resolution, the card turns into a prominent banner, "Still open: needs a person on scene", that names a configured second responder. It never closes anything.
- **Why.** The proposed rule requires regular two-way communication and observation `[osha-fs]`. Acknowledged-but-unattended is the failure mode the invariant guards against. The clock makes it visible.
- **Invariants.** It is display only. Escalation is a UI state; resolution still needs an explicit note. A clock is not a score. **Contract addition (optional):** `acknowledgedAt` on `RequestSchema`, or derive it from `audit_events`.
- **Sponsors.** None.
- **Effort / impact.** S / 4.
- **Sketch.** `apps/web/src/pages/Supervisor.tsx` request cards: a 1 s ticker from `r.createdAt`. Acknowledgment time comes from a new optional field set in the PATCH handler in `routes.ts`. The escalation minutes come from config (fictional default 10).

### B3. Shift handover brief

- **What.** The end-of-shift brief covers open and resolved requests, approved additional rest, coverage gaps, and protected breaks preserved. Gemini chooses wording from server facts only, with a deterministic fallback.
- **Why.** Handover is where unresolved assistance gets lost. `[niosh-rec]` recommends that supervisors be trained in monitoring and encouraging rest.
- **Invariants.** No physiology, names or symptom notes go to Gemini. This matches the existing `Explainer` fact-ID pattern. Unresolved requests are listed first and can't be summarized away.
- **Sponsors.** **Gemini** structured output `[gemini-so]`.
- **Effort / impact.** S–M / 3.
- **Sketch.** Add a `{kind:"handover"}` branch to `ExplainSchema` in `packages/contracts/src/api.ts`. Build the facts in `apps/api/src/insights/explain.ts` from `tx.schedule()` and `audit_events`. Add a "Handover" button in `Supervisor.tsx`.

## C. Environment and heat context

### C1. Site heat context strip

- **What.** A band at the top of the supervisor workspace shows the site's hourly forecast heat index for the shift and marks the hours that reach 80 °F and 90 °F, the proposed OSHA trigger levels `[osha-fs]`. It links to the official NWS HeatRisk for the area `[nws-hr]`. The worker check-in pre-fills "Temperature (°C)" from the current hour, and the worker can edit it.
- **Why.** NIOSH says to run a heat alert program when a heat wave is forecast `[niosh-rec]`. HeatRisk levels track heat-illness ED visits `[mmwr-hr]`. The OSHA-NIOSH app does this per phone but is no longer being updated `[heat-app]`. Pre-filling temperature also makes the existing context-band comparison (`PROJECT_SPEC` Analytics) fill in more often.
- **Invariants.** It is about the site, never about a person. It isn't joined to any worker record and isn't used by the planner except through a supervisor-chosen template (B1). It is labeled "forecast · not a measurement of anyone". If the weather fetch fails, the strip says "unavailable", and nothing is substituted.
- **Sponsors.** Gemini can state the "why" for B1 ("90 °F heat index forecast from 13:00"). **Tiger Data** can store forecasts in a small hypertable for after-the-fact review.
- **Effort / impact.** M / 5.
- **Sketch.** `apps/api/src/domain/heat.ts`: a pure `heatIndexF(tF, rh)` implementing the NWS Rothfusz regression with both adjustments `[nws-hi]`, unit-tested against WPC values. `apps/api/src/insights/weather.ts`: Open-Meteo adapter `[open-meteo]`, server-side, with a 10 s deadline and a fixture mode for tests (like `gemini-adapter.test.ts`). Config `SITE_LAT/SITE_LON`; commercial deployment needs an Open-Meteo key. Route `GET /api/site/conditions`. UI in `Supervisor.tsx`, pre-fill in `apps/web/src/pages/CheckIn.tsx`.

### C2. Acclimatization-aware coverage

- **What.** The site records a worker's heat-work start or return date. On hot days the planner caps heat-exposed task minutes for new workers following NIOSH's schedule (20 % on day 1, rising 20 % per day; returning workers 50/60/80/100 %) `[niosh-acc]`.
- **Why.** Acclimatization is one of the clearest prevention levers, and it appears in the proposed rule `[osha-fs]`.
- **Invariants.** It is based on tenure, not physiology, and applies the same way to everyone (EEOC disparate-treatment concern `[eeoc]`). It can only reduce exposure, never rest. **Spec change:** a new scheduling constraint and a new worker attribute in `PROJECT_SPEC` "Protected scheduling" and the `Worker` model. Unfillable minutes remain explicit gaps.
- **Sponsors.** Gemini explanation of the gaps.
- **Effort / impact.** M–L / 4.
- **Sketch.** `packages/contracts/src/models.ts`: `Worker.heatStartDate?`. In `apps/api/src/domain/scheduling.ts`, add an `exposureCap(worker, day)` check in `validateAssignments` and in the greedy chooser. Add tests next to the existing overlap and unavailable-worker cases.

## D. Team and crew

### D1. Buddy pairs

- **What.** The supervisor pairs workers. When a worker requests assistance, their buddy's portal shows "Your buddy W-03 asked for help · last known task: Material handling". No vitals, no symptom codes.
- **Why.** "Use a buddy system where workers observe each other" `[niosh-rec]`.
- **Invariants.** A buddy sees request _existence and status_ only. It is opt-in for both workers. **Spec addition:** a buddy visibility rule in `PROJECT_SPEC` Design and a new endpoint. Acknowledgment by a buddy never changes request status.
- **Effort / impact.** M / 4.
- **Sketch.** A `buddies` table in both migration folders (`apps/api/src/db/migrations/{sqlite,postgres}`). `GET /api/workers/:id/buddy-alerts`, worker-only. A card in `WorkerHome.tsx`.

### D2. Break-area condition reports

- **What.** One tap from any worker: "Water out", "No shade or cooling", "Break area unsafe", optionally anonymous. Reports go into a supervisor queue with the same acknowledge and resolve-with-note flow as requests.
- **Why.** The proposed rule's first tier is about water and cooled break areas `[osha-fs]`. When a break area fails, rest fails, and it is about the site, not a person.
- **Invariants.** Anonymous reports carry no worker ID, so they can't create a staffing block. Resolution needs a note. **Spec addition:** a `SiteConditionReport` model and endpoints.
- **Effort / impact.** S–M / 4.
- **Sketch.** Contracts in `packages/contracts/src/models.ts`, routes like `/api/symptom-reports` in `routes.ts`, a queue section in `Supervisor.tsx`, and a button in `HelpActions` (`ui.tsx`).

### D3. "Rest was honored" ledger

- **What.** A read-only page shows each protected break today, its revision history (always 0 changes), and for every committed schedule that no assignment overlapped it. Workers see their own breaks; supervisors see everyone's.
- **Why.** It turns "breaks stay protected" from a promise into an auditable record, which answers the "monitoring removes micro-rests" problem `[cdt]` directly.
- **Invariants.** Read-only. It uses `validateAssignments` (`apps/api/src/domain/scheduling.ts`) on stored `audit_events` snapshots.
- **Sponsors.** **Tiger Data**: make `audit_events` a hypertable and query by time range.
- **Effort / impact.** S / 4.
- **Sketch.** `GET /api/breaks/ledger` in `routes.ts` replays `schedule_commit` audit `after.assignments` against breaks. Page `apps/web/src/pages/Ledger.tsx` and a route in `App.tsx`.

## E. Accessibility and languages

### E1. Spanish worker portal

- **What.** The worker paths (home, consent, check-in, measurement, summary, help dialogs) in Spanish, using a language switch that is remembered per device.
- **Why.** About a third of construction workers are Hispanic, their deaths doubled over 2011–2022, and CPWR cites language barriers `[cpwr]`. The OSHA-NIOSH app also offers Spanish `[heat-app]`.
- **Invariants.** Consent and safety copy must be **human-reviewed** translations stored in the repository. Never machine-translate consent at runtime. The consent version should include the language (`v1-es`). **Contract change:** widen `consentVersion` from `z.literal("v1")` in `packages/contracts/src/models.ts` and `api.ts`.
- **Sponsors.** Gemini can _draft_ strings offline for a bilingual reviewer. Never at runtime.
- **Effort / impact.** M / 4.
- **Sketch.** `apps/web/src/lib/i18n.ts` (a plain dictionary, no new dependency), strings pulled out of `CheckIn.tsx`, `WorkerHome.tsx` and `ui.tsx`, and an axe run on the Spanish pages in `tests/integration/accessibility.spec.ts`.

### E2. Hands-free, glove- and sun-friendly check-in

- **What.** Spoken prompts during the check-in ("hold still", "please stay quiet: talking affects breathing readings"), 56 px minimum targets, and a high-contrast outdoor theme.
- **Why.** Presage says talking invalidates breathing rate, and that face detection and stillness matter `[presage]` (R2 and R4). Gloves and glare are everyday conditions on site.
- **Invariants.** These are data-quality prompts only. Talking detection is never stored or shown as a trait `[presage]` R4. Speech uses the browser's `speechSynthesis`, with no audio recorded.
- **Sponsors.** **Presage** `validationStatus` guidance (already mapped on `feature/presage-timing`).
- **Effort / impact.** S–M / 3.
- **Sketch.** `apps/web/src/pages/Measurement.tsx`: speak on status transitions from `useSessionStream`, behind a toggle that respects `prefers-reduced-motion`. Theme tokens in `styles.css`.

## F. Data and ML

### F1. Data minimization on Tiger Data

- **What.** A retention policy on raw `vital_readings` (for example 90 days, matching `PERSONAL_MODEL.baselineMaxAgeDays`), plus a continuous aggregate that keeps only per-session window medians. A worker's "Delete my check-ins" removes their own sessions.
- **Why.** Retention, destruction and purpose limits are core expectations for biometric-adjacent data `[bipa]` `[eeoc]`. Tiger Data provides them natively `[tiger-ret]`.
- **Invariants.** Deletion must refuse while any linked request is unresolved, or unlink it while keeping the request, so assistance is never cleared. Summaries recomputed from aggregates must use the same window rules as `apps/api/src/domain/analytics.ts`.
- **Sponsors.** **Tiger Data** (retention policy and continuous aggregates). This is the strongest "used the sponsor deeply" story.
- **Effort / impact.** M / 3.
- **Sketch.** `apps/api/src/db/migrations/postgres/004_retention.sql` (`add_retention_policy('vital_readings', INTERVAL '90 days')`), a SQLite equivalent as a scheduled delete in `apps/api/src/db/sqlite.ts`, `DELETE /api/workers/:id/sessions` (worker-only), and a check in `apps/api/src/db/verify.ts`.

### F2. HRV as a worker-only personal trend

- **What.** RMSSD and SDNN deltas in the existing personal baseline and trend, for real Presage sessions only.
- **Why / invariants / sketch.** Covered in `docs/PRESAGE_OPPORTUNITIES.md` R3. Never the Baevsky "stress index". Worker-only, like `docs/RECOVERY_MODEL.md`.
- **Sponsors.** **Presage**.
- **Effort / impact.** M / 2. Little demo value until real Presage readings are verified.

## G. Integrations

### G1. Request-status notifications

- **What.** Web Push (or SMS through a provider) to the worker when their request is acknowledged, approved or resolved.
- **Why.** Two-way communication `[osha-fs]`. Workers away from the tablet still get answers.
- **Invariants.** The payload carries status only, with no physiology or symptom codes. Notifications are opt-in.
- **Effort / impact.** M / 3.
- **Sketch.** A service worker in `apps/web/public`, a VAPID key server-side only (`apps/api/src/config.ts`), and a send call in the PATCH `/api/rest-requests/:id` handler after commit.

### G2. Synthetic possible-person-down → assistance linkage

- **What.** The incident workflow already specified in `docs/FALL_DETECTION.md`: a synthetic incident is acknowledged, then associated with a worker, which creates an unresolved assistance request and blocks staffing; then it is explicitly resolved.
- **Invariants.** As specified there. Acknowledgment never closes the incident, and resolving the incident never resolves linked assistance.
- **Effort / impact.** L / 5. High impact, but it crosses ownership boundaries, and live camera mode is not ready.

## H. Website, landing page and demo

### H1. "Try to break it" invariant console

- **What.** A judge-facing page with buttons that make **real API calls** and show the receipts:
  - shorten a protected break → `409`;
  - commit a stale schedule → `409 STALE_REVISION`;
  - acknowledge assistance, then plan coverage → the worker is still blocked;
  - supervisor opens personal insights → `403`;
  - ingest readings without the internal token → `401`;
  - supervisor opens a check-in whose sharing was withdrawn (A1) → `403`.
- **Why.** Judges can't verify slides, but they can click. Every safety claim in `docs/PRESENTATION_SCRIPT.md` becomes something you can test live.
- **Invariants.** Fictional demo only. Disabled when `hosted` or not in demo mode, like `/demo/reset`. It runs the same endpoints and adds no bypass.
- **Sponsors.** None, but it makes the honesty story concrete.
- **Effort / impact.** S / 5.
- **Sketch.** `apps/web/src/pages/Proof.tsx` with a list of `{label, run: () => api(...), expect: status}`. It logs in through `/api/demo/login` for each step's role and resets first. Route in `App.tsx`, link from `Landing.tsx`. A Playwright spec asserts each receipt.

### H2. Public data card

- **What.** A one-page "What we collect, who sees it, how long we keep it, and what it can't tell you", including the Presage model-card limits (operating ranges, warm-up, no apnea monitoring) and the contrast with supervisor-facing wearables `[kenzen]`.
- **Why.** Notice and purpose statements are what BIPA and the EEOC expect `[bipa]` `[eeoc]`. It doubles as landing-page content.
- **Effort / impact.** S / 3.
- **Sketch.** `apps/web/src/pages/DataCard.tsx`, generated from `SUPERVISOR_NEVER_SEES` and `PERSONAL_MODEL` constants so it can't drift from the code.

---

## Ranked: build next (A1 is done)

1. **H1 "Try to break it" console** (S, 5). The highest demo impact per hour. Every invariant becomes a live receipt, and it reuses the existing endpoints.
2. **C1 Site heat context strip** (M, 5). It ties the product to the 2026 heat-rule moment `[od-2026]` `[osha-fs]` without touching physiology. The pure heat-index function is easy to test.
3. **B1 Heat-day protective break template** (M, 5). Paired with C1 it gives one heat story: forecast, then one click to add rest, then coverage adapts while breaks stay fixed.
4. **B2 Open-assistance clock and escalation** (S, 4). It strengthens the "unresolved assistance is never cleared" invariant with time, at almost no risk.
5. **E1 Spanish worker portal** (M, 4). It reaches the workers most affected `[cpwr]`. Scope it to the worker paths and have consent strings reviewed.

Why A1 was implemented first instead of H1: H1 mostly demonstrates guarantees that already exist. A1 adds a new worker right (seeing and withdrawing what a supervisor can access) with new API surface and new invariants to test. That makes it the best S-effort item on product value, ethics and testability together. H1 should demo A1's withdrawal as one of its receipts.

## Two-day plan

**Day 1**

- Morning: **H1** console plus its Playwright spec. Add a "Proof" beat to `docs/PRESENTATION_SCRIPT.md` (Developer 4).
- Afternoon: **B2** clock and escalation (UI plus the optional `acknowledgedAt`). Start **C1** server side: `heat.ts` with WPC test vectors, the Open-Meteo adapter with fixture tests, and `GET /api/site/conditions`.
- End of day: run typecheck, test, build, prettier and e2e. Update `docs/READINESS_REPORT.md`, marking C1 "fixture-only" until a live fetch from the demo network succeeds.

**Day 2**

- Morning: **C1** UI (supervisor strip, check-in pre-fill). **B1** template: a pure `templateBreaks` with tests (overlaps, approved rest, unavailable workers, immutability), then the route, preview UI and an explanation through the existing Gemini path.
- Afternoon: **E1** for the worker paths only (dictionary, `consentVersion` widening, axe on Spanish pages). Rehearse the full script with the new heat beat.
- Gates: show C1 live only after a real forecast fetch on the demo network. Otherwise use the labeled fixture. B1 labels must say "fictional site policy modelled on a proposed rule, not legal guidance".
