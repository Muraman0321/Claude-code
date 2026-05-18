"""Smoke tests for filename + IGC parsing and analysis."""
from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import analysis  # noqa: E402
import igc_parser  # noqa: E402
from filename_parser import parse_filename  # noqa: E402


def test_parse_filename_basic():
    meta = parse_filename("26.04.11_JA04KH_shin_27*3.igc")
    assert meta is not None
    assert meta.flight_date == date(2026, 4, 11)
    assert meta.aircraft == "JA04KH"
    assert meta.pilot == "shin"
    assert meta.remarks == "27*3"


def test_parse_filename_no_remarks():
    meta = parse_filename("24.05.01_JA12AB_Yamada.igc")
    assert meta is not None
    assert meta.flight_date == date(2024, 5, 1)
    assert meta.aircraft == "JA12AB"
    assert meta.pilot == "Yamada"
    assert meta.remarks is None


def test_parse_filename_invalid():
    assert parse_filename("flight.igc") is None
    assert parse_filename("99.13.01_X_Y.igc") is None  # invalid month


def _synth_igc(num_fixes: int = 60) -> str:
    """Build a tiny synthetic IGC file: takeoff, climb 5 min, glide 5 min."""
    lines = [
        "AXXX",
        "HFDTE110426",
        "HFPLTPILOTINCHARGE:shin",
        "HFGTYGLIDERTYPE:ASW28",
        "HFGIDGLIDERID:JA04KH",
    ]
    # Start at 36.0N, 138.0E, climb at 2 m/s for first half, descend at 1 m/s rest
    lat_deg, lat_min = 36, 0.0
    lon_deg, lon_min = 138, 0.0
    alt = 500
    for i in range(num_fixes):
        hh = 10
        total_sec = i * 10
        mm = (total_sec // 60) % 60
        ss = total_sec % 60
        # Climb phase first half, glide second half
        if i < num_fixes // 2:
            alt += 20  # 2 m/s over 10 s
        else:
            alt -= 10  # 1 m/s descent
            lon_min += 0.05  # move east while gliding
        lat_str = f"{lat_deg:02d}{int(lat_min*1000):05d}N"
        lon_str = f"{lon_deg:03d}{int(lon_min*1000):05d}E"
        pa = max(0, alt - 50)
        ga = max(0, alt)
        lines.append(f"B{hh:02d}{mm:02d}{ss:02d}{lat_str}{lon_str}A{pa:05d}{ga:05d}")
    return "\n".join(lines)


def test_igc_parser_reads_headers_and_fixes():
    text = _synth_igc()
    igc = igc_parser.parse_igc_bytes(text.encode("latin-1"))
    assert igc.flight_date == date(2026, 4, 11)
    assert igc.pilot == "shin"
    assert igc.aircraft_type == "ASW28"
    assert igc.aircraft_id == "JA04KH"
    assert len(igc.fixes) == 60
    assert igc.fixes[0].gps_altitude == 520  # 500 + 20 on first iteration


def test_analysis_detects_climb_and_glide():
    text = _synth_igc(num_fixes=120)
    igc = igc_parser.parse_igc_bytes(text.encode("latin-1"))
    metrics = analysis.compute_fix_metrics(igc.fixes)
    thermals = analysis.detect_thermals(igc.fixes, metrics)
    summary = analysis.compute_summary(igc.fixes, metrics, thermals)

    assert summary.duration_s == 1190  # 119 intervals * 10s
    assert summary.max_climb_rate_ms > 0
    assert summary.thermal_count >= 1
    assert summary.altitude_gain_m > 0
    # Glide section should yield a measurable best L/D.
    assert summary.best_glide_ratio > 0


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"OK  {name}")
