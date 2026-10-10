# Presage bridge contract v1

Application-owned protocol, not a Presage SDK API. Developer 2 maps verified native output.

## Reading

`{timestamp: ISO8601 UTC, heartRateBpm: number|null, respiratoryRateBrpm: number|null, quality: valid|invalid|unknown, source: presage}`.
Rates finite and positive when present. Unknown excluded from analytics. Document SDK validity mapping; numbers alone do not prove validity. When metric validity differs, emit separate readings with other rate null. Capture monotonic-to-UTC mapping; document original SDK timing semantics.

## Transport

Listen on 127.0.0.1:4311; backend calls bridge with Authorization: Bearer PRESAGE_BRIDGE_TOKEN, never browser. Do not accept arbitrary bridge URL from user. Hosted demo cannot access a volunteer's local bridge; real demo runs on same laptop.
GET /v1/health → {protocolVersion:1,source:"presage",status:"ready"|"unavailable",reason:string|null}
POST /v1/sessions {appSessionId:UUID} → 201 {bridgeSessionId:string}
GET /v1/sessions/:id/events?after=sequence → SSE numeric monotonic event IDs.
Data: {type:"reading",reading:VitalReading}, {type:"status",state:"positioning"|"measuring"|"stopped",message:string|null}, {type:"error",code,message,retryable:boolean}.
POST /v1/sessions/:id/stop → {status:"stopped"}, idempotent, releases camera.
One active camera; concurrent start 409. Same appSessionId start returns existing session.
Heartbeat comments every five seconds; replay latest 120 seconds. Expired cursor 409 REPLAY_EXPIRED. Backend reconnect after 1,2,4 seconds; interruption visible. Replay gap requires new session. Sequence deduplicated by backend. Persist before publishing. Stop bridge and drain writes before completion.
Never substitute mock into Presage session. Start failure leaves app session stoppable with insufficient data. Source change starts new session.

## Mock and verification

Mock source uses same control/events; backend seeded one-second readings, explicit invalid/null segments, source=mock. No camera permission required. Preview, if added, cannot imply it generates synthetic readings.
Presage key stays in bridge; no footage through app. Developer 2 documents SDK version, OS, camera, permissions, output/validity mapping, privacy/telemetry and tested start/stop/reconnect. Deliver fixtures and standalone smoke command. Native SDK work is intentionally not implemented by Developer 1.

## Optional local positioning preview

`GET /v1/previews/:appSessionId` uses the same bridge token and loopback/origin restrictions. It returns the latest in-memory JPEG (`image/jpeg`, `Cache-Control: no-store`) or 204 when no fresh frame is available. Preview frames come from the SDK videoOutput callback on the existing capture; no second camera is opened. Frames older than two seconds are unavailable; stop clears the frame. Frames are not persisted, replayed, included in reading events, or sent to Gemini. Packed RGB/BGR/RGBA/BGRA frames are supported; unsupported formats do not affect vitals.

The local app proxies `/api/sessions/:id/preview` for the owning worker only. Supervisors, other workers, synthetic sessions and hosted deployments cannot view the preview. The frontend displays a mirrored frame and positioning guide. The guide does not confirm validity.
