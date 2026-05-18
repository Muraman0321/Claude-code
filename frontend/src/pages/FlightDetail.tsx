import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { AltitudeChart, ClimbHistogram, ClimbRateChart, SpeedChart } from "../components/Charts";
import { FlightMap } from "../components/FlightMap";
import type { FlightDetail } from "../types";
import { fmtDate, fmtDuration, fmtNum } from "../utils/format";

const COMPASS = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東",
  "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"];

function windDirJp(deg: number | null): string {
  if (deg == null) return "—";
  const idx = Math.round(((deg % 360) / 22.5)) % 16;
  return `${COMPASS[idx]} (${deg.toFixed(0)}°)`;
}

export default function FlightDetailPage() {
  const { id } = useParams();
  const [flight, setFlight] = useState<FlightDetail | null>(null);
  const [colorBy, setColorBy] = useState<"altitude" | "climb" | "speed">("altitude");
  const [wxBusy, setWxBusy] = useState(false);
  const [wxError, setWxError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.getFlight(Number(id)).then(setFlight).catch(console.error);
  }, [id]);

  async function refreshWeather() {
    if (!flight) return;
    setWxBusy(true);
    setWxError(null);
    try {
      const updated = await api.refreshWeather(flight.id);
      setFlight({ ...flight, ...updated });
    } catch (e) {
      setWxError(e instanceof Error ? e.message : String(e));
    } finally {
      setWxBusy(false);
    }
  }

  if (!flight) return <div className="empty">読み込み中...</div>;

  return (
    <div>
      <h1>
        {flight.pilot} — {flight.aircraft} ({fmtDate(flight.flight_date)})
      </h1>
      {flight.remarks && <p>備考: <code>{flight.remarks}</code></p>}

      <div className="card">
        <h2>サマリー</h2>
        <div className="metric-grid">
          <div className="metric">
            <div className="metric-label">飛行時間</div>
            <div className="metric-value">{fmtDuration(flight.duration_s)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">飛行距離</div>
            <div className="metric-value">{fmtNum(flight.total_distance_km, 1, "km")}</div>
          </div>
          <div className="metric">
            <div className="metric-label">直線距離</div>
            <div className="metric-value">{fmtNum(flight.straight_distance_km, 1, "km")}</div>
          </div>
          <div className="metric">
            <div className="metric-label">最高高度</div>
            <div className="metric-value">{fmtNum(flight.max_altitude_m, 0, "m")}</div>
          </div>
          <div className="metric">
            <div className="metric-label">獲得高度</div>
            <div className="metric-value">{fmtNum(flight.altitude_gain_m, 0, "m")}</div>
          </div>
          <div className="metric">
            <div className="metric-label">最大上昇率</div>
            <div className="metric-value">{fmtNum(flight.max_climb_rate_ms, 2, "m/s")}</div>
          </div>
          <div className="metric">
            <div className="metric-label">サーマル平均</div>
            <div className="metric-value">{fmtNum(flight.avg_climb_in_thermals_ms, 2, "m/s")}</div>
          </div>
          <div className="metric">
            <div className="metric-label">最大対地速度</div>
            <div className="metric-value">{fmtNum(flight.max_ground_speed_kmh, 0, "km/h")}</div>
          </div>
          <div className="metric">
            <div className="metric-label">平均対地速度</div>
            <div className="metric-value">{fmtNum(flight.avg_ground_speed_kmh, 0, "km/h")}</div>
          </div>
          <div className="metric">
            <div className="metric-label">最大L/D</div>
            <div className="metric-value">{fmtNum(flight.best_glide_ratio, 1)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">サーマル数</div>
            <div className="metric-value">{flight.thermal_count ?? 0}</div>
          </div>
          <div className="metric">
            <div className="metric-label">サーマル時間</div>
            <div className="metric-value">{fmtDuration(flight.thermal_time_s)}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>
          気象 (離陸地点・離陸時刻)
          <button
            className="ghost"
            style={{ marginLeft: "1rem", fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
            onClick={refreshWeather}
            disabled={wxBusy}
          >
            {wxBusy ? "取得中..." : flight.weather_source ? "再取得" : "取得"}
          </button>
        </h2>
        {wxError && <div style={{ color: "#cf222e", marginBottom: "0.5rem" }}>{wxError}</div>}
        {flight.weather_source ? (
          <div className="metric-grid">
            <div className="metric">
              <div className="metric-label">気温</div>
              <div className="metric-value">{fmtNum(flight.weather_temp_c, 1, "°C")}</div>
            </div>
            <div className="metric">
              <div className="metric-label">風速 (10m)</div>
              <div className="metric-value">{fmtNum(flight.weather_wind_speed_kmh, 1, "km/h")}</div>
            </div>
            <div className="metric">
              <div className="metric-label">風向</div>
              <div className="metric-value" style={{ fontSize: "0.95rem" }}>
                {windDirJp(flight.weather_wind_dir_deg)}
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">気圧</div>
              <div className="metric-value">{fmtNum(flight.weather_pressure_hpa, 0, "hPa")}</div>
            </div>
            <div className="metric">
              <div className="metric-label">雲量</div>
              <div className="metric-value">{fmtNum(flight.weather_cloud_cover_pct, 0, "%")}</div>
            </div>
            <div className="metric">
              <div className="metric-label">湿度</div>
              <div className="metric-value">{fmtNum(flight.weather_humidity_pct, 0, "%")}</div>
            </div>
          </div>
        ) : (
          <div className="empty">
            気象データなし — 「取得」ボタンで Open-Meteo から取得します
          </div>
        )}
        <div style={{ fontSize: "0.75rem", color: "#57606a", marginTop: "0.4rem" }}>
          source: {flight.weather_source ?? "—"}
        </div>
      </div>

      <div className="card">
        <h2>フライトマップ</h2>
        <div style={{ marginBottom: "0.5rem" }}>
          色分け:{" "}
          <select value={colorBy} onChange={(e) => setColorBy(e.target.value as "altitude" | "climb" | "speed")}>
            <option value="altitude">高度</option>
            <option value="climb">上昇率</option>
            <option value="speed">対地速度</option>
          </select>
        </div>
        <FlightMap fixes={flight.fixes} thermals={flight.thermals} colorBy={colorBy} />
      </div>

      <div className="row">
        <div className="card">
          <h2>高度プロファイル</h2>
          <AltitudeChart fixes={flight.fixes} />
        </div>
        <div className="card">
          <h2>上昇率推移</h2>
          <ClimbRateChart fixes={flight.fixes} />
        </div>
      </div>

      <div className="row">
        <div className="card">
          <h2>対地速度推移</h2>
          <SpeedChart fixes={flight.fixes} />
        </div>
        <div className="card">
          <h2>上昇率ヒストグラム</h2>
          <ClimbHistogram fixes={flight.fixes} />
        </div>
      </div>

      <div className="card">
        <h2>検出サーマル ({flight.thermals.length})</h2>
        {flight.thermals.length === 0 ? (
          <div className="empty">サーマルは検出されませんでした</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>開始</th>
                <th>時間</th>
                <th>平均上昇率</th>
                <th>高度獲得</th>
                <th>位置</th>
              </tr>
            </thead>
            <tbody>
              {flight.thermals.map((t, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{t.start_time.slice(11, 19)}</td>
                  <td>{(t.duration_s / 60).toFixed(1)} 分</td>
                  <td>{t.avg_climb_rate_ms.toFixed(2)} m/s</td>
                  <td>{t.altitude_gain_m.toFixed(0)} m</td>
                  <td>{t.center_lat.toFixed(4)}, {t.center_lon.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
