import type {
  AircraftStats,
  FlightDetail,
  FlightSummary,
  PilotStats,
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
  timeOfDayStats: (params: { pilot?: string; aircraft?: string } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    const q = qs.toString();
    return get<TimeOfDayBucket[]>(`/stats/time-of-day${q ? `?${q}` : ""}`);
  },
  weatherStats: () => get<WeatherBucket[]>("/stats/weather"),

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
};
