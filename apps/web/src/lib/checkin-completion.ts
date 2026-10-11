import { useCallback, useEffect, useRef, useState } from "react";
import {
  RECOMMENDED_CHECK_IN_SECONDS,
  type Session,
} from "@siteguard/contracts";
import { api } from "./api";

/** One completion path for the timer, finish button and reconnect recovery. */
export function useCheckInCompletion(
  session: Session | undefined,
  onFinished: (sessionId: string) => void,
) {
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const attempted = useRef<string | undefined>(undefined);
  const notified = useRef<string | undefined>(undefined);
  const mounted = useRef(false);
  const finished = useRef(onFinished);
  finished.current = onFinished;
  const id = session?.id;
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, []);
  const notify = useCallback((sessionId: string) => {
    if (mounted.current && notified.current !== sessionId) {
      notified.current = sessionId;
      finished.current(sessionId);
    }
  }, []);
  const finish = useCallback(async () => {
    if (!id || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      // Completion can outlast the usual 15-second request budget while the
      // camera is starting/stopping. After an ambiguous response, read state
      // before allowing another completion request.
      try {
        await api(`/sessions/${id}/complete`, {});
      } catch (failure) {
        const result = await api<{ session: Session }>(`/sessions/${id}`).catch(
          () => undefined,
        );
        if (result?.session.status !== "completed") throw failure;
      }
      notify(id);
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not finish check-in. Retry below.",
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [id, notify]);
  const targetSeconds = session
    ? RECOMMENDED_CHECK_IN_SECONDS[session.source]
    : 0;
  const elapsed = session
    ? Math.max(0, Math.floor((now - Date.parse(session.startedAt)) / 1000))
    : 0;
  useEffect(() => {
    if (!id) return;
    if (session?.status === "completed") {
      notify(id);
    } else if (elapsed >= targetSeconds && attempted.current !== id) {
      attempted.current = id;
      void finish();
    }
  }, [id, session?.status, elapsed, targetSeconds, finish, notify]);
  return {
    elapsed,
    targetSeconds,
    remaining: Math.max(0, targetSeconds - elapsed),
    busy,
    error,
    finish,
  };
}
