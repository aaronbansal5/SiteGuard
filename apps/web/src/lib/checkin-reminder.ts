// Voluntary check-in reminders for the phone layout (docs/MOBILE_APP.md).
//
// A reminder is only a gentle, in-app nudge. This module has no access to the
// session API and therefore can never start a measurement: the worker must
// open the consent screen and agree every time. Interval values are demo /
// convenience settings, not rest or recovery recommendations.

/** Demo interval used when the server runs in DEMO_MODE (synthetic source). */
export const DEMO_REMINDER_INTERVAL_SECONDS = 60;
/** Default outside demo mode. A convenience setting, not a rest guideline. */
export const STANDARD_REMINDER_INTERVAL_SECONDS = 30 * 60;
export const MIN_REMINDER_INTERVAL_SECONDS = 30;
export const MAX_REMINDER_INTERVAL_SECONDS = 4 * 60 * 60;
export const REMINDER_STORAGE_KEY = "siteguard.mobile.reminder.v1";

export function defaultReminderInterval(demoMode: boolean) {
  return demoMode
    ? DEMO_REMINDER_INTERVAL_SECONDS
    : STANDARD_REMINDER_INTERVAL_SECONDS;
}

/**
 * Parses a user-entered interval. Non-numeric or non-finite input returns the
 * fallback; numbers are rounded to whole seconds and clamped to the bounds.
 */
export function parseReminderInterval(input: unknown, fallback: number) {
  const n =
    typeof input === "number"
      ? input
      : typeof input === "string" && input.trim() !== ""
        ? Number(input)
        : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(
    MAX_REMINDER_INTERVAL_SECONDS,
    Math.max(MIN_REMINDER_INTERVAL_SECONDS, Math.round(n)),
  );
}

/** mm:ss (or h:mm:ss) for a countdown; negative values show 00:00. */
export function formatCountdown(totalSeconds: number) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    r = s % 60;
  const mm = String(m).padStart(2, "0"),
    ss = String(r).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export type ReminderPhase = "off" | "waiting" | "due" | "checking_in";
export interface ReminderSnapshot {
  phase: ReminderPhase;
  intervalSeconds: number;
  /** Epoch ms when the next reminder becomes due; null when not counting. */
  dueAt: number | null;
  /** Whole seconds until due (0 when due, off or checking in). */
  remainingSeconds: number;
}
export interface ReminderOptions {
  intervalSeconds: number;
  now?: () => number;
  tickMs?: number;
  onChange?: (snapshot: ReminderSnapshot) => void;
  /** Called exactly once per cycle when the countdown reaches zero. */
  onDue?: (snapshot: ReminderSnapshot) => void;
}

/**
 * Countdown state machine:
 *   off --enable--> waiting --interval elapses--> due
 *   due --dismiss ("Not now")--> waiting (restarts from now)
 *   waiting|due --beginCheckIn--> checking_in (paused; no reminders)
 *   checking_in --endCheckIn (completed or cancelled)--> waiting (from now)
 *   any --disable--> off
 * Changing the interval restarts the countdown from now unless paused/off.
 */
export class CheckInReminder {
  private phase: ReminderPhase = "off";
  private intervalSeconds: number;
  private dueAt: number | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly now: () => number;
  private readonly tickMs: number;
  constructor(private readonly options: ReminderOptions) {
    this.intervalSeconds = parseReminderInterval(
      options.intervalSeconds,
      DEMO_REMINDER_INTERVAL_SECONDS,
    );
    this.now = options.now ?? (() => Date.now());
    this.tickMs = options.tickMs ?? 1000;
  }
  snapshot(): ReminderSnapshot {
    const remaining =
      this.phase === "waiting" && this.dueAt !== null
        ? Math.max(0, Math.ceil((this.dueAt - this.now()) / 1000))
        : 0;
    return {
      phase: this.phase,
      intervalSeconds: this.intervalSeconds,
      dueAt: this.phase === "waiting" ? this.dueAt : null,
      remainingSeconds: remaining,
    };
  }
  enable() {
    if (this.phase === "off") this.restart();
  }
  disable() {
    this.clearTimer();
    this.phase = "off";
    this.dueAt = null;
    this.emit();
  }
  setIntervalSeconds(seconds: number) {
    this.intervalSeconds = parseReminderInterval(seconds, this.intervalSeconds);
    if (this.phase === "waiting" || this.phase === "due") this.restart();
    else this.emit();
  }
  /** "Not now": the worker chose not to check in; wait a full interval. */
  dismiss() {
    if (this.phase === "due" || this.phase === "waiting") this.restart();
  }
  /** The worker opened the consent screen; pause reminders meanwhile. */
  beginCheckIn() {
    if (this.phase === "off") return;
    this.clearTimer();
    this.phase = "checking_in";
    this.dueAt = null;
    this.emit();
  }
  /** The check-in finished or was cancelled; the next interval starts now. */
  endCheckIn() {
    if (this.phase === "checking_in") this.restart();
  }
  dispose() {
    this.clearTimer();
  }
  private restart() {
    this.clearTimer();
    this.phase = "waiting";
    this.dueAt = this.now() + this.intervalSeconds * 1000;
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.emit();
  }
  private tick() {
    if (this.phase !== "waiting" || this.dueAt === null) return;
    if (this.now() >= this.dueAt) {
      this.clearTimer();
      this.phase = "due";
      this.dueAt = null;
      const snapshot = this.snapshot();
      this.options.onChange?.(snapshot);
      this.options.onDue?.(snapshot);
      return;
    }
    this.emit();
  }
  private emit() {
    this.options.onChange?.(this.snapshot());
  }
  private clearTimer() {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }
}

export interface ReminderSettings {
  enabled: boolean;
  intervalSeconds: number;
}

/** Per-device convenience settings; storage may be unavailable or throw. */
export function loadReminderSettings(
  storage: Pick<Storage, "getItem"> | undefined,
  fallback: ReminderSettings,
): ReminderSettings {
  try {
    const raw = storage?.getItem(REMINDER_STORAGE_KEY);
    if (!raw) return fallback;
    const value = JSON.parse(raw) as Partial<ReminderSettings>;
    return {
      enabled:
        typeof value.enabled === "boolean" ? value.enabled : fallback.enabled,
      intervalSeconds: parseReminderInterval(
        value.intervalSeconds,
        fallback.intervalSeconds,
      ),
    };
  } catch {
    return fallback;
  }
}
export function saveReminderSettings(
  storage: Pick<Storage, "setItem"> | undefined,
  settings: ReminderSettings,
) {
  try {
    storage?.setItem(REMINDER_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* private mode or blocked storage: settings stay in memory only */
  }
}

/** Minimal view of the browser Notification API used here. */
export interface NotificationHost {
  Notification?: {
    permission: NotificationPermission;
    new (title: string, options?: NotificationOptions): unknown;
  };
  document?: { visibilityState: DocumentVisibilityState };
}
export const REMINDER_NOTIFICATION = {
  title: "SiteGuard check-in available",
  body: "Optional. Open SiteGuard if you would like to check in. Skipping changes nothing.",
};

/**
 * Shows a system notification only when the worker has already granted
 * permission (requested from an explicit button, never automatically) and the
 * page is hidden. Returns whether a notification was shown. Constructor
 * failures (e.g. Android Chrome requires a service worker) fall back to the
 * in-app prompt.
 */
export function notifyReminderIfPermitted(host: NotificationHost) {
  const N = host.Notification;
  if (!N || N.permission !== "granted") return false;
  if (host.document?.visibilityState !== "hidden") return false;
  try {
    new N(REMINDER_NOTIFICATION.title, {
      body: REMINDER_NOTIFICATION.body,
      tag: "siteguard-checkin-reminder",
    });
    return true;
  } catch {
    return false;
  }
}
