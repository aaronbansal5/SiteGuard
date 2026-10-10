// Phone layout for voluntary recurring check-ins (docs/MOBILE_APP.md).
//
// Invariants kept here:
// - Reminders only prompt; they never start a measurement. Consent is shown
//   and must be given on every check-in.
// - Phone browsers cannot run the Presage SmartSpectra SDK (it ships for
//   Swift, Kotlin, C++ and Node only), so the check-in uses the labeled
//   synthetic source through the existing session APIs.
// - Assistance, rest and symptom requests are always available without any
//   measurement.
// - Personal insights render only for the worker who owns the session.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  Shield,
  Bell,
  BellOff,
  Coffee,
  ArrowRight,
  Square,
  Activity,
  Wind,
  LockKeyhole,
  FlaskConical,
} from "lucide-react";
import type {
  Break,
  Session,
  Summary,
  Worker,
  MetricSummary,
} from "@siteguard/contracts";
import { RECOMMENDED_CHECK_IN_SECONDS } from "@siteguard/contracts";
import { useIdentity } from "../App";
import { api, useAction, useResource, number, time } from "../lib/api";
import { useSessionStream } from "../lib/session-stream";
import {
  CheckInReminder,
  defaultReminderInterval,
  formatCountdown,
  loadReminderSettings,
  notifyReminderIfPermitted,
  parseReminderInterval,
  saveReminderSettings,
  MAX_REMINDER_INTERVAL_SECONDS,
  MIN_REMINDER_INTERVAL_SECONDS,
  type NotificationHost,
  type ReminderSettings,
  type ReminderSnapshot,
} from "../lib/checkin-reminder";
import { ErrorNotice, HelpActions, Loading } from "../components/ui";
import { SourceBadge } from "../components/SourceBadge";
import { PersonalInsightsPanel } from "../components/PersonalInsights";

type Health = { measurementSources: { mock: boolean; presage: boolean } };
type Stage =
  | { kind: "home" }
  | { kind: "consent" }
  | { kind: "measuring"; sessionId: string }
  | { kind: "done"; sessionId: string };

function storage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function MobileApp() {
  const { identity } = useIdentity();
  const choosing = false;
  return (
    <div className="mobile-app">
      <header className="mobile-header">
        <Link to="/mobile" className="mobile-brand">
          <span className="brand-mark">
            <Shield size={20} />
          </span>
          <span>
            SiteGuard<small>CHECK-IN</small>
          </span>
        </Link>
        {identity?.role === "worker" && !choosing && (
          <Link to="/worker" className="button ghost mobile-switch">
            Worker portal
          </Link>
        )}
      </header>
      <div className="mobile-demo-strip">
        <FlaskConical size={14} /> Fictional workforce · synthetic demo readings
      </div>
      <main id="main" className="mobile-main">
        {identity?.role !== "worker" || choosing ? (
          <p>Sign in with your worker account to continue.</p>
        ) : (
          <MobileWorker key={identity.workerId} workerId={identity.workerId} />
        )}
      </main>
      <footer className="mobile-footer">
        <span>
          Observations support a conversation. They do not establish recovery or
          fitness for work.
        </span>
        <Link to="/worker">Open full worker portal</Link>
      </footer>
    </div>
  );
}

function ChooseMobileWorker({ onChosen }: { onChosen: () => void }) {
  const workers = useResource<{ workers: Worker[] }>("/workers");
  const { login } = useIdentity(),
    a = useAction();
  return (
    <section className="mobile-card">
      <h1>Who is checking in?</h1>
      <p className="muted">
        Demo role selection on this phone. No facial identification and no
        production sign-in.
      </p>
      <ErrorNotice message={workers.error || a.error} />
      {workers.loading && <Loading />}
      <div className="mobile-stack">
        {workers.data?.workers.map((w) => (
          <button
            key={w.id}
            type="button"
            className="button secondary mobile-big"
            disabled={a.busy}
            onClick={() =>
              void a.run(async () => {
                await login({ role: "worker", workerId: w.id });
                onChosen();
              })
            }
          >
            {w.displayName}
            <ArrowRight size={18} />
          </button>
        ))}
      </div>
    </section>
  );
}

/** Owns the reminder instance; settings persist per device. */
function useCheckInReminder(defaultInterval: number | null) {
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [snapshot, setSnapshot] = useState<ReminderSnapshot | null>(null);
  const ref = useRef<CheckInReminder | null>(null);
  useEffect(() => {
    if (defaultInterval === null) return;
    const loaded = loadReminderSettings(storage(), {
      enabled: true,
      intervalSeconds: defaultInterval,
    });
    setSettings(loaded);
    const reminder = new CheckInReminder({
      intervalSeconds: loaded.intervalSeconds,
      onChange: setSnapshot,
      onDue: () =>
        void notifyReminderIfPermitted(window as unknown as NotificationHost),
    });
    ref.current = reminder;
    if (loaded.enabled) reminder.enable();
    else setSnapshot(reminder.snapshot());
    return () => {
      reminder.dispose();
      if (ref.current === reminder) ref.current = null;
    };
  }, [defaultInterval]);
  const update = (next: ReminderSettings) => {
    setSettings(next);
    saveReminderSettings(storage(), next);
  };
  return {
    settings,
    snapshot,
    reminder: ref,
    setEnabled(enabled: boolean) {
      if (!settings) return;
      update({ ...settings, enabled });
      if (enabled) ref.current?.enable();
      else ref.current?.disable();
    },
    setInterval(seconds: number) {
      if (!settings) return;
      update({ ...settings, intervalSeconds: seconds });
      ref.current?.setIntervalSeconds(seconds);
    },
  };
}

function MobileWorker({ workerId }: { workerId: string }) {
  const health = useResource<Health>("/health");
  const breaks = useResource<{ breaks: Break[] }>("/breaks", 10000);
  const history = useResource<{ sessions: Session[] }>(
    `/workers/${workerId}/history?limit=5`,
  );
  const demoMode = health.data?.measurementSources.mock;
  const reminder = useCheckInReminder(
    demoMode === undefined ? null : defaultReminderInterval(demoMode),
  );
  const [stage, setStage] = useState<Stage>({ kind: "home" });
  const resumed = useRef(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Resume an active session (e.g. after a page reload) instead of starting
  // a second one. Resuming is not a new measurement.
  useEffect(() => {
    if (resumed.current || !history.data) return;
    resumed.current = true;
    const active = history.data.sessions.find((s) => s.status === "active");
    if (active) setStage({ kind: "measuring", sessionId: active.id });
  }, [history.data]);
  // Pause reminders while the consent screen or a check-in is open.
  const ready = reminder.snapshot !== null;
  useEffect(() => {
    const r = reminder.reminder.current;
    if (!r) return;
    if (stage.kind === "consent" || stage.kind === "measuring")
      r.beginCheckIn();
    else r.endCheckIn();
  }, [stage.kind, ready, reminder.reminder]);
  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [stage.kind]);

  const sorted = [...(breaks.data?.breaks ?? [])].sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
  );
  const activeBreak = sorted.find(
    (b) => Date.parse(b.startsAt) <= now && Date.parse(b.endsAt) > now,
  );
  const nextBreak = sorted.find((b) => Date.parse(b.startsAt) > now);
  const canMeasure = Boolean(demoMode) && Boolean(activeBreak);
  const blockedReason = !demoMode
    ? "Measurement is not available in this phone browser. The Presage SDK runs only in native apps or the local camera bridge."
    : !activeBreak
      ? `Check-ins open during your scheduled break${nextBreak ? ` (next: ${time(nextBreak.startsAt)})` : ""}.`
      : "";

  return (
    <>
      <ErrorNotice
        message={health.error || breaks.error || history.error || ""}
      />
      {stage.kind === "home" && (
        <MobileHome
          reminder={reminder}
          demoMode={demoMode}
          activeBreak={activeBreak}
          canMeasure={canMeasure}
          blockedReason={blockedReason}
          onStart={() => setStage({ kind: "consent" })}
        />
      )}
      {stage.kind === "consent" && (
        <MobileConsent
          breakId={activeBreak?.id ?? null}
          canMeasure={canMeasure}
          blockedReason={blockedReason}
          onCancel={() => setStage({ kind: "home" })}
          onStarted={(id) => setStage({ kind: "measuring", sessionId: id })}
        />
      )}
      {stage.kind === "measuring" && (
        <MobileMeasuring
          sessionId={stage.sessionId}
          onFinished={() =>
            setStage({ kind: "done", sessionId: stage.sessionId })
          }
        />
      )}
      {stage.kind === "done" && (
        <MobileDone
          sessionId={stage.sessionId}
          snapshot={reminder.snapshot}
          onBack={() => {
            void history.refresh();
            setStage({ kind: "home" });
          }}
        />
      )}
      {stage.kind !== "home" && (
        <section className="mobile-card">
          <h2>Need support?</h2>
          <p className="muted">
            Requests reach a person, with or without a measurement.
          </p>
          <HelpActions
            sessionId={
              stage.kind === "measuring" || stage.kind === "done"
                ? stage.sessionId
                : null
            }
          />
        </section>
      )}
    </>
  );
}

function MobileHome({
  reminder,
  demoMode,
  activeBreak,
  canMeasure,
  blockedReason,
  onStart,
}: {
  reminder: ReturnType<typeof useCheckInReminder>;
  demoMode: boolean | undefined;
  activeBreak: Break | undefined;
  canMeasure: boolean;
  blockedReason: string;
  onStart: () => void;
}) {
  const s = reminder.snapshot,
    settings = reminder.settings;
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (settings) setDraft(String(settings.intervalSeconds));
  }, [settings?.intervalSeconds]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    const value = parseReminderInterval(draft, settings.intervalSeconds);
    setDraft(String(value));
    reminder.setInterval(value);
  };
  return (
    <>
      <section className="mobile-card mobile-break">
        <Coffee size={22} />
        <div>
          <strong>
            {activeBreak
              ? "Your protected break is in progress"
              : "No break in progress"}
          </strong>
          <span>
            {activeBreak
              ? `${time(activeBreak.startsAt)} – ${time(activeBreak.endsAt)} · rest comes first`
              : "Your break schedule stays protected."}
          </span>
        </div>
      </section>

      {s?.phase === "due" && (
        <section
          className="mobile-card mobile-prompt"
          role="status"
          aria-live="polite"
        >
          <span className="eyebrow">CHECK-IN AVAILABLE · OPTIONAL</span>
          <h2>Would you like to check in?</h2>
          <p>
            Only if you want to. Skipping has no effect on your breaks or
            requests.
          </p>
          {blockedReason && <p className="fine-print">{blockedReason}</p>}
          <div className="mobile-stack">
            <button
              type="button"
              className="button primary mobile-big"
              disabled={!canMeasure}
              onClick={onStart}
            >
              Review consent and check in <ArrowRight size={18} />
            </button>
            <button
              type="button"
              className="button secondary mobile-big"
              onClick={() => reminder.reminder.current?.dismiss()}
            >
              Not now
            </button>
          </div>
        </section>
      )}

      <section className="mobile-card mobile-reminder" aria-live="off">
        <div className="row-between">
          <h1>Check-in reminders</h1>
          {demoMode && <span className="badge synthetic">Demo interval</span>}
        </div>
        {!s || !settings ? (
          <Loading />
        ) : (
          <>
            <div className="mobile-countdown">
              {s.phase === "waiting" ? (
                <>
                  <span>Next optional reminder in</span>
                  <strong data-testid="reminder-countdown">
                    {formatCountdown(s.remainingSeconds)}
                  </strong>
                </>
              ) : s.phase === "due" ? (
                <>
                  <span>Reminder</span>
                  <strong data-testid="reminder-countdown">Now</strong>
                </>
              ) : (
                <>
                  <span>Reminders</span>
                  <strong data-testid="reminder-countdown">Off</strong>
                </>
              )}
            </div>
            <form className="mobile-interval" onSubmit={submit}>
              <label>
                Check-in reminder every N seconds
                <input
                  type="number"
                  inputMode="numeric"
                  min={MIN_REMINDER_INTERVAL_SECONDS}
                  max={MAX_REMINDER_INTERVAL_SECONDS}
                  step={1}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </label>
              <button type="submit" className="button secondary mobile-big">
                Set interval
              </button>
            </form>
            <p className="fine-print">
              {demoMode
                ? `Demo interval: ${settings.intervalSeconds} seconds so the cycle is visible in a short demo. `
                : ""}
              A reminder is a convenience, not a rest or health recommendation.
              It never starts a measurement.
            </p>
            <label className="checkbox mobile-toggle">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => reminder.setEnabled(e.target.checked)}
              />
              <span>
                {settings.enabled ? <Bell size={16} /> : <BellOff size={16} />}{" "}
                Remind me to check in
              </span>
            </label>
            <NotificationOptIn />
          </>
        )}
      </section>

      <section className="mobile-card">
        <h2>Check in now</h2>
        <p className="muted">
          Voluntary, about {RECOMMENDED_CHECK_IN_SECONDS.mock} seconds, and you
          can stop at any time.
        </p>
        {blockedReason && <p className="fine-print">{blockedReason}</p>}
        <button
          type="button"
          className="button primary mobile-big"
          disabled={!canMeasure}
          onClick={onStart}
        >
          Start check-in <ArrowRight size={18} />
        </button>
      </section>

      <section className="mobile-card">
        <h2>Support, whenever you need it</h2>
        <p className="muted">You do not need a measurement to ask for help.</p>
        <HelpActions />
      </section>
    </>
  );
}

function NotificationOptIn() {
  const supported =
    typeof window !== "undefined" &&
    "Notification" in window &&
    window.isSecureContext;
  const [permission, setPermission] = useState<NotificationPermission | null>(
    supported ? Notification.permission : null,
  );
  if (!supported)
    return (
      <p className="fine-print">
        Background notifications need a secure (HTTPS) connection; reminders
        appear in the app.
      </p>
    );
  if (permission === "granted")
    return (
      <p className="fine-print">
        Background notifications are on. They say only that a check-in is
        available.
      </p>
    );
  if (permission === "denied")
    return (
      <p className="fine-print">
        Background notifications are off. Reminders appear in the app.
      </p>
    );
  return (
    <button
      type="button"
      className="button ghost mobile-big"
      onClick={() =>
        void Notification.requestPermission().then(setPermission, () =>
          setPermission("denied"),
        )
      }
    >
      Also notify me when SiteGuard is in the background
    </button>
  );
}

function MobileConsent({
  breakId,
  canMeasure,
  blockedReason,
  onCancel,
  onStarted,
}: {
  breakId: string | null;
  canMeasure: boolean;
  blockedReason: string;
  onCancel: () => void;
  onStarted: (sessionId: string) => void;
}) {
  // Fresh state on every visit: consent is never remembered.
  const [consent, setConsent] = useState(false),
    [share, setShare] = useState(false),
    [workload, setWorkload] = useState(""),
    [temp, setTemp] = useState("");
  const a = useAction();
  return (
    <form
      className="mobile-card"
      onSubmit={(e) => {
        e.preventDefault();
        if (!consent || !breakId || a.busy) return;
        void a.run(async () => {
          const result = await api<{ session: Session }>("/sessions", {
            breakId,
            source: "mock",
            consentVersion: "v1",
            shareWithSupervisor: share,
            context: {
              workload: workload || null,
              temperatureC: temp === "" ? null : Number(temp),
            },
          });
          onStarted(result.session.id);
        });
      }}
    >
      <span className="eyebrow">VOLUNTARY CHECK-IN · CONSENT</span>
      <h1>Before you begin</h1>
      <ul className="mobile-consent-points">
        <li>
          <strong>Synthetic readings on this phone.</strong> Phone browsers
          cannot run the Presage SDK, so this check-in uses labeled synthetic
          demo readings. No camera is used.
        </li>
        <li>
          <strong>Only normalized observations.</strong> Timestamped pulse,
          breathing rate, source and quality. No images or video are stored.
        </li>
        <li>
          <strong>No identification, no clearance.</strong> Readings cannot show
          that you have recovered or are fit to return to work.
        </li>
        <li>
          <strong>Private by default.</strong> Your supervisor sees break times
          and requests. Sharing this summary is optional.
        </li>
      </ul>
      <div className="mobile-source">
        <SourceBadge source="mock" />
        <span>Measurement source for this check-in</span>
      </div>
      <div className="form-grid">
        <label>
          Recent workload
          <select
            value={workload}
            onChange={(e) => setWorkload(e.target.value)}
          >
            <option value="">Not recorded</option>
            <option value="light">Light</option>
            <option value="moderate">Moderate</option>
            <option value="heavy">Heavy</option>
          </select>
        </label>
        <label>
          Temperature (°C)
          <input
            type="number"
            inputMode="decimal"
            step="any"
            value={temp}
            onChange={(e) => setTemp(e.target.value)}
            placeholder="Optional"
          />
        </label>
      </div>
      <label className="checkbox mobile-toggle">
        <input
          type="checkbox"
          checked={share}
          onChange={(e) => setShare(e.target.checked)}
        />
        <span>Share this session's summary with safety operations</span>
      </label>
      <label className="checkbox consent-check mobile-toggle">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>
          I understand the limitations and voluntarily agree to record this
          check-in.
        </span>
      </label>
      <ErrorNotice message={a.error || blockedReason} />
      <div className="mobile-stack">
        <button
          className="button primary mobile-big"
          disabled={!consent || !canMeasure || a.busy}
        >
          {a.busy ? "Starting…" : "Begin check-in"}
          <ArrowRight size={18} />
        </button>
        <button
          type="button"
          className="button secondary mobile-big"
          onClick={onCancel}
        >
          Not now
        </button>
      </div>
      <p className="fine-print">
        <LockKeyhole size={12} /> Consent version v1 · asked every check-in ·
        you can stop at any time.
      </p>
    </form>
  );
}

function MobileMeasuring({
  sessionId,
  onFinished,
}: {
  sessionId: string;
  onFinished: () => void;
}) {
  const session = useResource<{ session: Session }>(`/sessions/${sessionId}`);
  const s = session.data?.session;
  const stream = useSessionStream(sessionId, s?.status === "active");
  const a = useAction();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (s?.status === "completed") onFinished();
  }, [s?.status, onFinished]);
  if (!s)
    return (
      <section className="mobile-card">
        <ErrorNotice message={session.error} />
        {session.loading ? (
          <Loading />
        ) : (
          <button
            type="button"
            className="button secondary mobile-big"
            onClick={() => void session.refresh()}
          >
            Retry
          </button>
        )}
      </section>
    );
  const target = RECOMMENDED_CHECK_IN_SECONDS[s.source];
  const elapsed = Math.max(
    0,
    Math.floor((now - Date.parse(s.startedAt)) / 1000),
  );
  const latest = (pick: "heartRateBpm" | "respiratoryRateBrpm") =>
    stream.readings
      .map((e) => e.reading)
      .filter((r) => r.quality === "valid" && r[pick] !== null)
      .at(-1)?.[pick] ?? null;
  const quality = stream.readings.at(-1)?.reading.quality;
  return (
    <section className="mobile-card">
      <div className="row-between">
        <span className="eyebrow">CHECKING IN</span>
        <SourceBadge source={s.source} />
      </div>
      <h1>Sit comfortably and rest.</h1>
      <div className="mobile-countdown">
        <span>Elapsed</span>
        <strong data-testid="checkin-elapsed">
          {formatCountdown(elapsed)}
        </strong>
      </div>
      <div
        className="progress"
        role="progressbar"
        aria-label="Check-in progress"
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={Math.min(target, elapsed)}
      >
        <span
          style={{ width: `${Math.min(100, (elapsed / target) * 100)}%` }}
        />
      </div>
      <p className="fine-print">
        {elapsed >= target
          ? `${target} seconds reached. Finish when you are ready.`
          : `Suggested length: ${target} seconds (a data-sufficiency guide, not a medical threshold).`}
      </p>
      <div className="mobile-readings">
        <div>
          <Activity size={18} />
          <span>Pulse</span>
          <strong>
            {number(latest("heartRateBpm"))}
            <small>bpm</small>
          </strong>
        </div>
        <div>
          <Wind size={18} />
          <span>Breathing</span>
          <strong>
            {number(latest("respiratoryRateBrpm"))}
            <small>brpm</small>
          </strong>
        </div>
      </div>
      <p className="fine-print">
        {s.source === "mock"
          ? "Synthetic demonstration values, not a real measurement."
          : "Presage measurement."}{" "}
        Latest quality: {quality ?? "waiting"} · {stream.status}
      </p>
      <ErrorNotice message={a.error || stream.error} />
      <button
        type="button"
        className="button primary mobile-big"
        disabled={a.busy}
        onClick={() =>
          void a.run(async () => {
            await api(`/sessions/${s.id}/complete`, {});
            onFinished();
          })
        }
      >
        <Square size={16} />
        {a.busy ? "Stopping…" : "Finish check-in"}
      </button>
    </section>
  );
}

function MobileMetric({
  label,
  unit,
  value,
}: {
  label: string;
  unit: string;
  value: MetricSummary;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>
        {value.status === "available"
          ? `${value.delta! > 0 ? "+" : ""}${number(value.delta)}`
          : "—"}
        <small>{unit}</small>
      </strong>
      <small>
        {value.status === "available" ? "Observed change" : "Insufficient data"}
      </small>
    </div>
  );
}

function MobileDone({
  sessionId,
  snapshot,
  onBack,
}: {
  sessionId: string;
  snapshot: ReminderSnapshot | null;
  onBack: () => void;
}) {
  const summary = useResource<{ summary: Summary }>(
    `/sessions/${sessionId}/summary`,
  );
  const v = summary.data?.summary;
  return (
    <>
      <section className="mobile-card">
        <div className="row-between">
          <span className="eyebrow">CHECK-IN COMPLETE</span>
          {v && <SourceBadge source={v.source} />}
        </div>
        <h1>Thanks for checking in.</h1>
        <ErrorNotice message={summary.error} />
        {!v ? (
          summary.loading && <Loading />
        ) : (
          <>
            <p className="muted">
              {Math.round(v.durationSeconds)} seconds recorded. Changes compare
              the first and last 15 seconds of valid readings.
            </p>
            <div className="mobile-readings">
              <MobileMetric label="Pulse change" unit="bpm" value={v.pulse} />
              <MobileMetric
                label="Breathing change"
                unit="brpm"
                value={v.breathing}
              />
            </div>
          </>
        )}
        <div className="mobile-stack">
          <Link
            className="button secondary mobile-big"
            to={`/sessions/${sessionId}`}
          >
            Full summary <ArrowRight size={18} />
          </Link>
          <button
            type="button"
            className="button primary mobile-big"
            onClick={onBack}
          >
            Back to check-ins
          </button>
        </div>
        {snapshot?.phase === "waiting" && (
          <p className="fine-print">
            Next optional reminder in{" "}
            {formatCountdown(snapshot.remainingSeconds)}.
          </p>
        )}
      </section>
      <PersonalInsightsPanel sessionId={sessionId} completed />
    </>
  );
}
