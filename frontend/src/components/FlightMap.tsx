import { useMemo } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from "react-leaflet";
import type { Fix, Thermal } from "../types";

interface Props {
  fixes: Fix[];
  thermals: Thermal[];
  colorBy?: "altitude" | "climb" | "speed";
  currentIdx?: number | null;  // when set, show a position marker + highlight active thermal
}

function colorScale(value: number, min: number, max: number): string {
  if (max === min) return "#1f6feb";
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  // blue (low) -> yellow -> red (high)
  const r = Math.round(t < 0.5 ? 30 + t * 2 * 225 : 255);
  const g = Math.round(t < 0.5 ? 100 + t * 2 * 155 : 255 - (t - 0.5) * 2 * 255);
  const b = Math.round(t < 0.5 ? 255 - t * 2 * 200 : 50);
  return `rgb(${r},${g},${b})`;
}

export function FlightMap({ fixes, thermals, colorBy = "altitude", currentIdx = null }: Props) {
  const center = useMemo<[number, number]>(() => {
    if (fixes.length === 0) return [35.681, 139.767];
    const lat = fixes.reduce((s, f) => s + f.latitude, 0) / fixes.length;
    const lon = fixes.reduce((s, f) => s + f.longitude, 0) / fixes.length;
    return [lat, lon];
  }, [fixes]);

  const segments = useMemo(() => {
    if (fixes.length < 2) return [];
    const values = fixes.map((f) =>
      colorBy === "altitude"
        ? f.altitude_m
        : colorBy === "climb"
          ? f.climb_rate_ms ?? 0
          : f.ground_speed_kmh ?? 0
    );
    const min = Math.min(...values);
    const max = Math.max(...values);
    const segs: { positions: [number, number][]; color: string }[] = [];
    for (let i = 1; i < fixes.length; i++) {
      const v = (values[i - 1] + values[i]) / 2;
      segs.push({
        positions: [
          [fixes[i - 1].latitude, fixes[i - 1].longitude],
          [fixes[i].latitude, fixes[i].longitude],
        ],
        color: colorScale(v, min, max),
      });
    }
    return segs;
  }, [fixes, colorBy]);

  if (fixes.length === 0) {
    return <div className="empty">フライトデータがありません</div>;
  }

  return (
    <div className="map-container">
      <MapContainer center={center} zoom={12} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {segments.map((s, i) => (
          <Polyline key={i} positions={s.positions} pathOptions={{ color: s.color, weight: 3 }} />
        ))}
        {thermals.map((t, i) => {
          const active =
            currentIdx != null && fixes[currentIdx]
              ? new Date(t.start_time).getTime() <= new Date(fixes[currentIdx].timestamp).getTime() &&
                new Date(t.end_time).getTime() >= new Date(fixes[currentIdx].timestamp).getTime()
              : false;
          return (
            <CircleMarker
              key={i}
              center={[t.center_lat, t.center_lon]}
              radius={Math.min(15, 4 + t.avg_climb_rate_ms * 3)}
              pathOptions={{
                color: active ? "#fbbc04" : "#cf222e",
                fillColor: active ? "#ffd966" : "#ffcccb",
                fillOpacity: active ? 0.9 : 0.7,
                weight: active ? 3 : 1,
              }}
            >
              <Tooltip>
                <div>
                  <strong>サーマル #{i + 1}{active && " ⟵ 現在地点"}</strong>
                  <br />
                  上昇率: {t.avg_climb_rate_ms.toFixed(2)} m/s
                  <br />
                  高度獲得: {t.altitude_gain_m.toFixed(0)} m
                  <br />
                  時間: {(t.duration_s / 60).toFixed(1)} 分
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
        {currentIdx != null && fixes[currentIdx] && (
          <CircleMarker
            center={[fixes[currentIdx].latitude, fixes[currentIdx].longitude]}
            radius={9}
            pathOptions={{ color: "#0d6efd", fillColor: "#1f6feb", fillOpacity: 1, weight: 3 }}
          >
            <Tooltip permanent direction="top" offset={[0, -8]}>
              {fixes[currentIdx].timestamp.slice(11, 19)} —{" "}
              {fixes[currentIdx].altitude_m}m
            </Tooltip>
          </CircleMarker>
        )}
      </MapContainer>
    </div>
  );
}
