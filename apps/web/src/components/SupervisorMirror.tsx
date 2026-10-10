import { useState } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff, ArrowRight } from "lucide-react";
import {
  SUPERVISOR_NEVER_SEES,
  type SupervisorView,
  type SharedSessionRef,
} from "@siteguard/contracts";
import { api, useResource, useAction, time, date } from "../lib/api";
import { ErrorNotice, Loading, Modal } from "./ui";
import { SourceBadge } from "./SourceBadge";

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
          <h2 id="supervisor-mirror-title">What safety operations can see</h2>
          <p>
            Built from the same records the supervisor workspace receives, so
            you can check it yourself.
          </p>
        </div>
        {v && <span className="badge">Checked {time(v.generatedAt)}</span>}
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
        <div className="mirror-columns">
          <div>
            <h3>
              <Eye size={16} /> Visible to safety operations
            </h3>
            <ul className="mirror-list">
              <li>
                <strong>Breaks</strong>
                <span>
                  {v.breaks.length
                    ? v.breaks
                        .map(
                          (b) =>
                            `${b.kind === "protected" ? "Protected" : "Additional"} ${time(b.startsAt)}–${time(b.endsAt)}`,
                        )
                        .join(" · ")
                    : "None scheduled"}
                </span>
              </li>
              <li>
                <strong>Task assignments</strong>
                <span>
                  {v.assignments.length
                    ? `${v.assignments.length} interval${v.assignments.length === 1 ? "" : "s"}: ${v.tasks.map((t) => t.label).join(", ")}`
                    : "None right now"}
                </span>
              </li>
              <li>
                <strong>Your requests</strong>
                <span>
                  {v.requests.length
                    ? `${v.requests.length} total, ${open!.length} open. Supervisors see the kind, status and their notes.`
                    : "None"}
                </span>
              </li>
              <li>
                <strong>Symptom reports</strong>
                <span>
                  {v.symptomReports.length
                    ? v.symptomReports
                        .map(
                          (s) =>
                            `${s.codes.map((c) => SYMPTOM_LABELS[c] ?? c).join(", ")}${s.note ? ` (your note: "${s.note}")` : ""}`,
                        )
                        .join(" · ")
                    : "None"}
                </span>
              </li>
              <li>
                <strong>Shared check-ins</strong>
                {v.sharedSessions.length ? (
                  <span>
                    The summary of pulse and breathing changes for{" "}
                    {v.sharedSessions.length === 1
                      ? "this check-in"
                      : "these check-ins"}
                    :
                  </span>
                ) : (
                  <span>None. Your check-in observations stay with you.</span>
                )}
              </li>
            </ul>
            {v.sharedSessions.map((s) => (
              <div className="shared-session" key={s.id}>
                <div>
                  <Link className="text-link" to={`/sessions/${s.id}`}>
                    {date(s.startedAt)} · {time(s.startedAt)}{" "}
                    <ArrowRight size={13} />
                  </Link>
                  <small>
                    {s.status === "active" ? "In progress · " : ""}
                    {s.linkedToRequest
                      ? "Linked from one of your requests"
                      : "Openable by safety operations"}
                  </small>
                </div>
                <SourceBadge source={s.source} />
                <button
                  className="button small-button secondary"
                  disabled={a.busy}
                  onClick={() => {
                    setDone("");
                    a.setError("");
                    setConfirm(s);
                  }}
                >
                  <EyeOff size={14} /> Stop sharing
                </button>
              </div>
            ))}
          </div>
          <div>
            <h3>
              <EyeOff size={16} /> Never sent to safety operations
            </h3>
            <ul className="mirror-list never">
              {SUPERVISOR_NEVER_SEES.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {confirm && (
        <Modal
          title="Stop sharing this check-in?"
          onClose={() => setConfirm(undefined)}
        >
          <p className="muted">
            Safety operations will no longer be able to open the observations
            from {date(confirm.startedAt)} · {time(confirm.startedAt)}. Your
            requests, symptom reports and protected breaks stay exactly as they
            are, and any open assistance request stays open. You cannot turn
            sharing back on for this check-in.
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
                  "Sharing stopped. Safety operations can no longer open that check-in.",
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
