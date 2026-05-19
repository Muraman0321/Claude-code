import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Polygon, TileLayer, Tooltip } from "react-leaflet";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import { RateHistogramChart } from "../components/Charts";
import type { AreaBlock, AreaStats, BlockStats, HistogramBin, ThermalLight } from "../types";
import { fmtNum } from "../utils/format";

type StatsView = "overall" | "season" | "day";
type Mode = "sectors" | "grid";

const MENUMA = { lat: 36.2114, lon: 139.4189 };

// Desired row order for 3×3 grid heatmap
const BLOCK_ORDER = ["SW", "S", "SE", "W", "C", "E", "NW", "N", "NE"];

// Blue (weak) → Red (strong) color scale
function thermalColor(t: number, alpha = 0.7): string {
  const r = Math.round(255 * t);
  const g = 0;
  const b = Math.round(255 * (1 - t));
  return `rgba(${r},${g},${b},${alpha})`;
}

function blockFillColor(block: AreaBlock, maxClimb: number, selected: boolean): string {
  if (block.thermal_count === 0) return "#cccccc";
  const t = block.avg_climb_rate_ms != null && maxClimb > 0
    ? Math.max(0, Math.min(1, block.avg_climb_rate_ms / maxClimb))
    : 0;
  const r = Math.round(255 * t);
  const g = 0;
  const b = Math.round(255 * (1 - t));
  return selected ? `rgba(${r},${g},${b},0.9)` : `rgba(${r},${g},${b},0.55)`;
}

// Color scale for table cells
function metricCellStyle(value: number | null, maxValue: number): React.CSSProperties {
  if (value == null || maxValue <= 0) return {};
  const t = Math.max(0, Math.min(1, value / maxValue));
  const bg = thermalColor(t, 0.35);
  return { background: bg };
}

function blockStatsParams(
  area: AreaStats,
  block: AreaBlock,
  centerLat: number,
  centerLon: number,
  radiusKm: number,
  cellKm: number,
): Parameters<typeof import("../api/client").api.blockStats>[0] | null {
  if (area.kind === "sectors") {
    if (block.bearing_from == null || block.bearing_to == null) return null;
    return {
      shape: "sector",
      center_lat: centerLat,
      center_lon: centerLon,
      block_label: block.label,
      bearing_from: block.bearing_from,
      bearing_to: block.bearing_to,
      radius_km: radiusKm,
    };
  }
  const m = /^cell_(-?\d+)_(-?\d+)$/.exec(block.id);
  if (!m) return null;
  return {
    shape: "cell",
    center_lat: centerLat,
    center_lon: centerLon,
    block_label: block.label,
    dx: Number(m[1]),
    dy: Number(m[2]),
    cell_km: cellKm,
  };
}

// Build a climb-rate histogram from ThermalLight data
const CLIMB_BINS: { label: string; lo: number; hi: number | null }[] = [
  { label: "0.0-0.5", lo: 0, hi: 0.5 },
  { label: "0.5-1.0", lo: 0.5, hi: 1.0 },
  { label: "1.0-1.5", lo: 1.0, hi: 1.5 },
  { label: "1.5-2.0", lo: 1.5, hi: 2.0 },
  { label: "2.0-2.5", lo: 2.0, hi: 2.5 },
  { label: "2.5-3.0", lo: 2.5, hi: 3.0 },
  { label: "3.0+",   lo: 3.0, hi: null },
];

const SEASONS_MAP: { key: string; label: string; months: number[] }[] = [
  { key: "spring", label: "春 (3-5月)", months: [3, 4, 5] },
  { key: "summer", label: "夏 (6-8月)", months: [6, 7, 8] },
  { key: "autumn", label: "秋 (9-11月)", months: [9, 10, 11] },
  { key: "winter", label: "冬 (12-2月)", months: [12, 1, 2] },
];

function buildClimbHistogram(
  thermals: ThermalLight[],
  seasonKey: string,
  hourFilter: number | null,
): HistogramBin[] {
  const filtered = thermals.filter((t) => {
    if (hourFilter !== null && t.local_hour !== hourFilter) return false;
    if (seasonKey) {
      const month = new Date(t.start_time).getUTCMonth() + 1;
      const season = SEASONS_MAP.find((s) => s.months.includes(month));
      if (!season || season.key !== seasonKey) return false;
    }
    return true;
  });
  return CLIMB_BINS.map((bin) => ({
    label: bin.label,
    lo: bin.lo,
    hi: bin.hi,
    count: filtered.filter(
      (t) => t.avg_climb_rate_ms >= bin.lo && (bin.hi === null || t.avg_climb_rate_ms < bin.hi),
    ).length,
  }));
}

// Grid cell thermal heatmap data
interface HeatCell {
  lat: number;
  lon: number;
  count: number;
  avgGain: number;
  strength: number;
}

function buildThermalHeatmap(
  thermals: ThermalLight[],
  seasonKey: string,
  hourSlot: string,
): HeatCell[] {
  const filtered = thermals.filter((t) => {
    if (seasonKey) {
      const month = new Date(t.start_time).getUTCMonth() + 1;
      const season = SEASONS_MAP.find((s) => s.months.includes(month));
      if (!season || season.key !== seasonKey) return false;
    }
    if (hourSlot === "morning" && (t.local_hour < 6 || t.local_hour >= 10)) return false;
    if (hourSlot === "noon" && (t.local_hour < 10 || t.local_hour >= 14)) return false;
    if (hourSlot === "afternoon" && (t.local_hour < 14 || t.local_hour >= 18)) return false;
    return true;
  });

  const CELL_DEG = 0.02;
  const cells = new Map<string, ThermalLight[]>();
  for (const t of filtered) {
    const latKey = Math.floor(t.center_lat / CELL_DEG) * CELL_DEG;
    const lonKey = Math.floor(t.center_lon / CELL_DEG) * CELL_DEG;
    const key = `${latKey.toFixed(4)},${lonKey.toFixed(4)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(t);
  }

  const out: HeatCell[] = [];
  for (const [key, ts] of cells) {
    const [lat, lon] = key.split(",").map(Number);
    const avgGain = ts.reduce((s, t) => s + t.altitude_gain_m, 0) / ts.length;
    out.push({ lat: lat + CELL_DEG / 2, lon: lon + CELL_DEG / 2, count: ts.length, avgGain, strength: ts.length * avgGain });
  }
  return out;
}

// Sort blocks in desired order for heatmap rows
function sortedBlocksForHeatmap(blocks: AreaBlock[]): AreaBlock[] {
  return [...blocks].sort((a, b) => {
    const ai = BLOCK_ORDER.indexOf(a.label);
    const bi = BLOCK_ORDER.indexOf(b.label);
    if (ai === -1 && bi === -1) return a.label.localeCompare(b.label);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

// Hours shown in heatmap (06-18 only)
const HEATMAP_HOURS = Array.from({ length: 13 }, (_, i) => i + 6);

export default function Area() {
  const [mode, setMode] = useState<Mode>("grid");
  const [centerLat, setCenterLat] = useState(MENUMA.lat);
  const [centerLon, setCenterLon] = useState(MENUMA.lon);
  const [radiusKm, setRadiusKm] = useState(9);
  const [cellKm, setCellKm] = useState(6);
  const [nSectors, setNSectors] = useState(9);
  const [gridSize, setGridSize] = useState(3);
  const [data, setData] = useState<AreaStats | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [blockStats, setBlockStats] = useState<BlockStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsView, setStatsView] = useState<StatsView>("overall");
  const [statsError, setStatsError] = useState<string | null>(null);

  // All thermals (for heatmap + histogram)
  const [allThermals, setAllThermals] = useState<ThermalLight[]>([]);

  // Heatmap filters
  const [heatSeason, setHeatSeason] = useState("");
  const [heatHourSlot, setHeatHourSlot] = useState("");

  // Histogram filters
  const [histSeason, setHistSeason] = useState("");
  const [histHour, setHistHour] = useState<string>("");

  useEffect(() => {
    api.allThermals().then(setAllThermals).catch(console.error);
  }, []);

  async function reload() {
    setLoading(true);
    try {
      const res =
        mode === "sectors"
          ? await api.areaSectors({ center_lat: centerLat, center_lon: centerLon, radius_km: radiusKm, n_sectors: nSectors })
          : await api.areaGrid({ center_lat: centerLat, center_lon: centerLon, cell_km: cellKm, grid_size: gridSize });
      setData(res);
      setSelectedBlock(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, centerLat, centerLon, radiusKm, cellKm, nSectors, gridSize]);

  const maxClimb = useMemo(() => {
    if (!data) return 0;
    return Math.max(0, ...data.blocks.map((b) => b.avg_climb_rate_ms ?? 0));
  }, [data]);

  const maxHourlyClimb = useMemo(() => {
    if (!data) return 0;
    return Math.max(0, ...data.blocks.flatMap((b) => b.by_hour.map((h) => h.avg_climb_rate_ms)));
  }, [data]);

  const maxThermalCount = useMemo(() => {
    if (!data) return 0;
    return Math.max(1, ...data.blocks.map((b) => b.thermal_count));
  }, [data]);

  const maxAvgGain = useMemo(() => {
    if (!data) return 0;
    return Math.max(1, ...data.blocks.map((b) => b.avg_altitude_gain_m ?? 0));
  }, [data]);

  const selected = useMemo(() => data?.blocks.find((b) => b.id === selectedBlock) ?? null, [data, selectedBlock]);

  useEffect(() => {
    if (!data || !selected) {
      setBlockStats(null);
      setStatsError(null);
      return;
    }
    setLoadingStats(true);
    setStatsError(null);
    const params = blockStatsParams(data, selected, centerLat, centerLon, radiusKm, cellKm);
    if (!params) { setLoadingStats(false); return; }
    api.blockStats(params)
      .then((s) => { setBlockStats(s); setStatsView("overall"); })
      .catch((e: unknown) => setStatsError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingStats(false));
  }, [data, selected, centerLat, centerLon, radiusKm, cellKm]);

  const heatmapData = useMemo(
    () => buildThermalHeatmap(allThermals, heatSeason, heatHourSlot),
    [allThermals, heatSeason, heatHourSlot],
  );

  const maxHeatStrength = useMemo(
    () => Math.max(1, ...heatmapData.map((c) => c.strength)),
    [heatmapData],
  );

  const histData = useMemo(
    () => buildClimbHistogram(allThermals, histSeason, histHour !== "" ? Number(histHour) : null),
    [allThermals, histSeason, histHour],
  );

  const sortedBlocks = useMemo(() => (data ? sortedBlocksForHeatmap(data.blocks) : []), [data]);

  return (
    <div>
      <h1>サーマルエリア分析 (妻沼周辺)</h1>

      {/* 設定 */}
      <div className="card">
        <div className="filters" style={{ alignItems: "center" }}>
          <span>
            モード:{" "}
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="sectors">扇状セクター</option>
              <option value="grid">グリッド</option>
            </select>
          </span>
          {mode === "sectors" ? (
            <>
              <span>
                分割数:{" "}
                <select value={nSectors} onChange={(e) => setNSectors(Number(e.target.value))}>
                  {[4, 6, 8, 9, 12, 16, 24].map((n) => (
                    <option key={n} value={n}>{n}セクター</option>
                  ))}
                </select>
              </span>
              <span>
                半径(km):{" "}
                <input
                  type="number" step="0.5" value={radiusKm}
                  onChange={(e) => setRadiusKm(Number(e.target.value))}
                  style={{ width: "70px" }}
                />
              </span>
            </>
          ) : (
            <>
              <span>
                サイズ:{" "}
                <select value={gridSize} onChange={(e) => setGridSize(Number(e.target.value))}>
                  <option value={3}>3×3</option>
                  <option value={5}>5×5</option>
                  <option value={7}>7×7</option>
                </select>
              </span>
              <span>
                セル(km):{" "}
                <input
                  type="number" step="0.5" value={cellKm}
                  onChange={(e) => setCellKm(Number(e.target.value))}
                  style={{ width: "70px" }}
                />
              </span>
            </>
          )}
          <span>
            中心緯度:{" "}
            <input
              type="number" step="0.001" value={centerLat}
              onChange={(e) => setCenterLat(Number(e.target.value))}
              style={{ width: "100px" }}
            />
          </span>
          <span>
            中心経度:{" "}
            <input
              type="number" step="0.001" value={centerLon}
              onChange={(e) => setCenterLon(Number(e.target.value))}
              style={{ width: "100px" }}
            />
          </span>
          <button onClick={() => { setCenterLat(MENUMA.lat); setCenterLon(MENUMA.lon); }}>
            妻沼に戻す
          </button>
        </div>
      </div>

      {loading && <div className="empty">読み込み中...</div>}

      {/* サーマルマップ (新規) */}
      <div className="card">
        <h2>サーマルマップ</h2>
        <p style={{ fontSize: "0.82rem", color: "#57606a", margin: "0 0 0.75rem" }}>
          全データのサーマル位置を集計し、強さ（頻度 × 平均獲得高度）をヒートマップで表示。青 = 弱い / 赤 = 強い。
        </p>
        <div className="filters" style={{ marginBottom: "0.75rem" }}>
          <select value={heatSeason} onChange={(e) => setHeatSeason(e.target.value)}>
            <option value="">全季節</option>
            {SEASONS_MAP.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <select value={heatHourSlot} onChange={(e) => setHeatHourSlot(e.target.value)}>
            <option value="">全時間帯</option>
            <option value="morning">午前 (06-10時)</option>
            <option value="noon">昼前 (10-14時)</option>
            <option value="afternoon">午後 (14-18時)</option>
          </select>
          <span style={{ fontSize: "0.85rem", color: "#57606a" }}>
            {heatmapData.length} セル / サーマル {heatmapData.reduce((s, c) => s + c.count, 0)} 件
          </span>
        </div>
        <div className="map-container">
          <MapContainer center={[centerLat, centerLon]} zoom={11} style={{ height: "100%", width: "100%" }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {heatmapData.map((cell, i) => {
              const t = Math.max(0, Math.min(1, cell.strength / maxHeatStrength));
              const r = Math.round(255 * t);
              const b = Math.round(255 * (1 - t));
              const color = `rgb(${r},0,${b})`;
              const radius = Math.max(10, Math.min(40, 10 + cell.count * 3));
              return (
                <CircleMarker
                  key={i}
                  center={[cell.lat, cell.lon]}
                  radius={radius}
                  pathOptions={{ color, fillColor: color, fillOpacity: 0.5, weight: 0 }}
                >
                  <Tooltip>
                    サーマル {cell.count}件 / 平均獲得高度 {Math.round(cell.avgGain)}m
                  </Tooltip>
                </CircleMarker>
              );
            })}
          </MapContainer>
        </div>
      </div>

      {data && (
        <>
          {/* マップ */}
          <div className="card">
            <h2>マップ — クリックでブロックを選択（青=弱い / 赤=強い）</h2>
            <div className="map-container">
              <MapContainer center={[centerLat, centerLon]} zoom={11} style={{ height: "100%", width: "100%" }}>
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {data.blocks.map((b) => (
                  <Polygon
                    key={b.id}
                    positions={b.geometry}
                    pathOptions={{
                      color: selectedBlock === b.id ? "#0d6efd" : "#444",
                      weight: selectedBlock === b.id ? 3 : 1,
                      fillColor: blockFillColor(b, maxClimb, selectedBlock === b.id),
                      fillOpacity: 0.6,
                    }}
                    eventHandlers={{ click: () => setSelectedBlock(b.id) }}
                  >
                    <Tooltip>
                      <strong>{b.label}</strong>
                      <br />
                      サーマル {b.thermal_count} 個
                      <br />
                      平均上昇率 {fmtNum(b.avg_climb_rate_ms, 2, "m/s")}
                    </Tooltip>
                  </Polygon>
                ))}
                <CircleMarker
                  center={[centerLat, centerLon]}
                  radius={6}
                  pathOptions={{ color: "#0d6efd", fillColor: "#0d6efd", fillOpacity: 1 }}
                >
                  <Tooltip permanent direction="top" offset={[0, -6]}>中心</Tooltip>
                </CircleMarker>
              </MapContainer>
            </div>
          </div>

          {/* ブロック別サマリー */}
          <div className="card">
            <h2>ブロック別サマリー</h2>
            <table>
              <thead>
                <tr>
                  <th>ブロック</th>
                  <th>サーマル密度 (件/h)</th>
                  <th>平均上昇率</th>
                  <th>最大上昇率</th>
                  <th>平均獲得高度</th>
                </tr>
              </thead>
              <tbody>
                {data.blocks.map((b) => {
                  const density = b.total_thermal_time_s > 0
                    ? (b.thermal_count / (b.total_thermal_time_s / 3600))
                    : null;
                  const maxDensity = Math.max(1, ...data.blocks.map((bb) => {
                    return bb.total_thermal_time_s > 0 ? bb.thermal_count / (bb.total_thermal_time_s / 3600) : 0;
                  }));
                  return (
                    <tr
                      key={b.id}
                      onClick={() => setSelectedBlock(b.id)}
                      style={{ cursor: "pointer", background: selectedBlock === b.id ? "#ddf4ff" : undefined }}
                    >
                      <td><strong>{b.label}</strong></td>
                      <td style={metricCellStyle(density, maxDensity)}>
                        {density != null ? density.toFixed(1) : "—"}
                      </td>
                      <td style={metricCellStyle(b.avg_climb_rate_ms, maxClimb)}>
                        {fmtNum(b.avg_climb_rate_ms, 2, "m/s")}
                      </td>
                      <td style={metricCellStyle(b.max_climb_rate_ms, maxClimb)}>
                        {fmtNum(b.max_climb_rate_ms, 2, "m/s")}
                      </td>
                      <td style={metricCellStyle(b.avg_altitude_gain_m, maxAvgGain)}>
                        {fmtNum(b.avg_altitude_gain_m, 0, "m")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 時間帯ヒートマップ (06-18のみ、SW,S,SE,W,C,E,NW,N,NE順) */}
          <div className="card">
            <h2>時間帯ヒートマップ (現地時刻、セル色 = 平均上昇率)</h2>
            <p style={{ fontSize: "0.82rem", color: "#57606a", margin: "0 0 0.5rem" }}>
              空白セル = データなし。青が弱く赤が強い。6〜18時のみ表示。
            </p>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>ブロック</th>
                    {HEATMAP_HOURS.map((h) => (
                      <th key={h} style={{ minWidth: "32px", padding: "0.2rem", fontSize: "0.7rem" }}>
                        {h.toString().padStart(2, "0")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedBlocks.map((b) => {
                    const hourMap = new Map(b.by_hour.map((h) => [h.hour, h]));
                    return (
                      <tr key={b.id}>
                        <td
                          onClick={() => setSelectedBlock(b.id)}
                          style={{
                            cursor: "pointer",
                            fontWeight: selectedBlock === b.id ? "bold" : "normal",
                            background: selectedBlock === b.id ? "#ddf4ff" : undefined,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {b.label}
                        </td>
                        {HEATMAP_HOURS.map((h) => {
                          const cell = hourMap.get(h);
                          const t = cell && maxHourlyClimb > 0
                            ? Math.max(0, Math.min(1, cell.avg_climb_rate_ms / maxHourlyClimb))
                            : 0;
                          const r = Math.round(255 * t);
                          const bl = Math.round(255 * (1 - t));
                          const bg = cell ? `rgb(${r},0,${bl})` : undefined;
                          return (
                            <td
                              key={h}
                              title={cell ? `${cell.avg_climb_rate_ms.toFixed(2)} m/s (n=${cell.thermal_count})` : ""}
                              style={{
                                padding: "0.2rem",
                                textAlign: "center",
                                fontSize: "0.7rem",
                                background: bg,
                                color: cell && t > 0.5 ? "#fff" : "#1f2328",
                              }}
                            >
                              {cell ? cell.avg_climb_rate_ms.toFixed(1) : ""}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 全エリア 上昇率ヒストグラム */}
          <div className="card">
            <h2>全エリア 上昇率ヒストグラム</h2>
            <p style={{ fontSize: "0.82rem", color: "#57606a", margin: "0 0 0.75rem" }}>
              全サーマルの平均上昇率分布。季節別・時間帯別フィルター適用可能。
            </p>
            <div className="filters" style={{ marginBottom: "0.75rem" }}>
              <select value={histSeason} onChange={(e) => setHistSeason(e.target.value)}>
                <option value="">全季節</option>
                {SEASONS_MAP.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <select value={histHour} onChange={(e) => setHistHour(e.target.value)}>
                <option value="">全時間帯</option>
                {HEATMAP_HOURS.map((h) => (
                  <option key={h} value={h}>{h.toString().padStart(2, "0")}時台</option>
                ))}
              </select>
              <span style={{ fontSize: "0.85rem", color: "#57606a" }}>
                {histData.reduce((s, b) => s + b.count, 0)} サーマル
              </span>
            </div>
            {histData.every((b) => b.count === 0) ? (
              <div className="empty">該当するサーマルデータがありません</div>
            ) : (
              <RateHistogramChart bins={histData} color="#1a7f37" />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function HistogramPair({ group }: { group: import("../types").HistogramGroup }) {
  return (
    <div style={{ border: "1px solid #d0d7de", borderRadius: "6px", padding: "0.5rem", background: "#fff", marginBottom: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.4rem" }}>
        <strong>{group.label}</strong>
        <span style={{ color: "#57606a", fontSize: "0.82rem" }}>
          フライト {group.flight_count}件 / フィックス {group.fix_count.toLocaleString()}個
          {group.climb_mean_ms != null && <> / 平均上昇 {group.climb_mean_ms.toFixed(2)} m/s</>}
          {group.sink_mean_ms != null && <> / 平均下降 -{group.sink_mean_ms.toFixed(2)} m/s</>}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
        <div>
          <div style={{ fontSize: "0.78rem", color: "#1a7f37", marginBottom: "0.2rem" }}>上昇率分布</div>
          <RateHistogramChart bins={group.climb_hist} color="#1a7f37" />
        </div>
        <div>
          <div style={{ fontSize: "0.78rem", color: "#cf222e", marginBottom: "0.2rem" }}>下降率分布 (絶対値)</div>
          <RateHistogramChart bins={group.sink_hist} color="#cf222e" />
        </div>
      </div>
    </div>
  );
}

// Keep HistogramPair and BlockHistogramView for potential future use
export { HistogramPair };
