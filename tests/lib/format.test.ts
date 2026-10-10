import { describe, expect, it } from 'vitest';
import { formatAgo, formatChipDate, formatDetailDate, formatDueLabel, formatLongDate, formatShortDate, formatWeekRange, groupTasksByCompletedDay, groupTasksByDate, localDate, localTime, pendingLabel, trashNote } from '@/lib/format';

const TODAY = '2026-10-08'; // jueves

describe('formatDueLabel', () => {
  it('etiquetas relativas y absolutas', () => {
    expect(formatDueLabel('2026-10-08', TODAY)).toBe('Hoy');
    expect(formatDueLabel('2026-10-09', TODAY)).toBe('Mañana');
    expect(formatDueLabel('2026-10-07', TODAY)).toBe('Ayer');
    expect(formatDueLabel('2026-10-12', TODAY)).toBe('Lun');
    expect(formatDueLabel('2026-10-14', TODAY)).toBe('Mié');
    expect(formatDueLabel('2026-10-20', TODAY)).toBe('20/10');
    expect(formatDueLabel('2026-10-01', TODAY)).toBe('01/10');
    expect(formatDueLabel('2027-01-05', TODAY)).toBe('05/01/2027');
  });
});

describe('groupTasksByDate', () => {
  it('agrupa vencidas, por día y sin fecha', () => {
    const tasks = ['2026-10-01', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-12', null].map((dueDate, i) => ({ id: String(i), dueDate }));
    const groups = groupTasksByDate(tasks, TODAY);
    expect(groups.map((g) => [g.label, g.tasks.length])).toEqual([
      ['Vencidas', 1], ['Hoy', 1], ['Mañana', 1], ['Lunes 12/10', 2], ['Sin fecha', 1],
    ]);
  });

  it('incluye el año en la etiqueta cuando difiere del actual', () => {
    const tasks = [{ id: '1', dueDate: '2027-01-05' }, { id: '2', dueDate: '2027-01-05' }];
    expect(groupTasksByDate(tasks, TODAY).map((g) => [g.label, g.tasks.length])).toEqual([['Martes 05/01/2027', 2]]);
  });
});

const SAT = '2026-10-10'; // sábado
const BA = 'America/Argentina/Buenos_Aires'; // UTC-3

describe('formatChipDate (agregado rápido)', () => {
  it('Hoy, Mañana o día corto con dd/mm', () => {
    expect(formatChipDate('2026-10-10', SAT)).toBe('Hoy');
    expect(formatChipDate('2026-10-11', SAT)).toBe('Mañana');
    expect(formatChipDate('2026-10-12', SAT)).toBe('Lun 12/10');
    expect(formatChipDate('2026-10-09', SAT)).toBe('Vie 09/10');
    expect(formatChipDate('2027-01-05', SAT)).toBe('Mar 05/01/2027');
  });
});

describe('formatDetailDate (píldora del detalle)', () => {
  it('palabra relativa o día corto, día y mes abreviado', () => {
    expect(formatDetailDate('2026-10-10', SAT)).toBe('Hoy, 10 oct');
    expect(formatDetailDate('2026-10-11', SAT)).toBe('Mañana, 11 oct');
    expect(formatDetailDate('2026-10-09', SAT)).toBe('Ayer, 9 oct');
    expect(formatDetailDate('2026-10-15', SAT)).toBe('Jue, 15 oct');
    expect(formatDetailDate('2027-01-05', SAT)).toBe('Mar, 5 ene 2027');
  });
});

describe('subtítulos de vista', () => {
  it('fecha larga', () => {
    expect(formatLongDate('2026-10-10')).toBe('Sábado 10 de octubre');
    expect(formatLongDate('2026-01-01')).toBe('Jueves 1 de enero');
  });

  it('rango de 7 días (hoy … hoy+6)', () => {
    expect(formatWeekRange('2026-10-10')).toBe('Sáb 10 → Vie 16 de octubre');
    expect(formatWeekRange('2026-10-28')).toBe('Mié 28 de octubre → Mar 3 de noviembre');
  });

  it('pendientes en singular y plural', () => {
    expect(pendingLabel(0)).toBe('0 pendientes');
    expect(pendingLabel(1)).toBe('1 pendiente');
    expect(pendingLabel(5)).toBe('5 pendientes');
  });
});

describe('fecha y hora en la zona del usuario', () => {
  it('localDate / localTime / formatShortDate', () => {
    expect(localDate(new Date('2026-10-10T12:12:00Z'), BA)).toBe('2026-10-10');
    expect(localTime(new Date('2026-10-10T12:12:00Z'), BA)).toBe('09:12');
    expect(localDate(new Date('2026-10-10T02:00:00Z'), BA)).toBe('2026-10-09');
    expect(localTime(new Date('2026-10-10T02:00:00Z'), BA)).toBe('23:00');
    expect(formatShortDate(new Date('2026-10-02T15:00:00Z'), BA)).toBe('02/10');
  });
});

describe('formatAgo', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const ago = (ms: number) => formatAgo(new Date(now.getTime() - ms), now, BA);
  it('momento, minutos, horas, días y después la fecha', () => {
    expect(ago(30_000)).toBe('hace un momento');
    expect(ago(-5_000)).toBe('hace un momento');
    expect(ago(5 * 60_000)).toBe('hace 5 min');
    expect(ago(2 * 3_600_000)).toBe('hace 2 h');
    expect(ago(26 * 3_600_000)).toBe('hace 1 día');
    expect(ago(3 * 86_400_000)).toBe('hace 3 días');
    expect(ago(40 * 86_400_000)).toBe('el 31/08');
  });
});

describe('trashNote', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const note = (ms: number) => trashNote(new Date(now.getTime() - ms), now);
  it('días desde el borrado y días que faltan para la purga', () => {
    expect(note(2 * 3_600_000)).toBe('Borrada hoy · se elimina en 30');
    expect(note(86_400_000)).toBe('Borrada hace 1 día · se elimina en 29');
    expect(note(3 * 86_400_000)).toBe('Borrada hace 3 días · se elimina en 27');
    expect(note(31 * 86_400_000)).toBe('Borrada hace 31 días · se elimina hoy');
  });
});

describe('groupTasksByCompletedDay', () => {
  it('agrupa por día de completado en la zona del usuario, en el orden recibido', () => {
    const tasks = [
      { id: 'a', completedAt: new Date('2026-10-10T12:12:00Z') },
      { id: 'b', completedAt: new Date('2026-10-10T11:30:00Z') },
      { id: 'c', completedAt: new Date('2026-10-10T02:00:00Z') }, // 09/10 23:00 en Buenos Aires
      { id: 'd', completedAt: new Date('2026-10-08T15:40:00Z') },
    ];
    expect(groupTasksByCompletedDay(tasks, SAT, BA).map((g) => [g.label, g.tasks.map((t) => t.id)])).toEqual([
      ['Hoy', ['a', 'b']], ['Ayer', ['c']], ['Jueves 08/10', ['d']],
    ]);
  });
});
