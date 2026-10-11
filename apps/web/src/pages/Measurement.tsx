import { useEffect, useRef, useState } from "react";
import {
  useParams,
  useNavigate,
  Link,
  useSearchParams,
} from "react-router-dom";
import { ScanLine, Clock, Square, Info } from "lucide-react";
import type { Session } from "@siteguard/contracts";
import { RECOMMENDED_CHECK_IN_SECONDS } from "@siteguard/contracts";
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
  const browserCamera =
    search.get("camera") === "browser" ||
    (() => {
      try {
        return sessionStorage.getItem(`siteguard-camera:${id}`) === "browser";
      } catch {
        return false;
      }
    })();
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
    const controller = new AbortController();
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const fail = (error: unknown) => {
      if (stopped) return;
      setCameraError(
        error instanceof Error ? error.message : "Camera capture stopped.",
      );
      setCameraActive(false);
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      media?.getTracks().forEach((track) => track.stop());
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
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(15000),
            ]),
          },
        );
        if (!response.ok)
          throw new Error(`Camera frame rejected (${response.status}).`);
      } catch (error) {
        fail(error);
      } finally {
        busy = false;
        if (!stopped) timer = setTimeout(() => void capture(), 33);
      }
    };
    const start = async () => {
      try {
        if (!context)
          throw new Error(
            "Camera processing is unavailable in this browser. Finish this check-in and try another browser.",
          );
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
          throw new Error("Camera check-in requires HTTPS.");
        media = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "user",
            width: { ideal: 960 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
        });
        if (stopped) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        videoRef.current!.srcObject = media;
        await videoRef.current!.play();
        if (stopped) return;
        setCameraActive(true);
        void capture();
      } catch (error) {
        fail(error);
      }
    };
    void start();
    return () => {
      stopped = true;
      controller.abort();
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
          View results
        </Link>
      </div>
    );
  const elapsed = Math.max(
      0,
      Math.floor((now - Date.parse(s.startedAt)) / 1000),
    ),
    quality = stream.readings.at(-1)?.reading.quality,
    target = RECOMMENDED_CHECK_IN_SECONDS[s.source];
  return (
    <>
      <PageHeading
        eyebrow="STEP 2 OF 3 · MEASUREMENT"
        title="Your check-in is recording."
        description={
          s.source === "mock"
            ? "Watch the synthetic readings, then finish to see your results."
            : "Sit still, face the camera in even light, then finish to see your results."
        }
        action={<SourceBadge source={s.source} />}
      />
      <div className="measurement-layout">
        <section className="card positioning">
          <div className="row-between">
            <span className="eyebrow">
              {s.source === "mock"
                ? "SYNTHETIC MEASUREMENT"
                : "CAMERA CHECK-IN"}
            </span>
            <span className="badge">{quality || "Waiting"}</span>
          </div>
          <div className="camera-frame">
            {browserCamera && s.source === "presage" ? (
              <>
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
                  {cameraError
                    ? "Camera stopped"
                    : cameraActive
                      ? "Camera active"
                      : "Starting camera…"}
                </strong>
                <span>
                  {cameraError ||
                    "Frames are processed transiently by Presage; no video is saved."}
                </span>
              </>
            ) : (
              <>
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
                    ? "Synthetic readings demonstrate the complete flow."
                    : "Use the camera on the laptop running Presage."}
                </span>
              </>
            )}
          </div>
          <div className="connection">
            <span className={`dot ${stream.error ? "amber" : ""}`} />
            {stream.status}
          </div>
          <div className="positioning-tip">
            <Info size={16} />
            <p>
              {s.source === "mock"
                ? "No positioning needed for the synthetic demo."
                : "Keep your face in view and stay still while readings arrive."}
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
          <div className="progress">
            <span
              style={{ width: `${Math.min(100, (elapsed / target) * 100)}%` }}
            />
          </div>
          <p className="setup-description" role="status">
            {elapsed < target
              ? `About ${target - elapsed} seconds left in the suggested recording.`
              : "Suggested recording time reached. Finish when you’re ready."}
          </p>
          <p className="fine-print">
            {s.source === "presage" &&
              "Readings may need 30–45 seconds to warm up. "}
            You can finish early; your summary may show insufficient data.
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
            {a.busy ? "Preparing results…" : "Finish check-in"}
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
