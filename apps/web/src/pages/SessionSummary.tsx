import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Activity,
  Wind,
  ArrowRight,
  FileText,
  Shuffle,
} from "lucide-react";
import type {
  Session,
  Summary,
  ReadingEnvelope,
  Explanation,
  MetricSummary,
  Comparison,
  TimeSeriesEvidence,
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
import { TimeSeriesEvidencePanel } from "../components/TimeSeriesEvidence";
import { useIdentity } from "../App";
export function SessionSummary() {
  const { id } = useParams(),
    { identity } = useIdentity();
  const summary = useResource<{ summary: Summary }>(`/sessions/${id}/summary`),
    session = useResource<{ session: Session }>(`/sessions/${id}`),
    readings = useResource<{ readings: ReadingEnvelope[] }>(
      `/sessions/${id}/readings`,
    ),
    evidence = useResource<{ evidence: TimeSeriesEvidence }>(
      `/sessions/${id}/timeseries-evidence`,
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
    v = summary.data?.summary,
    ownsSession =
      identity?.role === "worker" && identity.workerId === s?.workerId;
  return (
    <>
      <Link
        className="back-link"
        to={identity?.role === "supervisor" ? "/supervisor" : "/worker"}
      >
        <ArrowLeft size={15} />
        Back to workspace
      </Link>
      <ErrorNotice
        message={
          summary.error || session.error || readings.error || evidence.error
        }
      />
      {!s || !v ? (
        (summary.loading || session.loading) && <Loading />
      ) : (
        <>
          <PageHeading
            eyebrow="CHECK-IN SUMMARY / 03"
            title="Your next step, with context."
            description={`${date(s.startedAt)} · ${time(s.startedAt)} · ${Math.round(v.durationSeconds)} seconds recorded`}
            action={<SourceBadge source={s.source} />}
          />
          {ownsSession && s.interruption && (
            <div className="notice demo">
              <p>{s.interruption}</p>
              <Link className="button secondary" to="/web-check-in">
                Start a fresh camera check-in
              </Link>
            </div>
          )}
          {ownsSession && (
            <ResearchRestSupportCard
              key={s.id}
              sessionId={s.id}
              source={s.source}
              completed={s.status === "completed"}
            />
          )}
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
          <section aria-labelledby="measurement-evidence">
            <div className="section-heading">
              <div>
                <span className="eyebrow">MEASUREMENT EVIDENCE</span>
                <h2 id="measurement-evidence">What the check-in recorded</h2>
                <p className="muted">
                  These observations explain the estimate; they do not make a
                  rest or work decision.
                </p>
              </div>
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
          </section>
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
          {evidence.data && (
            <TimeSeriesEvidencePanel evidence={evidence.data.evidence} />
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
          {ownsSession && (
            <>
              <PersonalInsightsPanel
                sessionId={s.id}
                completed={s.status === "completed"}
              />
            </>
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

const REST_SUPPORT_NEXT_STEP: Record<RestSupportResult["signal"], string> = {
  consider_additional_rest:
    "The experimental model found a rest-support signal. You can choose to request additional rest.",
  no_additional_signal:
    "The experimental model found no additional rest-support signal. This does not determine what you need—choose the support that feels right.",
  insufficient_evidence:
    "The model could not make an estimate from this check-in. Choose based on how you feel; support is still available.",
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

const DEMO_SCENARIOS = [
  {
    label: "Rest",
    title: "Take a moment. Request extra rest.",
    story:
      "A worker finishes a demanding task and wants a little more time before their next assignment.",
    next: "Demo scenario: a worker chooses to request additional rest. Select Request additional rest to continue the walkthrough.",
  },
  {
    label: "Recheck",
    title: "Pause and check in again.",
    story:
      "The check-in is incomplete. The worker can try again with steadier positioning and better lighting.",
    next: "In this role-play, try another check-in or choose support based on how you feel. Missing readings are not an all-clear.",
  },
  {
    label: "Support",
    title: "Ask someone to check in with you.",
    story:
      "A worker wants a human follow-up. Help does not depend on camera quality or a model result.",
    next: "Select Request assistance to demonstrate the human follow-up flow. Requests are sent only when you choose to submit them.",
  },
] as const;

function PresentationPlayground({ sessionId }: { sessionId: string }) {
  const [selected, setSelected] = useState(0);
  const scenario = DEMO_SCENARIOS[selected];
  const shuffle = () => {
    const random = crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
    setSelected(
      (current) =>
        (current + 1 + Math.floor(random * 2)) % DEMO_SCENARIOS.length,
    );
  };
  return (
    <div className="demo-playground">
      <div className="demo-playground-toolbar">
        <span className="badge amber">Simulated role-play</span>
        <button
          className="button secondary small-button"
          type="button"
          onClick={shuffle}
        >
          <Shuffle size={16} aria-hidden="true" />
          Shuffle demo scenario
        </button>
      </div>
      <div
        className="demo-scenario-picker"
        role="group"
        aria-label="Choose demo scenario"
      >
        {DEMO_SCENARIOS.map((item, index) => (
          <button
            type="button"
            key={item.label}
            aria-pressed={selected === index}
            onClick={() => setSelected(index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        className="demo-scenario-story"
        aria-live="polite"
        aria-atomic="true"
      >
        <p className="fine-print">Presentation result</p>
        <h3>{scenario.title}</h3>
        <p>{scenario.story}</p>
        <p className="demo-scenario-next">{scenario.next}</p>
      </div>
      {selected === 1 && (
        <Link className="button secondary" to="/web-check-in">
          Start a fresh camera check-in
        </Link>
      )}
      <HelpActions sessionId={sessionId} />
      <p className="fine-print demo-provenance">
        Fictional scenario, not a camera finding or model prediction. Shuffling
        changes only this preview, not measurements, confidence, or saved
        records. Submitting a request uses the real app workflow.
      </p>
    </div>
  );
}

export function ResearchRestSupportCard({
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
          <h2 id="research-rest-support-title">Suggested next step</h2>
          <p>
            {result.status === "available" &&
            result.support.presentationSimulation
              ? "Explore the worker flow with a fictional scenario."
              : "Experimental local research model — not medical advice or work clearance."}
          </p>
        </div>
        <span className="badge amber">
          {result.status === "available" &&
          result.support.presentationSimulation
            ? "Demo"
            : "Experimental"}
        </span>
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
          <HelpActions sessionId={sessionId} />
        </>
      ) : (
        <>
          {result.support.presentationSimulation ? (
            <PresentationPlayground sessionId={sessionId} />
          ) : (
            <>
              <div className="two-columns">
                <div className="comparison">
                  <span>Model result</span>
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
              <div className="research-next-step" role="status">
                <h3>What you can do</h3>
                <p>{REST_SUPPORT_NEXT_STEP[result.support.signal]}</p>
              </div>
              <HelpActions sessionId={sessionId} />
            </>
          )}
          {!result.support.presentationSimulation && (
            <p className="fine-print">
              {result.support.syntheticDemo
                ? "Local synthetic-model theory demo — trained on fabricated research records; this output is unvalidated."
                : "Descriptive research rule — no trained-model result is available for this check-in."}
            </p>
          )}
          <details className="flow-details research-details">
            <summary>Research details and actual camera evidence</summary>
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
          </details>
        </>
      )}
      <p className="fine-print">
        You choose what support to request. Protected breaks stay unchanged.
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
