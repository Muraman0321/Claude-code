import type { FlightSummary } from "../types";

/**
 * Whether a record represents a real flight with a GPS track.
 *
 * Some records carry only thermal data with no usable track (split/fragment
 * uploads): their duration and distance are null/0. Those are hidden from the
 * flight lists on the dashboard and comparison views — but NOT deleted, so their
 * thermals still show on the map / area / statistics screens.
 *
 * Conservative on purpose: a record is kept if it has EITHER a positive duration
 * or a positive distance, so a genuine flight is never hidden by accident.
 */
export function hasFlightTrack(f: FlightSummary): boolean {
  const hasDuration = f.duration_s != null && f.duration_s > 0;
  const hasDistance = f.total_distance_km != null && f.total_distance_km > 0;
  return hasDuration || hasDistance;
}
