import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ScanLine, Clock, Square, Info } from "lucide-react";
import type { Session } from "@siteguard/contracts";
import { api, useResource, useAction } from "../lib/api";
import { useSessionStream } from "../lib/session-stream";
import {
  PageHeading,
  Loading,
  ErrorNotice,
  HelpActions,
  SafetyNote,
} from "../components/ui";
import { SourceBadge } from "../components/SourceBadge";
import { VitalChart } from "../components/VitalChart";
export function Measurement() {
  const { id } = useParams(),
    session = useResource<{ session: Session }>(`/sessions/${id}`);
  const stream = useSessionStream(
      id!,
      session.data?.session.status === "active",
    ),
    a = useAction(),
    navigate = useNavigate();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const s = session.data?.session;
  if (!s)
    return (
      <>
        <ErrorNotice message={session.error} />
        {session.loading && <Loading />}
        {session.error && (
          <section className="card">
            <h1>Check-in temporarily unavailable</h1>
            <p>
              Retry to reconnect to this session. Support remains available
              without measurements.
            </p>
            <button
              className="button secondary"
              onClick={() => void session.refresh()}
            >
              Retry session
            </button>
            <HelpActions />
          </section>
        )}
      </>
    );
  if (s.status === "completed")
    return (
      <div className="card">
        <h1>Check-in completed</h1>
        <Link className="button primary" to={`/sessions/${s.id}`}>
          Review observations
        </Link>
      </div>
    );
  const elapsed = Math.max(
      0,
      Math.floor((now - Date.parse(s.startedAt)) / 1000),
    ),
    quality = stream.readings.at(-1)?.reading.quality;
  return (
    <>
      <PageHeading
        eyebrow="VOLUNTARY CHECK-IN / 02"
        title="Settle in. Observe the change."
        description="Stay seated and stationary throughout your check-in."
        action={<SourceBadge source={s.source} />}
      />
      <div className="measurement-layout">
        <section className="card positioning">
          <div className="row-between">
            <span className="eyebrow">
              {s.source === "mock"
                ? "SYNTHETIC MEASUREMENT"
                : "LOCAL CAMERA CHECK-IN"}
            </span>
            <span className="badge">{quality || "Waiting"}</span>
          </div>
          <div className="camera-frame">
            <div className="scan-corners" />
            <div className="head-outline">
              <ScanLine size={68} strokeWidth={1} />
            </div>
            <strong>
              {s.source === "mock"
                ? "No camera required"
                : "Face the bridge camera"}
            </strong>
            <span>
              {s.source === "mock"
                ? "A deterministic stream demonstrates the flow."
                : "Camera capture is managed by the local Presage bridge."}
            </span>
          </div>
          {s.source === "mock" && (
            <div className="notice demo">
              <p>
                This session uses synthetic values. Your camera is not running.
              </p>
              <button
                className="button secondary full"
                disabled={a.busy}
                onClick={() =>
                  void a.run(async () => {
                    await api(`/sessions/${s.id}/complete`, {});
                    const result = await api<{ session: Session }>(
                      "/sessions",
                      {
                        breakId: s.breakId,
                        source: "presage",
                        consentVersion: s.consentVersion,
                        shareWithSupervisor: s.shareWithSupervisor,
                        context: s.context,
                      },
                    );
                    navigate(`/sessions/${result.session.id}/measure`);
                  })
                }
              >
                {a.busy
                  ? "Starting camera…"
                  : "End synthetic session and start camera check-in"}
              </button>
            </div>
          )}
          <div className="connection">
            <span className={`dot ${stream.error ? "amber" : ""}`} />
            {stream.status}
          </div>
          <div className="positioning-tip">
            <Info size={16} />
            <p>
              Rest comfortably. In real mode, face the camera with even lighting
              and follow bridge positioning instructions.
            </p>
          </div>
          <div className="session-timer">
            <Clock size={18} />
            <strong>
              {String(Math.floor(elapsed / 60)).padStart(2, "0")}:
              {String(elapsed % 60).padStart(2, "0")}
            </strong>
            <span>elapsed</span>
          </div>
          <p className="fine-print">
            No time limit. Keep testing for as long as you need, then select
            Finish check-in to stop recording.
            {s.source === "presage" &&
              " Positioning and warm-up may delay valid readings."}{" "}
            Data sufficiency is not a medical threshold.
          </p>
          <button
            className="button primary full"
            disabled={a.busy}
            onClick={() =>
              void a.run(async () => {
                await api(`/sessions/${s.id}/complete`, {});
                navigate(`/sessions/${s.id}`);
              })
            }
          >
            <Square size={14} />
            {a.busy ? "Stopping source…" : "Finish check-in"}
          </button>
        </section>
        <div>
          <VitalChart
            readings={stream.readings}
            metric="pulse"
            startedAt={s.startedAt}
          />
          <VitalChart
            readings={stream.readings}
            metric="breathing"
            startedAt={s.startedAt}
          />
        </div>
      </div>
      <ErrorNotice message={a.error || stream.error} />
      <section className="card">
        <div className="card-header">
          <div>
            <h2>How are you feeling?</h2>
            <p>Your request reaches a person, regardless of the readings.</p>
          </div>
        </div>
        <HelpActions sessionId={s.id} />
      </section>
      <SafetyNote />
    </>
  );
}
