import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Polygon, TileLayer, Tooltip } from "react-leaflet";
import { api } from "../api/client";
import { RateHistogramChart } from "../components/Charts";
import type { AreaBlock, AreaStats, BlockStats, HistogramGroup } from "../types";
import { fmtNum } from "../utils/format";

type StatsView = "overall" | "season" | "day";

type Mode = "sectors" | "grid";

// 妻沼グライダー滑空場: 36°12'41" N 139°25'08" E
const MENUMA = { lat: 36.2114, lon: 139.4189 };

function heatColor(value: number | null, maxValue: number): string {
  if (value == null || maxValue <= 0) return "#e7eaee";
  const t = Math.max(0, Math.min(1, value / maxValue));
  // light yellow -> orange -> red
  const r = Math.round(255);
  const g = Math.round(255 - t * 200);
  const b = Math.round(150 - t * 150);
  return `rgb(${r},${g},${b})`;
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
  // grid cell: parse "cell_{dx}_{dy}" from id
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

function blockFillColor(block: AreaBlock, maxClimb: number, selected: boolean): string {
  if (block.thermal_count === 0) return "#cccccc";
  const t = block.avg_climb_rate_ms != null && maxClimb > 0
    ? Math.max(0, Math.min(1, block.avg_climb_rate_ms / maxClimb))
    : 0;
  const r = Math.round(255 - t * 100);
  const g = Math.round(200 - t * 150);
  const b = Math.round(100 - t * 80);
  return selected ? `rgba(${r},${g},${b},0.9)` : `rgba(${r},${g},${b},0.55)`;
}

export default function Area() {
  const [mode, setMode] = useState<Mode>("sectors");
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

  const selected = useMemo(() => data?.blocks.find((b) => b.id === selectedBlock) ?? null, [data, selectedBlock]);

  // Fetch detailed histograms when a block is selected.
  useEffect(() => {
    if (!data || !selected) {
      setBlockStats(null);
      setStatsError(null);
      return;
    }
    setLoadingStats(true);
    setStatsError(null);
    const params = blockStatsParams(data, selected, centerLat, centerLon, radiusKm, cellKm);
    if (!params) {
      setLoadingStats(false);
      return;
    }
    api.blockStats(params)
      .then((s) => {
        setBlockStats(s);
        setStatsView("overall");
      })
      .catch((e: unknown) => setStatsError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingStats(false));
  }, [data, selected, centerLat, centerLon, radiusKm, cellKm]);

  return (
    <div>
      <h1>エリア分析 (妻沼周辺)</h1>

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

      {data && (
        <>
          <div className="card">
            <h2>マップ — クリックでブロックを選択（色の濃さ = 平均上昇率）</h2>
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
                  <Tooltip permanent direction="top" offset={[0, -6]}>
                    中心
                  </Tooltip>
                </CircleMarker>
              </MapContainer>
            </div>
          </div>

          <div className="card">
            <h2>ブロック別サマリー</h2>
            <table>
              <thead>
                <tr>
                  <th>ブロック</th>
                  <th>サーマル数</th>
                  <th>平均上昇率</th>
                  <th>最大上昇率</th>
                  <th>平均獲得高度</th>
                </tr>
              </thead>
              <tbody>
                {data.blocks.map((b) => (
                  <tr
                    key={b.id}
                    onClick={() => setSelectedBlock(b.id)}
                    style={{
                      cursor: "pointer",
                      background: selectedBlock === b.id ? "#ddf4ff" : undefined,
                    }}
                  >
                    <td><strong>{b.label}</strong></td>
                    <td>{b.thermal_count}</td>
                    <td>{fmtNum(b.avg_climb_rate_ms, 2, "m/s")}</td>
                    <td>{fmtNum(b.max_climb_rate_ms, 2, "m/s")}</td>
                    <td>{fmtNum(b.avg_altitude_gain_m, 0, "m")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>時間帯ヒートマップ (現地時刻、セル色 = 平均上昇率)</h2>
            <p style={{ fontSize: "0.82rem", color: "#57606a", margin: "0 0 0.5rem" }}>
              空白セル = データなし。色が濃いほど強い上昇率。クリックしたブロックの詳細は下の表に表示。
            </p>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>ブロック</th>
                    {Array.from({ length: 24 }, (_, h) => (
                      <th key={h} style={{ minWidth: "32px", padding: "0.2rem", fontSize: "0.7rem" }}>
                        {h.toString().padStart(2, "0")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.blocks.map((b) => {
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
                        {Array.from({ length: 24 }, (_, h) => {
                          const cell = hourMap.get(h);
                          return (
                            <td
                              key={h}
                              title={cell ? `${cell.avg_climb_rate_ms.toFixed(2)} m/s (n=${cell.thermal_count})` : ""}
                              style={{
                                padding: "0.2rem",
                                textAlign: "center",
                                fontSize: "0.7rem",
                                background: heatColor(cell?.avg_climb_rate_ms ?? null, maxHourlyClimb || 1),
                                color: cell && cell.avg_climb_rate_ms > maxHourlyClimb * 0.6 ? "#fff" : "#1f2328",
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

          {selected && (
            <div className="card">
              <h2>選択: {selected.label}</h2>
              <div className="metric-grid">
                <div className="metric">
                  <div className="metric-label">サーマル数</div>
                  <div className="metric-value">{selected.thermal_count}</div>
                </div>
                <div className="metric">
                  <div className="metric-label">平均上昇率</div>
                  <div className="metric-value">{fmtNum(selected.avg_climb_rate_ms, 2, "m/s")}</div>
                </div>
                <div className="metric">
                  <div className="metric-label">最大上昇率</div>
                  <div className="metric-value">{fmtNum(selected.max_climb_rate_ms, 2, "m/s")}</div>
                </div>
                <div className="metric">
                  <div className="metric-label">平均獲得高度</div>
                  <div className="metric-value">{fmtNum(selected.avg_altitude_gain_m, 0, "m")}</div>
                </div>
              </div>

              {selected.by_hour.length > 0 ? (
                <table style={{ marginTop: "1rem" }}>
                  <thead>
                    <tr>
                      <th>時刻</th>
                      <th>サーマル数</th>
                      <th>平均上昇率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.by_hour.map((h) => (
                      <tr key={h.hour}>
                        <td>{h.hour.toString().padStart(2, "0")}:00台</td>
                        <td>{h.thermal_count}</td>
                        <td>{h.avg_climb_rate_ms.toFixed(2)} m/s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty">時間帯データなし</div>
              )}
            </div>
          )}

          {selected && (
            <div className="card">
              <h2>
                上昇率・下降率ヒストグラム — {selected.label}
              </h2>
              <p style={{ fontSize: "0.82rem", color: "#57606a", margin: "0 0 0.5rem" }}>
                GPSフィックス単位の上昇率/下降率分布。ブロック内に入った全フィックスを集計。
              </p>
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
                <button
                  onClick={() => setStatsView("overall")}
                  style={{ background: statsView === "overall" ? "#0969da" : "#f6f8fa", color: statsView === "overall" ? "#fff" : "#1f2328" }}
                >
                  全データ
                </button>
                <button
                  onClick={() => setStatsView("season")}
                  style={{ background: statsView === "season" ? "#0969da" : "#f6f8fa", color: statsView === "season" ? "#fff" : "#1f2328" }}
                >
                  季節別 ({blockStats?.by_season.length ?? 0})
                </button>
                <button
                  onClick={() => setStatsView("day")}
                  style={{ background: statsView === "day" ? "#0969da" : "#f6f8fa", color: statsView === "day" ? "#fff" : "#1f2328" }}
                >
                  日別 ({blockStats?.by_day.length ?? 0})
                </button>
              </div>

              {loadingStats && <div className="empty">統計を計算中...</div>}
              {statsError && <div className="empty" style={{ color: "#cf222e" }}>エラー: {statsError}</div>}
              {blockStats && !loadingStats && (
                <BlockHistogramView stats={blockStats} view={statsView} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function HistogramPair({ group }: { group: HistogramGroup }) {
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

function BlockHistogramView({ stats, view }: { stats: BlockStats; view: StatsView }) {
  if (view === "overall") {
    return <HistogramPair group={stats.overall} />;
  }
  if (view === "season") {
    if (stats.by_season.length === 0) return <div className="empty">季節データなし</div>;
    return (
      <>
        {stats.by_season.map((g) => (
          <HistogramPair key={g.key} group={g} />
        ))}
      </>
    );
  }
  // day view
  if (stats.by_day.length === 0) return <div className="empty">日別データなし</div>;
  return (
    <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
      {stats.by_day.map((g) => (
        <HistogramPair key={g.key} group={g} />
      ))}
    </div>
  );
}
