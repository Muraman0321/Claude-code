import type {
  AircraftStats,
  FlightSummary,
  PilotStats,
  SeasonBucket,
  ThermalLight,
  TimeOfDayBucket,
  WeatherBucket,
} from "../../types";

const SEASONS: { label: string; key: SeasonBucket["season_key"]; months: number[] }[] = [
  { label: "春", key: "spring", months: [3, 4, 5] },
  { label: "夏", key: "summer", months: [6, 7, 8] },
  { label: "秋", key: "autumn", months: [9, 10, 11] },
  { label: "冬", key: "winter", months: [12, 1, 2] },
];

function seasonOf(month: number): { label: string; key: SeasonBucket["season_key"] } {
  for (const s of SEASONS) if (s.months.includes(month)) return s;
  return SEASONS[3];
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function mean(xs: number[], digits = 2): number | null {
  if (xs.length === 0) return null;
  return round(xs.reduce((a, b) => a + b, 0) / xs.length, digits);
}

function pickNumber<T>(xs: T[], get: (x: T) => number | null | undefined): number[] {
  const out: number[] = [];
  for (const x of xs) {
    const v = get(x);
    if (v != null && Number.isFinite(v)) out.push(v);
  }
  return out;
}

export function pilotStats(flights: FlightSummary[]): PilotStats[] {
  const groups = new Map<string, FlightSummary[]>();
  for (const f of flights) {
    if (!groups.has(f.pilot)) groups.set(f.pilot, []);
    groups.get(f.pilot)!.push(f);
  }
  const out: PilotStats[] = [];
  for (const [pilot, fs] of groups) {
    const totalSeconds = pickNumber(fs, (f) => f.duration_s).reduce((a, b) => a + b, 0);
    const totalDistance = pickNumber(fs, (f) => f.total_distance_km).reduce((a, b) => a + b, 0);
    out.push({
      pilot,
      flight_count: fs.length,
      total_hours: round(totalSeconds / 3600, 2),
      avg_climb_in_thermals_ms: mean(pickNumber(fs, (f) => f.avg_climb_in_thermals_ms)),
      avg_ground_speed_kmh: mean(pickNumber(fs, (f) => f.avg_ground_speed_kmh)),
      best_glide_ratio: (() => {
        const xs = pickNumber(fs, (f) => f.best_glide_ratio);
        return xs.length ? round(Math.max(...xs), 2) : null;
      })(),
      total_distance_km: round(totalDistance, 1),
    });
  }
  out.sort((a, b) => b.flight_count - a.flight_count);
  return out;
}

export function aircraftStats(flights: FlightSummary[]): AircraftStats[] {
  const groups = new Map<string, FlightSummary[]>();
  for (const f of flights) {
    if (!groups.has(f.aircraft)) groups.set(f.aircraft, []);
    groups.get(f.aircraft)!.push(f);
  }
  const out: AircraftStats[] = [];
  for (const [aircraft, fs] of groups) {
    out.push({
      aircraft,
      flight_count: fs.length,
      avg_climb_in_thermals_ms: mean(pickNumber(fs, (f) => f.avg_climb_in_thermals_ms)),
      avg_ground_speed_kmh: mean(pickNumber(fs, (f) => f.avg_ground_speed_kmh)),
      best_glide_ratio: (() => {
        const xs = pickNumber(fs, (f) => f.best_glide_ratio);
        return xs.length ? round(Math.max(...xs), 2) : null;
      })(),
    });
  }
  out.sort((a, b) => b.flight_count - a.flight_count);
  return out;
}

export function seasonStats(
  flights: FlightSummary[],
  filter: { pilot?: string; aircraft?: string } = {},
): SeasonBucket[] {
  const filtered = flights.filter(
    (f) =>
      (!filter.pilot || f.pilot === filter.pilot) &&
      (!filter.aircraft || f.aircraft === filter.aircraft),
  );
  const grouped = new Map<SeasonBucket["season_key"], FlightSummary[]>();
  for (const s of SEASONS) grouped.set(s.key, []);
  for (const f of filtered) {
    const month = new Date(f.flight_date + "T00:00:00Z").getUTCMonth() + 1;
    const { key } = seasonOf(month);
    grouped.get(key)!.push(f);
  }
  const out: SeasonBucket[] = [];
  for (const s of SEASONS) {
    const fs = grouped.get(s.key)!;
    if (fs.length === 0) continue;
    const totalSeconds = pickNumber(fs, (f) => f.duration_s).reduce((a, b) => a + b, 0);
    const totalDistance = pickNumber(fs, (f) => f.total_distance_km).reduce((a, b) => a + b, 0);
    out.push({
      season: s.label,
      season_key: s.key,
      flight_count: fs.length,
      total_hours: round(totalSeconds / 3600, 2),
      total_distance_km: round(totalDistance, 1),
      avg_climb_in_thermals_ms: mean(pickNumber(fs, (f) => f.avg_climb_in_thermals_ms)),
      avg_ground_speed_kmh: mean(pickNumber(fs, (f) => f.avg_ground_speed_kmh)),
      avg_max_altitude_m: mean(pickNumber(fs, (f) => f.max_altitude_m)),
      avg_best_glide: mean(pickNumber(fs, (f) => f.best_glide_ratio)),
      avg_temp_c: mean(pickNumber(fs, (f) => f.weather_temp_c)),
      avg_wind_speed_kmh: mean(pickNumber(fs, (f) => f.weather_wind_speed_kmh)),
    });
  }
  return out;
}

export function timeOfDayStats(
  thermals: ThermalLight[],
  flights: FlightSummary[],
  filter: { pilot?: string; aircraft?: string; season?: string } = {},
): TimeOfDayBucket[] {
  const flightById = new Map<number, FlightSummary>();
  for (const f of flights) flightById.set(f.id, f);

  const buckets = new Map<number, ThermalLight[]>();
  for (const t of thermals) {
    const flight = flightById.get(t.flight_id);
    if (!flight) continue;
    if (filter.pilot && flight.pilot !== filter.pilot) continue;
    if (filter.aircraft && flight.aircraft !== filter.aircraft) continue;
    if (filter.season) {
      const month = new Date(flight.flight_date + "T00:00:00Z").getUTCMonth() + 1;
      if (seasonOf(month).key !== filter.season) continue;
    }
    if (!buckets.has(t.local_hour)) buckets.set(t.local_hour, []);
    buckets.get(t.local_hour)!.push(t);
  }
  const hours = Array.from(buckets.keys()).sort((a, b) => a - b);
  return hours.map((hour) => {
    const ts = buckets.get(hour)!;
    return {
      hour,
      thermal_count: ts.length,
      avg_climb_rate_ms: round(
        ts.reduce((a, t) => a + t.avg_climb_rate_ms, 0) / ts.length,
        2,
      ),
      avg_altitude_gain_m: round(
        ts.reduce((a, t) => a + t.altitude_gain_m, 0) / ts.length,
        1,
      ),
      avg_duration_s: round(
        ts.reduce((a, t) => a + t.duration_s, 0) / ts.length,
        1,
      ),
    };
  });
}

const WIND_BUCKETS: { label: string; lo: number; hi: number }[] = [
  { label: "0-5 km/h", lo: 0, hi: 5 },
  { label: "5-10 km/h", lo: 5, hi: 10 },
  { label: "10-15 km/h", lo: 10, hi: 15 },
  { label: "15-20 km/h", lo: 15, hi: 20 },
  { label: "20+ km/h", lo: 20, hi: 999 },
];

export function weatherStats(flights: FlightSummary[]): WeatherBucket[] {
  const withWind = flights.filter((f) => f.weather_wind_speed_kmh != null);
  const out: WeatherBucket[] = [];
  for (const b of WIND_BUCKETS) {
    const inBucket = withWind.filter((f) => {
      const w = f.weather_wind_speed_kmh ?? 0;
      return w >= b.lo && w < b.hi;
    });
    if (inBucket.length === 0) continue;
    out.push({
      label: b.label,
      flight_count: inBucket.length,
      avg_climb_rate_ms: mean(pickNumber(inBucket, (f) => f.avg_climb_in_thermals_ms)),
      avg_ground_speed_kmh: mean(pickNumber(inBucket, (f) => f.avg_ground_speed_kmh)),
      avg_best_glide: mean(pickNumber(inBucket, (f) => f.best_glide_ratio)),
    });
  }
  return out;
}
