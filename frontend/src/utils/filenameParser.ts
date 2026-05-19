export interface ParsedFilename {
  flightDate: string; // YYYY-MM-DD
  aircraft: string;
  pilot: string;
  remarks: string | null;
}

const DATE_RE = /^(\d{2})[._](\d{2})[._](\d{2})(?:[._](.*))?$/;

function buildDate(yy: string, mm: string, dd: string): string | null {
  const yyI = parseInt(yy, 10);
  const year = yyI < 80 ? 2000 + yyI : 1900 + yyI;
  const m = parseInt(mm, 10);
  const d = parseInt(dd, 10);
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
  const t = Date.UTC(year, m - 1, d);
  const back = new Date(t);
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== m - 1 ||
    back.getUTCDate() !== d
  ) {
    return null;
  }
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function isAlpha(s: string): boolean {
  return s.length > 0 && /^[A-Za-z]+$/.test(s);
}

export function parseFilename(filename: string): ParsedFilename | null {
  const name = filename.trim();
  if (!/\.igc$/i.test(name)) return null;
  const stem = name.slice(0, -4).toUpperCase();

  const m = DATE_RE.exec(stem);
  if (!m) return null;

  const flightDate = buildDate(m[1], m[2], m[3]);
  if (flightDate === null) return null;

  const rest = m[4] ?? "";
  const blocks = rest.split("_").filter((b) => b);
  if (blocks.length === 0) return null;

  const aircraftIdx = blocks.findIndex((b) => b.startsWith("JA"));
  if (aircraftIdx < 0) return null;
  const aircraft = blocks[aircraftIdx];

  const pilotIdx = blocks.findIndex((b, i) => i !== aircraftIdx && isAlpha(b));
  if (pilotIdx < 0) return null;
  const pilot = blocks[pilotIdx];

  const remarkBlocks = blocks.filter((_b, i) => i !== aircraftIdx && i !== pilotIdx);
  const remarks = remarkBlocks.length > 0 ? remarkBlocks.join("_") : null;

  return { flightDate, aircraft, pilot, remarks };
}

export interface NormalizationOutput {
  name: string;
  notes: string[];
}

export function normalizeFilename(filename: string): NormalizationOutput {
  const notes: string[] = [];
  let name = filename.trim();
  if (name !== filename) notes.push("前後の空白を除去");

  if (!/\.igc$/i.test(name)) return { name, notes };
  if (!name.endsWith(".igc")) {
    name = name.slice(0, -4) + ".igc";
    notes.push("拡張子を小文字「.igc」に");
  }

  let stem = name.slice(0, -4);
  const upper = stem.toUpperCase();
  if (stem !== upper) {
    stem = upper;
    notes.push("英字を大文字に統一");
  }

  // Date normalization
  const dateRe = /^(\d{2,4})[\-/.\s_]+(\d{1,2})[\-/.\s_]+(\d{1,2})(.*)$/;
  const m = dateRe.exec(stem);
  if (m) {
    const yRaw = m[1];
    const mI = parseInt(m[2], 10);
    const dI = parseInt(m[3], 10);
    if (!(mI >= 1 && mI <= 12 && dI >= 1 && dI <= 31)) {
      return { name: stem + ".igc", notes };
    }
    const yy = yRaw.slice(-2);
    const canonicalDate = `${yy}.${String(mI).padStart(2, "0")}.${String(dI).padStart(2, "0")}`;
    const matchedEnd = m.index + m[1].length + 1 + m[2].length + 1 + m[3].length;
    // Approximate: compare canonical date with what was matched.
    const matchedDatePortion = stem.slice(0, matchedEnd);
    if (matchedDatePortion !== canonicalDate) {
      if (yRaw.length > 2) notes.push("4桁年を2桁に");
      else notes.push("日付フォーマットを yy.mm.dd に統一");
    }
    stem = canonicalDate + m[4];
  } else {
    const m2 = /^(\d{8}|\d{6})(.*)$/.exec(stem);
    if (m2) {
      const digits = m2[1];
      let yy: string, mI: number, dI: number;
      if (digits.length === 8) {
        yy = digits.slice(2, 4);
        mI = parseInt(digits.slice(4, 6), 10);
        dI = parseInt(digits.slice(6, 8), 10);
      } else {
        yy = digits.slice(0, 2);
        mI = parseInt(digits.slice(2, 4), 10);
        dI = parseInt(digits.slice(4, 6), 10);
      }
      if (!(mI >= 1 && mI <= 12 && dI >= 1 && dI <= 31)) {
        return { name: stem + ".igc", notes };
      }
      stem = `${yy}.${String(mI).padStart(2, "0")}.${String(dI).padStart(2, "0")}` + m2[2];
      notes.push("日付に区切りを挿入");
    }
  }

  // Field separator normalization (after canonical date)
  const m3 = /^(\d{2}[._]\d{2}[._]\d{2})(.*)$/.exec(stem);
  if (m3) {
    const datePart = m3[1];
    let body = m3[2];
    const bodyOrig = body;
    body = body.trim();
    body = body.replace(/[\s\-]+/g, "_");
    body = body.replace(/(?<!\d)\.(?!\d)/g, "_");
    body = body.replace(/_+/g, "_");
    body = body.replace(/^_+|_+$/g, "");
    if (body && !body.startsWith("_")) body = "_" + body;
    if (body !== bodyOrig) notes.push("フィールド区切りを「_」に統一");
    stem = datePart + body;
  }

  return { name: stem + ".igc", notes };
}

export interface ParseOrNormalizeResult {
  parsed: ParsedFilename | null;
  finalName: string;
  notes: string[];
}

export function parseOrNormalize(filename: string): ParseOrNormalizeResult {
  const { name, notes } = normalizeFilename(filename);
  const parsed = parseFilename(name);
  return { parsed, finalName: name, notes };
}
