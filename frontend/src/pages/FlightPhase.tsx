import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { AltitudeChart } from "../components/Charts";
import type { FlightDetail, FlightPhaseAnalysis } from "../types";
import { computeFlightPhaseAnalysis } from "../utils/phaseAnalysis";
import { fmtDate, fmtNum } from "../utils/format";

export default function FlightPhasePage() {
  const { id } = useParams();
  const [flight, setFlight] = useState<FlightDetail | null>(null);
  const [phase, setPhase] = useState<FlightPhaseAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    api
      .getFlight(Number(id))
      .then((f) => {
        setFlight(f);
        setPhase(computeFlightPhaseAnalysis(f.id, f.fixes));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="empty">読み込み中...</div>;
  if (error) return <div className="empty">エラー: {error}</div>;
  if (!flight || !phase) return <div className="empty">データが見つかりません</div>;

  const phaseColors = {
    initial: "#ff6b6b",
    mid: "#4ecdc4",
    late: "#ffe66d",
  };

  return (
    <div>
      <h1>
        ウインチ曳航分析 — {flight.pilot} ({fmtDate(flight.flight_date)})
      </h1>

      <div className="card">
        <h2>高度プロファイル</h2>
        <p style={{ fontSize: "0.85rem", color: "#57606a", margin: "0 0 1rem" }}>
          フェーズ区分: <span style={{ color: phaseColors.initial }}>■初期</span>{" "}
          <span style={{ color: phaseColors.mid }}>■中期</span>{" "}
          <span style={{ color: phaseColors.late }}>■後期</span>
        </p>
        <AltitudeChart fixes={flight.fixes} />
      </div>

      <div className="card">
        <h2>フェーズ別メトリクス</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "1rem" }}>
          {phase.initial && (
            <div
              style={{
                padding: "1rem",
                border: `2px solid ${phaseColors.initial}`,
                borderRadius: "8px",
              }}
            >
              <h3 style={{ margin: "0 0 0.5rem", color: phaseColors.initial }}>初期上昇</h3>
              <dl style={{ margin: 0 }}>
                <dt>所要時間</dt>
                <dd>{phase.initial.duration_s.toFixed(1)}秒</dd>
                <dt>平均速度</dt>
                <dd>{fmtNum(phase.initial.avg_speed_kmh, 1, "km/h")}</dd>
                <dt>平均上昇率</dt>
                <dd>{fmtNum(phase.initial.avg_climb_rate_ms, 2, "m/s")}</dd>
                <dt>獲得高度</dt>
                <dd>{phase.initial.altitude_gained_m ? fmtNum(phase.initial.altitude_gained_m, 0, "m") : "—"}</dd>
                <dt>最高速度</dt>
                <dd>{phase.initial.max_speed_kmh ? fmtNum(phase.initial.max_speed_kmh, 1, "km/h") : "—"}</dd>
              </dl>
            </div>
          )}

          {phase.mid && (
            <div
              style={{
                padding: "1rem",
                border: `2px solid ${phaseColors.mid}`,
                borderRadius: "8px",
              }}
            >
              <h3 style={{ margin: "0 0 0.5rem", color: phaseColors.mid }}>中期上昇</h3>
              <dl style={{ margin: 0 }}>
                <dt>所要時間</dt>
                <dd>{phase.mid.duration_s.toFixed(1)}秒</dd>
                <dt>平均速度</dt>
                <dd>{fmtNum(phase.mid.avg_speed_kmh, 1, "km/h")}</dd>
                <dt>平均上昇率</dt>
                <dd>{fmtNum(phase.mid.avg_climb_rate_ms, 2, "m/s")}</dd>
                <dt>獲得高度</dt>
                <dd>{phase.mid.altitude_gained_m ? fmtNum(phase.mid.altitude_gained_m, 0, "m") : "—"}</dd>
                <dt>最高速度</dt>
                <dd>{phase.mid.max_speed_kmh ? fmtNum(phase.mid.max_speed_kmh, 1, "km/h") : "—"}</dd>
              </dl>
            </div>
          )}

          {phase.late && (
            <div
              style={{
                padding: "1rem",
                border: `2px solid ${phaseColors.late}`,
                borderRadius: "8px",
              }}
            >
              <h3 style={{ margin: "0 0 0.5rem", color: phaseColors.late }}>上昇後期</h3>
              <dl style={{ margin: 0 }}>
                <dt>所要時間</dt>
                <dd>{phase.late.duration_s.toFixed(1)}秒</dd>
                <dt>平均速度</dt>
                <dd>{fmtNum(phase.late.avg_speed_kmh, 1, "km/h")}</dd>
                <dt>平均上昇率</dt>
                <dd>{fmtNum(phase.late.avg_climb_rate_ms, 2, "m/s")}</dd>
                <dt>獲得高度</dt>
                <dd>{phase.late.altitude_gained_m ? fmtNum(phase.late.altitude_gained_m, 0, "m") : "—"}</dd>
                <dt>リリース時速度</dt>
                <dd>{phase.late.max_speed_kmh ? fmtNum(phase.late.max_speed_kmh, 1, "km/h") : "—"}</dd>
              </dl>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2>フェーズ境界情報</h2>
        <table>
          <tbody>
            <tr>
              <td>初期フェーズ終了 (80m)</td>
              <td>{phase.tow_phase_end_fix_seq ? `Fix #${phase.tow_phase_end_fix_seq}` : "検出されなし"}</td>
            </tr>
            <tr>
              <td>中期フェーズ終了 (上昇率低下)</td>
              <td>{phase.mid_phase_end_fix_seq ? `Fix #${phase.mid_phase_end_fix_seq}` : "検出されなし"}</td>
            </tr>
            <tr>
              <td>リリース高度</td>
              <td>{phase.release_altitude_m ? fmtNum(phase.release_altitude_m, 0, "m") : "—"}</td>
            </tr>
            <tr>
              <td>リリース位置</td>
              <td>{phase.release_fix_seq ? `Fix #${phase.release_fix_seq}` : "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
