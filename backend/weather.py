"""Fetch weather snapshots from Open-Meteo (free, no API key required).

We pick the model run closest to the flight's start (lat, lon, UTC datetime)
from the Historical Forecast API, which has hourly reanalysis data going
back several years and is usually fresh within a day or two.
"""
from __future__ import annotations

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


def fetch_weather(lat: float, lon: float, dt: datetime, timeout: float = 10.0) -> WeatherSnapshot | None:
    """Look up hourly weather at (lat, lon) at the hour closest to dt (UTC).

    Returns None on any network error so ingest never fails because of weather.
    """
    url = "https://historical-forecast-api.open-meteo.com/v1/forecast"
    date_str = dt.date().isoformat()
    params = {
        "latitude": f"{lat:.4f}",
        "longitude": f"{lon:.4f}",
        "start_date": date_str,
        "end_date": date_str,
        "hourly": ",".join([
            "temperature_2m",
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

    idx = _nearest_index(times, dt)

    return WeatherSnapshot(
        temp_c=_val(hourly, "temperature_2m", idx),
        wind_speed_kmh=_val(hourly, "wind_speed_10m", idx),
        wind_dir_deg=_val(hourly, "wind_direction_10m", idx),
        pressure_hpa=_val(hourly, "surface_pressure", idx),
        cloud_cover_pct=_val(hourly, "cloud_cover", idx),
        humidity_pct=_val(hourly, "relative_humidity_2m", idx),
        source="open-meteo",
    )
