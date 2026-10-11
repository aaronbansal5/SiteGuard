import { startOrResumeCheckIn } from "../lib/checkin";
import { useEffect, useState } from "react";
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
    [source, setSource] = useState<"mock" | "presage">("mock"),
    [sourceSelected, setSourceSelected] = useState(false);
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
  const availableBreak =
    breaks.data?.breaks.find(
      (b) => Date.parse(b.startsAt) <= now && Date.parse(b.endsAt) > now,
    ) ?? (localTest ? breaks.data?.breaks[0] : undefined);
  const breakId = search.get("breakId") || availableBreak?.id;
  const browserCamera = Boolean(
    health.data?.measurementSources.browserCamera &&
    window.isSecureContext &&
    navigator.mediaDevices?.getUserMedia,
  );
  useEffect(() => {
    if (health.data && !sourceSelected) {
      setSource(
        browserCamera || (localTest && health.data.measurementSources.presage)
          ? "presage"
          : "mock",
      );
      setSourceSelected(true);
    }
  }, [browserCamera, localTest, health.data, sourceSelected]);
  if (identity?.role !== "worker") return <ChooseWorker />;
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
                <h3>Only normalized observations</h3>
                <p>
                  We record timestamped pulse, breathing rate, source, and
                  quality. SiteGuard does not store camera images or video.
                </p>
              </div>
            </div>
            <div className="consent-point">
              <span>02</span>
              <div>
                <h3>No identification, no clearance</h3>
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
              Synthetic mode uses no camera. Before real use, verify the Presage
              bridge's processing and telemetry privacy separately.
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
                breakId: breakId!,
                source,
                ...(source === "presage" && browserCamera
                  ? { input: "custom" as const }
                  : {}),
                consentVersion: localTest ? "local-test" : "v1",
                shareWithSupervisor: share,
                context: { workload: null, temperatureC: null },
              });
              navigate(
                `/sessions/${result.session.id}/measure${source === "presage" && browserCamera ? "?camera=browser" : ""}`,
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
          <label>
            Measurement source
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as typeof source)}
            >
              <option value="mock">Synthetic demo · no camera</option>
              <option
                value="presage"
                disabled={!health.data?.measurementSources.presage}
              >
                Presage · local camera bridge
                {!health.data?.measurementSources.presage
                  ? " (not configured)"
                  : ""}
              </option>
            </select>
          </label>
          <p className="fine-print">
            Recommended check-in: {RECOMMENDED_CHECK_IN_SECONDS[source]} seconds
            {source === "presage"
              ? ", including camera warm-up before readings count."
              : "."}
          </p>
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
            <span>Share this session's summary with safety operations</span>
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
              (!breakId
                ? "Select your active protected break from the worker portal before starting."
                : "")
            }
          />
          <button
            className="button primary full"
            disabled={
              health.loading || (!localTest && !consent) || a.busy || !breakId
            }
          >
            {a.busy
              ? "Starting…"
              : localTest
                ? source === "presage"
                  ? "Begin camera check-in"
                  : "Begin synthetic check-in"
                : "Begin check-in"}
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
