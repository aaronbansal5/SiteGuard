import { CameraPreview } from "../components/CameraPreview";
import { startOrResumeCheckIn } from "../lib/checkin";
// Phone layout for voluntary recurring check-ins (docs/MOBILE_APP.md).
//
// Invariants kept here:
// - Reminders only prompt; they never start a measurement. Consent is shown
//   and must be given on every check-in.
// - A secure phone browser captures frames only after consent and relays them
//   transiently to the local Presage bridge. Frames are never stored.
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
import {
  BROWSER_CAMERA_FPS,
  BROWSER_CAMERA_FRAME_INTERVAL_MS,
  BROWSER_CAMERA_IDEAL_HEIGHT,
  BROWSER_CAMERA_IDEAL_WIDTH,
  BROWSER_CAMERA_MAX_DIMENSION,
} from "../lib/camera";

type Health = {
  checkInTestMode?: boolean;
  measurementSources: {
    mock: boolean;
    presage: boolean;
    browserCamera?: boolean;
  };
};
type Stage =
  | { kind: "home" }
  | { kind: "consent" }
  | { kind: "measuring"; sessionId: string; media?: MediaStream }
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
        <FlaskConical size={14} /> Fictional workforce · camera readings are
        real only when labeled Presage
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
  const browserCamera = Boolean(
    health.data?.measurementSources.browserCamera &&
    window.isSecureContext &&
    navigator.mediaDevices?.getUserMedia,
  );
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
  const localTest = health.data?.checkInTestMode === true;
  const activeBreak = sorted.find(
    (b) => Date.parse(b.startsAt) <= now && Date.parse(b.endsAt) > now,
  );
  const nextBreak = sorted.find((b) => Date.parse(b.endsAt) > now);
  const checkInBreak = activeBreak ?? nextBreak;
  const onDemand = Boolean(checkInBreak && !activeBreak);
  const presageAvailable = Boolean(health.data?.measurementSources.presage);
  const canMeasure =
    Boolean(browserCamera || demoMode || (localTest && presageAvailable)) &&
    (localTest || Boolean(checkInBreak));
  const blockedReason =
    !browserCamera && !demoMode && !(localTest && presageAvailable)
      ? "Camera check-in needs HTTPS and a running Presage bridge. Synthetic demo mode is also unavailable."
      : !localTest && !checkInBreak
        ? `No scheduled check-in window is available${nextBreak ? ` (next: ${time(nextBreak.startsAt)})` : ""}.`
        : "";

  return (
    <>
      <ErrorNotice
        message={health.error || breaks.error || history.error || ""}
      />
      {stage.kind === "home" && (
        <>
          <DevicePairingCard />
          <MobileHome
            reminder={reminder}
            demoMode={demoMode}
            browserCamera={browserCamera}
            activeBreak={activeBreak}
            canMeasure={canMeasure}
            blockedReason={blockedReason}
            onStart={() => setStage({ kind: "consent" })}
          />
        </>
      )}
      {stage.kind === "consent" && (
        <MobileConsent
          workerId={workerId}
          localTest={localTest}
          presageAvailable={presageAvailable}
          breakId={checkInBreak?.id ?? null}
          onDemand={onDemand}
          browserCamera={browserCamera}
          demoMode={Boolean(demoMode)}
          canMeasure={canMeasure}
          blockedReason={blockedReason}
          onCancel={() => setStage({ kind: "home" })}
          onStarted={(id, media) =>
            setStage({ kind: "measuring", sessionId: id, media })
          }
        />
      )}
      {stage.kind === "measuring" && (
        <MobileMeasuring
          sessionId={stage.sessionId}
          initialMedia={stage.media}
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

function DevicePairingCard() {
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="mobile-card">
      <h2>Pair the iPhone app</h2>
      <p>
        Pair only your own phone. Pairing does not upload anything; the app asks
        separately before every check-in and before manager sharing.
      </p>
      {pairing && (
        <p role="status">
          One-time code: <strong>{pairing.code}</strong> · expires{" "}
          {time(pairing.expiresAt)}
        </p>
      )}
      <ErrorNotice message={error} />
      <button
        className="button secondary"
        disabled={busy || !window.isSecureContext}
        onClick={() => {
          setBusy(true);
          void api<{ code: string; expiresAt: string }>(
            "/devices/pairings",
            {},
            "POST",
          )
            .then((value) => {
              setPairing(value);
              setError("");
            })
            .catch((reason) =>
              setError(
                reason instanceof Error
                  ? reason.message
                  : "Pairing unavailable",
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        Get one-time pairing code
      </button>
    </section>
  );
}

function MobileHome({
  reminder,
  demoMode,
  browserCamera,
  activeBreak,
  canMeasure,
  blockedReason,
  onStart,
}: {
  reminder: ReturnType<typeof useCheckInReminder>;
  demoMode: boolean | undefined;
  browserCamera: boolean;
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
          Voluntary, about{" "}
          {browserCamera
            ? RECOMMENDED_CHECK_IN_SECONDS.presage
            : RECOMMENDED_CHECK_IN_SECONDS.mock}{" "}
          seconds, and you can stop at any time.
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
  const isIOS =
    typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIOS)
    return (
      <p className="fine-print">
        Safari tabs on iPhone cannot deliver reliable timed background alerts.
        The reminder appears on this page while it is open. For background
        alerts, use the installed SiteGuard iPhone app and enable its local
        notifications.
      </p>
    );
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
  workerId,
  localTest,
  presageAvailable,
  breakId,
  onDemand,
  browserCamera,
  demoMode,
  canMeasure,
  blockedReason,
  onCancel,
  onStarted,
}: {
  workerId: string;
  localTest: boolean;
  presageAvailable: boolean;
  breakId: string | null;
  onDemand: boolean;
  browserCamera: boolean;
  demoMode: boolean;
  canMeasure: boolean;
  blockedReason: string;
  onCancel: () => void;
  onStarted: (sessionId: string, media?: MediaStream) => void;
}) {
  // Fresh state on every visit: consent is never remembered.
  const [consent, setConsent] = useState(false),
    [source, setSource] = useState<"presage" | "mock">(
      browserCamera || (localTest && presageAvailable) ? "presage" : "mock",
    ),
    [share, setShare] = useState(false);
  const phoneCamera = source === "presage" && browserCamera;
  const a = useAction();
  return (
    <form
      className="mobile-card"
      onSubmit={(e) => {
        e.preventDefault();
        if ((!localTest && !consent) || (!localTest && !breakId) || a.busy)
          return;
        void a.run(async () => {
          let media: MediaStream | undefined;
          if (phoneCamera) {
            if (
              !window.isSecureContext ||
              !navigator.mediaDevices?.getUserMedia
            )
              throw new Error("Camera check-in requires HTTPS on this phone.");
            media = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                facingMode: "user",
                width: { ideal: BROWSER_CAMERA_IDEAL_WIDTH },
                height: { ideal: BROWSER_CAMERA_IDEAL_HEIGHT },
                frameRate: {
                  ideal: BROWSER_CAMERA_FPS,
                  max: BROWSER_CAMERA_FPS,
                },
              },
            });
          }
          try {
            const result = await startOrResumeCheckIn(workerId, {
              ...(breakId ? { breakId } : {}),
              onDemand,
              source,
              ...(phoneCamera ? { input: "custom" as const } : {}),
              consentVersion: localTest ? "local-test" : "v1",
              shareWithSupervisor: share,
              context: { workload: null, temperatureC: null },
            });
            onStarted(result.session.id, media);
          } catch (error) {
            media?.getTracks().forEach((track) => track.stop());
            throw error;
          }
        });
      }}
    >
      <span className="eyebrow">VOLUNTARY CHECK-IN · CONSENT</span>
      <h1>{localTest ? "Test your check-in" : "Before you begin"}</h1>
      {localTest && (
        <p className="notice demo">
          Local testing: no consent form or scheduled-break time gate. Begin
          check-in starts recording.
        </p>
      )}
      {onDemand && !localTest && (
        <p className="notice demo">
          On-demand check-in: this records observations now without changing or
          approving your scheduled break.
        </p>
      )}
      {!localTest && (
        <ul className="mobile-consent-points">
          <li>
            {phoneCamera ? (
              <>
                <strong>Your browser camera is used for this check-in.</strong>
                Frames are sent over HTTPS to the SiteGuard server for transient
                Presage processing. They are not saved. Stop at any time.
              </>
            ) : source === "presage" ? (
              <>
                <strong>The laptop camera is used for this check-in.</strong>{" "}
                The local Presage bridge processes frames transiently. They are
                not saved. Stop at any time.
              </>
            ) : (
              <>
                <strong>Synthetic demo readings.</strong> No camera is used and
                these are not your pulse or breathing rate.
              </>
            )}
          </li>
          <li>
            <strong>What we record.</strong> Timestamped pulse, breathing rate,
            source and quality. No images or video are stored.
          </li>
          <li>
            <strong>Readings are not medical clearance.</strong> Readings cannot
            show that you have recovered or are fit to return to work.
          </li>
          <li>
            <strong>Private by default.</strong> Your supervisor sees break
            times and requests. Sharing this summary is optional.
          </li>
        </ul>
      )}
      <div className="mobile-source">
        <SourceBadge source={source} />
        <span>Measurement source for this check-in</span>
      </div>
      {((browserCamera && demoMode) || localTest) && (
        <label>
          Check-in mode
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as "presage" | "mock")}
          >
            <option
              value="presage"
              disabled={!browserCamera && !presageAvailable}
            >
              {browserCamera
                ? "Browser camera · Presage"
                : "Presage · laptop camera bridge"}
            </option>
            <option value="mock">Synthetic demo · no camera</option>
          </select>
        </label>
      )}
      <p className="fine-print">
        No workload or temperature questions are required. SiteGuard handles the
        before/after windows and eligible history automatically.
      </p>
      <label className="checkbox mobile-toggle">
        <input
          type="checkbox"
          checked={share}
          onChange={(e) => setShare(e.target.checked)}
        />
        <span>Share this session's summary with safety operations</span>
      </label>
      {!localTest && (
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
      )}
      <ErrorNotice message={a.error || blockedReason} />
      <div className="mobile-stack">
        <button
          className="button primary mobile-big"
          disabled={(!localTest && !consent) || !canMeasure || a.busy}
        >
          {a.busy
            ? "Starting…"
            : localTest
              ? source === "presage"
                ? "Begin camera check-in"
                : "Begin synthetic check-in"
              : "Begin check-in"}
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
        <LockKeyhole size={12} />{" "}
        {localTest
          ? "Local test session ·"
          : "Consent version v1 · asked every check-in ·"}
        you can stop at any time.
      </p>
    </form>
  );
}

function MobileMeasuring({
  sessionId,
  initialMedia,
  onFinished,
}: {
  sessionId: string;
  initialMedia?: MediaStream;
  onFinished: () => void;
}) {
  const session = useResource<{ session: Session }>(`/sessions/${sessionId}`);
  const s = session.data?.session;
  const stream = useSessionStream(sessionId, s?.status === "active");
  const a = useAction();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const autoCompleteStarted = useRef(false);
  const [autoCompleting, setAutoCompleting] = useState(false);
  const phoneCamera = initialMedia !== undefined;
  useEffect(() => {
    if (!phoneCamera || s?.source !== "presage" || s.status !== "active")
      return;
    let stopped = false;
    let media: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = 0;
    let encoding = false;
    let lastTimestampUs = 0;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const failCapture = (error: unknown) => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      setCameraError(
        error instanceof Error ? error.message : "Camera capture stopped.",
      );
      media?.getTracks().forEach((track) => track.stop());
      setCameraActive(false);
    };
    const capture = async () => {
      if (stopped || !media || !context || !videoRef.current) return;
      const captureStartedAt = performance.now();
      try {
        if (
          !encoding &&
          inFlight < 5 &&
          videoRef.current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
          encoding = true;
          const sourceWidth = videoRef.current.videoWidth;
          const sourceHeight = videoRef.current.videoHeight;
          if (!sourceWidth || !sourceHeight)
            throw new Error("Camera video has no usable frame size.");
          const scale = Math.min(
            1,
            BROWSER_CAMERA_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight),
          );
          const frameWidth = Math.round(sourceWidth * scale);
          const frameHeight = Math.round(sourceHeight * scale);
          if (canvas.width !== frameWidth) canvas.width = frameWidth;
          if (canvas.height !== frameHeight) canvas.height = frameHeight;
          context.drawImage(
            videoRef.current,
            0,
            0,
            canvas.width,
            canvas.height,
          );
          const frame = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (blob) =>
                blob
                  ? resolve(blob)
                  : reject(new Error("Camera frame encoding failed")),
              "image/jpeg",
              0.92,
            ),
          );
          encoding = false;
          if (stopped) return;
          const timestampUs = Math.max(lastTimestampUs + 1, Date.now() * 1000);
          lastTimestampUs = timestampUs;
          inFlight++;
          void fetch(
            `/api/sessions/${encodeURIComponent(sessionId)}/frame?timestampUs=${timestampUs}`,
            {
              method: "POST",
              headers: { "Content-Type": "image/jpeg" },
              body: frame,
              credentials: "same-origin",
              cache: "no-store",
            },
          )
            .then(async (response) => {
              if (!response.ok) {
                let detail = `Camera frame rejected (${response.status}). Check Presage and restart this check-in.`;
                try {
                  const body = (await response.json()) as {
                    error?: { message?: string };
                    message?: string;
                  };
                  detail = body.error?.message || body.message || detail;
                } catch {
                  // Keep the status-based fallback when the server did not return JSON.
                }
                throw new Error(detail);
              }
            })
            .catch(failCapture)
            .finally(() => {
              inFlight--;
            });
        }
        if (!stopped)
          timer = setTimeout(
            () => void capture(),
            Math.max(
              0,
              BROWSER_CAMERA_FRAME_INTERVAL_MS -
                (performance.now() - captureStartedAt),
            ),
          );
      } catch (error) {
        encoding = false;
        failCapture(error);
      }
    };
    const start = async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
          throw new Error("Camera check-in requires HTTPS on this phone.");
        media = initialMedia?.active
          ? initialMedia
          : await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                facingMode: "user",
                width: { ideal: BROWSER_CAMERA_IDEAL_WIDTH },
                height: { ideal: BROWSER_CAMERA_IDEAL_HEIGHT },
                frameRate: {
                  ideal: BROWSER_CAMERA_FPS,
                  max: BROWSER_CAMERA_FPS,
                },
              },
            });
        if (stopped) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        if (!videoRef.current) throw new Error("Camera preview unavailable.");
        videoRef.current.srcObject = media;
        await videoRef.current.play();
        setCameraActive(true);
        void capture();
      } catch (error) {
        if (!stopped)
          setCameraError(
            error instanceof Error ? error.message : "Camera access failed.",
          );
        media?.getTracks().forEach((track) => track.stop());
      }
    };
    void start();
    return () => {
      stopped = true;
      clearTimeout(timer);
      media?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [s?.source, s?.status, sessionId, initialMedia]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (s?.status === "completed") onFinished();
  }, [s?.status, onFinished]);
  const elapsed = s
    ? Math.max(0, Math.floor((now - Date.parse(s.startedAt)) / 1000))
    : 0;
  const targetSeconds = s ? RECOMMENDED_CHECK_IN_SECONDS[s.source] : 0;
  useEffect(() => {
    if (
      !s ||
      s.status !== "active" ||
      elapsed < targetSeconds ||
      autoCompleteStarted.current
    )
      return;
    autoCompleteStarted.current = true;
    setAutoCompleting(true);
    let cancelled = false;
    void api(`/sessions/${s.id}/complete`, {})
      .then(() => {
        if (!cancelled) onFinished();
      })
      .catch((error) => {
        if (!cancelled)
          a.setError(
            error instanceof Error
              ? error.message
              : "Could not finish check-in",
          );
      })
      .finally(() => {
        if (!cancelled) setAutoCompleting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [a, elapsed, onFinished, s, targetSeconds]);
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
      {s.source === "presage" && phoneCamera && (
        <>
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            aria-label="Live camera preview"
            style={{
              width: "100%",
              borderRadius: 12,
              transform: "scaleX(-1)",
              display: cameraError ? "none" : "block",
            }}
          />
          <p className="fine-print">
            {cameraError
              ? "Camera stopped after an error. Finish this check-in before retrying."
              : cameraActive
                ? "Camera active. Frames are processed transiently by Presage; no video is saved."
                : "Requesting camera access…"}
          </p>
        </>
      )}
      {s.source === "presage" && !phoneCamera && (
        <>
          <CameraPreview sessionId={s.id} />
          <div className="notice demo">
            <p>
              Camera preview still waiting? Continue the labelled presentation
              demo without claiming a camera result.
            </p>
            <button
              type="button"
              className="button secondary mobile-big"
              disabled={a.busy || autoCompleting}
              onClick={() =>
                void a.run(async () => {
                  await api(`/sessions/${s.id}/complete`, {});
                  onFinished();
                })
              }
            >
              {a.busy || autoCompleting
                ? "Finishing…"
                : "Continue with presentation demo"}
            </button>
          </div>
        </>
      )}
      <div className="mobile-countdown">
        <span>Remaining</span>
        <strong data-testid="checkin-elapsed">
          {formatCountdown(Math.max(0, targetSeconds - elapsed))}
        </strong>
      </div>
      <p className="fine-print">
        Standard {targetSeconds}-second demo check-in. It will finish
        automatically; you can finish early. This duration is a demo flow, not a
        medical threshold.
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
      <ErrorNotice message={a.error || cameraError || stream.error} />
      {(cameraError || stream.error) && s.source === "presage" && (
        <button
          type="button"
          className="button secondary mobile-big"
          disabled={a.busy}
          onClick={() =>
            void a.run(async () => {
              await api(`/sessions/${s.id}/complete`, {});
              onFinished();
            })
          }
        >
          {a.busy
            ? "Resetting camera…"
            : "Start a fresh browser camera check-in"}
        </button>
      )}
      <button
        type="button"
        className="button primary mobile-big"
        disabled={a.busy || autoCompleting}
        onClick={() =>
          void a.run(async () => {
            await api(`/sessions/${s.id}/complete`, {});
            onFinished();
          })
        }
      >
        <Square size={16} />
        {a.busy || autoCompleting ? "Finishing…" : "Finish early"}
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
