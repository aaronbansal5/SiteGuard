import { useEffect } from "react";
import { Link } from "react-router-dom";
import { TriangleAlert, MapPin, Clock, Camera } from "lucide-react";
import { api, useAction, useResource } from "../lib/api";

type AlertIncident = {
  id: string;
  status: string;
  revision: number;
  zoneId: string;
  cameraId: string;
  observedAt: string;
};

/** Shared persisted incidents; viewing an alert never starts camera capture. */
export function GlobalSceneAlert() {
  const resource = useResource<{ incidents: AlertIncident[] }>(
    "/fall-detection/state", 500,
  );
  const action = useAction();
  const open = resource.data?.incidents.filter((incident) => incident.status === "open") ?? [];
  const alerting = open.length > 0;
  useEffect(() => {
    document.body.classList.toggle("fall-alert-active", alerting);
    return () => document.body.classList.remove("fall-alert-active");
  }, [alerting]);

  if (!alerting) return null;
  async function acknowledge(incident: AlertIncident) {
    await action.run(async () => {
      try {
        await api(`/safety/incidents/${incident.id}`, {
          action: "acknowledge", revision: incident.revision, note: "",
        }, "PATCH");
      } finally {
        await resource.refresh();
      }
    });
  }
  return (
    <section className="global-scene-alert" role="alert" aria-label="Site incident alert">
      <header className="scene-alert-heading">
        <span className="scene-alert-symbol"><TriangleAlert size={28} aria-hidden="true" /></span>
        <div>
          <h2>Possible person down</h2>
          <p>Check the location and get help if needed.</p>
        </div>
        <span className="scene-alert-count">{open.length} {open.length === 1 ? "new alert" : "new alerts"}</span>
      </header>
      <div className="scene-alert-reports" aria-label="Locations needing a check">
        {open.map((incident) => (
          <article className="scene-alert-report" key={incident.id}>
            <div className="scene-alert-location">
              <MapPin size={22} aria-hidden="true" />
              <div><span>Location</span><strong>{incident.zoneId?.trim() || "Location not configured"}</strong></div>
            </div>
            <div className="scene-alert-metadata">
              <span><Camera size={16} aria-hidden="true" />{incident.cameraId || "Camera not identified"}</span>
              <span><Clock size={16} aria-hidden="true" /><time dateTime={incident.observedAt}>{new Date(incident.observedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })}</time></span>
            </div>
            <button className="button scene-alert-acknowledge" disabled={action.busy} onClick={() => void acknowledge(incident)}>
              {action.busy ? "Acknowledging…" : open.length === 1 ? "Acknowledge alerts" : "Acknowledge this alert"}
            </button>
          </article>
        ))}
      </div>
      <footer className="scene-alert-footer">
        <div><p>Acknowledging stops the shared alert. It does not resolve the incident.</p><p className="scene-alert-caution">Camera observation; a fall or injury is not confirmed.</p></div>
        <Link to="/fall-detection" className="button scene-alert-review">View scene & follow up</Link>
      </footer>
      {action.error && <p className="scene-alert-error">{action.error} Check the report and try again.</p>}
    </section>
  );
}
