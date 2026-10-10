import { useState, useEffect, useRef, useId, type ReactNode } from "react";
import {
  X,
  TriangleAlert,
  ArrowUpRight,
  HandHelping,
  ShieldCheck,
  Check,
} from "lucide-react";
import { api, useAction } from "../lib/api";
export function ErrorNotice({ message }: { message?: string }) {
  return message ? (
    <div className="notice error" role="alert">
      <TriangleAlert size={18} />
      <span>{message}</span>
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" /> Loading workspace…
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current
      ?.querySelector<HTMLElement>("input,textarea,select,button")
      ?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
        if (e.key === "Tab") {
          const controls = ref.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
          );
          if (!controls?.length) return;
          const first = controls[0],
            last = controls[controls.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="modal"
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export const SYMPTOM_LABELS: Record<string, string> = {
  dizzy: "Feeling dizzy",
  nauseated: "Feeling nauseated",
  headache: "Headache",
  other: "Other",
};
export function HelpActions({
  sessionId = null,
  onSent,
}: {
  sessionId?: string | null;
  onSent?: () => void;
}) {
  const [mode, setMode] = useState<"rest" | "symptoms" | null>(null),
    [minutes, setMinutes] = useState(5),
    [symptom, setSymptom] = useState("dizzy"),
    [note, setNote] = useState(""),
    [sent, setSent] = useState("");
  const a = useAction();
  const submit = (kind: "assistance" | "additional_rest") =>
    a.run(async () => {
      await api("/rest-requests", {
        sessionId,
        kind,
        requestedMinutes: kind === "assistance" ? null : minutes,
      });
      setSent(
        kind === "assistance"
          ? "Assistance request sent. Await human follow-up; this app does not dispatch emergency services."
          : "Additional rest requested. Your supervisor can coordinate coverage.",
      );
      setMode(null);
      onSent?.();
    });
  return (
    <>
      <div className="help-actions">
        <button
          className="button secondary"
          disabled={a.busy}
          onClick={() => {
            setSent("");
            a.setError("");
            setMode("rest");
          }}
        >
          <ArrowUpRight size={16} /> Request additional rest
        </button>
        <button
          className="button secondary"
          disabled={a.busy}
          onClick={() => {
            setSent("");
            a.setError("");
            setMode("symptoms");
          }}
        >
          Report a symptom
        </button>
        <button
          className="button assistance"
          disabled={a.busy}
          onClick={() => void submit("assistance")}
        >
          <HandHelping size={16} /> Request assistance
        </button>
      </div>
      <ErrorNotice message={a.error} />
      {sent && (
        <div className="notice success" role="status">
          <Check size={18} />
          {sent}
        </div>
      )}
      {mode && (
        <Modal
          title={
            mode === "rest" ? "Request additional rest" : "Report a symptom"
          }
          onClose={() => setMode(null)}
        >
          <p className="muted">
            Requests reach the supervisor independently of measurement results.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (mode === "rest") void submit("additional_rest");
              else
                void a.run(async () => {
                  await api("/symptom-reports", {
                    sessionId,
                    codes: [symptom],
                    note: note || null,
                  });
                  setSent(
                    "Symptom report and assistance request saved. Await human follow-up.",
                  );
                  setMode(null);
                  onSent?.();
                });
            }}
          >
            {mode === "rest" ? (
              <label>
                Additional minutes
                <input
                  type="number"
                  min={1}
                  max={120}
                  required
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                />
              </label>
            ) : (
              <>
                <label>
                  Symptom
                  <select
                    value={symptom}
                    onChange={(e) => setSymptom(e.target.value)}
                  >
                    {Object.entries(SYMPTOM_LABELS).map(([code, label]) => (
                      <option key={code} value={code}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Optional note
                  <textarea
                    maxLength={500}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
              </>
            )}
            <ErrorNotice message={a.error} />
            <button className="button primary" disabled={a.busy}>
              {a.busy ? "Sending…" : "Send request"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function SafetyNote() {
  return (
    <div className="safety-note">
      <ShieldCheck size={19} />
      <span>
        Observations support a conversation. They do not establish recovery or
        fitness for work.
      </span>
    </div>
  );
}
