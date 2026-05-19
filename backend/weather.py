"""Fetch weather snapshots from Open-Meteo (free, no API key required).

We fetch hourly data covering the full flight window [start_dt, end_dt] and
average across all hours that fall within the flight.  This gives a better
representation of in-flight conditions than the single takeoff snapshot.

Cloud base is derived from the averaged temperature and dew point using
Howell's formula: cloud_base_m = (T - Td) / 2.5 * 1000.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx


@dataclass
class WeatherSnapshot:
    temp_c: float | None
    wind_speed_kmh: float | None
    wind_dir_deg: float | None
    pressure_hpa: float | None
    cloud_cover_pct: float | None
    humidity_pct: float | None
    dewpoint_c: float | None
    cloud_base_m: float | None
    source: str


def _val(hourly: dict, key: str, idx: int) -> float | None:
    arr = hourly.get(key)
    if not arr or idx >= len(arr):
        return None
    v = arr[idx]
    return float(v) if v is not None else None


def _nearest_index(times: list[str], target: datetime) -> int:
    """Return the index in `times` whose hour is closest to `target` (UTC)."""
    target_utc = target.astimezone(timezone.utc).replace(tzinfo=None)
    best_i = 0
    best_diff = None
    for i, t in enumerate(times):
        try:
            ts = datetime.fromisoformat(t)
        except ValueError:
            continue
        diff = abs((ts - target_utc).total_seconds())
        if best_diff is None or diff < best_diff:
            best_diff = diff
            best_i = i
    return best_i


def _avg_vals(hourly: dict, key: str, indices: list[int]) -> float | None:
    vals = [_val(hourly, key, i) for i in indices]
    vals = [v for v in vals if v is not None]
    return sum(vals) / len(vals) if vals else None


def _circular_mean_deg(hourly: dict, key: str, indices: list[int]) -> float | None:
    """Circular mean for wind direction to avoid wrap-around artifacts."""
    vals = [_val(hourly, key, i) for i in indices]
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    sin_sum = sum(math.sin(math.radians(v)) for v in vals)
    cos_sum = sum(math.cos(math.radians(v)) for v in vals)
    return (math.degrees(math.atan2(sin_sum, cos_sum)) + 360) % 360


def fetch_weather(
    lat: float,
    lon: float,
    start_dt: datetime,
    end_dt: datetime | None = None,
    timeout: float = 10.0,
) -> WeatherSnapshot | None:
    """Fetch hourly weather averaged across the flight window [start_dt, end_dt].

    When end_dt is None the behaviour falls back to a single nearest-hour lookup
    (backward compatible with old callers).  Returns None on any network error.
    """
    url = "https://historical-forecast-api.open-meteo.com/v1/forecast"
    start_date = start_dt.date().isoformat()
    end_date = (end_dt or start_dt).date().isoformat()
    params = {
        "latitude": f"{lat:.4f}",
        "longitude": f"{lon:.4f}",
        "start_date": start_date,
        "end_date": end_date,
        "hourly": ",".join([
            "temperature_2m",
            "dewpoint_2m",
            "wind_speed_10m",
            "wind_direction_10m",
            "surface_pressure",
            "cloud_cover",
            "relative_humidity_2m",
        ]),
        "wind_speed_unit": "kmh",
        "timezone": "UTC",
    }
    try:
        r = httpx.get(url, params=params, timeout=timeout)
        r.raise_for_status()
        data = r.json()
    except Exception:
        return None

    hourly = data.get("hourly") or {}
    times: list[str] = hourly.get("time") or []
    if not times:
        return None

    # Find all hourly indices that fall within the flight window.
    if end_dt is not None:
        start_utc = start_dt.astimezone(timezone.utc).replace(tzinfo=None)
        end_utc = end_dt.astimezone(timezone.utc).replace(tzinfo=None)
        indices = []
        for i, t in enumerate(times):
            try:
                ts = datetime.fromisoformat(t)
            except ValueError:
                continue
            if start_utc <= ts <= end_utc:
                indices.append(i)
        if not indices:
            indices = [_nearest_index(times, start_dt)]
    else:
        indices = [_nearest_index(times, start_dt)]

    temp_c = _avg_vals(hourly, "temperature_2m", indices)
    dewpoint_c = _avg_vals(hourly, "dewpoint_2m", indices)

    # Howell's formula: cloud base ≈ (T - Td) / 2.5 * 1000 m
    if temp_c is not None and dewpoint_c is not None:
        cloud_base_m = round((temp_c - dewpoint_c) / 2.5 * 1000)
    else:
        cloud_base_m = None

    return WeatherSnapshot(
        temp_c=temp_c,
        wind_speed_kmh=_avg_vals(hourly, "wind_speed_10m", indices),
        wind_dir_deg=_circular_mean_deg(hourly, "wind_direction_10m", indices),
        pressure_hpa=_avg_vals(hourly, "surface_pressure", indices),
        cloud_cover_pct=_avg_vals(hourly, "cloud_cover", indices),
        humidity_pct=_avg_vals(hourly, "relative_humidity_2m", indices),
        dewpoint_c=dewpoint_c,
        cloud_base_m=cloud_base_m,
        source="open-meteo",
    )
