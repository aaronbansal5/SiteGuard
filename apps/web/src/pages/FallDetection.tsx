import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Camera, ShieldAlert } from "lucide-react";
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
function SceneView({ manager }: { manager: boolean }) {
  const resource = useResource<Scene>("/fall-detection/state", 500),
    action = useAction();
  const [consent, setConsent] = useState(false),
    [preview, setPreview] = useState("");
  const [previewError, setPreviewError] = useState(""),
    [alert, setAlert] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const seen = useRef<Set<string> | null>(null);
  const alertTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(alertTimer.current), []);
  const scene = resource.data;
  useEffect(() => {
    if (!scene) return;
    const fresh = scene.incidents.filter(
      (i) => i.status === "open" && seen.current && !seen.current.has(i.id),
    );
    seen.current = new Set([
      ...(seen.current || []),
      ...scene.incidents.map((i) => i.id),
    ]);
    if (!fresh.length) return;
    setAlert(
      `${fresh.length} new possible person-down observation(s). Check the scene.`,
    );
    clearTimeout(alertTimer.current);
    alertTimer.current = setTimeout(() => setAlert(""), 10000);
  }, [scene]);
  useEffect(() => {
    if (!manager || !scene?.cameraActive || scene.status !== "running") {
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
  }, [manager, scene?.cameraActive, scene?.status]);
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
        description="Shared incident visibility. Live camera access is reserved for managers."
      />
      {alert && (
        <div className="fall-new-alert" role="alert">
          {alert}
        </div>
      )}
      <ErrorNotice message={resource.error || action.error} />
      {resource.loading && <Loading />}
      {scene && (
        <>
          <section className="card" style={{ marginBottom: 20 }}>
            <div className="fall-heading">
              <h2>
                <Camera size={20} /> Scene monitoring
              </h2>
              <span className="badge">
                {scene.source === "synthetic"
                  ? "Synthetic demo"
                  : scene.source === "recorded_fixture"
                    ? "Recorded fixture"
                    : "Camera heuristic"}{" "}
                · {scene.status}
              </span>
            </div>
            <p>
              A valid person box must stay wider than tall for more than two
              seconds. This heuristic does not confirm a fall or injury.
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
            {manager ? (
              <>
                <ErrorNotice message={previewError} />
                {preview && (
                  <div style={{ position: "relative", maxWidth: 960 }}>
                    <img
                      src={preview}
                      alt="Manager-only live scene camera feed"
                      style={{ display: "block", width: "100%" }}
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
                {!scene.cameraActive && (
                  <p>
                    Camera is off. Tell everyone in view before starting. Frames
                    are processed locally and are not stored.
                  </p>
                )}
                {scene.source !== "synthetic" &&
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
            ) : (
              <p>
                Camera {scene.cameraActive ? "active" : "off"}. Your workspace
                shows incident status; managers handle the live feed and scene
                follow-up.
              </p>
            )}
          </section>
          <section className="card">
            <h2>
              Scene review queue ·{" "}
              {
                scene.incidents.filter((i) =>
                  ["open", "acknowledged"].includes(i.status),
                ).length
              }{" "}
              unresolved
            </h2>
            {!scene.incidents.length && <p>No incident reports yet.</p>}
            {scene.incidents.map((incident) => (
              <article key={incident.id} className="fall-incident">
                <div className="fall-heading">
                  <h3>Possible person down</h3>
                  <span className="badge">
                    {incident.status.replace("_", " ")}
                  </span>
                </div>
                <p>
                  {clock.format(new Date(incident.observedAt))} ·{" "}
                  {incident.zoneId} · {incident.durationSeconds.toFixed(1)}{" "}
                  seconds horizontal
                </p>
                <small>
                  {incident.source === "synthetic"
                    ? "Synthetic observation"
                    : incident.source === "recorded_fixture"
                      ? "Recorded fixture"
                      : "Camera observation"}
                </small>
                {manager && incident.note && <p>{incident.note}</p>}
                {manager &&
                  ["open", "acknowledged"].includes(incident.status) && (
                    <>
                      <label className="fall-note">
                        Follow-up note (required to close)
                        <textarea
                          value={notes[incident.id] || ""}
                          maxLength={1000}
                          onChange={(e) =>
                            setNotes({
                              ...notes,
                              [incident.id]: e.target.value,
                            })
                          }
                        />
                      </label>
                      <div className="button-row">
                        {["acknowledge", "resolve", "false_alarm"].map(
                          (kind) => (
                            <button
                              key={kind}
                              className="button secondary"
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
                                  await resource.refresh();
                                })
                              }
                            >
                              {kind === "acknowledge"
                                ? "Acknowledge"
                                : kind === "resolve"
                                  ? "Resolve after check"
                                  : "Mark false alarm"}
                            </button>
                          ),
                        )}
                      </div>
                    </>
                  )}
              </article>
            ))}
          </section>
        </>
      )}
    </>
  );
}
