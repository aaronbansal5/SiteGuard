import { IncidentScrollArea } from "./IncidentScrollArea";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff, ArrowRight } from "lucide-react";
import {
  type SupervisorView,
  type SharedSessionRef,
} from "@siteguard/contracts";
import { api, useResource, useAction, time, date } from "../lib/api";
import { ErrorNotice, Loading, Modal } from "./ui";

const SYMPTOM_LABELS: Record<string, string> = {
  dizzy: "Feeling dizzy",
  nauseated: "Feeling nauseated",
  headache: "Headache",
  other: "Other",
};

/**
 * "What safety operations can see": the worker's mirror of the records about
 * them in the supervisor workspace (GET /workers/:id/supervisor-view), with a
 * control to withdraw sharing for a check-in. Withdrawal never changes
 * requests, symptom reports or protected breaks.
 */
export function SupervisorMirror({
  workerId,
  onChanged,
}: {
  workerId: string;
  onChanged?: () => void;
}) {
  const resource = useResource<{ view: SupervisorView }>(
    `/workers/${workerId}/supervisor-view`,
    5000,
  );
  const a = useAction();
  const [confirm, setConfirm] = useState<SharedSessionRef>();
  const [done, setDone] = useState("");
  const v = resource.data?.view;
  const open = v?.requests.filter(
    (r) => !["resolved", "declined"].includes(r.status),
  );
  return (
    <section
      className="card supervisor-mirror"
      aria-labelledby="supervisor-mirror-title"
    >
      <div className="card-header">
        <div>
          <h2 id="supervisor-mirror-title">Shared with your manager</h2>
          <p>Your check-ins are private unless you choose to share them.</p>
        </div>
        {v && <span className="badge">{v.sharedSessions.length} shared</span>}
      </div>
      <ErrorNotice message={resource.error || (confirm ? "" : a.error)} />
      {done && (
        <div className="notice success" role="status">
          <EyeOff size={18} />
          <span>{done}</span>
        </div>
      )}
      {!v ? (
        resource.loading && <Loading />
      ) : (
        <div>
          {v.sharedSessions.length ? (
            <IncidentScrollArea label="Shared check-ins, scroll for more">
              {[...v.sharedSessions]
                .sort(
                  (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
                )
                .map((s) => (
                  <div className="shared-session" key={s.id}>
                    <div>
                      <Link className="text-link" to={`/sessions/${s.id}`}>
                        {date(s.startedAt)} · {time(s.startedAt)}{" "}
                        <ArrowRight size={13} />
                      </Link>
                      <small>
                        {s.status === "active" ? "In progress · " : ""}
                        {s.linkedToRequest
                          ? "Shared with a request"
                          : "Manager can view this check-in"}
                      </small>
                    </div>

                    <button
                      className="button small-button secondary"
                      disabled={a.busy}
                      onClick={() => {
                        setDone("");
                        a.setError("");
                        setConfirm(s);
                      }}
                    >
                      <EyeOff size={14} />
                      Stop sharing
                    </button>
                  </div>
                ))}
            </IncidentScrollArea>
          ) : (
            <p className="muted">
              No check-ins shared. Your readings are private.
            </p>
          )}
          <p className="sharing-private-note">
            <EyeOff size={15} />
            Unshared readings and personal trends stay private. Check-in images
            and video are not stored.
          </p>
          <details className="sharing-details">
            <summary>
              <Eye size={15} />
              What else can my manager see?
            </summary>
            <p>
              Your break times, work assignments, and requests for rest or help.
            </p>
            <p>
              {v.breaks.length} scheduled{" "}
              {v.breaks.length === 1 ? "break" : "breaks"} · {open?.length || 0}{" "}
              open requests
            </p>
            {v.symptomReports.length > 0 && (
              <p>
                Symptoms you reported:{" "}
                {v.symptomReports
                  .map((s) =>
                    s.codes.map((c) => SYMPTOM_LABELS[c] || c).join(", "),
                  )
                  .join(" · ")}
                . Your submitted notes are also shared.
              </p>
            )}
          </details>
        </div>
      )}
      {confirm && (
        <Modal
          title="Stop sharing this check-in?"
          onClose={() => setConfirm(undefined)}
        >
          <p className="muted">
            Your manager will lose access to the readings from{" "}
            {date(confirm.startedAt)} · {time(confirm.startedAt)}. Your requests
            and breaks stay unchanged, and any open assistance request stays
            open. You cannot share this check-in again.
          </p>
          <ErrorNotice message={a.error} />
          <button
            className="button primary"
            disabled={a.busy}
            onClick={() =>
              void a.run(async () => {
                await api(
                  `/sessions/${confirm.id}/sharing`,
                  { shareWithSupervisor: false },
                  "PATCH",
                );
                setConfirm(undefined);
                setDone(
                  "Sharing stopped. Your manager can no longer view this check-in.",
                );
                await resource.refresh();
                onChanged?.();
              })
            }
          >
            {a.busy ? "Saving…" : "Stop sharing"}
          </button>
        </Modal>
      )}
    </section>
  );
}
