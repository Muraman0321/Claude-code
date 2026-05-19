import type { Fix, ThermalLight } from "../../types";

export interface AltitudeSegment {
  type: "thermal" | "cruise";
  label: string;
  startAlt: number;
  endAlt: number;
  deltaAlt: number;
  durationS: number;
}

export function computeAltitudeBudget(fixes: Fix[]): AltitudeSegment[] {
  if (fixes.length < 2) return [];

  const CLIMB_THRESHOLD = 0.2;
  const MIN_DURATION_S = 20;

  const isClimbing = (f: Fix) => (f.climb_rate_ms ?? 0) > CLIMB_THRESHOLD;

  interface RawSeg {
    type: "thermal" | "cruise";
    startIdx: number;
    endIdx: number;
  }
  const rawSegs: RawSeg[] = [];
  let segStart = 0;
  let segType: "thermal" | "cruise" = isClimbing(fixes[0]) ? "thermal" : "cruise";

  for (let i = 1; i < fixes.length; i++) {
    const t: "thermal" | "cruise" = isClimbing(fixes[i]) ? "thermal" : "cruise";
    if (t !== segType) {
      rawSegs.push({ type: segType, startIdx: segStart, endIdx: i - 1 });
      segStart = i;
      segType = t;
    }
  }
  rawSegs.push({ type: segType, startIdx: segStart, endIdx: fixes.length - 1 });

  const segments: AltitudeSegment[] = [];
  let thermalN = 0;
  let cruiseN = 0;

  for (const seg of rawSegs) {
    const start = fixes[seg.startIdx];
    const end = fixes[seg.endIdx];
    const durationS =
      (new Date(end.timestamp).getTime() - new Date(start.timestamp).getTime()) / 1000;
    if (durationS < MIN_DURATION_S) continue;

    const deltaAlt = end.altitude_m - start.altitude_m;
    if (seg.type === "thermal") thermalN++;
    else cruiseN++;

    segments.push({
      type: seg.type,
      label: seg.type === "thermal" ? `S${thermalN}` : `G${cruiseN}`,
      startAlt: start.altitude_m,
      endAlt: end.altitude_m,
      deltaAlt,
      durationS,
    });
  }

  return segments;
}

export interface PilotThermalStats {
  count: number;
  avgClimbRate: number;
  avgAltGain: number;
  avgDurationS: number;
  totalAltGain: number;
  totalTimeS: number;
  bestClimbRate: number;
}

export function computePilotThermalStats(thermals: ThermalLight[]): PilotThermalStats {
  if (thermals.length === 0)
    return {
      count: 0,
      avgClimbRate: 0,
      avgAltGain: 0,
      avgDurationS: 0,
      totalAltGain: 0,
      totalTimeS: 0,
      bestClimbRate: 0,
    };

  const n = thermals.length;
  return {
    count: n,
    avgClimbRate: thermals.reduce((s, t) => s + t.avg_climb_rate_ms, 0) / n,
    avgAltGain: thermals.reduce((s, t) => s + t.altitude_gain_m, 0) / n,
    avgDurationS: thermals.reduce((s, t) => s + t.duration_s, 0) / n,
    totalAltGain: thermals.reduce((s, t) => s + t.altitude_gain_m, 0),
    totalTimeS: thermals.reduce((s, t) => s + t.duration_s, 0),
    bestClimbRate: Math.max(...thermals.map((t) => t.avg_climb_rate_ms)),
  };
}
