export interface IgcFix {
  timestampMs: number;       // unix epoch ms (UTC)
  timestampIso: string;      // ISO 8601 with Z
  latitude: number;
  longitude: number;
  pressureAltitude: number;
  gpsAltitude: number;
  valid: boolean;
}

export interface IgcFile {
  flightDate: string | null; // YYYY-MM-DD
  pilot: string | null;
  aircraftType: string | null;
  aircraftId: string | null;
  competitionId: string | null;
  fixes: IgcFix[];
}

function parseLat(raw: string): number {
  const deg = parseInt(raw.slice(0, 2), 10);
  const minutes = parseInt(raw.slice(2, 7), 10) / 1000.0;
  const value = deg + minutes / 60.0;
  const hemi = raw[7];
  return hemi === "S" || hemi === "s" ? -value : value;
}

function parseLon(raw: string): number {
  const deg = parseInt(raw.slice(0, 3), 10);
  const minutes = parseInt(raw.slice(3, 8), 10) / 1000.0;
  const value = deg + minutes / 60.0;
  const hemi = raw[8];
  return hemi === "W" || hemi === "w" ? -value : value;
}

function parseHeaderValue(line: string): string {
  const i = line.indexOf(":");
  if (i >= 0) return line.slice(i + 1).trim();
  return line.slice(5).trim();
}

/** Format Date as ISO 8601 with seconds precision and `+00:00` suffix, matching Python's datetime.isoformat(). */
function toIsoUtcSeconds(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`
  );
}

export function parseIgcText(text: string): IgcFile {
  const igc: IgcFile = {
    flightDate: null,
    pilot: null,
    aircraftType: null,
    aircraftId: null,
    competitionId: null,
    fixes: [],
  };

  let flightDateMs: number | null = null; // UTC midnight of flight date
  let lastSeconds = -1;
  let dayOffsetS = 0;

  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/[\r\n]+$/, "");
    if (!line) continue;

    const rec = line[0];

    if (rec === "H") {
      const tlc = line.length >= 5 ? line.slice(2, 5).toUpperCase() : "";
      if (tlc === "DTE") {
        const digits = line.replace(/\D/g, "");
        if (digits.length >= 6) {
          const dd = parseInt(digits.slice(0, 2), 10);
          const mm = parseInt(digits.slice(2, 4), 10);
          const yy = parseInt(digits.slice(4, 6), 10);
          const year = yy < 80 ? 2000 + yy : 1900 + yy;
          // Validate
          const candidate = Date.UTC(year, mm - 1, dd);
          const back = new Date(candidate);
          if (
            back.getUTCFullYear() === year &&
            back.getUTCMonth() === mm - 1 &&
            back.getUTCDate() === dd
          ) {
            flightDateMs = candidate;
            igc.flightDate = `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
          }
        }
      } else if (tlc === "PLT") {
        igc.pilot = parseHeaderValue(line);
      } else if (tlc === "GTY") {
        igc.aircraftType = parseHeaderValue(line);
      } else if (tlc === "GID") {
        igc.aircraftId = parseHeaderValue(line);
      } else if (tlc === "CID") {
        igc.competitionId = parseHeaderValue(line);
      }
    } else if (rec === "B" && line.length >= 35) {
      const hh = parseInt(line.slice(1, 3), 10);
      const mm = parseInt(line.slice(3, 5), 10);
      const ss = parseInt(line.slice(5, 7), 10);
      if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss)) continue;

      const lat = parseLat(line.slice(7, 15));
      const lon = parseLon(line.slice(15, 24));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const fixValid = line[24] === "A";
      const pressureAlt = parseInt(line.slice(25, 30), 10);
      const gpsAlt = parseInt(line.slice(30, 35), 10);
      if (!Number.isFinite(pressureAlt) || !Number.isFinite(gpsAlt)) continue;

      const seconds = hh * 3600 + mm * 60 + ss;
      if (seconds < lastSeconds - 60) {
        dayOffsetS += 86400;
      }
      lastSeconds = seconds;

      const baseMs = flightDateMs ?? Date.UTC(1970, 0, 1);
      const ms = baseMs + (seconds + dayOffsetS) * 1000;

      igc.fixes.push({
        timestampMs: ms,
        timestampIso: toIsoUtcSeconds(ms),
        latitude: lat,
        longitude: lon,
        pressureAltitude: pressureAlt,
        gpsAltitude: gpsAlt,
        valid: fixValid,
      });
    }
  }

  return igc;
}

/** Read a File as latin-1 text and parse it. */
export async function parseIgcFile(file: File | Blob): Promise<IgcFile> {
  // Latin-1 keeps every byte 1:1, matching the Python parser's `latin-1` decode.
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Build a string by char codes — equivalent to latin-1 decode without a TextDecoder dependency.
  let text = "";
  // Chunk to avoid call-stack issues on very large files.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    text += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return parseIgcText(text);
}
