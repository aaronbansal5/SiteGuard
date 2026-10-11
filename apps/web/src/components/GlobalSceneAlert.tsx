import { useEffect } from "react";
import { Link } from "react-router-dom";
import { TriangleAlert } from "lucide-react";
import { api, useAction, useResource } from "../lib/api";

type AlertIncident = { id: string; status: string; revision: number };

/** One shared-site alert monitor for every authenticated screen. No camera capture. */
export function GlobalSceneAlert() {
  const resource = useResource<{ incidents: AlertIncident[] }>(
    "/fall-detection/state",
    500,
  );
  const action = useAction();
  const open =
    resource.data?.incidents.filter((incident) => incident.status === "open") ??
    [];
  const alerting = open.length > 0;
  useEffect(() => {
    document.body.classList.toggle("fall-alert-active", alerting);
    return () => document.body.classList.remove("fall-alert-active");
  }, [alerting]);

  if (!alerting) return null;
  return (
    <section
      className="fall-new-alert global-scene-alert"
      role="alert"
      aria-label="Site incident alert"
    >
      <TriangleAlert size={24} aria-hidden="true" />
      <div>
        <strong>Possible person down. Check the scene.</strong>
        <p>
          {open.length} {open.length === 1 ? "report needs" : "reports need"}{" "}
          acknowledgment.
        </p>
        {action.error && <p>{action.error}</p>}
      </div>
      <div className="global-scene-actions">
        <Link to="/fall-detection" className="button secondary">
          View scene
        </Link>
        <button
          className="button secondary"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              try {
                for (const incident of open) {
                  await api(
                    `/safety/incidents/${incident.id}`,
                    {
                      action: "acknowledge",
                      revision: incident.revision,
                      note: "",
                    },
                    "PATCH",
                  );
                }
              } finally {
                await resource.refresh();
              }
            })
          }
        >
          {action.busy ? "Acknowledging…" : "Acknowledge alerts"}
        </button>
      </div>
    </section>
  );
}
