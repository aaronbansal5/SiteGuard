import { IncidentScrollArea } from "../components/IncidentScrollArea";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Camera,
  ShieldAlert,
  Eye,
  ClipboardCheck,
  Radio,
  VideoOff,
} from "lucide-react";
import { useIdentity } from "../App";
import { api, useAction, useResource } from "../lib/api";
import { ErrorNotice, Loading, PageHeading } from "../components/ui";

type Incident = {
  id: string;
  status: string;
  source: string;
  observedAt: string;
  cameraId: string;
  zoneId: string;
  durationSeconds: number;
  note?: string | null;
  revision: number;
  updates?: {
    id: string;
    type: string;
    note: string;
    createdAt: string;
    actorRole: string;
  }[];
};
type Scene = {
  source: string;
  status: string;
  cameraActive: boolean;
  canViewCamera: boolean;
  incidents: Incident[];
  tracks?: {
    trackId: string;
    bbox: [number, number, number, number];
    horizontal: boolean;
  }[];
  frameSize?: [number, number];
  delivery?: { configured: boolean; pending: number; error: string | null };
};
const clock = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "long",
});
export function FallDetection() {
  const { identity } = useIdentity();
  if (!identity)
    return (
      <section className="card empty-state">
        <ShieldAlert size={32} />
        <h1>Fall detection</h1>
        <p>Sign in as a worker or manager to view the scene review queue.</p>
        <Link className="button primary" to="/">
          Choose your workspace
        </Link>
      </section>
    );
  return <SceneView manager={identity.role === "supervisor"} />;
}
function SceneQueue({
  manager,
  children,
}: {
  manager: boolean;
  children: React.ReactNode;
}) {
  return manager ? (
    <IncidentScrollArea>{children}</IncidentScrollArea>
  ) : (
    <>{children}</>
  );
}
function SceneView({ manager }: { manager: boolean }) {
  const resource = useResource<Scene>("/fall-detection/state", 500),
    action = useAction();
  const [consent, setConsent] = useState(false),
    [preview, setPreview] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const scene = resource.data;
  const unresolved =
    scene?.incidents.filter((i) => ["open", "acknowledged"].includes(i.status))
      .length || 0;
  const reviewed = (scene?.incidents.length || 0) - unresolved;
  useEffect(() => {
    if (
      !scene?.canViewCamera ||
      !scene.cameraActive ||
      scene.status !== "running"
    ) {
      setPreview("");
      setPreviewError("");
      return;
    }
    let disposed = false,
      timer: ReturnType<typeof setTimeout>,
      objectUrl = "";
    const controller = new AbortController();
    async function frame() {
      try {
        const response = await fetch("/api/fall-detection/preview", {
          credentials: "same-origin",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(5000),
          ]),
        });
        if (!response.ok)
          throw Error(
            "Live feed unavailable. Incident monitoring status is shown separately.",
          );
        const blob = await response.blob();
        if (disposed) return;
        const next = URL.createObjectURL(blob);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = next;
        setPreview(next);
        setPreviewError("");
      } catch (error) {
        if (!disposed) {
          setPreview("");
          setPreviewError((error as Error).message);
        }
      } finally {
        if (!disposed) timer = setTimeout(() => void frame(), 500);
      }
    }
    void frame();
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [scene?.canViewCamera, scene?.cameraActive, scene?.status]);
  async function control(kind: "start" | "stop") {
    await action.run(async () => {
      await api(
        `/fall-detection/camera/${kind}`,
        kind === "start" ? { consent: true } : {},
      );
      setConsent(false);
      await resource.refresh();
    });
  }
  return (
    <>
      <PageHeading
        eyebrow="SITEGUARD / SCENE REVIEW"
        title="Fall detection"
        description="Watch the scene. Check an alert. Keep your team informed."
      />
      <ErrorNotice message={resource.error || action.error} />
      {resource.loading && <Loading />}
      {scene && (
        <>
          <div className="scene-stats" aria-label="Scene overview">
            <div>
              <Radio size={19} />
              <span>
                <small>MONITORING</small>
                <strong>
                  {scene.cameraActive && scene.status === "running"
                    ? "Camera live"
                    : "Camera offline"}
                </strong>
              </span>
            </div>
            <div>
              <ShieldAlert size={19} />
              <span>
                <small>NEEDS FOLLOW-UP</small>
                <strong>
                  {unresolved} {unresolved === 1 ? "incident" : "incidents"}
                </strong>
              </span>
            </div>
            <div>
              <ClipboardCheck size={19} />
              <span>
                <small>REVIEWED</small>
                <strong>
                  {reviewed} {reviewed === 1 ? "report" : "reports"}
                </strong>
              </span>
            </div>
          </div>
          <section className="card scene-camera-card">
            <div className="fall-heading">
              <h2>
                <Camera size={20} /> Scene monitoring
              </h2>
              <span className="badge">{scene.status}</span>
            </div>
            <p className="scene-camera-description">
              Live view shared with your team. Boxes show anonymous person
              tracking.
            </p>
            {scene.status === "unavailable" && (
              <p role="status">
                Camera service unavailable. Stored incident reports remain
                available.
              </p>
            )}
            {scene.delivery &&
              (!scene.delivery.configured ||
                scene.delivery.pending > 0 ||
                scene.delivery.error) && (
                <p role="status">
                  {scene.delivery.error ||
                    (!scene.delivery.configured
                      ? "Database delivery is not configured."
                      : `${scene.delivery.pending} observation(s) awaiting database confirmation.`)}
                </p>
              )}
            {
              <>
                <ErrorNotice message={previewError} />
                {preview && (
                  <div className="scene-feed">
                    <img
                      src={preview}
                      alt="Live scene camera feed"
                      className="scene-feed-image"
                    />
                    <svg
                      viewBox={`0 0 ${scene.frameSize?.[0] || 640} ${scene.frameSize?.[1] || 360}`}
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        pointerEvents: "none",
                      }}
                      aria-label="Anonymous person tracking boxes"
                    >
                      {scene.tracks?.map((track) => (
                        <g
                          key={track.trackId}
                          stroke={track.horizontal ? "#f59e0b" : "#2dd4bf"}
                          fill="none"
                        >
                          <rect
                            x={track.bbox[0]}
                            y={track.bbox[1]}
                            width={Math.max(0, track.bbox[2] - track.bbox[0])}
                            height={Math.max(0, track.bbox[3] - track.bbox[1])}
                            strokeWidth={3}
                          />
                          <text
                            x={track.bbox[0]}
                            y={Math.max(16, track.bbox[1] - 6)}
                            fill={track.horizontal ? "#f59e0b" : "#2dd4bf"}
                            stroke="none"
                            fontSize={16}
                          >
                            Person {track.trackId}
                            {track.horizontal ? " · horizontal" : ""}
                          </text>
                        </g>
                      ))}
                    </svg>
                  </div>
                )}
                {!preview && (
                  <div className="scene-feed-empty">
                    <VideoOff size={32} />
                    <h3>
                      {scene.cameraActive
                        ? "Connecting to the live view"
                        : "Camera is offline"}
                    </h3>
                    <p>
                      {scene.cameraActive
                        ? "Incident reports remain available while the feed connects."
                        : manager
                          ? "Inform everyone in view, then start monitoring."
                          : "A manager can start the camera. You can still review existing reports."}
                    </p>
                  </div>
                )}
                <div className="scene-camera-footer">
                  <Eye size={16} />
                  <span>Processed locally · video is not stored</span>
                  <span>Possible person-down alerts need a human check.</span>
                </div>
                {manager &&
                  scene.source !== "synthetic" &&
                  (scene.cameraActive ? (
                    <button
                      className="button secondary"
                      disabled={action.busy}
                      onClick={() => void control("stop")}
                    >
                      Stop camera
                    </button>
                  ) : (
                    <>
                      <label className="fall-camera-consent">
                        <input
                          type="checkbox"
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                        />{" "}
                        I confirm everyone in view has been informed and
                        consents to local monitoring.
                      </label>
                      <button
                        className="button primary"
                        disabled={!consent || action.busy}
                        onClick={() => void control("start")}
                      >
                        Start camera
                      </button>
                    </>
                  ))}
              </>
            }
          </section>
          <section className="card scene-queue">
            <div className="scene-queue-heading">
              <h2>
                Scene review queue ·{" "}
                {
                  scene.incidents.filter((i) =>
                    ["open", "acknowledged"].includes(i.status),
                  ).length
                }{" "}
                unresolved
              </h2>
              <span className="scene-shared-label">Shared with your team</span>
            </div>
            <p className="scene-queue-description">
              Review the scene, add a note, then resolve the report after
              checking.
            </p>
            {!scene.incidents.length && (
              <div className="scene-empty">
                <ClipboardCheck size={30} />
                <h3>No reports to review</h3>
                <p>New camera observations will appear here automatically.</p>
              </div>
            )}
            <SceneQueue manager={manager}>
              {[...scene.incidents]
                .sort(
                  (a, b) =>
                    Number(["open", "acknowledged"].includes(b.status)) -
                      Number(["open", "acknowledged"].includes(a.status)) ||
                    Date.parse(b.observedAt) - Date.parse(a.observedAt),
                )
                .map((incident) => (
                  <article
                    key={incident.id}
                    className={`fall-incident scene-incident scene-incident-${incident.status}`}
                  >
                    <div className="fall-heading">
                      <h3>Possible person down</h3>
                      <span
                        className={`badge scene-status scene-status-${incident.status}`}
                      >
                        {incident.status.replace("_", " ")}
                      </span>
                    </div>
                    <p className="scene-incident-meta">
                      {clock.format(new Date(incident.observedAt))} ·{" "}
                      {incident.zoneId} ·{" "}
                      {incident.durationSeconds === 0
                        ? "Flagged immediately"
                        : "Horizontal posture observed"}
                    </p>

                    {manager && incident.note && <p>{incident.note}</p>}
                    {incident.updates?.map((update) => (
                      <div key={update.id} className="scene-update">
                        <strong>{update.type.replaceAll("_", " ")}</strong>
                        <small>
                          {" "}
                          · {clock.format(new Date(update.createdAt))} ·{" "}
                          {update.actorRole === "supervisor"
                            ? "Manager"
                            : "Worker"}
                        </small>
                        <p>{update.note}</p>
                      </div>
                    ))}
                    <a
                      className="button secondary scene-emergency"
                      href="tel:911"
                    >
                      Call emergency services · 911 (US)
                    </a>
                    <p className="scene-emergency-hint">
                      <small>
                        Opens your device’s dialer. If calling is unsupported,
                        use a phone. Confirm below only after you have actually
                        contacted emergency services.
                      </small>
                    </p>
                    {
                      <>
                        <label className="fall-note">
                          Scene note (required to save or close)
                          <textarea
                            value={notes[incident.id] || ""}
                            maxLength={1000}
                            placeholder="What did you observe? What action did you take?"
                            rows={2}
                            onChange={(e) =>
                              setNotes({
                                ...notes,
                                [incident.id]: e.target.value,
                              })
                            }
                          />
                        </label>
                        <div className="button-row">
                          {(["open", "acknowledged"].includes(incident.status)
                            ? [
                                "add_note",
                                "acknowledge",
                                "resolve",
                                "false_alarm",
                                "emergency_called",
                              ]
                            : ["add_note", "emergency_called"]
                          ).map((kind) => (
                            <button
                              key={kind}
                              className={`button ${kind === "resolve" ? "primary" : "secondary"}`}
                              disabled={
                                action.busy ||
                                (kind !== "acknowledge" &&
                                  !notes[incident.id]?.trim())
                              }
                              onClick={() =>
                                void action.run(async () => {
                                  await api(
                                    `/safety/incidents/${incident.id}`,
                                    {
                                      action: kind,
                                      revision: incident.revision,
                                      note: notes[incident.id] || "",
                                    },
                                    "PATCH",
                                  );
                                  setNotes((current) => ({
                                    ...current,
                                    [incident.id]: "",
                                  }));
                                  await resource.refresh();
                                })
                              }
                            >
                              {kind === "acknowledge"
                                ? "Acknowledge"
                                : kind === "resolve"
                                  ? "Resolve after check"
                                  : kind === "add_note"
                                    ? "Save note"
                                    : kind === "emergency_called"
                                      ? "Confirm emergency services contacted"
                                      : "Mark false alarm"}
                            </button>
                          ))}
                        </div>
                      </>
                    }
                  </article>
                ))}
            </SceneQueue>
          </section>
        </>
      )}
    </>
  );
}
