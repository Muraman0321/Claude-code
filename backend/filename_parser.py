"""Parse the project-specific IGC filename convention.

Format: yy<sep>mm<sep>dd_<aircraft>_<pilot>[_<remarks>].igc
where <sep> is either `.` or `_`.

Examples:
  26.04.11_JA04KH_shin_27*3.igc
  26.04.11_JA2408_Tajima_27_2.igc
  26_04_12_JA04KH_Tajima.igc
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

FILENAME_RE = re.compile(
    r"^(?P<yy>\d{2})[._](?P<mm>\d{2})[._](?P<dd>\d{2})"
    r"_(?P<aircraft>[^_]+)"
    r"_(?P<pilot>[^_]+)"
    r"(?:_(?P<remarks>.+))?"
    r"\.igc$",
    re.IGNORECASE,
)


@dataclass
class ParsedFilename:
    flight_date: date
    aircraft: str
    pilot: str
    remarks: str | None


def parse_filename(filename: str) -> ParsedFilename | None:
    """Return parsed metadata, or None when the filename does not match."""
    name = Path(filename).name
    match = FILENAME_RE.match(name)
    if not match:
        return None

    yy = int(match["yy"])
    # Treat 00-79 as 2000-2079, 80-99 as 1980-1999.
    year = 2000 + yy if yy < 80 else 1900 + yy
    try:
        flight_date = date(year, int(match["mm"]), int(match["dd"]))
    except ValueError:
        return None

    return ParsedFilename(
        flight_date=flight_date,
        aircraft=match["aircraft"],
        pilot=match["pilot"],
        remarks=match["remarks"],
    )
