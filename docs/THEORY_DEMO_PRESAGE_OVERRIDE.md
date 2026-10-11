# Presage theory-demo override

This is a local hackathon/demo switch. It lets a completed Presage session be
scored by the locally trained synthetic research artifact so the end-to-end
flow can be demonstrated.

The artifact was trained on fabricated records. It is not validated medical
guidance, a fatigue diagnosis, work clearance, or a recommendation to skip a
break. The UI must keep the theory-demo disclaimer visible, and the worker
still chooses whether to request rest.

## Enable locally

From the repository root:

```bash
cd /Users/mohitunecha/Coding/SiteGuard

DEMO_MODE=true \
RESEARCH_DEMO_ENABLED=true \
RESEARCH_DEMO_ALLOW_PRESAGE=true \
npm run dev:live
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173) and complete a Presage
check-in. This command starts the Presage bridge, API and web server together.
Use one running instance; a bridge on port 4311 is required for camera capture.

Presage check-ins count down from 90 seconds and finish automatically; the
synthetic source uses 60 seconds. You can finish early. A usable summary is
scored by the synthetic artifact. Incomplete Presage evidence under this local
override shows a labelled presentation scenario with no model score. The
scenario is a walkthrough, not a model prediction. Actual readings are never
invented or filled in.

## Role-play different outcomes

On a labelled presentation result, select **Shuffle demo scenario** to choose a
different fictional walkthrough. Or select **Rest**, **Recheck**, or **Support**
directly to rehearse a specific flow. The same controls work on the phone web
summary. Reloading returns to the initial Rest scenario.

Shuffling only updates the local preview. It never fabricates vitals, changes
model predictions or confidence, writes session records, or sends requests.
**Request additional rest** and **Request assistance** still use the real app
workflow when submitted. Research details and actual camera evidence are
expandable below the role-play card. Random scenario controls never appear on
non-presentation research results.

If the API restarts during measurement, the old session is completed as
interrupted. The web and phone screens check session status and open its summary;
start a fresh camera check-in to record again. If completion fails, its error is
shown and the Finish check-in button becomes available for retry.

## Environment-file version

Instead of setting the variables on the command line, put them in the local
untracked `.env` file:

```env
DEMO_MODE=true
RESEARCH_DEMO_ENABLED=true
RESEARCH_DEMO_ALLOW_PRESAGE=true
```

Do not put secrets, API keys, database credentials, or real measurement data in
this Markdown file or in Git.

## Disable the override

Remove the third variable or set it to false:

```env
RESEARCH_DEMO_ALLOW_PRESAGE=false
```

The server also forcibly disables this override when `NODE_ENV=production`,
when demo mode is off, or when the research demo flag is off.

## What the override does

- Keeps the original Presage source label; it does not relabel measurements as
  synthetic.
- Applies only the local synthetic artifact to the completed summary.
- Labels the incomplete-evidence presentation fallback separately from inference.
- Returns provenance showing `dataset_kind=synthetic_demo` and
  `runtime_ready=false`.
- Never requests rest, changes a break, or mutates a session automatically.
- Remains worker-only through the existing session authorization checks.

## Verify before a demo

```bash
npm run typecheck
npm test -- --run
npm run format:check
npm run build
npx playwright test --config playwright.reliability.config.ts
```

The synthetic model artifact is local and ignored by Git:

```text
.data/research/artifacts/demo-full-run-001/model.json
```

## Push changes to `main`

```bash
git status
git pull --rebase origin main
git add docs/THEORY_DEMO_PRESAGE_OVERRIDE.md
git commit -m "docs: explain Presage theory demo override"
git push origin main
```

Confirm the branch is synchronized:

```bash
git status --short --branch
git log --oneline -1
```
