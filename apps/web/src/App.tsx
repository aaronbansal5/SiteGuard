import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Link,
  useLocation,
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
} from "lucide-react";
import type { Identity } from "@siteguard/contracts";
import { api } from "./lib/api";
import { Loading } from "./components/ui";
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
const Supervisor = lazy(() =>
  import("./pages/Supervisor").then((module) => ({
    default: module.Supervisor,
  })),
);
const AuthContext = createContext<{
  identity: Identity | null;
  login: (a: Identity) => Promise<void>;
}>({ identity: null, login: async () => {} });
export const useIdentity = () => useContext(AuthContext);
function Shell() {
  const [identity, setIdentity] = useState<Identity | null>(null),
    [menu, setMenu] = useState(false);
  const location = useLocation();
  const loginRevision = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const revision = loginRevision.current;
    void api<Identity>("/demo/me", undefined, "GET", controller.signal)
      .then((value) => {
        if (!controller.signal.aborted && revision === loginRevision.current)
          setIdentity(value);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    setMenu(false);
  }, [location.pathname]);
  const login = async (a: Identity) => {
    loginRevision.current += 1;
    await api("/demo/login", a);
    setIdentity(a);
  };
  // Phone check-in layout: same identity and APIs, no workspace chrome.
  if (
    location.pathname === "/mobile" ||
    location.pathname.startsWith("/mobile/")
  )
    return (
      <AuthContext.Provider value={{ identity, login }}>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <Suspense fallback={<Loading />}>
          <MobileApp />
        </Suspense>
      </AuthContext.Provider>
    );
  return (
    <AuthContext.Provider value={{ identity, login }}>
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
          <NavLink to="/" end>
            <LayoutDashboard size={18} />
            Overview
          </NavLink>
          <NavLink to="/worker">
            <Activity size={18} />
            Worker portal
          </NavLink>
          <NavLink to="/history">
            <History size={18} />
            Session history
          </NavLink>
          <NavLink to="/supervisor">
            <Users size={18} />
            Safety operations
          </NavLink>
          <NavLink to="/mobile">
            <Smartphone size={18} />
            Phone check-in
          </NavLink>
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
          <span className="sidebar-version">HACKATHON DEMONSTRATION · V1</span>
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
              North Yard <span className="muted">/ Demo site</span>
            </span>
          </div>
          <div>
            <span className="badge demo-badge">Fictional workforce</span>
            <Link className="identity-chip" to="/">
              {identity?.role === "worker"
                ? "Worker"
                : identity?.role === "supervisor"
                  ? "Safety ops"
                  : "Demo"}
              <span className="avatar small">
                {identity?.role === "supervisor"
                  ? "SO"
                  : identity?.role === "worker"
                    ? "W"
                    : "SG"}
              </span>
            </Link>
          </div>
        </header>
        <main id="main">
          <Suspense fallback={<Loading />}>
            <Routes
              key={
                identity?.role === "worker"
                  ? identity.workerId
                  : identity?.role || "guest"
              }
            >
              <Route path="/" element={<Landing />} />
              <Route path="/worker" element={<WorkerHome />} />
              <Route path="/check-in" element={<CheckIn />} />
              <Route path="/sessions/:id/measure" element={<Measurement />} />
              <Route path="/sessions/:id" element={<SessionSummary />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/supervisor" element={<Supervisor />} />
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
