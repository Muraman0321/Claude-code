"""Flight analysis: derive speed, climb rate, thermals, glide ratio.

All algorithms work on a list of `Fix` records from `igc_parser`.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, asdict
from datetime import timedelta
from typing import Iterable

from igc_parser import Fix

EARTH_RADIUS_M = 6_371_000.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def offset_point(lat: float, lon: float, bearing_deg_val: float, distance_m: float) -> tuple[float, float]:
    """Compute the destination point given a start, a bearing, and a distance."""
    br = math.radians(bearing_deg_val)
    lat1 = math.radians(lat)
    lon1 = math.radians(lon)
    ang_dist = distance_m / EARTH_RADIUS_M
    lat2 = math.asin(
        math.sin(lat1) * math.cos(ang_dist)
        + math.cos(lat1) * math.sin(ang_dist) * math.cos(br)
    )
    lon2 = lon1 + math.atan2(
        math.sin(br) * math.sin(ang_dist) * math.cos(lat1),
        math.cos(ang_dist) - math.sin(lat1) * math.sin(lat2),
    )
    return math.degrees(lat2), math.degrees(lon2)


def offset_point_km(lat: float, lon: float, east_km: float, north_km: float) -> tuple[float, float]:
    """Approximate offset by east/north km (good enough at glider scales)."""
    new_lat = lat + (north_km / 111.0)
    new_lon = lon + (east_km / (111.0 * math.cos(math.radians(lat)) or 1e-9))
    return new_lat, new_lon


def sector_polygon(
    center_lat: float, center_lon: float, radius_km: float,
    bearing_from: float, bearing_to: float, arc_steps: int = 24,
) -> list[tuple[float, float]]:
    """Build a closed wedge polygon for rendering on a map."""
    pts: list[tuple[float, float]] = [(center_lat, center_lon)]
    for i in range(arc_steps + 1):
        b = bearing_from + (bearing_to - bearing_from) * i / arc_steps
        pts.append(offset_point(center_lat, center_lon, b, radius_km * 1000))
    pts.append((center_lat, center_lon))
    return pts


def grid_cell_polygon(
    center_lat: float, center_lon: float,
    dx_cells: int, dy_cells: int, cell_km: float,
) -> list[tuple[float, float]]:
    """Closed rectangle polygon for a 3x3 grid cell (dx/dy in {-1,0,1})."""
    cell_lat, cell_lon = offset_point_km(
        center_lat, center_lon, dx_cells * cell_km, dy_cells * cell_km,
    )
    half = cell_km / 2.0
    corners = [
        offset_point_km(cell_lat, cell_lon, -half, -half),
        offset_point_km(cell_lat, cell_lon, +half, -half),
        offset_point_km(cell_lat, cell_lon, +half, +half),
        offset_point_km(cell_lat, cell_lon, -half, +half),
    ]
    return corners + [corners[0]]


GRID_LABELS = {
    (-1, 1): "NW", (0, 1): "N", (1, 1): "NE",
    (-1, 0): "W", (0, 0): "C", (1, 0): "E",
    (-1, -1): "SW", (0, -1): "S", (1, -1): "SE",
}


@dataclass
class FixMetrics:
    timestamp: str  # ISO 8601
    latitude: float
    longitude: float
    altitude: int  # GPS altitude in meters
    pressure_altitude: int
    ground_speed_kmh: float  # km/h
    climb_rate_ms: float  # m/s, smoothed
    bearing_deg: float


@dataclass
class Thermal:
    start_index: int
    end_index: int
    start_time: str
    end_time: str
    duration_s: float
    altitude_gain_m: float
    avg_climb_rate_ms: float
    center_lat: float
    center_lon: float
    start_lat: float = 0.0
    start_lon: float = 0.0
    end_lat: float = 0.0
    end_lon: float = 0.0


@dataclass
class FlightSummary:
    duration_s: float
    total_distance_km: float  # cumulative ground track
    straight_distance_km: float  # great-circle takeoff to landing
    max_altitude_m: int
    min_altitude_m: int
    altitude_gain_m: float  # sum of all positive climbs
    max_climb_rate_ms: float
    avg_climb_rate_in_thermals_ms: float
    avg_ground_speed_kmh: float
    max_ground_speed_kmh: float
    best_glide_ratio: float
    thermal_count: int
    thermal_time_s: float
    cruise_time_s: float


def _smooth(values: list[float], window: int = 5) -> list[float]:
    if window <= 1 or not values:
        return list(values)
    half = window // 2
    out = []
    for i in range(len(values)):
        lo = max(0, i - half)
        hi = min(len(values), i + half + 1)
        chunk = values[lo:hi]
        out.append(sum(chunk) / len(chunk))
    return out


MAX_REAL_CLIMB_MS = 15.0  # physical sanity cap (winch ~25 m/s, but smoothed)
MAX_REAL_SPEED_KMH = 400.0  # gliders' VNE is ~300 km/h


def _altitude_for_climb(fix: Fix) -> int:
    """Prefer pressure altitude; fall back to GPS altitude if pressure is zero."""
    return fix.pressure_altitude if fix.pressure_altitude > 0 else fix.gps_altitude


def _altitude_for_display(fix: Fix) -> int:
    """Use GPS altitude when available; fall back to pressure altitude."""
    return fix.gps_altitude if fix.gps_altitude > 0 else fix.pressure_altitude


def compute_fix_metrics(fixes: list[Fix]) -> list[FixMetrics]:
    """Return per-fix derived metrics, with a smoothed climb rate.

    Uses pressure altitude for vertical speed (GPS altitude is noisy and
    occasionally drops to 0 when the GPS loses lock). Raw deltas are clipped
    to physical limits before smoothing.
    """
    if len(fixes) < 2:
        return []

    raw_climb = [0.0]
    raw_speed = [0.0]
    bearings = [0.0]
    for i in range(1, len(fixes)):
        prev = fixes[i - 1]
        curr = fixes[i]
        dt = (curr.timestamp - prev.timestamp).total_seconds()
        if dt <= 0:
            raw_climb.append(0.0)
            raw_speed.append(0.0)
            bearings.append(bearings[-1])
            continue

        dist_m = haversine_m(prev.latitude, prev.longitude, curr.latitude, curr.longitude)
        speed_kmh = dist_m / dt * 3.6
        if speed_kmh > MAX_REAL_SPEED_KMH:
            speed_kmh = 0.0  # GPS jump, ignore this sample

        dalt = _altitude_for_climb(curr) - _altitude_for_climb(prev)
        climb = dalt / dt
        if abs(climb) > MAX_REAL_CLIMB_MS:
            climb = 0.0  # sensor glitch, ignore

        raw_climb.append(climb)
        raw_speed.append(speed_kmh)
        bearings.append(bearing_deg(prev.latitude, prev.longitude, curr.latitude, curr.longitude))

    climb_smoothed = _smooth(raw_climb, window=7)
    speed_smoothed = _smooth(raw_speed, window=5)

    return [
        FixMetrics(
            timestamp=fixes[i].timestamp.isoformat(),
            latitude=fixes[i].latitude,
            longitude=fixes[i].longitude,
            altitude=_altitude_for_display(fixes[i]),
            pressure_altitude=fixes[i].pressure_altitude,
            ground_speed_kmh=round(speed_smoothed[i], 2),
            climb_rate_ms=round(climb_smoothed[i], 2),
            bearing_deg=round(bearings[i], 1),
        )
        for i in range(len(fixes))
    ]


def _tow_release_index(fixes: list[Fix], metrics: list[FixMetrics], min_gain_m: float = 50.0) -> int:
    """Return the first index after the initial tow climb ends.

    Looks for the first moment where the aircraft has gained at least
    min_gain_m from its takeoff altitude AND starts descending — this
    typically coincides with winch or aerotow release.

    Falls back to the end of the very first climb segment if no clear
    descent is found after the altitude gain.
    """
    if not fixes or not metrics:
        return 0

    # Takeoff = first fix where ground speed exceeds 15 km/h.
    move_start = next(
        (i for i, m in enumerate(metrics) if m.ground_speed_kmh > 15), 0
    )
    takeoff_alt = _altitude_for_display(fixes[move_start])
    peak_alt = takeoff_alt

    for i in range(move_start, len(metrics)):
        alt = _altitude_for_display(fixes[i])
        if alt > peak_alt:
            peak_alt = alt
        if peak_alt - takeoff_alt >= min_gain_m and metrics[i].climb_rate_ms < 0:
            return i

    # No clear release found: skip to end of the first climb segment.
    in_climb = False
    for i in range(move_start, len(metrics)):
        if metrics[i].climb_rate_ms > 0.1:
            in_climb = True
        elif in_climb:
            return i

    return move_start


def detect_thermals(
    fixes: list[Fix],
    metrics: list[FixMetrics],
    min_duration_s: float = 20.0,
    min_avg_climb_ms: float = 0.3,
) -> list[Thermal]:
    """Detect thermal segments: contiguous fixes with positive smoothed climb.

    The initial tow climb (winch or aerotow) is excluded automatically:
    any climb segment that starts before the estimated tow-release point
    (see _tow_release_index) is not counted as a thermal.
    """
    thermals: list[Thermal] = []
    if not fixes or not metrics:
        return thermals

    tow_end = _tow_release_index(fixes, metrics)

    start: int | None = None
    for i, m in enumerate(metrics):
        if m.climb_rate_ms > 0.1:
            if start is None:
                start = i
        else:
            if start is not None and i - start > 2:
                if start >= tow_end:  # skip segments inside the tow phase
                    segment = metrics[start:i]
                    duration = (fixes[i - 1].timestamp - fixes[start].timestamp).total_seconds()
                    if duration >= min_duration_s:
                        avg_climb = sum(s.climb_rate_ms for s in segment) / len(segment)
                        gain = fixes[i - 1].gps_altitude - fixes[start].gps_altitude
                        if avg_climb >= min_avg_climb_ms and gain > 5:
                            thermals.append(
                                Thermal(
                                    start_index=start,
                                    end_index=i - 1,
                                    start_time=fixes[start].timestamp.isoformat(),
                                    end_time=fixes[i - 1].timestamp.isoformat(),
                                    duration_s=duration,
                                    altitude_gain_m=gain,
                                    avg_climb_rate_ms=round(avg_climb, 2),
                                    center_lat=sum(f.latitude for f in fixes[start:i]) / (i - start),
                                    center_lon=sum(f.longitude for f in fixes[start:i]) / (i - start),
                                    start_lat=fixes[start].latitude,
                                    start_lon=fixes[start].longitude,
                                    end_lat=fixes[i - 1].latitude,
                                    end_lon=fixes[i - 1].longitude,
                                )
                            )
            start = None

    return thermals


def _best_glide_ratio(fixes: list[Fix], metrics: list[FixMetrics]) -> float:
    """Find the best glide ratio over rolling 60-second cruise windows."""
    best = 0.0
    if len(fixes) < 10:
        return best
    n = len(fixes)
    for i in range(0, n - 30):
        # 60s window where every fix shows non-climbing flight.
        end = i
        while end < n - 1 and (fixes[end].timestamp - fixes[i].timestamp).total_seconds() < 60:
            end += 1
        window = metrics[i : end + 1]
        if not window or any(m.climb_rate_ms > 0 for m in window):
            continue
        dist_m = 0.0
        for j in range(i + 1, end + 1):
            dist_m += haversine_m(
                fixes[j - 1].latitude,
                fixes[j - 1].longitude,
                fixes[j].latitude,
                fixes[j].longitude,
            )
        drop = fixes[i].gps_altitude - fixes[end].gps_altitude
        if drop > 5:
            ratio = dist_m / drop
            if ratio > best and ratio < 100:  # filter unrealistic outliers
                best = ratio
    return round(best, 2)


def compute_summary(fixes: list[Fix], metrics: list[FixMetrics], thermals: list[Thermal]) -> FlightSummary:
    if not fixes:
        return FlightSummary(
            duration_s=0, total_distance_km=0, straight_distance_km=0,
            max_altitude_m=0, min_altitude_m=0, altitude_gain_m=0,
            max_climb_rate_ms=0, avg_climb_rate_in_thermals_ms=0,
            avg_ground_speed_kmh=0, max_ground_speed_kmh=0,
            best_glide_ratio=0, thermal_count=0, thermal_time_s=0, cruise_time_s=0,
        )

    duration = (fixes[-1].timestamp - fixes[0].timestamp).total_seconds()
    total_dist_m = 0.0
    altitude_gain = 0.0
    for i in range(1, len(fixes)):
        dt = (fixes[i].timestamp - fixes[i - 1].timestamp).total_seconds()
        seg = haversine_m(
            fixes[i - 1].latitude, fixes[i - 1].longitude,
            fixes[i].latitude, fixes[i].longitude,
        )
        # Skip GPS-jump segments when accumulating distance.
        if dt > 0 and seg / dt * 3.6 <= MAX_REAL_SPEED_KMH:
            total_dist_m += seg
        # Use the smoothed/clipped climb to sum altitude gain.
        if dt > 0 and metrics[i].climb_rate_ms > 0:
            altitude_gain += metrics[i].climb_rate_ms * dt

    straight_dist_m = haversine_m(
        fixes[0].latitude, fixes[0].longitude,
        fixes[-1].latitude, fixes[-1].longitude,
    )

    altitudes = [_altitude_for_display(f) for f in fixes if _altitude_for_display(f) > 0]
    if not altitudes:
        altitudes = [0]
    speeds = [m.ground_speed_kmh for m in metrics]
    climbs = [m.climb_rate_ms for m in metrics]

    thermal_time = sum(t.duration_s for t in thermals)
    avg_thermal_climb = (
        sum(t.avg_climb_rate_ms * t.duration_s for t in thermals) / thermal_time
        if thermal_time > 0 else 0.0
    )

    return FlightSummary(
        duration_s=duration,
        total_distance_km=round(total_dist_m / 1000, 2),
        straight_distance_km=round(straight_dist_m / 1000, 2),
        max_altitude_m=max(altitudes),
        min_altitude_m=min(altitudes),
        altitude_gain_m=round(altitude_gain, 1),
        max_climb_rate_ms=round(max(climbs), 2),
        avg_climb_rate_in_thermals_ms=round(avg_thermal_climb, 2),
        avg_ground_speed_kmh=round(sum(speeds) / len(speeds), 2),
        max_ground_speed_kmh=round(max(speeds), 2),
        best_glide_ratio=_best_glide_ratio(fixes, metrics),
        thermal_count=len(thermals),
        thermal_time_s=round(thermal_time, 1),
        cruise_time_s=round(max(duration - thermal_time, 0), 1),
    )


@dataclass
class PhaseBoundaries:
    """Detected phase boundaries for winch launch analysis."""
    tow_phase_end_fix_seq: int | None  # sequence at 80m altitude
    mid_phase_end_fix_seq: int | None  # sequence where climb rate drops < 2.0 m/s
    release_altitude_m: float | None  # altitude at tow release
    release_fix_seq: int | None  # sequence of release fix


def detect_winch_phases(
    fixes: list[Fix],
    metrics: list[FixMetrics],
) -> PhaseBoundaries:
    """Detect winch launch phase boundaries.

    Returns indices for:
    - Initial phase end: first fix at altitude >= 80m
    - Mid phase end: first fix where climb rate < 2.0 m/s sustained for >= 3 seconds
    - Release altitude and sequence: the tow cut point
    """
    if not fixes or not metrics:
        return PhaseBoundaries(None, None, None, None)

    # Find release point (tow cut)
    release_idx = _tow_release_index(fixes, metrics)
    release_alt = _altitude_for_display(fixes[release_idx])

    # Find takeoff point (first movement)
    move_start = next(
        (i for i, m in enumerate(metrics) if m.ground_speed_kmh > 15), 0
    )
    takeoff_alt = _altitude_for_display(fixes[move_start])

    # Find initial phase end: first fix at >= 80m altitude
    initial_end_idx = None
    for i in range(move_start, release_idx + 1):
        alt = _altitude_for_display(fixes[i])
        if alt - takeoff_alt >= 80:
            initial_end_idx = i
            break

    # Find mid phase end: first sustained (>= 3s) segment where climb < 2.0 m/s
    # Start search from initial phase end (or from release if initial didn't reach 80m)
    search_start = initial_end_idx if initial_end_idx else move_start
    mid_end_idx = None

    if search_start < release_idx:
        # Look for a 3-second window where climb rate stays below 2.0 m/s
        for i in range(search_start, release_idx):
            # Find the timestamp 3 seconds forward
            target_time = fixes[i].timestamp + timedelta(seconds=3)

            # Find the first index at or after this target time
            end_window = i
            while end_window < release_idx and fixes[end_window].timestamp < target_time:
                end_window += 1

            # Check if all fixes in this window have climb < 2.0 m/s
            window_metrics = metrics[i:end_window + 1]
            if window_metrics and all(m.climb_rate_ms < 2.0 for m in window_metrics):
                mid_end_idx = i
                break

    return PhaseBoundaries(
        tow_phase_end_fix_seq=initial_end_idx,
        mid_phase_end_fix_seq=mid_end_idx,
        release_altitude_m=float(release_alt),
        release_fix_seq=release_idx,
    )


@dataclass
class PhaseMetrics:
    """Metrics for a single winch launch phase."""
    duration_s: float
    avg_speed_kmh: float
    avg_climb_rate_ms: float

    # Optional phase-specific metrics
    altitude_gained_m: float | None = None
    max_speed_kmh: float | None = None
    stability_score: float | None = None  # roll/pitch variance (0-1)
    efficiency_vs_baseline_pct: float | None = None


def compute_phase_metrics(
    fixes: list[Fix],
    metrics: list[FixMetrics],
    boundaries: PhaseBoundaries,
) -> dict[str, PhaseMetrics]:
    """Compute per-phase metrics for winch launch analysis.

    Returns a dict with 'initial', 'mid', 'late' keys, each containing PhaseMetrics.
    """
    result = {}

    if not fixes or not metrics:
        return result

    move_start = next(
        (i for i, m in enumerate(metrics) if m.ground_speed_kmh > 15), 0
    )
    release_idx = boundaries.release_fix_seq or len(fixes) - 1

    def compute_segment_metrics(start_idx: int, end_idx: int) -> PhaseMetrics:
        """Helper to compute metrics for a segment."""
        if start_idx >= end_idx or start_idx >= len(fixes):
            return PhaseMetrics(0, 0, 0)

        segment_metrics = metrics[start_idx:end_idx + 1]
        segment_fixes = fixes[start_idx:end_idx + 1]

        duration = (fixes[end_idx].timestamp - fixes[start_idx].timestamp).total_seconds()
        avg_speed = sum(m.ground_speed_kmh for m in segment_metrics) / len(segment_metrics) if segment_metrics else 0
        avg_climb = sum(m.climb_rate_ms for m in segment_metrics) / len(segment_metrics) if segment_metrics else 0

        alt_gain = _altitude_for_display(segment_fixes[-1]) - _altitude_for_display(segment_fixes[0])
        max_speed = max((m.ground_speed_kmh for m in segment_metrics), default=0)

        return PhaseMetrics(
            duration_s=round(duration, 2),
            avg_speed_kmh=round(avg_speed, 2),
            avg_climb_rate_ms=round(avg_climb, 2),
            altitude_gained_m=round(alt_gain, 1),
            max_speed_kmh=round(max_speed, 2),
        )

    # Initial phase: from takeoff to 80m or release
    initial_end = boundaries.tow_phase_end_fix_seq if boundaries.tow_phase_end_fix_seq else release_idx
    if move_start < initial_end:
        result["initial"] = compute_segment_metrics(move_start, initial_end)

    # Mid phase: from initial end to mid end or release
    if boundaries.tow_phase_end_fix_seq and boundaries.mid_phase_end_fix_seq:
        if boundaries.tow_phase_end_fix_seq < boundaries.mid_phase_end_fix_seq:
            result["mid"] = compute_segment_metrics(
                boundaries.tow_phase_end_fix_seq,
                boundaries.mid_phase_end_fix_seq,
            )
    elif boundaries.tow_phase_end_fix_seq and boundaries.tow_phase_end_fix_seq < release_idx:
        # No clear mid phase end found, use release as boundary
        result["mid"] = compute_segment_metrics(
            boundaries.tow_phase_end_fix_seq,
            release_idx,
        )

    # Late phase: from mid end (or initial end) to release
    late_start_idx = boundaries.mid_phase_end_fix_seq if boundaries.mid_phase_end_fix_seq else (
        boundaries.tow_phase_end_fix_seq if boundaries.tow_phase_end_fix_seq else move_start
    )
    if late_start_idx < release_idx:
        late_metrics = compute_segment_metrics(late_start_idx, release_idx)
        late_metrics.altitude_gained_m = boundaries.release_altitude_m - _altitude_for_display(fixes[late_start_idx])
        result["late"] = late_metrics

    return result


def to_dict(obj) -> dict:
    return asdict(obj)
