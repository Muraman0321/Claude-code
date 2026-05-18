"""Pydantic schemas for API request/response bodies."""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel


class FlightSummaryOut(BaseModel):
    id: int
    filename: str
    pilot: str
    aircraft: str
    remarks: str | None
    flight_date: date
    started_at: datetime | None
    ended_at: datetime | None
    duration_s: float | None
    total_distance_km: float | None
    straight_distance_km: float | None
    max_altitude_m: int | None
    altitude_gain_m: float | None
    max_climb_rate_ms: float | None
    avg_climb_in_thermals_ms: float | None
    avg_ground_speed_kmh: float | None
    max_ground_speed_kmh: float | None
    best_glide_ratio: float | None
    thermal_count: int | None
    thermal_time_s: float | None
    cruise_time_s: float | None
    start_latitude: float | None = None
    start_longitude: float | None = None
    weather_temp_c: float | None = None
    weather_wind_speed_kmh: float | None = None
    weather_wind_dir_deg: float | None = None
    weather_pressure_hpa: float | None = None
    weather_cloud_cover_pct: float | None = None
    weather_humidity_pct: float | None = None
    weather_source: str | None = None

    class Config:
        from_attributes = True


class FixOut(BaseModel):
    seq: int
    timestamp: datetime
    latitude: float
    longitude: float
    altitude_m: int
    ground_speed_kmh: float | None
    climb_rate_ms: float | None


class ThermalOut(BaseModel):
    start_time: datetime
    end_time: datetime
    duration_s: float
    altitude_gain_m: float
    avg_climb_rate_ms: float
    center_lat: float
    center_lon: float


class FlightDetailOut(FlightSummaryOut):
    fixes: list[FixOut]
    thermals: list[ThermalOut]


class UploadResultOut(BaseModel):
    filename: str
    success: bool
    flight_id: int | None = None
    error: str | None = None


class PilotStats(BaseModel):
    pilot: str
    flight_count: int
    total_hours: float
    avg_climb_in_thermals_ms: float | None
    avg_ground_speed_kmh: float | None
    best_glide_ratio: float | None
    total_distance_km: float


class AircraftStats(BaseModel):
    aircraft: str
    flight_count: int
    avg_climb_in_thermals_ms: float | None
    avg_ground_speed_kmh: float | None
    best_glide_ratio: float | None


class TimeOfDayBucket(BaseModel):
    hour: int  # local hour 0-23, estimated from longitude
    thermal_count: int
    avg_climb_rate_ms: float
    avg_altitude_gain_m: float
    avg_duration_s: float


class WeatherBucket(BaseModel):
    label: str  # e.g. "0-5 km/h"
    flight_count: int
    avg_climb_rate_ms: float | None
    avg_ground_speed_kmh: float | None
    avg_best_glide: float | None


class SeasonBucket(BaseModel):
    season: str  # "春" / "夏" / "秋" / "冬"
    season_key: str  # "spring" / "summer" / "autumn" / "winter" (stable for FE keys)
    flight_count: int
    total_hours: float
    total_distance_km: float
    avg_climb_in_thermals_ms: float | None
    avg_ground_speed_kmh: float | None
    avg_max_altitude_m: float | None
    avg_best_glide: float | None
    avg_temp_c: float | None
    avg_wind_speed_kmh: float | None
