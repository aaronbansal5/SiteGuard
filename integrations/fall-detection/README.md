# Standalone SiteGuard possible-person-down demo

Independent of the React/Fastify app, Presage, Tiger Data and Gemini. The synthetic demo needs no packages, keys or camera. This implements the reference project's YOLO person detection + persistent tracking + horizontal bounding-box-duration approach, with extra filters described below. It is an experimental heuristic, not verified fall detection or an emergency monitoring service.

## Current local test rule

The running standalone dashboard uses **bounding-box width > height** and creates a possible-person-down report only after continuous eligible observations for **more than two seconds**. Exactly two seconds does not alert. Missing observations, long gaps or a non-horizontal pose reset the dwell timer. No preceding-upright observation is required in this mode. Confidence, edge and area filters still apply, as do duplicate-region and unresolved-incident suppression. A wider box is a review heuristic, not confirmation that someone fell.

New incidents pulse a red screen border and show a ten-second alert banner. Reduced-motion users get a static border. Existing reports do not flash again on refresh. Detection times are captured when the observation frame is processed, stored in UTC and displayed in America/New_York with the timezone shown. The original configurable sustained-transition engine remains available to callers of Detector; the standalone Runtime explicitly selects the strict two-second dwell rule.

## Supported Python

| Part                                 | Supported versions | Verified for this change                                                                                                                                 |
| ------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Synthetic demo + unit tests (stdlib) | CPython 3.9–3.13   | `python -m unittest discover -s tests` passed on 3.9.25, 3.11, 3.12 and 3.13.16                                                                          |
| Camera / recorded video (`.venv`)    | CPython 3.9–3.13   | Runtime and `pytest` on 3.13.16 (Linux x86_64, CPU). `requirements-camera.txt` resolves to binary wheels on 3.9–3.13; 3.9–3.12 camera runtime not re-run |

`requirements-camera.txt` holds compatible ranges. Exact pins per interpreter: `requirements-camera.py39.lock.txt` (Python 3.9 only; numpy 2.0.2 has no 3.13 wheels) and `requirements-camera.py313.lock.txt` (Python 3.13, the verified venv).

## Run now

From the repository root:

```bash
cd integrations/fall-detection
python3 -m unittest discover -s tests -v
python3 -m fall_detection.server
```

Open **http://127.0.0.1:4322**. Click standing upright, then horizontal pose, hold for over two seconds and review the resulting incident. Acknowledge it, then resolve with a note. A brief bend lasting at most two seconds does not alert. Camera missing clears observed boxes but never resolves incidents. A repeat in the same spot is suppressed while that incident is open or acknowledged, and for 60 seconds after the last alert there (see repeat suppression). Metadata persists in `.data/incidents.sqlite`; stop the server before deleting that database to reset.

## Camera / local video

Use a separate environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
# Optional, smaller CPU-only torch (Linux/Windows; macOS wheels are already CPU/MPS):
python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
python -m pip install -r requirements-camera.txt   # or the lock file for your Python
python -m fall_detection.server --source camera --camera 0
```

**The camera does not start at launch.** The dashboard shows a monitoring notice and a consent checkbox; the camera and inference start only after the operator ticks it and clicks **Start camera** (`POST /api/camera/start` with `{"consent": true}`). While capture runs, a persistent red **Camera active** bar stays at the top of the page with a **Stop camera** button (`POST /api/camera/stop`). Stopping releases the device and clears the in-memory preview; starting again requires consent again. Synthetic mode has no camera and is unaffected.

Grant Terminal/Python camera access in macOS settings. First camera run downloads YOLOv8n weights into ignored `.data`. Dependencies/model downloads require internet; inference runs locally. While the camera is active the dashboard shows a live preview through the loopback-only server alongside tracking boxes. Only the latest JPEG is kept in memory; images/video are never recorded. Use a separate camera from Presage, or stop Presage capture first.

For a consented local video fixture (also waits for Start camera):

```bash
python -m fall_detection.server --source recorded_fixture --video /absolute/path/clip.mp4
```

No synthetic fallback occurs on model/camera failure. Inspect the explicit unavailable status. Recorded fixtures are labeled separately and use video-frame cadence for duration. A live camera with inference gaps above 0.5 seconds resets candidate duration; this may miss incidents on slow hardware. Do not perform a dangerous staged fall to test it. Use fixture clips or harmless tabletop/synthetic tests instead.

## Detector rules (`bbox-aspect-v1` defaults)

A track raises a possible-person-down observation only when all of these hold:

1. Box is valid, detector confidence ≥ 0.5, and it does **not touch the frame edge** (2% margin of width/height). People cut off by the frame often look wide.
2. Box area is between **0.2% and 35%** of the frame. Tiny boxes are too noisy; close-ups (for example a person filling the frame) are ignored.
3. The **same track** was seen **upright** (height/width ≥ 1.2) within the previous **5 seconds** before the horizontal phase began.
4. The box then stays **horizontal** (height/width < 2/3) for **1.5 seconds** with no gap over 0.5 seconds. Ratios between 2/3 and 1.2 reset the candidate.

Repeat suppression: a new observation is dropped (counted as `suppressedRepeats` in `/api/state`) when its normalized region overlaps (IoU ≥ 0.3 or centroid within 10% of the frame) either an open/acknowledged incident for the same camera, or any alert region from the last 60 seconds (the 60 seconds restart while the suppressed person is still there). This stops tracker ID flicker on one still person creating a stream of incidents. The per-track 10-second cooldown also remains.

Known trade-offs: someone lying down at the frame edge, very close to the camera, or whose track ID changes during the transition is missed; a second real person going down in the same spot while an incident is open is folded into that incident. Check the open incident's scene in either case.

With the ultralytics sample `zidane.jpg` (box ratio 0.515, touching the bottom edge, 56% of the frame), the previous rule raised an incident from a 5-second still clip; with these rules it does not.

## Retention and personal data

At startup and then every 24 hours the server deletes **closed** (resolved / false-alarm) incidents older than `--retention-days` (default **30**, measured from closure), together with their event and action rows. Open and acknowledged incidents are never pruned. Free-text notes can contain names or other personal details; they are kept in `.data/incidents.sqlite` until pruned, so avoid unnecessary personal details and delete the database when the demo ends.

## Licensing: Ultralytics is AGPL-3.0

The optional camera path uses **Ultralytics (YOLOv8 code and the `yolov8n.pt` weights), licensed under AGPL-3.0** unless you hold an Ultralytics Enterprise License. AGPL-3.0 requires that if you distribute this software, or run a modified version that others use over a network, you make the complete corresponding source of the combined work available under AGPL-3.0. Local hackathon use is fine; before distributing it, offering it as a hosted service, or bundling it into SiteGuard, obtain legal review or an enterprise license. The synthetic demo and the detector state machine do not import Ultralytics. Weights are not committed to this repository.

## What matches the reference

Reference: https://github.com/rajvratzoom/siteops-final, commit `1ec38502226d6af7073e32644a5363a0738425b4`, particularly `src/fall_detection.py` and `src/main.py`. Method: detect person boxes, retain track IDs, calculate height/width < 1/1.5, and require 1.5 seconds of continuous horizontal observations. Camera tracking uses Ultralytics YOLOv8n and ByteTrack. These parameters are demo defaults, not clinical or operational thresholds.

The implementation uses a different structure informed by the reference method; [SOURCE_AUDIT.md](SOURCE_AUDIT.md) records the similarity checks and their limits. This is not a clean-room implementation. Unlike the reference, first alerts work with timestamps near zero, observation gaps reset candidate timing, repeated episodes work after cooldown, edge/close-up boxes are ignored, an upright-to-horizontal transition is available in the configurable engine, and incidents require explicit human closure. No hardcoded fall confidence, no “recovered” claim when tracking disappears, no facial identity, no media recording, and no sponsor credentials.

The base synthetic workflow and tests are verified separately from optional camera hardware. Camera/model installation, inference accuracy and real-world suitability require their own verification.

## Claude integration handoff

Read [INTEGRATION.md](INTEGRATION.md). Keep this project outside root npm workspaces. Main application integration is intentionally not implemented. This standalone local dashboard has no user authentication: bind loopback only and do not expose its port publicly.
