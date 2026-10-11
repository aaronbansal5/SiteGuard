import { startOrResumeCheckIn } from "../lib/checkin";
import { useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { ShieldCheck, ArrowRight, LockKeyhole } from "lucide-react";
import { useIdentity } from "../App";
import { ChooseWorker } from "./WorkerHome";
import { useResource, useAction } from "../lib/api";
import { RECOMMENDED_CHECK_IN_SECONDS, type Break } from "@siteguard/contracts";
import { PageHeading, ErrorNotice, HelpActions } from "../components/ui";
export function CheckIn() {
  const { identity } = useIdentity(),
    [search] = useSearchParams(),
    navigate = useNavigate(),
    a = useAction();
  const [consent, setConsent] = useState(false),
    [share, setShare] = useState(false),
    [cameraInput, setCameraInput] = useState<"browser" | "native">("native");
  const source = "presage" as const;
  const health = useResource<{
    checkInTestMode?: boolean;
    measurementSources: {
      mock: boolean;
      presage: boolean;
      browserCamera?: boolean;
    };
  }>("/health");
  const breaks = useResource<{ breaks: Break[] }>("/breaks");
  const localTest = health.data?.checkInTestMode === true;
  const now = Date.now();
  const workerBreaks = [...(breaks.data?.breaks ?? [])].sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
  );
  const availableBreak =
    workerBreaks.find(
      (b) => Date.parse(b.startsAt) <= now && Date.parse(b.endsAt) > now,
    ) ??
    [...(breaks.data?.breaks ?? [])].sort(
      (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
    )[0];
  const breakId = search.get("breakId") || availableBreak?.id;
  const hasProtectedBreak = (breaks.data?.breaks ?? []).some(
    (item) => item.kind === "protected",
  );
  const onDemand = Boolean(
    availableBreak &&
    !(
      Date.parse(availableBreak.startsAt) <= now &&
      Date.parse(availableBreak.endsAt) > now
    ),
  );
  const browserCamera = Boolean(
    health.data?.measurementSources.browserCamera &&
    window.isSecureContext &&
    navigator.mediaDevices?.getUserMedia,
  );
  if (identity?.role !== "worker") return <ChooseWorker />;
  if (!breaks.loading && breaks.data && !hasProtectedBreak) {
    return (
      <section className="card empty-state">
        <ShieldCheck size={30} />
        <h1>No protected break is scheduled</h1>
        <p>
          A supervisor must schedule your initial protected break. SiteGuard
          never creates one automatically.
        </p>
        <Link className="button secondary" to="/worker">
          Return to workspace
        </Link>
        <HelpActions />
      </section>
    );
  }
  return (
    <>
      <PageHeading
        eyebrow="VOLUNTARY CHECK-IN / 01"
        title="A check-in on your terms."
        description="Choose what to record. Your protected break remains yours."
      />
      <div className="consent-layout">
        {!localTest && (
          <section className="card">
            <div className="card-header">
              <span className="portal-icon">
                <ShieldCheck size={24} />
              </span>
              <div>
                <h2>Before you begin</h2>
                <p>Understand what this check-in collects.</p>
              </div>
            </div>
            <div className="consent-point">
              <span>01</span>
              <div>
                <h3>What we record</h3>
                <p>
                  We record timestamped pulse, breathing rate, source, and
                  quality. SiteGuard does not store camera images or video.
                </p>
              </div>
            </div>
            <div className="consent-point">
              <span>02</span>
              <div>
                <h3>What readings can tell you</h3>
                <p>
                  No facial identification. Measurements cannot establish
                  recovery or whether you are fit to return to work.
                </p>
              </div>
            </div>
            <div className="consent-point">
              <span>03</span>
              <div>
                <h3>Your history is private by default</h3>
                <p>
                  Your supervisor sees break times and requests. Sharing this
                  session's physiological summary is optional.
                </p>
              </div>
            </div>
            <div className="notice demo">
              Your camera supplies the readings through Presage. SiteGuard does
              not store camera images or video.
            </div>
          </section>
        )}
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            if ((!localTest && !consent) || a.busy) return;
            void a.run(async () => {
              const result = await startOrResumeCheckIn(identity.workerId, {
                ...(breakId ? { breakId } : {}),
                onDemand,
                source,
                ...(source === "presage" && cameraInput === "browser"
                  ? { input: "custom" as const }
                  : {}),
                consentVersion: localTest ? "local-test" : "v1",
                shareWithSupervisor: share,
                context: { workload: null, temperatureC: null },
              });
              navigate(
                `/sessions/${result.session.id}/measure${source === "presage" && cameraInput === "browser" ? "?camera=browser" : ""}`,
              );
            });
          }}
        >
          <h2>Check-in preferences</h2>
          {localTest && (
            <p className="notice demo">
              Local testing: no consent form or scheduled-break time gate. Begin
              check-in starts recording; Finish check-in stops it.
            </p>
          )}
          {onDemand && !localTest && (
            <p className="notice demo">
              On-demand check-in: you can start now without an active scheduled
              break. This does not change your break schedule.
            </p>
          )}
          <p className="fine-print">
            Recommended check-in: {RECOMMENDED_CHECK_IN_SECONDS[source]}{" "}
            seconds, including camera warm-up before readings count.
          </p>
          {source === "presage" && browserCamera && (
            <fieldset className="camera-input-choice">
              <legend>Camera connection</legend>
              <label className="radio-option">
                <input
                  type="radio"
                  name="camera-input"
                  checked={cameraInput === "native"}
                  onChange={() => setCameraInput("native")}
                />
                <span>
                  <strong>This Mac via Presage · recommended</strong>
                  <small>
                    Uses Presage’s local camera pipeline for the most reliable
                    desktop check-in.
                  </small>
                </span>
              </label>
              <label className="radio-option">
                <input
                  type="radio"
                  name="camera-input"
                  checked={cameraInput === "browser"}
                  onChange={() => setCameraInput("browser")}
                />
                <span>
                  <strong>This browser</strong>
                  <small>
                    Live preview from Chrome, processed locally by Presage.
                  </small>
                </span>
              </label>
            </fieldset>
          )}
          <p className="fine-print">
            No workload or temperature questions are required. The before/after
            reading windows and your eligible history are handled automatically.
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={share}
              onChange={(e) => setShare(e.target.checked)}
            />
            <span>Share this check-in with my manager</span>
          </label>
          {!localTest && (
            <label className="checkbox consent-check">
              <input
                type="checkbox"
                required
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                I understand the limitations and voluntarily agree to record
                these observations.
              </span>
            </label>
          )}
          <ErrorNotice
            message={
              a.error ||
              health.error ||
              (!localTest && !breakId
                ? "Select your active protected break from the worker portal before starting."
                : "")
            }
          />
          <button
            className="button primary full"
            disabled={
              health.loading ||
              (!localTest && !consent) ||
              a.busy ||
              (!localTest && !breakId)
            }
          >
            {a.busy ? "Starting…" : "Begin camera check-in"}
            <ArrowRight size={17} />
          </button>
          <Link className="button ghost full" to="/worker">
            Skip measurement
          </Link>
          <p className="fine-print">
            <LockKeyhole size={12} />{" "}
            {localTest ? "Local test session ·" : "Consent version v1 ·"} You
            can stop at any time.
          </p>
        </form>
      </div>
      <section className="card">
        <h2>Need support instead?</h2>
        <p className="muted">Assistance is independent of check-in consent.</p>
        <HelpActions />
      </section>
    </>
  );
}
