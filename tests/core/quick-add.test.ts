import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '@/core/quick-add';

const TODAY = '2026-10-08'; // jueves

describe('parseQuickAdd', () => {
  it('texto simple queda como título', () => {
    expect(parseQuickAdd('Comprar pan', TODAY)).toEqual({ title: 'Comprar pan', dueDate: null, priority: 0, tags: [] });
  });

  it('extrae etiquetas, prioridad y fecha', () => {
    expect(parseQuickAdd('Comprar pan mañana !alta #casa #super', TODAY)).toEqual({
      title: 'Comprar pan',
      dueDate: '2026-10-09',
      priority: 5,
      tags: ['casa', 'super'],
    });
  });

  it('hoy / pasado mañana', () => {
    expect(parseQuickAdd('Llamar hoy', TODAY).dueDate).toBe('2026-10-08');
    expect(parseQuickAdd('Llamar pasado mañana', TODAY)).toMatchObject({ title: 'Llamar', dueDate: '2026-10-10' });
  });

  it('días de la semana: próxima ocurrencia', () => {
    expect(parseQuickAdd('Reunión el lunes', TODAY)).toMatchObject({ title: 'Reunión', dueDate: '2026-10-12' });
    expect(parseQuickAdd('Reunión viernes', TODAY).dueDate).toBe('2026-10-09');
    expect(parseQuickAdd('Reunión jueves', TODAY).dueDate).toBe('2026-10-15');
    expect(parseQuickAdd('Asado el sábado', TODAY).dueDate).toBe('2026-10-10');
    expect(parseQuickAdd('Asado el sabado', TODAY).dueDate).toBe('2026-10-10');
  });

  it('fechas dd/mm', () => {
    expect(parseQuickAdd('Pagar luz 15/10', TODAY)).toMatchObject({ title: 'Pagar luz', dueDate: '2026-10-15' });
    expect(parseQuickAdd('Pagar 1/1', TODAY).dueDate).toBe('2027-01-01');
    expect(parseQuickAdd('Pagar 3/2/2028', TODAY).dueDate).toBe('2028-02-03');
    expect(parseQuickAdd('Pagar 31/2', TODAY)).toMatchObject({ title: 'Pagar 31/2', dueDate: null });
  });

  it('prioridades media y baja, en mayúsculas también', () => {
    expect(parseQuickAdd('Algo !Media', TODAY)).toMatchObject({ title: 'Algo', priority: 3 });
    expect(parseQuickAdd('Algo !baja', TODAY).priority).toBe(1);
  });

  it('no confunde palabras que contienen la fecha', () => {
    expect(parseQuickAdd('Mañanas de yoga', TODAY)).toMatchObject({ title: 'Mañanas de yoga', dueDate: null });
  });

  it('etiquetas en minúscula y sin duplicar', () => {
    expect(parseQuickAdd('X #Casa #casa', TODAY).tags).toEqual(['casa']);
  });

  it('quita la fecha por posicion, no la primera ocurrencia textual', () => {
    expect(parseQuickAdd('Tapar el hoyo hoy', TODAY)).toMatchObject({ title: 'Tapar el hoyo', dueDate: '2026-10-08' });
    expect(parseQuickAdd('Pagar 115/10 15/10', TODAY)).toMatchObject({ title: 'Pagar 115/10', dueDate: '2026-10-15' });
  });

  it('dd/mm sin año busca el proximo año valido', () => {
    expect(parseQuickAdd('Algo 29/2', '2028-03-01').dueDate).toBe('2032-02-29');
    expect(parseQuickAdd('Algo 29/2', '2027-03-01').dueDate).toBe('2028-02-29');
  });

  it('pasado mañana acepta cualquier espacio', () => {
    expect(parseQuickAdd('Llamar pasado  mañana', TODAY)).toMatchObject({ title: 'Llamar', dueDate: '2026-10-10' });
  });

  it('etiqueta seguida de puntuacion', () => {
    expect(parseQuickAdd('Leer #libro, ya', TODAY)).toMatchObject({ title: 'Leer, ya', tags: ['libro'] });
  });

  it('quita todos los tokens de prioridad; el primero manda', () => {
    expect(parseQuickAdd('Algo !alta !baja', TODAY)).toMatchObject({ title: 'Algo', priority: 5 });
  });
});