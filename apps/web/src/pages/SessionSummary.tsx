import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Activity, Wind, ArrowRight, FileText } from "lucide-react";
import type {
  Session,
  Summary,
  ReadingEnvelope,
  Explanation,
  MetricSummary,
  Comparison,
} from "@siteguard/contracts";
import { api, useResource, number, time, date } from "../lib/api";
import {
  PageHeading,
  Loading,
  ErrorNotice,
  HelpActions,
  SafetyNote,
} from "../components/ui";
import { SourceBadge } from "../components/SourceBadge";
import { VitalChart } from "../components/VitalChart";
import { PersonalInsightsPanel } from "../components/PersonalInsights";
import { useIdentity } from "../App";
export function SessionSummary() {
  const { id } = useParams(),
    { identity } = useIdentity();
  const summary = useResource<{ summary: Summary }>(`/sessions/${id}/summary`),
    session = useResource<{ session: Session }>(`/sessions/${id}`),
    readings = useResource<{ readings: ReadingEnvelope[] }>(
      `/sessions/${id}/readings`,
    );
  const [explanation, setExplanation] = useState<Explanation>(),
    [explanationError, setExplanationError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setExplanation(undefined);
    setExplanationError("");
    if (summary.data)
      void api<Explanation>(
        "/insights/explain",
        {
          kind: "session",
          sessionId: id,
        },
        "POST",
        controller.signal,
      )
        .then((value) => {
          if (!controller.signal.aborted) setExplanation(value);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setExplanationError(e.message);
        });
    return () => controller.abort();
  }, [id, summary.data]);
  const s = session.data?.session,
    v = summary.data?.summary;
  return (
    <>
      <Link
        className="back-link"
        to={identity?.role === "supervisor" ? "/supervisor" : "/worker"}
      >
        <ArrowLeft size={15} />
        Back to workspace
      </Link>
      <ErrorNotice message={summary.error || session.error || readings.error} />
      {!s || !v ? (
        (summary.loading || session.loading) && <Loading />
      ) : (
        <>
          <PageHeading
            eyebrow="CHECK-IN SUMMARY / 03"
            title="Your observations, in context."
            description={`${date(s.startedAt)} · ${time(s.startedAt)} · ${Math.round(v.durationSeconds)} seconds recorded`}
            action={<SourceBadge source={s.source} />}
          />
          <div className="notice subtle">
            <FileText size={18} />
            <span>
              {s.shareWithSupervisor
                ? "This session summary is shared with safety operations."
                : "This session summary is private to your worker workspace."}{" "}
              {s.context.workload || "Unrecorded"} workload ·{" "}
              {s.context.temperatureC === null
                ? "Temperature not recorded"
                : `${s.context.temperatureC}°C`}
            </span>
          </div>
          <div className="two-columns">
            <Metric
              title="Pulse"
              unit="bpm"
              value={v.pulse}
              comparison={v.pulseComparison}
              icon={<Activity size={20} />}
            />
            <Metric
              title="Breathing rate"
              unit="brpm"
              value={v.breathing}
              comparison={v.breathingComparison}
              icon={<Wind size={20} />}
            />
          </div>
          {readings.data && (
            <div className="two-columns">
              <VitalChart
                readings={readings.data.readings}
                metric="pulse"
                startedAt={s.startedAt}
              />
              <VitalChart
                readings={readings.data.readings}
                metric="breathing"
                startedAt={s.startedAt}
              />
            </div>
          )}
          <section className="card explanation">
            <div className="card-header">
              <div>
                <h2>What the observations show</h2>
                <p>Factual context, without a medical judgment.</p>
              </div>
              <span className="badge">
                {explanation?.origin === "gemini"
                  ? "Gemini fact selection"
                  : "Deterministic explanation"}
              </span>
            </div>
            <ErrorNotice message={explanationError} />
            {explanation ? (
              explanation.observations.map((p, i) => (
                <p key={i} className="fact">
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  {p}
                </p>
              ))
            ) : (
              <p className="muted">Preparing the factual summary…</p>
            )}
            <div className="limitations">
              {v.limitations.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          </section>
          {identity?.role === "worker" && identity.workerId === s.workerId && (
            <PersonalInsightsPanel
              sessionId={s.id}
              completed={s.status === "completed"}
            />
          )}
          {identity?.role === "worker" && (
            <section className="card">
              <div className="card-header">
                <div>
                  <h2>Choose your next step</h2>
                  <p>Your needs matter independently of the measurements.</p>
                </div>
                <Link to="/history">
                  Session history <ArrowRight size={14} />
                </Link>
              </div>
              <HelpActions sessionId={s.id} />
            </section>
          )}
          <SafetyNote />
        </>
      )}
    </>
  );
}
function Metric({
  title,
  unit,
  value,
  comparison,
  icon,
}: {
  title: string;
  unit: string;
  value: MetricSummary;
  comparison: Comparison;
  icon: React.ReactNode;
}) {
  return (
    <section className="card summary-metric">
      <div className="row-between">
        <h2>
          {icon}
          {title}
        </h2>
        <span className="badge">
          {value.status === "available"
            ? "Observed change"
            : "Insufficient data"}
        </span>
      </div>
      <div className="summary-values">
        <div>
          <span>Initial window</span>
          <strong>
            {number(value.initialMedian)}
            <small>{unit}</small>
          </strong>
        </div>
        <ArrowRight size={22} />
        <div>
          <span>Final window</span>
          <strong>
            {number(value.finalMedian)}
            <small>{unit}</small>
          </strong>
        </div>
        <div className="delta">
          <span>Change</span>
          <strong>
            {value.delta !== null && value.delta > 0 ? "+" : ""}
            {number(value.delta)}
            <small>{unit}</small>
          </strong>
        </div>
      </div>
      <p className="fine-print">
        {value.initialCount} initial / {value.finalCount} final valid
        observations · 15-second windows
      </p>
      <div className="comparison">
        <span>Comparable history</span>
        <strong>
          {comparison.status === "available"
            ? `${number(comparison.historicalMedianDelta)} ${unit} median change`
            : "Insufficient comparable data"}
        </strong>
        <small>
          {comparison.count} matching prior sessions · same source and recorded
          context
        </small>
      </div>
    </section>
  );
}
