import { useEffect, useMemo, useState } from "react";
import { Circle, MapContainer, Polygon, Polyline, TileLayer, Tooltip } from "react-leaflet";
import { api } from "../api/client";
import { CompareBarChart } from "../components/Charts";
import type { FlightSummary, FlightTrack, ThermalLight } from "../types";
import { fmtDate, fmtDuration, fmtNum } from "../utils/format";

type SortKey =
  | "flight_date"
  | "pilot"
  | "aircraft"
  | "duration_s"
  | "total_distance_km"
  | "max_altitude_m"
  | "avg_climb_in_thermals_ms"
  | "max_ground_speed_kmh"
  | "best_glide_ratio"
  | "thermal_count";

interface ColumnDef {
  key: SortKey;
  label: string;
  render: (f: FlightSummary) => string | number;
  numeric: boolean;
}

const COLUMNS: ColumnDef[] = [
  { key: "flight_date", label: "日付", render: (f) => fmtDate(f.flight_date), numeric: false },
  { key: "pilot", label: "選手", render: (f) => f.pilot, numeric: false },
  { key: "aircraft", label: "機体", render: (f) => f.aircraft, numeric: false },
  { key: "duration_s", label: "時間", render: (f) => fmtDuration(f.duration_s), numeric: true },
  { key: "total_distance_km", label: "距離", render: (f) => fmtNum(f.total_distance_km, 1, "km"), numeric: true },
  { key: "max_altitude_m", label: "最高高度", render: (f) => fmtNum(f.max_altitude_m, 0, "m"), numeric: true },
  { key: "avg_climb_in_thermals_ms", label: "平均上昇率", render: (f) => fmtNum(f.avg_climb_in_thermals_ms, 2, "m/s"), numeric: true },
  { key: "max_ground_speed_kmh", label: "最高速度", render: (f) => fmtNum(f.max_ground_speed_kmh, 0, "km/h"), numeric: true },
  { key: "best_glide_ratio", label: "最大L/D", render: (f) => fmtNum(f.best_glide_ratio, 1), numeric: true },
  {
    key: "thermal_count",
    label: "サーマル密度(件/h)",
    render: (f) => {
      const h = (f.duration_s ?? 0) / 3600;
      return h > 0 ? fmtNum((f.thermal_count ?? 0) / h, 1, "件/h") : "—";
    },
    numeric: true,
  },
];

const COLORS = [
  "#1f6feb", "#1a7f37", "#cf222e", "#9a6700", "#6f42c1",
  "#1b9aaa", "#e07b00", "#d63384", "#198754", "#0d6efd",
];

const MAX_SELECTED = 100;

// Compute a geodesic rounded-rectangle polygon aligned along start→end.
// halfWidthM is the half-width; corner radius is 35% of that.
// Degrades gracefully to a rounded square when start ≈ end.
function roundedRectPolygon(
  sLat: number, sLon: number,
  eLat: number, eLon: number,
  halfWidthM: number,
  arcSteps = 4,
): [number, number][] {
  const R = 6_371_000;
  const cornerR = halfWidthM * 0.35;

  function offsetPt(lat: number, lon: number, brgDeg: number, dist: number): [number, number] {
    if (dist === 0) return [lat, lon];
    const d = dist / R;
    const φ = lat * Math.PI / 180;
    const λ = lon * Math.PI / 180;
    const θ = ((brgDeg % 360) + 360) % 360 * Math.PI / 180;
    const φ2 = Math.asin(Math.sin(φ) * Math.cos(d) + Math.cos(φ) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ), Math.cos(d) - Math.sin(φ) * Math.sin(φ2));
    return [φ2 * 180 / Math.PI, λ2 * 180 / Math.PI];
  }

  const φ1 = sLat * Math.PI / 180, φ2e = eLat * Math.PI / 180;
  const dλ = (eLon - sLon) * Math.PI / 180;
  const y = Math.sin(dλ) * Math.cos(φ2e);
  const x = Math.cos(φ1) * Math.sin(φ2e) - Math.sin(φ1) * Math.cos(φ2e) * Math.cos(dλ);
  const fwd = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  const back = (fwd + 180) % 360;

  // Four arc-center points (inner corners of the rounded rect)
  function arcCenter(lat: number, lon: number, axialBrg: number, lateralBrg: number): [number, number] {
    const tmp = offsetPt(lat, lon, axialBrg, cornerR);
    return offsetPt(tmp[0], tmp[1], lateralBrg, halfWidthM - cornerR);
  }
  const fc_r = arcCenter(eLat, eLon, back,   fwd + 90);
  const bc_r = arcCenter(sLat, sLon, fwd,    fwd + 90);
  const bc_l = arcCenter(sLat, sLon, fwd,    fwd - 90);
  const fc_l = arcCenter(eLat, eLon, back,   fwd - 90);

  const pts: [number, number][] = [];
  function addArc(ctr: [number, number], b0: number, b1: number) {
    for (let i = 0; i <= arcSteps; i++) {
      pts.push(offsetPt(ctr[0], ctr[1], b0 + (b1 - b0) * i / arcSteps, cornerR));
    }
  }
  // Clockwise perimeter: front-right → back-right → back-left → front-left
  addArc(fc_r, fwd,       fwd + 90);
  addArc(bc_r, fwd + 90,  fwd + 180);
  addArc(bc_l, fwd + 180, fwd + 270);
  addArc(fc_l, fwd + 270, fwd + 360);
  pts.push(pts[0]);
  return pts;
}

function minuteDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 1440;
  return d > 720 ? 1440 - d : d;
}

export default function Compare() {
  const [flights, setFlights] = useState<FlightSummary[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("flight_date");
  const [sortDesc, setSortDesc] = useState(true);
  const [filterPilot, setFilterPilot] = useState("");
  const [filterAircraft, setFilterAircraft] = useState("");
  const [showMap, setShowMap] = useState(false);
  const [tracks, setTracks] = useState<FlightTrack[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [thermals, setThermals] = useState<ThermalLight[]>([]);
  const [showThermals, setShowThermals] = useState(true);
  const [thermalMode, setThermalMode] = useState<"circle" | "rounded">("circle");
  const [filterMinute, setFilterMinute] = useState<number | null>(null);
  const [trackOpacity, setTrackOpacity] = useState(0.7);

  useEffect(() => {
    api.listFlights().then(setFlights).catch(console.error);
  }, []);

  const pilots = useMemo(() => Array.from(new Set(flights.map((f) => f.pilot))).sort(), [flights]);
  const aircraft = useMemo(() => Array.from(new Set(flights.map((f) => f.aircraft))).sort(), [flights]);

  const filtered = useMemo(() => {
    return flights.filter((f) =>
      (!filterPilot || f.pilot === filterPilot) &&
      (!filterAircraft || f.aircraft === filterAircraft)
    );
  }, [flights, filterPilot, filterAircraft]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortKey];
      const bv = (b as unknown as Record<string, unknown>)[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return sortDesc ? bv - av : av - bv;
      const sa = String(av);
      const sb = String(bv);
      return sortDesc ? sb.localeCompare(sa) : sa.localeCompare(sb);
    });
    return arr;
  }, [filtered, sortKey, sortDesc]);

  const selectedFlights = useMemo(() => sorted.filter((f) => selected.has(f.id)), [sorted, selected]);

  function clickHeader(key: SortKey) {
    if (sortKey === key) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_SELECTED) next.add(id);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelected(new Set(sorted.slice(0, MAX_SELECTED).map((f) => f.id)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function loadTracks() {
    if (selectedFlights.length === 0) {
      setTracks([]);
      return;
    }
    setLoadingTracks(true);
    try {
      const t = await api.tracks(selectedFlights.map((f) => f.id), 150);
      setTracks(t);
    } finally {
      setLoadingTracks(false);
    }
  }

  async function loadThermals() {
    if (selectedFlights.length === 0) {
      setThermals([]);
      return;
    }
    try {
      const t = await api.thermals(selectedFlights.map((f) => f.id));
      setThermals(t);
    } catch {
      setThermals([]);
    }
  }

  const flightIdKey = selectedFlights.map((f) => f.id).join(",");

  useEffect(() => {
    if (showMap) {
      loadTracks().catch(console.error);
      loadThermals().catch(console.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMap, flightIdKey]);

  const visibleThermals = useMemo(() => {
    if (!showThermals) return [];
    if (filterMinute == null) return thermals;
    return thermals.filter((t) => minuteDist(t.local_hour * 60 + t.local_minute, filterMinute) <= 20);
  }, [thermals, showThermals, filterMinute]);

  const mapCenter = useMemo<[number, number]>(() => {
    const pts = tracks.flatMap((t) => t.points);
    if (pts.length === 0) return [36.2114, 139.4189];
    const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    const lon = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
    return [lat, lon];
  }, [tracks]);

  return (
    <div>
      <h1>フライト比較 ({selected.size}/{MAX_SELECTED} 件選択中)</h1>

      <div className="card">
        <h2>フィルター</h2>
        <div className="filters">
          <select value={filterPilot} onChange={(e) => setFilterPilot(e.target.value)}>
            <option value="">選手 (すべて)</option>
            {pilots.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={filterAircraft} onChange={(e) => setFilterAircraft(e.target.value)}>
            <option value="">機体 (すべて)</option>
            {aircraft.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button className="ghost" onClick={selectAllFiltered}>
            絞り込み結果を全選択 ({Math.min(sorted.length, MAX_SELECTED)})
          </button>
          <button className="ghost" onClick={clearSelection}>選択解除</button>
        </div>
      </div>

      <div className="card">
        <h2>
          フライト一覧 ({filtered.length} 件、ソート: {COLUMNS.find((c) => c.key === sortKey)?.label} {sortDesc ? "↓" : "↑"})
        </h2>
        <div style={{ maxHeight: "500px", overflowY: "auto" }}>
          <table>
            <thead>
              <tr>
                <th></th>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    onClick={() => clickHeader(c.key)}
                    style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
                  >
                    {c.label}{sortKey === c.key ? (sortDesc ? " ↓" : " ↑") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((f) => (
                <tr key={f.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(f.id)}
                      onChange={() => toggle(f.id)}
                    />
                  </td>
                  {COLUMNS.map((c) => (
                    <td key={c.key} style={{ whiteSpace: "nowrap" }}>{c.render(f)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedFlights.length > 0 && (
        <>
          <div className="card">
            <h2>比較サマリー</h2>
            <div style={{ overflowX: "auto" }}>
              <CompareBarChart
                data={selectedFlights.map((f) => {
                  const hours = (f.duration_s ?? 0) / 3600;
                  return {
                    label: `${f.pilot}/${f.aircraft}/${fmtDate(f.flight_date)}`,
                    "平均上昇率(m/s)": f.avg_climb_in_thermals_ms ?? 0,
                    "平均速度(km/h)": f.avg_ground_speed_kmh ?? 0,
                    "最大L/D": f.best_glide_ratio ?? 0,
                    "距離(km)": f.total_distance_km ?? 0,
                    "サーマル密度(件/h)": hours > 0 ? (f.thermal_count ?? 0) / hours : 0,
                  };
                })}
                metrics={[
                  { key: "平均上昇率(m/s)", label: "平均上昇率 (m/s)", color: "#1a7f37" },
                  { key: "最大L/D", label: "最大L/D", color: "#9a6700" },
                  { key: "距離(km)", label: "距離 (km)", color: "#1f6feb" },
                  { key: "サーマル密度(件/h)", label: "サーマル密度 (件/h)", color: "#e07b00" },
                ]}
              />
            </div>
          </div>

          <div className="card">
            <h2>
              軌跡の重ね合わせ{" "}
              <label style={{ fontSize: "0.85rem", fontWeight: "normal", marginLeft: "1rem" }}>
                <input
                  type="checkbox"
                  checked={showMap}
                  onChange={(e) => setShowMap(e.target.checked)}
                />{" "}
                マップに描画 ({selectedFlights.length}件)
              </label>
            </h2>
            {showMap && (
              <div style={{ marginBottom: "0.75rem", display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center", fontSize: "0.88rem" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  経路透明度:
                  <input
                    type="range"
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={trackOpacity}
                    onChange={(e) => setTrackOpacity(Number(e.target.value))}
                    style={{ width: "80px" }}
                  />
                  <span style={{ minWidth: "32px" }}>{Math.round(trackOpacity * 100)}%</span>
                </span>
                <label>
                  <input
                    type="checkbox"
                    checked={showThermals}
                    onChange={(e) => setShowThermals(e.target.checked)}
                    style={{ marginRight: "0.3rem" }}
                  />
                  サーマル表示
                </label>
                {showThermals && (
                  <>
                    <span>
                      形状:{" "}
                      <select
                        value={thermalMode}
                        onChange={(e) => setThermalMode(e.target.value as "circle" | "rounded")}
                        style={{ fontSize: "0.88rem" }}
                      >
                        <option value="circle">円</option>
                        <option value="rounded">角丸長方形 (開始→終了)</option>
                      </select>
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      <label>
                        <input
                          type="checkbox"
                          checked={filterMinute == null}
                          onChange={(e) => setFilterMinute(e.target.checked ? null : 12 * 60)}
                          style={{ marginRight: "0.3rem" }}
                        />
                        全時間
                      </label>
                      {filterMinute != null && (
                        <>
                          <input
                            type="range"
                            min={0}
                            max={1430}
                            step={10}
                            value={filterMinute}
                            onChange={(e) => setFilterMinute(Number(e.target.value))}
                            style={{ width: "160px" }}
                          />
                          <span style={{ minWidth: "100px" }}>
                            {`${Math.floor(filterMinute / 60).toString().padStart(2, "0")}:${(filterMinute % 60).toString().padStart(2, "0")} ±20分`}
                          </span>
                        </>
                      )}
                      <span style={{ color: "#57606a" }}>
                        ({visibleThermals.length}/{thermals.length} 件)
                      </span>
                    </span>
                  </>
                )}
              </div>
            )}
            {showMap ? (
              loadingTracks ? (
                <div className="empty">トラック取得中...</div>
              ) : tracks.length === 0 ? (
                <div className="empty">軌跡データがありません</div>
              ) : (
                <div className="map-container">
                  <MapContainer center={mapCenter} zoom={11} style={{ height: "100%", width: "100%" }}>
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    {tracks.map((t, i) => (
                      <Polyline
                        key={t.flight_id}
                        positions={t.points.map((p): [number, number] => [p.lat, p.lon])}
                        pathOptions={{ color: COLORS[i % COLORS.length], weight: 2, opacity: trackOpacity }}
                      >
                        <Tooltip sticky>
                          {t.pilot} / {t.aircraft}
                        </Tooltip>
                      </Polyline>
                    ))}
                    {visibleThermals.map((t, i) => {
                      // Log scale: 60m at 0 m/s climb, ~215m at 5 m/s, ~255m at 10 m/s
                      const radius = Math.max(60, 80 * Math.log1p(t.avg_climb_rate_ms * 2));
                      const style = {
                        color: "#c00",
                        fillColor: "#e33",
                        fillOpacity: 0.25,
                        weight: 1,
                      };
                      const tip = (
                        <Tooltip>
                          {t.pilot} / {t.aircraft}
                          <br />
                          上昇率 {t.avg_climb_rate_ms.toFixed(2)} m/s
                          <br />
                          高度獲得 {t.altitude_gain_m.toFixed(0)} m
                          <br />
                          現地 {t.local_hour.toString().padStart(2, "0")}:{t.local_minute.toString().padStart(2, "0")}頃
                        </Tooltip>
                      );

                      if (
                        thermalMode === "rounded" &&
                        t.start_lat != null && t.start_lon != null &&
                        t.end_lat != null && t.end_lon != null
                      ) {
                        const poly = roundedRectPolygon(
                          t.start_lat, t.start_lon,
                          t.end_lat, t.end_lon,
                          radius,
                        );
                        return (
                          <Polygon key={i} positions={poly} pathOptions={style}>
                            {tip}
                          </Polygon>
                        );
                      }

                      return (
                        <Circle
                          key={i}
                          center={[t.center_lat, t.center_lon]}
                          radius={radius}
                          pathOptions={style}
                        >
                          {tip}
                        </Circle>
                      );
                    })}
                  </MapContainer>
                </div>
              )
            ) : (
              <div className="empty" style={{ padding: "1rem" }}>
                チェックを入れるとマップに軌跡を表示します（重い場合は選択を絞ってください）
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
