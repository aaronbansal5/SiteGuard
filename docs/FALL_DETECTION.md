# Possible-person-down feature proposal

Status: a standalone, loopback-only detector prototype exists in `integrations/fall-detection` (see its README and INTEGRATION.md). No ingestion endpoint, contract, migration, or incident UI has been implemented in the SiteGuard app. Keep sponsor integration work separate.

The prototype's camera never starts at launch: the local dashboard shows a monitoring notice and starts capture only after explicit consent (`POST /api/camera/start` with `{"consent": true}`), shows a persistent **Camera active** bar while running, and stops on demand. Closed incidents and their events/actions are pruned after a configurable retention window (default 30 days); free-text notes may contain names and are retained until then.

## Reference implementation findings

Reviewed https://github.com/rajvratzoom/siteops-final at commit `1ec38502226d6af7073e32644a5363a0738425b4`.

- `src/fall_detection.py` computes person-box height/width and flags ratios below `1 / 1.5` (approximately 0.667). After 1.5 seconds it emits an alert for that track. These are demonstration settings, not validated fall criteria.
- `src/main.py` runs this logic only with `--demo-fall`, despite the settings file containing an enabled flag. The F hotkey also synthesizes an alert.
- `src/alerts.py` defaults the event confidence to 1.0; that is not a calibrated fall probability. Timestamps use naive local time. Duration is lost in the emitted event.
- An alerted track is retained until absent from the horizontal set for ten seconds. It cannot produce another alert during that retained period because `alerted` never resets. Disappearance is logged as recovery even though it may mean occlusion or lost tracking.
- At elapsed/video timestamps below ten seconds, the initial cooldown check against zero can delay the first alert beyond the configured minimum.
- `_notify_subscribers` is a stub. The separate FastAPI server has a broadcaster, but the inspected detector path does not connect it; `/status` returns an empty recent-events list.
- Existing alert tests check event logging, not detection accuracy. No license file was found in the inspected checkout. Obtain permission or clarify licensing before copying source or redistributing bundled models; this proposal reuses the architectural idea rather than source code.

## Product behavior

Use the UI label **Possible person down — check scene**. Keep this separate from voluntary Presage pulse/breathing check-ins. Neither Gemini nor vital readings decide whether a fall occurred or an incident is resolved.

A supervisor sees camera/zone, observation time, duration, detector method, source, and connection status. Actions are acknowledge, record scene check, mark false alarm, or resolve with a required note. Acknowledgment never closes the incident. Detection disappearing, a camera outage, upright posture, or a planner run never closes an incident either.

Track IDs are anonymous, camera-local and scoped to a detector run. They are not worker identities. A supervisor may explicitly associate an incident with a worker after checking the scene. Association atomically creates or links an unresolved assistance request, making the existing planner block that worker. An unidentified alert remains a visible zone incident; it cannot safely identify which worker to block.

For the first demo, emit an explicitly synthetic incident without camera access, acknowledge it, associate a fictional worker, demonstrate the assignment block, then explicitly resolve the assistance and incident. Resolving only the incident must not silently resolve linked assistance. No automatic emergency-service messages.

## Boundaries and interface

The detector is an independently owned Python project, outside the npm workspace, with its own environment and dependency lock. It owns capture and inference; the Fastify API owns incident persistence and supervisor actions. Default capture is local processing with no stored or uploaded images/video. Do not reuse the reference recording hotkey or screenshot uploads. Show a consent/monitoring notice before enabling a real camera; the prototype gates capture behind an explicit dashboard confirmation and keeps a visible camera-active indicator.

Licensing: the optional camera path depends on Ultralytics YOLOv8 code and weights, licensed **AGPL-3.0** (or a paid Ultralytics Enterprise License). Distributing the detector, or running a modified version that others use over a network, triggers AGPL source-availability obligations for the combined work. Get legal review or an enterprise license before shipping it beyond local demos or bundling it with SiteGuard.

Do not have the detector and Presage bridge contend for the same webcam. Use distinct cameras or explicitly stop one before starting the other. A hosted app receives events only through an explicitly configured authenticated connection; it must not discover or connect to local cameras automatically.

Proposed internal event, to be finalized in shared Zod contracts:

```json
{
  "protocolVersion": 1,
  "eventId": "UUID",
  "cameraId": "camera-01",
  "zoneId": "demo-zone-a",
  "detectorRunId": "UUID",
  "sequence": 42,
  "trackId": "7",
  "observedAt": "2026-10-10T15:00:01.000Z",
  "kind": "possible_person_down",
  "source": "synthetic",
  "method": "bbox-aspect-v1",
  "durationSeconds": 1.5,
  "evidence": { "heightWidthRatio": 0.6, "region": [0.25, 0.42, 0.47, 0.56] }
}
```

Sources: `synthetic`, `recorded_fixture`, `camera`. No confidence percentage for the aspect-ratio heuristic. No media fields or worker ID in detector events. Separate stream-health events communicate disconnected/degraded states.

Proposed endpoints: internal-token-protected `POST /api/safety/events`, supervisor-only `GET /api/safety/incidents`, and revision-checked `PATCH /api/safety/incidents/:id`. Apply strict validation, finite ranges, timestamp bounds, payload limits, camera allowlist and rate limits. Deduplicate event IDs and run/sequence; conflicting retries return 409. Persist before acknowledging receipt. Add incident/event/action tables through both database migrations. Do not overload physiological readings or protected-break records.

A bounded local delivery spool with retries preserves events during API outages; stable event IDs make retry safe. Show failed delivery explicitly. State must be durable across API restart. Correlate repeated observations into an incident using camera/run/track; do not assume track continuity across detector restarts or reused IDs.

## Detector development

First build a testable state machine fed bounding boxes, confidence and monotonic timestamps, with capture/inference outside it. Require valid boxes and continuity; missing frames must not count toward observed horizontal duration. Separate candidate timing, emitted incident identity, and cooldown state. Reject backward timestamps. Keep detector state changes distinct from human incident resolution.

The prototype adds filters to the reference heuristic: boxes touching the frame edge (2% margin) or outside 0.2–35% of the frame area are ignored; a horizontal phase only counts if the same track was upright (height/width ≥ 1.2) within the preceding 5 seconds; horizontal must then persist 1.5 seconds; and repeats are suppressed when their normalized region overlaps an unresolved incident or a recent (60-second) alert region. On the ultralytics `zidane.jpg` close-up, which previously alerted, these rules produce no incident. They also miss people whose track ID changes mid-transition or who lie at the frame edge.

The reference heuristic can demonstrate event plumbing. Bending, crawling, lying down intentionally, occlusion and camera angle can create misleading boxes. A later pose-based experiment may combine upright-to-horizontal transition, torso orientation, relative vertical movement and sustained posture. Treat those as candidate signals requiring testing, not accuracy improvements already established. Camera configuration and any thresholds must be versioned and documented.

## Ownership and acceptance

1. Main app owner: contracts, migrations, ingestion, incident API, supervisor panel and assistance linkage. Implement on a separate feature branch and coordinate shared-file edits with the sponsor integration team.
2. Camera owner: independent detector, camera permissions, synthetic/fixture/live sources, delivery spool, health, versioned method and timing. Do not change Presage SDK files.
3. Independent reviewer: contract/replay/security tests and end-to-end incident/assistance/planner invariants; review privacy and labels.

Tests must cover upright, sustained horizontal, transient bending, malformed boxes, frame gaps, tracking loss, ID reuse, a second episode, early timestamps, cooldown, backward clock, duplicate/conflicting events, lost delivery, restart, unauthorized ingestion, acknowledgment versus resolution, unknown-person association, linked assistance persistence, stale revisions, and protected-break invariance.

Run fixture-based evaluation across positive and negative clips and report false alerts/misses, observation duration and configuration. Label recorded clips separately from live capture. Do not ask anyone to stage a dangerous fall. Hardware verification is a separate gate. Synthetic workflow success does not establish real-world fall detection accuracy.

Ship order: synthetic incident workflow -> fixture detector/state-machine tests -> authenticated live event transport -> observed camera demo -> broader evaluation. Preserve the existing worker-break demonstration throughout.
