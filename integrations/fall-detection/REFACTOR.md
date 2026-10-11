# Independent detection-engine implementation

The refactor changes SiteGuard's Python detection implementation. It does not import the SiteOps UI or change SiteGuard's existing UI, HTTP endpoints, incident records, or model dependencies. Your application can use the engine without the standalone dashboard.

## Integration boundary

Import `Detector` and `Observation` from `fall_detection.detector`. Feed one observation per tracked person into `Detector.update(observations, timestamp, frame_size=(width, height))`. Timestamps must strictly increase. Returned events retain `trackId`, `durationSeconds`, and `evidence` containing `heightWidthRatio` and a normalized `region`.

The caller supplies person detections and persistent anonymous track IDs. `sources.CameraFeed` is the optional YOLO/ByteTrack adapter; a different detector can produce the same observations. There is no facial identification. Independent people have independent temporal state; spatial suppression intentionally prevents repeated reports of the same incident region, including when tracking IDs change.

## Structure

- `geometry.py`: rectangles, posture classification, normalized regions and overlap.
- `policy.py`: validated configuration.
- `tracking.py`: typed per-person temporal state and track lifecycle.
- `regions.py`: scene-level repeat suppression.
- `detector.py`: public facade coordinating those components.
- `sources.py`: synthetic inputs and optional camera/video adapter.
- `runtime.py`: source lifecycle, preview and incident orchestration.
- `server.py`: existing HTTP interface and command-line entry point.

The high-level method remains person detection, persistent tracking, and sustained horizontal bounding-box observations. SiteGuard retains its preceding-upright requirement, confidence/edge/area filters, timing rules, repeat suppression and unresolved-incident behavior. These are experimental heuristics, not validated fall or injury classification.

## Verification and provenance

Run from `integrations/fall-detection`:

```bash
python3 -m unittest discover -s tests -v
python3 scripts/compare_reference.py /path/to/siteops-final
```

For this refactor, all 40 tests passed. The equivalence fixture was generated from SiteGuard's own pre-refactor engine, not from SiteOps source. It covers 24 deterministic scenarios, 12,000 frames and 82 emitted alerts, comparing classifications, emitted events, track state, spatial memory and suppression counts. Camera-adapter tests use mocked dependencies and cover multiple people, confidence values, live/recorded timing, preview sizing and release behavior. Real camera inference accuracy was not revalidated by these tests.

The source comparison inspected SiteOps commit `1ec38502226d6af7073e32644a5363a0738425b4`, comparing 11 application Python files with 15 reference Python files. The longest exact matching run was two lines after whitespace normalization and omission of blank/comment lines. This is a reproducible similarity check, not proof of originality or license compliance. Existing method attribution and dependency licensing notes remain in README.md. No reference source files were added to the application.
