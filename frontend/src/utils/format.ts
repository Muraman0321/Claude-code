export function fmtDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export function fmtNum(value: number | null | undefined, digits = 1, unit = ""): string {
  if (value == null) return "—";
  return `${value.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(11, 19);
}
