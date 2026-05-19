// Client API surface for the pages.
//
// All work is done in the browser plus Supabase — no application server:
//   IGC parsing & metrics → analyzeIgcFile (utils/analyzeIgc)
//   Flight + thermals persistence → Supabase Postgres
//   GPS-fix blobs → Supabase Storage
//   Weather → Open-Meteo (direct browser call)
//   Stats aggregations → lib/stats
//
// Page-facing function signatures are preserved so the existing pages keep working.

import type {
  AircraftStats,
  AreaStats,
  BlockStats,
  FlightDetail,
  FlightPhaseAnalysis,
  FlightSummary,
  FlightTrack,
  PilotStats,
  SeasonBucket,
  ThermalLight,
  TimeOfDayBucket,
  UploadResult,
  WeatherBucket,
} from "../types";
import { AnalyzeError, analyzeIgcFile } from "../utils/analyzeIgc";
import { ensureSession } from "../lib/storage/auth";
import * as flightsDb from "../lib/storage/flights";
import { fetchWeather } from "../lib/weather/openMeteo";
import {
  aircraftStats as computeAircraftStats,
  pilotStats as computePilotStats,
  seasonStats as computeSeasonStats,
  timeOfDayStats as computeTimeOfDayStats,
  weatherStats as computeWeatherStats,
} from "../lib/stats/aggregate";
import {
  areaGrid as computeAreaGrid,
  areaSectors as computeAreaSectors,
  blockStatsLocal,
  MENUMA_LAT,
  MENUMA_LON,
  type BlockShape,
  type BlockStatsInput,
} from "../lib/stats/area";

async function ingestOne(file: File): Promise<UploadResult> {
  try {
    const payload = await analyzeIgcFile(file);
    let weather: Record<string, number | string | null> | null = null;
    try {
      const wx = await fetchWeather(
        payload.start.latitude,
        payload.start.longitude,
        payload.start.timestamp,
        payload.end.timestamp,
      );
      if (wx) weather = { ...wx };
    } catch (e) {
      console.warn("weather fetch failed:", e);
    }
    const { flight_id } = await flightsDb.saveFlight(payload, weather);
    return {
      filename: payload.filename,
      success: true,
      flight_id,
      error: null,
      normalized_from: payload.normalized_from,
      normalization_notes: payload.normalization_notes,
    };
  } catch (e) {
    if (e instanceof AnalyzeError) {
      return {
        filename: e.finalName,
        success: false,
        flight_id: null,
        error: e.message,
        normalized_from: e.normalizedFrom,
        normalization_notes: e.notes,
      };
    }
    return {
      filename: file.name,
      success: false,
      flight_id: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export const api = {
  async listFlights(params: {
    pilot?: string;
    aircraft?: string;
    date_from?: string;
    date_to?: string;
  } = {}): Promise<FlightSummary[]> {
    await ensureSession();
    return flightsDb.listFlights(params);
  },

  async getFlight(id: number): Promise<FlightDetail> {
    await ensureSession();
    return flightsDb.getFlight(id);
  },

  async getFlightPhaseAnalysis(id: number): Promise<FlightPhaseAnalysis> {
    // Call backend API for phase analysis
    const response = await fetch(`/api/flights/${id}/phase-analysis`);
    if (!response.ok) {
      throw new Error(`phase analysis failed: ${response.statusText}`);
    }
    return response.json();
  },

  async deleteFlight(id: number): Promise<void> {
    await ensureSession();
    return flightsDb.deleteFlight(id);
  },

  async listPilots(): Promise<string[]> {
    await ensureSession();
    return flightsDb.listPilots();
  },

  async listAircraft(): Promise<string[]> {
    await ensureSession();
    return flightsDb.listAircraft();
  },

  async pilotStats(): Promise<PilotStats[]> {
    await ensureSession();
    const flights = await flightsDb.listFlights();
    return computePilotStats(flights);
  },

  async aircraftStats(): Promise<AircraftStats[]> {
    await ensureSession();
    const flights = await flightsDb.listFlights();
    return computeAircraftStats(flights);
  },

  async timeOfDayStats(
    filter: { pilot?: string; aircraft?: string; season?: string } = {},
  ): Promise<TimeOfDayBucket[]> {
    await ensureSession();
    const [thermals, flights] = await Promise.all([
      flightsDb.listAllThermals(),
      flightsDb.listFlights(),
    ]);
    return computeTimeOfDayStats(thermals, flights, filter);
  },

  async weatherStats(): Promise<WeatherBucket[]> {
    await ensureSession();
    const flights = await flightsDb.listFlights();
    return computeWeatherStats(flights);
  },

  async seasonStats(filter: { pilot?: string; aircraft?: string } = {}): Promise<SeasonBucket[]> {
    await ensureSession();
    const flights = await flightsDb.listFlights();
    return computeSeasonStats(flights, filter);
  },

  async areaSectors(params: {
    center_lat?: number;
    center_lon?: number;
    radius_km?: number;
    n_sectors?: number;
  } = {}): Promise<AreaStats> {
    await ensureSession();
    const thermals = await flightsDb.listAllThermals();
    return computeAreaSectors({
      thermals,
      centerLat: params.center_lat,
      centerLon: params.center_lon,
      radiusKm: params.radius_km,
      nSectors: params.n_sectors,
    });
  },

  async areaGrid(params: {
    center_lat?: number;
    center_lon?: number;
    cell_km?: number;
    grid_size?: number;
  } = {}): Promise<AreaStats> {
    await ensureSession();
    const thermals = await flightsDb.listAllThermals();
    return computeAreaGrid({
      thermals,
      centerLat: params.center_lat,
      centerLon: params.center_lon,
      cellKm: params.cell_km,
      gridSize: params.grid_size,
    });
  },

  async tracks(ids: number[], maxPoints = 120): Promise<FlightTrack[]> {
    await ensureSession();
    return flightsDb.listTracks(ids, maxPoints);
  },

  async thermals(ids: number[]): Promise<ThermalLight[]> {
    await ensureSession();
    const all = await flightsDb.listAllThermals();
    const set = new Set(ids);
    return all.filter((t) => set.has(t.flight_id));
  },

  async allThermals(): Promise<ThermalLight[]> {
    await ensureSession();
    return flightsDb.listAllThermals();
  },

  async blockStats(params: {
    shape: "sector" | "cell";
    center_lat: number;
    center_lon: number;
    block_label?: string;
    bearing_from?: number;
    bearing_to?: number;
    radius_km?: number;
    dx?: number;
    dy?: number;
    cell_km?: number;
  }): Promise<BlockStats> {
    await ensureSession();
    const shape: BlockShape =
      params.shape === "sector"
        ? {
            shape: "sector",
            centerLat: params.center_lat,
            centerLon: params.center_lon,
            bearingFrom: params.bearing_from ?? 0,
            bearingTo: params.bearing_to ?? 360,
            radiusKm: params.radius_km ?? 9,
          }
        : {
            shape: "cell",
            centerLat: params.center_lat,
            centerLon: params.center_lon,
            dx: params.dx ?? 0,
            dy: params.dy ?? 0,
            cellKm: params.cell_km ?? 6,
          };

    // Block-stats needs fix-level data. Pull all flights' fixes once.
    // For free-tier Supabase Storage this is bounded (≈100KB/flight gzipped).
    const flights = await flightsDb.listFlights();
    const inputs: BlockStatsInput[] = [];
    for (const f of flights) {
      const detail = await flightsDb.getFlight(f.id);
      inputs.push({
        flightId: f.id,
        flightDate: f.flight_date,
        fixes: detail.fixes,
      });
    }
    return blockStatsLocal(shape, params.block_label ?? "Block", inputs);
  },

  async cleanDuplicates(): Promise<number> {
    await ensureSession();
    return flightsDb.cleanDuplicateFlights();
  },

  async refreshWeather(id: number): Promise<FlightSummary> {
    await ensureSession();
    const detail = await flightsDb.getFlight(id);
    const startLat = detail.start_latitude ?? (detail.fixes[0]?.latitude ?? MENUMA_LAT);
    const startLon = detail.start_longitude ?? (detail.fixes[0]?.longitude ?? MENUMA_LON);
    const startIso = detail.started_at ?? detail.fixes[0]?.timestamp ?? new Date().toISOString();
    const endIso = detail.ended_at ?? detail.fixes[detail.fixes.length - 1]?.timestamp ?? startIso;
    const wx = await fetchWeather(startLat, startLon, startIso, endIso);
    if (!wx) throw new Error("weather lookup failed");
    return flightsDb.updateWeather(id, { ...wx });
  },

  async upload(
    files: FileList | File[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<UploadResult[]> {
    await ensureSession();
    const all = Array.from(files);
    const results: UploadResult[] = [];
    for (let i = 0; i < all.length; i++) {
      results.push(await ingestOne(all[i]));
      onProgress?.(i + 1, all.length);
    }
    return results;
  },
};
