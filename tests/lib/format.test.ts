import { describe, expect, it } from 'vitest';
import { formatDueLabel, groupTasksByDate } from '@/lib/format';

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
