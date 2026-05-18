"""Parse the project-specific IGC filename convention.

Canonical format: yy<sep>mm<sep>dd_<block1>_<block2>_<...>.igc

Blocks are split by `_`. Identification rules (case-insensitive but
canonical form is uppercase):
  - First block starting with "JA" → aircraft number
  - First remaining block that is purely alphabetic → pilot
  - All remaining blocks → remarks (joined with `_`)

Examples:
  26.04.11_JA04KH_SHIN_27*3.igc       → JA04KH / SHIN / 27*3
  26.04.11_JA2408_TAJIMA_27_2.igc     → JA2408 / TAJIMA / 27_2
  26_04_12_JA04KH_TAJIMA.igc          → JA04KH / TAJIMA / (none)
  26.04.11_TAJIMA_JA04KH.igc          → JA04KH / TAJIMA (order-independent)

`normalize_filename` also uppercases the body (between date and `.igc`),
so downstream comparisons are case-stable.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

DATE_RE = re.compile(r"^(?P<yy>\d{2})[._](?P<mm>\d{2})[._](?P<dd>\d{2})(?:[._](?P<rest>.*))?$")


@dataclass
class ParsedFilename:
    flight_date: date
    aircraft: str
    pilot: str
    remarks: str | None


def _parse_date(yy: str, mm: str, dd: str) -> date | None:
    yy_i = int(yy)
    year = 2000 + yy_i if yy_i < 80 else 1900 + yy_i
    try:
        return date(year, int(mm), int(dd))
    except ValueError:
        return None


def parse_filename(filename: str) -> ParsedFilename | None:
    """Return parsed metadata using semantic block detection, or None on mismatch.

    The matching is case-insensitive but returned aircraft/pilot strings are
    upper-cased to enforce a canonical form in storage.
    """
    name = filename.strip()
    if not re.search(r"\.igc$", name, re.IGNORECASE):
        return None
    stem = name[:-4].upper()

    m = DATE_RE.match(stem)
    if not m:
        return None

    flight_date = _parse_date(m["yy"], m["mm"], m["dd"])
    if flight_date is None:
        return None

    rest = m["rest"] or ""
    blocks = [b for b in rest.split("_") if b]
    if not blocks:
        return None

    aircraft_idx = next((i for i, b in enumerate(blocks) if b.startswith("JA")), -1)
    if aircraft_idx < 0:
        return None
    aircraft = blocks[aircraft_idx]

    pilot_idx = next(
        (i for i, b in enumerate(blocks) if i != aircraft_idx and b.isalpha()),
        -1,
    )
    if pilot_idx < 0:
        return None
    pilot = blocks[pilot_idx]

    remark_blocks = [b for i, b in enumerate(blocks) if i != aircraft_idx and i != pilot_idx]
    remarks = "_".join(remark_blocks) if remark_blocks else None

    return ParsedFilename(
        flight_date=flight_date,
        aircraft=aircraft,
        pilot=pilot,
        remarks=remarks,
    )


def normalize_filename(filename: str) -> tuple[str, list[str]]:
    """Best-effort fixup of common filename typos.

    Returns (normalized_name, list_of_change_descriptions).
    The returned name is not guaranteed to parse; the caller should still
    run `parse_filename` on it.

    Steps:
    - Strip whitespace
    - Force extension to lowercase `.igc`
    - Uppercase the stem (body) for stable matching
    - Normalize date separators ("- / . _ space" or none) to `.`
    - Normalize 4-digit year to 2-digit
    - Replace runs of [- space tab .] between fields with single `_`
    - Collapse repeated `_`
    """
    changes: list[str] = []
    name = filename.strip()
    if name != filename:
        changes.append("前後の空白を除去")

    if not re.search(r"\.igc$", name, re.IGNORECASE):
        return name, changes
    if not name.endswith(".igc"):
        name = name[:-4] + ".igc"
        changes.append("拡張子を小文字「.igc」に")

    stem = name[:-4]
    upper_stem = stem.upper()
    if stem != upper_stem:
        stem = upper_stem
        changes.append("英字を大文字に統一")

    # Date normalization
    date_re = re.compile(
        r"^(?P<y>\d{2,4})[\-/.\s_]+(?P<m>\d{1,2})[\-/.\s_]+(?P<d>\d{1,2})(?P<rest>.*)$"
    )
    m = date_re.match(stem)
    if m:
        y_raw = m["y"]
        mm_i = int(m["m"])
        dd_i = int(m["d"])
        if not (1 <= mm_i <= 12 and 1 <= dd_i <= 31):
            return stem + ".igc", changes
        yy = y_raw[-2:]
        canonical_date = f"{yy}.{mm_i:02d}.{dd_i:02d}"
        if stem[: m.end("d")] != canonical_date:
            if len(y_raw) > 2:
                changes.append("4桁年を2桁に")
            else:
                changes.append("日付フォーマットを yy.mm.dd に統一")
        stem = canonical_date + m.group("rest")
    else:
        m2 = re.match(r"^(?P<digits>\d{8}|\d{6})(?P<rest>.*)$", stem)
        if m2:
            digits = m2.group("digits")
            if len(digits) == 8:
                yy = digits[2:4]; mm_i = int(digits[4:6]); dd_i = int(digits[6:8])
            else:
                yy = digits[0:2]; mm_i = int(digits[2:4]); dd_i = int(digits[4:6])
            if not (1 <= mm_i <= 12 and 1 <= dd_i <= 31):
                return stem + ".igc", changes
            stem = f"{yy}.{mm_i:02d}.{dd_i:02d}" + m2.group("rest")
            changes.append("日付に区切りを挿入")

    # Field separator normalization (after canonical date)
    m3 = re.match(r"^(?P<date>\d{2}[._]\d{2}[._]\d{2})(?P<body>.*)$", stem)
    if m3:
        date_part = m3.group("date")
        body = m3.group("body")
        body_orig = body
        body = body.strip()
        body = re.sub(r"[\s\-]+", "_", body)
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
    """Always run normalization (uppercases + cleans up) then parse.

    Returns (parsed, final_name, notes). `parsed` is None when parsing
    still fails after normalization.
    """
    normalized, notes = normalize_filename(filename)
    parsed = parse_filename(normalized)
    return parsed, normalized, notes
