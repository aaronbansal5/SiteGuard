import { IncidentScrollArea } from "../components/IncidentScrollArea";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, History } from "lucide-react";
import type { Session, Summary } from "@siteguard/contracts";
import { useIdentity } from "../App";
import { ChooseWorker } from "./WorkerHome";
import { useResource, date, time, number } from "../lib/api";
import {
  PageHeading,
  ErrorNotice,
  Loading,
  SafetyNote,
} from "../components/ui";
import { SourceBadge } from "../components/SourceBadge";
import { PersonalTrendCard } from "../components/PersonalInsights";
export function HistoryPage() {
  const { identity } = useIdentity();
  if (identity?.role !== "worker") return <ChooseWorker />;
  return <HistoryTable workerId={identity.workerId} />;
}
function HistoryTable({ workerId }: { workerId: string }) {
  const [cursor, setCursor] = useState("");
  const resource = useResource<{
    sessions: (Session & { summary: Summary })[];
    nextCursor: string | null;
  }>(
    `/workers/${workerId}/history?limit=20${cursor ? "&before=" + cursor : ""}`,
  );
  return (
    <>
      <PageHeading
        eyebrow="WORKER / HISTORY"
        title="A record of your check-ins."
        description="See your previous readings and open any check-in for details."
      />
      <ErrorNotice message={resource.error} />
      <PersonalTrendCard workerId={workerId} />
      {resource.loading ? (
        <Loading />
      ) : (
        <section className="card table-card">
          <div className="card-header">
            <h2>Session history</h2>
            <span className="badge">Private by default</span>
          </div>
          {resource.data?.sessions.length ? (
            <IncidentScrollArea
              className="table-scroll history-scroll"
              label="Session history, scroll for more"
              visibleRows={5}
              rowSelector="tbody > tr"
            >
              <table>
                <thead>
                  <tr>
                    <th>Check-in</th>
                    <th>Source</th>
                    <th>Context</th>
                    <th>Pulse change</th>
                    <th>Breathing change</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {resource.data.sessions.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{date(s.startedAt)}</strong>
                        <small>
                          {time(s.startedAt)} ·{" "}
                          {s.status === "active"
                            ? "Active"
                            : `${Math.round(s.summary.durationSeconds)}s`}
                        </small>
                      </td>
                      <td>
                        <SourceBadge source={s.source} />
                      </td>
                      <td>
                        {s.context.workload || "Not recorded"}
                        <small>
                          {s.context.temperatureC === null
                            ? "Temperature not recorded"
                            : `${s.context.temperatureC}°C`}
                        </small>
                      </td>
                      <td>
                        {s.summary.pulse.status === "available"
                          ? `${number(s.summary.pulse.delta)} bpm`
                          : "Insufficient data"}
                      </td>
                      <td>
                        {s.summary.breathing.status === "available"
                          ? `${number(s.summary.breathing.delta)} brpm`
                          : "Insufficient data"}
                      </td>
                      <td>
                        <Link
                          className="text-link"
                          to={`/sessions/${s.id}${s.status === "active" ? "/measure" : ""}`}
                          aria-label={`View check-in ${date(s.startedAt)}`}
                        >
                          View <ArrowUpRight size={15} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </IncidentScrollArea>
          ) : (
            <div className="empty-state">
              <History size={28} />
              <h3>No sessions yet</h3>
              <p>Your completed check-ins will appear here.</p>
            </div>
          )}
          <div className="table-footer">
            {cursor && (
              <button
                className="button secondary"
                onClick={() => setCursor("")}
              >
                Newest sessions
              </button>
            )}
            {resource.data?.nextCursor && (
              <button
                className="button secondary"
                onClick={() => setCursor(resource.data!.nextCursor!)}
              >
                Older sessions
              </button>
            )}
          </div>
        </section>
      )}
      <SafetyNote />
    </>
  );
}
