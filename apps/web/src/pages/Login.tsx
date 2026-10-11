import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ShieldCheck, Eye, EyeOff, ArrowRight, HardHat } from "lucide-react";
import { useIdentity } from "../App";
import { api, useAction } from "../lib/api";
import { ErrorNotice } from "../components/ui";

type Result = { signedIn?: boolean; message?: string };
export function Login() {
  const { config, refreshIdentity } = useIdentity(),
    location = useLocation(),
    navigate = useNavigate(),
    action = useAction();
  const [recovery, setRecovery] = useState(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = hash.get("access_token"),
      refreshToken = hash.get("refresh_token");
    return hash.get("type") === "recovery" && accessToken && refreshToken
      ? { accessToken, refreshToken }
      : null;
  });
  useEffect(() => {
    if (window.location.hash)
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
  }, []);
  const [mode, setMode] = useState<"login" | "signup" | "forgot" | "reset">(
    recovery ? "reset" : location.pathname === "/signup" ? "signup" : "login",
  );
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [name, setName] = useState("");
  const [visible, setVisible] = useState(false),
    [message, setMessage] = useState(
      new URLSearchParams(location.search).get("confirmed") === "1"
        ? "Email confirmed. You can now sign in."
        : "",
    );
  function change(next: typeof mode) {
    setMode(next);
    setPassword("");
    setConfirm("");
    setMessage("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    await action.run(async () => {
      if ((mode === "signup" || mode === "reset") && password !== confirm)
        throw Error("The passwords do not match.");
      const path =
        mode === "forgot" ? "reset-request" : mode === "reset" ? "reset" : mode;
      const result = await api<Result>(
        `/auth/password/${path}`,
        mode === "forgot"
          ? { email }
          : mode === "reset"
            ? { ...recovery, password }
            : mode === "signup"
              ? { email, password, displayName: name }
              : { email, password },
      );
      setPassword("");
      setConfirm("");
      if (result.signedIn) {
        const identity = await refreshIdentity();
        const next = new URLSearchParams(location.search).get("next");
        const destination =
          identity?.role === "supervisor"
            ? "/supervisor"
            : next === "/mobile"
              ? "/mobile"
              : "/worker";
        navigate(destination, { replace: true });
      } else {
        setMessage(result.message || "Check your email to continue.");
        if (mode === "reset") {
          await refreshIdentity();
          setRecovery(null);
          setMode("login");
        }
      }
    });
  }
  const title =
    mode === "signup"
      ? "Create your account"
      : mode === "forgot"
        ? "Reset your password"
        : mode === "reset"
          ? "Choose a new password"
          : "Welcome back";
  return (
    <section className="auth-layout">
      <div className="auth-intro">
        <span className="hero-kicker">
          <ShieldCheck size={18} /> SITEGUARD
        </span>
        <h1>
          People first.
          <br />
          <span>Every shift.</span>
        </h1>
        <p>
          Your workspace for check-ins, protected breaks and scene monitoring.
        </p>
        <div className="auth-benefit">
          <HardHat size={24} />
          <span>
            One sign-in. The right workspace.
            <small>Worker and admin access follow your account.</small>
          </span>
        </div>
      </div>
      <div className="card auth-card">
        <span className="eyebrow">YOUR SITEGUARD ACCOUNT</span>
        <h2>{title}</h2>
        <p>
          {mode === "signup"
            ? "Start with a worker account. Your site administrator manages elevated access."
            : mode === "forgot"
              ? "We’ll email a link so you can choose a new password."
              : mode === "reset"
                ? "Use at least eight characters."
                : "Sign in with your email and password."}
        </p>
        <ErrorNotice message={action.error} />
        {message && (
          <div className="auth-message" role="status">
            {message}
          </div>
        )}
        {!config?.loginAvailable && (
          <ErrorNotice message="Sign-in is not configured. Contact your site administrator." />
        )}
        <form onSubmit={(event) => void submit(event)}>
          {mode === "signup" && (
            <label>
              Full name
              <input
                autoComplete="name"
                required
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          )}
          {mode !== "reset" && (
            <label>
              Email address
              <input
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          )}
          {mode !== "forgot" && (
            <>
              <label>
                Password
                <div className="auth-password">
                  <input
                    type={visible ? "text" : "password"}
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                    required
                    minLength={mode === "login" ? 1 : 8}
                    maxLength={256}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="auth-eye"
                    aria-label={visible ? "Hide password" : "Show password"}
                    onClick={() => setVisible(!visible)}
                  >
                    {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </label>
              {(mode === "signup" || mode === "reset") && (
                <label>
                  Confirm password
                  <input
                    type={visible ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    maxLength={256}
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                  />
                </label>
              )}
            </>
          )}
          {mode === "login" && (
            <button
              type="button"
              className="auth-text-button"
              onClick={() => change("forgot")}
            >
              Forgot password?
            </button>
          )}
          <button
            className="button primary auth-submit"
            disabled={action.busy || !config?.loginAvailable}
          >
            {action.busy
              ? "Please wait…"
              : mode === "signup"
                ? "Create account"
                : mode === "forgot"
                  ? "Send reset link"
                  : mode === "reset"
                    ? "Update password"
                    : "Sign in"}
            <ArrowRight size={17} />
          </button>
        </form>
        <div className="auth-switch">
          {mode === "login" ? (
            <>
              <span>New to SiteGuard? </span>
              <Link
                to={"/signup" + location.search}
                onClick={() => change("signup")}
              >
                Create an account
              </Link>
            </>
          ) : (
            <>
              <span>Already have an account? </span>
              <Link
                to={"/login" + location.search}
                onClick={() => change("login")}
              >
                Sign in
              </Link>
            </>
          )}
        </div>
        <small className="auth-footnote">
          Secure sign-in with Supabase. Measurement consent is separate from
          account access.
        </small>
      </div>
    </section>
  );
}
