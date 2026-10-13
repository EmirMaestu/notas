/**
 * Recordatorios: opciones, etiquetas, validación y cálculo del instante en que suenan, en la zona horaria del
 * usuario. Módulo puro (sin base): lo usan el núcleo, el programador de notificaciones y la interfaz.
 */
import { addDays } from './dates';
import { ValidationError } from './errors';

/** Minutos antes de la fecha y hora de la tarea (para tareas con hora). */
export const BEFORE_OPTIONS = ['at_time', '5m', '15m', '30m', '1h', '1d'] as const;
/** A la «hora de los recordatorios sin hora» del usuario: el mismo día o el anterior. */
export const ALL_DAY_OPTIONS = ['same_day', 'day_before'] as const;
export const REMINDER_OPTIONS = [...BEFORE_OPTIONS, ...ALL_DAY_OPTIONS] as const;

export type BeforeOption = (typeof BEFORE_OPTIONS)[number];
export type ReminderOption = (typeof REMINDER_OPTIONS)[number];
export type ReminderKind = 'before' | 'same_day' | 'day_before';

export const BEFORE_MINUTES: Record<BeforeOption, number> = {
  at_time: 0, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '1d': 1440,
};

/** Hora por defecto de los recordatorios de tareas sin hora. */
export const DEFAULT_ALL_DAY_TIME = '09:00';

/** Cómo se guarda en `task_reminders`. */
export interface StoredReminder {
  kind: ReminderKind;
  offsetMinutes: number | null;
}

export function isBeforeOption(option: string): option is BeforeOption {
  return (BEFORE_OPTIONS as readonly string[]).includes(option);
}

export function toStored(option: ReminderOption): StoredReminder {
  if (isBeforeOption(option)) return { kind: 'before', offsetMinutes: BEFORE_MINUTES[option] };
  return { kind: option, offsetMinutes: null };
}

/** null si la fila no corresponde a ninguna opción conocida (no debería pasar: hay un CHECK en la base). */
export function fromStored(stored: StoredReminder): ReminderOption | null {
  if (stored.kind === 'before') return optionForMinutes(stored.offsetMinutes);
  return stored.kind === 'same_day' || stored.kind === 'day_before' ? stored.kind : null;
}

/** La opción «antes» con esos minutos (para el recordatorio por defecto), o null. */
export function optionForMinutes(minutes: number | null): BeforeOption | null {
  if (minutes === null) return null;
  return BEFORE_OPTIONS.find((o) => BEFORE_MINUTES[o] === minutes) ?? null;
}

const INVALID = `Recordatorio inválido: usá ${REMINDER_OPTIONS.join(', ')} o null para quitarlo`;

/** Valida un valor que viene de afuera (web o MCP). null = sin recordatorio. */
export function parseReminderOption(value: unknown): ReminderOption | null {
  if (value === null) return null;
  if (typeof value === 'string' && (REMINDER_OPTIONS as readonly string[]).includes(value)) {
    return value as ReminderOption;
  }
  throw new ValidationError(INVALID);
}

/** El recordatorio tiene sentido para la fecha/hora que va a quedar en la tarea. */
export function checkReminderFits(option: ReminderOption | null, dueDate: string | null, dueTime: string | null): void {
  if (option === null) return;
  if (dueDate === null) throw new ValidationError('Para poner un recordatorio la tarea necesita fecha');
  if (isBeforeOption(option) && dueTime === null) {
    throw new ValidationError(
      'Ese recordatorio necesita que la tarea tenga hora; para tareas sin hora usá same_day (el mismo día) o day_before (el día anterior)',
    );
  }
}

const LABELS: Record<BeforeOption, string> = {
  at_time: 'A la hora',
  '5m': '5 minutos antes',
  '15m': '15 minutos antes',
  '30m': '30 minutos antes',
  '1h': '1 hora antes',
  '1d': '1 día antes',
};

export function reminderLabel(option: ReminderOption, allDayTime: string): string {
  if (isBeforeOption(option)) return LABELS[option];
  return option === 'same_day' ? `El mismo día a las ${allDayTime}` : `El día anterior a las ${allDayTime}`;
}

/** Las opciones que ofrece la interfaz según la tarea tenga hora o no. */
export function reminderOptionsFor(hasTime: boolean): readonly ReminderOption[] {
  return hasTime ? BEFORE_OPTIONS : ALL_DAY_OPTIONS;
}

/** Minutos que la zona horaria está adelantada respecto de UTC en ese instante (Buenos Aires: −180). */
function offsetMinutesAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/**
 * Instante (UTC) de una fecha y hora locales en `timeZone`. Dos pasadas: la segunda corrige cuando el offset
 * del primer intento cae del otro lado de un cambio de horario. Una hora que no existe (el salto de primavera)
 * queda corrida al otro lado del salto.
 */
export function zonedTimeToUtc(isoDate: string, time: string, timeZone: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const first = naive - offsetMinutesAt(new Date(naive), timeZone) * 60_000;
  return new Date(naive - offsetMinutesAt(new Date(first), timeZone) * 60_000);
}

/**
 * Cuándo suena el recordatorio, o null si la tarea no tiene fecha.
 * - Opciones «antes» con hora: fecha+hora − minutos. Sin hora (se la sacaron después): el mismo día a `allDayTime`.
 * - `same_day` / `day_before`: ese día (o el anterior) a `allDayTime`, tenga o no hora la tarea.
 */
export function reminderFireAt(
  task: { dueDate: string | null; dueTime: string | null },
  option: ReminderOption,
  timeZone: string,
  allDayTime: string = DEFAULT_ALL_DAY_TIME,
): Date | null {
  if (!task.dueDate) return null;
  if (isBeforeOption(option)) {
    if (!task.dueTime) return zonedTimeToUtc(task.dueDate, allDayTime, timeZone);
    return new Date(zonedTimeToUtc(task.dueDate, task.dueTime, timeZone).getTime() - BEFORE_MINUTES[option] * 60_000);
  }
  const day = option === 'day_before' ? addDays(task.dueDate, -1) : task.dueDate;
  return zonedTimeToUtc(day, allDayTime, timeZone);
}
