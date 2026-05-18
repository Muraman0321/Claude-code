"""SQLite database setup using SQLAlchemy ORM."""
from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

DB_PATH = Path(os.environ.get("GLIDER_DB_PATH", "glider.db")).resolve()
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _add_missing_columns() -> None:
    """Tiny migration: add columns introduced after the table was first created.

    SQLite supports `ALTER TABLE ... ADD COLUMN` for nullable columns, which
    is enough for the additive schema changes we make here.
    """
    from models import Flight  # noqa: F401

    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "flights" not in tables:
        return

    existing_flights = {c["name"] for c in inspector.get_columns("flights")}
    flight_additions = {
        "start_latitude": "REAL",
        "start_longitude": "REAL",
        "weather_temp_c": "REAL",
        "weather_wind_speed_kmh": "REAL",
        "weather_wind_dir_deg": "REAL",
        "weather_pressure_hpa": "REAL",
        "weather_cloud_cover_pct": "REAL",
        "weather_humidity_pct": "REAL",
        "weather_source": "VARCHAR",
    }
    with engine.begin() as conn:
        for name, sql_type in flight_additions.items():
            if name not in existing_flights:
                conn.execute(text(f"ALTER TABLE flights ADD COLUMN {name} {sql_type}"))

    if "thermals" in tables:
        existing_thermals = {c["name"] for c in inspector.get_columns("thermals")}
        thermal_additions = {
            "start_lat": "REAL",
            "start_lon": "REAL",
            "end_lat": "REAL",
            "end_lon": "REAL",
        }
        with engine.begin() as conn:
            for name, sql_type in thermal_additions.items():
                if name not in existing_thermals:
                    conn.execute(text(f"ALTER TABLE thermals ADD COLUMN {name} {sql_type}"))


def _uppercase_pilot_aircraft() -> None:
    """One-time data normalization: uppercase pilot and aircraft strings
    so they match the new semantic parser convention (CAPITAL LETTER).

    Idempotent: rows already uppercase are skipped.
    """
    from sqlalchemy import func
    from models import Flight

    inspector = inspect(engine)
    if "flights" not in inspector.get_table_names():
        return
    with SessionLocal() as db:
        rows = db.query(Flight).filter(
            (Flight.pilot != func.upper(Flight.pilot))
            | (Flight.aircraft != func.upper(Flight.aircraft))
        ).all()
        if not rows:
            return
        for r in rows:
            r.pilot = (r.pilot or "").upper()
            r.aircraft = (r.aircraft or "").upper()
        db.commit()


def init_db() -> None:
    from models import Flight, GpsFix, ThermalRecord  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _add_missing_columns()
    _uppercase_pilot_aircraft()
