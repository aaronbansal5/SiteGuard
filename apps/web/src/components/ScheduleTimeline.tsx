import type { Overview } from "@siteguard/contracts";
import { time } from "../lib/api";
import { LockKeyhole } from "lucide-react";
export function ScheduleTimeline({ overview }: { overview: Overview }) {
  const start = Math.min(...overview.tasks.map((t) => Date.parse(t.startsAt))),
    end = Math.max(...overview.tasks.map((t) => Date.parse(t.endsAt)));
  const left = (t: string) =>
    Math.max(0, Math.min(100, ((Date.parse(t) - start) / (end - start)) * 100));
  const now = ((Date.now() - start) / (end - start)) * 100;
  return (
    <section className="card timeline-card">
      <div className="card-header">
        <div>
          <h2>Protected break schedule</h2>
          <p>Coverage can change. Required breaks stay protected.</p>
        </div>
        <span className="badge">
          <LockKeyhole size={12} /> Site policy
        </span>
      </div>
      <div className="timeline-scroll">
        <div className="timeline">
          <div className="timeline-axis">
            <span>WORKER</span>
            <div>
              {Array.from({ length: 5 }, (_, i) => (
                <span key={i} style={{ left: `${i * 25}%` }}>
                  {time(
                    new Date(start + ((end - start) * i) / 4).toISOString(),
                  )}
                </span>
              ))}
            </div>
          </div>
          {overview.workers.map((w) => (
            <div className="timeline-row" key={w.id}>
              <div className="worker-label">
                <span className="avatar">{w.displayName.slice(-2)}</span>
                <span>
                  {w.displayName}
                  <small>
                    {overview.requests.some(
                      (r) =>
                        r.workerId === w.id &&
                        !["resolved", "declined"].includes(r.status),
                    )
                      ? "Request open"
                      : "Site crew"}
                  </small>
                </span>
              </div>
              <div className="timeline-track">
                {[0, 25, 50, 75, 100].map((n) => (
                  <i key={n} style={{ left: `${n}%` }} />
                ))}
                {overview.assignments
                  .filter((a) => a.workerId === w.id)
                  .map((a) => (
                    <div
                      key={a.id}
                      className="assignment-bar"
                      title={`${overview.tasks.find((t) => t.id === a.taskId)?.label} · ${time(a.startsAt)}–${time(a.endsAt)}`}
                      style={{
                        left: `${left(a.startsAt)}%`,
                        width: `${left(a.endsAt) - left(a.startsAt)}%`,
                      }}
                    />
                  ))}
                {overview.breaks
                  .filter((b) => b.workerId === w.id)
                  .map((b) => (
                    <div
                      key={b.id}
                      className={`break-bar ${b.kind}`}
                      style={{
                        left: `${left(b.startsAt)}%`,
                        width: `${left(b.endsAt) - left(b.startsAt)}%`,
                      }}
                      title={`${b.kind} break · ${time(b.startsAt)}–${time(b.endsAt)}`}
                    >
                      <LockKeyhole size={11} />
                      <span>{b.kind === "protected" ? "15m" : "Rest"}</span>
                    </div>
                  ))}
                {now >= 0 && now <= 100 && (
                  <div className="now-line" style={{ left: `${now}%` }} />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="timeline-legend">
        <span>
          <i className="legend-work" />
          Task assignment
        </span>
        <span>
          <i className="legend-protected" />
          Protected break
        </span>
        <span>
          <i className="legend-rest" />
          Additional rest
        </span>
        <span>
          <i className="legend-now" />
          Now
        </span>
      </div>
    </section>
  );
}
