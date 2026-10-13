import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/core/errors';
import {
  ALL_DAY_OPTIONS, BEFORE_OPTIONS, REMINDER_OPTIONS, checkReminderFits, fromStored, optionForMinutes,
  parseReminderOption, reminderFireAt, reminderLabel, reminderOptionsFor, toStored, zonedTimeToUtc,
} from '@/core/reminder-options';

const BA = 'America/Argentina/Buenos_Aires';
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe('zonedTimeToUtc', () => {
  it('Buenos Aires es UTC−3 todo el año (sin horario de verano)', () => {
    expect(iso(zonedTimeToUtc('2026-10-20', '09:30', BA))).toBe('2026-10-20T12:30:00.000Z');
    expect(iso(zonedTimeToUtc('2026-01-15', '23:45', BA))).toBe('2026-01-16T02:45:00.000Z');
  });

  it('respeta el horario de verano de Madrid (CET/CEST)', () => {
    expect(iso(zonedTimeToUtc('2026-01-15', '10:00', 'Europe/Madrid'))).toBe('2026-01-15T09:00:00.000Z');
    expect(iso(zonedTimeToUtc('2026-07-01', '10:00', 'Europe/Madrid'))).toBe('2026-07-01T08:00:00.000Z');
    // 29/03/2026: a las 02:00 se pasa a las 03:00.
    expect(iso(zonedTimeToUtc('2026-03-29', '03:30', 'Europe/Madrid'))).toBe('2026-03-29T01:30:00.000Z');
  });

  it('respeta el fin del horario de verano de Nueva York', () => {
    expect(iso(zonedTimeToUtc('2026-10-31', '12:00', 'America/New_York'))).toBe('2026-10-31T16:00:00.000Z');
    expect(iso(zonedTimeToUtc('2026-11-01', '12:00', 'America/New_York'))).toBe('2026-11-01T17:00:00.000Z');
  });

  it('UTC no se corre', () => {
    expect(iso(zonedTimeToUtc('2026-05-05', '00:00', 'UTC'))).toBe('2026-05-05T00:00:00.000Z');
  });
});

describe('reminderFireAt', () => {
  const timed = { dueDate: '2026-10-20', dueTime: '15:00' };
  const allDay = { dueDate: '2026-10-20', dueTime: null };

  it('tareas con hora: minutos antes de la fecha y hora', () => {
    expect(iso(reminderFireAt(timed, 'at_time', BA))).toBe('2026-10-20T18:00:00.000Z');
    expect(iso(reminderFireAt(timed, '5m', BA))).toBe('2026-10-20T17:55:00.000Z');
    expect(iso(reminderFireAt(timed, '15m', BA))).toBe('2026-10-20T17:45:00.000Z');
    expect(iso(reminderFireAt(timed, '30m', BA))).toBe('2026-10-20T17:30:00.000Z');
    expect(iso(reminderFireAt(timed, '1h', BA))).toBe('2026-10-20T17:00:00.000Z');
    expect(iso(reminderFireAt(timed, '1d', BA))).toBe('2026-10-19T18:00:00.000Z');
  });

  it('tareas sin hora: el mismo día o el anterior a la hora elegida (09:00 por defecto)', () => {
    expect(iso(reminderFireAt(allDay, 'same_day', BA))).toBe('2026-10-20T12:00:00.000Z');
    expect(iso(reminderFireAt(allDay, 'day_before', BA))).toBe('2026-10-19T12:00:00.000Z');
    expect(iso(reminderFireAt(allDay, 'same_day', BA, '07:30'))).toBe('2026-10-20T10:30:00.000Z');
    // El día anterior cruza el cambio de hora de Madrid: cada día con su propio offset.
    const madrid = { dueDate: '2026-03-29', dueTime: null };
    expect(iso(reminderFireAt(madrid, 'same_day', 'Europe/Madrid', '10:00'))).toBe('2026-03-29T08:00:00.000Z');
    expect(iso(reminderFireAt(madrid, 'day_before', 'Europe/Madrid', '10:00'))).toBe('2026-03-28T09:00:00.000Z');
    // El día anterior al 1 de enero es el 31 de diciembre.
    expect(iso(reminderFireAt({ dueDate: '2027-01-01', dueTime: null }, 'day_before', BA))).toBe('2026-12-31T12:00:00.000Z');
  });

  it('una opción «antes» en una tarea a la que le sacaron la hora suena el mismo día a la hora fija', () => {
    expect(iso(reminderFireAt(allDay, '15m', BA, '08:00'))).toBe('2026-10-20T11:00:00.000Z');
  });

  it('same_day / day_before en una tarea con hora usan la hora fija, no la de la tarea', () => {
    expect(iso(reminderFireAt(timed, 'same_day', BA))).toBe('2026-10-20T12:00:00.000Z');
  });

  it('sin fecha no suena', () => {
    expect(reminderFireAt({ dueDate: null, dueTime: null }, 'same_day', BA)).toBeNull();
  });
});

describe('opciones', () => {
  it('ida y vuelta con lo guardado en la base', () => {
    for (const option of REMINDER_OPTIONS) expect(fromStored(toStored(option))).toBe(option);
    expect(toStored('1h')).toEqual({ kind: 'before', offsetMinutes: 60 });
    expect(toStored('day_before')).toEqual({ kind: 'day_before', offsetMinutes: null });
    expect(fromStored({ kind: 'before', offsetMinutes: 7 })).toBeNull();
  });

  it('optionForMinutes traduce el recordatorio por defecto', () => {
    expect(optionForMinutes(0)).toBe('at_time');
    expect(optionForMinutes(15)).toBe('15m');
    expect(optionForMinutes(60)).toBe('1h');
    expect(optionForMinutes(null)).toBeNull();
    expect(optionForMinutes(7)).toBeNull();
  });

  it('parseReminderOption acepta las 8 opciones y null; el resto es ValidationError', () => {
    expect(parseReminderOption('15m')).toBe('15m');
    expect(parseReminderOption(null)).toBeNull();
    expect(() => parseReminderOption('2h')).toThrow(ValidationError);
    expect(() => parseReminderOption(15)).toThrow(/Recordatorio inválido/);
  });

  it('checkReminderFits pide fecha, y hora para las opciones «antes»', () => {
    expect(() => checkReminderFits('same_day', null, null)).toThrow('Para poner un recordatorio la tarea necesita fecha');
    expect(() => checkReminderFits('15m', '2026-10-20', null)).toThrow(/necesita que la tarea tenga hora/);
    expect(() => checkReminderFits('15m', '2026-10-20', '10:00')).not.toThrow();
    expect(() => checkReminderFits('day_before', '2026-10-20', '10:00')).not.toThrow();
    expect(() => checkReminderFits(null, null, null)).not.toThrow();
  });

  it('etiquetas en castellano y opciones según la tarea tenga hora', () => {
    expect(reminderLabel('at_time', '09:00')).toBe('A la hora');
    expect(reminderLabel('1h', '09:00')).toBe('1 hora antes');
    expect(reminderLabel('1d', '09:00')).toBe('1 día antes');
    expect(reminderLabel('same_day', '08:30')).toBe('El mismo día a las 08:30');
    expect(reminderLabel('day_before', '09:00')).toBe('El día anterior a las 09:00');
    expect(reminderOptionsFor(true)).toEqual(BEFORE_OPTIONS);
    expect(reminderOptionsFor(false)).toEqual(ALL_DAY_OPTIONS);
  });
});
