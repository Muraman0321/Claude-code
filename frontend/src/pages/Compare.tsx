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
  { key: "thermal_count", label: "サーマル", render: (f) => f.thermal_count ?? 0, numeric: true },
];

const COLORS = [
  "#1f6feb", "#1a7f37", "#cf222e", "#9a6700", "#6f42c1",
  "#1b9aaa", "#e07b00", "#d63384", "#198754", "#0d6efd",
];

const MAX_SELECTED = 100;

// Compute a geodesic capsule polygon from start→end with the given radius (meters).
// Returns a closed [lat, lon] ring approximating a stadium shape.
function capsulePolygon(
  sLat: number, sLon: number,
  eLat: number, eLon: number,
  radiusM: number,
  arcSteps = 8,
): [number, number][] {
  const R = 6_371_000;
  function offsetPt(lat: number, lon: number, brg: number, dist: number): [number, number] {
    const d = dist / R;
    const φ = lat * Math.PI / 180;
    const λ = lon * Math.PI / 180;
    const θ = ((brg % 360) + 360) % 360 * Math.PI / 180;
    const φ2 = Math.asin(Math.sin(φ) * Math.cos(d) + Math.cos(φ) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ), Math.cos(d) - Math.sin(φ) * Math.sin(φ2));
    return [φ2 * 180 / Math.PI, λ2 * 180 / Math.PI];
  }

  // Bearing from start to end
  const φ1 = sLat * Math.PI / 180, φ2 = eLat * Math.PI / 180;
  const dλ = (eLon - sLon) * Math.PI / 180;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  const fwd = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

  const pts: [number, number][] = [];
  // End cap: sweep from fwd+90 to fwd+270 (through the far side)
  for (let i = 0; i <= arcSteps; i++) {
    pts.push(offsetPt(eLat, eLon, fwd + 90 + 180 * i / arcSteps, radiusM));
  }
  // Start cap: sweep from fwd+270 to fwd+450 (= fwd+90, through the near side)
  for (let i = 0; i <= arcSteps; i++) {
    pts.push(offsetPt(sLat, sLon, fwd + 270 + 180 * i / arcSteps, radiusM));
  }
  pts.push(pts[0]);
  return pts;
}

function hourDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 24;
  return d > 12 ? 24 - d : d;
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
  const [thermalMode, setThermalMode] = useState<"circle" | "stadium">("circle");
  const [filterHour, setFilterHour] = useState<number | null>(null);

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
    if (filterHour == null) return thermals;
    return thermals.filter((t) => hourDist(t.local_hour, filterHour) <= 1);
  }, [thermals, showThermals, filterHour]);

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
                data={selectedFlights.map((f) => ({
                  label: `${f.pilot}/${f.aircraft}/${fmtDate(f.flight_date)}`,
                  "平均上昇率(m/s)": f.avg_climb_in_thermals_ms ?? 0,
                  "平均速度(km/h)": f.avg_ground_speed_kmh ?? 0,
                  "最大L/D": f.best_glide_ratio ?? 0,
                  "距離(km)": f.total_distance_km ?? 0,
                }))}
                metrics={[
                  { key: "平均上昇率(m/s)", label: "平均上昇率 (m/s)", color: "#1a7f37" },
                  { key: "最大L/D", label: "最大L/D", color: "#9a6700" },
                  { key: "距離(km)", label: "距離 (km)", color: "#1f6feb" },
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
                        onChange={(e) => setThermalMode(e.target.value as "circle" | "stadium")}
                        style={{ fontSize: "0.88rem" }}
                      >
                        <option value="circle">円</option>
                        <option value="stadium">カプセル (開始→終了)</option>
                      </select>
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      <label>
                        <input
                          type="checkbox"
                          checked={filterHour == null}
                          onChange={(e) => setFilterHour(e.target.checked ? null : 12)}
                          style={{ marginRight: "0.3rem" }}
                        />
                        全時間
                      </label>
                      {filterHour != null && (
                        <>
                          <input
                            type="range"
                            min={0}
                            max={23}
                            value={filterHour}
                            onChange={(e) => setFilterHour(Number(e.target.value))}
                            style={{ width: "120px" }}
                          />
                          <span style={{ minWidth: "80px" }}>
                            {filterHour.toString().padStart(2, "0")}:00台 ±1h
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
                        pathOptions={{ color: COLORS[i % COLORS.length], weight: 2, opacity: 0.7 }}
                      >
                        <Tooltip sticky>
                          {t.pilot} / {t.aircraft}
                        </Tooltip>
                      </Polyline>
                    ))}
                    {visibleThermals.map((t, i) => {
                      const radius = Math.max(100, 200 * t.avg_climb_rate_ms);
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
                          現地 {t.local_hour.toString().padStart(2, "0")}:00台
                        </Tooltip>
                      );

                      if (
                        thermalMode === "stadium" &&
                        t.start_lat != null && t.start_lon != null &&
                        t.end_lat != null && t.end_lon != null
                      ) {
                        const poly = capsulePolygon(
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
