// Browser-side weather lookup against Open-Meteo's Historical Forecast API.
// CORS is enabled on the API host, so the browser can call it directly — no proxy needed.
//
// We fetch hourly values for the flight day(s) and average across the hours
// that fall within [start, end]. Mirrors the prior server-side behaviour.

export interface WeatherSnapshot {
  temp_c: number | null;
  wind_speed_kmh: number | null;
  wind_dir_deg: number | null;
  pressure_hpa: number | null;
  cloud_cover_pct: number | null;
  humidity_pct: number | null;
  dewpoint_c: number | null;
  cloud_base_m: number | null;
  source: string;
}

const HOURLY_VARS = [
  "temperature_2m",
  "dewpoint_2m",
  "wind_speed_10m",
  "wind_direction_10m",
  "surface_pressure",
  "cloud_cover",
  "relative_humidity_2m",
] as const;

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function circularMeanDeg(xs: number[]): number | null {
  if (xs.length === 0) return null;
  let sin = 0;
  let cos = 0;
  for (const v of xs) {
    sin += Math.sin((v * Math.PI) / 180);
    cos += Math.cos((v * Math.PI) / 180);
  }
  return ((Math.atan2(sin, cos) * 180) / Math.PI + 360) % 360;
}

function pickHourly(hourly: Record<string, unknown>, key: string, indices: number[]): number[] {
  const arr = hourly[key];
  if (!Array.isArray(arr)) return [];
  const out: number[] = [];
  for (const i of indices) {
    const v = arr[i];
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

export async function fetchWeather(
  lat: number,
  lon: number,
  startIso: string,
  endIso?: string,
): Promise<WeatherSnapshot | null> {
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : start;
  if (Number.isNaN(start.getTime())) return null;

  const url = new URL("https://historical-forecast-api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat.toFixed(4));
  url.searchParams.set("longitude", lon.toFixed(4));
  url.searchParams.set("start_date", isoDate(start));
  url.searchParams.set("end_date", isoDate(end));
  url.searchParams.set("hourly", HOURLY_VARS.join(","));
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("timezone", "UTC");

  let data: { hourly?: Record<string, unknown> };
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    data = (await res.json()) as { hourly?: Record<string, unknown> };
  } catch {
    return null;
  }

  const hourly = data.hourly ?? {};
  const times = hourly.time;
  if (!Array.isArray(times) || times.length === 0) return null;

  const startMs = start.getTime();
  const endMs = end.getTime();
  let indices: number[] = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (typeof t !== "string") continue;
    // Open-Meteo returns ISO times without timezone (UTC by request).
    const ts = Date.parse(t + "Z");
    if (Number.isFinite(ts) && ts >= startMs && ts <= endMs) indices.push(i);
  }
  if (indices.length === 0) {
    // Fall back to the single nearest hour.
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      if (typeof t !== "string") continue;
      const ts = Date.parse(t + "Z");
      if (!Number.isFinite(ts)) continue;
      const d = Math.abs(ts - startMs);
      if (d < bestDiff) {
        bestDiff = d;
        best = i;
      }
    }
    indices = [best];
  }

  const temp_c = mean(pickHourly(hourly, "temperature_2m", indices));
  const dewpoint_c = mean(pickHourly(hourly, "dewpoint_2m", indices));
  const cloud_base_m =
    temp_c != null && dewpoint_c != null
      ? Math.round(((temp_c - dewpoint_c) / 2.5) * 1000)
      : null;

  return {
    temp_c,
    wind_speed_kmh: mean(pickHourly(hourly, "wind_speed_10m", indices)),
    wind_dir_deg: circularMeanDeg(pickHourly(hourly, "wind_direction_10m", indices)),
    pressure_hpa: mean(pickHourly(hourly, "surface_pressure", indices)),
    cloud_cover_pct: mean(pickHourly(hourly, "cloud_cover", indices)),
    humidity_pct: mean(pickHourly(hourly, "relative_humidity_2m", indices)),
    dewpoint_c,
    cloud_base_m,
    source: "open-meteo",
  };
}
