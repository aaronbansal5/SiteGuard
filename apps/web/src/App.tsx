import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Link,
  useLocation,
  Navigate,
} from "react-router-dom";
import {
  Shield,
  LayoutDashboard,
  Users,
  Activity,
  History,
  ArrowUpRight,
  PanelLeft,
  LockKeyhole,
  Smartphone,
  Camera,
  Monitor,
} from "lucide-react";
import type { Identity } from "@siteguard/contracts";
import { api } from "./lib/api";
import { ErrorNotice, Loading } from "./components/ui";
const Landing = lazy(() =>
  import("./pages/Landing").then((module) => ({ default: module.Landing })),
);
const WorkerHome = lazy(() =>
  import("./pages/WorkerHome").then((module) => ({
    default: module.WorkerHome,
  })),
);
const CheckIn = lazy(() =>
  import("./pages/CheckIn").then((module) => ({ default: module.CheckIn })),
);
const Measurement = lazy(() =>
  import("./pages/Measurement").then((module) => ({
    default: module.Measurement,
  })),
);
const SessionSummary = lazy(() =>
  import("./pages/SessionSummary").then((module) => ({
    default: module.SessionSummary,
  })),
);
const HistoryPage = lazy(() =>
  import("./pages/History").then((module) => ({ default: module.HistoryPage })),
);
const MobileApp = lazy(() =>
  import("./pages/Mobile").then((module) => ({ default: module.MobileApp })),
);
const FallDetection = lazy(() =>
  import("./pages/FallDetection").then((module) => ({
    default: module.FallDetection,
  })),
);
const Supervisor = lazy(() =>
  import("./pages/Supervisor").then((module) => ({
    default: module.Supervisor,
  })),
);
type AuthConfig = {
  mode: "demo" | "oidc" | "supabase";
  loginAvailable: boolean;
  siteId: string;
};
type Account = { id: string; email: string; siteId: string };
const AuthContext = createContext<{
  identity: Identity | null;
  config: AuthConfig | null;
  account?: Account;
  login: (a: Identity) => Promise<void>;
  refreshIdentity: () => Promise<Identity | null>;
}>({
  identity: null,
  config: null,
  login: async () => {},
  refreshIdentity: async () => null,
});
export const useIdentity = () => useContext(AuthContext);
function Protected({
  children,
  role,
}: {
  children: ReactNode;
  role?: Identity["role"];
}) {
  const { identity, config } = useIdentity();
  const location = useLocation();
  if (!identity)
    return (
      <Navigate
        to={
          (config?.mode === "supabase" ? "/login" : "/") +
          "?next=" +
          encodeURIComponent(location.pathname)
        }
        replace
      />
    );
  if (role && identity.role !== role)
    return (
      <section className="card empty-state">
        <h1>Access restricted</h1>
        <p>
          This workspace is available to{" "}
          {role === "supervisor" ? "managers" : "workers"} only.
        </p>
        <Link
          className="button primary"
          to={identity.role === "worker" ? "/worker" : "/supervisor"}
        >
          Return to your workspace
        </Link>
      </section>
    );
  return children;
}
function Shell() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [account, setAccount] = useState<Account>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  const loginRevision = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const revision = loginRevision.current;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const settings = await api<AuthConfig>(
          "/auth/config",
          undefined,
          "GET",
          controller.signal,
        );
        const current = await api<{
          identity: Identity | null;
          account?: Account;
        }>("/auth/me", undefined, "GET", controller.signal);
        if (!controller.signal.aborted && revision === loginRevision.current) {
          setConfig(settings);
          setIdentity(current.identity);
          setAccount(current.account);
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [retry]);
  useEffect(() => {
    setMenu(false);
  }, [location.pathname]);
  useEffect(() => {
    const expired = () => {
      setIdentity(null);
      setAccount(undefined);
    };
    window.addEventListener("siteguard:unauthenticated", expired);
    return () =>
      window.removeEventListener("siteguard:unauthenticated", expired);
  }, []);
  const login = async (a: Identity) => {
    if (config?.mode !== "demo" || identity)
      throw new Error("Sign out before selecting another demo account.");
    loginRevision.current += 1;
    await api("/demo/login", a);
    setIdentity(a);
  };
  const refreshIdentity = async () => {
    loginRevision.current += 1;
    const current = await api<{ identity: Identity | null; account?: Account }>(
      "/auth/me",
    );
    setIdentity(current.identity);
    setAccount(current.account);
    return current.identity;
  };
  const logout = async () => {
    if (logoutBusy) return;
    setLogoutBusy(true);
    setError("");
    try {
      await api("/auth/logout", {});
      setIdentity(null);
      setAccount(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLogoutBusy(false);
    }
  };
  // Phone check-in layout: same identity and APIs, no workspace chrome.
  if (
    location.pathname === "/mobile" ||
    location.pathname.startsWith("/mobile/")
  )
    return (
      <AuthContext.Provider
        value={{ identity, login, config, account, refreshIdentity }}
      >
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <Suspense fallback={<Loading />}>
          <ErrorNotice message={error} />
          {loading ? (
            <Loading />
          ) : !config ? (
            <section className="card">
              <h1>Sign-in service unavailable</h1>
              <button
                className="button primary"
                onClick={() => setRetry((v) => v + 1)}
              >
                Retry sign-in check
              </button>
            </section>
          ) : (
            <Protected role="worker">
              <MobileApp />
            </Protected>
          )}
        </Suspense>
      </AuthContext.Provider>
    );
  return (
    <AuthContext.Provider
      value={{ identity, login, config, account, refreshIdentity }}
    >
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside
        id="workspace-navigation"
        className={`sidebar ${menu ? "open" : ""}`}
      >
        <Link to="/" className="brand">
          <span className="brand-mark">
            <Shield size={24} />
          </span>
          <span>
            SiteGuard<small>ADAPTIVEBREAK</small>
          </span>
        </Link>
        <div className="workspace-label">WORKSPACE</div>
        <nav>
          {!identity && (
            <NavLink to="/" end>
              <LayoutDashboard size={18} /> Sign in
            </NavLink>
          )}
          {identity?.role === "worker" && (
            <>
              <NavLink to="/worker">
                <Activity size={18} /> Worker portal
              </NavLink>
              <NavLink to="/history">
                <History size={18} /> Session history
              </NavLink>
              <NavLink to="/mobile">
                <Smartphone size={18} />
                Phone check-in
              </NavLink>
              <NavLink to="/check-in">
                <Monitor size={18} />
                Web check-in
              </NavLink>
            </>
          )}
          {identity?.role === "supervisor" && (
            <NavLink to="/supervisor">
              <Users size={18} /> Safety operations
            </NavLink>
          )}
          {identity && (
            <NavLink to="/fall-detection">
              <Camera size={18} /> Fall detection
            </NavLink>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="protected-card">
            <LockKeyhole size={18} />
            <strong>Breaks stay protected</strong>
            <p>
              Human needs come first.
              <br />
              Coverage adapts around them.
            </p>
          </div>
          <span className="sidebar-version">
            {config?.mode === "demo"
              ? "LOCAL DEMONSTRATION"
              : "ROLE-SCOPED WORKSPACE"}
          </span>
        </div>
      </aside>
      <div className="app-shell">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-menu"
              aria-label="Toggle navigation"
              aria-expanded={menu}
              aria-controls="workspace-navigation"
              onClick={() => setMenu(!menu)}
            >
              <PanelLeft size={20} />
            </button>
            <span className="site-indicator" />
            <span>
              {config?.siteId || "SiteGuard"}{" "}
              <span className="muted">
                / {config?.mode === "demo" ? "Demo site" : "Workspace"}
              </span>
            </span>
          </div>
          <div>
            {config?.mode === "demo" && (
              <span className="badge demo-badge">Fictional workforce</span>
            )}
            <span className="identity-chip" title={account?.email}>
              {identity?.role === "worker"
                ? "Worker"
                : identity?.role === "supervisor"
                  ? "Safety ops"
                  : "Guest"}
              {account && <span className="muted">{account.email}</span>}
              <span className="avatar small">
                {identity?.role === "supervisor"
                  ? "SO"
                  : identity?.role === "worker"
                    ? "W"
                    : "SG"}
              </span>
            </span>
            {identity && (
              <button
                className="button secondary"
                disabled={logoutBusy}
                onClick={() => void logout()}
              >
                {logoutBusy ? "Signing out…" : "Sign out"}
              </button>
            )}
          </div>
        </header>
        <main id="main">
          <ErrorNotice message={error} />
          {loading ? (
            <Loading />
          ) : !config ? (
            <section className="card">
              <h1>Sign-in service unavailable</h1>
              <p>Your account could not be checked.</p>
              <button
                className="button primary"
                onClick={() => setRetry((v) => v + 1)}
              >
                Retry sign-in check
              </button>
            </section>
          ) : (
            <Suspense fallback={<Loading />}>
              <Routes
                key={
                  identity?.role === "worker"
                    ? identity.workerId
                    : identity?.role || "guest"
                }
              >
                <Route
                  path="/"
                  element={
                    identity ? (
                      <Navigate
                        to={
                          identity.role === "worker" ? "/worker" : "/supervisor"
                        }
                        replace
                      />
                    ) : config.mode === "supabase" ? (
                      <Navigate
                        to={"/login" + location.search + location.hash}
                        replace
                      />
                    ) : (
                      <Landing />
                    )
                  }
                />
                <Route
                  path="/login"
                  element={
                    identity &&
                    !(
                      config.mode === "supabase" &&
                      (location.hash.includes("type=recovery") ||
                        new URLSearchParams(location.search).has("recovery"))
                    ) ? (
                      <Navigate
                        to={
                          identity.role === "worker" ? "/worker" : "/supervisor"
                        }
                        replace
                      />
                    ) : (
                      <Landing />
                    )
                  }
                />
                <Route
                  path="/signup"
                  element={
                    identity ? (
                      <Navigate
                        to={
                          identity.role === "worker" ? "/worker" : "/supervisor"
                        }
                        replace
                      />
                    ) : (
                      <Landing />
                    )
                  }
                />
                <Route
                  path="/fall-detection"
                  element={
                    <Protected>
                      <FallDetection />
                    </Protected>
                  }
                />
                <Route
                  path="/worker"
                  element={
                    <Protected role="worker">
                      <WorkerHome />
                    </Protected>
                  }
                />
                <Route
                  path="/check-in"
                  element={
                    <Protected role="worker">
                      <CheckIn />
                    </Protected>
                  }
                />
                <Route
                  path="/web-check-in"
                  element={
                    <Protected role="worker">
                      <CheckIn />
                    </Protected>
                  }
                />
                <Route
                  path="/sessions/:id/measure"
                  element={
                    <Protected role="worker">
                      <Measurement />
                    </Protected>
                  }
                />
                <Route
                  path="/sessions/:id"
                  element={
                    <Protected>
                      <SessionSummary />
                    </Protected>
                  }
                />
                <Route
                  path="/history"
                  element={
                    <Protected role="worker">
                      <HistoryPage />
                    </Protected>
                  }
                />
                <Route
                  path="/supervisor"
                  element={
                    <Protected role="supervisor">
                      <Supervisor />
                    </Protected>
                  }
                />
                <Route
                  path="*"
                  element={
                    <div className="card">
                      <h1>Page not found</h1>
                      <Link to="/">Return to workspace</Link>
                    </div>
                  }
                />
              </Routes>
            </Suspense>
          )}
        </main>
        <footer className="app-footer">
          <span>
            <Shield size={12} /> SiteGuard AdaptiveBreak
          </span>
          <span>Recovery visibility. Human decisions.</span>
          <a href="/api/health" target="_blank" rel="noreferrer">
            System status <ArrowUpRight size={12} />
          </a>
        </footer>
      </div>
    </AuthContext.Provider>
  );
}
export default function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
