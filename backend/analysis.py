"""Flight analysis: derive speed, climb rate, thermals, glide ratio.

All algorithms work on a list of `Fix` records from `igc_parser`.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, asdict
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


def detect_thermals(
    fixes: list[Fix],
    metrics: list[FixMetrics],
    min_duration_s: float = 30.0,
    min_avg_climb_ms: float = 0.5,
) -> list[Thermal]:
    """Detect thermal segments: contiguous fixes with positive smoothed climb."""
    thermals: list[Thermal] = []
    if not fixes or not metrics:
        return thermals

    start: int | None = None
    for i, m in enumerate(metrics):
        if m.climb_rate_ms > 0.2:
            if start is None:
                start = i
        else:
            if start is not None and i - start > 2:
                segment = metrics[start:i]
                duration = (fixes[i - 1].timestamp - fixes[start].timestamp).total_seconds()
                if duration >= min_duration_s:
                    avg_climb = sum(s.climb_rate_ms for s in segment) / len(segment)
                    gain = fixes[i - 1].gps_altitude - fixes[start].gps_altitude
                    if avg_climb >= min_avg_climb_ms and gain > 10:
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


def to_dict(obj) -> dict:
    return asdict(obj)
