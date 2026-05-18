"""FastAPI app exposing IGC upload, flight detail, and aggregate endpoints."""
from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Iterable

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func
from sqlalchemy.orm import Session

import analysis
import igc_parser
import weather as weather_svc
from database import SessionLocal, init_db
from filename_parser import parse_filename
from models import Flight, GpsFix, ThermalRecord
from schemas import (
    AircraftStats,
    FixOut,
    FlightDetailOut,
    FlightSummaryOut,
    PilotStats,
    SeasonBucket,
    ThermalOut,
    TimeOfDayBucket,
    UploadResultOut,
    WeatherBucket,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Glider Flight Analyzer", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _ingest_one(db: Session, filename: str, content: bytes) -> UploadResultOut:
    meta = parse_filename(filename)
    if not meta:
        return UploadResultOut(filename=filename, success=False, error="filename does not match yy.mm.dd_<aircraft>_<pilot>_<remarks>.igc")

    igc = igc_parser.parse_igc_bytes(content)
    if not igc.fixes:
        return UploadResultOut(filename=filename, success=False, error="no B records (GPS fixes) found")

    metrics = analysis.compute_fix_metrics(igc.fixes)
    thermals = analysis.detect_thermals(igc.fixes, metrics)
    summary = analysis.compute_summary(igc.fixes, metrics, thermals)

    existing = (
        db.query(Flight)
        .filter(Flight.filename == filename, Flight.pilot == meta.pilot)
        .one_or_none()
    )
    if existing:
        db.delete(existing)
        db.flush()

    start_fix = igc.fixes[0]
    wx = weather_svc.fetch_weather(start_fix.latitude, start_fix.longitude, start_fix.timestamp)

    flight = Flight(
        filename=filename,
        pilot=meta.pilot,
        aircraft=meta.aircraft,
        remarks=meta.remarks,
        flight_date=meta.flight_date,
        started_at=start_fix.timestamp.replace(tzinfo=None),
        ended_at=igc.fixes[-1].timestamp.replace(tzinfo=None),
        duration_s=summary.duration_s,
        total_distance_km=summary.total_distance_km,
        straight_distance_km=summary.straight_distance_km,
        max_altitude_m=summary.max_altitude_m,
        min_altitude_m=summary.min_altitude_m,
        altitude_gain_m=summary.altitude_gain_m,
        max_climb_rate_ms=summary.max_climb_rate_ms,
        avg_climb_in_thermals_ms=summary.avg_climb_rate_in_thermals_ms,
        avg_ground_speed_kmh=summary.avg_ground_speed_kmh,
        max_ground_speed_kmh=summary.max_ground_speed_kmh,
        best_glide_ratio=summary.best_glide_ratio,
        thermal_count=summary.thermal_count,
        thermal_time_s=summary.thermal_time_s,
        cruise_time_s=summary.cruise_time_s,
        start_latitude=start_fix.latitude,
        start_longitude=start_fix.longitude,
        weather_temp_c=wx.temp_c if wx else None,
        weather_wind_speed_kmh=wx.wind_speed_kmh if wx else None,
        weather_wind_dir_deg=wx.wind_dir_deg if wx else None,
        weather_pressure_hpa=wx.pressure_hpa if wx else None,
        weather_cloud_cover_pct=wx.cloud_cover_pct if wx else None,
        weather_humidity_pct=wx.humidity_pct if wx else None,
        weather_source=wx.source if wx else None,
        raw_igc=content.decode("latin-1"),
    )

    # Downsample fixes for storage: keep every N to stay under ~3000 per flight.
    step = max(1, len(metrics) // 3000)
    for i, m in enumerate(metrics):
        if i % step != 0 and i != len(metrics) - 1:
            continue
        flight.fixes.append(
            GpsFix(
                seq=i,
                timestamp=igc.fixes[i].timestamp.replace(tzinfo=None),
                latitude=m.latitude,
                longitude=m.longitude,
                altitude_m=m.altitude,
                pressure_altitude_m=m.pressure_altitude,
                ground_speed_kmh=m.ground_speed_kmh,
                climb_rate_ms=m.climb_rate_ms,
            )
        )

    for t in thermals:
        flight.thermals.append(
            ThermalRecord(
                start_time=igc.fixes[t.start_index].timestamp.replace(tzinfo=None),
                end_time=igc.fixes[t.end_index].timestamp.replace(tzinfo=None),
                duration_s=t.duration_s,
                altitude_gain_m=t.altitude_gain_m,
                avg_climb_rate_ms=t.avg_climb_rate_ms,
                center_lat=t.center_lat,
                center_lon=t.center_lon,
            )
        )

    db.add(flight)
    db.commit()
    db.refresh(flight)
    return UploadResultOut(filename=filename, success=True, flight_id=flight.id)


@app.post("/api/upload", response_model=list[UploadResultOut])
async def upload(files: list[UploadFile] = File(...), db: Session = Depends(get_db)):
    results: list[UploadResultOut] = []
    for f in files:
        content = await f.read()
        try:
            results.append(_ingest_one(db, f.filename or "unknown.igc", content))
        except Exception as e:  # pragma: no cover
            db.rollback()
            results.append(UploadResultOut(filename=f.filename or "unknown.igc", success=False, error=str(e)))
    return results


@app.get("/api/flights", response_model=list[FlightSummaryOut])
def list_flights(
    pilot: str | None = None,
    aircraft: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    db: Session = Depends(get_db),
):
    q = db.query(Flight).order_by(Flight.flight_date.desc(), Flight.started_at.desc())
    if pilot:
        q = q.filter(Flight.pilot == pilot)
    if aircraft:
        q = q.filter(Flight.aircraft == aircraft)
    if date_from:
        q = q.filter(Flight.flight_date >= date_from)
    if date_to:
        q = q.filter(Flight.flight_date <= date_to)
    return q.all()


@app.get("/api/flights/{flight_id}", response_model=FlightDetailOut)
def flight_detail(flight_id: int, db: Session = Depends(get_db)):
    flight = db.query(Flight).filter(Flight.id == flight_id).one_or_none()
    if not flight:
        raise HTTPException(status_code=404, detail="flight not found")
    fixes = sorted(flight.fixes, key=lambda f: f.seq)
    return FlightDetailOut(
        **{c.name: getattr(flight, c.name) for c in Flight.__table__.columns if c.name != "raw_igc"},
        fixes=[FixOut(
            seq=f.seq, timestamp=f.timestamp, latitude=f.latitude, longitude=f.longitude,
            altitude_m=f.altitude_m, ground_speed_kmh=f.ground_speed_kmh, climb_rate_ms=f.climb_rate_ms,
        ) for f in fixes],
        thermals=[ThermalOut(
            start_time=t.start_time, end_time=t.end_time, duration_s=t.duration_s,
            altitude_gain_m=t.altitude_gain_m, avg_climb_rate_ms=t.avg_climb_rate_ms,
            center_lat=t.center_lat, center_lon=t.center_lon,
        ) for t in flight.thermals],
    )


@app.delete("/api/flights/{flight_id}")
def delete_flight(flight_id: int, db: Session = Depends(get_db)):
    flight = db.query(Flight).filter(Flight.id == flight_id).one_or_none()
    if not flight:
        raise HTTPException(status_code=404, detail="flight not found")
    db.delete(flight)
    db.commit()
    return {"deleted": flight_id}


@app.get("/api/pilots", response_model=list[str])
def list_pilots(db: Session = Depends(get_db)):
    rows = db.query(Flight.pilot).distinct().order_by(Flight.pilot).all()
    return [r[0] for r in rows]


@app.get("/api/aircraft", response_model=list[str])
def list_aircraft(db: Session = Depends(get_db)):
    rows = db.query(Flight.aircraft).distinct().order_by(Flight.aircraft).all()
    return [r[0] for r in rows]


@app.get("/api/stats/pilots", response_model=list[PilotStats])
def stats_pilots(db: Session = Depends(get_db)):
    rows = (
        db.query(
            Flight.pilot,
            func.count(Flight.id),
            func.sum(Flight.duration_s),
            func.avg(Flight.avg_climb_in_thermals_ms),
            func.avg(Flight.avg_ground_speed_kmh),
            func.max(Flight.best_glide_ratio),
            func.sum(Flight.total_distance_km),
        )
        .group_by(Flight.pilot)
        .order_by(func.count(Flight.id).desc())
        .all()
    )
    return [
        PilotStats(
            pilot=r[0],
            flight_count=r[1],
            total_hours=round((r[2] or 0) / 3600.0, 2),
            avg_climb_in_thermals_ms=round(r[3], 2) if r[3] is not None else None,
            avg_ground_speed_kmh=round(r[4], 2) if r[4] is not None else None,
            best_glide_ratio=round(r[5], 2) if r[5] is not None else None,
            total_distance_km=round(r[6] or 0, 1),
        )
        for r in rows
    ]


@app.get("/api/stats/aircraft", response_model=list[AircraftStats])
def stats_aircraft(db: Session = Depends(get_db)):
    rows = (
        db.query(
            Flight.aircraft,
            func.count(Flight.id),
            func.avg(Flight.avg_climb_in_thermals_ms),
            func.avg(Flight.avg_ground_speed_kmh),
            func.max(Flight.best_glide_ratio),
        )
        .group_by(Flight.aircraft)
        .order_by(func.count(Flight.id).desc())
        .all()
    )
    return [
        AircraftStats(
            aircraft=r[0],
            flight_count=r[1],
            avg_climb_in_thermals_ms=round(r[2], 2) if r[2] is not None else None,
            avg_ground_speed_kmh=round(r[3], 2) if r[3] is not None else None,
            best_glide_ratio=round(r[4], 2) if r[4] is not None else None,
        )
        for r in rows
    ]


_SEASONS = [
    ("春", "spring", {3, 4, 5}),
    ("夏", "summer", {6, 7, 8}),
    ("秋", "autumn", {9, 10, 11}),
    ("冬", "winter", {12, 1, 2}),
]


def _season_of(month: int) -> tuple[str, str]:
    for label, key, months in _SEASONS:
        if month in months:
            return label, key
    return "冬", "winter"  # unreachable


def _avg(vals: list[float]) -> float | None:
    return round(sum(vals) / len(vals), 2) if vals else None


@app.get("/api/stats/time-of-day", response_model=list[TimeOfDayBucket])
def stats_time_of_day(
    pilot: str | None = None,
    aircraft: str | None = None,
    season: str | None = None,  # spring/summer/autumn/winter
    db: Session = Depends(get_db),
):
    """Aggregate detected thermals by local hour of day.

    We do not have a timezone in IGC files (timestamps are UTC), so the
    local hour is approximated as `(utc_hour + round(longitude/15)) % 24`,
    which is accurate to ~±30 min for solar-driven thermal activity.
    """
    q = (
        db.query(ThermalRecord, Flight)
        .join(Flight, ThermalRecord.flight_id == Flight.id)
    )
    if pilot:
        q = q.filter(Flight.pilot == pilot)
    if aircraft:
        q = q.filter(Flight.aircraft == aircraft)

    season_filter = season.lower() if season else None
    buckets: dict[int, list[ThermalRecord]] = {}
    for thermal, flight in q.all():
        if season_filter:
            _, key = _season_of(flight.flight_date.month)
            if key != season_filter:
                continue
        offset = round((flight.start_longitude or 0) / 15.0)
        local_hour = (thermal.start_time.hour + offset) % 24
        buckets.setdefault(local_hour, []).append(thermal)

    out: list[TimeOfDayBucket] = []
    for hour in sorted(buckets):
        ts = buckets[hour]
        out.append(TimeOfDayBucket(
            hour=hour,
            thermal_count=len(ts),
            avg_climb_rate_ms=round(sum(t.avg_climb_rate_ms for t in ts) / len(ts), 2),
            avg_altitude_gain_m=round(sum(t.altitude_gain_m for t in ts) / len(ts), 1),
            avg_duration_s=round(sum(t.duration_s for t in ts) / len(ts), 1),
        ))
    return out


@app.get("/api/stats/season", response_model=list[SeasonBucket])
def stats_season(
    pilot: str | None = None,
    aircraft: str | None = None,
    db: Session = Depends(get_db),
):
    """Aggregate flights by meteorological season (spring/summer/autumn/winter)."""
    q = db.query(Flight)
    if pilot:
        q = q.filter(Flight.pilot == pilot)
    if aircraft:
        q = q.filter(Flight.aircraft == aircraft)

    grouped: dict[str, list[Flight]] = {key: [] for _, key, _ in _SEASONS}
    label_for: dict[str, str] = {key: label for label, key, _ in _SEASONS}
    for flight in q.all():
        _, key = _season_of(flight.flight_date.month)
        grouped[key].append(flight)

    out: list[SeasonBucket] = []
    for _, key, _ in _SEASONS:
        fs = grouped[key]
        if not fs:
            continue
        out.append(SeasonBucket(
            season=label_for[key],
            season_key=key,
            flight_count=len(fs),
            total_hours=round(sum(f.duration_s or 0 for f in fs) / 3600.0, 2),
            total_distance_km=round(sum(f.total_distance_km or 0 for f in fs), 1),
            avg_climb_in_thermals_ms=_avg([f.avg_climb_in_thermals_ms for f in fs if f.avg_climb_in_thermals_ms is not None]),
            avg_ground_speed_kmh=_avg([f.avg_ground_speed_kmh for f in fs if f.avg_ground_speed_kmh is not None]),
            avg_max_altitude_m=_avg([float(f.max_altitude_m) for f in fs if f.max_altitude_m is not None]),
            avg_best_glide=_avg([f.best_glide_ratio for f in fs if f.best_glide_ratio is not None]),
            avg_temp_c=_avg([f.weather_temp_c for f in fs if f.weather_temp_c is not None]),
            avg_wind_speed_kmh=_avg([f.weather_wind_speed_kmh for f in fs if f.weather_wind_speed_kmh is not None]),
        ))
    return out


_WIND_BUCKETS = [
    ("0-5 km/h", 0, 5),
    ("5-10 km/h", 5, 10),
    ("10-15 km/h", 10, 15),
    ("15-20 km/h", 15, 20),
    ("20+ km/h", 20, 999),
]


@app.get("/api/stats/weather", response_model=list[WeatherBucket])
def stats_weather(db: Session = Depends(get_db)):
    """Group flights into wind-speed buckets and report performance per bucket."""
    flights = db.query(Flight).filter(Flight.weather_wind_speed_kmh.isnot(None)).all()
    out: list[WeatherBucket] = []
    for label, lo, hi in _WIND_BUCKETS:
        bucket = [f for f in flights if lo <= (f.weather_wind_speed_kmh or 0) < hi]
        if not bucket:
            continue
        out.append(WeatherBucket(
            label=label,
            flight_count=len(bucket),
            avg_climb_rate_ms=_avg([f.avg_climb_in_thermals_ms for f in bucket if f.avg_climb_in_thermals_ms is not None]),
            avg_ground_speed_kmh=_avg([f.avg_ground_speed_kmh for f in bucket if f.avg_ground_speed_kmh is not None]),
            avg_best_glide=_avg([f.best_glide_ratio for f in bucket if f.best_glide_ratio is not None]),
        ))
    return out


@app.post("/api/flights/{flight_id}/refresh-weather", response_model=FlightSummaryOut)
def refresh_weather(flight_id: int, db: Session = Depends(get_db)):
    """Re-fetch weather for a flight that was uploaded before weather support."""
    flight = db.query(Flight).filter(Flight.id == flight_id).one_or_none()
    if not flight:
        raise HTTPException(status_code=404, detail="flight not found")
    if flight.start_latitude is None or flight.start_longitude is None:
        # Fall back to the first stored GPS fix.
        fix = (
            db.query(GpsFix).filter(GpsFix.flight_id == flight_id).order_by(GpsFix.seq).first()
        )
        if not fix:
            raise HTTPException(status_code=400, detail="no GPS fix available")
        flight.start_latitude = fix.latitude
        flight.start_longitude = fix.longitude
    when = flight.started_at or datetime.combine(flight.flight_date, datetime.min.time())
    wx = weather_svc.fetch_weather(flight.start_latitude, flight.start_longitude, when)
    if wx is None:
        raise HTTPException(status_code=502, detail="weather lookup failed")
    flight.weather_temp_c = wx.temp_c
    flight.weather_wind_speed_kmh = wx.wind_speed_kmh
    flight.weather_wind_dir_deg = wx.wind_dir_deg
    flight.weather_pressure_hpa = wx.pressure_hpa
    flight.weather_cloud_cover_pct = wx.cloud_cover_pct
    flight.weather_humidity_pct = wx.humidity_pct
    flight.weather_source = wx.source
    db.commit()
    db.refresh(flight)
    return flight


@app.get("/api/health")
def health():
    return {"status": "ok"}


# Serve the built React frontend in production.
# In dev, run Vite separately (`npm run dev`) which proxies /api to this server.
STATIC_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        candidate = STATIC_DIR / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        # React Router uses history mode; fall back to index.html.
        return FileResponse(STATIC_DIR / "index.html")
