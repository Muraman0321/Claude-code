import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { CompareBarChart } from "../components/Charts";
import { FlightMap } from "../components/FlightMap";
import type { FlightDetail, FlightSummary } from "../types";
import { fmtDate, fmtDuration, fmtNum } from "../utils/format";

export default function Compare() {
  const [flights, setFlights] = useState<FlightSummary[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [details, setDetails] = useState<FlightDetail[]>([]);

  useEffect(() => {
    api.listFlights().then(setFlights).catch(console.error);
  }, []);

  useEffect(() => {
    Promise.all(selected.map((id) => api.getFlight(id))).then(setDetails).catch(console.error);
  }, [selected]);

  function toggle(id: number) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-4)
    );
  }

  const combinedFixes = useMemo(() => details.flatMap((d) => d.fixes), [details]);
  const combinedThermals = useMemo(() => details.flatMap((d) => d.thermals), [details]);

  const chartData = details.map((d) => ({
    label: `${d.pilot} / ${d.aircraft}`,
    "平均上昇率(m/s)": d.avg_climb_in_thermals_ms ?? 0,
    "平均速度(km/h)": d.avg_ground_speed_kmh ?? 0,
    "最大L/D": d.best_glide_ratio ?? 0,
  }));

  return (
    <div>
      <h1>フライト比較</h1>

      <div className="card">
        <h2>フライト選択 (最大4件)</h2>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>日付</th>
              <th>選手</th>
              <th>機体</th>
              <th>距離</th>
              <th>平均上昇率</th>
            </tr>
          </thead>
          <tbody>
            {flights.map((f) => (
              <tr key={f.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.includes(f.id)}
                    onChange={() => toggle(f.id)}
                  />
                </td>
                <td>{fmtDate(f.flight_date)}</td>
                <td>{f.pilot}</td>
                <td>{f.aircraft}</td>
                <td>{fmtNum(f.total_distance_km, 1, "km")}</td>
                <td>{fmtNum(f.avg_climb_in_thermals_ms, 2, "m/s")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {details.length > 0 && (
        <>
          <div className="card">
            <h2>比較サマリー</h2>
            <table>
              <thead>
                <tr>
                  <th>選手 / 機体</th>
                  <th>日付</th>
                  <th>時間</th>
                  <th>距離</th>
                  <th>最高高度</th>
                  <th>平均上昇率</th>
                  <th>平均速度</th>
                  <th>最大L/D</th>
                  <th>サーマル数</th>
                </tr>
              </thead>
              <tbody>
                {details.map((d) => (
                  <tr key={d.id}>
                    <td><strong>{d.pilot}</strong> / {d.aircraft}</td>
                    <td>{fmtDate(d.flight_date)}</td>
                    <td>{fmtDuration(d.duration_s)}</td>
                    <td>{fmtNum(d.total_distance_km, 1, "km")}</td>
                    <td>{fmtNum(d.max_altitude_m, 0, "m")}</td>
                    <td>{fmtNum(d.avg_climb_in_thermals_ms, 2, "m/s")}</td>
                    <td>{fmtNum(d.avg_ground_speed_kmh, 0, "km/h")}</td>
                    <td>{fmtNum(d.best_glide_ratio, 1)}</td>
                    <td>{d.thermal_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>指標比較</h2>
            <CompareBarChart
              data={chartData}
              metrics={[
                { key: "平均上昇率(m/s)", label: "平均上昇率 (m/s)", color: "#1a7f37" },
                { key: "最大L/D", label: "最大L/D", color: "#9a6700" },
              ]}
            />
          </div>

          <div className="card">
            <h2>フライト軌跡重ね合わせ</h2>
            <FlightMap fixes={combinedFixes} thermals={combinedThermals} colorBy="altitude" />
          </div>
        </>
      )}
    </div>
  );
}
