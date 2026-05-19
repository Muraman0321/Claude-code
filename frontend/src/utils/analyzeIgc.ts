import { computeFixMetrics, computeSummary, detectThermals } from "./analysis";
import type { FixMetrics, FlightSummary, Thermal } from "./analysis";
import { parseIgcFile, parseIgcText, type IgcFix } from "./igcParser";
import { parseOrNormalize } from "./filenameParser";

/** Payload shape POSTed to /api/import — analyzed flight, ready to persist. */
export interface ImportPayload {
  filename: string;                   // normalized
  normalized_from: string | null;     // original if changed
  normalization_notes: string[];
  meta: {
    flight_date: string;              // YYYY-MM-DD
    pilot: string;
    aircraft: string;
    remarks: string | null;
  };
  summary: FlightSummary;
  fixes: ImportFix[];                 // downsampled (~3000 max)
  thermals: ImportThermal[];
  start: {
    latitude: number;
    longitude: number;
    timestamp: string;                // ISO 8601 UTC
  };
  end: { timestamp: string };
  raw_igc: string;                    // latin-1 text — kept for storage parity with old backend
}

export interface ImportFix {
  seq: number;
  timestamp: string;
  latitude: number;
  longitude: number;
  altitude_m: number;
  pressure_altitude_m: number;
  ground_speed_kmh: number;
  climb_rate_ms: number;
}

export interface ImportThermal {
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

export class AnalyzeError extends Error {
  constructor(
    message: string,
    public finalName: string,
    public normalizedFrom: string | null,
    public notes: string[],
  ) {
    super(message);
  }
}

const MAX_STORED_FIXES = 3000;

function downsampleMetrics(metrics: FixMetrics[], fixes: IgcFix[]): ImportFix[] {
  const step = Math.max(1, Math.floor(metrics.length / MAX_STORED_FIXES));
  const out: ImportFix[] = [];
  for (let i = 0; i < metrics.length; i++) {
    if (i % step !== 0 && i !== metrics.length - 1) continue;
    const m = metrics[i];
    out.push({
      seq: i,
      timestamp: m.timestamp,
      latitude: m.latitude,
      longitude: m.longitude,
      altitude_m: m.altitude,
      pressure_altitude_m: m.pressure_altitude,
      ground_speed_kmh: m.ground_speed_kmh,
      climb_rate_ms: m.climb_rate_ms,
    });
  }
  return out;
}

function shapeThermals(thermals: Thermal[]): ImportThermal[] {
  return thermals.map((t) => ({
    start_time: t.start_time,
    end_time: t.end_time,
    duration_s: t.duration_s,
    altitude_gain_m: t.altitude_gain_m,
    avg_climb_rate_ms: t.avg_climb_rate_ms,
    center_lat: t.center_lat,
    center_lon: t.center_lon,
    start_lat: t.start_lat,
    start_lon: t.start_lon,
    end_lat: t.end_lat,
    end_lon: t.end_lon,
  }));
}

/** Analyze raw IGC bytes/text + the original filename — returns POST-ready payload. */
export function analyzeIgc(
  rawText: string,
  originalFilename: string,
): ImportPayload {
  const { parsed, finalName, notes } = parseOrNormalize(originalFilename);
  const normalizedFrom = finalName !== originalFilename ? originalFilename : null;
  if (!parsed) {
    throw new AnalyzeError(
      `filename does not match yy.mm.dd_<aircraft>_<pilot>_<remarks>.igc (tried: '${finalName}')`,
      finalName,
      normalizedFrom,
      notes,
    );
  }

  const igc = parseIgcText(rawText);
  if (igc.fixes.length === 0) {
    throw new AnalyzeError(
      "no B records (GPS fixes) found",
      finalName,
      normalizedFrom,
      notes,
    );
  }

  const metrics = computeFixMetrics(igc.fixes);
  const thermals = detectThermals(igc.fixes, metrics);
  const summary = computeSummary(igc.fixes, metrics, thermals);
  const startFix = igc.fixes[0];
  const endFix = igc.fixes[igc.fixes.length - 1];

  return {
    filename: finalName,
    normalized_from: normalizedFrom,
    normalization_notes: notes,
    meta: {
      flight_date: parsed.flightDate,
      pilot: parsed.pilot,
      aircraft: parsed.aircraft,
      remarks: parsed.remarks,
    },
    summary,
    fixes: downsampleMetrics(metrics, igc.fixes),
    thermals: shapeThermals(thermals),
    start: {
      latitude: startFix.latitude,
      longitude: startFix.longitude,
      timestamp: startFix.timestampIso,
    },
    end: { timestamp: endFix.timestampIso },
    raw_igc: rawText,
  };
}

/** Convenience: read a File and analyze it. */
export async function analyzeIgcFile(file: File): Promise<ImportPayload> {
  // Read as latin-1 to match Python's parser.
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let text = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    text += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  // We have `parseIgcFile` too, but analyzeIgc() needs the raw text for raw_igc storage,
  // so it's clearer to keep the decode here.
  return analyzeIgc(text, file.name);
}

/** Used by Drive import: bytes already fetched server-side. */
export function analyzeIgcBytes(bytes: Uint8Array, originalFilename: string): ImportPayload {
  let text = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    text += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return analyzeIgc(text, originalFilename);
}

// Re-export the types so the API client can stay in one import path.
export type { FixMetrics, FlightSummary, Thermal } from "./analysis";
export { parseIgcFile };
