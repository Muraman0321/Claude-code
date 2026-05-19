import type { ImportFix, ImportPayload, ImportThermal } from "../../utils/analyzeIgc";
import type {
  Fix,
  FlightDetail,
  FlightSummary,
  Thermal,
  ThermalLight,
  FlightTrack,
} from "../../types";
import { FIXES_BUCKET, supabase } from "./supabase";

interface FlightRow {
  id: number;
  filename: string;
  pilot: string;
  aircraft: string;
  remarks: string | null;
  flight_date: string;
  started_at: string | null;
  ended_at: string | null;
  start_latitude: number | null;
  start_longitude: number | null;
  summary: Record<string, number | null> | null;
  weather: Record<string, number | string | null> | null;
}

interface ThermalRow {
  id: number;
  flight_id: number;
  start_time: string;
  end_time: string;
  duration_s: number;
  altitude_gain_m: number;
  avg_climb_rate_ms: number;
  center_lat: number;
  center_lon: number;
  start_lat: number | null;
  start_lon: number | null;
  end_lat: number | null;
  end_lon: number | null;
}

const FLIGHT_COLS =
  "id, filename, pilot, aircraft, remarks, flight_date, started_at, ended_at, start_latitude, start_longitude, summary, weather";

function rowToSummary(r: FlightRow): FlightSummary {
  const s = (r.summary ?? {}) as Record<string, number | null>;
  const w = (r.weather ?? {}) as Record<string, number | string | null>;
  return {
    id: r.id,
    filename: r.filename,
    pilot: r.pilot,
    aircraft: r.aircraft,
    remarks: r.remarks,
    flight_date: r.flight_date,
    started_at: r.started_at,
    ended_at: r.ended_at,
    duration_s: (s.duration_s as number | null) ?? null,
    total_distance_km: (s.total_distance_km as number | null) ?? null,
    straight_distance_km: (s.straight_distance_km as number | null) ?? null,
    max_altitude_m: (s.max_altitude_m as number | null) ?? null,
    altitude_gain_m: (s.altitude_gain_m as number | null) ?? null,
    max_climb_rate_ms: (s.max_climb_rate_ms as number | null) ?? null,
    avg_climb_in_thermals_ms: (s.avg_climb_in_thermals_ms as number | null) ?? null,
    avg_ground_speed_kmh: (s.avg_ground_speed_kmh as number | null) ?? null,
    max_ground_speed_kmh: (s.max_ground_speed_kmh as number | null) ?? null,
    best_glide_ratio: (s.best_glide_ratio as number | null) ?? null,
    thermal_count: (s.thermal_count as number | null) ?? null,
    thermal_time_s: (s.thermal_time_s as number | null) ?? null,
    cruise_time_s: (s.cruise_time_s as number | null) ?? null,
    start_latitude: r.start_latitude,
    start_longitude: r.start_longitude,
    weather_temp_c: (w.temp_c as number | null) ?? null,
    weather_wind_speed_kmh: (w.wind_speed_kmh as number | null) ?? null,
    weather_wind_dir_deg: (w.wind_dir_deg as number | null) ?? null,
    weather_pressure_hpa: (w.pressure_hpa as number | null) ?? null,
    weather_cloud_cover_pct: (w.cloud_cover_pct as number | null) ?? null,
    weather_humidity_pct: (w.humidity_pct as number | null) ?? null,
    weather_source: (w.source as string | null) ?? null,
  };
}

function payloadSummary(p: ImportPayload): Record<string, number> {
  return {
    duration_s: p.summary.duration_s,
    total_distance_km: p.summary.total_distance_km,
    straight_distance_km: p.summary.straight_distance_km,
    max_altitude_m: p.summary.max_altitude_m,
    altitude_gain_m: p.summary.altitude_gain_m,
    max_climb_rate_ms: p.summary.max_climb_rate_ms,
    avg_climb_in_thermals_ms: p.summary.avg_climb_rate_in_thermals_ms,
    avg_ground_speed_kmh: p.summary.avg_ground_speed_kmh,
    max_ground_speed_kmh: p.summary.max_ground_speed_kmh,
    best_glide_ratio: p.summary.best_glide_ratio,
    thermal_count: p.summary.thermal_count,
    thermal_time_s: p.summary.thermal_time_s,
    cruise_time_s: p.summary.cruise_time_s,
  };
}

async function currentOwner(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) throw new Error("not signed in");
  return uid;
}

export interface ListFlightsFilter {
  pilot?: string;
  aircraft?: string;
  date_from?: string;
  date_to?: string;
}

export async function listFlights(filter: ListFlightsFilter = {}): Promise<FlightSummary[]> {
  let q = supabase
    .from("flights")
    .select(FLIGHT_COLS)
    .order("flight_date", { ascending: false })
    .order("started_at", { ascending: false });
  if (filter.pilot) q = q.eq("pilot", filter.pilot);
  if (filter.aircraft) q = q.eq("aircraft", filter.aircraft);
  if (filter.date_from) q = q.gte("flight_date", filter.date_from);
  if (filter.date_to) q = q.lte("flight_date", filter.date_to);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as FlightRow[]).map(rowToSummary);
}

export async function listPilots(): Promise<string[]> {
  const { data, error } = await supabase.from("flights").select("pilot").order("pilot");
  if (error) throw new Error(error.message);
  return Array.from(new Set((data as { pilot: string }[]).map((r) => r.pilot)));
}

export async function listAircraft(): Promise<string[]> {
  const { data, error } = await supabase.from("flights").select("aircraft").order("aircraft");
  if (error) throw new Error(error.message);
  return Array.from(new Set((data as { aircraft: string }[]).map((r) => r.aircraft)));
}

function thermalRowToShape(t: ThermalRow): Thermal {
  return {
    start_time: t.start_time,
    end_time: t.end_time,
    duration_s: t.duration_s,
    altitude_gain_m: t.altitude_gain_m,
    avg_climb_rate_ms: t.avg_climb_rate_ms,
    center_lat: t.center_lat,
    center_lon: t.center_lon,
  };
}

async function fixesPath(owner: string, flightId: number): Promise<string> {
  return `${owner}/${flightId}.json`;
}

export async function getFlight(id: number): Promise<FlightDetail> {
  const { data, error } = await supabase
    .from("flights")
    .select(FLIGHT_COLS)
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  const summary = rowToSummary(data as FlightRow);

  const { data: thermalsData, error: thErr } = await supabase
    .from("thermals")
    .select("*")
    .eq("flight_id", id)
    .order("start_time");
  if (thErr) throw new Error(thErr.message);

  const owner = await currentOwner();
  const fixes = await downloadFixes(owner, id);

  return {
    ...summary,
    fixes,
    thermals: (thermalsData as ThermalRow[]).map(thermalRowToShape),
  };
}

async function downloadFixes(owner: string, flightId: number): Promise<Fix[]> {
  const path = await fixesPath(owner, flightId);
  const { data, error } = await supabase.storage.from(FIXES_BUCKET).download(path);
  if (error) {
    if (/not.*found/i.test(error.message)) return [];
    throw new Error(`fixes download: ${error.message}`);
  }
  const text = await data.text();
  const parsed = JSON.parse(text) as ImportFix[];
  return parsed.map(
    (f): Fix => ({
      seq: f.seq,
      timestamp: f.timestamp,
      latitude: f.latitude,
      longitude: f.longitude,
      altitude_m: f.altitude_m,
      ground_speed_kmh: f.ground_speed_kmh,
      climb_rate_ms: f.climb_rate_ms,
    }),
  );
}

async function uploadFixes(owner: string, flightId: number, fixes: ImportFix[]): Promise<void> {
  const path = await fixesPath(owner, flightId);
  const json = JSON.stringify(fixes);
  const blob = new Blob([json], { type: "application/json" });
  const { error } = await supabase.storage
    .from(FIXES_BUCKET)
    .upload(path, blob, { upsert: true, contentType: "application/json" });
  if (error) throw new Error(`fixes upload: ${error.message}`);
}

async function deleteFixesFile(owner: string, flightId: number): Promise<void> {
  const path = await fixesPath(owner, flightId);
  // Don't throw on missing — best-effort cleanup.
  await supabase.storage.from(FIXES_BUCKET).remove([path]);
}

export interface SaveFlightResult {
  flight_id: number;
}

export async function saveFlight(
  payload: ImportPayload,
  weather: Record<string, number | string | null> | null,
): Promise<SaveFlightResult> {
  const owner = await currentOwner();

  // Replace existing flight with the same (filename, pilot) (case-insensitive).
  // We can't easily do `.ilike()` on two columns at once, so fetch then delete.
  const { data: existing } = await supabase
    .from("flights")
    .select("id")
    .eq("owner", owner)
    .ilike("filename", payload.filename)
    .ilike("pilot", payload.meta.pilot);
  if (existing && existing.length > 0) {
    for (const row of existing as { id: number }[]) {
      await deleteFlight(row.id);
    }
  }

  const insertRow = {
    owner,
    filename: payload.filename,
    pilot: payload.meta.pilot,
    aircraft: payload.meta.aircraft,
    remarks: payload.meta.remarks,
    flight_date: payload.meta.flight_date,
    started_at: payload.start.timestamp,
    ended_at: payload.end.timestamp,
    start_latitude: payload.start.latitude,
    start_longitude: payload.start.longitude,
    summary: payloadSummary(payload),
    weather,
    raw_igc: payload.raw_igc,
  };
  const { data, error } = await supabase
    .from("flights")
    .insert(insertRow)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const flightId = (data as { id: number }).id;

  if (payload.thermals.length > 0) {
    const rows = payload.thermals.map((t: ImportThermal) => ({
      owner,
      flight_id: flightId,
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
    const { error: thErr } = await supabase.from("thermals").insert(rows);
    if (thErr) throw new Error(thErr.message);
  }

  await uploadFixes(owner, flightId, payload.fixes);
  return { flight_id: flightId };
}

export async function deleteFlight(id: number): Promise<void> {
  const owner = await currentOwner();
  const { error } = await supabase.from("flights").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await deleteFixesFile(owner, id);
}

export async function updateWeather(
  id: number,
  weather: Record<string, number | string | null>,
): Promise<FlightSummary> {
  const { data, error } = await supabase
    .from("flights")
    .update({ weather })
    .eq("id", id)
    .select(FLIGHT_COLS)
    .single();
  if (error) throw new Error(error.message);
  return rowToSummary(data as FlightRow);
}

/** Bulk fetch — for stats screens that aggregate across many flights. */
export async function listAllThermals(): Promise<ThermalLight[]> {
  const { data: flightData, error: fErr } = await supabase
    .from("flights")
    .select("id, pilot, aircraft, start_longitude");
  if (fErr) throw new Error(fErr.message);

  const flightMap = new Map<number, { pilot: string; aircraft: string; lon: number | null }>();
  for (const f of flightData as {
    id: number;
    pilot: string;
    aircraft: string;
    start_longitude: number | null;
  }[]) {
    flightMap.set(f.id, { pilot: f.pilot, aircraft: f.aircraft, lon: f.start_longitude });
  }

  const { data, error } = await supabase
    .from("thermals")
    .select("*")
    .order("start_time");
  if (error) throw new Error(error.message);

  return (data as ThermalRow[]).map((t): ThermalLight => {
    const f = flightMap.get(t.flight_id);
    const lon = f?.lon ?? 0;
    const ts = new Date(t.start_time);
    // Approximate local hour: UTC + longitude/15 (matches backend behaviour, ±30 min).
    const utcHour = ts.getUTCHours() + ts.getUTCMinutes() / 60;
    const local = (utcHour + lon / 15 + 24) % 24;
    const localHour = Math.floor(local);
    const localMinute = Math.floor((local - localHour) * 60);
    return {
      flight_id: t.flight_id,
      pilot: f?.pilot ?? "",
      aircraft: f?.aircraft ?? "",
      center_lat: t.center_lat,
      center_lon: t.center_lon,
      avg_climb_rate_ms: t.avg_climb_rate_ms,
      altitude_gain_m: t.altitude_gain_m,
      duration_s: t.duration_s,
      start_time: t.start_time,
      local_hour: localHour,
      local_minute: localMinute,
      start_lat: t.start_lat,
      start_lon: t.start_lon,
      end_lat: t.end_lat,
      end_lon: t.end_lon,
    };
  });
}

/** Track points for the comparison view. Each track downsampled to ~maxPoints. */
export async function listTracks(ids: number[], maxPoints = 120): Promise<FlightTrack[]> {
  if (ids.length === 0) return [];
  const owner = await currentOwner();
  const { data: flightData, error } = await supabase
    .from("flights")
    .select("id, pilot, aircraft")
    .in("id", ids);
  if (error) throw new Error(error.message);

  const results: FlightTrack[] = [];
  for (const f of flightData as { id: number; pilot: string; aircraft: string }[]) {
    const fixes = await downloadFixes(owner, f.id);
    const step = Math.max(1, Math.floor(fixes.length / maxPoints));
    const points = [] as { lat: number; lon: number }[];
    for (let i = 0; i < fixes.length; i += step) {
      points.push({ lat: fixes[i].latitude, lon: fixes[i].longitude });
    }
    if (fixes.length > 0) {
      const last = fixes[fixes.length - 1];
      if (points[points.length - 1]?.lat !== last.latitude) {
        points.push({ lat: last.latitude, lon: last.longitude });
      }
    }
    results.push({ flight_id: f.id, pilot: f.pilot, aircraft: f.aircraft, points });
  }
  return results;
}
