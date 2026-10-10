import { Activity, Camera, Database, Sparkles } from "lucide-react";
import { useResource } from "../lib/api";

interface IntegrationStatus {
  database: {
    kind: string;
    timescaleVersion: string | null;
    hypertable: boolean;
  };
  insights: {
    mode: "configured" | "deterministic";
    model: string | null;
    lastOrigin: "gemini" | "deterministic" | null;
    lastAt: string | null;
    lastFallbackReason: string | null;
  };
  presage: { status: string; reason: string | null };
}

function Row(props: {
  icon: React.ReactNode;
  name: string;
  ok: boolean;
  value: string;
  detail?: string | null;
}) {
  return (
    <li className="integration-row">
      {props.icon}
      <span className="integration-name">{props.name}</span>
      <span className={`badge ${props.ok ? "real" : "amber"}`}>
        {props.value}
      </span>
      {props.detail && (
        <span className="integration-detail">{props.detail}</span>
      )}
    </li>
  );
}

/** Live status of Tiger Data, Gemini and the Presage bridge. Shows no secrets. */
export function IntegrationsPanel() {
  const { data, error } = useResource<IntegrationStatus>(
    "/integrations",
    10000,
  );
  return (
    <section className="card integrations-panel" aria-label="Integrations">
      <h2>
        <Activity size={16} /> Integrations
      </h2>
      {error && !data && <p className="integration-detail">{error}</p>}
      {data && (
        <ul>
          <Row
            icon={<Database size={15} />}
            name="Database"
            ok={data.database.kind === "postgres"}
            value={
              data.database.kind === "postgres"
                ? `Tiger Data / PostgreSQL${data.database.timescaleVersion ? ` · TimescaleDB ${data.database.timescaleVersion}` : ""}`
                : "Local SQLite"
            }
            detail={
              data.database.kind === "postgres"
                ? data.database.hypertable
                  ? "Readings stored in a hypertable"
                  : "Run npm run db:enable-timescale"
                : null
            }
          />
          <Row
            icon={<Sparkles size={15} />}
            name="Explanations"
            ok={data.insights.lastOrigin === "gemini"}
            value={
              data.insights.mode === "configured"
                ? `Gemini${data.insights.model ? ` · ${data.insights.model}` : ""}`
                : "Deterministic only"
            }
            detail={
              data.insights.lastOrigin
                ? data.insights.lastOrigin === "gemini"
                  ? "Last explanation: Gemini fact selection"
                  : `Last explanation: deterministic${data.insights.lastFallbackReason ? ` (${data.insights.lastFallbackReason.slice(0, 120)})` : ""}`
                : "No explanation requested yet"
            }
          />
          <Row
            icon={<Camera size={15} />}
            name="Presage camera"
            ok={data.presage.status === "ready"}
            value={
              {
                ready: "Bridge ready",
                unavailable: "Bridge unavailable",
                unreachable: "Bridge not running",
                not_configured: "Not configured",
                disabled_hosted: "Local app only",
              }[data.presage.status] ?? data.presage.status
            }
            detail={data.presage.reason}
          />
        </ul>
      )}
    </section>
  );
}
