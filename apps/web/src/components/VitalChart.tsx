import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { ReadingEnvelope } from "@siteguard/contracts";
import { Activity, Wind } from "lucide-react";
import { number } from "../lib/api";
import { vitalSeries } from "../lib/vital-series";
export function VitalChart({
  readings,
  metric,
  startedAt,
}: {
  readings: ReadingEnvelope[];
  metric: "pulse" | "breathing";
  startedAt: string;
}) {
  const { data, validCount, latestValue, latestSeconds } = vitalSeries(
    readings,
    metric,
    startedAt,
  );
  return (
    <section className="card chart-card">
      <div className="chart-heading">
        <span className={`metric-icon ${metric}`}>
          {metric === "pulse" ? <Activity size={20} /> : <Wind size={20} />}
        </span>
        <div>
          <h3>{metric === "pulse" ? "Pulse" : "Breathing rate"}</h3>
          <p>
            {metric === "pulse"
              ? "Heart rate during rest"
              : "Breaths per minute during rest"}
          </p>
        </div>
        <div className="metric-value">
          {number(latestValue ?? null)}
          <small>{metric === "pulse" ? "bpm" : "brpm"}</small>
        </div>
      </div>
      <div
        className="chart"
        role="img"
        aria-label={`${metric === "pulse" ? "Pulse" : "Breathing rate"} over time; ${validCount} valid observations. Latest observation: ${number(latestValue)} ${metric === "pulse" ? "bpm" : "brpm"}. Gaps indicate missing or invalid observations.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ left: 0, right: 16, top: 12, bottom: 8 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="#e8eeec"
              strokeDasharray="4 4"
            />
            <XAxis
              dataKey="seconds"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 14, fill: "#4f635b" }}
              tickFormatter={(v) => `${Math.round(v)}s`}
            />
            <YAxis
              domain={([min, max]: readonly [number, number]) => {
                const span = Math.max(
                  metric === "pulse" ? 20 : 6,
                  (max - min) * 1.2,
                );
                const middle = (min + max) / 2;
                return [
                  Math.max(0, Math.floor(middle - span / 2)),
                  Math.ceil(middle + span / 2),
                ];
              }}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 14, fill: "#4f635b" }}
            />
            <Tooltip
              formatter={(value) => [
                value,
                metric === "pulse" ? "bpm" : "brpm",
              ]}
              labelFormatter={(v) => `${number(Number(v))} seconds`}
            />
            <Line
              dataKey="value"
              type="linear"
              stroke={metric === "pulse" ? "#207a68" : "#557eb4"}
              strokeWidth={2.5}
              dot={{
                r: 2,
                strokeWidth: 0,
                fill: metric === "pulse" ? "#207a68" : "#557eb4",
              }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
        {!validCount && (
          <div className="chart-empty">
            Waiting for usable {metric === "pulse" ? "pulse" : "breathing"}{" "}
            readings
          </div>
        )}
      </div>
      <footer>
        <span>
          {validCount} valid observations
          {latestSeconds !== null
            ? ` · Last sample at ${number(latestSeconds)}s`
            : ""}
        </span>
        <span>Gaps indicate missing or invalid data</span>
      </footer>
    </section>
  );
}
