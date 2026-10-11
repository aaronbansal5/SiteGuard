import { Login } from "./Login";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Activity,
  Users,
  LockKeyhole,
  ScanLine,
  Check,
  FlaskConical,
  ArrowUpRight,
} from "lucide-react";
import type { Worker } from "@siteguard/contracts";
import { useResource, useAction } from "../lib/api";
import { useIdentity } from "../App";
import { ErrorNotice, PageHeading } from "../components/ui";
export function Landing() {
  const { config } = useIdentity();
  if (config?.mode === "supabase") return <Login />;
  if (config?.mode === "oidc")
    return (
      <>
        <PageHeading
          eyebrow="SITEGUARD / SIGN IN"
          title="Your workspace, your account."
          description="Sign in to access your assigned worker or manager workspace."
        />
        <section className="card">
          <h2>Secure account sign-in</h2>
          <p>
            Your site administrator assigns your role. Measurement consent is
            separate from signing in.
          </p>
          {config.loginAvailable ? (
            <a className="button primary" href="/api/auth/login">
              Sign in to SiteGuard <ArrowRight size={17} />
            </a>
          ) : (
            <ErrorNotice message="Account sign-in is not configured. Contact your site administrator." />
          )}
        </section>
      </>
    );
  return <DemoLanding />;
}
function DemoLanding() {
  const workers = useResource<{ workers: Worker[] }>("/workers");
  const [workerId, setWorkerId] = useState("");
  const { login } = useIdentity(),
    navigate = useNavigate(),
    a = useAction();
  const open = (role: "worker" | "supervisor") =>
    a.run(async () => {
      await login(
        role === "worker"
          ? { role, workerId: workerId || workers.data!.workers[0].id }
          : { role },
      );
      navigate(role === "worker" ? "/worker" : "/supervisor");
    });
  return (
    <>
      <PageHeading
        eyebrow="SITEGUARD / WORKSPACE"
        title="A better view of the break."
        description="Voluntary recovery check-ins. Protected rest. Coordinated coverage."
        action={
          <span className="badge">
            <span className="dot" /> Local demonstration
          </span>
        }
      />
      <section className="hero">
        <div className="hero-copy">
          <span className="hero-kicker">
            <ShieldIcon /> PEOPLE FIRST. OPERATIONS CONNECTED.
          </span>
          <h2>
            Make room for rest.
            <br />
            <span>Keep people in view.</span>
          </h2>
          <p>
            See how pulse and breathing change during a break, listen to worker
            needs, and adjust coverage around protected rest.
          </p>
          <div className="hero-tags">
            <span>
              <LockKeyhole size={15} /> Protected breaks
            </span>
            <span>
              <ScanLine size={15} /> Contactless check-ins
            </span>
          </div>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="visual-top">
            <span className="dot" />
            RECOVERY CHECK-IN<span>01:00</span>
          </div>
          <div className="visual-metric">
            <Activity size={24} />
            <div>
              <strong>
                88<small>bpm</small>
              </strong>
              <span>Synthetic pulse observation</span>
            </div>
            <svg viewBox="0 0 140 45">
              <path d="M0 25 L20 25 L27 12 L34 37 L41 6 L48 25 L68 25 L75 20 L90 24 L110 23 L120 14 L126 32 L133 23 L140 23" />
            </svg>
          </div>
          <div className="visual-bars">
            {[70, 83, 63, 76, 57, 60, 48, 55, 38, 43, 30, 36].map((n, i) => (
              <i key={i} style={{ height: `${n}%` }} />
            ))}
          </div>
          <div className="visual-bottom">
            <LockKeyhole size={14} /> Required break preserved{" "}
            <Check size={14} />
          </div>
          <span className="visual-label">ILLUSTRATIVE SYNTHETIC DATA</span>
        </div>
      </section>
      <div className="section-title">
        <h2>Choose your workspace</h2>
        <span>Demo role selection · no production authentication</span>
      </div>
      <div className="portal-grid">
        <section className="card portal-card">
          <span className="portal-icon">
            <Activity size={24} />
          </span>
          <div className="eyebrow">FOR THE WORKER</div>
          <h2>Your break, your check-in.</h2>
          <p>
            Observe changes during rest, review your history, and ask for
            support whenever you need it.
          </p>
          <label>
            Demo worker
            <select
              aria-label="Demo worker"
              value={workerId || workers.data?.workers[0]?.id || ""}
              onChange={(e) => setWorkerId(e.target.value)}
            >
              {workers.data?.workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.displayName}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button primary full"
            disabled={a.busy || !workers.data}
            onClick={() => void open("worker")}
          >
            Open worker portal <ArrowRight size={17} />
          </button>
        </section>
        <section className="card portal-card">
          <span className="portal-icon blue">
            <Users size={24} />
          </span>
          <div className="eyebrow">FOR SAFETY OPERATIONS</div>
          <h2>Coordinate with care.</h2>
          <p>
            Respond to requests, see protected breaks, and plan task coverage
            around worker needs.
          </p>
          <div className="portal-checks">
            <span>
              <Check size={16} /> Required rest stays protected
            </span>
            <span>
              <Check size={16} /> Physiological history is private by default
            </span>
          </div>
          <button
            className="button secondary full"
            disabled={a.busy}
            onClick={() => void open("supervisor")}
          >
            Open safety operations <ArrowUpRight size={17} />
          </button>
        </section>
      </div>
      <ErrorNotice message={a.error || workers.error} />
      <div className="notice demo">
        <FlaskConical size={20} />
        <div>
          <strong>An honest, repeatable demonstration</strong>
          <p>
            Mock measurements and historical sessions are synthetic. Real
            Presage check-ins use a separate, verified local camera bridge.
          </p>
        </div>
      </div>
    </>
  );
}
function ShieldIcon() {
  return <LockKeyhole size={13} />;
}
