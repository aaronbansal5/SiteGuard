# Source audit — 2026-10-10

Reference inspected: `/Users/gravitbali/siteops-final/src`, clean checkout at commit `1ec38502226d6af7073e32644a5363a0738425b4`.

Scope: all 11 Python runtime files in `fall_detection` versus all 15 Python source files in the supplied directory. This audit excludes third-party packages/model weights, UI, tests and other application features.

## Reproducible findings

- Zero byte-identical runtime files.
- Longest exact matching line run: two lines, after trimming whitespace and excluding blank/comment lines. The two occurrences are `return None` / `try:` and `while True:` / `try:`.
- Zero exact matching token runs of at least 20 tokens, ignoring comments, whitespace and indentation.
- Zero matching full statement subtrees of at least 20 AST nodes after erasing identifier names and literal values. Statement types, operators and tree structure remain significant.
- All 40 behavioral tests passed after the audit.

Run from this directory:

```bash
python3 scripts/compare_reference.py /Users/gravitbali/siteops-final
python3 scripts/audit_source.py /Users/gravitbali/siteops-final/src --output /tmp/siteguard-source-audit.json
python3 -m unittest discover -s tests -v
```

The JSON report includes SHA-256 digests of every inspected file. Checks report evidence rather than automatically making an authorship determination.

## Manual implementation comparison

The reference separates YOLO inference into ObjectDetector and routes detections into supervision ByteTrack through ObjectTracker. SiteGuard uses Ultralytics' tracking API behind CameraFeed and produces application-owned observations.

The reference's FallDetector contains the bounding-box loop, mutable FallState records, cooldown decisions and cleanup in one module. SiteGuard composes Rectangle geometry, DetectionPolicy, TrackHistory, TrackRegistry and RegionRegistry. It additionally requires preceding upright observations, rejects low-confidence/clipped/unsuitable-size boxes, limits gaps, and suppresses duplicate regions and unresolved incidents. Incident persistence and operator resolution are separate from posture observations.

Shared mathematical operations, Python syntax, third-party APIs and the high-level horizontal-duration heuristic are expected similarities. There is no substantive copied passage identified by this audit. The tests establish compatibility with the previous SiteGuard implementation, not independent provenance.

## Limits and attribution

This is not a clean-room implementation: the reference was inspected before implementation/refactoring. Similarity detection cannot prove that copying never occurred or certify absence of plagiarism. Thresholds can miss smaller or extensively transformed passages. No code changes were made merely to hide matches. Existing method attribution and dependency licensing notes remain; this feature must not be represented as an independently invented detection method.
