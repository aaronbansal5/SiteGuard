# Standalone SiteGuard possible-person-down demo

Independent of the React/Fastify app, Presage, Tiger Data and Gemini. Python 3.9+; the synthetic demo needs no packages, keys or camera. This implements the reference project's YOLO person detection + persistent tracking + horizontal bounding-box-duration approach. It is an experimental heuristic, not verified fall detection or an emergency monitoring service.

## Run now

From the repository root:

```bash
cd integrations/fall-detection
python3 -m unittest discover -s tests -v
python3 -m fall_detection.server
```

Open **http://127.0.0.1:4322**. Click sustained horizontal, wait at least 1.5 seconds, and review the resulting incident. Acknowledge it, then resolve with a note. Click upright and try brief bend: it should not generate a new alert. Camera missing clears observed boxes but never resolves incidents. Repeat episodes have a ten-second detector cooldown. Metadata persists in `.data/incidents.sqlite`; stop the server before deleting that database to reset.

## Camera / local video

Use a separate environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-camera.txt
python -m fall_detection.server --source camera --camera 0
```

Grant Terminal/Python camera access in macOS settings. First camera run downloads YOLOv8n weights into ignored `.data`. Dependencies/model downloads require internet; inference runs locally. Camera mode shows a live preview through the loopback-only dashboard alongside tracking boxes. Only the latest JPEG is kept in memory; images/video are never recorded. Synthetic mode has no camera access. Use a separate camera from Presage, or stop Presage capture first.

For a consented local video fixture:

```bash
python -m fall_detection.server --source recorded_fixture --video /absolute/path/clip.mp4
```

No synthetic fallback occurs on model/camera failure. Inspect the explicit unavailable status. Recorded fixtures are labeled separately and use video-frame cadence for duration. A live camera with inference gaps above 0.5 seconds resets candidate duration; this may miss incidents on slow hardware. Do not perform a dangerous staged fall to test it. Use fixture clips or harmless tabletop/synthetic tests instead.

## What matches the reference

Reference: https://github.com/rajvratzoom/siteops-final, commit `1ec38502226d6af7073e32644a5363a0738425b4`, particularly `src/fall_detection.py` and `src/main.py`. Method: detect person boxes, retain track IDs, calculate height/width < 1/1.5, and require 1.5 seconds of continuous horizontal observations. Camera tracking uses Ultralytics YOLOv8n and ByteTrack. These parameters are demo defaults, not clinical or operational thresholds.

Original implementation here, without copied reference source. Unlike the reference, first alerts work with timestamps near zero, observation gaps reset candidate timing, repeated episodes work after cooldown, and incidents require explicit human closure. No hardcoded fall confidence, no “recovered” claim when tracking disappears, no facial identity, no media recording, and no sponsor credentials.

The base synthetic workflow and tests are verified separately from optional camera hardware. Camera/model installation, inference accuracy and real-world suitability require their own verification. Check Ultralytics/model licensing before distributing or deploying that optional dependency.

## Claude integration handoff

Read [INTEGRATION.md](INTEGRATION.md). Keep this project outside root npm workspaces. Main application integration is intentionally not implemented. This standalone local dashboard has no user authentication: bind loopback only and do not expose its port publicly.
