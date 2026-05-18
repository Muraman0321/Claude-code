"""SQLAlchemy ORM models for flights, GPS fixes, and thermals."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Column, Integer, String, Float, DateTime, Date, ForeignKey, Text, UniqueConstraint
)
from sqlalchemy.orm import relationship

from database import Base


class Flight(Base):
    __tablename__ = "flights"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)
    pilot = Column(String, index=True, nullable=False)
    aircraft = Column(String, index=True, nullable=False)
    remarks = Column(String, nullable=True)
    flight_date = Column(Date, index=True, nullable=False)
    started_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow)

    # Summary metrics (denormalized for fast list/filter views).
    duration_s = Column(Float, nullable=True)
    total_distance_km = Column(Float, nullable=True)
    straight_distance_km = Column(Float, nullable=True)
    max_altitude_m = Column(Integer, nullable=True)
    min_altitude_m = Column(Integer, nullable=True)
    altitude_gain_m = Column(Float, nullable=True)
    max_climb_rate_ms = Column(Float, nullable=True)
    avg_climb_in_thermals_ms = Column(Float, nullable=True)
    avg_ground_speed_kmh = Column(Float, nullable=True)
    max_ground_speed_kmh = Column(Float, nullable=True)
    best_glide_ratio = Column(Float, nullable=True)
    thermal_count = Column(Integer, nullable=True)
    thermal_time_s = Column(Float, nullable=True)
    cruise_time_s = Column(Float, nullable=True)

    # Takeoff location, used for the weather lookup and for time-of-day analysis
    # (local hour is estimated from longitude when no timezone info is available).
    start_latitude = Column(Float, nullable=True)
    start_longitude = Column(Float, nullable=True)

    # Weather snapshot at takeoff (nearest hourly cell from Open-Meteo).
    weather_temp_c = Column(Float, nullable=True)
    weather_wind_speed_kmh = Column(Float, nullable=True)
    weather_wind_dir_deg = Column(Float, nullable=True)
    weather_pressure_hpa = Column(Float, nullable=True)
    weather_cloud_cover_pct = Column(Float, nullable=True)
    weather_humidity_pct = Column(Float, nullable=True)
    weather_source = Column(String, nullable=True)

    raw_igc = Column(Text, nullable=True)  # full file kept for re-analysis

    fixes = relationship("GpsFix", back_populates="flight", cascade="all, delete-orphan")
    thermals = relationship("ThermalRecord", back_populates="flight", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("filename", "pilot", name="uq_flight_filename_pilot"),)


class GpsFix(Base):
    __tablename__ = "gps_fixes"

    id = Column(Integer, primary_key=True)
    flight_id = Column(Integer, ForeignKey("flights.id", ondelete="CASCADE"), index=True, nullable=False)
    seq = Column(Integer, nullable=False)
    timestamp = Column(DateTime, nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    altitude_m = Column(Integer, nullable=False)
    pressure_altitude_m = Column(Integer, nullable=True)
    ground_speed_kmh = Column(Float, nullable=True)
    climb_rate_ms = Column(Float, nullable=True)

    flight = relationship("Flight", back_populates="fixes")


class ThermalRecord(Base):
    __tablename__ = "thermals"

    id = Column(Integer, primary_key=True)
    flight_id = Column(Integer, ForeignKey("flights.id", ondelete="CASCADE"), index=True, nullable=False)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)
    duration_s = Column(Float, nullable=False)
    altitude_gain_m = Column(Float, nullable=False)
    avg_climb_rate_ms = Column(Float, nullable=False)
    center_lat = Column(Float, nullable=False)
    center_lon = Column(Float, nullable=False)
    start_lat = Column(Float, nullable=True)
    start_lon = Column(Float, nullable=True)
    end_lat = Column(Float, nullable=True)
    end_lon = Column(Float, nullable=True)

    flight = relationship("Flight", back_populates="thermals")
