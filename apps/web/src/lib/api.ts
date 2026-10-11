import { useCallback, useEffect, useRef, useState } from "react";
export async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  signal?: AbortSignal,
): Promise<T> {
  // Presage startup waits for the native camera, and completion drains it.
  // Both routes have bounded backend work that can exceed a normal read.
  const cameraLifecycle =
    method === "POST" &&
    (path === "/sessions" || /^\/sessions\/[^/]+\/complete$/.test(path));
  const deadline = AbortSignal.timeout(cameraLifecycle ? 45000 : 15000);
  let response: Response;
  try {
    response = await fetch("/api" + path, {
      method,
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch (error) {
    if (deadline.aborted && !signal?.aborted)
      throw new Error(
        "The service took too long. This action could not be confirmed; check its status before retrying.",
      );
    throw error;
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "The service did not return a valid response. Check the action status before retrying.",
    );
  }
  if (response.status === 401 && path !== "/auth/me")
    window.dispatchEvent(new Event("siteguard:unauthenticated"));
  if (!response.ok)
    throw new Error(data.error?.message || "Request could not be confirmed");
  return data as T;
}
export function useResource<T>(path: string, interval?: number) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    try {
      const value = await api<T>(path, undefined, "GET", controller.signal);
      if (!controller.signal.aborted && mounted.current) {
        setData(value);
        setError("");
      }
    } catch (e) {
      if (!controller.signal.aborted && mounted.current)
        setError(
          e instanceof Error ? e.message : "Service unavailable. Please retry.",
        );
    } finally {
      if (!controller.signal.aborted && mounted.current) setLoading(false);
      if (active.current === controller) active.current = null;
    }
  }, [path]);
  useEffect(() => {
    mounted.current = true;
    setData(undefined);
    setError("");
    setLoading(true);
    void refresh();
    const timer = interval
      ? setInterval(() => {
          if (!active.current) void refresh();
        }, interval)
      : undefined;
    return () => {
      mounted.current = false;
      active.current?.abort();
      clearInterval(timer);
    };
  }, [refresh, interval]);
  return { data, error, loading, refresh };
}
export function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  const run = async (fn: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}
export const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const date = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
export const number = (value: number | null) =>
  value === null
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
