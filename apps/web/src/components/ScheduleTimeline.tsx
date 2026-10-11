import type { Overview } from "@siteguard/contracts";
import { time } from "../lib/api";
import { LockKeyhole } from "lucide-react";
const TASK_COLORS = ["#c8deef", "#efdcb0", "#bde3dc", "#edcbd6", "#d3dcef"];
export function ScheduleTimeline({ overview }: { overview: Overview }) {
  const intervals = [
    ...overview.tasks,
    ...overview.breaks,
    ...overview.assignments,
  ];
  const start = intervals.length
    ? Math.min(...intervals.map((interval) => Date.parse(interval.startsAt)))
    : Date.now();
  const end = Math.max(
    start + 60000,
    ...intervals.map((interval) => Date.parse(interval.endsAt)),
  );
  const minutes = (end - start) / 60000;
  // Long schedules scroll rather than squeezing fifteen-minute rest into a sliver.
  const timelineWidth = Math.max(760, 190 + minutes * 6);
  const tickCount = Math.max(4, Math.ceil(minutes / 30));
  const tasks = [...overview.tasks].sort((a, b) => a.id.localeCompare(b.id));
  const taskColors = new Map(
    tasks.map((task, index) => [
      task.id,
      TASK_COLORS[index % TASK_COLORS.length],
    ]),
  );
  const taskColor = (taskId: string) => taskColors.get(taskId) ?? "#e9efe2";
  const left = (t: string) =>
    Math.max(0, Math.min(100, ((Date.parse(t) - start) / (end - start)) * 100));
  const now = ((Date.now() - start) / (end - start)) * 100;
  return (
    <section className="card timeline-card">
      <div className="card-header">
        <div>
          <h2>Protected break schedule</h2>
          <p>
            Schedule: {time(new Date(start).toISOString())}–
            {time(new Date(end).toISOString())}. All recorded rest is shown.
            Blank areas mean no task is assigned.
          </p>
        </div>
        <span className="badge">
          <LockKeyhole size={12} /> Site policy
        </span>
      </div>
      <div
        className="timeline-scroll"
        role="region"
        aria-label="Work and rest schedule, scroll for more times"
        tabIndex={0}
      >
        <div className="timeline" style={{ minWidth: timelineWidth }}>
          <div className="timeline-axis">
            <span>WORKER</span>
            <div>
              {Array.from({ length: tickCount + 1 }, (_, i) => (
                <span key={i} style={{ left: `${(i / tickCount) * 100}%` }}>
                  {time(
                    new Date(
                      start + ((end - start) * i) / tickCount,
                    ).toISOString(),
                  )}
                </span>
              ))}
            </div>
          </div>
          {overview.workers.map((w) => (
            <div className="timeline-row" key={w.id}>
              <div className="worker-label">
                <span className="avatar">
                  {w.displayName
                    .trim()
                    .split(/\s+/)
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </span>
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
                {Array.from(
                  { length: tickCount + 1 },
                  (_, i) => (i / tickCount) * 100,
                ).map((n) => (
                  <i key={n} style={{ left: `${n}%` }} />
                ))}
                {overview.assignments
                  .filter((a) => a.workerId === w.id)
                  .map((a) => (
                    <div
                      key={a.id}
                      className="assignment-bar"
                      title={
                        overview.tasks.find((t) => t.id === a.taskId)?.label ||
                        "Assigned work"
                      }
                      style={{
                        background: taskColor(a.taskId),
                        borderColor: taskColor(a.taskId),
                        left: `${left(a.startsAt)}%`,
                        width: `${left(a.endsAt) - left(a.startsAt)}%`,
                      }}
                    ></div>
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
                      <span>
                        {b.kind === "protected"
                          ? `${Math.round((Date.parse(b.endsAt) - Date.parse(b.startsAt)) / 60000)}m`
                          : "Extra rest"}
                      </span>
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
        {tasks.map((task) => (
          <span key={task.id}>
            <i style={{ background: taskColor(task.id) }} />
            {task.label}
          </span>
        ))}
        <span>
          <i className="legend-unassigned" />
          No assigned task
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
      <div className="schedule-examples">
        <h3>
          Example break changes <span className="badge">Illustration only</span>
        </h3>
        <p>
          These fictional examples explain the colors. They do not change
          anyone’s schedule.
        </p>
        <div className="schedule-example-row">
          <strong>Mohit Unecha</strong>
          <div className="schedule-example-blocks">
            <span
              className="example-task"
              style={{ background: TASK_COLORS[0] }}
              title="Material handling"
            >
              Material handling
            </span>
            <span className="example-original">Original optional break</span>
            <span className="example-shifted">Optional break moved later</span>
          </div>
        </div>
        <div className="schedule-example-row">
          <strong>Aaron Bansal</strong>
          <div className="schedule-example-blocks">
            <span
              className="example-task"
              style={{ background: TASK_COLORS[1] }}
            >
              Equipment inspection
            </span>
            <span className="example-protected">Protected break · 15m</span>
            <span className="example-additional">Extra rest · 5m</span>
          </div>
        </div>
        <p className="fine-print">
          Amber = rescheduled optional break. Purple = additional rest. Required
          protected breaks cannot move or shrink.
        </p>
      </div>
    </section>
  );
}
