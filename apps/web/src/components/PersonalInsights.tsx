// Worker-only experimental personal insights (docs/RECOVERY_MODEL.md).
// Descriptive, personal wording only: never a score, diagnosis or risk label.
import { useEffect, useId, useState } from "react";
import { FlaskConical, Lock } from "lucide-react";
import type {
  PersonalInsights,
  PersonalTrend,
  Baseline,
  Trend,
  TirednessEstimate,
  SelfReport,
} from "@siteguard/contracts";
import { api, useAction, useResource, number } from "../lib/api";
import { ErrorNotice } from "./ui";

type Metric = "pulse" | "breathing";
const NAMES: Record<Metric, { label: string; unit: string }> = {
  pulse: { label: "pulse", unit: "bpm" },
  breathing: { label: "breathing rate", unit: "brpm" },
};
const signed = (v: number | null) =>
  v === null ? "—" : `${v > 0 ? "+" : ""}${number(v)}`;

export function ExperimentalLabel({ synthetic }: { synthetic: boolean }) {
  return (
    <div className="experimental-label">
      <span className="badge amber">
        <FlaskConical size={13} /> Experimental
      </span>
      <span>
        Compares only with your own past sessions · not medical advice
        {synthetic ? " · synthetic demo data" : ""}
      </span>
    </div>
  );
}

export function baselineText(metric: Metric, b: Baseline) {
  const { label, unit } = NAMES[metric];
  if (b.status !== "available")
    return b.reason === "current_session_unavailable"
      ? `This check-in did not have enough valid ${label} readings to compare with your usual.`
      : `Not enough of your own past sessions yet to describe your usual ${label} change (${b.priorCount} of ${b.requiredCount} needed).`;
  const detail = `${signed(b.current)} ${unit} this time; your usual is about ${signed(b.usualMedian)} ${unit}, from ${b.priorCount} of your past sessions.`;
  if (b.classification === "settled_more")
    return `Your ${label} settled more than your usual during this break: ${detail}`;
  if (b.classification === "settled_less")
    return `Your ${label} settled less than your usual during this break: ${detail}`;
  return `Your ${label} change was within your usual range: ${detail}`;
}

export function trendText(metric: Metric, t: Trend) {
  const { label } = NAMES[metric];
  if (t.status !== "available")
    return `A ${label} trend needs at least ${t.requiredCount} of your sessions with enough valid readings (${t.count} so far).`;
  if (t.direction === "settling_more")
    return `Your recent sessions show your ${label} settling a little more each time (last ${t.count} sessions).`;
  if (t.direction === "settling_less")
    return `Your recent sessions show your ${label} settling a little less each time (last ${t.count} sessions).`;
  return `Your recent sessions show your ${label} settling by about the same amount (last ${t.count} sessions).`;
}

const TIREDNESS_REASON: Record<
  NonNullable<TirednessEstimate["reason"]>,
  (e: TirednessEstimate) => string
> = {
  not_enough_labeled_sessions: (e) =>
    `Not enough of your own rated sessions yet (${e.labeledCount} of ${e.requiredCount} needed).`,
  current_session_unavailable: () =>
    "This check-in did not have enough valid pulse and breathing readings.",
  ratings_do_not_vary: () =>
    "Your past ratings are all the same, so there is nothing to learn from yet.",
  estimate_not_reliable: (e) =>
    `Your past ratings could not be estimated closely enough from your readings (typical error ${number(e.looMae)} points; needs ${number(e.maeBound)} or less and better than your own average).`,
};

function TirednessCard({
  sessionId,
  completed,
  estimate,
  initial,
  onSaved,
}: {
  sessionId: string;
  completed: boolean;
  estimate: TirednessEstimate;
  initial: SelfReport | null;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<number | null>(initial?.tiredness ?? null);
  const [saved, setSaved] = useState("");
  const a = useAction();
  const name = useId();
  useEffect(() => setValue(initial?.tiredness ?? null), [initial]);
  const save = (tiredness: number | null) => {
    // Optimistic selection; reverted if the save cannot be confirmed.
    const previous = value;
    setValue(tiredness);
    setSaved("");
    return a.run(async () => {
      try {
        await api(`/sessions/${sessionId}/self-report`, { tiredness });
      } catch (e) {
        setValue(previous);
        throw e;
      }
      setSaved(tiredness === null ? "Rating removed." : "Rating saved.");
      onSaved();
    });
  };
  return (
    <div className="personal-block">
      <h3>How tired do you feel?</h3>
      <p className="fine-print">
        Optional and voluntary. Only you can see it; it is never used for
        scheduling, approvals or supervisor views.
      </p>
      {completed ? (
        <fieldset className="rating" disabled={a.busy}>
          <legend className="sr-only">
            Tiredness self-report, 1 (not at all) to 5 (very)
          </legend>
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className={value === n ? "selected" : ""}>
              <input
                type="radio"
                name={name}
                value={n}
                checked={value === n}
                onChange={() => void save(n)}
              />
              <strong>{n}</strong>
              <small>{n === 1 ? "Not at all" : n === 5 ? "Very" : " "}</small>
            </label>
          ))}
          {value !== null && (
            <button
              type="button"
              className="button ghost small-button"
              onClick={() => void save(null)}
            >
              Clear my rating
            </button>
          )}
        </fieldset>
      ) : (
        <p className="muted">You can rate this check-in after it ends.</p>
      )}
      {initial?.origin === "synthetic" && (
        <p className="fine-print">
          This rating is a synthetic demonstration value.
        </p>
      )}
      <ErrorNotice message={a.error} />
      {saved && (
        <p className="fine-print" role="status">
          {saved}
        </p>
      )}
      <div className="comparison">
        <span>Experimental estimate of how you might rate your tiredness</span>
        <strong>
          {estimate.status === "available"
            ? `About ${number(estimate.estimate)} — likely between ${estimate.rangeLow} and ${estimate.rangeHigh}`
            : "Not enough data"}
        </strong>
        <small>
          {estimate.status === "available"
            ? `Learned only from your own ${estimate.labeledCount} rated sessions; typical error ±${number(estimate.looMae)} points (leave-one-out).`
            : TIREDNESS_REASON[estimate.reason!](estimate)}
          {estimate.includesSyntheticReports
            ? " Includes synthetic demonstration ratings."
            : ""}
        </small>
      </div>
    </div>
  );
}

/** Session summary panel. Render only for the worker who owns the session. */
export function PersonalInsightsPanel({
  sessionId,
  completed,
}: {
  sessionId: string;
  completed: boolean;
}) {
  const r = useResource<{ insights: PersonalInsights }>(
    `/sessions/${sessionId}/personal-insights`,
  );
  const v = r.data?.insights;
  return (
    <section className="card personal" aria-labelledby={`${sessionId}-pi`}>
      <div className="card-header">
        <div>
          <h2 id={`${sessionId}-pi`}>Compared with your own usual</h2>
          <p>
            <Lock size={12} /> Private to you. Not shared with supervisors.
          </p>
        </div>
      </div>
      <ErrorNotice message={r.error} />
      {!v ? (
        r.loading && <p className="muted">Looking at your past sessions…</p>
      ) : (
        <>
          <ExperimentalLabel synthetic={v.synthetic} />
          <div className="two-columns">
            {(["pulse", "breathing"] as const).map((m) => (
              <div className="personal-block" key={m}>
                <h3>{m === "pulse" ? "Pulse" : "Breathing rate"}</h3>
                <p>{baselineText(m, v[m].baseline)}</p>
                <p className="fine-print">{trendText(m, v[m].trend)}</p>
              </div>
            ))}
          </div>
          <TirednessCard
            sessionId={sessionId}
            completed={completed}
            estimate={v.tiredness}
            initial={v.selfReport}
            onSaved={() => void r.refresh()}
          />
          <div className="limitations">
            {v.limitations.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** History page card: recent-session trend for one measurement source. */
export function PersonalTrendCard({ workerId }: { workerId: string }) {
  const r = useResource<{ trend: PersonalTrend }>(
    `/workers/${workerId}/personal-trend?source=presage`,
  );
  const t = r.data?.trend;
  return (
    <section className="card personal" aria-labelledby="personal-trend">
      <div className="card-header">
        <div>
          <h2 id="personal-trend">Your recent sessions</h2>
          <p>
            <Lock size={12} /> Private to you. Based on your camera check-ins.
          </p>
        </div>
      </div>
      <ErrorNotice message={r.error} />
      {t && (
        <>
          <ExperimentalLabel synthetic={t.synthetic} />
          <p>{trendText("pulse", t.pulse)}</p>
          <p>{trendText("breathing", t.breathing)}</p>
          <div className="limitations">
            {t.limitations.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
