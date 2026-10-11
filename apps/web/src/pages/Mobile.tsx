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

type Health = {
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

function cameraErrorMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError")
      return "Camera access was not allowed. Allow Camera in this site's Safari settings, then try again. You can still request rest without a check-in.";
    if (error.name === "NotFoundError")
      return "No camera was found. Open SiteGuard on a phone with a front camera.";
    if (error.name === "NotReadableError")
      return "The camera is busy. Close other apps using it, then try again.";
  }
  return error instanceof Error
    ? error.message
    : "Camera access failed. Try again.";
}

export function MobileApp() {
  const { identity } = useIdentity();
  const [choosing, setChoosing] = useState(false);
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
          <button
            type="button"
            className="button ghost mobile-switch"
            onClick={() => setChoosing(true)}
          >
            Switch worker
          </button>
        )}
      </header>
      <div className="mobile-demo-strip">
        <FlaskConical size={14} /> Fictional workforce · camera readings are
        real only when labeled Presage
      </div>
      <main id="main" className="mobile-main">
        {identity?.role !== "worker" || choosing ? (
          <ChooseMobileWorker onChosen={() => setChoosing(false)} />
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
  const activeBreak = sorted.find(
    (b) => Date.parse(b.startsAt) <= now && Date.parse(b.endsAt) > now,
  );
  const nextBreak = sorted.find((b) => Date.parse(b.startsAt) > now);
  const canMeasure =
    !health.loading &&
    !breaks.loading &&
    Boolean(browserCamera || demoMode) &&
    Boolean(activeBreak);
  const blockedReason =
    health.loading || breaks.loading
      ? "Checking camera availability and your break schedule…"
      : !browserCamera && !demoMode
        ? !window.isSecureContext
          ? "Open SiteGuard's trusted HTTPS link on this phone to enable the camera. Rest requests are still available."
          : "Camera check-in is unavailable. Ask the demo host to check the Presage connection. Rest requests are still available."
        : !activeBreak
          ? `Check-ins open during your scheduled break${nextBreak ? ` (next: ${time(nextBreak.startsAt)})` : ""}.`
          : "";

  return (
    <>
      {stage.kind !== "home" && (
        <p className="eyebrow" aria-label="Check-in steps">
          {stage.kind === "consent"
            ? "1 of 3 · Consent"
            : stage.kind === "measuring"
              ? "2 of 3 · Live check-in"
              : "3 of 3 · Summary & rest request"}
        </p>
      )}
      <ErrorNotice
        message={health.error || breaks.error || history.error || ""}
      />
      {stage.kind === "home" && (
        <>
          <MobileHome
            reminder={reminder}
            demoMode={demoMode}
            browserCamera={browserCamera}
            activeBreak={activeBreak}
            canMeasure={canMeasure}
            blockedReason={blockedReason}
            onStart={() => setStage({ kind: "consent" })}
          />
          <details className="mobile-card">
            <summary>Using the native iPhone app? Pair it here</summary>
            <DevicePairingCard />
          </details>
        </>
      )}
      {stage.kind === "consent" && (
        <MobileConsent
          breakId={activeBreak?.id ?? null}
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
      {(stage.kind === "consent" || stage.kind === "measuring") && (
        <section className="mobile-card">
          <h2>Need support?</h2>
          <p className="muted">
            Requests reach a person, with or without a measurement.
          </p>
          <HelpActions
            sessionId={stage.kind === "measuring" ? stage.sessionId : null}
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

      <section className="mobile-card">
        <h1>Check in now</h1>
        <p className="muted">
          Consent → check-in → summary. About{" "}
          {browserCamera
            ? RECOMMENDED_CHECK_IN_SECONDS.presage
            : RECOMMENDED_CHECK_IN_SECONDS.mock}{" "}
          seconds; stop whenever you want.
        </p>
        <p className="fine-print">
          {browserCamera
            ? "Use your front camera. Your browser asks for permission after you agree. No video is saved."
            : demoMode
              ? "Synthetic demo is available. It uses no camera and does not measure your pulse or breathing."
              : "Camera availability is shown below."}
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
          <h2>Check-in reminders</h2>
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
            <details>
              <summary>Reminder settings (optional)</summary>
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
                A reminder is a convenience, not a rest or health
                recommendation. It never starts a measurement.
              </p>
              <label className="checkbox mobile-toggle">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(e) => reminder.setEnabled(e.target.checked)}
                />
                <span>
                  {settings.enabled ? (
                    <Bell size={16} />
                  ) : (
                    <BellOff size={16} />
                  )}{" "}
                  Remind me to check in
                </span>
              </label>
              <NotificationOptIn />
            </details>
          </>
        )}
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
  const supported =
    typeof window !== "undefined" &&
    "Notification" in window &&
    window.isSecureContext;
  const [permission, setPermission] = useState<NotificationPermission | null>(
    supported ? Notification.permission : null,
  );
  if (isIOS)
    return (
      <p className="fine-print">
        Safari tabs on iPhone cannot deliver reliable timed background alerts.
        The reminder appears on this page while it is open. For background
        alerts, use the installed SiteGuard iPhone app and enable its local
        notifications.
      </p>
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
  browserCamera,
  demoMode,
  canMeasure,
  blockedReason,
  onCancel,
  onStarted,
}: {
  breakId: string | null;
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
      browserCamera ? "presage" : "mock",
    ),
    [share, setShare] = useState(false);
  const a = useAction();
  const mounted = useRef(false);
  const ownedMedia = useRef<MediaStream | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ownedMedia.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  return (
    <form
      className="mobile-card"
      onSubmit={(e) => {
        e.preventDefault();
        if (!consent || !breakId || !canMeasure || a.busy) return;
        void a.run(async () => {
          let media: MediaStream | undefined;
          if (source === "presage") {
            if (
              !window.isSecureContext ||
              !navigator.mediaDevices?.getUserMedia
            )
              throw new Error("Camera check-in requires HTTPS on this phone.");
            try {
              media = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                  facingMode: "user",
                  width: { ideal: 960 },
                  height: { ideal: 720 },
                  frameRate: { ideal: 30 },
                },
              });
            } catch (error) {
              throw new Error(cameraErrorMessage(error));
            }
            if (!mounted.current) {
              media.getTracks().forEach((track) => track.stop());
              return;
            }
            ownedMedia.current = media;
          }
          try {
            const result = await api<{ session: Session }>("/sessions", {
              breakId,
              source,
              ...(source === "presage" ? { input: "custom" as const } : {}),
              consentVersion: "v1",
              shareWithSupervisor: share,
              context: { workload: null, temperatureC: null },
            });
            if (!mounted.current) {
              media?.getTracks().forEach((track) => track.stop());
              // Finish a start request that completed after leaving the screen.
              void api(`/sessions/${result.session.id}/complete`, {}).catch(
                () => {},
              );
              return;
            }
            ownedMedia.current = undefined;
            onStarted(result.session.id, media);
          } catch (error) {
            media?.getTracks().forEach((track) => track.stop());
            ownedMedia.current = undefined;
            throw error;
          }
        });
      }}
    >
      <span className="eyebrow">VOLUNTARY CHECK-IN · CONSENT</span>
      <h1>Before you begin</h1>
      <ul className="mobile-consent-points">
        <li>
          {source === "presage" ? (
            <>
              <strong>Your camera is used for this check-in.</strong> Frames are
              sent over HTTPS to the SiteGuard server for transient Presage
              processing. No video is saved. Tap Begin check-in, then Allow when
              your browser asks for camera permission. Microphone access is not
              needed. Stop at any time.
            </>
          ) : (
            <>
              <strong>Synthetic demo readings.</strong> No camera is used and
              these are not your pulse or breathing rate.
            </>
          )}
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
        <SourceBadge source={source} />
        <span>Measurement source for this check-in</span>
      </div>
      {browserCamera && demoMode && (
        <label>
          Check-in mode
          <select
            value={source}
            disabled={a.busy}
            onChange={(e) => setSource(e.target.value as "presage" | "mock")}
          >
            <option value="presage">iPhone camera · Presage</option>
            <option value="mock">Synthetic demo · no camera</option>
          </select>
        </label>
      )}
      <p className="fine-print">
        SiteGuard compares the beginning and end of your check-in and uses
        eligible past check-ins automatically.
      </p>
      <label className="checkbox mobile-toggle">
        <input
          type="checkbox"
          checked={share}
          disabled={a.busy}
          onChange={(e) => setShare(e.target.checked)}
        />
        <span>Share this session's summary with safety operations</span>
      </label>
      <label className="checkbox consent-check mobile-toggle">
        <input
          type="checkbox"
          checked={consent}
          disabled={a.busy}
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
          disabled={a.busy}
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
  const stopCamera = useRef<(() => void) | undefined>(undefined);
  // Also release an already-approved camera if loading fails or the worker
  // leaves before the session resource arrives.
  useEffect(
    () => () => {
      initialMedia?.getTracks().forEach((track) => track.stop());
    },
    [initialMedia],
  );
  useEffect(() => {
    if (s?.source !== "presage" || s.status !== "active") return;
    let stopped = false;
    let media: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = 0;
    let encoding = false;
    let lastTimestampUs = 0;
    const releaseCamera = () => {
      stopped = true;
      clearTimeout(timer);
      media?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    stopCamera.current = releaseCamera;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const failCapture = (error: unknown) => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      setCameraError(cameraErrorMessage(error));
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
          const scale = Math.min(1, 640 / Math.max(sourceWidth, sourceHeight));
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
            .then((response) => {
              if (!response.ok)
                throw new Error(
                  `Camera frame rejected (${response.status}). Check Presage and restart this check-in.`,
                );
            })
            .catch(failCapture)
            .finally(() => {
              inFlight--;
            });
        }
        if (!stopped)
          timer = setTimeout(
            () => void capture(),
            Math.max(0, 33 - (performance.now() - captureStartedAt)),
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
                width: { ideal: 960 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 },
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
        if (!stopped) setCameraError(cameraErrorMessage(error));
        media?.getTracks().forEach((track) => track.stop());
      }
    };
    void start();
    return () => {
      releaseCamera();
      if (stopCamera.current === releaseCamera) stopCamera.current = undefined;
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
      {s.source === "presage" && (
        <p className="muted">
          Keep your face in view, sit still and stay quiet. Pulse and breathing
          may take time to appear.
        </p>
      )}
      {s.source === "presage" && (
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
      <div className="mobile-countdown">
        <span>
          Elapsed · about {Math.max(0, target - elapsed)} seconds remaining
        </span>
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
        aria-valuetext={`${elapsed} seconds elapsed; suggested length ${target} seconds`}
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
        {quality === "valid"
          ? "Valid reading received"
          : "Waiting for a valid reading"}{" "}
        · {stream.status}
      </p>
      <ErrorNotice message={a.error || cameraError || stream.error} />
      <button
        type="button"
        className="button primary mobile-big"
        disabled={a.busy}
        onClick={() =>
          void a.run(async () => {
            stopCamera.current?.();
            initialMedia?.getTracks().forEach((track) => track.stop());
            setCameraActive(false);
            if (s.source === "presage")
              setCameraError(
                "Camera stopped. Finish this check-in to see your summary.",
              );
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
          summary.loading ? (
            <Loading />
          ) : (
            <button
              type="button"
              className="button secondary mobile-big"
              onClick={() => void summary.refresh()}
            >
              Retry summary
            </button>
          )
        ) : (
          <>
            <p className="muted">
              {Math.round(v.durationSeconds)} seconds recorded. Changes compare
              each metric's initial and final valid-reading windows. Missing
              readings are shown as insufficient data.
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
        <h2>Would you like more rest?</h2>
        <p className="muted">
          You choose whether to request additional rest, with or without enough
          readings. Your protected break stays in place.
        </p>
        <HelpActions sessionId={sessionId} />
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
