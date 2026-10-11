## Integrated Scene monitoring (local main)

Run the app normally, then `npm run fall:camera` from the repository root using
Node 24. Set independent `FALL_DETECTION_TOKEN` (32+ characters) and
`MEASUREMENT_TOKEN` (16+ characters) in the ignored root `.env`. The helper loads
these server-only credentials and forwards event metadata to the loopback API
at `http://127.0.0.1:${PORT:-3001}`. Native camera prerequisites remain in
`integrations/fall-detection/README.md`.

Signed-in workers and managers open **Fall detection** in the sidebar. Managers
can start/stop the camera and see its live preview with anonymous tracking boxes.
Workers see shared incident status without frames, tracking coordinates, worker
associations, or manager notes. A valid wider-than-tall person box must persist
continuously for **more than two seconds** to generate a possible-person-down
observation; this does not confirm a fall or injury.

The Scene review queue reads `safety_incidents` in the configured application
database (PostgreSQL/Tiger Data or explicitly enabled rehearsal SQLite). Local
SQLite is a durable detector outbox, not the shared queue. Failed delivery remains
pending and retries; the UI reports missing configuration or pending delivery.
Stored application reports remain visible if the detector is offline. Manager
review actions use revision-checked, audited `/api/safety/incidents/:id` updates.
The detector synchronizes those explicit decisions back into its local duplicate
suppression cache. Incident closure never resolves linked assistance requests.
Frames are transient in memory; no camera footage is written to the database.
The local bridge is disabled in hosted mode; a remote camera deployment needs a
separate authenticated ingest/camera architecture.
