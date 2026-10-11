import { CameraPreview } from "../components/CameraPreview";
import { startOrResumeCheckIn } from "../lib/checkin";
import { useEffect, useRef, useState } from "react";
import {
  useParams,
  useNavigate,
  Link,
  useSearchParams,
} from "react-router-dom";
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
import {
  BROWSER_CAMERA_FPS,
  BROWSER_CAMERA_FRAME_INTERVAL_MS,
} from "../lib/camera";
export function Measurement() {
  const { id } = useParams(),
    [search] = useSearchParams(),
    session = useResource<{ session: Session }>(`/sessions/${id}`);
  const stream = useSessionStream(
      id!,
      session.data?.session.status === "active",
    ),
    a = useAction(),
    navigate = useNavigate();
  const [now, setNow] = useState(Date.now());
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const browserCamera = search.get("camera") === "browser";
  const s = session.data?.session;
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!browserCamera || s?.source !== "presage" || s.status !== "active")
      return;
    let stopped = false;
    let media: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    let timestampUs = 0;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const fail = (error: unknown) => {
      if (stopped) return;
      setCameraError(
        error instanceof Error ? error.message : "Camera capture stopped.",
      );
      setCameraActive(false);
    };
    const capture = async () => {
      if (stopped || busy || !media || !context || !videoRef.current) return;
      busy = true;
      try {
        const video = videoRef.current;
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
        const scale = Math.min(
          1,
          640 / Math.max(video.videoWidth, video.videoHeight),
        );
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (blob) =>
              blob
                ? resolve(blob)
                : reject(new Error("Camera frame encoding failed")),
            "image/jpeg",
            0.9,
          ),
        );
        timestampUs = Math.max(timestampUs + 1, Date.now() * 1000);
        const response = await fetch(
          `/api/sessions/${encodeURIComponent(id!)}/frame?timestampUs=${timestampUs}`,
          {
            method: "POST",
            headers: { "Content-Type": "image/jpeg" },
            body: frame,
            credentials: "same-origin",
            cache: "no-store",
          },
        );
        if (!response.ok) {
          let detail =
            response.status === 409
              ? "This check-in is no longer active. Restart the web check-in."
              : `Camera frame rejected (${response.status}).`;
          try {
            const body = (await response.json()) as { message?: string };
            if (body.message) detail = body.message;
          } catch {
            // Keep the status-based fallback when the server did not return JSON.
          }
          throw new Error(detail);
        }
      } catch (error) {
        fail(error);
      } finally {
        busy = false;
        if (!stopped)
          timer = setTimeout(
            () => void capture(),
            BROWSER_CAMERA_FRAME_INTERVAL_MS,
          );
      }
    };
    const start = async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
          throw new Error("Camera check-in requires HTTPS.");
        media = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "user",
            width: { ideal: 960 },
            height: { ideal: 720 },
            frameRate: {
              ideal: BROWSER_CAMERA_FPS,
              max: BROWSER_CAMERA_FPS,
            },
          },
        });
        if (stopped) return;
        videoRef.current!.srcObject = media;
        await videoRef.current!.play();
        setCameraActive(true);
        void capture();
      } catch (error) {
        fail(error);
      }
    };
    void start();
    return () => {
      stopped = true;
      clearTimeout(timer);
      media?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      setCameraActive(false);
    };
  }, [browserCamera, id, s?.source, s?.status]);
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
          {browserCamera && s.source === "presage" ? (
            <div className="camera-frame">
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                aria-label="Live camera preview"
                style={{
                  width: "100%",
                  borderRadius: 12,
                  transform: "scaleX(-1)",
                }}
              />
              <strong>
                {cameraActive ? "Camera active" : "Starting camera…"}
              </strong>
              <span>
                {cameraError ||
                  "Frames are processed transiently by Presage; no video is saved."}
              </span>
              {cameraError && (
                <button
                  className="button secondary"
                  disabled={a.busy}
                  onClick={() =>
                    void a.run(async () => {
                      await api(`/sessions/${s.id}/complete`, {});
                      navigate("/web-check-in");
                    })
                  }
                >
                  {a.busy ? "Restarting…" : "Restart web check-in"}
                </button>
              )}
            </div>
          ) : s.source === "presage" ? (
            <CameraPreview sessionId={s.id} />
          ) : (
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
                  ? "Example readings show how a check-in works."
                  : "Camera capture is managed by the local Presage bridge."}
              </span>
            </div>
          )}
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
                    const result = await startOrResumeCheckIn(s.workerId, {
                      breakId: s.breakId,
                      source: "presage",
                      consentVersion: s.consentVersion,
                      shareWithSupervisor: s.shareWithSupervisor,
                      context: s.context,
                    });
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
            Readings are not medical clearance.
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
      <ErrorNotice message={a.error || cameraError || stream.error} />
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
