import { addDays, dayOfWeek } from '@/core/dates';

const SHORT_DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const LONG_DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const SHORT_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

function dayMonth(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

const dayNumber = (iso: string) => Number(iso.slice(8, 10));
const monthIndex = (iso: string) => Number(iso.slice(5, 7)) - 1;

/** "Hoy", "Mañana", "Ayer" o "Jueves 08/10" (con año si no es el actual). Para encabezados de grupo. */
function relativeDayLabel(day: string, today: string): string {
  const diff = daysBetween(today, day);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  if (diff === -1) return 'Ayer';
  const year = day.slice(0, 4) !== today.slice(0, 4) ? `/${day.slice(0, 4)}` : '';
  return `${LONG_DAYS[dayOfWeek(day)]} ${dayMonth(day)}${year}`;
}

/** "Hoy", "Mañana", "Ayer", día corto si cae en los próximos 6 días, o dd/mm[/aaaa]. Fecha de la fila. */
export function formatDueLabel(dueDate: string, today: string): string {
  const diff = daysBetween(today, dueDate);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  if (diff === -1) return 'Ayer';
  if (diff > 1 && diff < 7) return SHORT_DAYS[dayOfWeek(dueDate)];
  if (dueDate.slice(0, 4) !== today.slice(0, 4)) return `${dayMonth(dueDate)}/${dueDate.slice(0, 4)}`;
  return dayMonth(dueDate);
}

/** Chip del agregado rápido: "Hoy", "Mañana" o "Lun 12/10" (con año si no es el actual). */
export function formatChipDate(dueDate: string, today: string): string {
  const diff = daysBetween(today, dueDate);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  const year = dueDate.slice(0, 4) !== today.slice(0, 4) ? `/${dueDate.slice(0, 4)}` : '';
  return `${SHORT_DAYS[dayOfWeek(dueDate)]} ${dayMonth(dueDate)}${year}`;
}

/** Píldora de fecha del detalle: "Hoy, 10 oct", "Jue, 15 oct", "Mar, 5 ene 2027". */
export function formatDetailDate(dueDate: string, today: string): string {
  const diff = daysBetween(today, dueDate);
  const word = diff === 0 ? 'Hoy' : diff === 1 ? 'Mañana' : diff === -1 ? 'Ayer' : SHORT_DAYS[dayOfWeek(dueDate)];
  const year = dueDate.slice(0, 4) !== today.slice(0, 4) ? ` ${dueDate.slice(0, 4)}` : '';
  return `${word}, ${dayNumber(dueDate)} ${SHORT_MONTHS[monthIndex(dueDate)]}${year}`;
}

/** Subtítulo de Hoy: "Sábado 10 de octubre". */
export function formatLongDate(iso: string): string {
  return `${LONG_DAYS[dayOfWeek(iso)]} ${dayNumber(iso)} de ${MONTHS[monthIndex(iso)]}`;
}

/** Subtítulo de Próximos 7 días (hoy … hoy+6): "Sáb 10 → Vie 16 de octubre". */
export function formatWeekRange(today: string): string {
  const end = addDays(today, 6);
  const short = (iso: string) => `${SHORT_DAYS[dayOfWeek(iso)]} ${dayNumber(iso)}`;
  const month = (iso: string) => MONTHS[monthIndex(iso)];
  return today.slice(5, 7) === end.slice(5, 7)
    ? `${short(today)} → ${short(end)} de ${month(end)}`
    : `${short(today)} de ${month(today)} → ${short(end)} de ${month(end)}`;
}

export function pendingLabel(count: number): string {
  return `${count} ${count === 1 ? 'pendiente' : 'pendientes'}`;
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** Día (YYYY-MM-DD) de un instante en la zona del usuario. */
export function localDate(date: Date, timeZone: string): string {
  return zonedParts(date, timeZone).date;
}

/** Hora (HH:mm, 24 hs) de un instante en la zona del usuario. */
export function localTime(date: Date, timeZone: string): string {
  return zonedParts(date, timeZone).time;
}

/** "02/10" en la zona del usuario. */
export function formatShortDate(date: Date, timeZone: string): string {
  return dayMonth(localDate(date, timeZone));
}

/** "hace un momento", "hace 5 min", "hace 2 h", "hace 3 días" (hasta 29); después "el 31/08". */
export function formatAgo(date: Date, now: Date, timeZone: string): string {
  const ms = Math.max(0, now.getTime() - date.getTime());
  if (ms < MINUTE) return 'hace un momento';
  if (ms < HOUR) return `hace ${Math.floor(ms / MINUTE)} min`;
  if (ms < DAY) return `hace ${Math.floor(ms / HOUR)} h`;
  const days = Math.floor(ms / DAY);
  if (days < 30) return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
  return `el ${formatShortDate(date, timeZone)}`;
}

/** Nota de una fila en la papelera: "Borrada hace 3 días · se elimina en 27" (purga a los 30 días). */
export function trashNote(deletedAt: Date, now: Date, retentionDays = 30): string {
  const days = Math.max(0, Math.floor((now.getTime() - deletedAt.getTime()) / DAY));
  const left = Math.max(retentionDays - days, 0);
  const ago = days === 0 ? 'Borrada hoy' : `Borrada hace ${days} ${days === 1 ? 'día' : 'días'}`;
  return `${ago} · ${left === 0 ? 'se elimina hoy' : `se elimina en ${left}`}`;
}

export interface TaskGroup<T> {
  key: string;
  label: string;
  tasks: T[];
}

/** Agrupa (manteniendo el orden recibido) en Vencidas, un grupo por día y Sin fecha. */
export function groupTasksByDate<T extends { dueDate: string | null }>(tasks: T[], today: string): TaskGroup<T>[] {
  const overdue: T[] = [];
  const byDay = new Map<string, T[]>();
  const undated: T[] = [];
  for (const task of tasks) {
    if (task.dueDate === null) undated.push(task);
    else if (task.dueDate < today) overdue.push(task);
    else {
      const day = byDay.get(task.dueDate);
      if (day) day.push(task);
      else byDay.set(task.dueDate, [task]);
    }
  }
  const groups: TaskGroup<T>[] = [];
  if (overdue.length) groups.push({ key: 'overdue', label: 'Vencidas', tasks: overdue });
  for (const day of [...byDay.keys()].sort()) {
    groups.push({ key: day, label: relativeDayLabel(day, today), tasks: byDay.get(day)! });
  }
  if (undated.length) groups.push({ key: 'undated', label: 'Sin fecha', tasks: undated });
  return groups;
}

/** Completadas agrupadas por el día en que se completaron (zona del usuario), en el orden recibido. */
export function groupTasksByCompletedDay<T extends { completedAt: Date | null }>(
  tasks: T[], today: string, timeZone: string,
): TaskGroup<T>[] {
  const groups: TaskGroup<T>[] = [];
  for (const task of tasks) {
    const key = task.completedAt ? localDate(task.completedAt, timeZone) : 'undated';
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, label: key === 'undated' ? 'Sin fecha' : relativeDayLabel(key, today), tasks: [] };
      groups.push(group);
    }
    group.tasks.push(task);
  }
  return groups;
}
