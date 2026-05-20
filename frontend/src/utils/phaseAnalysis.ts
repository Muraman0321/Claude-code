// Winch-launch phase analysis — ported from the old FastAPI backend
// (backend/analysis.py: detect_winch_phases / compute_phase_metrics) so it
// runs in the browser on the stored (downsampled) fixes. No server needed.
//
// Phase definitions:
//   曳航初期: (急激な上昇開始 - 10s) → 高度80m
//   曳航中期: 高度80m → 急激な上昇の終了
//   曳航終期: 急激な上昇の終了 → リリース
//
// Operates directly on the stored Fix[] — each Fix already carries the smoothed
// climb_rate_ms / ground_speed_kmh and the display altitude_m, and sequence is
// the array index.

import type { Fix, FlightPhaseAnalysis, PhaseMetrics } from "../types";

const ms = (f: Fix) => new Date(f.timestamp).getTime();
const climb = (f: Fix) => f.climb_rate_ms ?? 0;
const speed = (f: Fix) => f.ground_speed_kmh ?? 0;
const alt = (f: Fix) => f.altitude_m;

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function moveStartIndex(fixes: Fix[]): number {
  const i = fixes.findIndex((f) => speed(f) > 15);
  return i < 0 ? 0 : i;
}

/** Index where the tow rope is released — mirrors backend _tow_release_index. */
function towReleaseIndex(
  fixes: Fix[],
  minGainM = 50.0,
  releaseThresholdMs = 2.0,
  windowS = 5.0,
  maxTowS = 120.0,
): number {
  if (fixes.length === 0) return 0;

  const moveStart = moveStartIndex(fixes);
  const takeoffAlt = alt(fixes[moveStart]);
  const maxTowTime = ms(fixes[moveStart]) + maxTowS * 1000;

  // Primary: only after a real rapid climb, find first 5s window averaging <= threshold.
  let seenRapidClimb = false;
  for (let i = moveStart; i < fixes.length; i++) {
    if (ms(fixes[i]) > maxTowTime) return i;
    if (alt(fixes[i]) - takeoffAlt < minGainM) continue;
    if (climb(fixes[i]) > releaseThresholdMs) seenRapidClimb = true;
    if (seenRapidClimb) {
      const targetTime = ms(fixes[i]) + windowS * 1000;
      let endJ = i;
      while (endJ < fixes.length - 1 && ms(fixes[endJ]) < targetTime) endJ++;
      const window = fixes.slice(i, endJ + 1);
      if (window.length >= 3) {
        const avg = window.reduce((s, f) => s + climb(f), 0) / window.length;
        if (avg <= releaseThresholdMs) return i;
      }
    }
  }

  // Fallback: first descent after gaining enough altitude.
  let peakAlt = takeoffAlt;
  for (let i = moveStart; i < fixes.length; i++) {
    if (ms(fixes[i]) > maxTowTime) return i;
    const a = alt(fixes[i]);
    if (a > peakAlt) peakAlt = a;
    if (peakAlt - takeoffAlt >= minGainM && climb(fixes[i]) < 0) return i;
  }

  // Hard cap fallback.
  for (let i = moveStart; i < fixes.length; i++) {
    if (ms(fixes[i]) > maxTowTime) return i;
  }

  return moveStart;
}

interface PhaseBoundaries {
  towPhaseEndFixSeq: number | null; // at 80m gain (初期/中期 boundary)
  midPhaseEndFixSeq: number | null; // end of rapid ascent (中期/終期 boundary)
  releaseAltitudeM: number | null;
  releaseFixSeq: number | null;
  earlyStartFixSeq: number | null; // 10s before rapid ascent (初期 start)
}

function detectWinchPhases(fixes: Fix[]): PhaseBoundaries {
  if (fixes.length === 0) {
    return {
      towPhaseEndFixSeq: null,
      midPhaseEndFixSeq: null,
      releaseAltitudeM: null,
      releaseFixSeq: null,
      earlyStartFixSeq: null,
    };
  }

  const moveStart = moveStartIndex(fixes);
  const takeoffAlt = alt(fixes[moveStart]);
  const releaseIdx = towReleaseIndex(fixes);
  const releaseAlt = alt(fixes[releaseIdx]);

  // 急激な上昇開始: first fix with climb >= 2.0 m/s sustained >= 5 s.
  const RAPID_THRESHOLD_MS = 2.0;
  const RAPID_SUSTAIN_S = 5.0;
  let rapidStart = moveStart;
  for (let i = moveStart; i < releaseIdx; i++) {
    const targetTime = ms(fixes[i]) + RAPID_SUSTAIN_S * 1000;
    let endJ = i;
    while (endJ < fixes.length - 1 && ms(fixes[endJ]) < targetTime) endJ++;
    const window = fixes.slice(i, endJ + 1);
    if (window.length > 0 && window.every((f) => climb(f) >= RAPID_THRESHOLD_MS)) {
      rapidStart = i;
      break;
    }
  }

  // 初期フェーズ開始: 10s before rapid ascent, not before move_start.
  const earlyTime = ms(fixes[rapidStart]) - 10 * 1000;
  let earlyStart = moveStart;
  for (let i = moveStart; i <= rapidStart; i++) {
    if (ms(fixes[i]) >= earlyTime) {
      earlyStart = i;
      break;
    }
  }

  // 高度80m (初期/中期 境界)
  let initialEndIdx: number | null = null;
  for (let i = moveStart; i <= releaseIdx; i++) {
    if (alt(fixes[i]) - takeoffAlt >= 80) {
      initialEndIdx = i;
      break;
    }
  }

  // 急激な上昇の終了 (中期/終期 境界): first 10s window (after 80m) averaging < 2.0 m/s.
  const MID_END_THRESHOLD_MS = 2.0;
  const MID_END_WINDOW_S = 10.0;
  const searchStart = initialEndIdx ?? moveStart;
  let midEndIdx: number | null = null;
  if (searchStart < releaseIdx) {
    for (let i = searchStart; i < releaseIdx; i++) {
      const targetTime = ms(fixes[i]) + MID_END_WINDOW_S * 1000;
      let endJ = i;
      while (endJ < releaseIdx && ms(fixes[endJ]) < targetTime) endJ++;
      const window = fixes.slice(i, endJ + 1);
      if (window.length >= 3) {
        const avg = window.reduce((s, f) => s + climb(f), 0) / window.length;
        if (avg < MID_END_THRESHOLD_MS) {
          midEndIdx = i;
          break;
        }
      }
    }
  }

  return {
    towPhaseEndFixSeq: initialEndIdx,
    midPhaseEndFixSeq: midEndIdx,
    releaseAltitudeM: releaseAlt,
    releaseFixSeq: releaseIdx,
    earlyStartFixSeq: earlyStart,
  };
}

function segmentMetrics(fixes: Fix[], startIdx: number, endIdx: number): PhaseMetrics {
  if (startIdx >= endIdx || startIdx >= fixes.length) {
    return {
      duration_s: 0,
      avg_speed_kmh: 0,
      avg_climb_rate_ms: 0,
      altitude_gained_m: null,
      max_speed_kmh: null,
      stability_score: null,
    };
  }
  const seg = fixes.slice(startIdx, endIdx + 1);
  const duration = (ms(fixes[endIdx]) - ms(fixes[startIdx])) / 1000;
  const avgSpeed = seg.reduce((s, f) => s + speed(f), 0) / seg.length;
  const avgClimb = seg.reduce((s, f) => s + climb(f), 0) / seg.length;
  const altGain = alt(seg[seg.length - 1]) - alt(seg[0]);
  const maxSpeed = seg.reduce((m, f) => Math.max(m, speed(f)), 0);
  return {
    duration_s: round(duration, 2),
    avg_speed_kmh: round(avgSpeed, 2),
    avg_climb_rate_ms: round(avgClimb, 2),
    altitude_gained_m: round(altGain, 1),
    max_speed_kmh: round(maxSpeed, 2),
    stability_score: null,
  };
}

/** Browser-side replacement for the old GET /api/flights/{id}/phase-analysis. */
export function computeFlightPhaseAnalysis(flightId: number, fixes: Fix[]): FlightPhaseAnalysis {
  const boundaries = detectWinchPhases(fixes);

  if (fixes.length === 0) {
    return {
      flight_id: flightId,
      tow_phase_end_fix_seq: null,
      mid_phase_end_fix_seq: null,
      release_altitude_m: null,
      release_fix_seq: null,
      initial: null,
      mid: null,
      late: null,
    };
  }

  const moveStart = moveStartIndex(fixes);
  const releaseIdx = boundaries.releaseFixSeq ?? fixes.length - 1;

  let initial: PhaseMetrics | null = null;
  let mid: PhaseMetrics | null = null;
  let late: PhaseMetrics | null = null;

  // Initial: (rapid ascent start - 10s) → 80m. (truthy checks mirror the backend)
  const initialEnd = boundaries.towPhaseEndFixSeq || releaseIdx;
  const earlyStart = boundaries.earlyStartFixSeq ?? moveStart;
  if (earlyStart < initialEnd) initial = segmentMetrics(fixes, earlyStart, initialEnd);

  // Mid: 80m → rapid-ascent end, else 80m → release.
  if (boundaries.towPhaseEndFixSeq && boundaries.midPhaseEndFixSeq) {
    if (boundaries.towPhaseEndFixSeq < boundaries.midPhaseEndFixSeq) {
      mid = segmentMetrics(fixes, boundaries.towPhaseEndFixSeq, boundaries.midPhaseEndFixSeq);
    }
  } else if (boundaries.towPhaseEndFixSeq && boundaries.towPhaseEndFixSeq < releaseIdx) {
    mid = segmentMetrics(fixes, boundaries.towPhaseEndFixSeq, releaseIdx);
  }

  // Late: rapid-ascent end (or 80m, or move start) → release.
  const lateStartIdx =
    boundaries.midPhaseEndFixSeq || boundaries.towPhaseEndFixSeq || moveStart;
  if (lateStartIdx < releaseIdx) {
    late = segmentMetrics(fixes, lateStartIdx, releaseIdx);
    if (boundaries.releaseAltitudeM != null) {
      late.altitude_gained_m = round(boundaries.releaseAltitudeM - alt(fixes[lateStartIdx]), 1);
    }
  }

  return {
    flight_id: flightId,
    tow_phase_end_fix_seq: boundaries.towPhaseEndFixSeq,
    mid_phase_end_fix_seq: boundaries.midPhaseEndFixSeq,
    release_altitude_m: boundaries.releaseAltitudeM,
    release_fix_seq: boundaries.releaseFixSeq,
    initial,
    mid,
    late,
  };
}
