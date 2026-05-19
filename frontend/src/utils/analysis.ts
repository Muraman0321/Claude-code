import { bearingDeg, haversineM } from "./geo";
import type { IgcFix } from "./igcParser";

export interface FixMetrics {
  timestamp: string; // ISO 8601 UTC
  latitude: number;
  longitude: number;
  altitude: number;          // display altitude (GPS preferred)
  pressure_altitude: number;
  ground_speed_kmh: number;  // smoothed
  climb_rate_ms: number;     // smoothed
  bearing_deg: number;
}

export interface Thermal {
  start_index: number;
  end_index: number;
  start_time: string;
  end_time: string;
  duration_s: number;
  altitude_gain_m: number;
  avg_climb_rate_ms: number;
  center_lat: number;
  center_lon: number;
  start_lat: number;
  start_lon: number;
  end_lat: number;
  end_lon: number;
}

export interface FlightSummary {
  duration_s: number;
  total_distance_km: number;
  straight_distance_km: number;
  max_altitude_m: number;
  min_altitude_m: number;
  altitude_gain_m: number;
  max_climb_rate_ms: number;
  avg_climb_rate_in_thermals_ms: number;
  avg_ground_speed_kmh: number;
  max_ground_speed_kmh: number;
  best_glide_ratio: number;
  thermal_count: number;
  thermal_time_s: number;
  cruise_time_s: number;
}

const MAX_REAL_CLIMB_MS = 15.0;
const MAX_REAL_SPEED_KMH = 400.0;

function altitudeForClimb(f: IgcFix): number {
  return f.pressureAltitude > 0 ? f.pressureAltitude : f.gpsAltitude;
}

function altitudeForDisplay(f: IgcFix): number {
  return f.gpsAltitude > 0 ? f.gpsAltitude : f.pressureAltitude;
}

function smooth(values: number[], window: number): number[] {
  if (window <= 1 || values.length === 0) return values.slice();
  const half = Math.floor(window / 2);
  const out: number[] = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length, i + half + 1);
    let sum = 0;
    for (let j = lo; j < hi; j++) sum += values[j];
    out[i] = sum / (hi - lo);
  }
  return out;
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function computeFixMetrics(fixes: IgcFix[]): FixMetrics[] {
  if (fixes.length < 2) return [];

  const rawClimb: number[] = [0.0];
  const rawSpeed: number[] = [0.0];
  const bearings: number[] = [0.0];

  for (let i = 1; i < fixes.length; i++) {
    const prev = fixes[i - 1];
    const curr = fixes[i];
    const dt = (curr.timestampMs - prev.timestampMs) / 1000;
    if (dt <= 0) {
      rawClimb.push(0.0);
      rawSpeed.push(0.0);
      bearings.push(bearings[bearings.length - 1]);
      continue;
    }

    const distM = haversineM(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
    let speedKmh = (distM / dt) * 3.6;
    if (speedKmh > MAX_REAL_SPEED_KMH) speedKmh = 0.0;

    const dalt = altitudeForClimb(curr) - altitudeForClimb(prev);
    let climb = dalt / dt;
    if (Math.abs(climb) > MAX_REAL_CLIMB_MS) climb = 0.0;

    rawClimb.push(climb);
    rawSpeed.push(speedKmh);
    bearings.push(bearingDeg(prev.latitude, prev.longitude, curr.latitude, curr.longitude));
  }

  const climbS = smooth(rawClimb, 7);
  const speedS = smooth(rawSpeed, 5);

  const out: FixMetrics[] = new Array(fixes.length);
  for (let i = 0; i < fixes.length; i++) {
    out[i] = {
      timestamp: fixes[i].timestampIso,
      latitude: fixes[i].latitude,
      longitude: fixes[i].longitude,
      altitude: altitudeForDisplay(fixes[i]),
      pressure_altitude: fixes[i].pressureAltitude,
      ground_speed_kmh: round(speedS[i], 2),
      climb_rate_ms: round(climbS[i], 2),
      bearing_deg: round(bearings[i], 1),
    };
  }
  return out;
}

function towReleaseIndex(fixes: IgcFix[], metrics: FixMetrics[], minGainM = 50.0): number {
  if (fixes.length === 0 || metrics.length === 0) return 0;

  let moveStart = 0;
  for (let i = 0; i < metrics.length; i++) {
    if (metrics[i].ground_speed_kmh > 15) {
      moveStart = i;
      break;
    }
  }
  const takeoffAlt = altitudeForDisplay(fixes[moveStart]);
  let peakAlt = takeoffAlt;

  for (let i = moveStart; i < metrics.length; i++) {
    const alt = altitudeForDisplay(fixes[i]);
    if (alt > peakAlt) peakAlt = alt;
    if (peakAlt - takeoffAlt >= minGainM && metrics[i].climb_rate_ms < 0) return i;
  }

  let inClimb = false;
  for (let i = moveStart; i < metrics.length; i++) {
    if (metrics[i].climb_rate_ms > 0.1) inClimb = true;
    else if (inClimb) return i;
  }

  return moveStart;
}

export function detectThermals(
  fixes: IgcFix[],
  metrics: FixMetrics[],
  minDurationS = 20.0,
  minAvgClimbMs = 0.3,
): Thermal[] {
  if (fixes.length === 0 || metrics.length === 0) return [];

  const towEnd = towReleaseIndex(fixes, metrics);

  // Collect raw climb segments
  const raw: Thermal[] = [];
  let start: number | null = null;
  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i];
    if (m.climb_rate_ms > 0.1) {
      if (start === null) start = i;
    } else {
      if (start !== null && i - start > 2) {
        if (start >= towEnd) {
          const segLen = i - start;
          const duration = (fixes[i - 1].timestampMs - fixes[start].timestampMs) / 1000;
          if (duration >= minDurationS) {
            let climbSum = 0;
            let latSum = 0;
            let lonSum = 0;
            for (let j = start; j < i; j++) {
              climbSum += metrics[j].climb_rate_ms;
              latSum += fixes[j].latitude;
              lonSum += fixes[j].longitude;
            }
            const avgClimb = climbSum / segLen;
            const gain = fixes[i - 1].gpsAltitude - fixes[start].gpsAltitude;
            if (avgClimb >= minAvgClimbMs && gain > 5) {
              raw.push({
                start_index: start,
                end_index: i - 1,
                start_time: fixes[start].timestampIso,
                end_time: fixes[i - 1].timestampIso,
                duration_s: duration,
                altitude_gain_m: gain,
                avg_climb_rate_ms: round(avgClimb, 2),
                center_lat: latSum / segLen,
                center_lon: lonSum / segLen,
                start_lat: fixes[start].latitude,
                start_lon: fixes[start].longitude,
                end_lat: fixes[i - 1].latitude,
                end_lon: fixes[i - 1].longitude,
              });
            }
          }
        }
      }
      start = null;
    }
  }

  // Merge consecutive thermals whose gap is ≤ 30 s into a single thermal
  const GAP_THRESHOLD_S = 30;
  const merged: Thermal[] = [];
  for (const t of raw) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const gapS = (fixes[t.start_index].timestampMs - fixes[prev.end_index].timestampMs) / 1000;
      if (gapS <= GAP_THRESHOLD_S) {
        const s = prev.start_index;
        const e = t.end_index;
        const segLen = e - s + 1;
        let climbSum = 0, latSum = 0, lonSum = 0;
        for (let j = s; j <= e; j++) {
          climbSum += metrics[j].climb_rate_ms;
          latSum += fixes[j].latitude;
          lonSum += fixes[j].longitude;
        }
        merged[merged.length - 1] = {
          start_index: s,
          end_index: e,
          start_time: prev.start_time,
          end_time: t.end_time,
          duration_s: (fixes[e].timestampMs - fixes[s].timestampMs) / 1000,
          altitude_gain_m: fixes[e].gpsAltitude - fixes[s].gpsAltitude,
          avg_climb_rate_ms: round(climbSum / segLen, 2),
          center_lat: latSum / segLen,
          center_lon: lonSum / segLen,
          start_lat: prev.start_lat,
          start_lon: prev.start_lon,
          end_lat: t.end_lat,
          end_lon: t.end_lon,
        };
        continue;
      }
    }
    merged.push(t);
  }
  return merged;
}

function bestGlideRatio(fixes: IgcFix[], metrics: FixMetrics[]): number {
  let best = 0.0;
  if (fixes.length < 10) return best;
  const n = fixes.length;
  for (let i = 0; i < n - 30; i++) {
    let end = i;
    while (
      end < n - 1 &&
      (fixes[end].timestampMs - fixes[i].timestampMs) / 1000 < 60
    ) {
      end++;
    }
    const win = metrics.slice(i, end + 1);
    if (win.length === 0) continue;
    let anyClimb = false;
    for (const m of win) {
      if (m.climb_rate_ms > 0) {
        anyClimb = true;
        break;
      }
    }
    if (anyClimb) continue;
    let distM = 0.0;
    for (let j = i + 1; j <= end; j++) {
      distM += haversineM(
        fixes[j - 1].latitude,
        fixes[j - 1].longitude,
        fixes[j].latitude,
        fixes[j].longitude,
      );
    }
    const drop = fixes[i].gpsAltitude - fixes[end].gpsAltitude;
    if (drop > 5) {
      const ratio = distM / drop;
      if (ratio > best && ratio < 100) best = ratio;
    }
  }
  return round(best, 2);
}

export function computeSummary(
  fixes: IgcFix[],
  metrics: FixMetrics[],
  thermals: Thermal[],
): FlightSummary {
  if (fixes.length === 0) {
    return {
      duration_s: 0,
      total_distance_km: 0,
      straight_distance_km: 0,
      max_altitude_m: 0,
      min_altitude_m: 0,
      altitude_gain_m: 0,
      max_climb_rate_ms: 0,
      avg_climb_rate_in_thermals_ms: 0,
      avg_ground_speed_kmh: 0,
      max_ground_speed_kmh: 0,
      best_glide_ratio: 0,
      thermal_count: 0,
      thermal_time_s: 0,
      cruise_time_s: 0,
    };
  }

  const duration = (fixes[fixes.length - 1].timestampMs - fixes[0].timestampMs) / 1000;
  let totalDistM = 0.0;
  let altitudeGain = 0.0;
  for (let i = 1; i < fixes.length; i++) {
    const dt = (fixes[i].timestampMs - fixes[i - 1].timestampMs) / 1000;
    const seg = haversineM(
      fixes[i - 1].latitude,
      fixes[i - 1].longitude,
      fixes[i].latitude,
      fixes[i].longitude,
    );
    if (dt > 0 && (seg / dt) * 3.6 <= MAX_REAL_SPEED_KMH) {
      totalDistM += seg;
    }
    if (dt > 0 && metrics[i].climb_rate_ms > 0) {
      altitudeGain += metrics[i].climb_rate_ms * dt;
    }
  }

  const straightDistM = haversineM(
    fixes[0].latitude,
    fixes[0].longitude,
    fixes[fixes.length - 1].latitude,
    fixes[fixes.length - 1].longitude,
  );

  const altitudes: number[] = [];
  for (const f of fixes) {
    const a = altitudeForDisplay(f);
    if (a > 0) altitudes.push(a);
  }
  if (altitudes.length === 0) altitudes.push(0);

  let speedSum = 0,
    speedMax = -Infinity;
  let climbMax = -Infinity;
  for (const m of metrics) {
    speedSum += m.ground_speed_kmh;
    if (m.ground_speed_kmh > speedMax) speedMax = m.ground_speed_kmh;
    if (m.climb_rate_ms > climbMax) climbMax = m.climb_rate_ms;
  }
  const speedAvg = metrics.length > 0 ? speedSum / metrics.length : 0;

  let thermalTime = 0;
  let weightedClimbSum = 0;
  for (const t of thermals) {
    thermalTime += t.duration_s;
    weightedClimbSum += t.avg_climb_rate_ms * t.duration_s;
  }
  const avgThermalClimb = thermalTime > 0 ? weightedClimbSum / thermalTime : 0;

  let maxAlt = altitudes[0];
  let minAlt = altitudes[0];
  for (const a of altitudes) {
    if (a > maxAlt) maxAlt = a;
    if (a < minAlt) minAlt = a;
  }

  return {
    duration_s: duration,
    total_distance_km: round(totalDistM / 1000, 2),
    straight_distance_km: round(straightDistM / 1000, 2),
    max_altitude_m: maxAlt,
    min_altitude_m: minAlt,
    altitude_gain_m: round(altitudeGain, 1),
    max_climb_rate_ms: round(climbMax, 2),
    avg_climb_rate_in_thermals_ms: round(avgThermalClimb, 2),
    avg_ground_speed_kmh: round(speedAvg, 2),
    max_ground_speed_kmh: round(speedMax, 2),
    best_glide_ratio: bestGlideRatio(fixes, metrics),
    thermal_count: thermals.length,
    thermal_time_s: round(thermalTime, 1),
    cruise_time_s: round(Math.max(duration - thermalTime, 0), 1),
  };
}
