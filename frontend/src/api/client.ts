import type {
  AircraftStats,
  AreaStats,
  FlightDetail,
  FlightSummary,
  FlightTrack,
  PilotStats,
  SeasonBucket,
  ThermalLight,
  TimeOfDayBucket,
  UploadResult,
  WeatherBucket,
} from "../types";

const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  async listFlights(params: {
    pilot?: string;
    aircraft?: string;
    date_from?: string;
    date_to?: string;
  } = {}): Promise<FlightSummary[]> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v) qs.set(k, v);
    }
    const q = qs.toString();
    return get<FlightSummary[]>(`/flights${q ? `?${q}` : ""}`);
  },

  getFlight(id: number): Promise<FlightDetail> {
    return get<FlightDetail>(`/flights/${id}`);
  },

  async deleteFlight(id: number): Promise<void> {
    const res = await fetch(`${BASE}/flights/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  },

  listPilots: () => get<string[]>("/pilots"),
  listAircraft: () => get<string[]>("/aircraft"),
  pilotStats: () => get<PilotStats[]>("/stats/pilots"),
  aircraftStats: () => get<AircraftStats[]>("/stats/aircraft"),
  timeOfDayStats: (params: { pilot?: string; aircraft?: string; season?: string } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    const q = qs.toString();
    return get<TimeOfDayBucket[]>(`/stats/time-of-day${q ? `?${q}` : ""}`);
  },
  weatherStats: () => get<WeatherBucket[]>("/stats/weather"),
  seasonStats: (params: { pilot?: string; aircraft?: string } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    const q = qs.toString();
    return get<SeasonBucket[]>(`/stats/season${q ? `?${q}` : ""}`);
  },
  areaSectors: (params: { center_lat?: number; center_lon?: number; radius_km?: number; n_sectors?: number } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v != null) qs.set(k, String(v));
    const q = qs.toString();
    return get<AreaStats>(`/stats/area/sectors${q ? `?${q}` : ""}`);
  },
  areaGrid: (params: { center_lat?: number; center_lon?: number; cell_km?: number; grid_size?: number } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v != null) qs.set(k, String(v));
    const q = qs.toString();
    return get<AreaStats>(`/stats/area/grid${q ? `?${q}` : ""}`);
  },
  tracks: (ids: number[], maxPoints = 120) => {
    return get<FlightTrack[]>(`/tracks?ids=${ids.join(",")}&max_points=${maxPoints}`);
  },
  thermals: (ids: number[]) => {
    return get<ThermalLight[]>(`/thermals?ids=${ids.join(",")}`);
  },

  async refreshWeather(id: number): Promise<FlightSummary> {
    const res = await fetch(`${BASE}/flights/${id}/refresh-weather`, { method: "POST" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  },

  async upload(files: FileList | File[]): Promise<UploadResult[]> {
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("files", f));
    const res = await fetch(`${BASE}/upload`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  },

  async importDriveFolder(url: string, maxFiles = 200): Promise<UploadResult[]> {
    const res = await fetch(`${BASE}/import-drive-folder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, max_files: maxFiles }),
    });
    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const body = await res.json();
        if (body.detail) detail = body.detail;
      } catch {
        // ignore
      }
      throw new Error(detail);
    }
    return res.json();
  },
};
