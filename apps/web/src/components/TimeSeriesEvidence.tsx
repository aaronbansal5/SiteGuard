import { Database, Waves } from "lucide-react";
import type { TimeSeriesEvidence } from "@siteguard/contracts";
import { number, time } from "../lib/api";

export function TimeSeriesEvidencePanel({
  evidence,
}: {
  evidence: TimeSeriesEvidence;
}) {
  const tiger = evidence.storage.hypertable;
  return (
    <section className="card timeseries-evidence">
      <div className="card-header">
        <div>
          <h2>
            <Database size={20} /> Measurement evidence
          </h2>
          <p>Timestamped observation coverage, without a safety score.</p>
        </div>
        <span className={`badge ${tiger ? "source-presage" : ""}`}>
          {tiger ? "Tiger Data · TimescaleDB" : "Local demo storage"}
        </span>
      </div>
      <div className="evidence-totals">
        <EvidenceValue
          label="Observations received"
          value={String(evidence.totals.observations)}
        />
        <EvidenceValue
          label="Valid pulse coverage"
          value={`${evidence.totals.validPulseObservations} · ${number(evidence.totals.pulseCoveragePercent)}%`}
        />
        <EvidenceValue
          label="Valid breathing coverage"
          value={`${evidence.totals.validBreathingObservations} · ${number(evidence.totals.breathingCoveragePercent)}%`}
        />
        <EvidenceValue
          label="Time-series windows"
          value={`${evidence.buckets.length} × ${evidence.bucketSeconds}s`}
        />
      </div>
      <div className="evidence-buckets" aria-label="Ten-second time buckets">
        {evidence.buckets.map((bucket) => {
          const coverage = bucket.observations
            ? Math.max(
                bucket.validPulseObservations,
                bucket.validBreathingObservations,
              ) / bucket.observations
            : 0;
          return (
            <div className="evidence-bucket" key={bucket.startsAt}>
              <div className="evidence-bucket-label">
                <span>{time(bucket.startsAt)}</span>
                <strong>{bucket.observations} obs.</strong>
              </div>
              <div className="evidence-track" aria-hidden="true">
                <span style={{ width: `${Math.round(coverage * 100)}%` }} />
              </div>
              <small>
                <Waves size={12} /> {number(bucket.averagePulseBpm)} bpm ·{" "}
                {number(bucket.averageBreathingBrpm)} brpm
              </small>
            </div>
          );
        })}
      </div>
      <p className="fine-print evidence-method">
        {tiger
          ? `Grouped by TimescaleDB time_bucket on the vital_readings hypertable · TimescaleDB ${evidence.storage.timescaleVersion}`
          : "Grouped by the application for the credential-free SQLite demo; deployment uses the same response contract."}
      </p>
      {evidence.limitations.map((limitation) => (
        <p className="fine-print" key={limitation}>
          {limitation}
        </p>
      ))}
    </section>
  );
}

function EvidenceValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
