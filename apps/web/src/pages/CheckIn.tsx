import { useEffect, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { useIdentity } from "../App";
import { ChooseWorker } from "./WorkerHome";
import { api, useResource, useAction } from "../lib/api";
import type { Session } from "@siteguard/contracts";
import { RECOMMENDED_CHECK_IN_SECONDS } from "@siteguard/contracts";
import { PageHeading, ErrorNotice, HelpActions } from "../components/ui";

export function CheckIn() {
  const { identity } = useIdentity(),
    [search] = useSearchParams(),
    navigate = useNavigate(),
    a = useAction();
  const [consent, setConsent] = useState(false),
    [share, setShare] = useState(false),
    [source, setSource] = useState<"mock" | "presage">("mock"),
    [sourceSelected, setSourceSelected] = useState(false);
  const health = useResource<{
    measurementSources: {
      mock: boolean;
      presage: boolean;
      browserCamera?: boolean;
    };
  }>("/health");
  const browserCamera = Boolean(
    health.data?.measurementSources.browserCamera &&
    window.isSecureContext &&
    navigator.mediaDevices?.getUserMedia,
  );
  const sourceAvailable = Boolean(health.data?.measurementSources[source]);
  useEffect(() => {
    if (health.data && !sourceSelected) {
      setSource(
        browserCamera ||
          (!health.data.measurementSources.mock &&
            health.data.measurementSources.presage)
          ? "presage"
          : "mock",
      );
      setSourceSelected(true);
    }
  }, [browserCamera, health.data, sourceSelected]);
  if (identity?.role !== "worker") return <ChooseWorker />;
  return (
    <>
      <PageHeading
        eyebrow="STEP 1 OF 3 · SETUP"
        title="Ready to check in?"
        description="Choose a source, give consent, then begin. Your scheduled break stays protected."
      />
      <form
        className="card checkin-setup"
        onSubmit={(e) => {
          e.preventDefault();
          if (!consent || a.busy || !sourceAvailable || !search.get("breakId"))
            return;
          void a.run(async () => {
            const result = await api<{ session: Session }>("/sessions", {
              breakId: search.get("breakId"),
              source,
              ...(source === "presage" && browserCamera
                ? { input: "custom" as const }
                : {}),
              consentVersion: "v1",
              shareWithSupervisor: share,
              context: { workload: null, temperatureC: null },
            });
            if (source === "presage" && browserCamera) {
              try {
                sessionStorage.setItem(
                  `siteguard-camera:${result.session.id}`,
                  "browser",
                );
              } catch {
                /* The URL still carries camera mode when storage is unavailable. */
              }
            }
            navigate(
              `/sessions/${result.session.id}/measure${source === "presage" && browserCamera ? "?camera=browser" : ""}`,
            );
          });
        }}
      >
        <h2>Choose your measurement source</h2>
        <label>
          Measurement source
          <select
            value={source}
            disabled={health.loading || a.busy}
            onChange={(e) => {
              setSource(e.target.value as typeof source);
              setSourceSelected(true);
            }}
          >
            <option
              value="mock"
              disabled={!health.data?.measurementSources.mock}
            >
              Synthetic demo · no camera
            </option>
            <option
              value="presage"
              disabled={!health.data?.measurementSources.presage}
            >
              {browserCamera
                ? "This device's camera · Presage"
                : "Laptop bridge camera · Presage"}
              {!health.data?.measurementSources.presage ? " (unavailable)" : ""}
            </option>
          </select>
        </label>
        <p className="setup-description">
          {source === "mock"
            ? "Try the complete flow with synthetic readings. No camera is used."
            : browserCamera
              ? "Your browser will ask for camera access next. Sit still with your face in view."
              : "Use the camera attached to the laptop running Presage. This device's camera will not open."}
        </p>
        <p className="setup-description">
          Allow about {RECOMMENDED_CHECK_IN_SECONDS[source]} seconds
          {source === "presage" ? ", including camera warm-up" : ""}. You can
          finish early.
        </p>
        <div className="notice subtle">
          <LockKeyhole size={18} />
          <span>
            SiteGuard records pulse, breathing, timestamps, and reading quality.
            It does not store camera images or video. Your results are private
            unless you choose to share.
          </span>
        </div>
        <p className="setup-description">
          Experimental research estimate — not medical advice or work clearance.
          You choose whether to request more rest.
        </p>
        <label className="checkbox consent-check">
          <input
            type="checkbox"
            required
            checked={consent}
            disabled={a.busy}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            I understand the limitations and voluntarily agree to record these
            observations.
          </span>
        </label>
        <details className="flow-details">
          <summary>Optional sharing and privacy details</summary>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={share}
              disabled={a.busy}
              onChange={(e) => setShare(e.target.checked)}
            />
            <span>Share this session's summary with safety operations</span>
          </label>
          <p className="setup-description">
            Supervisors see break times and requests. The research estimate
            stays private. No facial identification is used. Presage processing
            and telemetry must be verified separately before real use.
          </p>
        </details>
        <ErrorNotice message={a.error || health.error} />
        {health.error && (
          <button
            type="button"
            className="button secondary"
            onClick={() => void health.refresh()}
          >
            Retry source check
          </button>
        )}
        {!search.get("breakId") && (
          <p role="status">
            Open your active break from the worker home to begin.
          </p>
        )}
        <button
          className="button primary full"
          disabled={
            !consent ||
            a.busy ||
            !sourceAvailable ||
            health.loading ||
            !search.get("breakId")
          }
        >
          {a.busy ? "Starting…" : "Begin check-in"}
          <ArrowRight size={17} />
        </button>
        <Link className="button ghost full" to="/worker">
          Back to worker home
        </Link>
        <p className="fine-print">
          Voluntary check-in · You can stop at any time.
        </p>
      </form>
      <details className="card flow-details">
        <summary>Need help without a check-in?</summary>
        <HelpActions />
      </details>
    </>
  );
}
