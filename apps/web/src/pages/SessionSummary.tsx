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
import type {
  MetricFeatures,
  RestSupportResult,
} from "../../../api/src/research/rest-support";
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
              {s.context.workload
                ? s.context.workload[0].toUpperCase() +
                  s.context.workload.slice(1)
                : "Unrecorded"}{" "}
              workload ·{" "}
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
                <h2>Before / after guidance</h2>
                <p>
                  Gemini can select approved context from the initial and final
                  windows and eligible history; it cannot make a medical
                  recommendation.
                </p>
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
            <>
              <ResearchRestSupportCard
                key={s.id}
                sessionId={s.id}
                source={s.source}
                completed={s.status === "completed"}
              />
              <PersonalInsightsPanel
                sessionId={s.id}
                completed={s.status === "completed"}
              />
            </>
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

const REST_SUPPORT_SIGNALS: Record<RestSupportResult["signal"], string> = {
  consider_additional_rest: "Consider additional rest",
  no_additional_signal: "No additional rest-support signal",
  insufficient_evidence: "Insufficient evidence",
};

function isRestSupportResult(value: unknown): value is RestSupportResult {
  const object = (item: unknown): item is Record<string, unknown> =>
    item !== null && typeof item === "object" && !Array.isArray(item);
  if (!object(value)) return false;
  const strings = (list: unknown): list is string[] =>
    Array.isArray(list) && list.every((item) => typeof item === "string");
  const finite = (item: unknown): item is number =>
    typeof item === "number" && Number.isFinite(item);
  const nullableNumber = (item: unknown) => item === null || finite(item);
  const metric = (item: unknown) =>
    item === null ||
    (object(item) &&
      finite(item.initial) &&
      finite(item.final) &&
      finite(item.delta) &&
      finite(item.fractionalChange) &&
      nullableNumber(item.historicalDelta) &&
      nullableNumber(item.differenceFromHistory) &&
      finite(item.priorCount) &&
      Number.isInteger(item.priorCount) &&
      item.priorCount >= 0);
  const evidence = value.evidence;
  return (
    (value.signal === "consider_additional_rest" ||
      value.signal === "no_additional_signal" ||
      value.signal === "insufficient_evidence") &&
    value.confidence === null &&
    object(value.uncertainty) &&
    value.uncertainty.level === "unquantified" &&
    strings(value.uncertainty.reasons) &&
    object(evidence) &&
    (evidence.source === null ||
      evidence.source === "mock" ||
      evidence.source === "presage") &&
    (evidence.synthetic === null || typeof evidence.synthetic === "boolean") &&
    nullableNumber(evidence.durationSeconds) &&
    metric(evidence.pulse) &&
    metric(evidence.breathing) &&
    strings(evidence.issues) &&
    typeof value.modelVersion === "string" &&
    value.modelVersion.trim().length > 0 &&
    value.experimental === true &&
    typeof value.disclaimer === "string" &&
    value.disclaimer.trim().length > 0
  );
}

function ResearchRestSupportCard({
  sessionId,
  source,
  completed,
}: {
  sessionId: string;
  source: Session["source"];
  completed: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<
    | { status: "loading" }
    | { status: "available"; support: RestSupportResult }
    | { status: "error" }
  >({ status: "loading" });

  useEffect(() => {
    if (!completed) return;
    const controller = new AbortController();
    setResult({ status: "loading" });
    void api<unknown>(
      `/sessions/${sessionId}/rest-support`,
      undefined,
      "GET",
      controller.signal,
    )
      .then((value) => {
        if (
          !isRestSupportResult(value) ||
          (value.evidence.source !== null && value.evidence.source !== source)
        )
          throw new Error("Invalid research response");
        if (!controller.signal.aborted)
          setResult({ status: "available", support: value });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ status: "error" });
      });
    return () => controller.abort();
  }, [sessionId, source, completed, attempt]);

  return (
    <section
      className="card"
      aria-labelledby="research-rest-support-title"
      aria-busy={completed && result.status === "loading"}
    >
      <div className="card-header">
        <div>
          <h2 id="research-rest-support-title">Research rest support</h2>
          <p>
            Experimental research estimate — not medical advice or work
            clearance.
          </p>
        </div>
        <span className="badge amber">Experimental</span>
      </div>
      {source === "mock" && (
        <p className="fine-print">Uses synthetic demo measurements.</p>
      )}
      {!completed ? (
        <p className="muted">Available after this check-in is completed.</p>
      ) : result.status === "loading" ? (
        <p className="muted" role="status">
          Preparing the research estimate…
        </p>
      ) : result.status === "error" ? (
        <>
          <p className="muted" role="status">
            Research estimate unavailable. No rest-support signal could be
            confirmed. You can still request additional rest below.
          </p>
          <button
            type="button"
            className="button ghost small-button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry research estimate
          </button>
        </>
      ) : (
        <>
          <div className="two-columns">
            <div className="comparison">
              <span>Rest-support signal</span>
              <strong>{REST_SUPPORT_SIGNALS[result.support.signal]}</strong>
              <small>
                This signal does not determine your rest needs or readiness.
              </small>
            </div>
            <div className="comparison">
              <span>Model confidence</span>
              <strong>Not available</strong>
              <small>
                Validated confidence is unavailable without labeled data.
              </small>
            </div>
          </div>
          <div className="limitations">
            <h3>Uncertainty: {result.support.uncertainty.level}</h3>
            {result.support.uncertainty.reasons.length ? (
              result.support.uncertainty.reasons.map((text, index) => (
                <p key={index}>{text}</p>
              ))
            ) : (
              <p>Uncertainty was not supplied by the model.</p>
            )}
          </div>
          <div className="limitations">
            <h3>Evidence</h3>
            <p>
              Source: {result.support.evidence.source ?? "Unavailable"} ·
              Duration:{" "}
              {result.support.evidence.durationSeconds === null
                ? "Unavailable"
                : `${number(result.support.evidence.durationSeconds)} seconds`}
            </p>
            <RestSupportEvidence evidence={result.support.evidence} />
            <h3>Evidence issues</h3>
            {result.support.evidence.issues.length ? (
              result.support.evidence.issues.map((text, index) => (
                <p key={index}>{text}</p>
              ))
            ) : (
              <p>No evidence issues reported.</p>
            )}
          </div>
          <p className="fine-print">
            Model version: {result.support.modelVersion}
          </p>
          <p className="fine-print">{result.support.disclaimer}</p>
        </>
      )}
      <p className="fine-print">
        You choose whether to request additional rest. Use “Request additional
        rest” below at any time; this estimate does not change your protected
        breaks.
      </p>
    </section>
  );
}

function RestSupportEvidence({
  evidence,
}: {
  evidence: RestSupportResult["evidence"];
}) {
  const rows = [
    ["initial", "Initial window"],
    ["final", "Final window"],
    ["delta", "Change"],
    ["fractionalChange", "Fractional change"],
    ["historicalDelta", "Historical median change"],
    ["differenceFromHistory", "Difference from history"],
    ["priorCount", "Comparable prior sessions"],
  ] as const;
  const format = (metric: MetricFeatures | null, key: keyof MetricFeatures) => {
    const value = metric?.[key] ?? null;
    if (value === null) return "Not available";
    if (key === "fractionalChange")
      return value.toLocaleString(undefined, {
        style: "percent",
        maximumFractionDigits: 1,
      });
    return number(value);
  };
  return (
    <div
      className="table-scroll"
      role="region"
      aria-label="Rest-support evidence metrics"
      tabIndex={0}
    >
      <table>
        <caption className="sr-only">
          Measurements used by the research rule
        </caption>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">Pulse (bpm)</th>
            <th scope="col">Breathing (brpm)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, label]) => (
            <tr key={key}>
              <th scope="row">{label}</th>
              <td>{format(evidence.pulse, key)}</td>
              <td>{format(evidence.breathing, key)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
