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
    assert meta.pilot == "SHIN"
    assert meta.remarks == "27*3"


def test_parse_filename_no_remarks():
    meta = parse_filename("24.05.01_JA12AB_Yamada.igc")
    assert meta is not None
    assert meta.flight_date == date(2024, 5, 1)
    assert meta.aircraft == "JA12AB"
    assert meta.pilot == "YAMADA"
    assert meta.remarks is None


def test_parse_filename_invalid():
    assert parse_filename("flight.igc") is None
    assert parse_filename("99.13.01_JA01_PILOT.igc") is None  # invalid month


def test_parse_filename_underscore_date():
    meta = parse_filename("26_04_12_JA04KH_Tajima.igc")
    assert meta is not None
    assert meta.flight_date == date(2026, 4, 12)
    assert meta.aircraft == "JA04KH"
    assert meta.pilot == "TAJIMA"
    assert meta.remarks is None


def test_parse_filename_remarks_with_underscore():
    meta = parse_filename("26.04.11_JA2408_Tajima_27_2.igc")
    assert meta is not None
    assert meta.aircraft == "JA2408"
    assert meta.pilot == "TAJIMA"
    assert meta.remarks == "27_2"


def test_parse_filename_order_independent_pilot_first():
    """JA block can appear anywhere — pilot/aircraft are detected semantically."""
    meta = parse_filename("26.04.11_TAJIMA_JA04KH.igc")
    assert meta is not None
    assert meta.aircraft == "JA04KH"
    assert meta.pilot == "TAJIMA"
    assert meta.remarks is None


def test_parse_filename_extras_become_remarks():
    """Blocks that are neither JA-prefixed nor purely alphabetic become remarks."""
    meta = parse_filename("26.04.11_27*3_JA04KH_SHIN.igc")
    assert meta is not None
    assert meta.aircraft == "JA04KH"
    assert meta.pilot == "SHIN"
    assert meta.remarks == "27*3"


def test_parse_filename_uppercases_lowercase_input():
    """Lowercase pilot/aircraft are normalized to uppercase in the parsed result."""
    meta = parse_filename("26.04.11_ja04kh_tajima.igc")
    assert meta is not None
    assert meta.aircraft == "JA04KH"
    assert meta.pilot == "TAJIMA"


def test_parse_filename_requires_ja_block():
    """A filename without any JA-prefixed block cannot be parsed."""
    assert parse_filename("26.04.11_PILOT_REMARK.igc") is None


def test_normalize_extension_case():
    from filename_parser import normalize_filename
    name, notes = normalize_filename("26.04.11_JA04KH_shin.IGC")
    assert name == "26.04.11_JA04KH_SHIN.igc"
    assert any("拡張子" in n for n in notes)
    assert any("大文字" in n for n in notes)


def test_normalize_four_digit_year():
    from filename_parser import normalize_filename, parse_filename
    name, notes = normalize_filename("2026.04.11_JA04KH_shin.igc")
    assert name == "26.04.11_JA04KH_SHIN.igc"
    assert parse_filename(name) is not None


def test_normalize_dash_date_separators():
    from filename_parser import normalize_filename, parse_filename
    name, _ = normalize_filename("26-04-11_JA04KH_shin.igc")
    assert name == "26.04.11_JA04KH_SHIN.igc"
    assert parse_filename(name) is not None


def test_normalize_slash_date_separators():
    from filename_parser import normalize_filename, parse_filename
    name, _ = normalize_filename("26/04/11_JA04KH_shin.igc")
    assert name == "26.04.11_JA04KH_SHIN.igc"
    assert parse_filename(name) is not None


def test_normalize_single_digit_month_day():
    from filename_parser import normalize_filename, parse_filename
    name, _ = normalize_filename("26.4.5_JA04KH_shin.igc")
    assert name == "26.04.05_JA04KH_SHIN.igc"
    assert parse_filename(name) is not None


def test_normalize_no_date_separator():
    from filename_parser import normalize_filename, parse_filename
    name, _ = normalize_filename("260411_JA04KH_shin.igc")
    assert name == "26.04.11_JA04KH_SHIN.igc"
    assert parse_filename(name) is not None


def test_normalize_eight_digit_date():
    from filename_parser import normalize_filename, parse_filename
    name, _ = normalize_filename("20260411_JA04KH_shin.igc")
    assert name == "26.04.11_JA04KH_SHIN.igc"
    assert parse_filename(name) is not None


def test_normalize_space_separators():
    from filename_parser import normalize_filename, parse_filename
    name, _ = normalize_filename("26.04.11 JA04KH shin.igc")
    assert name == "26.04.11_JA04KH_SHIN.igc"
    assert parse_filename(name) is not None


def test_normalize_dash_field_separators():
    from filename_parser import normalize_filename, parse_filename
    name, _ = normalize_filename("26.04.11-JA04KH-shin.igc")
    assert name == "26.04.11_JA04KH_SHIN.igc"
    assert parse_filename(name) is not None


def test_normalize_doubled_separators():
    from filename_parser import normalize_filename, parse_filename
    name, _ = normalize_filename("26.04.11__JA04KH__shin.igc")
    assert name == "26.04.11_JA04KH_SHIN.igc"
    assert parse_filename(name) is not None


def test_normalize_combined_mess():
    from filename_parser import normalize_filename, parse_filename
    name, notes = normalize_filename("  2026-4-5 JA04KH-shin .IGC ")
    assert name == "26.04.05_JA04KH_SHIN.igc"
    assert parse_filename(name) is not None
    assert len(notes) >= 2


def test_normalize_preserves_remarks_with_dots():
    """Decimals inside remarks like `27.5` must NOT be turned into separators."""
    from filename_parser import normalize_filename, parse_filename
    name, _ = normalize_filename("26.04.11_JA04KH_shin_27.5.igc")
    parsed = parse_filename(name)
    assert parsed is not None
    assert parsed.remarks == "27.5"


def test_normalize_already_canonical_is_noop():
    from filename_parser import normalize_filename
    name, notes = normalize_filename("26.04.11_JA04KH_SHIN_27_2.igc")
    assert name == "26.04.11_JA04KH_SHIN_27_2.igc"
    assert notes == []


def test_parse_or_normalize_falls_back():
    from filename_parser import parse_or_normalize
    parsed, name, notes = parse_or_normalize("2026-04-11 JA04KH-shin.IGC")
    assert parsed is not None
    assert parsed.aircraft == "JA04KH"
    assert parsed.pilot == "SHIN"
    assert name == "26.04.11_JA04KH_SHIN.igc"
    assert notes


def _synth_igc(num_fixes: int = 60) -> str:
    """Build a synthetic IGC with realistic launch phases.

    Phase layout (each fix = 10 s):
      i 0-4   : ground roll — horizontal movement, no altitude change
      i 5-24  : winch climb — 3 m/s up, no horizontal movement
      i 25-29 : release — 1 m/s descent
      i 30-49 : free thermal — 1 m/s up, no horizontal movement
      i 50+   : glide — 0.8 m/s descent, moving east

    The tow-exclusion logic in detect_thermals should skip the winch climb
    and count only the free thermal (and any subsequent ones) as thermals.
    """
    lines = [
        "AXXX",
        "HFDTE110426",
        "HFPLTPILOTINCHARGE:shin",
        "HFGTYGLIDERTYPE:ASW28",
        "HFGIDGLIDERID:JA04KH",
    ]
    lat_deg, lat_min = 36, 0.0
    lon_deg, lon_min = 138, 0.0
    alt = 100  # ground level (m)
    for i in range(num_fixes):
        total_sec = i * 10
        hh = 10
        mm = (total_sec // 60) % 60
        ss = total_sec % 60
        if i < 5:
            lon_min += 0.28     # ~100 km/h ground roll, no altitude change
        elif i < 25:
            alt += 30           # winch: 3 m/s for 20 fixes → +600 m
        elif i < 30:
            alt -= 10           # release descent
        elif i < 50:
            alt += 10           # free thermal: 1 m/s for 20 fixes → +200 m
        else:
            alt -= 8            # glide descent
            lon_min += 0.10     # move east while gliding
        alt = max(alt, 50)
        lat_str = f"{lat_deg:02d}{int(lat_min * 1000):05d}N"
        lon_str = f"{lon_deg:03d}{int(lon_min * 1000):05d}E"
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
    assert igc.fixes[0].gps_altitude == 100  # ground level at start


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


def test_tow_climb_excluded_from_thermals():
    """The winch/aerotow climb must not appear in the thermal list."""
    text = _synth_igc(num_fixes=120)
    igc = igc_parser.parse_igc_bytes(text.encode("latin-1"))
    metrics = analysis.compute_fix_metrics(igc.fixes)
    thermals = analysis.detect_thermals(igc.fixes, metrics)

    # The free thermal starts at ~fix 30 (after release at fix 25).
    # All detected thermals must start well after the winch phase.
    # Fix 25 corresponds to 250 s from t=0 (10 s/fix × 25).
    tow_cutoff = igc.fixes[25].timestamp
    for t in thermals:
        from datetime import datetime, timezone
        t_start = datetime.fromisoformat(t.start_time)
        if t_start.tzinfo is None:
            t_start = t_start.replace(tzinfo=timezone.utc)
        assert t_start >= tow_cutoff, (
            f"Thermal at {t_start} starts before tow release at {tow_cutoff}"
        )


def test_weather_picks_nearest_hour(monkeypatch):
    """The weather module should pick the hour closest to the flight start."""
    import weather as wx

    def fake_get(url, params, timeout):
        class R:
            def raise_for_status(self_): pass
            def json(self_):
                return {
                    "hourly": {
                        "time": ["2026-04-11T00:00", "2026-04-11T01:00", "2026-04-11T02:00", "2026-04-11T03:00"],
                        "temperature_2m": [10.0, 11.0, 12.0, 13.0],
                        "wind_speed_10m": [5.0, 6.0, 7.0, 8.0],
                        "wind_direction_10m": [180, 190, 200, 210],
                        "surface_pressure": [1013, 1013, 1014, 1014],
                        "cloud_cover": [10, 20, 30, 40],
                        "relative_humidity_2m": [70, 65, 60, 55],
                    }
                }
        return R()

    monkeypatch.setattr(wx.httpx, "get", fake_get)

    from datetime import datetime, timezone
    snap = wx.fetch_weather(36.2, 139.4, datetime(2026, 4, 11, 2, 20, tzinfo=timezone.utc))
    assert snap is not None
    # 02:20 is closest to 02:00 (index 2)
    assert snap.temp_c == 12.0
    assert snap.wind_speed_kmh == 7.0
    assert snap.wind_dir_deg == 200


def test_extract_drive_folder_id():
    from drive_import import extract_folder_id
    assert extract_folder_id("https://drive.google.com/drive/folders/19vBIjr95cX6eLUfrxVHJybogCr7_64YQ") == "19vBIjr95cX6eLUfrxVHJybogCr7_64YQ"
    assert extract_folder_id("https://drive.google.com/drive/folders/19vBIjr95cX6eLUfrxVHJybogCr7_64YQ?usp=sharing") == "19vBIjr95cX6eLUfrxVHJybogCr7_64YQ"
    assert extract_folder_id("https://drive.google.com/drive/u/0/folders/abc_DEF-123456789012345") == "abc_DEF-123456789012345"
    assert extract_folder_id("https://drive.google.com/open?id=abc_DEF-123456789012345") == "abc_DEF-123456789012345"
    assert extract_folder_id("19vBIjr95cX6eLUfrxVHJybogCr7_64YQ") == "19vBIjr95cX6eLUfrxVHJybogCr7_64YQ"
    assert extract_folder_id("not a url") is None
    assert extract_folder_id("") is None


def test_drive_list_via_embedded_view_parses_entries(monkeypatch):
    import drive_import

    # Realistic fragment of the embedded folder view that Drive serves.
    fake_html = """
    <html><body>
    <div class="flip-grid">
      <div class="flip-entry" data-id="1BMVnlvuNwIv2_mpz4HJTtIhljktqxcc1">
        <a href="https://drive.google.com/file/d/1BMVnlvuNwIv2_mpz4HJTtIhljktqxcc1/view?usp=drive_link">
          <div class="flip-entry-thumb">...</div>
        </a>
        <div class="flip-entry-title" title="26.04.11_JA04KH_shin.igc">26.04.11_JA04KH_shin.igc</div>
      </div>
      <div class="flip-entry" data-id="1vtjOMaGVUL6yo4DzxkVG4Mn6ZUXi2HzV">
        <a href="https://drive.google.com/file/d/1vtjOMaGVUL6yo4DzxkVG4Mn6ZUXi2HzV/view">
          ...
        </a>
        <div class="flip-entry-title">26.04.12_JA2408_Tajima.igc</div>
      </div>
    </div>
    </body></html>
    """

    class FakeResp:
        text = fake_html
        def raise_for_status(self): pass

    def fake_get(url, timeout, follow_redirects, headers):
        assert "embeddedfolderview" in url
        return FakeResp()

    monkeypatch.setattr(drive_import.httpx, "get", fake_get)
    files = drive_import._list_via_embedded_view("FOLDER", timeout=5.0)
    assert len(files) == 2
    names = {f.name for f in files}
    assert "26.04.11_JA04KH_shin.igc" in names
    assert "26.04.12_JA2408_Tajima.igc" in names


def test_drive_download_file(monkeypatch):
    import drive_import

    class FakeResp:
        content = b"FAKE IGC CONTENTS"
        def raise_for_status(self): pass

    def fake_get(url, params, timeout, follow_redirects, headers):
        assert params["id"] == "MY_FILE_ID"
        assert params["export"] == "download"
        return FakeResp()

    monkeypatch.setattr(drive_import.httpx, "get", fake_get)
    data = drive_import.download_file("MY_FILE_ID")
    assert data == b"FAKE IGC CONTENTS"


def test_weather_returns_none_on_error(monkeypatch):
    import weather as wx

    def boom(url, params, timeout):
        raise wx.httpx.ConnectError("no network")

    monkeypatch.setattr(wx.httpx, "get", boom)

    from datetime import datetime, timezone
    assert wx.fetch_weather(0, 0, datetime(2026, 1, 1, tzinfo=timezone.utc)) is None


if __name__ == "__main__":
    # Tiny ad-hoc test runner so we don't require pytest just to run smoke tests.
    class MonkeyPatch:
        def __init__(self): self._undo = []
        def setattr(self, target, name, value):
            old = getattr(target, name)
            self._undo.append((target, name, old))
            setattr(target, name, value)
        def reset(self):
            for t, n, o in reversed(self._undo):
                setattr(t, n, o)
            self._undo.clear()

    import inspect
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            sig = inspect.signature(fn)
            mp = MonkeyPatch()
            try:
                if "monkeypatch" in sig.parameters:
                    fn(mp)
                else:
                    fn()
                print(f"OK  {name}")
            finally:
                mp.reset()
