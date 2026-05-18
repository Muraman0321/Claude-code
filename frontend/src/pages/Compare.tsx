import { useEffect, useMemo, useState } from "react";
import { MapContainer, Polyline, TileLayer, Tooltip } from "react-leaflet";
import { api } from "../api/client";
import { CompareBarChart } from "../components/Charts";
import type { FlightSummary, FlightTrack } from "../types";
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

  useEffect(() => {
    if (showMap) loadTracks().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMap, selectedFlights.map((f) => f.id).join(",")]);

  const mapCenter = useMemo<[number, number]>(() => {
    const pts = tracks.flatMap((t) => t.points);
    if (pts.length === 0) return [36.18, 139.39];
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
