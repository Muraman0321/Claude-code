import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import {
  computePilotThermalStats,
  type PilotThermalStats,
} from "../lib/stats/pilotAnalysis";
import type { FlightDetail, FlightSummary, ThermalLight } from "../types";
import { fmtDuration, fmtNum } from "../utils/format";

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      style={{
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "0.75rem 1rem",
        minWidth: "130px",
      }}
    >
      <div style={{ fontSize: "0.78rem", color: "#6b7280", marginBottom: "0.2rem" }}>
        {label}
      </div>
      <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: color ?? "#111827" }}>
        {value}
      </div>
    </div>
  );
}

// ─── ThermalEfficiencyTab ──────────────────────────────────────────────────────

function ThermalEfficiencyTab({
  thermals,
  stats,
  pilot,
}: {
  thermals: ThermalLight[];
  stats: PilotThermalStats;
  pilot: string;
}) {
  const scatterData = thermals.map((t) => ({
    x: +t.avg_climb_rate_ms.toFixed(2),
    y: Math.round(t.altitude_gain_m),
    duration: Math.round(t.duration_s),
    date: t.start_time.slice(0, 10),
  }));

  if (thermals.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "3rem", color: "#6b7280" }}>
        パイロットを選択してください（サーマルデータなし）
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          flexWrap: "wrap",
          marginBottom: "1.5rem",
        }}
      >
        <StatCard label="サーマル総数" value={stats.count.toString()} />
        <StatCard label="平均上昇率" value={`${fmtNum(stats.avgClimbRate)} m/s`} />
        <StatCard label="最高上昇率" value={`${fmtNum(stats.bestClimbRate)} m/s`} />
        <StatCard label="平均獲得高度" value={`${Math.round(stats.avgAltGain)} m`} />
        <StatCard label="平均時間" value={`${Math.round(stats.avgDurationS)} 秒`} />
        <StatCard
          label="サーマル総時間"
          value={fmtDuration(stats.totalTimeS)}
        />
        <StatCard
          label="総獲得高度"
          value={`${Math.round(stats.totalAltGain).toLocaleString()} m`}
        />
      </div>

      <h3 style={{ margin: "0 0 0.25rem", fontSize: "1rem" }}>
        上昇率 vs 獲得高度 — {pilot}
      </h3>
      <p style={{ margin: "0 0 1rem", color: "#6b7280", fontSize: "0.85rem" }}>
        各点 = 1サーマル。右上ほど効率的。黄破線 = 平均上昇率。
      </p>
      <ResponsiveContainer width="100%" height={380}>
        <ScatterChart margin={{ top: 10, right: 30, bottom: 40, left: 50 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="x"
            name="平均上昇率"
            type="number"
            unit=" m/s"
            label={{ value: "平均上昇率 (m/s)", position: "bottom", offset: 20 }}
          />
          <YAxis
            dataKey="y"
            name="獲得高度"
            label={{ value: "獲得高度 (m)", angle: -90, position: "insideLeft", offset: -10 }}
          />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ payload }) => {
              if (!payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div
                  style={{
                    background: "#1f2937",
                    color: "#f9fafb",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "6px",
                    fontSize: "0.85rem",
                    lineHeight: 1.6,
                  }}
                >
                  <div>上昇率: {d.x} m/s</div>
                  <div>獲得高度: {d.y} m</div>
                  <div>時間: {d.duration} 秒</div>
                  <div>日付: {d.date}</div>
                </div>
              );
            }}
          />
          {stats.avgClimbRate > 0 && (
            <ReferenceLine
              x={+stats.avgClimbRate.toFixed(2)}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              label={{ value: "平均", fill: "#f59e0b", fontSize: 11 }}
            />
          )}
          <Scatter data={scatterData} fill="#6366f1" opacity={0.7} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── FlightTrendTab ────────────────────────────────────────────────────────────

const TOW_COLORS = ["#1f6feb", "#1a7f37", "#cf222e", "#9a6700", "#6f42c1"];

function buildTowProfile(
  detail: FlightDetail,
): { t: number; alt: number }[] {
  const fixes = detail.fixes;
  if (fixes.length < 5) return [];

  // Find takeoff: first fix where ground_speed > 15 km/h
  let startIdx = 0;
  for (let i = 0; i < fixes.length; i++) {
    if ((fixes[i].ground_speed_kmh ?? 0) > 15) { startIdx = i; break; }
  }

  // Tow ends when altitude has risen ≥ 50 m from takeoff AND climb goes negative
  const takeoffAlt = fixes[startIdx].altitude_m;
  let endIdx = Math.min(startIdx + 60, fixes.length - 1);
  let peakAlt = takeoffAlt;
  for (let i = startIdx; i < fixes.length; i++) {
    const alt = fixes[i].altitude_m;
    if (alt > peakAlt) peakAlt = alt;
    if (peakAlt - takeoffAlt >= 50 && (fixes[i].climb_rate_ms ?? 0) < 0) {
      endIdx = i;
      break;
    }
  }

  const t0 = new Date(fixes[startIdx].timestamp).getTime();
  return fixes.slice(startIdx, endIdx + 1).map((f) => ({
    t: Math.round((new Date(f.timestamp).getTime() - t0) / 1000),
    alt: Math.round(f.altitude_m - takeoffAlt),
  }));
}

function FlightTrendTab({
  pilot,
  flights,
  pilotThermals,
  allThermals,
  allFlights,
}: {
  pilot: string;
  flights: FlightSummary[];
  pilotThermals: ThermalLight[];
  allThermals: ThermalLight[];
  allFlights: FlightSummary[];
}) {
  const [towDetails, setTowDetails] = useState<FlightDetail[]>([]);
  const [towLoading, setTowLoading] = useState(false);

  // Load last 5 flights for tow profiles
  useEffect(() => {
    if (!pilot || flights.length === 0) { setTowDetails([]); return; }
    const last5 = [...flights]
      .sort((a, b) => b.flight_date.localeCompare(a.flight_date))
      .slice(0, 5);
    setTowLoading(true);
    Promise.all(last5.map((f) => api.getFlight(f.id)))
      .then(setTowDetails)
      .catch(console.error)
      .finally(() => setTowLoading(false));
  }, [pilot, flights]);

  const towProfiles = useMemo(
    () => towDetails.map((d) => ({ id: d.id, date: d.flight_date, points: buildTowProfile(d) })),
    [towDetails],
  );

  // Build merged dataset for LineChart (key = seconds)
  const maxT = towProfiles.reduce((m, p) => Math.max(m, ...p.points.map((pt) => pt.t)), 0);
  const towChartData: Record<string, number | string>[] = [];
  for (let t = 0; t <= maxT; t += 2) {
    const entry: Record<string, number | string> = { t };
    for (const prof of towProfiles) {
      const closest = prof.points.reduce(
        (best, pt) => (Math.abs(pt.t - t) < Math.abs(best.t - t) ? pt : best),
        prof.points[0] ?? { t: 0, alt: 0 },
      );
      if (closest && Math.abs(closest.t - t) <= 3) {
        entry[prof.date] = closest.alt;
      }
    }
    towChartData.push(entry);
  }

  // Soaring stats
  const pilotStats = computePilotThermalStats(pilotThermals);
  const allStats = computePilotThermalStats(allThermals);
  const pilotHours = allFlights
    .filter((f) => f.pilot === pilot)
    .reduce((s, f) => s + (f.duration_s ?? 0) / 3600, 0);
  const allHours = allFlights.reduce((s, f) => s + (f.duration_s ?? 0) / 3600, 0);

  const soaringRows: { label: string; pilot: string; all: string; better: boolean }[] = [
    {
      label: "サーマル数 / 飛行時間 (件/h)",
      pilot: pilotHours > 0 ? (pilotStats.count / pilotHours).toFixed(2) : "—",
      all: allHours > 0 ? (allStats.count / allHours).toFixed(2) : "—",
      better: pilotHours > 0 && allHours > 0 && pilotStats.count / pilotHours > allStats.count / allHours,
    },
    {
      label: "平均上昇率 (m/s)",
      pilot: fmtNum(pilotStats.avgClimbRate),
      all: fmtNum(allStats.avgClimbRate),
      better: pilotStats.avgClimbRate > allStats.avgClimbRate,
    },
    {
      label: "最高上昇率 (m/s)",
      pilot: fmtNum(pilotStats.bestClimbRate),
      all: fmtNum(allStats.bestClimbRate),
      better: pilotStats.bestClimbRate > allStats.bestClimbRate,
    },
    {
      label: "平均獲得高度 (m)",
      pilot: Math.round(pilotStats.avgAltGain).toString(),
      all: Math.round(allStats.avgAltGain).toString(),
      better: pilotStats.avgAltGain > allStats.avgAltGain,
    },
    {
      label: "平均サーマル時間 (秒)",
      pilot: Math.round(pilotStats.avgDurationS).toString(),
      all: Math.round(allStats.avgDurationS).toString(),
      better: false,
    },
  ];

  return (
    <div>
      {/* 曳航の特徴 */}
      <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem", borderBottom: "1px solid #e5e7eb", paddingBottom: "0.4rem" }}>
        曳航の特徴
      </h3>
      <p style={{ margin: "0 0 1rem", color: "#6b7280", fontSize: "0.85rem" }}>
        直近5フライトの曳航高度プロファイル（離陸からリリースまで、x軸: 経過秒数, y軸: 対地高度）
      </p>
      {towLoading ? (
        <div className="empty">読み込み中...</div>
      ) : towProfiles.length === 0 ? (
        <div className="empty">フライトデータがありません</div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={towChartData} margin={{ top: 10, right: 30, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="t" label={{ value: "経過時間 (秒)", position: "bottom", offset: 10 }} />
            <YAxis label={{ value: "対地高度 (m)", angle: -90, position: "insideLeft" }} />
            <Tooltip />
            <Legend />
            {towProfiles.map((prof, i) => (
              <Line
                key={prof.id}
                type="monotone"
                dataKey={prof.date}
                stroke={TOW_COLORS[i % TOW_COLORS.length]}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}

      {/* ソアリングの特徴 */}
      <h3 style={{ margin: "1.5rem 0 0.5rem", fontSize: "1rem", borderBottom: "1px solid #e5e7eb", paddingBottom: "0.4rem" }}>
        ソアリングの特徴
      </h3>
      <p style={{ margin: "0 0 1rem", color: "#6b7280", fontSize: "0.85rem" }}>
        {pilot} の全フライトのソアリング指標と全データ平均の比較
      </p>
      {pilotThermals.length === 0 ? (
        <div className="empty">サーマルデータがありません</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "380px" }}>
            <thead>
              <tr style={{ background: "#f3f4f6" }}>
                <th style={{ padding: "0.6rem 1rem", textAlign: "left", fontWeight: 600, borderBottom: "2px solid #e5e7eb" }}>指標</th>
                <th style={{ padding: "0.6rem 1rem", textAlign: "right", color: "#6366f1", fontWeight: 600, borderBottom: "2px solid #e5e7eb" }}>{pilot}</th>
                <th style={{ padding: "0.6rem 1rem", textAlign: "right", color: "#6b7280", fontWeight: 600, borderBottom: "2px solid #e5e7eb" }}>全データ平均</th>
              </tr>
            </thead>
            <tbody>
              {soaringRows.map((row, i) => (
                <tr key={row.label} style={{ background: i % 2 === 0 ? "white" : "#f9fafb" }}>
                  <td style={{ padding: "0.5rem 1rem", borderBottom: "1px solid #f3f4f6" }}>{row.label}</td>
                  <td style={{
                    padding: "0.5rem 1rem",
                    textAlign: "right",
                    borderBottom: "1px solid #f3f4f6",
                    fontWeight: row.better ? "bold" : "normal",
                    color: row.better ? "#16a34a" : "#374151",
                  }}>
                    {row.pilot} {row.better ? "▲" : ""}
                  </td>
                  <td style={{ padding: "0.5rem 1rem", textAlign: "right", borderBottom: "1px solid #f3f4f6", color: "#6b7280" }}>
                    {row.all}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── CompareTab ────────────────────────────────────────────────────────────────

function CompareTab({
  pilots,
  pilotA,
  pilotB,
  onChangePilotB,
  thermalsA,
  thermalsB,
  statsA,
  statsB,
  flightHoursA,
  flightHoursB,
}: {
  pilots: string[];
  pilotA: string;
  pilotB: string;
  onChangePilotB: (p: string) => void;
  thermalsA: ThermalLight[];
  thermalsB: ThermalLight[];
  statsA: PilotThermalStats;
  statsB: PilotThermalStats;
  flightHoursA: number;
  flightHoursB: number;
}) {
  const rateA = flightHoursA > 0 ? statsA.count / flightHoursA : 0;
  const rateB = flightHoursB > 0 ? statsB.count / flightHoursB : 0;
  const rows: Array<{
    label: string;
    a: string;
    b: string;
    better: "a" | "b" | "none";
  }> = [
    {
      label: "サーマル数 / 飛行時間 (件/h)",
      a: flightHoursA > 0 ? `${rateA.toFixed(2)} (${statsA.count}/${flightHoursA.toFixed(1)}h)` : "—",
      b: flightHoursB > 0 ? `${rateB.toFixed(2)} (${statsB.count}/${flightHoursB.toFixed(1)}h)` : "—",
      better: rateA > rateB ? "a" : rateB > rateA ? "b" : "none",
    },
    {
      label: "平均上昇率 (m/s)",
      a: fmtNum(statsA.avgClimbRate),
      b: fmtNum(statsB.avgClimbRate),
      better:
        statsA.avgClimbRate > statsB.avgClimbRate
          ? "a"
          : statsB.avgClimbRate > statsA.avgClimbRate
          ? "b"
          : "none",
    },
    {
      label: "最高上昇率 (m/s)",
      a: fmtNum(statsA.bestClimbRate),
      b: fmtNum(statsB.bestClimbRate),
      better:
        statsA.bestClimbRate > statsB.bestClimbRate
          ? "a"
          : statsB.bestClimbRate > statsA.bestClimbRate
          ? "b"
          : "none",
    },
    {
      label: "平均獲得高度 (m)",
      a: Math.round(statsA.avgAltGain).toString(),
      b: Math.round(statsB.avgAltGain).toString(),
      better:
        statsA.avgAltGain > statsB.avgAltGain
          ? "a"
          : statsB.avgAltGain > statsA.avgAltGain
          ? "b"
          : "none",
    },
    {
      label: "平均サーマル時間 (秒)",
      a: Math.round(statsA.avgDurationS).toString(),
      b: Math.round(statsB.avgDurationS).toString(),
      better: "none",
    },
    {
      label: "サーマル総時間",
      a: fmtDuration(statsA.totalTimeS),
      b: fmtDuration(statsB.totalTimeS),
      better: "none",
    },
  ];

  const scatterDataA = thermalsA.map((t) => ({
    x: +t.avg_climb_rate_ms.toFixed(2),
    y: Math.round(t.altitude_gain_m),
    duration: Math.round(t.duration_s),
    pilot: pilotA,
  }));
  const scatterDataB = thermalsB.map((t) => ({
    x: +t.avg_climb_rate_ms.toFixed(2),
    y: Math.round(t.altitude_gain_m),
    duration: Math.round(t.duration_s),
    pilot: pilotB,
  }));

  return (
    <div>
      <div
        style={{
          marginBottom: "1.5rem",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontWeight: 600 }}>比較対象：</span>
        <select
          value={pilotB}
          onChange={(e) => onChangePilotB(e.target.value)}
          style={{ padding: "0.3rem 0.6rem", borderRadius: "4px", border: "1px solid #d1d5db" }}
        >
          <option value="">-- パイロットを選択 --</option>
          {pilots
            .filter((p) => p !== pilotA)
            .map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
        </select>
      </div>

      {!pilotB ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "#6b7280" }}>
          比較対象パイロットを選択してください
        </div>
      ) : (
        <>
          <h3 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>サーマル統計比較</h3>
          <div style={{ overflowX: "auto", marginBottom: "2rem" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "400px" }}>
              <thead>
                <tr style={{ background: "#f3f4f6" }}>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "left", fontWeight: 600, borderBottom: "2px solid #e5e7eb" }}>
                    指標
                  </th>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "right", color: "#6366f1", fontWeight: 600, borderBottom: "2px solid #e5e7eb" }}>
                    {pilotA}
                  </th>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "right", color: "#f59e0b", fontWeight: 600, borderBottom: "2px solid #e5e7eb" }}>
                    {pilotB}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={row.label}
                    style={{ background: i % 2 === 0 ? "white" : "#f9fafb" }}
                  >
                    <td style={{ padding: "0.5rem 1rem", color: "#374151", borderBottom: "1px solid #f3f4f6" }}>
                      {row.label}
                    </td>
                    <td
                      style={{
                        padding: "0.5rem 1rem",
                        textAlign: "right",
                        fontWeight: row.better === "a" ? "bold" : "normal",
                        color: row.better === "a" ? "#16a34a" : "#374151",
                        borderBottom: "1px solid #f3f4f6",
                      }}
                    >
                      {row.a} {row.better === "a" ? "▲" : ""}
                    </td>
                    <td
                      style={{
                        padding: "0.5rem 1rem",
                        textAlign: "right",
                        fontWeight: row.better === "b" ? "bold" : "normal",
                        color: row.better === "b" ? "#16a34a" : "#374151",
                        borderBottom: "1px solid #f3f4f6",
                      }}
                    >
                      {row.b} {row.better === "b" ? "▲" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={{ margin: "0 0 0.25rem", fontSize: "1rem" }}>
            上昇率 vs 獲得高度（重ね合わせ）
          </h3>
          <p style={{ margin: "0 0 1rem", color: "#6b7280", fontSize: "0.85rem" }}>
            紫 = {pilotA}、黄 = {pilotB}
          </p>
          <ResponsiveContainer width="100%" height={380}>
            <ScatterChart margin={{ top: 10, right: 30, bottom: 40, left: 50 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="x"
                name="平均上昇率"
                type="number"
                unit=" m/s"
                label={{ value: "平均上昇率 (m/s)", position: "bottom", offset: 20 }}
              />
              <YAxis
                dataKey="y"
                name="獲得高度"
                label={{ value: "獲得高度 (m)", angle: -90, position: "insideLeft", offset: -10 }}
              />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ payload }) => {
                  if (!payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div
                      style={{
                        background: "#1f2937",
                        color: "#f9fafb",
                        padding: "0.5rem 0.75rem",
                        borderRadius: "6px",
                        fontSize: "0.85rem",
                        lineHeight: 1.6,
                      }}
                    >
                      <div>{d.pilot}</div>
                      <div>上昇率: {d.x} m/s</div>
                      <div>獲得高度: {d.y} m</div>
                      <div>時間: {d.duration} 秒</div>
                    </div>
                  );
                }}
              />
              <Legend />
              <Scatter name={pilotA} data={scatterDataA} fill="#6366f1" opacity={0.7} />
              <Scatter name={pilotB} data={scatterDataB} fill="#f59e0b" opacity={0.7} />
            </ScatterChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}

// ─── PilotAnalysis (main page) ────────────────────────────────────────────────

type Tab = "thermal" | "trend" | "compare";

const TAB_LABELS: Record<Tab, string> = {
  thermal: "🌀 サーマル旋回効率",
  trend: "📈 フライト傾向分析",
  compare: "👥 パイロット間比較",
};

export default function PilotAnalysis() {
  const [pilots, setPilots] = useState<string[]>([]);
  const [pilot, setPilot] = useState("");
  const [tab, setTab] = useState<Tab>("thermal");

  const [allThermals, setAllThermals] = useState<ThermalLight[]>([]);
  const [allFlights, setAllFlights] = useState<FlightSummary[]>([]);
  const [flights, setFlights] = useState<FlightSummary[]>([]);
  const [comparePilot, setComparePilot] = useState("");

  useEffect(() => {
    api.listPilots().then((p) => {
      setPilots(p);
      if (p.length > 0) setPilot(p[0]);
    });
    api.allThermals().then(setAllThermals);
    api.listFlights().then(setAllFlights);
  }, []);

  const flightHoursByPilot = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of allFlights) {
      m.set(f.pilot, (m.get(f.pilot) ?? 0) + (f.duration_s ?? 0) / 3600);
    }
    return m;
  }, [allFlights]);

  useEffect(() => {
    if (!pilot) return;
    api.listFlights({ pilot }).then(setFlights);
  }, [pilot]);

  const pilotThermals = useMemo(
    () => allThermals.filter((t) => t.pilot === pilot),
    [allThermals, pilot],
  );
  const compareThermals = useMemo(
    () => allThermals.filter((t) => t.pilot === comparePilot),
    [allThermals, comparePilot],
  );
  const pilotStats = useMemo(
    () => computePilotThermalStats(pilotThermals),
    [pilotThermals],
  );
  const compareStats = useMemo(
    () => computePilotThermalStats(compareThermals),
    [compareThermals],
  );

  return (
    <div style={{ padding: "1.5rem", maxWidth: "1100px" }}>
      <h1 style={{ margin: "0 0 1rem", fontSize: "1.5rem" }}>パイロット分析</h1>

      {/* Pilot selector */}
      <div
        style={{
          marginBottom: "1.25rem",
          display: "flex",
          gap: "0.75rem",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <label style={{ fontWeight: 600 }}>パイロット：</label>
        <select
          value={pilot}
          onChange={(e) => setPilot(e.target.value)}
          style={{ padding: "0.35rem 0.6rem", borderRadius: "4px", border: "1px solid #d1d5db", fontSize: "0.95rem" }}
        >
          {pilots.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <span style={{ color: "#6b7280", fontSize: "0.875rem" }}>
          {flights.length} フライト · サーマル {pilotThermals.length} 回
        </span>
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          gap: "0.25rem",
          marginBottom: "1.5rem",
          borderBottom: "2px solid #e5e7eb",
        }}
      >
        {(["thermal", "trend", "compare"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "0.5rem 1rem",
              border: "none",
              background: "none",
              cursor: "pointer",
              fontWeight: tab === t ? 700 : 400,
              borderBottom: tab === t ? "2px solid #6366f1" : "2px solid transparent",
              marginBottom: "-2px",
              color: tab === t ? "#6366f1" : "#374151",
              fontSize: "0.9rem",
              whiteSpace: "nowrap",
            }}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "thermal" && (
        <ThermalEfficiencyTab
          thermals={pilotThermals}
          stats={pilotStats}
          pilot={pilot}
        />
      )}
      {tab === "trend" && (
        <FlightTrendTab
          pilot={pilot}
          flights={flights}
          pilotThermals={pilotThermals}
          allThermals={allThermals}
          allFlights={allFlights}
        />
      )}
      {tab === "compare" && (
        <CompareTab
          pilots={pilots}
          pilotA={pilot}
          pilotB={comparePilot}
          onChangePilotB={setComparePilot}
          thermalsA={pilotThermals}
          thermalsB={compareThermals}
          statsA={pilotStats}
          statsB={compareStats}
          flightHoursA={flightHoursByPilot.get(pilot) ?? 0}
          flightHoursB={flightHoursByPilot.get(comparePilot) ?? 0}
        />
      )}
    </div>
  );
}
