import { Link } from "react-router-dom";
import { Coffee, ArrowRight, Clock, Activity, LockKeyhole } from "lucide-react";
import type {
  Break,
  Session,
  Summary,
  RestRequest,
} from "@siteguard/contracts";
import { useIdentity } from "../App";
import { useResource, time, number, date } from "../lib/api";
import {
  PageHeading,
  HelpActions,
  ErrorNotice,
  Loading,
  SafetyNote,
} from "../components/ui";
import { SourceBadge } from "../components/SourceBadge";
import { SupervisorMirror } from "../components/SupervisorMirror";
export function WorkerHome() {
  const { identity } = useIdentity();
  if (identity?.role !== "worker") return <ChooseWorker />;
  return <Worker key={identity.workerId} workerId={identity.workerId} />;
}
export function ChooseWorker() {
  return (
    <div className="card empty-state">
      <Activity size={30} />
      <h1>Choose a worker to continue</h1>
      <p>Your check-ins and history stay in your worker workspace.</p>
      <Link className="button primary" to="/">
        Choose demo worker <ArrowRight size={16} />
      </Link>
    </div>
  );
}
function Worker({ workerId }: { workerId: string }) {
  const health = useResource<{ checkInTestMode?: boolean }>("/health");
  const breaks = useResource<{ breaks: Break[] }>("/breaks", 10000),
    history = useResource<{ sessions: (Session & { summary: Summary })[] }>(
      `/workers/${workerId}/history`,
    ),
    requests = useResource<{ requests: RestRequest[] }>("/rest-requests", 3000);
  const now = Date.now(),
    br = breaks.data?.breaks.find(
      (b) => Date.parse(b.startsAt) <= now && Date.parse(b.endsAt) > now,
    ),
    checkInBreak =
      br ?? (health.data?.checkInTestMode ? breaks.data?.breaks[0] : undefined),
    active = history.data?.sessions.find((s) => s.status === "active"),
    latest = history.data?.sessions.find((s) => s.status === "completed");
  return (
    <>
      <PageHeading
        eyebrow="WORKER PORTAL"
        title="Take a moment for yourself."
        description="Check your readings, request rest, or ask for help."
        action={<span className="badge">Worker W-{workerId.slice(-2)}</span>}
      />
      <ErrorNotice message={breaks.error || history.error || requests.error} />
      {health.data?.checkInTestMode && (
        <p className="notice demo">
          Local check-in testing enabled: no consent form or scheduled-break
          time gate.
        </p>
      )}
      {breaks.loading ? (
        <Loading />
      ) : (
        <section className="break-hero">
          <div className="break-icon">
            <Coffee size={30} />
          </div>
          <div>
            <span className="eyebrow">
              {br ? "YOUR BREAK IS IN PROGRESS" : "YOUR PROTECTED SCHEDULE"}
            </span>
            <h2>
              {br
                ? "Rest comes first. Check in if you choose."
                : "Your next break is protected."}
            </h2>
            <p>
              {br
                ? `${time(br.startsAt)} – ${time(br.endsAt)} · ${br.policyLabel}`
                : "Voluntary measurement is available during a scheduled break. Assistance is always available."}
            </p>
          </div>
          {active ? (
            <Link
              className="button primary"
              to={`/sessions/${active.id}/measure`}
            >
              Resume check-in <ArrowRight size={17} />
            </Link>
          ) : checkInBreak ? (
            <Link
              className="button primary"
              to={`/check-in?breakId=${checkInBreak.id}`}
            >
              Start voluntary check-in <ArrowRight size={17} />
            </Link>
          ) : (
            <span className="badge">No active break</span>
          )}
        </section>
      )}
      <div className="stats-grid three">
        <section className="card stat">
          <span>
            <LockKeyhole size={18} />
            Protected rest
          </span>
          <strong>
            {breaks.data?.breaks.filter((b) => b.kind === "protected").length ??
              "—"}
            <small>scheduled break</small>
          </strong>
          <p>Your scheduled breaks stay protected</p>
        </section>
        <section className="card stat">
          <span>
            <Clock size={18} />
            Your check-ins
          </span>
          <strong>
            {history.data?.sessions.filter((s) => s.status === "completed")
              .length ?? "—"}
            <small>recorded sessions</small>
          </strong>
          <p>Every session retains its measurement source</p>
        </section>
        <section className="card stat">
          <span>
            <Activity size={18} />
            Open requests
          </span>
          <strong>
            {requests.data?.requests.filter(
              (r) => !["resolved", "declined"].includes(r.status),
            ).length ?? "—"}
            <small>awaiting follow-up</small>
          </strong>
          <p>You can ask for help without a check-in</p>
        </section>
      </div>
      <div className="two-columns">
        <section className="card">
          <div className="card-header">
            <div>
              <h2>Need help or extra rest?</h2>
              <p>You do not need a measurement to request help.</p>
            </div>
          </div>
          <HelpActions onSent={() => void requests.refresh()} />
        </section>
        <section className="card">
          <div className="card-header">
            <h2>Latest check-in</h2>
            <Link to="/history">
              View history <ArrowRight size={14} />
            </Link>
          </div>
          {latest ? (
            <>
              <div className="row-between">
                <span className="muted">
                  {date(latest.startedAt)} · {time(latest.startedAt)}
                </span>
                <SourceBadge source={latest.source} />
              </div>
              <div className="mini-metrics">
                <div>
                  <span>Pulse change</span>
                  <strong>
                    {number(latest.summary.pulse.delta)} <small>bpm</small>
                  </strong>
                </div>
                <div>
                  <span>Breathing change</span>
                  <strong>
                    {number(latest.summary.breathing.delta)} <small>brpm</small>
                  </strong>
                </div>
              </div>
              <Link className="text-link" to={`/sessions/${latest.id}`}>
                Review observations <ArrowRight size={15} />
              </Link>
            </>
          ) : (
            <p className="muted">No completed sessions yet.</p>
          )}
        </section>
      </div>
      {!!requests.data?.requests.length && (
        <section className="card">
          <div className="card-header">
            <h2>Your requests</h2>
            <span className="muted">Updates from your manager</span>
          </div>
          {requests.data?.requests.map((r) => (
            <div className="request-history" key={r.id}>
              <span>
                {r.kind === "assistance"
                  ? "Human assistance"
                  : `${r.requestedMinutes} minutes additional rest`}
              </span>
              <span className="badge">{r.status}</span>
              <small>{r.note || "Awaiting supervisor follow-up"}</small>
            </div>
          ))}
        </section>
      )}
      <SupervisorMirror
        workerId={workerId}
        onChanged={() => void history.refresh()}
      />
      <SafetyNote />
    </>
  );
}
