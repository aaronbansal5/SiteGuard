import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CheckInReminder,
  DEMO_REMINDER_INTERVAL_SECONDS,
  MAX_REMINDER_INTERVAL_SECONDS,
  MIN_REMINDER_INTERVAL_SECONDS,
  REMINDER_STORAGE_KEY,
  STANDARD_REMINDER_INTERVAL_SECONDS,
  defaultReminderInterval,
  formatCountdown,
  loadReminderSettings,
  notifyReminderIfPermitted,
  parseReminderInterval,
  saveReminderSettings,
  type ReminderSnapshot,
} from "./checkin-reminder";

describe("interval settings", () => {
  it("defaults to a 60 s demo interval in DEMO_MODE only", () => {
    expect(DEMO_REMINDER_INTERVAL_SECONDS).toBe(60);
    expect(defaultReminderInterval(true)).toBe(60);
    expect(defaultReminderInterval(false)).toBe(
      STANDARD_REMINDER_INTERVAL_SECONDS,
    );
  });
  it("parses, rounds and clamps user input", () => {
    expect(parseReminderInterval("90", 60)).toBe(90);
    expect(parseReminderInterval(75.4, 60)).toBe(75);
    expect(parseReminderInterval("5", 60)).toBe(MIN_REMINDER_INTERVAL_SECONDS);
    expect(parseReminderInterval(1e9, 60)).toBe(MAX_REMINDER_INTERVAL_SECONDS);
    for (const bad of ["", "  ", "abc", Number.NaN, Infinity, null, {}])
      expect(parseReminderInterval(bad, 60)).toBe(60);
  });
  it("formats countdowns", () => {
    expect(formatCountdown(60)).toBe("01:00");
    expect(formatCountdown(59.2)).toBe("01:00");
    expect(formatCountdown(5)).toBe("00:05");
    expect(formatCountdown(-3)).toBe("00:00");
    expect(formatCountdown(3725)).toBe("1:02:05");
  });
});

describe("CheckInReminder (fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T15:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  const make = (intervalSeconds = DEMO_REMINDER_INTERVAL_SECONDS) => {
    const changes: ReminderSnapshot[] = [];
    const onDue = vi.fn();
    const r = new CheckInReminder({
      intervalSeconds,
      onChange: (s) => changes.push(s),
      onDue,
    });
    return { r, changes, onDue };
  };

  it("starts off and does nothing until enabled", () => {
    const { r, onDue } = make();
    expect(r.snapshot().phase).toBe("off");
    vi.advanceTimersByTime(10 * 60_000);
    expect(onDue).not.toHaveBeenCalled();
    r.dispose();
  });

  it("counts down the 60 s demo interval and becomes due exactly once", () => {
    const { r, onDue, changes } = make();
    r.enable();
    expect(r.snapshot()).toMatchObject({
      phase: "waiting",
      remainingSeconds: 60,
    });
    vi.advanceTimersByTime(30_000);
    expect(r.snapshot().remainingSeconds).toBe(30);
    expect(changes.at(-1)?.remainingSeconds).toBe(30);
    vi.advanceTimersByTime(29_000);
    expect(onDue).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(onDue).toHaveBeenCalledTimes(1);
    expect(r.snapshot()).toMatchObject({ phase: "due", remainingSeconds: 0 });
    // Stays due (no repeated nagging) until the worker responds.
    vi.advanceTimersByTime(10 * 60_000);
    expect(onDue).toHaveBeenCalledTimes(1);
    expect(r.snapshot().phase).toBe("due");
    r.dispose();
  });

  it("'Not now' restarts a full interval from the dismissal", () => {
    const { r, onDue } = make();
    r.enable();
    vi.advanceTimersByTime(60_000);
    expect(onDue).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    r.dismiss();
    expect(r.snapshot()).toMatchObject({
      phase: "waiting",
      remainingSeconds: 60,
    });
    vi.advanceTimersByTime(59_000);
    expect(onDue).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(onDue).toHaveBeenCalledTimes(2);
    r.dispose();
  });

  it("pauses while a check-in is open and restarts when it ends", () => {
    const { r, onDue } = make();
    r.enable();
    vi.advanceTimersByTime(20_000);
    r.beginCheckIn();
    expect(r.snapshot()).toMatchObject({
      phase: "checking_in",
      dueAt: null,
      remainingSeconds: 0,
    });
    vi.advanceTimersByTime(5 * 60_000);
    expect(onDue).not.toHaveBeenCalled();
    r.endCheckIn();
    expect(r.snapshot()).toMatchObject({
      phase: "waiting",
      remainingSeconds: 60,
    });
    vi.advanceTimersByTime(60_000);
    expect(onDue).toHaveBeenCalledTimes(1);
    r.dispose();
  });

  it("changing the interval restarts the countdown; bounds apply", () => {
    const { r, onDue } = make();
    r.enable();
    vi.advanceTimersByTime(40_000);
    r.setIntervalSeconds(90);
    expect(r.snapshot()).toMatchObject({
      intervalSeconds: 90,
      remainingSeconds: 90,
    });
    vi.advanceTimersByTime(60_000);
    expect(onDue).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(onDue).toHaveBeenCalledTimes(1);
    r.setIntervalSeconds(1);
    expect(r.snapshot().intervalSeconds).toBe(MIN_REMINDER_INTERVAL_SECONDS);
    r.dispose();
  });

  it("disable stops all reminders; endCheckIn while off is ignored", () => {
    const { r, onDue } = make();
    r.enable();
    r.disable();
    r.beginCheckIn();
    r.endCheckIn();
    expect(r.snapshot().phase).toBe("off");
    vi.advanceTimersByTime(10 * 60_000);
    expect(onDue).not.toHaveBeenCalled();
    r.dispose();
  });

  it("dispose clears the timer", () => {
    const { r, onDue } = make();
    r.enable();
    r.dispose();
    vi.advanceTimersByTime(10 * 60_000);
    expect(onDue).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("exposes no way to start a measurement", () => {
    const { r } = make();
    const api = Object.getOwnPropertyNames(CheckInReminder.prototype);
    expect(api.filter((name) => /measure|session|consent/i.test(name))).toEqual(
      [],
    );
    r.dispose();
  });
});

describe("settings storage", () => {
  const fallback = { enabled: true, intervalSeconds: 60 };
  it("round-trips and validates stored settings", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
    saveReminderSettings(storage, { enabled: false, intervalSeconds: 120 });
    expect(loadReminderSettings(storage, fallback)).toEqual({
      enabled: false,
      intervalSeconds: 120,
    });
    map.set(REMINDER_STORAGE_KEY, '{"enabled":"yes","intervalSeconds":2}');
    expect(loadReminderSettings(storage, fallback)).toEqual({
      enabled: true,
      intervalSeconds: MIN_REMINDER_INTERVAL_SECONDS,
    });
    map.set(REMINDER_STORAGE_KEY, "not json");
    expect(loadReminderSettings(storage, fallback)).toEqual(fallback);
  });
  it("tolerates missing or throwing storage", () => {
    expect(loadReminderSettings(undefined, fallback)).toEqual(fallback);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadReminderSettings(throwing, fallback)).toEqual(fallback);
    expect(() => saveReminderSettings(throwing, fallback)).not.toThrow();
  });
});

describe("background notification", () => {
  const host = (
    permission: NotificationPermission,
    visibilityState: DocumentVisibilityState,
    ctor: (title: string, options?: NotificationOptions) => void = vi.fn(),
  ) => ({
    Notification: Object.assign(
      function (this: unknown, title: string, options?: NotificationOptions) {
        ctor(title, options);
      } as unknown as { new (t: string, o?: NotificationOptions): unknown },
      { permission },
    ),
    document: { visibilityState },
  });
  it("only notifies with granted permission while the page is hidden", () => {
    const ctor = vi.fn();
    expect(notifyReminderIfPermitted(host("default", "hidden", ctor))).toBe(
      false,
    );
    expect(notifyReminderIfPermitted(host("denied", "hidden", ctor))).toBe(
      false,
    );
    expect(notifyReminderIfPermitted(host("granted", "visible", ctor))).toBe(
      false,
    );
    expect(ctor).not.toHaveBeenCalled();
    expect(notifyReminderIfPermitted(host("granted", "hidden", ctor))).toBe(
      true,
    );
    expect(ctor).toHaveBeenCalledWith(
      "SiteGuard check-in available",
      expect.objectContaining({ body: expect.stringMatching(/^Optional\./) }),
    );
  });
  it("falls back when unsupported or the constructor throws", () => {
    expect(notifyReminderIfPermitted({})).toBe(false);
    const throwing = host("granted", "hidden", () => {
      throw new TypeError("Illegal constructor");
    });
    expect(notifyReminderIfPermitted(throwing)).toBe(false);
  });
});
