/** Zona horaria por defecto de los usuarios nuevos. */
export const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria indicada. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function parseIso(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

export function addDays(isoDate: string, days: number): string {
  const d = parseIso(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = domingo, 6 = sábado. */
export function dayOfWeek(isoDate: string): number {
  return parseIso(isoDate).getUTCDay();
}

/** Años anteriores a 1900 son casi siempre un error de tipeo (p. ej. un input de fecha a medio escribir). */
const MIN_YEAR = 1900;

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < MIN_YEAR) return false;
  const d = parseIso(value);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

// ICU lista algunos alias viejos en vez del nombre IANA actual; agregamos esos a mano.
const TIMEZONES_BY_LOWER = new Map(
  [...Intl.supportedValuesOf('timeZone'), 'UTC', 'America/Argentina/Buenos_Aires'].map((tz) => [tz.toLowerCase(), tz]),
);

/** Nombre de la zona horaria con las mayúsculas correctas (p. ej. 'europe/madrid' → 'Europe/Madrid'), o null si es inválida. */
export function canonicalTimezone(timezone: string): string | null {
  if (!isValidTimezone(timezone)) return null;
  return TIMEZONES_BY_LOWER.get(timezone.toLowerCase()) ?? timezone;
}
