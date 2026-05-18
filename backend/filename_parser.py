"""Parse the project-specific IGC filename convention.

Canonical format: yy<sep>mm<sep>dd_<aircraft>_<pilot>[_<remarks>].igc
where <sep> is either `.` or `_`.

Examples:
  26.04.11_JA04KH_shin_27*3.igc
  26.04.11_JA2408_Tajima_27_2.igc
  26_04_12_JA04KH_Tajima.igc

`normalize_filename` repairs common typos so files like
`2026-4-11 JA04KH-shin.IGC` still upload successfully.
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


def normalize_filename(filename: str) -> tuple[str, list[str]]:
    """Best-effort fixup of common filename typos.

    Returns (normalized_name, list_of_change_descriptions).
    If the input is already canonical, returns it unchanged with [].
    The returned name is not guaranteed to parse; the caller should still
    run `parse_filename` on it.

    Handles:
    - `.IGC`, `.Igc` → `.igc`
    - 4-digit year (`2026...`) → 2-digit year
    - Date separators `- / . _ space` (or none, `260411`) → unified
    - Field separators `space - .` between fields → `_`
    - Consecutive separators (`__`, `--`) → single `_`
    - Leading/trailing whitespace
    - Single-digit month/day (`26.4.5` → `26.04.05`)
    """
    changes: list[str] = []
    # Don't go through pathlib here: it would treat `/` as a directory
    # separator, but in this normalizer we want to be able to repair
    # `26/04/11_...igc` (where `/` is a mistaken date separator).
    name = filename.strip()
    if name != filename:
        changes.append("前後の空白を除去")

    # 1. Normalize extension to lowercase .igc
    if not re.search(r"\.igc$", name, re.IGNORECASE):
        return name, changes  # not an IGC file at all
    if not name.endswith(".igc"):
        name = name[:-4] + ".igc"
        changes.append("拡張子を小文字「.igc」に")

    stem = name[:-4]

    # 2. Try to find date at the start
    #    Accept yyyy or yy, with separator [- / . _ space] of any length,
    #    or no separator at all (yymmdd / yyyymmdd).
    date_re = re.compile(
        r"^(?P<y>\d{2,4})[\-/.\s_]+(?P<m>\d{1,2})[\-/.\s_]+(?P<d>\d{1,2})(?P<rest>.*)$"
    )
    m = date_re.match(stem)
    if m:
        y_raw = m.group("y")
        mm = int(m.group("m"))
        dd = int(m.group("d"))
        if not (1 <= mm <= 12 and 1 <= dd <= 31):
            return name, changes
        yy = y_raw[-2:]
        canonical_date = f"{yy}.{mm:02d}.{dd:02d}"
        if stem[: m.end("d")] != canonical_date:
            if len(y_raw) > 2:
                changes.append("4桁年を2桁に")
            else:
                changes.append("日付フォーマットを yy.mm.dd に統一")
        stem = canonical_date + m.group("rest")
    else:
        # No separator anywhere? Try 6 or 8 contiguous digits.
        # Order matters: try the longer (8-digit) alternative first so we
        # don't greedily consume just yymmdd from a yyyymmdd input.
        m2 = re.match(r"^(?P<digits>\d{8}|\d{6})(?P<rest>.*)$", stem)
        if m2:
            digits = m2.group("digits")
            if len(digits) == 8:
                yy = digits[2:4]; mm = int(digits[4:6]); dd = int(digits[6:8])
            else:  # 6
                yy = digits[0:2]; mm = int(digits[2:4]); dd = int(digits[4:6])
            if not (1 <= mm <= 12 and 1 <= dd <= 31):
                return name, changes
            stem = f"{yy}.{mm:02d}.{dd:02d}" + m2.group("rest")
            changes.append("日付に区切りを挿入")

    # 3. Normalize field separators between aircraft/pilot/remarks
    m3 = re.match(r"^(?P<date>\d{2}[._]\d{2}[._]\d{2})(?P<body>.*)$", stem)
    if m3:
        date_part = m3.group("date")
        body = m3.group("body")
        body_orig = body
        # Strip whitespace inside the body so trailing spaces don't become `_`.
        body = body.strip()
        # Replace runs of [- space tab] with `_`, preserving content.
        # Note: we intentionally do NOT touch `_` runs other than collapsing them.
        body = re.sub(r"[\s\-]+", "_", body)
        # Collapse runs of `.` that are between fields (not in dates) to `_` —
        # only matches when there's no digit directly after, to keep things like
        # `27.5` in remarks intact. Heuristic: collapse `.` only if not flanked
        # by digits on both sides.
        body = re.sub(r"(?<!\d)\.(?!\d)", "_", body)
        body = re.sub(r"_+", "_", body)
        body = body.strip("_")
        if body and not body.startswith("_"):
            body = "_" + body
        if body != body_orig:
            changes.append("フィールド区切りを「_」に統一")
        stem = date_part + body

    return stem + ".igc", changes


def parse_or_normalize(filename: str) -> tuple[ParsedFilename | None, str, list[str]]:
    """Try strict parse first; if it fails, normalize and retry.

    Returns (parsed, final_name, notes). `parsed` is None when both
    strict and normalized attempts fail.
    """
    parsed = parse_filename(filename)
    if parsed:
        return parsed, Path(filename).name, []
    normalized, notes = normalize_filename(filename)
    parsed = parse_filename(normalized)
    if parsed:
        return parsed, normalized, notes
    return None, normalized, notes
