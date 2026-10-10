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
export function VitalChart({
  readings,
  metric,
  startedAt,
}: {
  readings: ReadingEnvelope[];
  metric: "pulse" | "breathing";
  startedAt: string;
}) {
  const key = metric === "pulse" ? "heartRateBpm" : "respiratoryRateBrpm",
    valid = readings.filter(
      (e) => e.reading.quality === "valid" && e.reading[key] !== null,
    ),
    latest = readings.at(-1)?.reading;
  const latestValue = latest?.quality === "valid" ? latest[key] : null;
  const observations = readings.map((e) => ({
    seconds: Math.round(
      (Date.parse(e.reading.timestamp) - Date.parse(startedAt)) / 1000,
    ),
    value: e.reading.quality === "valid" ? e.reading[key] : null,
  }));
  const data = observations.flatMap((observation, index) => {
    const previous = observations[index - 1];
    return previous && observation.seconds - previous.seconds > 2
      ? [{ seconds: previous.seconds + 1, value: null }, observation]
      : [observation];
  });
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
        aria-label={`${metric === "pulse" ? "Pulse" : "Breathing rate"} over time; ${valid.length} valid observations. Latest valid observation: ${number(latestValue ?? null)} ${metric === "pulse" ? "bpm" : "brpm"}. Gaps indicate missing or invalid observations.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ left: -20, right: 10, top: 12, bottom: 0 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="#e8eeec"
              strokeDasharray="4 4"
            />
            <XAxis
              dataKey="seconds"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "#7a8a86" }}
              tickFormatter={(v) => `${v}s`}
            />
            <YAxis
              domain={["auto", "auto"]}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "#7a8a86" }}
            />
            <Tooltip
              formatter={(value) => [
                value,
                metric === "pulse" ? "bpm" : "brpm",
              ]}
              labelFormatter={(v) => `${v} seconds`}
            />
            <Line
              dataKey="value"
              type="linear"
              stroke={metric === "pulse" ? "#207a68" : "#557eb4"}
              strokeWidth={2.5}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
        {!data.length && (
          <div className="chart-empty">Waiting for observations</div>
        )}
      </div>
      <footer>
        <span>{valid.length} valid observations</span>
        <span>Gaps indicate missing or invalid data</span>
      </footer>
    </section>
  );
}
