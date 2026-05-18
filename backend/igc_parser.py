"""Parser for IGC flight recorder files.

The IGC format is defined by the FAI (Fédération Aéronautique Internationale).
We only need the records most relevant for analysis: H (header), B (GPS fix),
and a couple of optional ones (HFDTE date, HFPLT pilot, HFGTY glider type).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from pathlib import Path
from typing import Iterable


@dataclass
class Fix:
    timestamp: datetime
    latitude: float
    longitude: float
    pressure_altitude: int
    gps_altitude: int
    valid: bool


@dataclass
class IGCFile:
    flight_date: date | None = None
    pilot: str | None = None
    aircraft_type: str | None = None
    aircraft_id: str | None = None
    competition_id: str | None = None
    fixes: list[Fix] = field(default_factory=list)


def _parse_lat(raw: str) -> float:
    """Convert IGC latitude (DDMMmmmN/S) to signed decimal degrees."""
    deg = int(raw[0:2])
    minutes = int(raw[2:7]) / 1000.0
    value = deg + minutes / 60.0
    return -value if raw[7] in ("S", "s") else value


def _parse_lon(raw: str) -> float:
    """Convert IGC longitude (DDDMMmmmE/W) to signed decimal degrees."""
    deg = int(raw[0:3])
    minutes = int(raw[3:8]) / 1000.0
    value = deg + minutes / 60.0
    return -value if raw[8] in ("W", "w") else value


def _parse_header_value(line: str) -> str:
    """Return the value after the first colon, or after the 5-char prefix."""
    if ":" in line:
        return line.split(":", 1)[1].strip()
    return line[5:].strip()


def parse_igc(lines: Iterable[str]) -> IGCFile:
    igc = IGCFile()
    flight_date = None
    last_seconds = -1
    day_offset = 0  # seconds, to handle UTC midnight rollover

    for raw_line in lines:
        line = raw_line.rstrip("\r\n")
        if not line:
            continue

        rec_type = line[0]

        if rec_type == "H":
            # Header records
            tlc = line[2:5].upper() if len(line) >= 5 else ""
            if tlc == "DTE":
                # HFDTEDDMMYY or HFDTEDATE:DDMMYY,NN
                digits = "".join(c for c in line if c.isdigit())
                if len(digits) >= 6:
                    dd, mm, yy = int(digits[0:2]), int(digits[2:4]), int(digits[4:6])
                    year = 2000 + yy if yy < 80 else 1900 + yy
                    try:
                        flight_date = date(year, mm, dd)
                        igc.flight_date = flight_date
                    except ValueError:
                        pass
            elif tlc == "PLT":
                igc.pilot = _parse_header_value(line)
            elif tlc == "GTY":
                igc.aircraft_type = _parse_header_value(line)
            elif tlc == "GID":
                igc.aircraft_id = _parse_header_value(line)
            elif tlc == "CID":
                igc.competition_id = _parse_header_value(line)

        elif rec_type == "B" and len(line) >= 35:
            # B HHMMSS DDMMmmm[N/S] DDDMMmmm[E/W] A PPPPP GGGGG
            try:
                hh = int(line[1:3])
                mm = int(line[3:5])
                ss = int(line[5:7])
                lat = _parse_lat(line[7:15])
                lon = _parse_lon(line[15:24])
                fix_valid = line[24] == "A"
                pressure_alt = int(line[25:30])
                gps_alt = int(line[30:35])
            except ValueError:
                continue

            seconds = hh * 3600 + mm * 60 + ss
            if seconds < last_seconds - 60:
                # UTC day rollover during the flight.
                day_offset += 86400
            last_seconds = seconds
            base_date = flight_date or date(1970, 1, 1)
            base_dt = datetime.combine(base_date, time(0, 0), tzinfo=timezone.utc)
            timestamp = base_dt.fromtimestamp(
                base_dt.timestamp() + seconds + day_offset, tz=timezone.utc
            )

            igc.fixes.append(
                Fix(
                    timestamp=timestamp,
                    latitude=lat,
                    longitude=lon,
                    pressure_altitude=pressure_alt,
                    gps_altitude=gps_alt,
                    valid=fix_valid,
                )
            )

    return igc


def parse_igc_file(path: str | Path) -> IGCFile:
    with open(path, "r", encoding="latin-1") as f:
        return parse_igc(f)


def parse_igc_bytes(data: bytes) -> IGCFile:
    text = data.decode("latin-1")
    return parse_igc(text.splitlines())
