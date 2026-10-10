import { describe, expect, it } from 'vitest';
import { parseQuickAdd, quickAddHighlights } from '@/core/quick-add';

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

describe('quickAddHighlights', () => {
  const SAT = '2026-10-10';

  it('marca fecha, prioridad y etiquetas sobre el texto original', () => {
    expect(quickAddHighlights('Pagar luz mañana !alta #casa', SAT)).toEqual([
      { start: 10, end: 16 }, { start: 17, end: 22 }, { start: 23, end: 28 },
    ]);
    expect(quickAddHighlights('Llamar al contador el lunes !media #llamadas', SAT)).toEqual([
      { start: 19, end: 27 }, { start: 28, end: 34 }, { start: 35, end: 44 },
    ]);
  });

  it('sin nada detectable (o con una fecha imposible) no marca nada', () => {
    expect(quickAddHighlights('Comprar pan', SAT)).toEqual([]);
    expect(quickAddHighlights('Turno 31/02', SAT)).toEqual([]);
    expect(quickAddHighlights('', SAT)).toEqual([]);
  });

  it('sacar lo marcado deja exactamente el título que arma parseQuickAdd', () => {
    const strip = (text: string) => {
      let out = '';
      let pos = 0;
      for (const r of quickAddHighlights(text, SAT)) {
        out += `${text.slice(pos, r.start)} `;
        pos = r.end;
      }
      return `${out}${text.slice(pos)}`.replace(/\s+/g, ' ').replace(/\s+([,.;:!?)])/g, '$1').trim();
    };
    for (const text of [
      'Pagar luz mañana !alta #casa', 'Comprar pan, #super. hoy', 'Reunión el lunes !media',
      'Asado el sábado #finde !baja', 'Llamar pasado mañana', 'Turno 31/02',
    ]) {
      expect(strip(text)).toBe(parseQuickAdd(text, SAT).title);
    }
  });
});
