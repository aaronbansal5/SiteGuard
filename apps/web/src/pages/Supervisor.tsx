import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Users,
  Clock,
  HandHelping,
  LockKeyhole,
  ArrowRight,
  Check,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import type {
  Overview,
  RestRequest,
  Assignment,
  Gap,
  Explanation,
} from "@siteguard/contracts";
import { useIdentity } from "../App";
import { api, useResource, useAction, time } from "../lib/api";
import {
  PageHeading,
  Loading,
  ErrorNotice,
  Modal,
  SafetyNote,
  SYMPTOM_LABELS,
} from "../components/ui";
import { ScheduleTimeline } from "../components/ScheduleTimeline";
import { IntegrationsPanel } from "../components/IntegrationsPanel";
type Proposal = {
  baseRevision: number;
  assignments: Assignment[];
  coverageGaps: Gap[];
};
export function Supervisor() {
  const { identity, login } = useIdentity(),
    a = useAction();
  if (identity?.role !== "supervisor")
    return (
      <section className="card empty-state">
        <Users size={32} />
        <h1>Safety operations workspace</h1>
        <p>
          Enter the supervisor demo to review requests and coordinate coverage.
        </p>
        <ErrorNotice message={a.error} />
        <button
          className="button primary"
          disabled={a.busy}
          onClick={() =>
            void a.run(async () => {
              await login({ role: "supervisor" });
            })
          }
        >
          Enter supervisor demo <ArrowRight size={17} />
        </button>
      </section>
    );
  return <Operations />;
}
function Operations() {
  const resource = useResource<Overview>("/supervisor/overview", 2000),
    a = useAction();
  const [proposal, setProposal] = useState<Proposal>(),
    [selected, setSelected] = useState<{
      request: RestRequest;
      action: "acknowledge" | "approve" | "resolve" | "decline";
    }>(),
    [note, setNote] = useState(""),
    [explanation, setExplanation] = useState<Explanation>(),
    [committed, setCommitted] = useState(false),
    [reset, setReset] = useState(false);
  const o = resource.data;
  const choose = (
    request: RestRequest,
    action: NonNullable<typeof selected>["action"],
  ) => {
    setNote(
      action === "acknowledge"
        ? "Acknowledged; human follow-up is pending."
        : action === "approve"
          ? "Additional rest approved; staffing coverage will be adjusted."
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
  const staleProposal =
    !!proposal && !!o && proposal.baseRevision !== o.scheduleRevision;
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
      setProposal(undefined);
      setCommitted(false);
      await resource.refresh();
    });
  return (
    <>
      <PageHeading
        eyebrow="SAFETY OPERATIONS / NORTH YARD"
        title="People first. Coverage follows."
        description="Respond to worker needs and coordinate around protected breaks."
        action={
          <button
            className="button secondary"
            disabled={a.busy}
            onClick={() =>
              void a.run(async () => {
                setProposal(await api<Proposal>("/schedule/preview", {}));
                setCommitted(false);
              })
            }
          >
            <RefreshCw size={16} /> Plan coverage
          </button>
        }
      />
      <IntegrationsPanel />
      <ErrorNotice message={resource.error || a.error} />
      {resource.loading && !o ? (
        <Loading />
      ) : (
        o && (
          <>
            <div className="stats-grid four">
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
                <p>Immutable minimum constraints</p>
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
                <p>Assistance never auto-resolves</p>
              </section>
              <section className="card stat">
                <span>
                  <Clock size={18} />
                  Coverage gaps
                </span>
                <strong>
                  {o.coverageGaps.length}
                  <small>intervals</small>
                </strong>
                <p>
                  {o.coverageGaps.length
                    ? "Preview a coverage adjustment"
                    : "Current task coverage is complete"}
                </p>
              </section>
            </div>
            <ScheduleTimeline overview={o} />
            <div className="two-columns operations-columns">
              <section className="card request-card">
                <div className="card-header">
                  <div>
                    <h2>Worker requests</h2>
                    <p>Operational needs, without physiological histories.</p>
                  </div>
                  <span className="badge amber">
                    {
                      o.requests.filter(
                        (r) => !["resolved", "declined"].includes(r.status),
                      ).length
                    }{" "}
                    open
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
                              Human assistance requested
                            </>
                          ) : (
                            <>
                              <Clock size={17} />
                              {r.requestedMinutes} minutes additional rest
                            </>
                          )}
                        </h3>
                        <p>
                          {time(r.createdAt)} ·{" "}
                          {r.kind === "assistance"
                            ? "Human follow-up required. Acknowledgment retains the staffing block."
                            : "Coordinate rest and coverage; protected breaks remain intact."}
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
                    <h3>No requests waiting</h3>
                    <p>Worker requests will appear here automatically.</p>
                  </div>
                )}
              </section>
              <div>
                <section className="card">
                  <div className="card-header">
                    <div>
                      <h2>Coverage coordination</h2>
                      <p>Reassign tasks, preserve required rest.</p>
                    </div>
                  </div>
                  <div className="planner-steps">
                    <div>
                      <span>1</span>
                      <p>
                        Respect protected breaks and unresolved worker needs.
                      </p>
                    </div>
                    <div>
                      <span>2</span>
                      <p>
                        Match available, qualified workers to task intervals.
                      </p>
                    </div>
                    <div>
                      <span>3</span>
                      <p>Review the proposal. Commit with a revision check.</p>
                    </div>
                  </div>
                  <button
                    className="button secondary full"
                    disabled={a.busy}
                    onClick={() =>
                      void a.run(async () => {
                        setProposal(
                          await api<Proposal>("/schedule/preview", {}),
                        );
                        setCommitted(false);
                      })
                    }
                  >
                    Preview coverage proposal <ArrowRight size={16} />
                  </button>
                  {proposal && (
                    <div className="proposal" role="status">
                      <h3>
                        {staleProposal
                          ? "Proposal needs refreshing"
                          : "Proposal ready"}
                      </h3>
                      {staleProposal && (
                        <p>
                          The schedule changed. Preview coverage again before
                          committing.
                        </p>
                      )}
                      <p>
                        {proposal.assignments.length} assignment{" "}
                        {proposal.assignments.length === 1
                          ? "interval"
                          : "intervals"}{" "}
                        · {proposal.coverageGaps.length} remaining{" "}
                        {proposal.coverageGaps.length === 1 ? "gap" : "gaps"}
                      </p>
                      <p className="fine-print">
                        Revision {proposal.baseRevision}. No break or assistance
                        request will be changed.
                      </p>
                      <button
                        className="button primary full"
                        disabled={a.busy || staleProposal}
                        onClick={() =>
                          void a.run(async () => {
                            const result = await api<{ auditEventId: string }>(
                              "/schedule/commit",
                              {
                                baseRevision: proposal.baseRevision,
                                assignments: proposal.assignments,
                              },
                            );
                            setProposal(undefined);
                            setCommitted(true);
                            await resource.refresh();
                            setExplanation(
                              await api<Explanation>("/insights/explain", {
                                kind: "schedule",
                                auditEventId: result.auditEventId,
                              }),
                            );
                          })
                        }
                      >
                        Commit coverage proposal <Check size={16} />
                      </button>
                    </div>
                  )}
                  {committed && (
                    <div className="notice success">
                      <Check size={17} />
                      Coverage updated. Protected breaks preserved.
                    </div>
                  )}
                </section>
                {explanation && (
                  <section className="card explanation">
                    <div className="card-header">
                      <h2>Why coverage changed</h2>
                      <span className="badge">
                        {explanation.origin === "gemini"
                          ? "Gemini fact selection"
                          : "Deterministic explanation"}
                      </span>
                    </div>
                    {explanation.observations.map((p) => (
                      <p key={p}>{p}</p>
                    ))}
                  </section>
                )}
                <section className="card">
                  <div className="card-header">
                    <h2>Tasks & remaining gaps</h2>
                  </div>
                  {o.tasks.map((t) => (
                    <div className="task-row" key={t.id}>
                      <strong>{t.label}</strong>
                      <small>
                        {t.staffingRequired}{" "}
                        {t.staffingRequired === 1 ? "worker" : "workers"} ·{" "}
                        {t.requiredSkills.join(", ")}
                      </small>
                    </div>
                  ))}
                  {o.coverageGaps.length ? (
                    <div className="gap-list">
                      {o.coverageGaps.map((g, i) => (
                        <p key={i}>
                          <AlertCircle size={14} />
                          {o.tasks.find((t) => t.id === g.taskId)?.label}:{" "}
                          {time(g.startsAt)}–{time(g.endsAt)} ·{" "}
                          {g.missingWorkers} unfilled
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">
                      No uncovered intervals in the current plan.
                    </p>
                  )}
                </section>
              </div>
            </div>
            <div className="demo-controls">
              <span>Local demo controls · fictional data only</span>
              <button className="text-button" onClick={() => setReset(true)}>
                Reset demonstration
              </button>
            </div>
          </>
        )
      )}
      <SafetyNote />
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
              ? "Additional rest begins after the current protected break, or now if no break is active. Review task coverage after approval."
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
      {reset && (
        <Modal
          title="Reset local demonstration"
          onClose={() => setReset(false)}
        >
          <p>
            Recreate the fictional workforce, protected schedule, and synthetic
            history. Stop active check-ins first. Real measurements cannot be
            deleted by this control.
          </p>
          <ErrorNotice message={a.error} />
          <button
            className="button primary"
            disabled={a.busy}
            onClick={() =>
              void a.run(async () => {
                await api("/demo/reset", {});
                setReset(false);
                setProposal(undefined);
                setExplanation(undefined);
                setCommitted(false);
                await resource.refresh();
              })
            }
          >
            Reset fictional demo
          </button>
        </Modal>
      )}
    </>
  );
}
