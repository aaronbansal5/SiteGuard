import { IncidentScrollArea } from "../components/IncidentScrollArea";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Users,
  LockKeyhole,
  Clock,
  HandHelping,
  ArrowRight,
  Check,
} from "lucide-react";
import type { Overview, RestRequest } from "@siteguard/contracts";

import { api, useResource, useAction, time } from "../lib/api";
import {
  PageHeading,
  Loading,
  ErrorNotice,
  Modal,
  SYMPTOM_LABELS,
} from "../components/ui";
import { ScheduleTimeline } from "../components/ScheduleTimeline";
import { SafetyIncidentsPanel } from "../components/SafetyIncidentsPanel";
import { InvitationsPanel } from "../components/InvitationsPanel";
export function Supervisor() {
  return <Operations />;
}
function Operations() {
  const resource = useResource<Overview>("/supervisor/overview", 2000),
    a = useAction();
  const [selected, setSelected] = useState<{
      request: RestRequest;
      action: "acknowledge" | "approve" | "resolve" | "decline";
    }>(),
    [note, setNote] = useState("");
  const o = resource.data;
  const choose = (
    request: RestRequest,
    action: NonNullable<typeof selected>["action"],
  ) => {
    setNote(
      action === "acknowledge"
        ? "Acknowledged; human follow-up is pending."
        : action === "approve"
          ? "Additional rest approved."
          : "",
    );
    a.setError("");
    setSelected({ request, action });
  };
  const selectedCurrent =
    selected && o?.requests.find((r) => r.id === selected.request.id);
  const staleSelection =
    !!selected &&
    !!o &&
    (!selectedCurrent ||
      selectedCurrent.revision !== selected.request.revision);
  const perform = () =>
    a.run(async () => {
      if (!selected || staleSelection)
        throw new Error(
          "This request changed. Close the dialog and review its current status.",
        );
      const r = selected.request;
      const protectedEnd = Math.max(
        Date.now(),
        ...(o?.breaks
          .filter(
            (b) =>
              b.workerId === r.workerId &&
              b.kind === "protected" &&
              Date.parse(b.endsAt) > Date.now() &&
              Date.parse(b.startsAt) <= Date.now(),
          )
          .map((b) => Date.parse(b.endsAt)) || []),
      );
      const body = {
        action: selected!.action,
        revision: r.revision,
        note,
        ...(selected!.action === "approve"
          ? {
              restStartsAt: new Date(protectedEnd).toISOString(),
              restEndsAt: new Date(
                protectedEnd + r.requestedMinutes! * 60000,
              ).toISOString(),
            }
          : {}),
      };
      await api(`/rest-requests/${r.id}`, body, "PATCH");
      setSelected(undefined);
      await resource.refresh();
    });
  return (
    <>
      <PageHeading
        eyebrow="SAFETY OPERATIONS / NORTH YARD"
        title="Worker health & site monitoring"
        description="Review check-ins, respond to requests, and keep protected breaks in place."
      />
      <InvitationsPanel />
      <SafetyIncidentsPanel />
      <ErrorNotice message={resource.error || a.error} />
      {resource.loading && !o ? (
        <Loading />
      ) : (
        o && (
          <>
            <div className="stats-grid three">
              <section className="card stat">
                <span>
                  <Users size={18} />
                  Workforce
                </span>
                <strong>
                  {o.workers.length}
                  <small>workers</small>
                </strong>
                <p>Fictional North Yard crew</p>
              </section>
              <section className="card stat">
                <span>
                  <LockKeyhole size={18} />
                  Protected breaks
                </span>
                <strong>
                  {o.breaks.filter((b) => b.kind === "protected").length}
                  <small>preserved</small>
                </strong>
                <p>Scheduled breaks stay protected</p>
              </section>
              <section className="card stat">
                <span>
                  <HandHelping size={18} />
                  Open requests
                </span>
                <strong>
                  {
                    o.requests.filter(
                      (r) => !["resolved", "declined"].includes(r.status),
                    ).length
                  }
                  <small>need follow-up</small>
                </strong>
                <p>Close requests only after following up</p>
              </section>
            </div>
            <ScheduleTimeline overview={o} />
            <section className="card">
              <div className="card-header">
                <div>
                  <h2>Check-ins shared with you</h2>
                  <p>
                    Only sessions the worker explicitly shared for this
                    check-in. Measurements are observations, not clearance.
                  </p>
                </div>
              </div>
              {o.sharedSessions?.length ? (
                <IncidentScrollArea
                  className="request-list"
                  label="Shared check-ins, scroll for more"
                >
                  {[...o.sharedSessions]
                    .sort(
                      (a, b) =>
                        Date.parse(b.startedAt) - Date.parse(a.startedAt),
                    )
                    .map((session) => (
                      <article className="request-item" key={session.id}>
                        <div>
                          <strong>
                            {o.workers.find((w) => w.id === session.workerId)
                              ?.displayName ?? session.workerId}
                          </strong>
                          <p>
                            {time(session.startedAt)} ·{" "}
                            {session.source === "presage"
                              ? "Presage camera"
                              : "Synthetic demo"}
                          </p>
                        </div>
                        <Link
                          className="text-link"
                          to={`/sessions/${session.id}`}
                        >
                          View detailed readings <ArrowRight size={14} />
                        </Link>
                      </article>
                    ))}
                </IncidentScrollArea>
              ) : (
                <p className="muted">
                  No completed check-ins have been shared with safety
                  operations.
                </p>
              )}
            </section>
            <div className="operations-requests">
              <section className="card request-card">
                <div className="card-header">
                  <div>
                    <h2>Break &amp; assistance requests</h2>
                    <p>
                      Workers ask for extra rest or help from their worker
                      portal. Review each request and record your response.
                    </p>
                  </div>
                  <span className="badge amber">
                    {
                      o.requests.filter(
                        (r) => !["resolved", "declined"].includes(r.status),
                      ).length
                    }{" "}
                    need follow-up
                  </span>
                </div>
                {o.requests.length ? (
                  o.requests
                    .slice()
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                    .map((r) => (
                      <article
                        className={`request ${r.kind === "assistance" ? "assistance-request" : ""}`}
                        key={r.id}
                      >
                        <div className="row-between">
                          <strong>
                            {
                              o.workers.find((w) => w.id === r.workerId)
                                ?.displayName
                            }
                          </strong>
                          <span
                            className={`badge ${r.status === "pending" ? "amber" : ""}`}
                          >
                            {r.status}
                          </span>
                        </div>
                        <h3>
                          {r.kind === "assistance" ? (
                            <>
                              <HandHelping size={17} />
                              Help requested
                            </>
                          ) : (
                            <>
                              <Clock size={17} />
                              Extra break requested · {r.requestedMinutes}{" "}
                              minutes
                            </>
                          )}
                        </h3>
                        <p>
                          {time(r.createdAt)} ·{" "}
                          {r.kind === "assistance"
                            ? "Check on the worker. Acknowledging the request does not close it."
                            : "Approve extra rest. Scheduled protected breaks stay unchanged."}
                        </p>
                        {o.symptomReports
                          .filter((s) => s.assistanceRequestId === r.id)
                          .map((s) => (
                            <div className="request-note" key={s.id}>
                              Reported:{" "}
                              {s.codes
                                .map((c) => SYMPTOM_LABELS[c] ?? c)
                                .join(", ")}
                              {s.note ? ` · ${s.note}` : ""}
                            </div>
                          ))}
                        {r.restStartsAt && (
                          <p>
                            Approved rest: {time(r.restStartsAt)}–
                            {time(r.restEndsAt!)}
                          </p>
                        )}
                        {r.note && <div className="request-note">{r.note}</div>}
                        {r.kind === "additional_rest" &&
                          r.sessionId &&
                          o.restRecommendations?.find(
                            (recommendation) =>
                              recommendation.sessionId === r.sessionId,
                          ) && (
                            <div className="request-note">
                              Worker-shared support suggestion:{" "}
                              {
                                o.restRecommendations.find(
                                  (recommendation) =>
                                    recommendation.sessionId === r.sessionId,
                                )!.suggestedMinutes
                              }{" "}
                              minutes. This is non-diagnostic guidance only;
                              supervisor approval and scheduling are required.
                            </div>
                          )}
                        <div className="request-actions">
                          {!["resolved", "declined"].includes(r.status) && (
                            <>
                              {r.status === "pending" && (
                                <button
                                  className="button small-button secondary"
                                  disabled={a.busy}
                                  onClick={() => choose(r, "acknowledge")}
                                >
                                  Acknowledge
                                </button>
                              )}
                              {r.kind === "additional_rest" &&
                                ["pending", "acknowledged"].includes(
                                  r.status,
                                ) && (
                                  <>
                                    <button
                                      className="button small-button primary"
                                      disabled={a.busy}
                                      onClick={() => choose(r, "approve")}
                                    >
                                      Approve rest
                                    </button>
                                    <button
                                      className="button small-button ghost"
                                      disabled={a.busy}
                                      onClick={() => choose(r, "decline")}
                                    >
                                      Decline
                                    </button>
                                  </>
                                )}
                              <button
                                className="button small-button secondary"
                                disabled={a.busy}
                                onClick={() => choose(r, "resolve")}
                              >
                                Resolve with note
                              </button>
                            </>
                          )}
                          {r.sessionId &&
                            o.sharedSessionIds.includes(r.sessionId) && (
                              <Link
                                className="text-link"
                                to={`/sessions/${r.sessionId}`}
                              >
                                Shared summary <ArrowRight size={12} />
                              </Link>
                            )}
                        </div>
                      </article>
                    ))
                ) : (
                  <div className="empty-state">
                    <Check size={30} />
                    <h3>No break or assistance requests</h3>
                    <p>
                      Requests for extra rest or help appear here when a worker
                      submits them.
                    </p>
                  </div>
                )}
              </section>
            </div>
          </>
        )
      )}
      {selected && (
        <Modal
          title={
            selected.action === "approve"
              ? "Approve additional rest"
              : selected.action === "resolve"
                ? "Resolve worker request"
                : selected.action === "decline"
                  ? "Decline additional rest"
                  : "Acknowledge worker request"
          }
          onClose={() => setSelected(undefined)}
        >
          <p className="muted">
            {selected.action === "approve"
              ? "Additional rest begins after the current protected break, or now if no break is active."
              : selected.action === "resolve"
                ? "Record the human follow-up before explicitly clearing this request. The planner will not resolve it for you."
                : "Acknowledgment does not clear an assistance request or its staffing block."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void perform();
            }}
          >
            <label>
              Supervisor note
              <textarea
                required
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <ErrorNotice
              message={
                staleSelection
                  ? "This request changed. Close this dialog and review its current status."
                  : a.error
              }
            />
            <button
              className="button primary"
              disabled={a.busy || staleSelection || !note.trim()}
            >
              {a.busy ? "Saving…" : "Confirm " + selected.action}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
