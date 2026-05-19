import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { FileUpload } from "../components/FileUpload";
import type { FlightSummary } from "../types";
import { fmtDate, fmtDuration, fmtNum } from "../utils/format";

export default function Dashboard() {
  const [flights, setFlights] = useState<FlightSummary[]>([]);
  const [pilots, setPilots] = useState<string[]>([]);
  const [aircraft, setAircraft] = useState<string[]>([]);
  const [filterPilot, setFilterPilot] = useState("");
  const [filterAircraft, setFilterAircraft] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  async function refresh() {
    const [f, p, a] = await Promise.all([
      api.listFlights({
        pilot: filterPilot || undefined,
        aircraft: filterAircraft || undefined,
        date_from: filterFrom || undefined,
        date_to: filterTo || undefined,
      }),
      api.listPilots(),
      api.listAircraft(),
    ]);
    setFlights(f);
    setPilots(p);
    setAircraft(a);
  }

  useEffect(() => {
    refresh().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterPilot, filterAircraft, filterFrom, filterTo]);

  async function handleDelete(id: number) {
    if (!confirm("このフライトを削除しますか？")) return;
    await api.deleteFlight(id);
    refresh();
  }

  return (
    <div>
      <h1>ダッシュボード</h1>
      <FileUpload onDone={refresh} />

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
          <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
          <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <h2>フライト一覧 ({flights.length} 件)</h2>
        {flights.length === 0 ? (
          <div className="empty">フライトがまだありません。IGCファイルをアップロードしてください。</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>日付</th>
                <th>選手</th>
                <th>機体</th>
                <th>時間</th>
                <th>距離</th>
                <th>最高高度</th>
                <th>平均上昇率</th>
                <th>最高速度</th>
                <th>サーマル</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {flights.map((f) => (
                <tr key={f.id}>
                  <td>{fmtDate(f.flight_date)}</td>
                  <td><strong>{f.pilot}</strong></td>
                  <td><span className="tag">{f.aircraft}</span></td>
                  <td>{fmtDuration(f.duration_s)}</td>
                  <td>{fmtNum(f.total_distance_km, 1, "km")}</td>
                  <td>{fmtNum(f.max_altitude_m, 0, "m")}</td>
                  <td>{fmtNum(f.avg_climb_in_thermals_ms, 2, "m/s")}</td>
                  <td>{fmtNum(f.max_ground_speed_kmh, 0, "km/h")}</td>
                  <td>{f.thermal_count ?? 0}</td>
                  <td>
                    <Link to={`/flights/${f.id}`}>詳細</Link>
                    {" / "}
                    <a href="#" onClick={(e) => { e.preventDefault(); handleDelete(f.id); }} style={{ color: "#cf222e" }}>
                      削除
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
