"""FastAPI app exposing IGC upload, flight detail, and aggregate endpoints."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Iterable

import httpx
from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

import analysis
import drive_import
import igc_parser
import weather as weather_svc
from database import SessionLocal, init_db
from filename_parser import normalize_filename, parse_filename, parse_or_normalize
from models import Flight, GpsFix, ThermalRecord
from schemas import (
    AircraftStats,
    AreaBlock,
    AreaStats,
    BlockStats,
    FixOut,
    FlightDetailOut,
    FlightPhaseAnalysisOut,
    FlightSummaryOut,
    FlightTrack,
    HistogramBin,
    HistogramGroup,
    HourCell,
    PilotStats,
    PhaseMetricsOut,
    SeasonBucket,
    ThermalLight,
    ThermalOut,
    TimeOfDayBucket,
    TrackPoint,
    UploadResultOut,
    WeatherBucket,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


core = FastAPI(title="Glider Flight Analyzer", lifespan=lifespan)

core.add_middleware(
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
    meta, final_name, notes = parse_or_normalize(filename)
    normalized_from = filename if final_name != filename else None
    if not meta:
        return UploadResultOut(
            filename=final_name,
            success=False,
            error=f"filename does not match yy.mm.dd_<aircraft>_<pilot>_<remarks>.igc (tried: {final_name!r})",
            normalized_from=normalized_from,
            normalization_notes=notes,
        )
    filename = final_name  # use the normalized form for storage

    igc = igc_parser.parse_igc_bytes(content)
    if not igc.fixes:
        return UploadResultOut(
            filename=filename, success=False, error="no B records (GPS fixes) found",
            normalized_from=normalized_from, normalization_notes=notes,
        )

    metrics = analysis.compute_fix_metrics(igc.fixes)
    thermals = analysis.detect_thermals(igc.fixes, metrics)
    summary = analysis.compute_summary(igc.fixes, metrics, thermals)
    phase_boundaries = analysis.detect_winch_phases(igc.fixes, metrics)

    existing = (
        db.query(Flight)
        .filter(
            func.upper(Flight.filename) == filename.upper(),
            func.upper(Flight.pilot) == meta.pilot.upper(),
        )
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
        tow_phase_end_fix_seq=phase_boundaries.tow_phase_end_fix_seq,
        mid_phase_end_fix_seq=phase_boundaries.mid_phase_end_fix_seq,
        release_altitude_m=phase_boundaries.release_altitude_m,
        release_fix_seq=phase_boundaries.release_fix_seq,
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
                start_lat=t.start_lat,
                start_lon=t.start_lon,
                end_lat=t.end_lat,
                end_lon=t.end_lon,
            )
        )

    db.add(flight)
    db.commit()
    db.refresh(flight)
    return UploadResultOut(
        filename=filename, success=True, flight_id=flight.id,
        normalized_from=normalized_from, normalization_notes=notes,
    )


@core.post("/api/upload", response_model=list[UploadResultOut])
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


class DriveImportRequest(BaseModel):
    url: str
    max_files: int = 200


@core.post("/api/import-drive-folder", response_model=list[UploadResultOut])
def import_drive_folder(req: DriveImportRequest, db: Session = Depends(get_db)):
    """Import all IGC files from a publicly-shared Google Drive folder URL.

    The folder must be set to "Anyone with the link can view". We list the
    folder via Google's embedded folder view (or the Drive API when
    GOOGLE_DRIVE_API_KEY is configured) and feed each file through the same
    ingest pipeline as a normal upload.
    """
    folder_id = drive_import.extract_folder_id(req.url)
    if not folder_id:
        raise HTTPException(
            status_code=400,
            detail="could not extract folder ID from URL (expected something like https://drive.google.com/drive/folders/...)",
        )

    try:
        files = drive_import.list_folder(folder_id)
    except httpx.HTTPError as e:  # type: ignore[name-defined]
        raise HTTPException(status_code=502, detail=f"failed to access Drive: {e}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"failed to list folder: {e}")

    if not files:
        raise HTTPException(
            status_code=404,
            detail="no files found — make sure the folder is shared with 'Anyone with the link'",
        )

    igc_files = [f for f in files if f.name.lower().endswith(".igc")]
    if not igc_files:
        raise HTTPException(
            status_code=404,
            detail=f"folder has {len(files)} files but none end in .igc",
        )

    igc_files = igc_files[: req.max_files]
    results: list[UploadResultOut] = []
    for f in igc_files:
        try:
            content = drive_import.download_file(f.file_id)
        except Exception as e:
            results.append(UploadResultOut(filename=f.name, success=False, error=f"download failed: {e}"))
            continue
        try:
            results.append(_ingest_one(db, f.name, content))
        except Exception as e:  # pragma: no cover
            db.rollback()
            results.append(UploadResultOut(filename=f.name, success=False, error=str(e)))
    return results


@core.get("/api/flights", response_model=list[FlightSummaryOut])
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


@core.get("/api/flights/{flight_id}", response_model=FlightDetailOut)
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


@core.delete("/api/flights/{flight_id}")
def delete_flight(flight_id: int, db: Session = Depends(get_db)):
    flight = db.query(Flight).filter(Flight.id == flight_id).one_or_none()
    if not flight:
        raise HTTPException(status_code=404, detail="flight not found")
    db.delete(flight)
    db.commit()
    return {"deleted": flight_id}


@core.get("/api/flights/{flight_id}/phase-analysis", response_model=FlightPhaseAnalysisOut)
def flight_phase_analysis(flight_id: int, db: Session = Depends(get_db)):
    """Analyze winch launch phases for a flight."""
    flight = db.query(Flight).filter(Flight.id == flight_id).one_or_none()
    if not flight:
        raise HTTPException(status_code=404, detail="flight not found")

    # Reconstruct the flight from raw IGC for analysis
    if not flight.raw_igc:
        raise HTTPException(status_code=400, detail="raw IGC not available for this flight")

    igc = igc_parser.parse_igc_bytes(flight.raw_igc.encode("latin-1"))
    metrics = analysis.compute_fix_metrics(igc.fixes)
    boundaries = analysis.detect_winch_phases(igc.fixes, metrics)
    phase_metrics = analysis.compute_phase_metrics(igc.fixes, metrics, boundaries)

    # Build response
    result = FlightPhaseAnalysisOut(
        flight_id=flight.id,
        tow_phase_end_fix_seq=boundaries.tow_phase_end_fix_seq,
        mid_phase_end_fix_seq=boundaries.mid_phase_end_fix_seq,
        release_altitude_m=boundaries.release_altitude_m,
        release_fix_seq=boundaries.release_fix_seq,
    )

    if "initial" in phase_metrics:
        m = phase_metrics["initial"]
        result.initial = PhaseMetricsOut(
            duration_s=m.duration_s,
            avg_speed_kmh=m.avg_speed_kmh,
            avg_climb_rate_ms=m.avg_climb_rate_ms,
            altitude_gained_m=m.altitude_gained_m,
            max_speed_kmh=m.max_speed_kmh,
        )

    if "mid" in phase_metrics:
        m = phase_metrics["mid"]
        result.mid = PhaseMetricsOut(
            duration_s=m.duration_s,
            avg_speed_kmh=m.avg_speed_kmh,
            avg_climb_rate_ms=m.avg_climb_rate_ms,
            altitude_gained_m=m.altitude_gained_m,
            max_speed_kmh=m.max_speed_kmh,
        )

    if "late" in phase_metrics:
        m = phase_metrics["late"]
        result.late = PhaseMetricsOut(
            duration_s=m.duration_s,
            avg_speed_kmh=m.avg_speed_kmh,
            avg_climb_rate_ms=m.avg_climb_rate_ms,
            altitude_gained_m=m.altitude_gained_m,
            max_speed_kmh=m.max_speed_kmh,
        )

    return result


@core.post("/api/flights/{flight_id}/reanalyze")
def reanalyze_flight(flight_id: int, db: Session = Depends(get_db)):
    """Re-detect thermals and re-compute summary from stored raw IGC.

    Useful when thermals were accidentally deleted or when the analysis
    algorithm has been updated and existing flights need to be refreshed.
    """
    flight = db.query(Flight).filter(Flight.id == flight_id).one_or_none()
    if not flight:
        raise HTTPException(status_code=404, detail="flight not found")
    if not flight.raw_igc:
        raise HTTPException(status_code=400, detail="raw IGC not available for this flight")

    igc = igc_parser.parse_igc_bytes(flight.raw_igc.encode("latin-1"))
    metrics = analysis.compute_fix_metrics(igc.fixes)
    thermals = analysis.detect_thermals(igc.fixes, metrics)
    summary = analysis.compute_summary(igc.fixes, metrics, thermals)

    # Delete old thermals and replace with freshly detected ones.
    for old in list(flight.thermals):
        db.delete(old)
    db.flush()

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
                start_lat=t.start_lat,
                start_lon=t.start_lon,
                end_lat=t.end_lat,
                end_lon=t.end_lon,
            )
        )

    # Update flight summary stats.
    flight.thermal_count = summary.thermal_count
    flight.thermal_time_s = summary.thermal_time_s
    flight.avg_climb_in_thermals_ms = summary.avg_climb_rate_in_thermals_ms
    flight.cruise_time_s = summary.cruise_time_s
    db.commit()

    return {"flight_id": flight_id, "thermal_count": len(thermals)}


@core.get("/api/pilots", response_model=list[str])
def list_pilots(db: Session = Depends(get_db)):
    rows = db.query(Flight.pilot).distinct().order_by(Flight.pilot).all()
    return [r[0] for r in rows]


@core.get("/api/aircraft", response_model=list[str])
def list_aircraft(db: Session = Depends(get_db)):
    rows = db.query(Flight.aircraft).distinct().order_by(Flight.aircraft).all()
    return [r[0] for r in rows]


@core.get("/api/stats/pilots", response_model=list[PilotStats])
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


@core.get("/api/stats/aircraft", response_model=list[AircraftStats])
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


@core.get("/api/stats/time-of-day", response_model=list[TimeOfDayBucket])
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


@core.get("/api/stats/season", response_model=list[SeasonBucket])
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


@core.get("/api/stats/weather", response_model=list[WeatherBucket])
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


@core.post("/api/flights/{flight_id}/refresh-weather", response_model=FlightSummaryOut)
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


# 妻沼グライダー滑空場: 36°12'41" N 139°25'08" E
MENUMA_LAT = 36.2114
MENUMA_LON = 139.4189


def _hour_cells(climbs_by_hour: dict[int, list[float]]) -> list[HourCell]:
    return [
        HourCell(
            hour=h,
            thermal_count=len(climbs_by_hour[h]),
            avg_climb_rate_ms=round(sum(climbs_by_hour[h]) / len(climbs_by_hour[h]), 2),
        )
        for h in sorted(climbs_by_hour)
    ]


def _block_stats(records: list, by_hour: dict[int, list[float]]) -> dict:
    climbs = [r.avg_climb_rate_ms for r in records]
    gains = [r.altitude_gain_m for r in records]
    return {
        "thermal_count": len(records),
        "avg_climb_rate_ms": round(sum(climbs) / len(climbs), 2) if climbs else None,
        "max_climb_rate_ms": round(max(climbs), 2) if climbs else None,
        "avg_altitude_gain_m": round(sum(gains) / len(gains), 1) if gains else None,
        "by_hour": _hour_cells(by_hour),
    }


def _local_hour(thermal_start, longitude: float) -> int:
    offset = round((longitude or 0) / 15.0)
    return (thermal_start.hour + offset) % 24


@core.get("/api/thermals", response_model=list[ThermalLight])
def flight_thermals(
    ids: str,
    max_thermals: int = Query(default=1500, ge=100, le=5000),
    db: Session = Depends(get_db),
):
    """Return thermal records for a set of flight IDs (used by compare-map overlay).

    Capped at `max_thermals` total records; when over the limit, thermals are
    sampled uniformly so each flight contributes proportionally.
    """
    import random
    flight_ids = [int(x) for x in ids.split(",") if x.strip().lstrip("-").isdigit()]
    if not flight_ids:
        return []
    rows = (
        db.query(ThermalRecord, Flight)
        .join(Flight, ThermalRecord.flight_id == Flight.id)
        .filter(ThermalRecord.flight_id.in_(flight_ids))
        .all()
    )
    if len(rows) > max_thermals:
        rows = random.sample(rows, max_thermals)
    result: list[ThermalLight] = []
    for t, flight in rows:
        local_hour = _local_hour(t.start_time, flight.start_longitude or MENUMA_LON)
        result.append(ThermalLight(
            flight_id=flight.id,
            pilot=flight.pilot,
            aircraft=flight.aircraft,
            center_lat=t.center_lat,
            center_lon=t.center_lon,
            avg_climb_rate_ms=t.avg_climb_rate_ms,
            altitude_gain_m=t.altitude_gain_m,
            duration_s=t.duration_s,
            start_time=t.start_time,
            local_hour=local_hour,
            local_minute=t.start_time.minute,
            start_lat=t.start_lat,
            start_lon=t.start_lon,
            end_lat=t.end_lat,
            end_lon=t.end_lon,
        ))
    return result


@core.get("/api/stats/area/sectors", response_model=AreaStats)
def stats_area_sectors(
    center_lat: float = MENUMA_LAT,
    center_lon: float = MENUMA_LON,
    radius_km: float = 9.0,
    n_sectors: int = 9,
    db: Session = Depends(get_db),
):
    """Divide a circle around the center into n_sectors wedges.

    n_sectors: number of equal wedges (4, 6, 8, 9, 12, 16, 24).
    For each wedge, report thermal stats and an hour-of-day breakdown.
    """
    n = max(4, min(36, n_sectors))
    sector_deg = 360.0 / n

    rows = (
        db.query(ThermalRecord, Flight)
        .join(Flight, ThermalRecord.flight_id == Flight.id)
        .all()
    )

    grouped: list[list[ThermalRecord]] = [[] for _ in range(n)]
    by_hour_per_sector: list[dict[int, list[float]]] = [{} for _ in range(n)]
    for t, flight in rows:
        dist_m = analysis.haversine_m(center_lat, center_lon, t.center_lat, t.center_lon)
        if dist_m > radius_km * 1000:
            continue
        b = analysis.bearing_deg(center_lat, center_lon, t.center_lat, t.center_lon)
        idx = int(b // sector_deg) % n
        grouped[idx].append(t)
        hour = _local_hour(t.start_time, flight.start_longitude or center_lon)
        by_hour_per_sector[idx].setdefault(hour, []).append(t.avg_climb_rate_ms)

    blocks: list[AreaBlock] = []
    for i in range(n):
        bf = i * sector_deg
        bt = (i + 1) * sector_deg
        polygon = analysis.sector_polygon(center_lat, center_lon, radius_km, bf, bt)
        stats = _block_stats(grouped[i], by_hour_per_sector[i])
        blocks.append(AreaBlock(
            id=f"sector_{i}",
            label=f"S{i+1} ({int(bf)}°–{int(bt)}°)",
            bearing_from=bf,
            bearing_to=bt,
            geometry=polygon,
            **stats,
        ))
    return AreaStats(
        kind="sectors",
        center_lat=center_lat,
        center_lon=center_lon,
        radius_km=radius_km,
        blocks=blocks,
    )


def _grid_label(dx: int, dy: int, half: int) -> str:
    """Human-readable label for a grid cell.

    3×3: compass names (NW/N/NE/W/C/E/SW/S/SE).
    5×5 / 7×7: R{row}C{col} where R1=northernmost, C1=westernmost.
    """
    if half == 1:
        return analysis.GRID_LABELS.get((dx, dy), f"{dx}/{dy}")
    row = half + 1 - dy
    col = dx + half + 1
    return f"R{row}C{col}"


@core.get("/api/stats/area/grid", response_model=AreaStats)
def stats_area_grid(
    center_lat: float = MENUMA_LAT,
    center_lon: float = MENUMA_LON,
    cell_km: float = 6.0,
    grid_size: int = 3,
    db: Session = Depends(get_db),
):
    """NxN grid (grid_size must be odd: 3, 5, 7) centered on (lat, lon)."""
    import math as _math
    n = max(3, min(9, grid_size))
    if n % 2 == 0:
        n += 1
    half = n // 2

    rows = (
        db.query(ThermalRecord, Flight)
        .join(Flight, ThermalRecord.flight_id == Flight.id)
        .all()
    )

    coords = [(x, y) for x in range(-half, half + 1) for y in range(-half, half + 1)]
    cells: dict[tuple[int, int], list[ThermalRecord]] = {k: [] for k in coords}
    by_hour: dict[tuple[int, int], dict[int, list[float]]] = {k: {} for k in coords}

    lat_per_km = 1.0 / 111.0
    lon_per_km = 1.0 / (111.0 * _math.cos(_math.radians(center_lat)) or 1e-9)
    extent_lat = cell_km * lat_per_km
    extent_lon = cell_km * lon_per_km

    for t, flight in rows:
        d_lat = t.center_lat - center_lat
        d_lon = t.center_lon - center_lon
        ratio_y = d_lat / extent_lat
        ratio_x = d_lon / extent_lon
        if abs(ratio_x) > half + 0.5 or abs(ratio_y) > half + 0.5:
            continue
        ix = max(-half, min(half, round(ratio_x)))
        iy = max(-half, min(half, round(ratio_y)))
        cells[(ix, iy)].append(t)
        hour = _local_hour(t.start_time, flight.start_longitude or center_lon)
        by_hour[(ix, iy)].setdefault(hour, []).append(t.avg_climb_rate_ms)

    blocks: list[AreaBlock] = []
    for (dx, dy), records in cells.items():
        polygon = analysis.grid_cell_polygon(center_lat, center_lon, dx, dy, cell_km)
        stats = _block_stats(records, by_hour[(dx, dy)])
        label = _grid_label(dx, dy, half)
        blocks.append(AreaBlock(
            id=f"cell_{dx}_{dy}",
            label=label,
            geometry=polygon,
            **stats,
        ))
    return AreaStats(
        kind="grid",
        center_lat=center_lat,
        center_lon=center_lon,
        cell_km=cell_km,
        blocks=blocks,
    )


CLIMB_BIN_EDGES = [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0]  # last bin = 5+
SINK_BIN_EDGES = [0.0, 0.5, 1.0, 1.5, 2.0, 3.0, 5.0]              # last bin = 5+ (absolute)


def _bin_label(lo: float, hi: float | None, unit: str = "m/s") -> str:
    if hi is None:
        return f"{lo:g}+ {unit}"
    return f"{lo:g}–{hi:g} {unit}"


def _make_histogram(values: list[float], edges: list[float]) -> list[HistogramBin]:
    """Bin values into [edges[0], edges[1]), ..., [edges[-1], ∞). Last bin is open-ended."""
    counts = [0] * len(edges)
    for v in values:
        # values are expected to be non-negative (we pass abs sink)
        placed = False
        for i in range(len(edges) - 1):
            if v < edges[i + 1]:
                counts[i] += 1
                placed = True
                break
        if not placed:
            counts[-1] += 1
    bins: list[HistogramBin] = []
    for i in range(len(edges)):
        lo = edges[i]
        hi = edges[i + 1] if i + 1 < len(edges) else None
        bins.append(HistogramBin(label=_bin_label(lo, hi), lo=lo, hi=hi, count=counts[i]))
    return bins


def _mean(vs: list[float]) -> float | None:
    return round(sum(vs) / len(vs), 2) if vs else None


def _point_in_sector(
    lat: float, lon: float,
    center_lat: float, center_lon: float,
    radius_km: float, bearing_from: float, bearing_to: float,
) -> bool:
    if analysis.haversine_m(center_lat, center_lon, lat, lon) > radius_km * 1000:
        return False
    b = analysis.bearing_deg(center_lat, center_lon, lat, lon)
    return bearing_from <= b < bearing_to


def _point_in_cell(
    lat: float, lon: float,
    center_lat: float, center_lon: float,
    cell_km: float, dx: int, dy: int,
) -> bool:
    import math as _math
    lat_per_km = 1.0 / 111.0
    lon_per_km = 1.0 / (111.0 * _math.cos(_math.radians(center_lat)) or 1e-9)
    ratio_y = (lat - center_lat) / (cell_km * lat_per_km)
    ratio_x = (lon - center_lon) / (cell_km * lon_per_km)
    return abs(ratio_x - dx) <= 0.5 and abs(ratio_y - dy) <= 0.5


def _build_group(
    label: str, key: str,
    climbs: list[float], sinks: list[float],
    flight_ids: set[int],
) -> HistogramGroup:
    return HistogramGroup(
        label=label,
        key=key,
        flight_count=len(flight_ids),
        fix_count=len(climbs) + len(sinks),
        climb_mean_ms=_mean(climbs),
        sink_mean_ms=_mean(sinks),
        climb_hist=_make_histogram(climbs, CLIMB_BIN_EDGES),
        sink_hist=_make_histogram(sinks, SINK_BIN_EDGES),
    )


@core.get("/api/stats/area/block-stats", response_model=BlockStats)
def stats_area_block(
    shape: str,
    center_lat: float = MENUMA_LAT,
    center_lon: float = MENUMA_LON,
    block_label: str = "",
    # sector params
    bearing_from: float | None = None,
    bearing_to: float | None = None,
    radius_km: float | None = None,
    # cell params
    dx: int | None = None,
    dy: int | None = None,
    cell_km: float | None = None,
    db: Session = Depends(get_db),
):
    """Climb/sink rate histograms for one area block, grouped overall, by season, and by day.

    `shape` must be either "sector" (requires bearing_from/bearing_to/radius_km) or
    "cell" (requires dx/dy/cell_km).
    """
    if shape == "sector":
        if bearing_from is None or bearing_to is None or radius_km is None:
            raise HTTPException(400, "sector shape requires bearing_from, bearing_to, radius_km")

        def in_block(lat: float, lon: float) -> bool:
            return _point_in_sector(lat, lon, center_lat, center_lon, radius_km, bearing_from, bearing_to)
    elif shape == "cell":
        if dx is None or dy is None or cell_km is None:
            raise HTTPException(400, "cell shape requires dx, dy, cell_km")

        def in_block(lat: float, lon: float) -> bool:
            return _point_in_cell(lat, lon, center_lat, center_lon, cell_km, dx, dy)
    else:
        raise HTTPException(400, "shape must be 'sector' or 'cell'")

    rows = (
        db.query(GpsFix, Flight)
        .join(Flight, GpsFix.flight_id == Flight.id)
        .filter(GpsFix.climb_rate_ms.isnot(None))
        .all()
    )

    all_climbs: list[float] = []
    all_sinks: list[float] = []
    all_flights: set[int] = set()
    season_climbs: dict[str, list[float]] = {k: [] for _, k, _ in _SEASONS}
    season_sinks: dict[str, list[float]] = {k: [] for _, k, _ in _SEASONS}
    season_flights: dict[str, set[int]] = {k: set() for _, k, _ in _SEASONS}
    day_climbs: dict[str, list[float]] = {}
    day_sinks: dict[str, list[float]] = {}
    day_flights: dict[str, set[int]] = {}

    season_label = {k: label for label, k, _ in _SEASONS}

    for fix, flight in rows:
        if not in_block(fix.latitude, fix.longitude):
            continue
        cr = fix.climb_rate_ms
        date_key = flight.flight_date.isoformat()
        _, skey = _season_of(flight.flight_date.month)

        all_flights.add(flight.id)
        season_flights[skey].add(flight.id)
        day_flights.setdefault(date_key, set()).add(flight.id)

        if cr > 0:
            all_climbs.append(cr)
            season_climbs[skey].append(cr)
            day_climbs.setdefault(date_key, []).append(cr)
        elif cr < 0:
            s = -cr
            all_sinks.append(s)
            season_sinks[skey].append(s)
            day_sinks.setdefault(date_key, []).append(s)

    by_season: list[HistogramGroup] = []
    for _, k, _ in _SEASONS:
        if not season_flights[k]:
            continue
        by_season.append(_build_group(season_label[k], k, season_climbs[k], season_sinks[k], season_flights[k]))

    by_day: list[HistogramGroup] = []
    for d in sorted(day_flights):
        by_day.append(_build_group(d, d, day_climbs.get(d, []), day_sinks.get(d, []), day_flights[d]))

    return BlockStats(
        block_label=block_label or "Block",
        total_fixes=len(all_climbs) + len(all_sinks),
        total_flights=len(all_flights),
        overall=_build_group("全データ", "all", all_climbs, all_sinks, all_flights),
        by_season=by_season,
        by_day=by_day,
    )


@core.get("/api/tracks", response_model=list[FlightTrack])
def flight_tracks(
    ids: str,
    max_points: int = 120,
    db: Session = Depends(get_db),
):
    """Lightweight bulk endpoint: just downsampled lat/lon for many flights.

    Points per flight are scaled down automatically when many flights are
    requested so that total DB load and response size stay bounded.
    Only lat/lon/seq columns are fetched to minimise object-creation overhead.
    """
    flight_ids = [int(x) for x in ids.split(",") if x.strip().lstrip("-").isdigit()]
    if not flight_ids:
        return []

    # Adaptive points-per-flight: keep total ≤ ~1500 points
    effective_max = max(15, min(max_points, 1500 // len(flight_ids)))

    flights = {
        f.id: f
        for f in db.query(Flight).filter(Flight.id.in_(flight_ids)).all()
    }

    # Select only the three columns we need — much faster than full ORM objects
    rows = (
        db.query(GpsFix.flight_id, GpsFix.seq, GpsFix.latitude, GpsFix.longitude)
        .filter(GpsFix.flight_id.in_(flight_ids))
        .order_by(GpsFix.flight_id, GpsFix.seq)
        .all()
    )

    by_flight: dict[int, list[tuple]] = {}
    for row in rows:
        by_flight.setdefault(row[0], []).append(row)

    out: list[FlightTrack] = []
    for fid in flight_ids:
        flight = flights.get(fid)
        flight_rows = by_flight.get(fid, [])
        if not flight or not flight_rows:
            continue
        step = max(1, len(flight_rows) // effective_max)
        points = [TrackPoint(lat=r[2], lon=r[3]) for r in flight_rows[::step]]
        out.append(FlightTrack(
            flight_id=fid,
            pilot=flight.pilot,
            aircraft=flight.aircraft,
            points=points,
        ))
    return out


@core.get("/api/normalize-filename")
def api_normalize_filename(name: str):
    """Dry-run filename normalization so the UI can preview before upload."""
    normalized, notes = normalize_filename(name)
    parsed = parse_filename(normalized)
    return {
        "original": name,
        "normalized": normalized,
        "changed": normalized != name,
        "notes": notes,
        "valid": parsed is not None,
        "parsed": (
            {
                "flight_date": parsed.flight_date.isoformat(),
                "aircraft": parsed.aircraft,
                "pilot": parsed.pilot,
                "remarks": parsed.remarks,
            }
            if parsed
            else None
        ),
    }


@core.get("/api/health")
def health():
    return {"status": "ok"}


# Serve the built React frontend in production.
# In dev, run Vite separately (`npm run dev`) which proxies /api to this server.
STATIC_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if STATIC_DIR.is_dir():
    core.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @core.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        candidate = STATIC_DIR / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        # React Router uses history mode; fall back to index.html.
        return FileResponse(STATIC_DIR / "index.html")


# Optional sub-path mount. When BASE_PATH is set (e.g. "/glider"), expose the
# entire app under that prefix so it can sit behind a reverse proxy on a parent
# site (e.g. jbb2026sg.com/glider). When empty, serve at root as before.
BASE_PATH = os.environ.get("BASE_PATH", "").rstrip("/")
if BASE_PATH:
    app = FastAPI(title="Glider Flight Analyzer (mount wrapper)")
    app.mount(BASE_PATH, core)
else:
    app = core
