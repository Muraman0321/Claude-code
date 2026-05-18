import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { api } from "../api/client";
import type { FlightSummary } from "../types";

type WeatherKey =
  | "weather_temp_c"
  | "weather_wind_speed_kmh"
  | "weather_cloud_cover_pct"
  | "weather_humidity_pct"
  | "weather_pressure_hpa"
  | "weather_wind_dir_deg";

type MetricKey =
  | "avg_climb_in_thermals_ms"
  | "best_glide_ratio"
  | "total_distance_km"
  | "thermal_count"
  | "max_altitude_m"
  | "avg_ground_speed_kmh"
  | "max_ground_speed_kmh"
  | "altitude_gain_m"
  | "duration_s";

interface AxisDef {
  key: WeatherKey | MetricKey;
  label: string;
  unit: string;
  bins?: number[]; // explicit bucket edges for the bar view (weather variables only)
}

const WEATHER_VARS: (AxisDef & { key: WeatherKey })[] = [
  { key: "weather_temp_c", label: "気温", unit: "°C", bins: [-5, 0, 5, 10, 15, 20, 25, 30, 35, 40] },
  { key: "weather_wind_speed_kmh", label: "地上風速", unit: "km/h", bins: [0, 3, 6, 10, 15, 20, 25, 30, 40] },
  { key: "weather_cloud_cover_pct", label: "雲量", unit: "%", bins: [0, 10, 25, 40, 55, 70, 85, 100] },
  { key: "weather_humidity_pct", label: "湿度", unit: "%", bins: [20, 35, 50, 60, 70, 80, 90, 100] },
  { key: "weather_pressure_hpa", label: "気圧", unit: "hPa", bins: [990, 1000, 1005, 1010, 1015, 1020, 1025, 1035] },
  { key: "weather_wind_dir_deg", label: "風向", unit: "°", bins: [0, 45, 90, 135, 180, 225, 270, 315, 360] },
];

const FLIGHT_METRICS: (AxisDef & { key: MetricKey })[] = [
  { key: "avg_climb_in_thermals_ms", label: "平均上昇率", unit: "m/s" },
  { key: "best_glide_ratio", label: "最大L/D", unit: "" },
  { key: "total_distance_km", label: "総距離", unit: "km" },
  { key: "thermal_count", label: "サーマル数", unit: "" },
  { key: "max_altitude_m", label: "最高高度", unit: "m" },
  { key: "avg_ground_speed_kmh", label: "平均速度", unit: "km/h" },
  { key: "max_ground_speed_kmh", label: "最高速度", unit: "km/h" },
  { key: "altitude_gain_m", label: "総獲得高度", unit: "m" },
  { key: "duration_s", label: "飛行時間", unit: "s" },
];

const COLORS = ["#1f6feb", "#1a7f37", "#cf222e", "#9a6700", "#6f42c1", "#1b9aaa", "#e07b00", "#d63384"];

// These fields store 0 to mean "not computed / no data", not a true zero.
// Treat them as missing rather than valid zeros in statistical calculations.
const ZERO_MEANS_MISSING = new Set([
  "avg_climb_in_thermals_ms", // 0 when no thermals detected
  "best_glide_ratio",         // 0 when no valid glide window found
  "max_altitude_m",           // 0 only when GPS completely failed
]);

function getNum(f: FlightSummary, key: string): number | null {
  const v = (f as unknown as Record<string, number | null | undefined>)[key];
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (ZERO_MEANS_MISSING.has(key) && v <= 0) return null;
  return v;
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den > 0 ? num / den : null;
}

function describeCorr(r: number | null): string {
  if (r == null) return "サンプル不足";
  const a = Math.abs(r);
  const strength =
    a < 0.1 ? "ほぼ無相関" :
    a < 0.3 ? "弱い相関" :
    a < 0.5 ? "中程度の相関" :
    a < 0.7 ? "強い相関" : "非常に強い相関";
  const sign = r > 0 ? "正" : "負";
  return `${strength} (${sign})`;
}

function binIndex(value: number, edges: number[]): number {
  for (let i = 0; i < edges.length - 1; i++) {
    if (value >= edges[i] && value < edges[i + 1]) return i;
  }
  return value >= edges[edges.length - 1] ? edges.length - 2 : 0;
}

function bucketLabel(edges: number[], i: number, unit: string): string {
  const lo = edges[i];
  const hi = edges[i + 1];
  return `${lo}–${hi}${unit ? " " + unit : ""}`;
}

export default function Weather() {
  const [flights, setFlights] = useState<FlightSummary[]>([]);
  const [xKey, setXKey] = useState<WeatherKey>("weather_cloud_cover_pct");
  const [yKey, setYKey] = useState<MetricKey>("avg_climb_in_thermals_ms");
  const [pilot, setPilot] = useState("");
  const [aircraft, setAircraft] = useState("");

  useEffect(() => {
    api.listFlights().then(setFlights).catch(console.error);
  }, []);

  const pilots = useMemo(() => Array.from(new Set(flights.map((f) => f.pilot))).sort(), [flights]);
  const aircrafts = useMemo(() => Array.from(new Set(flights.map((f) => f.aircraft))).sort(), [flights]);

  const filtered = useMemo(
    () => flights.filter((f) => (!pilot || f.pilot === pilot) && (!aircraft || f.aircraft === aircraft)),
    [flights, pilot, aircraft],
  );

  const xDef = WEATHER_VARS.find((v) => v.key === xKey)!;
  const yDef = FLIGHT_METRICS.find((v) => v.key === yKey)!;

  // Flights that have at least one weather variable fetched
  const weatherCount = useMemo(
    () => filtered.filter((f) => f.weather_source != null).length,
    [filtered],
  );

  const points = useMemo(() => {
    const out: { x: number; y: number; label: string }[] = [];
    for (const f of filtered) {
      const x = getNum(f, xKey);
      const y = getNum(f, yKey);
      if (x == null || y == null) continue;
      out.push({ x, y, label: `${f.pilot}/${f.aircraft} ${f.flight_date}` });
    }
    return out;
  }, [filtered, xKey, yKey]);

  const r = useMemo(() => pearson(points.map((p) => p.x), points.map((p) => p.y)), [points]);

  // Binned aggregation: bucket by X-variable, compute mean Y per bucket
  const binned = useMemo(() => {
    const edges = xDef.bins ?? [];
    if (edges.length < 2) return [];
    const buckets: { label: string; n: number; mean: number; values: number[] }[] = [];
    for (let i = 0; i < edges.length - 1; i++) {
      buckets.push({ label: bucketLabel(edges, i, xDef.unit), n: 0, mean: 0, values: [] });
    }
    for (const p of points) {
      const i = binIndex(p.x, edges);
      buckets[i].values.push(p.y);
    }
    for (const b of buckets) {
      b.n = b.values.length;
      b.mean = b.n > 0 ? Number((b.values.reduce((a, c) => a + c, 0) / b.n).toFixed(2)) : 0;
    }
    return buckets;
  }, [points, xDef]);

  // Correlation matrix: all weather x all metrics
  const corrMatrix = useMemo(() => {
    return WEATHER_VARS.map((w) => ({
      weather: w,
      cells: FLIGHT_METRICS.map((m) => {
        const xs: number[] = [];
        const ys: number[] = [];
        for (const f of filtered) {
          const x = getNum(f, w.key);
          const y = getNum(f, m.key);
          if (x == null || y == null) continue;
          xs.push(x);
          ys.push(y);
        }
        return { metric: m, r: pearson(xs, ys), n: xs.length };
      }),
    }));
  }, [filtered]);

  return (
    <div>
      <h1>気象分析</h1>
      <p style={{ color: "#57606a", marginTop: 0 }}>
        各フライトの気象データ（Open-Meteoから取得）とフライト性能の相関を分析します。
      </p>

      <div className="card">
        <h2>フィルター</h2>
        <div className="filters">
          <select value={pilot} onChange={(e) => setPilot(e.target.value)}>
            <option value="">選手 (すべて)</option>
            {pilots.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={aircraft} onChange={(e) => setAircraft(e.target.value)}>
            <option value="">機体 (すべて)</option>
            {aircrafts.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <span style={{ alignSelf: "center", fontSize: "0.88rem" }}>
            <span style={{ color: "#57606a" }}>
              該当: {filtered.length}件 / 全{flights.length}件
            </span>
            {" — "}
            <span style={{ color: weatherCount < filtered.length ? "#9a6700" : "#1a7f37", fontWeight: 500 }}>
              気象データあり: {weatherCount}件
            </span>
            {weatherCount < filtered.length && (
              <span style={{ color: "#9a6700", marginLeft: "0.4rem" }}>
                ({filtered.length - weatherCount}件は未取得 — ダッシュボードから「気象更新」で取得可)
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="card">
        <h2>気象 × 飛行データ — 散布図と相関</h2>
        <div className="filters" style={{ alignItems: "center" }}>
          <span>
            X軸 (気象):{" "}
            <select value={xKey} onChange={(e) => setXKey(e.target.value as WeatherKey)}>
              {WEATHER_VARS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </select>
          </span>
          <span>
            Y軸 (飛行):{" "}
            <select value={yKey} onChange={(e) => setYKey(e.target.value as MetricKey)}>
              {FLIGHT_METRICS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </select>
          </span>
          <span style={{ alignSelf: "center" }}>
            <strong>Pearson r = {r != null ? r.toFixed(3) : "—"}</strong>
            <span style={{ color: "#57606a", marginLeft: "0.4rem" }}>
              ({describeCorr(r)}, 有効 n={points.length})
            </span>
          </span>
        </div>

        {points.length === 0 ? (
          <div className="empty">該当データなし — 気象データ取得済みのフライトがありません</div>
        ) : (
          <>
            <div style={{ width: "100%", height: 320, marginTop: "1rem" }}>
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 12, right: 16, bottom: 32, left: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    name={xDef.label}
                    unit={xDef.unit}
                    label={{ value: `${xDef.label} (${xDef.unit})`, position: "insideBottom", offset: -8 }}
                    domain={["dataMin", "dataMax"]}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name={yDef.label}
                    unit={yDef.unit}
                    label={{ value: `${yDef.label}${yDef.unit ? ` (${yDef.unit})` : ""}`, angle: -90, position: "insideLeft" }}
                    domain={["dataMin", "dataMax"]}
                  />
                  <ZAxis range={[40, 40]} />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    formatter={(v: number, name: string) => [v, name]}
                    labelFormatter={(_, payload) => {
                      if (payload && payload[0] && payload[0].payload) {
                        return payload[0].payload.label;
                      }
                      return "";
                    }}
                  />
                  <Scatter name="フライト" data={points} fill="#1f6feb" fillOpacity={0.6} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>

            <h3 style={{ marginTop: "1rem", marginBottom: "0.3rem", fontSize: "0.95rem" }}>
              ビン集計 — {xDef.label}帯ごとの{yDef.label}平均
            </h3>
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={binned} margin={{ top: 12, right: 16, bottom: 32, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-15} textAnchor="end" interval={0} height={60} />
                  <YAxis label={{ value: `${yDef.label}${yDef.unit ? ` (${yDef.unit})` : ""}`, angle: -90, position: "insideLeft" }} />
                  <Tooltip
                    formatter={(v: number, name: string, props) => {
                      if (name === "mean") return [v, `${yDef.label}平均`];
                      return [v, name];
                    }}
                    labelFormatter={(label, payload) => {
                      const b = payload && payload[0] ? payload[0].payload : null;
                      return b ? `${label} (n=${b.n})` : label;
                    }}
                  />
                  <Bar dataKey="mean" name="平均">
                    {binned.map((b, i) => (
                      <Cell key={i} fill={b.n === 0 ? "#cccccc" : COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <table style={{ marginTop: "0.5rem" }}>
              <thead>
                <tr>
                  <th>{xDef.label}帯</th>
                  <th>フライト数</th>
                  <th>{yDef.label} 平均</th>
                </tr>
              </thead>
              <tbody>
                {binned.map((b, i) => (
                  <tr key={i}>
                    <td>{b.label}</td>
                    <td>{b.n}</td>
                    <td>{b.n > 0 ? `${b.mean.toFixed(2)}${yDef.unit ? " " + yDef.unit : ""}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="card">
        <h2>相関マトリクス — 全気象変数 × 全飛行指標</h2>
        <p style={{ fontSize: "0.82rem", color: "#57606a", margin: "0 0 0.5rem" }}>
          各セルはPearson相関係数 (-1〜+1)。緑=正、赤=負、濃いほど強い。サンプル数3未満は空欄。
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ minWidth: "640px" }}>
            <thead>
              <tr>
                <th style={{ background: "#f6f8fa", position: "sticky", left: 0 }}></th>
                {FLIGHT_METRICS.map((m) => (
                  <th key={m.key} style={{ fontSize: "0.78rem", whiteSpace: "nowrap" }}>{m.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {corrMatrix.map((row) => (
                <tr key={row.weather.key}>
                  <th style={{ background: "#f6f8fa", textAlign: "left", whiteSpace: "nowrap" }}>
                    {row.weather.label}
                  </th>
                  {row.cells.map((c) => (
                    <td
                      key={c.metric.key}
                      title={c.r != null ? `r=${c.r.toFixed(3)}, n=${c.n}` : `n=${c.n}`}
                      style={{
                        textAlign: "center",
                        background: corrColor(c.r),
                        color: c.r != null && Math.abs(c.r) > 0.5 ? "#fff" : "#1f2328",
                        fontSize: "0.82rem",
                        padding: "0.3rem 0.4rem",
                      }}
                    >
                      {c.r != null ? c.r.toFixed(2) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function corrColor(r: number | null): string {
  if (r == null) return "#f6f8fa";
  const a = Math.min(1, Math.abs(r));
  if (r > 0) {
    // green
    const g = Math.round(180 - a * 80);
    const rr = Math.round(255 - a * 160);
    const bb = Math.round(220 - a * 180);
    return `rgb(${rr}, ${g + 40}, ${bb})`;
  }
  // red
  const rr = Math.round(255 - a * 30);
  const g = Math.round(220 - a * 180);
  const bb = Math.round(220 - a * 180);
  return `rgb(${rr}, ${g}, ${bb})`;
}
