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
    if "flights" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("flights")}
    additions = {
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
        for name, sql_type in additions.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE flights ADD COLUMN {name} {sql_type}"))


def init_db() -> None:
    from models import Flight, GpsFix, ThermalRecord  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _add_missing_columns()
