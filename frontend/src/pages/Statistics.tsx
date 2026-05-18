import { useEffect, useState } from "react";
import { api } from "../api/client";
import { CompareBarChart } from "../components/Charts";
import type {
  AircraftStats,
  FlightSummary,
  PilotStats,
  TimeOfDayBucket,
  WeatherBucket,
} from "../types";
import { fmtNum } from "../utils/format";

interface MonthBucket {
  month: string;
  flights: number;
  hours: number;
  avg_climb: number;
  avg_speed: number;
}

function bucketByMonth(flights: FlightSummary[]): MonthBucket[] {
  const m = new Map<string, FlightSummary[]>();
  for (const f of flights) {
    const month = f.flight_date.slice(0, 7);
    if (!m.has(month)) m.set(month, []);
    m.get(month)!.push(f);
  }
  return Array.from(m.entries())
    .sort()
    .map(([month, fs]) => {
      const climbs = fs.map((f) => f.avg_climb_in_thermals_ms).filter((x): x is number => x != null);
      const speeds = fs.map((f) => f.avg_ground_speed_kmh).filter((x): x is number => x != null);
      return {
        month,
        flights: fs.length,
        hours: Number((fs.reduce((s, f) => s + (f.duration_s ?? 0), 0) / 3600).toFixed(2)),
        avg_climb: climbs.length ? Number((climbs.reduce((a, b) => a + b, 0) / climbs.length).toFixed(2)) : 0,
        avg_speed: speeds.length ? Number((speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(1)) : 0,
      };
    });
}

export default function Statistics() {
  const [pilots, setPilots] = useState<PilotStats[]>([]);
  const [aircraft, setAircraft] = useState<AircraftStats[]>([]);
  const [flights, setFlights] = useState<FlightSummary[]>([]);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDayBucket[]>([]);
  const [weather, setWeather] = useState<WeatherBucket[]>([]);
  const [selectedPilot, setSelectedPilot] = useState("");

  useEffect(() => {
    Promise.all([
      api.pilotStats(),
      api.aircraftStats(),
      api.listFlights(),
      api.weatherStats(),
    ])
      .then(([p, a, f, w]) => {
        setPilots(p);
        setAircraft(a);
        setFlights(f);
        setWeather(w);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    api.timeOfDayStats({ pilot: selectedPilot || undefined }).then(setTimeOfDay).catch(console.error);
  }, [selectedPilot]);

  const filtered = selectedPilot ? flights.filter((f) => f.pilot === selectedPilot) : flights;
  const monthData = bucketByMonth(filtered);

  // Fill missing hours with zeros so the chart shows a continuous day axis.
  const hourMap = new Map(timeOfDay.map((b) => [b.hour, b]));
  const hourData = Array.from({ length: 24 }, (_, h) => {
    const b = hourMap.get(h);
    return {
      label: `${h.toString().padStart(2, "0")}時`,
      "平均上昇率(m/s)": b ? b.avg_climb_rate_ms : 0,
      "サーマル数": b ? b.thermal_count : 0,
      "平均獲得高度(m)": b ? b.avg_altitude_gain_m : 0,
    };
  });

  return (
    <div>
      <h1>統計・トレンド</h1>

      <div className="card">
        <h2>選手ランキング</h2>
        <table>
          <thead>
            <tr>
              <th>選手</th>
              <th>フライト数</th>
              <th>総時間</th>
              <th>総距離</th>
              <th>平均上昇率</th>
              <th>平均速度</th>
              <th>最大L/D</th>
            </tr>
          </thead>
          <tbody>
            {pilots.map((p) => (
              <tr key={p.pilot}>
                <td><strong>{p.pilot}</strong></td>
                <td>{p.flight_count}</td>
                <td>{p.total_hours.toFixed(1)} h</td>
                <td>{p.total_distance_km.toFixed(0)} km</td>
                <td>{fmtNum(p.avg_climb_in_thermals_ms, 2, "m/s")}</td>
                <td>{fmtNum(p.avg_ground_speed_kmh, 1, "km/h")}</td>
                <td>{fmtNum(p.best_glide_ratio, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>機体パフォーマンス比較</h2>
        <CompareBarChart
          data={aircraft.map((a) => ({
            label: a.aircraft,
            "平均上昇率(m/s)": a.avg_climb_in_thermals_ms ?? 0,
            "平均速度(km/h)": a.avg_ground_speed_kmh ?? 0,
            "最大L/D": a.best_glide_ratio ?? 0,
          }))}
          metrics={[
            { key: "平均上昇率(m/s)", label: "平均上昇率 (m/s)", color: "#1a7f37" },
            { key: "最大L/D", label: "最大L/D", color: "#9a6700" },
          ]}
        />
      </div>

      <div className="card">
        <h2>月別トレンド</h2>
        <div className="filters">
          <select value={selectedPilot} onChange={(e) => setSelectedPilot(e.target.value)}>
            <option value="">全選手</option>
            {pilots.map((p) => <option key={p.pilot} value={p.pilot}>{p.pilot}</option>)}
          </select>
        </div>
        <CompareBarChart
          data={monthData.map((m) => ({
            label: m.month,
            "平均上昇率(m/s)": m.avg_climb,
            "平均速度(km/h)": m.avg_speed,
            "飛行時間(h)": m.hours,
          }))}
          metrics={[
            { key: "平均上昇率(m/s)", label: "平均上昇率 (m/s)", color: "#1a7f37" },
            { key: "平均速度(km/h)", label: "平均速度 (km/h)", color: "#9a6700" },
            { key: "飛行時間(h)", label: "飛行時間 (h)", color: "#1f6feb" },
          ]}
        />
      </div>

      <div className="card">
        <h2>時間帯別サーマル強度 (現地時刻)</h2>
        <p style={{ fontSize: "0.82rem", color: "#57606a", margin: "0 0 0.5rem" }}>
          検出されたサーマルを開始時刻（経度から推定した現地時刻）でバケット化したもの。
          {selectedPilot && <> 選手フィルタ: <strong>{selectedPilot}</strong></>}
        </p>
        {timeOfDay.length === 0 ? (
          <div className="empty">サーマルデータがありません</div>
        ) : (
          <CompareBarChart
            data={hourData}
            metrics={[
              { key: "平均上昇率(m/s)", label: "平均上昇率 (m/s)", color: "#1a7f37" },
              { key: "サーマル数", label: "サーマル数", color: "#1f6feb" },
              { key: "平均獲得高度(m)", label: "平均獲得高度 (m)", color: "#9a6700" },
            ]}
          />
        )}
      </div>

      <div className="card">
        <h2>気象条件別 (風速バケット)</h2>
        <p style={{ fontSize: "0.82rem", color: "#57606a", margin: "0 0 0.5rem" }}>
          離陸地点・離陸時刻の地表風速（Open-Meteo）で各フライトを分類し、効率指標を比較。
        </p>
        {weather.length === 0 ? (
          <div className="empty">
            気象データのあるフライトがありません。<br />
            各フライトの詳細ページで「気象を取得」ボタンを押してください。
          </div>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>風速帯</th>
                  <th>フライト数</th>
                  <th>平均上昇率</th>
                  <th>平均速度</th>
                  <th>最大L/D平均</th>
                </tr>
              </thead>
              <tbody>
                {weather.map((w) => (
                  <tr key={w.label}>
                    <td><strong>{w.label}</strong></td>
                    <td>{w.flight_count}</td>
                    <td>{fmtNum(w.avg_climb_rate_ms, 2, "m/s")}</td>
                    <td>{fmtNum(w.avg_ground_speed_kmh, 1, "km/h")}</td>
                    <td>{fmtNum(w.avg_best_glide, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: "1rem" }}>
              <CompareBarChart
                data={weather.map((w) => ({
                  label: w.label,
                  "平均上昇率(m/s)": w.avg_climb_rate_ms ?? 0,
                  "平均速度(km/h)": w.avg_ground_speed_kmh ?? 0,
                  "最大L/D": w.avg_best_glide ?? 0,
                }))}
                metrics={[
                  { key: "平均上昇率(m/s)", label: "平均上昇率 (m/s)", color: "#1a7f37" },
                  { key: "最大L/D", label: "最大L/D", color: "#9a6700" },
                ]}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
