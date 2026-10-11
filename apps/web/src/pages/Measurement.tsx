import { CameraPreview } from "../components/CameraPreview";
import { startOrResumeCheckIn } from "../lib/checkin";
import { useCheckInCompletion } from "../lib/checkin-completion";
import { useEffect, useRef, useState } from "react";
import {
  useParams,
  useNavigate,
  Link,
  useSearchParams,
} from "react-router-dom";
import { ScanLine, Clock, Square, Info } from "lucide-react";
import type { Session } from "@siteguard/contracts";
import { useResource, useAction } from "../lib/api";
import { useSessionStream } from "../lib/session-stream";
import {
  PageHeading,
  Loading,
  ErrorNotice,
  HelpActions,
  SafetyNote,
} from "../components/ui";
import { VitalChart } from "../components/VitalChart";
import {
  BROWSER_CAMERA_FPS,
  BROWSER_CAMERA_FRAME_INTERVAL_MS,
  BROWSER_CAMERA_IDEAL_HEIGHT,
  BROWSER_CAMERA_IDEAL_WIDTH,
  BROWSER_CAMERA_MAX_DIMENSION,
} from "../lib/camera";
export function Measurement() {
  const { id } = useParams(),
    [search] = useSearchParams(),
    session = useResource<{ session: Session }>(`/sessions/${id}`, 5000);
  const stream = useSessionStream(
      id!,
      session.data?.session.status === "active",
    ),
    a = useAction(),
    navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const browserCamera = search.get("camera") === "browser";
  const s = session.data?.session;
  const startupFailure = s?.interruption?.startsWith(
    "Measurement source failed to start",
  )
    ? s.interruption
    : null;
  const health = useResource<{ presentationDemo?: boolean }>("/health");
  const completion = useCheckInCompletion(s, (sessionId) =>
    navigate(`/sessions/${sessionId}`),
  );
  const { targetSeconds, remaining, busy: autoCompleting } = completion;
  useEffect(() => {
    if (
      !browserCamera ||
      s?.source !== "presage" ||
      s.status !== "active" ||
      autoCompleting ||
      startupFailure
    )
      return;
    let stopped = false;
    let media: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = 0;
    let encoding = false;
    let lastTimestampUs = 0;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const failCapture = (error: unknown) => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      setCameraError(
        error instanceof Error ? error.message : "Camera capture stopped.",
      );
      media?.getTracks().forEach((track) => track.stop());
      setCameraActive(false);
    };
    const capture = async () => {
      if (stopped || !media || !context || !videoRef.current) return;
      const captureStartedAt = performance.now();
      try {
        const video = videoRef.current;
        if (
          !encoding &&
          inFlight < 5 &&
          video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
          encoding = true;
          const sourceWidth = video.videoWidth;
          const sourceHeight = video.videoHeight;
          if (!sourceWidth || !sourceHeight)
            throw new Error("Camera video has no usable frame size.");
          const scale = Math.min(
            1,
            BROWSER_CAMERA_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight),
          );
          const frameWidth = Math.round(sourceWidth * scale);
          const frameHeight = Math.round(sourceHeight * scale);
          if (canvas.width !== frameWidth) canvas.width = frameWidth;
          if (canvas.height !== frameHeight) canvas.height = frameHeight;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frame = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (blob) =>
                blob
                  ? resolve(blob)
                  : reject(new Error("Camera frame encoding failed")),
              "image/jpeg",
              0.92,
            ),
          );
          encoding = false;
          if (stopped) return;
          const timestampUs = Math.max(lastTimestampUs + 1, Date.now() * 1000);
          lastTimestampUs = timestampUs;
          inFlight++;
          void fetch(
            `/api/sessions/${encodeURIComponent(id!)}/frame?timestampUs=${timestampUs}`,
            {
              method: "POST",
              headers: { "Content-Type": "image/jpeg" },
              body: frame,
              credentials: "same-origin",
              cache: "no-store",
            },
          )
            .then(async (response) => {
              if (response.ok) return;
              let detail =
                response.status === 409
                  ? "This check-in is no longer active. Restart the web check-in."
                  : `Camera frame rejected (${response.status}).`;
              try {
                const body = (await response.json()) as {
                  error?: { message?: string };
                  message?: string;
                };
                detail = body.error?.message || body.message || detail;
              } catch {
                // Keep the status-based fallback when the server did not return JSON.
              }
              throw new Error(detail);
            })
            .catch(failCapture)
            .finally(() => {
              inFlight--;
            });
        }
        if (!stopped)
          timer = setTimeout(
            () => void capture(),
            Math.max(
              0,
              BROWSER_CAMERA_FRAME_INTERVAL_MS -
                (performance.now() - captureStartedAt),
            ),
          );
      } catch (error) {
        encoding = false;
        failCapture(error);
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
            width: { ideal: BROWSER_CAMERA_IDEAL_WIDTH },
            height: { ideal: BROWSER_CAMERA_IDEAL_HEIGHT },
            frameRate: {
              ideal: BROWSER_CAMERA_FPS,
              max: BROWSER_CAMERA_FPS,
            },
          },
        });
        if (stopped) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        if (!videoRef.current) throw new Error("Camera preview unavailable.");
        videoRef.current.srcObject = media;
        await videoRef.current.play();
        setCameraActive(true);
        void capture();
      } catch (error) {
        failCapture(error);
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
  }, [browserCamera, id, s?.source, s?.status, autoCompleting, startupFailure]);
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
  const quality = stream.readings.at(-1)?.reading.quality;
  return (
    <>
      <PageHeading
        eyebrow="VOLUNTARY CHECK-IN / 02"
        title="Settle in. Observe the change."
        description="Stay seated and stationary throughout your check-in."
      />
      <div className="measurement-layout">
        <section className="card positioning">
          <div className="row-between">
            <span className="eyebrow">
              {s.source === "mock"
                ? "SYNTHETIC MEASUREMENT"
                : "LOCAL CAMERA CHECK-IN"}
            </span>
            <span className="badge">
              {startupFailure ? "Camera unavailable" : quality || "Waiting"}
            </span>
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
                {startupFailure
                  ? "Camera unavailable"
                  : cameraActive
                    ? "Camera active"
                    : "Starting camera…"}
              </strong>
              <span>
                {startupFailure ||
                  cameraError ||
                  "Frames are processed transiently by Presage; no video is saved."}
              </span>
              {cameraError && (
                <button
                  className="button secondary"
                  disabled={a.busy || autoCompleting}
                  onClick={() => void completion.finish()}
                >
                  {autoCompleting
                    ? "Finishing…"
                    : "Finish interrupted check-in"}
                </button>
              )}
            </div>
          ) : s.source === "presage" ? (
            <>
              <CameraPreview sessionId={s.id} failure={startupFailure} />
              {health.data?.presentationDemo && (
                <div className="notice demo">
                  <p>
                    Camera preview still waiting? Continue the labelled
                    presentation demo without claiming a camera result.
                  </p>
                  <button
                    className="button secondary full"
                    disabled={a.busy || autoCompleting}
                    onClick={() => void completion.finish()}
                  >
                    {a.busy || autoCompleting
                      ? "Finishing check-in…"
                      : "Continue with presentation demo"}
                  </button>
                </div>
              )}
            </>
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
          {browserCamera &&
            s.source === "presage" &&
            cameraError &&
            health.data?.presentationDemo && (
              <button
                className="button secondary full"
                disabled={autoCompleting}
                onClick={() => void completion.finish()}
              >
                Continue with presentation demo
              </button>
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
            {startupFailure ? "Camera startup failed" : stream.status}
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
              {String(Math.floor(remaining / 60)).padStart(2, "0")}:
              {String(remaining % 60).padStart(2, "0")}
            </strong>
            <span>remaining</span>
          </div>
          <p className="fine-print">
            Standard {targetSeconds}-second demo check-in. It will finish
            automatically; you can finish early.
            {s.source === "presage" &&
              " Positioning and warm-up may delay valid readings."}{" "}
            This duration is a demo flow, not a medical threshold, and readings
            are not medical clearance.
          </p>
          <button
            className="button primary full"
            disabled={a.busy || autoCompleting}
            onClick={() => void completion.finish()}
          >
            <Square size={14} />
            {a.busy || autoCompleting
              ? "Finishing check-in…"
              : "Finish check-in"}
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
      <ErrorNotice
        message={completion.error || a.error || cameraError || stream.error}
      />
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
