import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Fix } from "../types";

function toMinutes(fixes: Fix[]): { t: number; alt: number; climb: number; speed: number }[] {
  if (fixes.length === 0) return [];
  const t0 = new Date(fixes[0].timestamp).getTime();
  return fixes.map((f) => ({
    t: Number(((new Date(f.timestamp).getTime() - t0) / 60000).toFixed(2)),
    alt: f.altitude_m,
    climb: f.climb_rate_ms ?? 0,
    speed: f.ground_speed_kmh ?? 0,
  }));
}

export function AltitudeChart({ fixes }: { fixes: Fix[] }) {
  const data = toMinutes(fixes);
  return (
    <div className="chart-container">
      <ResponsiveContainer>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="t" label={{ value: "経過時間 (分)", position: "insideBottom", offset: -5 }} />
          <YAxis label={{ value: "高度 (m)", angle: -90, position: "insideLeft" }} />
          <Tooltip formatter={(v: number) => `${v.toFixed(0)} m`} />
          <Area type="monotone" dataKey="alt" stroke="#1f6feb" fill="#ddf4ff" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ClimbRateChart({ fixes }: { fixes: Fix[] }) {
  const data = toMinutes(fixes);
  return (
    <div className="chart-container">
      <ResponsiveContainer>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="t" label={{ value: "経過時間 (分)", position: "insideBottom", offset: -5 }} />
          <YAxis label={{ value: "上昇率 (m/s)", angle: -90, position: "insideLeft" }} />
          <Tooltip formatter={(v: number) => `${v.toFixed(2)} m/s`} />
          <Line type="monotone" dataKey="climb" stroke="#1a7f37" dot={false} strokeWidth={1.5} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SpeedChart({ fixes }: { fixes: Fix[] }) {
  const data = toMinutes(fixes);
  return (
    <div className="chart-container">
      <ResponsiveContainer>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="t" label={{ value: "経過時間 (分)", position: "insideBottom", offset: -5 }} />
          <YAxis label={{ value: "対地速度 (km/h)", angle: -90, position: "insideLeft" }} />
          <Tooltip formatter={(v: number) => `${v.toFixed(1)} km/h`} />
          <Line type="monotone" dataKey="speed" stroke="#9a6700" dot={false} strokeWidth={1.5} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ClimbHistogram({ fixes }: { fixes: Fix[] }) {
  const buckets = new Map<number, number>();
  for (const f of fixes) {
    const c = f.climb_rate_ms ?? 0;
    const b = Math.round(c * 2) / 2; // 0.5 m/s buckets
    buckets.set(b, (buckets.get(b) ?? 0) + 1);
  }
  const data = Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, count]) => ({ bucket: bucket.toFixed(1), count }));

  return (
    <div className="chart-container">
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="bucket" label={{ value: "上昇率 (m/s)", position: "insideBottom", offset: -5 }} />
          <YAxis label={{ value: "サンプル数", angle: -90, position: "insideLeft" }} />
          <Tooltip />
          <Bar dataKey="count" fill="#0969da" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface CompareDatum {
  label: string;
  [key: string]: number | string;
}

export function CompareBarChart({
  data,
  metrics,
}: {
  data: CompareDatum[];
  metrics: { key: string; label: string; color: string }[];
}) {
  return (
    <div className="chart-container">
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" />
          <YAxis />
          <Tooltip />
          <Legend />
          {metrics.map((m) => (
            <Bar key={m.key} dataKey={m.key} name={m.label} fill={m.color} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
