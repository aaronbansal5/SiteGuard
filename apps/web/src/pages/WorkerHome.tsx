import { Link } from "react-router-dom";
import { Coffee, ArrowRight, Activity } from "lucide-react";
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
  const breaks = useResource<{ breaks: Break[] }>("/breaks", 10000),
    history = useResource<{ sessions: (Session & { summary: Summary })[] }>(
      `/workers/${workerId}/history`,
    ),
    requests = useResource<{ requests: RestRequest[] }>("/rest-requests", 3000);
  const now = Date.now(),
    br = breaks.data?.breaks.find(
      (b) => Date.parse(b.startsAt) <= now && Date.parse(b.endsAt) > now,
    ),
    active = history.data?.sessions.find((s) => s.status === "active"),
    latest = history.data?.sessions.find((s) => s.status === "completed");
  return (
    <>
      <PageHeading
        eyebrow="WORKER CHECK-IN"
        title="Take a moment for yourself."
        description="Choose a source, record your check-in, then review the results and request rest if you want it."
        action={<span className="badge">Worker W-{workerId.slice(-2)}</span>}
      />
      <ErrorNotice message={breaks.error || history.error || requests.error} />
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
              {br ? "Ready for a check-in?" : "Your next break is protected."}
            </h2>
            <p>
              {br
                ? `${time(br.startsAt)} – ${time(br.endsAt)} · ${br.policyLabel}`
                : "Check-ins open during a scheduled break. You can request rest or help below at any time."}
            </p>
          </div>
          {active ? (
            <Link
              className="button primary"
              to={`/sessions/${active.id}/measure`}
            >
              Resume check-in <ArrowRight size={17} />
            </Link>
          ) : br ? (
            <Link className="button primary" to={`/check-in?breakId=${br.id}`}>
              Start check-in <ArrowRight size={17} />
            </Link>
          ) : (
            <span className="badge">No active break</span>
          )}
        </section>
      )}
      <div className="two-columns">
        <section className="card">
          <div className="card-header">
            <div>
              <h2>Need more rest or help?</h2>
              <p>You can ask now, with or without a check-in.</p>
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
                View results <ArrowRight size={15} />
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
            <span className="muted">Updates from safety operations</span>
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
