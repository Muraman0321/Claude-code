"""FastAPI app exposing IGC upload, flight detail, and aggregate endpoints."""
from __future__ import annotations

from contextlib import asynccontextmanager
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
from database import SessionLocal, init_db
from filename_parser import parse_filename
from models import Flight, GpsFix, ThermalRecord
from schemas import (
    AircraftStats,
    FixOut,
    FlightDetailOut,
    FlightSummaryOut,
    PilotStats,
    ThermalOut,
    UploadResultOut,
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

    flight = Flight(
        filename=filename,
        pilot=meta.pilot,
        aircraft=meta.aircraft,
        remarks=meta.remarks,
        flight_date=meta.flight_date,
        started_at=igc.fixes[0].timestamp.replace(tzinfo=None),
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
