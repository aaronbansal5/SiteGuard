# Integrated sidebar and camera access

The Hitayu web app exposes `/fall-detection` in its sidebar. Signed-in workers and supervisors can view a sanitized incident queue. Worker responses omit manager notes, raw track identifiers and bounding boxes. Only supervisors can request `/api/fall-detection/preview`, control capture or update incidents. API role checks occur before contacting the detector.

Set a strong independent `FALL_DETECTION_TOKEN` in the root ignored `.env` and run `npm run fall:camera` from the root. The app API and detector share this backend-only credential. The configured detector denies direct browser access, including the old standalone dashboard and preview URL. Do not use a `VITE_*` environment variable for this token. The service starts with the camera off; use the manager sidebar tab to confirm consent and start capture. Stop Presage first when both would use the same camera.

The preview uses in-memory browser blobs; frames are neither recorded nor persisted. The local service must stay bound to loopback. Hosted deployments disable this local adapter. Source labels and the strict over-two-second width-greater-than-height rule remain visible.

**Identity:** main provides account authentication via OIDC and server-assigned worker/manager roles. Local `AUTH_MODE=demo` still allows demo role selection; it is not production identity. Live camera access requires a current manager session and the adapter is disabled when `HOSTED=true`.

## Previous standalone handoff

# Claude integration handoff

The detector is self-contained. Do not merge its SQLite file into SiteGuard, add native dependencies to npm, or let it contend with the Presage webcam.

## Current local interface

- `GET /api/state`: source, detector status/message, `cameraActive`, `consentAt`, `consentText`, `suppressedRepeats`, anonymous boxes (with rule state) and frame dimensions, all unresolved plus the newest 100 incidents.
- `GET /api/preview`: latest in-memory JPEG while the camera is active; 503 otherwise. No recording. Do not expose publicly.
- `POST /api/camera/start`: `{consent:true}` exactly; camera/recorded_fixture only (409 in synthetic). Capture and inference never start at launch. Idempotent while running.
- `POST /api/camera/stop`: `{}`; stops capture, releases the device and clears the preview. Incidents stay open.
- `GET /api/events`: last 1000 durable observation events, newest first. This is a local inspection/export endpoint, not a reliable replay cursor.
- `POST /api/demo`: `{scenario:"upright"|"horizontal"|"bend"|"missing"}`; synthetic only.
- `POST /api/incidents/:id`: `{action:"acknowledge"|"resolve"|"false_alarm",note:string}`. Closing requires a note. Acknowledging leaves the incident open. Closed incidents cannot be reopened through this endpoint.

All writes require JSON. Local Host/Origin checks reject cross-origin writes. Dashboard uses 127.0.0.1, not localhost. No production authentication is supplied.

Example emitted event:

```json
{
  "protocolVersion": 1,
  "eventId": "UUID",
  "cameraId": "camera-01",
  "zoneId": "demo-zone-a",
  "detectorRunId": "UUID",
  "sequence": 1,
  "trackId": "1",
  "observedAt": "2026-10-10T15:00:01.000Z",
  "kind": "possible_person_down",
  "source": "synthetic",
  "method": "bbox-aspect-v1",
  "durationSeconds": 1.5,
  "evidence": { "heightWidthRatio": 0.3, "region": [0.25, 0.42, 0.47, 0.56] }
}
```

`source` is synthetic/camera/recorded_fixture and never changes during a run. Run ID changes on restart. UTC observedAt is emission time; duration comes from monotonic camera timing or recorded-video cadence. Detector confidence is object detection confidence and is not exported as a fall probability. Track IDs may be reused and cannot identify workers. `evidence.region` is the box normalized to 0–1 frame coordinates (no pixels or media), used to suppress repeats in the same spot. Incidents gain `closedAt` on resolve or false alarm; the local store prunes closed incidents and their events/actions after `--retention-days` (default 30).

## Work still required to integrate

1. Coordinate canonical Zod contract/migration changes with the main app owner. Add dedicated incident/event/action tables in both databases.
2. Implement internal-token-protected ingestion with validation, deduplication by event ID and run/sequence, conflict rejection, bounded retries and a delivery outbox. Current local inspection endpoint alone does not guarantee delivery.
3. Main API owns supervisor authorization, durable actions, audit and revision checks. Do not use this unauthenticated local incident API as the hosted app backend.
4. Supervisor panel labels observations “Possible person down — check scene.” Show camera/zone and source. Camera loss or disappearance must not close an incident.
5. Only explicit human worker association creates/links an assistance request. Acknowledge never resolves it; schedule preview/commit never clears it. Incident closure must not silently close linked assistance.
6. Keep Gemini out of detection/closure decisions and physiological readings separate. Hosted fictional-only mode must reject real-camera ingestion until its policy is deliberately changed.
7. Add security, replay, restart, outage and worker-assistance/planner tests before connecting a live camera. Verify model/runtime/license/camera separately; synthetic success is not hardware or accuracy validation.

See ../../docs/FALL_DETECTION.md for full feature design and acceptance scenarios.
