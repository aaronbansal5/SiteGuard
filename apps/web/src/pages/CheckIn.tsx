import { useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { ShieldCheck, ArrowRight, LockKeyhole } from "lucide-react";
import { useIdentity } from "../App";
import { ChooseWorker } from "./WorkerHome";
import { api, useResource, useAction } from "../lib/api";
import type { Session } from "@siteguard/contracts";
import { PageHeading, ErrorNotice, HelpActions } from "../components/ui";
export function CheckIn() {
  const { identity } = useIdentity(),
    [search] = useSearchParams(),
    navigate = useNavigate(),
    a = useAction();
  const [consent, setConsent] = useState(false),
    [share, setShare] = useState(false),
    [source, setSource] = useState<"mock" | "presage">("mock"),
    [workload, setWorkload] = useState("heavy"),
    [temp, setTemp] = useState("26");
  const health = useResource<{
    measurementSources: { mock: boolean; presage: boolean };
  }>("/health");
  if (identity?.role !== "worker") return <ChooseWorker />;
  return (
    <>
      <PageHeading
        eyebrow="VOLUNTARY CHECK-IN / 01"
        title="A check-in on your terms."
        description="Choose what to record. Your protected break remains yours."
      />
      <div className="consent-layout">
        <section className="card">
          <div className="card-header">
            <span className="portal-icon">
              <ShieldCheck size={24} />
            </span>
            <div>
              <h2>Before you begin</h2>
              <p>Understand what this check-in collects.</p>
            </div>
          </div>
          <div className="consent-point">
            <span>01</span>
            <div>
              <h3>Only normalized observations</h3>
              <p>
                We record timestamped pulse, breathing rate, source, and
                quality. SiteGuard does not store camera images or video.
              </p>
            </div>
          </div>
          <div className="consent-point">
            <span>02</span>
            <div>
              <h3>No identification, no clearance</h3>
              <p>
                No facial identification. Measurements cannot establish recovery
                or whether you are fit to return to work.
              </p>
            </div>
          </div>
          <div className="consent-point">
            <span>03</span>
            <div>
              <h3>Your history is private by default</h3>
              <p>
                Your supervisor sees break times and requests. Sharing this
                session's physiological summary is optional.
              </p>
            </div>
          </div>
          <div className="notice demo">
            Synthetic mode uses no camera. Before real use, verify the Presage
            bridge's processing and telemetry privacy separately.
          </div>
        </section>
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            if (!consent || a.busy) return;
            void a.run(async () => {
              const result = await api<{ session: Session }>("/sessions", {
                breakId: search.get("breakId"),
                source,
                consentVersion: "v1",
                shareWithSupervisor: share,
                context: {
                  workload: workload || null,
                  temperatureC: temp === "" ? null : Number(temp),
                },
              });
              navigate(`/sessions/${result.session.id}/measure`);
            });
          }}
        >
          <h2>Check-in preferences</h2>
          <label>
            Measurement source
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as typeof source)}
            >
              <option value="mock">Synthetic demo · no camera</option>
              <option
                value="presage"
                disabled={!health.data?.measurementSources.presage}
              >
                Presage · local camera bridge
                {!health.data?.measurementSources.presage
                  ? " (not configured)"
                  : ""}
              </option>
            </select>
          </label>
          <div className="form-grid">
            <label>
              Recent workload
              <select
                value={workload}
                onChange={(e) => setWorkload(e.target.value)}
              >
                <option value="">Not recorded</option>
                <option value="light">Light</option>
                <option value="moderate">Moderate</option>
                <option value="heavy">Heavy</option>
              </select>
            </label>
            <label>
              Temperature (°C)
              <input
                type="number"
                step="any"
                value={temp}
                onChange={(e) => setTemp(e.target.value)}
                placeholder="Optional"
              />
            </label>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={share}
              onChange={(e) => setShare(e.target.checked)}
            />
            <span>Share this session's summary with safety operations</span>
          </label>
          <label className="checkbox consent-check">
            <input
              type="checkbox"
              required
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              I understand the limitations and voluntarily agree to record these
              observations.
            </span>
          </label>
          <ErrorNotice
            message={
              a.error ||
              health.error ||
              (!search.get("breakId")
                ? "Select your active protected break from the worker portal before starting."
                : "")
            }
          />
          <button
            className="button primary full"
            disabled={!consent || a.busy || !search.get("breakId")}
          >
            {a.busy ? "Starting…" : "Begin check-in"}
            <ArrowRight size={17} />
          </button>
          <Link className="button ghost full" to="/worker">
            Skip measurement
          </Link>
          <p className="fine-print">
            <LockKeyhole size={12} /> Consent version v1 · You can stop at any
            time.
          </p>
        </form>
      </div>
      <section className="card">
        <h2>Need support instead?</h2>
        <p className="muted">Assistance is independent of check-in consent.</p>
        <HelpActions />
      </section>
    </>
  );
}
