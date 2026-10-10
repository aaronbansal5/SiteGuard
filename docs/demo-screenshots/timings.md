# Demo rehearsal 2026-10-10T22:21:40.194Z

Target: http://127.0.0.1:3611. "Automation" is click-and-wait time only; the rest of each target is talk time.
Core path (B1–B9) automation total: 65.7 s against a 225 s spoken target.

| Beat | Title                                                        | Script window | Target s | Automation s | Result | Screenshots                                                                                           |
| ---- | ------------------------------------------------------------ | ------------- | -------- | ------------ | ------ | ----------------------------------------------------------------------------------------------------- |
| B1   | Problem (landing page)                                       | 0:00–0:20     | 20       | 0.6          | PASS   | [01-landing.png](01-landing.png)                                                                      |
| B2   | Protected schedule + Integrations (supervisor)               | 0:20–0:35     | 15       | 0.4          | PASS   | [02-supervisor-schedule.png](02-supervisor-schedule.png)                                              |
| B3   | Consent (worker W-01)                                        | 0:35–0:55     | 20       | 0.7          | PASS   | [03-consent.png](03-consent.png)                                                                      |
| B4   | Measurement (60 s real time, not accelerated)                | 0:55–1:55     | 60       | 60.5         | PASS   | [04a-measurement-gap.png](04a-measurement-gap.png) [04b-measurement-60s.png](04b-measurement-60s.png) |
| B5   | Summary + worker-only personal comparison + tiredness rating | 1:55–2:30     | 35       | 0.5          | PASS   | [05a-summary.png](05a-summary.png) [05b-personal-panel.png](05b-personal-panel.png)                   |
| B6   | Request and approval                                         | 2:30–2:55     | 25       | 0.7          | PASS   | [06a-approve-dialog.png](06a-approve-dialog.png) [06b-approved.png](06b-approved.png)                 |
| B7   | Coverage preview and commit                                  | 2:55–3:15     | 20       | 0.4          | PASS   | [07a-proposal.png](07a-proposal.png) [07b-committed.png](07b-committed.png)                           |
| B8   | Human assistance                                             | 3:15–3:35     | 20       | 1.9          | PASS   | [08-assistance.png](08-assistance.png)                                                                |
| B9   | Close                                                        | 3:35–3:45     | 10       | 0.1          | PASS   | [09-close-timeline.png](09-close-timeline.png)                                                        |
| X1   | Worker history (DEMO.md step 7; not in the spoken script)    | —             | —        | 0.3          | PASS   | [10-history.png](10-history.png)                                                                      |
| F1   | Fall detection (standalone, synthetic)                       | optional      | 30       | 11.8         | PASS   | [11a-fall-incident.png](11a-fall-incident.png) [11b-fall-resolved.png](11b-fall-resolved.png)         |

## Checks

### B1 Problem (landing page)

- landing shows 'Local demonstration' badge
- no banned wording on landing

### B2 Protected schedule + Integrations (supervisor)

- Integrations panel visible
- Integrations: Integrations Database Local SQLite Explanations Deterministic only No explanation requested yet Presage camera Not configured
- six fictional workers on the timeline
- six protected 15-minute breaks shown

### B3 Consent (worker W-01)

- sharing with supervisor is off by default
- synthetic source selected

### B4 Measurement (60 s real time, not accelerated)

- 'Synthetic demo' badge
- 'No camera required'
- ≥ 60 one-second readings stored
- invalid segment is readings 20,21,22,23,24 (shown as a gap)

### B5 Summary + worker-only personal comparison + tiredness rating

- pulse and breathing show 'Observed change'
- comparison uses 4 matching synthetic prior sessions
- explanation labeled deterministic
- context line reads 'Heavy workload · 26°C'
- no banned wording on summary
- personal panel labeled experimental + synthetic demo data
- rating saved, then removed by the worker
- supervisor gets 403 for personal insights

### B6 Request and approval

- request approved
- approved rest starts after the protected break (2026-10-10T22:33:21.457Z ≥ 2026-10-10T22:33:21.457Z)

### B7 Coverage preview and commit

- coverage explanation labeled 'Deterministic explanation'
- protected breaks unchanged after commit

### B8 Human assistance

- supervisor sees the symptom label 'Feeling dizzy'
- assistance still unresolved (acknowledged) after commit
- worker has no current or future task assignment
- protected breaks still unchanged

### B9 Close

- approved additional rest drawn on the timeline (2026-10-10T22:33:21.457Z)
- no banned wording on supervisor view
- supervisor view shows no personal panel or rating

### X1 Worker history (DEMO.md step 7; not in the spoken script)

- personal trend shown for synthetic sessions

### F1 Fall detection (standalone, synthetic)

- no 'Camera active' banner in synthetic mode
- exactly one incident raised
- resolve without a note is refused
- incident resolved with a note
- brief bend raises no new incident
