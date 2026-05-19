export const EARTH_RADIUS_M = 6_371_000.0;

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const x = Math.sin(dl) * Math.cos(p2);
  const y = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

export function offsetPoint(
  lat: number,
  lon: number,
  bearingDegVal: number,
  distanceM: number,
): [number, number] {
  const br = (bearingDegVal * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const angDist = distanceM / EARTH_RADIUS_M;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angDist) + Math.cos(lat1) * Math.sin(angDist) * Math.cos(br),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(br) * Math.sin(angDist) * Math.cos(lat1),
      Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [(lat2 * 180) / Math.PI, (lon2 * 180) / Math.PI];
}

export function offsetPointKm(
  lat: number,
  lon: number,
  eastKm: number,
  northKm: number,
): [number, number] {
  const newLat = lat + northKm / 111.0;
  const newLon = lon + eastKm / (111.0 * Math.cos((lat * Math.PI) / 180) || 1e-9);
  return [newLat, newLon];
}

export function sectorPolygon(
  centerLat: number,
  centerLon: number,
  radiusKm: number,
  bearingFrom: number,
  bearingTo: number,
  arcSteps = 24,
): [number, number][] {
  const pts: [number, number][] = [[centerLat, centerLon]];
  for (let i = 0; i <= arcSteps; i++) {
    const b = bearingFrom + ((bearingTo - bearingFrom) * i) / arcSteps;
    pts.push(offsetPoint(centerLat, centerLon, b, radiusKm * 1000));
  }
  pts.push([centerLat, centerLon]);
  return pts;
}

export function gridCellPolygon(
  centerLat: number,
  centerLon: number,
  dxCells: number,
  dyCells: number,
  cellKm: number,
): [number, number][] {
  const [cellLat, cellLon] = offsetPointKm(
    centerLat,
    centerLon,
    dxCells * cellKm,
    dyCells * cellKm,
  );
  const half = cellKm / 2;
  const corners: [number, number][] = [
    offsetPointKm(cellLat, cellLon, -half, -half),
    offsetPointKm(cellLat, cellLon, +half, -half),
    offsetPointKm(cellLat, cellLon, +half, +half),
    offsetPointKm(cellLat, cellLon, -half, +half),
  ];
  return [...corners, corners[0]];
}
