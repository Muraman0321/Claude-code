import type {
  AreaBlock,
  AreaStats,
  BlockStats,
  Fix,
  HistogramBin,
  HistogramGroup,
  HourCell,
  ThermalLight,
} from "../../types";
import { bearingDeg, gridCellPolygon, haversineM, sectorPolygon } from "../../utils/geo";

// Default center: Menuma glider field — matches the legacy backend.
export const MENUMA_LAT = 36.2114;
export const MENUMA_LON = 139.4189;

const SEASONS: { label: string; key: "spring" | "summer" | "autumn" | "winter"; months: number[] }[] = [
  { label: "春", key: "spring", months: [3, 4, 5] },
  { label: "夏", key: "summer", months: [6, 7, 8] },
  { label: "秋", key: "autumn", months: [9, 10, 11] },
  { label: "冬", key: "winter", months: [12, 1, 2] },
];

const GRID_LABELS_3x3: Record<string, string> = {
  "-1,1": "NW", "0,1": "N", "1,1": "NE",
  "-1,0": "W",  "0,0": "C", "1,0": "E",
  "-1,-1": "SW","0,-1": "S","1,-1": "SE",
};

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function seasonOf(month: number): { label: string; key: "spring" | "summer" | "autumn" | "winter" } {
  for (const s of SEASONS) if (s.months.includes(month)) return s;
  return SEASONS[3];
}

function mean(xs: number[], digits = 2): number | null {
  if (xs.length === 0) return null;
  return round(xs.reduce((a, b) => a + b, 0) / xs.length, digits);
}

function hourCellsFromGroups(byHour: Map<number, number[]>): HourCell[] {
  const hours = Array.from(byHour.keys()).sort((a, b) => a - b);
  return hours.map((h) => {
    const climbs = byHour.get(h)!;
    return {
      hour: h,
      thermal_count: climbs.length,
      avg_climb_rate_ms: round(climbs.reduce((a, b) => a + b, 0) / climbs.length, 2),
    };
  });
}

function blockStatsFromThermals(records: ThermalLight[], byHour: Map<number, number[]>) {
  if (records.length === 0) {
    return {
      thermal_count: 0,
      total_thermal_time_s: 0,
      avg_climb_rate_ms: null,
      max_climb_rate_ms: null,
      avg_altitude_gain_m: null,
      by_hour: hourCellsFromGroups(byHour),
    };
  }
  const climbs = records.map((r) => r.avg_climb_rate_ms);
  const gains = records.map((r) => r.altitude_gain_m);
  return {
    thermal_count: records.length,
    total_thermal_time_s: records.reduce((s, r) => s + r.duration_s, 0),
    avg_climb_rate_ms: round(climbs.reduce((a, b) => a + b, 0) / climbs.length, 2),
    max_climb_rate_ms: round(Math.max(...climbs), 2),
    avg_altitude_gain_m: round(gains.reduce((a, b) => a + b, 0) / gains.length, 1),
    by_hour: hourCellsFromGroups(byHour),
  };
}

export interface AreaSectorsParams {
  thermals: ThermalLight[];
  centerLat?: number;
  centerLon?: number;
  radiusKm?: number;
  nSectors?: number;
}

export function areaSectors({
  thermals,
  centerLat = MENUMA_LAT,
  centerLon = MENUMA_LON,
  radiusKm = 9.0,
  nSectors = 9,
}: AreaSectorsParams): AreaStats {
  const n = Math.max(4, Math.min(36, nSectors));
  const sectorDeg = 360.0 / n;

  const grouped: ThermalLight[][] = Array.from({ length: n }, () => []);
  const byHour: Map<number, number[]>[] = Array.from({ length: n }, () => new Map());

  for (const t of thermals) {
    const dM = haversineM(centerLat, centerLon, t.center_lat, t.center_lon);
    if (dM > radiusKm * 1000) continue;
    const b = bearingDeg(centerLat, centerLon, t.center_lat, t.center_lon);
    const idx = Math.floor(b / sectorDeg) % n;
    grouped[idx].push(t);
    const list = byHour[idx].get(t.local_hour) ?? [];
    list.push(t.avg_climb_rate_ms);
    byHour[idx].set(t.local_hour, list);
  }

  const blocks: AreaBlock[] = [];
  for (let i = 0; i < n; i++) {
    const bf = i * sectorDeg;
    const bt = (i + 1) * sectorDeg;
    const polygon = sectorPolygon(centerLat, centerLon, radiusKm, bf, bt);
    const stats = blockStatsFromThermals(grouped[i], byHour[i]);
    blocks.push({
      id: `sector_${i}`,
      label: `S${i + 1} (${Math.floor(bf)}°–${Math.floor(bt)}°)`,
      bearing_from: bf,
      bearing_to: bt,
      geometry: polygon,
      ...stats,
    });
  }
  return {
    kind: "sectors",
    center_lat: centerLat,
    center_lon: centerLon,
    radius_km: radiusKm,
    cell_km: null,
    blocks,
  };
}

export interface AreaGridParams {
  thermals: ThermalLight[];
  centerLat?: number;
  centerLon?: number;
  cellKm?: number;
  gridSize?: number;
}

function gridLabel(dx: number, dy: number, half: number): string {
  if (half === 1) return GRID_LABELS_3x3[`${dx},${dy}`] ?? `${dx}/${dy}`;
  const row = half + 1 - dy;
  const col = dx + half + 1;
  return `R${row}C${col}`;
}

export function areaGrid({
  thermals,
  centerLat = MENUMA_LAT,
  centerLon = MENUMA_LON,
  cellKm = 6.0,
  gridSize = 3,
}: AreaGridParams): AreaStats {
  let n = Math.max(3, Math.min(9, gridSize));
  if (n % 2 === 0) n += 1;
  const half = (n - 1) / 2;

  const latPerKm = 1.0 / 111.0;
  const lonPerKm = 1.0 / (111.0 * Math.cos((centerLat * Math.PI) / 180) || 1e-9);
  const extentLat = cellKm * latPerKm;
  const extentLon = cellKm * lonPerKm;

  const cells = new Map<string, ThermalLight[]>();
  const byHour = new Map<string, Map<number, number[]>>();
  for (let dx = -half; dx <= half; dx++) {
    for (let dy = -half; dy <= half; dy++) {
      cells.set(`${dx},${dy}`, []);
      byHour.set(`${dx},${dy}`, new Map());
    }
  }

  for (const t of thermals) {
    const dLat = t.center_lat - centerLat;
    const dLon = t.center_lon - centerLon;
    const ratioY = dLat / extentLat;
    const ratioX = dLon / extentLon;
    if (Math.abs(ratioX) > half + 0.5 || Math.abs(ratioY) > half + 0.5) continue;
    const ix = Math.max(-half, Math.min(half, Math.round(ratioX)));
    const iy = Math.max(-half, Math.min(half, Math.round(ratioY)));
    const key = `${ix},${iy}`;
    cells.get(key)!.push(t);
    const m = byHour.get(key)!;
    const list = m.get(t.local_hour) ?? [];
    list.push(t.avg_climb_rate_ms);
    m.set(t.local_hour, list);
  }

  const blocks: AreaBlock[] = [];
  for (let dx = -half; dx <= half; dx++) {
    for (let dy = -half; dy <= half; dy++) {
      const key = `${dx},${dy}`;
      const records = cells.get(key)!;
      const polygon = gridCellPolygon(centerLat, centerLon, dx, dy, cellKm);
      const stats = blockStatsFromThermals(records, byHour.get(key)!);
      blocks.push({
        id: `cell_${dx}_${dy}`,
        label: gridLabel(dx, dy, half),
        bearing_from: null,
        bearing_to: null,
        geometry: polygon,
        ...stats,
      });
    }
  }

  return {
    kind: "grid",
    center_lat: centerLat,
    center_lon: centerLon,
    radius_km: null,
    cell_km: cellKm,
    blocks,
  };
}

// ─────────────────────────────── block-stats ───────────────────────────────

const CLIMB_BIN_EDGES = [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0];
const SINK_BIN_EDGES = [0.0, 0.5, 1.0, 1.5, 2.0, 3.0, 5.0];

function binLabel(lo: number, hi: number | null, unit = "m/s"): string {
  const fmt = (v: number) => (Number.isInteger(v) ? v.toFixed(0) : v.toString());
  return hi == null ? `${fmt(lo)}+ ${unit}` : `${fmt(lo)}–${fmt(hi)} ${unit}`;
}

function makeHistogram(values: number[], edges: number[]): HistogramBin[] {
  const counts = new Array<number>(edges.length).fill(0);
  for (const v of values) {
    let placed = false;
    for (let i = 0; i < edges.length - 1; i++) {
      if (v < edges[i + 1]) {
        counts[i]++;
        placed = true;
        break;
      }
    }
    if (!placed) counts[counts.length - 1]++;
  }
  const bins: HistogramBin[] = [];
  for (let i = 0; i < edges.length; i++) {
    const lo = edges[i];
    const hi = i + 1 < edges.length ? edges[i + 1] : null;
    bins.push({ label: binLabel(lo, hi), lo, hi, count: counts[i] });
  }
  return bins;
}

function buildGroup(
  label: string,
  key: string,
  climbs: number[],
  sinks: number[],
  flightIds: Set<number>,
): HistogramGroup {
  return {
    label,
    key,
    flight_count: flightIds.size,
    fix_count: climbs.length + sinks.length,
    climb_mean_ms: mean(climbs),
    sink_mean_ms: mean(sinks),
    climb_hist: makeHistogram(climbs, CLIMB_BIN_EDGES),
    sink_hist: makeHistogram(sinks, SINK_BIN_EDGES),
  };
}

export type BlockShape =
  | {
      shape: "sector";
      centerLat: number;
      centerLon: number;
      bearingFrom: number;
      bearingTo: number;
      radiusKm: number;
    }
  | {
      shape: "cell";
      centerLat: number;
      centerLon: number;
      dx: number;
      dy: number;
      cellKm: number;
    };

function inSector(
  lat: number,
  lon: number,
  cLat: number,
  cLon: number,
  radiusKm: number,
  bearingFrom: number,
  bearingTo: number,
): boolean {
  if (haversineM(cLat, cLon, lat, lon) > radiusKm * 1000) return false;
  const b = bearingDeg(cLat, cLon, lat, lon);
  return b >= bearingFrom && b < bearingTo;
}

function inCell(
  lat: number,
  lon: number,
  cLat: number,
  cLon: number,
  cellKm: number,
  dx: number,
  dy: number,
): boolean {
  const latPerKm = 1.0 / 111.0;
  const lonPerKm = 1.0 / (111.0 * Math.cos((cLat * Math.PI) / 180) || 1e-9);
  const ratioY = (lat - cLat) / (cellKm * latPerKm);
  const ratioX = (lon - cLon) / (cellKm * lonPerKm);
  return Math.abs(ratioX - dx) <= 0.5 && Math.abs(ratioY - dy) <= 0.5;
}

export interface BlockStatsInput {
  flightDate: string;
  flightId: number;
  fixes: Fix[];
}

/** Compute block-stats from already-loaded fix data. Callers (page) fetch fixes per flight. */
export function blockStatsLocal(
  shape: BlockShape,
  blockLabel: string,
  flights: BlockStatsInput[],
): BlockStats {
  const inBlock = (lat: number, lon: number): boolean =>
    shape.shape === "sector"
      ? inSector(lat, lon, shape.centerLat, shape.centerLon, shape.radiusKm, shape.bearingFrom, shape.bearingTo)
      : inCell(lat, lon, shape.centerLat, shape.centerLon, shape.cellKm, shape.dx, shape.dy);

  const allClimbs: number[] = [];
  const allSinks: number[] = [];
  const allFlights = new Set<number>();
  const seasonClimbs = new Map<string, number[]>();
  const seasonSinks = new Map<string, number[]>();
  const seasonFlights = new Map<string, Set<number>>();
  const dayClimbs = new Map<string, number[]>();
  const daySinks = new Map<string, number[]>();
  const dayFlights = new Map<string, Set<number>>();
  for (const s of SEASONS) {
    seasonClimbs.set(s.key, []);
    seasonSinks.set(s.key, []);
    seasonFlights.set(s.key, new Set());
  }

  for (const f of flights) {
    const month = new Date(f.flightDate + "T00:00:00Z").getUTCMonth() + 1;
    const { key: skey } = seasonOf(month);
    let touched = false;
    for (const fx of f.fixes) {
      const cr = fx.climb_rate_ms;
      if (cr == null) continue;
      if (!inBlock(fx.latitude, fx.longitude)) continue;
      touched = true;
      if (cr > 0) {
        allClimbs.push(cr);
        seasonClimbs.get(skey)!.push(cr);
        if (!dayClimbs.has(f.flightDate)) dayClimbs.set(f.flightDate, []);
        dayClimbs.get(f.flightDate)!.push(cr);
      } else if (cr < 0) {
        const s = -cr;
        allSinks.push(s);
        seasonSinks.get(skey)!.push(s);
        if (!daySinks.has(f.flightDate)) daySinks.set(f.flightDate, []);
        daySinks.get(f.flightDate)!.push(s);
      }
    }
    if (touched) {
      allFlights.add(f.flightId);
      seasonFlights.get(skey)!.add(f.flightId);
      if (!dayFlights.has(f.flightDate)) dayFlights.set(f.flightDate, new Set());
      dayFlights.get(f.flightDate)!.add(f.flightId);
    }
  }

  const bySeason: HistogramGroup[] = [];
  for (const s of SEASONS) {
    const fs = seasonFlights.get(s.key)!;
    if (fs.size === 0) continue;
    bySeason.push(
      buildGroup(s.label, s.key, seasonClimbs.get(s.key)!, seasonSinks.get(s.key)!, fs),
    );
  }

  const byDay: HistogramGroup[] = [];
  for (const d of Array.from(dayFlights.keys()).sort()) {
    byDay.push(buildGroup(d, d, dayClimbs.get(d) ?? [], daySinks.get(d) ?? [], dayFlights.get(d)!));
  }

  return {
    block_label: blockLabel || "Block",
    total_fixes: allClimbs.length + allSinks.length,
    total_flights: allFlights.size,
    overall: buildGroup("全データ", "all", allClimbs, allSinks, allFlights),
    by_season: bySeason,
    by_day: byDay,
  };
}
