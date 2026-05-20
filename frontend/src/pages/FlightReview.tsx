import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip as LeafletTooltip } from "react-leaflet";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import type { Fix, FlightDetail, FlightPhaseAnalysis, FlightSummary, Thermal } from "../types";
import { fmtDate, fmtDuration, fmtNum } from "../utils/format";

// ── helpers ──────────────────────────────────────────────────────────────────

function windBucket(speedKmh: number | null): string {
  if (speedKmh == null) return "不明";
  const ms = speedKmh / 3.6;
  if (ms < 5) return "0–5 m/s";
  if (ms < 10) return "5–10 m/s";
  if (ms < 15) return "10–15 m/s";
  return "15+ m/s";
}

function buildTowProfile(
  detail: FlightDetail,
): { sec: number; alt: number }[] {
  if (detail.fixes.length === 0) return [];
  const t0 = new Date(detail.fixes[0].timestamp).getTime();
  // Use tow phase: up to first 10 minutes or until altitude starts dropping significantly
  const points: { sec: number; alt: number }[] = [];
  const baseAlt = detail.fixes[0].altitude_m;
  for (const f of detail.fixes) {
    const sec = (new Date(f.timestamp).getTime() - t0) / 1000;
    if (sec > 600) break; // cap at 10 min
    points.push({ sec: Math.round(sec), alt: Math.round(f.altitude_m - baseAlt) });
  }
  return points;
}

const PHASE_COLORS = ["#1f6feb", "#e36209", "#8250df", "#1a7f37", "#cf222e"];
const PHASE_LABELS = ["初期", "中期", "後期"];
const TOW_PHASE_COLOR: Record<string, string> = {
  initial: "#ff6b6b",
  mid: "#4ecdc4",
  late: "#ffe66d",
};

// ── sub-sections ──────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "1rem",
        border: "1px solid #d0d7de",
        borderRadius: "8px",
        textAlign: "center",
        minWidth: "130px",
      }}
    >
      <div style={{ fontSize: "0.8rem", color: "#57606a", marginBottom: "0.3rem" }}>{label}</div>
      <div style={{ fontSize: "1.3rem", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function DataSection({ flight }: { flight: FlightDetail }) {
  const durationH = flight.duration_s != null ? flight.duration_s / 3600 : null;
  const thermalsPerH =
    flight.thermal_count != null && durationH != null && durationH > 0
      ? (flight.thermal_count / durationH).toFixed(1)
      : "—";

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
      <StatCard label="飛行時間" value={fmtDuration(flight.duration_s)} />
      <StatCard label="飛行距離" value={fmtNum(flight.total_distance_km, 1, "km")} />
      <StatCard label="最高高度" value={fmtNum(flight.max_altitude_m, 0, "m")} />
      <StatCard label="最高速度" value={fmtNum(flight.max_ground_speed_kmh, 1, "km/h")} />
      <StatCard label="平均上昇率" value={fmtNum(flight.avg_climb_in_thermals_ms, 2, "m/s")} />
      <StatCard label="サーマル数" value={flight.thermal_count != null ? String(flight.thermal_count) : "—"} />
      <StatCard label="サーマル頻度" value={thermalsPerH !== "—" ? `${thermalsPerH} 件/h` : "—"} />
    </div>
  );
}

// ── TowSection ────────────────────────────────────────────────────────────────

interface TowSectionProps {
  selected: FlightDetail;
  allFlights: FlightSummary[];
}

function TowSection({ selected, allFlights }: TowSectionProps) {
  const [peerDetails, setPeerDetails] = useState<FlightDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [phaseAnalysis, setPhaseAnalysis] = useState<FlightPhaseAnalysis | null>(null);
  const [phaseLoading, setPhaseLoading] = useState(false);

  const selectedBucket = windBucket(selected.weather_wind_speed_kmh);

  useEffect(() => {
    const peers = allFlights
      .filter(
        (f) =>
          f.id !== selected.id &&
          windBucket(f.weather_wind_speed_kmh) === selectedBucket,
      )
      .slice(0, 8);
    if (peers.length === 0) {
      setPeerDetails([]);
      return;
    }
    setLoading(true);
    Promise.all(peers.map((f) => api.getFlight(f.id)))
      .then((details) => setPeerDetails(details))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selected.id, selectedBucket, allFlights]);

  useEffect(() => {
    setPhaseAnalysis(null);
    setPhaseLoading(true);
    api
      .getFlightPhaseAnalysis(selected.id)
      .then((data) => setPhaseAnalysis(data))
      .catch(console.error)
      .finally(() => setPhaseLoading(false));
  }, [selected.id]);

  // Build merged tow profile chart data
  const chartData = useMemo(() => {
    const selProfile = buildTowProfile(selected);
    const maxSec = selProfile.length > 0 ? selProfile[selProfile.length - 1].sec : 0;

    // Index peer profiles by second
    const peerMaps = peerDetails.map((d) => {
      const m = new Map<number, number>();
      for (const p of buildTowProfile(d)) m.set(p.sec, p.alt);
      return m;
    });

    return selProfile.map(({ sec, alt }) => {
      const row: Record<string, number | null> = { sec, selected: alt };
      peerMaps.forEach((m, i) => {
        row[`peer${i}`] = m.get(sec) ?? null;
      });
      return row;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.id, peerDetails]);

  const peerCount = peerDetails.length;

  // Compare phase metrics: avg_climb_rate for initial phase
  const selInitialClimb = selected.avg_climb_in_thermals_ms;
  const peerAvgClimb =
    peerDetails.length > 0
      ? peerDetails
          .map((d) => d.avg_climb_in_thermals_ms)
          .filter((v): v is number => v != null)
          .reduce((a, b, _, arr) => a + b / arr.length, 0)
      : null;

  return (
    <div>
      <p style={{ color: "#57606a", fontSize: "0.9rem", margin: "0 0 1rem" }}>
        風速バケット: <strong>{selectedBucket}</strong> — 同バケット内の他フライト {peerCount} 件と比較
        {loading && " (読み込み中...)"}
      </p>

      <h3 style={{ marginTop: "1.5rem" }}>曳航高度プロファイル</h3>
      <div className="chart-container">
        <ResponsiveContainer>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="sec"
              label={{ value: "経過時間 (秒)", position: "insideBottom", offset: -5 }}
            />
            <YAxis
              label={{ value: "相対高度 (m)", angle: -90, position: "insideLeft" }}
            />
            <Tooltip
              formatter={(v: number, name: string) => [
                `${v} m`,
                name === "selected" ? "選択フライト" : `比較 ${name.replace("peer", "")}`,
              ]}
            />
            <Line
              dataKey="selected"
              stroke="#1f6feb"
              strokeWidth={2.5}
              dot={false}
              name="選択フライト"
            />
            {peerDetails.map((_, i) => (
              <Line
                key={`peer${i}`}
                dataKey={`peer${i}`}
                stroke={PHASE_COLORS[(i + 1) % PHASE_COLORS.length]}
                strokeWidth={1}
                strokeDasharray="4 2"
                dot={false}
                opacity={0.6}
                name={`比較 ${i + 1}`}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {peerAvgClimb != null && selInitialClimb != null && (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.75rem 1rem",
            background: "#f6f8fa",
            borderRadius: "6px",
            fontSize: "0.9rem",
          }}
        >
          <strong>ソアリング上昇率比較 (同風速バケット)</strong>
          <table style={{ marginTop: "0.5rem", width: "auto" }}>
            <thead>
              <tr>
                <th>指標</th>
                <th>選択フライト</th>
                <th>バケット平均</th>
                <th>評価</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>平均上昇率</td>
                <td>{selInitialClimb.toFixed(2)} m/s</td>
                <td>{peerAvgClimb.toFixed(2)} m/s</td>
                <td>
                  {selInitialClimb >= peerAvgClimb ? (
                    <span style={{ color: "#1a7f37" }}>▲ 平均以上</span>
                  ) : (
                    <span style={{ color: "#cf222e" }}>▼ 平均以下</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ── Phase analysis cards ── */}
      <h3 style={{ marginTop: "2rem" }}>曳航フェーズ分析</h3>
      {phaseLoading ? (
        <div className="empty">読み込み中...</div>
      ) : phaseAnalysis == null ? (
        <div className="empty">フェーズデータがありません</div>
      ) : (
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
          {(
            [
              { key: "initial" as const, label: "曳航初期", sub: "急激な上昇開始10秒前〜高度80m" },
              { key: "mid" as const, label: "曳航中期", sub: "高度80m〜急激な上昇の終了" },
              { key: "late" as const, label: "曳航終期", sub: "急激な上昇の終了〜リリース" },
            ] as const
          ).map(({ key, label, sub }) => {
            const m = phaseAnalysis[key];
            return (
              <div
                key={key}
                style={{
                  flex: "1 1 200px",
                  padding: "1rem",
                  border: `2px solid ${TOW_PHASE_COLOR[key]}`,
                  borderRadius: "8px",
                  background: `${TOW_PHASE_COLOR[key]}18`,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: "1rem", color: TOW_PHASE_COLOR[key] }}>
                  {label}
                </div>
                <div style={{ fontSize: "0.78rem", color: "#57606a", marginBottom: "0.75rem" }}>
                  {sub}
                </div>
                {m == null ? (
                  <div style={{ color: "#57606a", fontSize: "0.85rem" }}>データなし</div>
                ) : (
                  <table style={{ width: "100%", fontSize: "0.85rem" }}>
                    <tbody>
                      <tr>
                        <td style={{ color: "#57606a" }}>所要時間</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>
                          {m.duration_s.toFixed(0)} 秒
                        </td>
                      </tr>
                      <tr>
                        <td style={{ color: "#57606a" }}>平均上昇率</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>
                          {m.avg_climb_rate_ms.toFixed(2)} m/s
                        </td>
                      </tr>
                      <tr>
                        <td style={{ color: "#57606a" }}>獲得高度</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>
                          {m.altitude_gained_m != null ? `${m.altitude_gained_m.toFixed(0)} m` : "—"}
                        </td>
                      </tr>
                      <tr>
                        <td style={{ color: "#57606a" }}>平均速度</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>
                          {m.avg_speed_kmh.toFixed(1)} km/h
                        </td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── MapSection ────────────────────────────────────────────────────────────────

function WindOverlay({ speedKmh, dirDeg }: { speedKmh: number | null; dirDeg: number | null }) {
  if (speedKmh == null) return null;
  const speedMs = speedKmh / 3.6;
  // dirDeg is the direction the wind comes FROM (meteorological).
  // Arrow points where the wind blows TO: rotate by dirDeg + 180.
  const arrowRotation = dirDeg != null ? dirDeg + 180 : 0;
  const dirLabel = dirDeg != null ? `${Math.round(dirDeg)}°` : "不明";

  return (
    <div
      style={{
        position: "absolute",
        top: "10px",
        right: "10px",
        zIndex: 1000,
        background: "rgba(255,255,255,0.92)",
        border: "1px solid #d0d7de",
        borderRadius: "8px",
        padding: "8px 12px",
        fontSize: "0.8rem",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        pointerEvents: "none",
      }}
    >
      {dirDeg != null && (
        <svg width="28" height="28" viewBox="0 0 28 28">
          <g transform={`rotate(${arrowRotation}, 14, 14)`}>
            {/* shaft */}
            <line x1="14" y1="22" x2="14" y2="8" stroke="#1f6feb" strokeWidth="2.5" strokeLinecap="round" />
            {/* arrowhead */}
            <polygon points="14,4 10,12 18,12" fill="#1f6feb" />
          </g>
        </svg>
      )}
      <div>
        <div style={{ fontWeight: 700, color: "#24292f" }}>{speedMs.toFixed(1)} m/s</div>
        <div style={{ color: "#57606a" }}>風向 {dirLabel}</div>
      </div>
    </div>
  );
}

function MapSection({ flight }: { flight: FlightDetail }) {
  const center: [number, number] = useMemo(() => {
    if (flight.fixes.length === 0) return [36.2114, 139.4189];
    const lat = flight.fixes.reduce((s, f) => s + f.latitude, 0) / flight.fixes.length;
    const lon = flight.fixes.reduce((s, f) => s + f.longitude, 0) / flight.fixes.length;
    return [lat, lon];
  }, [flight.fixes]);

  const positions: [number, number][] = flight.fixes.map((f) => [f.latitude, f.longitude]);

  return (
    <div style={{ position: "relative", height: "500px", borderRadius: "8px", overflow: "hidden" }}>
      <MapContainer center={center} zoom={12} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        {positions.length > 1 && (
          <Polyline positions={positions} color="#1f6feb" weight={2} opacity={0.8} />
        )}
        {flight.thermals.map((th, i) => {
          const avgClimb = th.avg_climb_rate_ms;
          const intensity = Math.min(1, avgClimb / 3);
          const r = Math.round(255 * intensity);
          const b = Math.round(255 * (1 - intensity));
          const color = `rgb(${r},0,${b})`;
          return (
            <CircleMarker
              key={i}
              center={[th.center_lat, th.center_lon]}
              radius={6 + avgClimb * 3}
              color={color}
              fillColor={color}
              fillOpacity={0.65}
              weight={2}
            >
              <LeafletTooltip>
                <strong>サーマル</strong><br />
                上昇率: {th.avg_climb_rate_ms.toFixed(2)} m/s<br />
                獲得高度: {th.altitude_gain_m.toFixed(0)} m<br />
                時間: {th.duration_s.toFixed(0)} 秒
              </LeafletTooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
      <WindOverlay
        speedKmh={flight.weather_wind_speed_kmh}
        dirDeg={flight.weather_wind_dir_deg}
      />
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function FlightReview() {
  const [allFlights, setAllFlights] = useState<FlightSummary[]>([]);
  const [pilots, setPilots] = useState<string[]>([]);
  const [filterPilot, setFilterPilot] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [flightDetail, setFlightDetail] = useState<FlightDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);

  useEffect(() => {
    setListLoading(true);
    Promise.all([api.listFlights(), api.listPilots()])
      .then(([flights, ps]) => {
        setAllFlights(flights);
        setPilots(ps);
      })
      .catch(console.error)
      .finally(() => setListLoading(false));
  }, []);

  useEffect(() => {
    if (selectedId == null) {
      setFlightDetail(null);
      return;
    }
    setDetailLoading(true);
    api
      .getFlight(selectedId)
      .then((d) => setFlightDetail(d))
      .catch(console.error)
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  const visibleFlights = useMemo(() => {
    return allFlights.filter((f) => {
      if (filterPilot && f.pilot !== filterPilot) return false;
      if (filterDateFrom && f.flight_date < filterDateFrom) return false;
      if (filterDateTo && f.flight_date > filterDateTo) return false;
      return true;
    });
  }, [allFlights, filterPilot, filterDateFrom, filterDateTo]);

  return (
    <div>
      <h1>フライト振り返り</h1>

      {/* ── Analysis section ── */}
      <div className="card">
        {selectedId == null ? (
          <div className="empty">フライトを選択してください</div>
        ) : detailLoading ? (
          <div className="empty">読み込み中...</div>
        ) : flightDetail == null ? (
          <div className="empty">データが見つかりません</div>
        ) : (
          <>
            <h2>
              フライト分析 — {flightDetail.pilot} ({fmtDate(flightDetail.flight_date)})
            </h2>

            <h3 style={{ marginTop: "1.5rem", marginBottom: "0.75rem" }}>データ</h3>
            <DataSection flight={flightDetail} />

            <h3 style={{ marginTop: "2rem", marginBottom: "0.75rem" }}>曳航</h3>
            <TowSection selected={flightDetail} allFlights={allFlights} />

            <h3 style={{ marginTop: "2rem", marginBottom: "0.75rem" }}>フライト</h3>
            <MapSection flight={flightDetail} />
          </>
        )}
      </div>

      {/* ── Flight selector ── */}
      <div className="card">
        <h2>フライト一覧</h2>

        {/* filters */}
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.85rem" }}>パイロット</span>
            <select value={filterPilot} onChange={(e) => setFilterPilot(e.target.value)}>
              <option value="">すべて</option>
              {pilots.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.85rem" }}>日付 (から)</span>
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.85rem" }}>日付 (まで)</span>
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
            />
          </label>
        </div>

        {listLoading ? (
          <div className="empty">読み込み中...</div>
        ) : visibleFlights.length === 0 ? (
          <div className="empty">フライトが見つかりません</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>日付</th>
                  <th>パイロット</th>
                  <th>機体</th>
                  <th>飛行時間</th>
                  <th>距離</th>
                  <th>最高高度</th>
                  <th>サーマル数</th>
                </tr>
              </thead>
              <tbody>
                {visibleFlights.slice(0, 20).map((f) => (
                  <tr
                    key={f.id}
                    style={{
                      cursor: "pointer",
                      background: selectedId === f.id ? "#ddf4ff" : undefined,
                    }}
                    onClick={() => {
                      setSelectedId(f.id === selectedId ? null : f.id);
                    }}
                  >
                    <td>
                      <input
                        type="radio"
                        readOnly
                        checked={selectedId === f.id}
                        style={{ cursor: "pointer" }}
                      />
                    </td>
                    <td>{fmtDate(f.flight_date)}</td>
                    <td>{f.pilot}</td>
                    <td>{f.aircraft}</td>
                    <td>{fmtDuration(f.duration_s)}</td>
                    <td>{fmtNum(f.total_distance_km, 1, "km")}</td>
                    <td>{fmtNum(f.max_altitude_m, 0, "m")}</td>
                    <td>{f.thermal_count ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visibleFlights.length > 20 && (
              <p style={{ color: "#57606a", fontSize: "0.85rem", marginTop: "0.5rem" }}>
                {visibleFlights.length} 件中 20 件を表示しています。絞り込みで件数を減らしてください。
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
