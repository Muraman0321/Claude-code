import { useEffect, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import type {
  FlightSummary,
  PilotStats,
  SeasonBucket,
  TimeOfDayBucket,
  WeatherBucket,
} from "../types";
import { fmtNum } from "../utils/format";

interface MonthBucket {
  month: string;
  flights: number;
  hours: number;
  avg_climb_ms: number;
  avg_wind_ms: number | null;
  avg_temp_c: number | null;
}

function bucketByMonth(flights: FlightSummary[]): MonthBucket[] {
  const m = new Map<string, FlightSummary[]>();
  for (const f of flights) {
    const month = f.flight_date.slice(0, 7);
    if (!m.has(month)) m.set(month, []);
    m.get(month)!.push(f);
  }
  function mean(xs: number[]): number | null {
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  }
  return Array.from(m.entries())
    .sort()
    .map(([month, fs]) => {
      const climbs = fs.map((f) => f.avg_climb_in_thermals_ms).filter((x): x is number => x != null);
      const winds = fs.map((f) => f.weather_wind_speed_kmh).filter((x): x is number => x != null);
      const temps = fs.map((f) => f.weather_temp_c).filter((x): x is number => x != null);
      return {
        month,
        flights: fs.length,
        hours: Number((fs.reduce((s, f) => s + (f.duration_s ?? 0), 0) / 3600).toFixed(2)),
        avg_climb_ms: climbs.length ? Number((climbs.reduce((a, b) => a + b, 0) / climbs.length).toFixed(2)) : 0,
        avg_wind_ms: winds.length ? Number((winds.reduce((a, b) => a + b, 0) / winds.length / 3.6).toFixed(2)) : null,
        avg_temp_c: temps.length ? Number((temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1)) : null,
      };
    });
}

type PilotSortKey = keyof PilotStats;

export default function Statistics() {
  const [pilots, setPilots] = useState<PilotStats[]>([]);
  const [flights, setFlights] = useState<FlightSummary[]>([]);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDayBucket[]>([]);
  const [weather, setWeather] = useState<WeatherBucket[]>([]);
  const [seasons, setSeasons] = useState<SeasonBucket[]>([]);
  const [selectedPilot, setSelectedPilot] = useState("");
  const [selectedSeason, setSelectedSeason] = useState("");

  // Pilot ranking sort
  const [pilotSortKey, setPilotSortKey] = useState<PilotSortKey>("flight_count");
  const [pilotSortDir, setPilotSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    Promise.all([
      api.pilotStats(),
      api.listFlights(),
      api.weatherStats(),
    ])
      .then(([p, f, w]) => {
        setPilots(p);
        setFlights(f);
        setWeather(w);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    api.seasonStats({ pilot: selectedPilot || undefined }).then(setSeasons).catch(console.error);
  }, [selectedPilot]);

  useEffect(() => {
    api.timeOfDayStats({
      pilot: selectedPilot || undefined,
      season: selectedSeason || undefined,
    }).then(setTimeOfDay).catch(console.error);
  }, [selectedPilot, selectedSeason]);

  const filtered = selectedPilot ? flights.filter((f) => f.pilot === selectedPilot) : flights;
  const monthData = bucketByMonth(filtered);

  const sortedPilots = [...pilots].sort((a, b) => {
    const av = a[pilotSortKey] as number | string | null;
    const bv = b[pilotSortKey] as number | string | null;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number")
      return pilotSortDir === "desc" ? bv - av : av - bv;
    return pilotSortDir === "desc"
      ? String(bv).localeCompare(String(av))
      : String(av).localeCompare(String(bv));
  });

  function togglePilotSort(key: PilotSortKey) {
    if (pilotSortKey === key) setPilotSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setPilotSortKey(key); setPilotSortDir("desc"); }
  }

  function sortIcon(key: PilotSortKey) {
    if (pilotSortKey !== key) return " ↕";
    return pilotSortDir === "desc" ? " ↓" : " ↑";
  }

  // Time-of-day: 06–18 only
  const hourMap = new Map(timeOfDay.map((b) => [b.hour, b]));
  const hourData = Array.from({ length: 13 }, (_, i) => i + 6).map((h) => {
    const b = hourMap.get(h);
    return {
      label: `${h.toString().padStart(2, "0")}時`,
      "平均上昇率(m/s)": b ? Number(b.avg_climb_rate_ms.toFixed(2)) : 0,
      "平均獲得高度(m)": b ? Number(b.avg_altitude_gain_m.toFixed(0)) : 0,
    };
  });

  return (
    <div>
      <h1>統計・トレンド</h1>

      {/* 選手ランキング */}
      <div className="card">
        <h2>選手ランキング</h2>
        <table>
          <thead>
            <tr>
              {(
                [
                  ["pilot", "選手"],
                  ["flight_count", "フライト数"],
                  ["total_hours", "総時間"],
                  ["total_distance_km", "総距離"],
                  ["avg_climb_in_thermals_ms", "平均上昇率"],
                  ["avg_ground_speed_kmh", "平均速度"],
                ] as [PilotSortKey, string][]
              ).map(([key, label]) => (
                <th
                  key={key}
                  onClick={() => togglePilotSort(key)}
                  style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
                >
                  {label}{sortIcon(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedPilots.map((p) => (
              <tr key={p.pilot}>
                <td><strong>{p.pilot}</strong></td>
                <td>{p.flight_count}</td>
                <td>{p.total_hours.toFixed(1)} h</td>
                <td>{p.total_distance_km.toFixed(0)} km</td>
                <td>{fmtNum(p.avg_climb_in_thermals_ms, 2, "m/s")}</td>
                <td>{fmtNum(p.avg_ground_speed_kmh, 1, "km/h")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 月別トレンド */}
      <div className="card">
        <h2>月別トレンド</h2>
        <div className="filters">
          <select value={selectedPilot} onChange={(e) => setSelectedPilot(e.target.value)}>
            <option value="">全選手</option>
            {pilots.map((p) => <option key={p.pilot} value={p.pilot}>{p.pilot}</option>)}
          </select>
        </div>
        {monthData.length === 0 ? (
          <div className="empty">フライトがありません</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={monthData} margin={{ top: 10, right: 60, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="ms" label={{ value: "m/s", angle: -90, position: "insideLeft", offset: 10, fontSize: 11 }} />
              <YAxis yAxisId="c" orientation="right" label={{ value: "℃", angle: 90, position: "insideRight", offset: 10, fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="ms" dataKey="avg_climb_ms" name="平均上昇率 (m/s)" fill="#1a7f37" />
              <Line yAxisId="ms" type="monotone" dataKey="avg_wind_ms" name="平均風速 (m/s)" stroke="#1f6feb" dot={false} connectNulls />
              <Line yAxisId="c" type="monotone" dataKey="avg_temp_c" name="平均気温 (℃)" stroke="#cf222e" dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 季節別サマリー */}
      <div className="card">
        <h2>季節別サマリー</h2>
        <p style={{ fontSize: "0.82rem", color: "#57606a", margin: "0 0 0.5rem" }}>
          気象暦に基づき 春 (3-5月) / 夏 (6-8月) / 秋 (9-11月) / 冬 (12-2月) で集計。
        </p>
        {seasons.length === 0 ? (
          <div className="empty">フライトがありません</div>
        ) : (
          <>
            <table style={{ marginBottom: "1rem" }}>
              <thead>
                <tr>
                  <th>季節</th>
                  <th>フライト</th>
                  <th>総時間</th>
                  <th>総距離</th>
                  <th>平均上昇率</th>
                  <th>平均風速</th>
                  <th>平均最高高度</th>
                  <th>平均気温</th>
                </tr>
              </thead>
              <tbody>
                {seasons.map((s) => (
                  <tr key={s.season_key}>
                    <td><strong>{s.season}</strong></td>
                    <td>{s.flight_count}</td>
                    <td>{s.total_hours.toFixed(1)} h</td>
                    <td>{s.total_distance_km.toFixed(0)} km</td>
                    <td>{fmtNum(s.avg_climb_in_thermals_ms, 2, "m/s")}</td>
                    <td>{fmtNum(s.avg_wind_speed_kmh != null ? s.avg_wind_speed_kmh / 3.6 : null, 1, "m/s")}</td>
                    <td>{fmtNum(s.avg_max_altitude_m, 0, "m")}</td>
                    <td>{fmtNum(s.avg_temp_c, 1, "°C")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart
                data={seasons.map((s) => ({
                  label: s.season,
                  "平均上昇率(m/s)": s.avg_climb_in_thermals_ms ?? 0,
                  "平均風速(m/s)": s.avg_wind_speed_kmh != null ? Number((s.avg_wind_speed_kmh / 3.6).toFixed(2)) : null,
                  "平均最高高度(m)": s.avg_max_altitude_m ?? 0,
                }))}
                margin={{ top: 10, right: 60, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis yAxisId="ms" label={{ value: "m/s", angle: -90, position: "insideLeft", offset: 10, fontSize: 11 }} />
                <YAxis yAxisId="m" orientation="right" label={{ value: "m", angle: 90, position: "insideRight", offset: 10, fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="ms" dataKey="平均上昇率(m/s)" fill="#1a7f37" />
                <Line yAxisId="ms" type="monotone" dataKey="平均風速(m/s)" stroke="#1f6feb" dot={false} connectNulls />
                <Line yAxisId="m" type="monotone" dataKey="平均最高高度(m)" stroke="#9a6700" dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </>
        )}
      </div>

      {/* 時間帯別サーマル強度 */}
      <div className="card">
        <h2>時間帯別サーマル強度 (現地時刻)</h2>
        <p style={{ fontSize: "0.82rem", color: "#57606a", margin: "0 0 0.5rem" }}>
          検出されたサーマルを開始時刻（経度から推定した現地時刻）でバケット化したもの。
        </p>
        <div className="filters">
          <select value={selectedSeason} onChange={(e) => setSelectedSeason(e.target.value)}>
            <option value="">全季節</option>
            <option value="spring">春 (3-5月)</option>
            <option value="summer">夏 (6-8月)</option>
            <option value="autumn">秋 (9-11月)</option>
            <option value="winter">冬 (12-2月)</option>
          </select>
          {selectedPilot && <span style={{ alignSelf: "center", fontSize: "0.85rem" }}>選手: <strong>{selectedPilot}</strong></span>}
        </div>
        {timeOfDay.length === 0 ? (
          <div className="empty">該当するサーマルデータがありません</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={hourData} margin={{ top: 10, right: 60, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="ms" label={{ value: "m/s", angle: -90, position: "insideLeft", offset: 10, fontSize: 11 }} />
              <YAxis yAxisId="m" orientation="right" label={{ value: "m", angle: 90, position: "insideRight", offset: 10, fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="ms" dataKey="平均上昇率(m/s)" fill="#1a7f37" />
              <Line yAxisId="m" type="monotone" dataKey="平均獲得高度(m)" stroke="#9a6700" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 気象条件別 */}
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
            <table style={{ marginBottom: "1rem" }}>
              <thead>
                <tr>
                  <th>風速帯</th>
                  <th>フライト数</th>
                  <th>平均上昇率</th>
                  <th>平均獲得高度</th>
                  <th>平均速度</th>
                </tr>
              </thead>
              <tbody>
                {weather.map((w) => (
                  <tr key={w.label}>
                    <td><strong>{w.label}</strong></td>
                    <td>{w.flight_count}</td>
                    <td>{fmtNum(w.avg_climb_rate_ms, 2, "m/s")}</td>
                    <td>{fmtNum(w.avg_altitude_gain_m, 0, "m")}</td>
                    <td>{fmtNum(w.avg_ground_speed_kmh, 1, "km/h")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart
                data={weather.map((w) => ({
                  label: w.label,
                  "平均上昇率(m/s)": w.avg_climb_rate_ms ?? 0,
                  "平均獲得高度(m)": w.avg_altitude_gain_m ?? 0,
                }))}
                margin={{ top: 10, right: 60, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="ms" label={{ value: "m/s", angle: -90, position: "insideLeft", offset: 10, fontSize: 11 }} />
                <YAxis yAxisId="m" orientation="right" label={{ value: "m", angle: 90, position: "insideRight", offset: 10, fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="ms" dataKey="平均上昇率(m/s)" fill="#1a7f37" />
                <Line yAxisId="m" type="monotone" dataKey="平均獲得高度(m)" stroke="#9a6700" dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </>
        )}
      </div>
    </div>
  );
}
