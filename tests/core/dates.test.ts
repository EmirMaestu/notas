import { describe, expect, it } from 'vitest';
import { addDays, canonicalTimezone, dayOfWeek, isValidIsoDate, isValidTime, isValidTimezone, todayIn } from '@/core/dates';

describe('todayIn', () => {
  it('devuelve la fecha local de la zona horaria', () => {
    // 02:00 UTC del 9/10 = 23:00 del 8/10 en Buenos Aires
    expect(todayIn('America/Argentina/Buenos_Aires', new Date('2026-10-09T02:00:00Z'))).toBe('2026-10-08');
    expect(todayIn('UTC', new Date('2026-10-09T02:00:00Z'))).toBe('2026-10-09');
  });
});

describe('addDays', () => {
  it('suma días cruzando meses y años', () => {
    expect(addDays('2026-10-08', 1)).toBe('2026-10-09');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-10-08', -8)).toBe('2026-09-30');
  });
});

describe('dayOfWeek', () => {
  it('0 = domingo ... 4 = jueves', () => {
    expect(dayOfWeek('2026-10-08')).toBe(4);
    expect(dayOfWeek('2026-10-11')).toBe(0);
  });
});

describe('validaciones', () => {
  it('isValidIsoDate', () => {
    expect(isValidIsoDate('2026-10-08')).toBe(true);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('08/10/2026')).toBe(false);
    expect(isValidIsoDate('0000-01-01')).toBe(false);
    expect(isValidIsoDate('0002-05-06')).toBe(false);
    expect(isValidIsoDate('1899-12-31')).toBe(false);
    expect(isValidIsoDate('1900-01-01')).toBe(true);
    expect(isValidIsoDate('9999-12-31')).toBe(true);
  });
  it('isValidTime', () => {
    expect(isValidTime('09:30')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('9:30')).toBe(false);
  });
  it('isValidTimezone', () => {
    expect(isValidTimezone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(isValidTimezone('Marte/Olympus')).toBe(false);
  });
});

describe('canonicalTimezone', () => {
  it('devuelve la forma canónica o null si es inválida', () => {
    expect(canonicalTimezone('europe/madrid')).toBe('Europe/Madrid');
    expect(canonicalTimezone('America/Argentina/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires');
    expect(canonicalTimezone('america/argentina/buenos_aires')).toBe('America/Argentina/Buenos_Aires');
    expect(canonicalTimezone('utc')).toBe('UTC');
    expect(canonicalTimezone('Marte/Olympus')).toBeNull();
  });
});
