import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
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
  computeAltitudeBudget,
  computePilotThermalStats,
  type AltitudeSegment,
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

// ─── AltitudeBudgetTab ────────────────────────────────────────────────────────

interface WaterfallEntry {
  name: string;
  base: number;
  value: number;
  type: "thermal" | "cruise";
  delta: number;
  durationS: number;
}

function AltitudeBudgetTab({
  flights,
  selectedFlightId,
  onSelectFlight,
  segments,
  waterfallData,
  loading,
}: {
  flights: FlightSummary[];
  selectedFlightId: number | null;
  onSelectFlight: (id: number) => void;
  segments: AltitudeSegment[];
  waterfallData: WaterfallEntry[];
  loading: boolean;
}) {
  const totalGained = segments
    .filter((s) => s.type === "thermal")
    .reduce((sum, s) => sum + s.deltaAlt, 0);
  const totalLost = segments
    .filter((s) => s.type === "cruise")
    .reduce((sum, s) => sum + Math.abs(s.deltaAlt), 0);
  const netChange = segments.reduce((sum, s) => sum + s.deltaAlt, 0);

  return (
    <div>
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <label style={{ fontWeight: 600 }}>フライト：</label>
        <select
          value={selectedFlightId ?? ""}
          onChange={(e) => onSelectFlight(Number(e.target.value))}
          style={{ padding: "0.3rem 0.6rem", borderRadius: "4px", border: "1px solid #d1d5db" }}
        >
          {flights.length === 0 && <option value="">（フライトなし）</option>}
          {flights.map((f) => (
            <option key={f.id} value={f.id}>
              {f.flight_date} · {Math.round((f.duration_s ?? 0) / 60)}分 · {f.aircraft}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "#6b7280" }}>
          読み込み中...
        </div>
      ) : waterfallData.length > 0 ? (
        <>
          <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
            <StatCard
              label="サーマル獲得"
              value={`+${Math.round(totalGained)} m`}
              color="#16a34a"
            />
            <StatCard
              label="クルーズ降下"
              value={`-${Math.round(totalLost)} m`}
              color="#dc2626"
            />
            <StatCard
              label="正味高度変化"
              value={`${netChange >= 0 ? "+" : ""}${Math.round(netChange)} m`}
              color={netChange >= 0 ? "#16a34a" : "#dc2626"}
            />
            <StatCard
              label="セグメント数"
              value={`S${segments.filter((s) => s.type === "thermal").length} / G${segments.filter((s) => s.type === "cruise").length}`}
            />
          </div>

          <h3 style={{ margin: "0 0 0.25rem", fontSize: "1rem" }}>高度バンク管理</h3>
          <p style={{ margin: "0 0 1rem", color: "#6b7280", fontSize: "0.85rem" }}>
            緑 = サーマル上昇（S）、赤 = クルーズ降下（G）。バーの位置と高さ = 実際の高度帯。
          </p>
          <ResponsiveContainer width="100%" height={400}>
            <BarChart
              data={waterfallData}
              margin={{ top: 10, right: 20, bottom: 60, left: 60 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10 }}
                angle={-45}
                textAnchor="end"
                interval={0}
              />
              <YAxis
                tickFormatter={(v) => `${v}m`}
                label={{ value: "高度 (m)", angle: -90, position: "insideLeft", offset: -15 }}
              />
              <Tooltip
                content={({ payload, label }) => {
                  if (!payload?.length) return null;
                  const d = payload[0]?.payload as WaterfallEntry;
                  if (!d) return null;
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
                      <div>
                        {label} ({d.type === "thermal" ? "サーマル" : "クルーズ"})
                      </div>
                      <div>
                        高度変化: {d.delta >= 0 ? "+" : ""}
                        {Math.round(d.delta)} m
                      </div>
                      <div>時間: {Math.round(d.durationS)} 秒</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="base" stackId="a" fill="transparent" isAnimationActive={false} />
              <Bar dataKey="value" stackId="a" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {waterfallData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.type === "thermal" ? "#22c55e" : "#ef4444"}
                    opacity={0.85}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </>
      ) : (
        <div style={{ textAlign: "center", padding: "3rem", color: "#6b7280" }}>
          フライトを選択してください
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
      better:
        rateA > rateB ? "a" : rateB > rateA ? "b" : "none",
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

type Tab = "thermal" | "altitude" | "compare";

const TAB_LABELS: Record<Tab, string> = {
  thermal: "🌀 サーマル旋回効率",
  altitude: "📊 高度バンク管理",
  compare: "👥 パイロット間比較",
};

export default function PilotAnalysis() {
  const [pilots, setPilots] = useState<string[]>([]);
  const [pilot, setPilot] = useState("");
  const [tab, setTab] = useState<Tab>("thermal");

  const [allThermals, setAllThermals] = useState<ThermalLight[]>([]);
  const [allFlights, setAllFlights] = useState<FlightSummary[]>([]);
  const [flights, setFlights] = useState<FlightSummary[]>([]);
  const [selectedFlightId, setSelectedFlightId] = useState<number | null>(null);
  const [flightDetail, setFlightDetail] = useState<FlightDetail | null>(null);
  const [comparePilot, setComparePilot] = useState("");

  const [flightLoading, setFlightLoading] = useState(false);

  // Load pilots and all thermals once
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

  // Load flights for selected pilot
  useEffect(() => {
    if (!pilot) return;
    api.listFlights({ pilot }).then((f) => {
      setFlights(f);
      setSelectedFlightId(f[0]?.id ?? null);
      setFlightDetail(null);
    });
  }, [pilot]);

  // Load fix data when flight is selected (for altitude budget)
  useEffect(() => {
    if (!selectedFlightId) {
      setFlightDetail(null);
      return;
    }
    setFlightLoading(true);
    api.getFlight(selectedFlightId).then((d) => {
      setFlightDetail(d);
      setFlightLoading(false);
    });
  }, [selectedFlightId]);

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

  const altitudeSegments = useMemo(
    () => (flightDetail ? computeAltitudeBudget(flightDetail.fixes) : []),
    [flightDetail],
  );

  const waterfallData: WaterfallEntry[] = useMemo(
    () =>
      altitudeSegments.map((seg) => ({
        name: seg.label,
        base: Math.min(seg.startAlt, seg.endAlt),
        value: Math.abs(seg.deltaAlt),
        type: seg.type,
        delta: seg.deltaAlt,
        durationS: seg.durationS,
      })),
    [altitudeSegments],
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
        {(["thermal", "altitude", "compare"] as Tab[]).map((t) => (
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
      {tab === "altitude" && (
        <AltitudeBudgetTab
          flights={flights}
          selectedFlightId={selectedFlightId}
          onSelectFlight={setSelectedFlightId}
          segments={altitudeSegments}
          waterfallData={waterfallData}
          loading={flightLoading}
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
