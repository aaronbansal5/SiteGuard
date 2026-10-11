import { IncidentScrollArea } from "./IncidentScrollArea";
import { useState } from "react";
import type { Worker } from "@siteguard/contracts";
import { api, useAction, useResource, time } from "../lib/api";
import { ErrorNotice, Loading, Modal } from "./ui";
type Incident = {
  id: string;
  cameraId: string;
  zoneId: string;
  source: string;
  status: "open" | "acknowledged" | "resolved" | "false_alarm";
  trackId: string;
  observedAt: string;
  durationSeconds: number;
  workerId: string | null;
  assistanceRequestId: string | null;
  revision: number;
};
type Action = "acknowledge" | "associate" | "resolve" | "false_alarm";
export function SafetyIncidentsPanel() {
  const resource = useResource<{ incidents: Incident[] }>(
    "/safety/incidents",
    2000,
  );
  const workers = useResource<{ workers: Worker[] }>("/workers");
  const action = useAction();
  const [selected, setSelected] = useState<{
    incident: Incident;
    action: Action;
  }>();
  const [note, setNote] = useState("");
  const [workerId, setWorkerId] = useState("");
  const choose = (incident: Incident, kind: Action) => {
    setSelected({ incident, action: kind });
    setNote("");
    setWorkerId("");
    action.setError("");
  };
  return (
    <section className="card">
      <div className="section-title">
        <h2>Possible person down</h2>
        <span className="badge">Human review required</span>
      </div>
      <p className="muted">
        Camera observations are anonymous and do not confirm a fall.
        Acknowledgment does not clear assistance.
      </p>
      <ErrorNotice message={resource.error} />
      {resource.loading ? (
        <Loading />
      ) : !resource.data?.incidents.length ? (
        <p>No camera incidents recorded.</p>
      ) : (
        <IncidentScrollArea>
          {[...resource.data.incidents]
            .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))
            .map((incident) => (
              <article className="notice" key={incident.id}>
                <div>
                  <strong>
                    {incident.zoneId} · {incident.cameraId}
                  </strong>
                  <p>
                    {time(incident.observedAt)} · Track {incident.trackId} ·{" "}
                    {incident.durationSeconds.toFixed(1)} seconds · Source:{" "}
                    {incident.source}
                  </p>
                  <p>
                    Status: {incident.status.replaceAll("_", " ")}{" "}
                    {incident.workerId &&
                      `· Worker: ${workers.data?.workers.find((w) => w.id === incident.workerId)?.displayName || incident.workerId}`}
                  </p>
                  {!["resolved", "false_alarm"].includes(incident.status) && (
                    <div className="button-row">
                      {incident.status === "open" && (
                        <button
                          className="button secondary"
                          onClick={() => choose(incident, "acknowledge")}
                        >
                          Acknowledge incident
                        </button>
                      )}
                      {!incident.workerId && (
                        <button
                          className="button secondary"
                          onClick={() => choose(incident, "associate")}
                        >
                          Associate worker
                        </button>
                      )}
                      <button
                        className="button secondary"
                        onClick={() => choose(incident, "resolve")}
                      >
                        Resolve incident
                      </button>
                      <button
                        className="button secondary"
                        onClick={() => choose(incident, "false_alarm")}
                      >
                        Mark false alarm
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
        </IncidentScrollArea>
      )}
      {selected && (
        <Modal
          title={
            selected.action === "associate"
              ? "Associate worker after checking scene"
              : "Record incident action"
          }
          onClose={() => {
            if (!action.busy) setSelected(undefined);
          }}
        >
          <p>
            Camera track IDs are not worker identities. Linking a worker creates
            assistance; incident actions never automatically clear that
            assistance.
          </p>
          {selected.action === "associate" && (
            <label>
              Worker
              <select
                value={workerId}
                onChange={(e) => setWorkerId(e.target.value)}
              >
                <option value="">Select verified worker</option>
                {workers.data?.workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.displayName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Action note
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
            />
          </label>
          <ErrorNotice message={action.error || workers.error} />
          <button
            className="button primary"
            disabled={
              action.busy ||
              !note.trim() ||
              (selected.action === "associate" && !workerId)
            }
            onClick={() =>
              void action.run(async () => {
                await api(
                  `/safety/incidents/${selected.incident.id}`,
                  {
                    action: selected.action,
                    revision: selected.incident.revision,
                    note: note.trim(),
                    ...(selected.action === "associate" ? { workerId } : {}),
                  },
                  "PATCH",
                );
                setSelected(undefined);
                await resource.refresh();
              })
            }
          >
            {action.busy ? "Saving…" : "Confirm incident action"}
          </button>
        </Modal>
      )}
    </section>
  );
}
