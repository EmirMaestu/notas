import { describe, expect, it } from 'vitest';
import { makeLink, toggleMark, toggledTaskMarker, type MarkEdit } from '@/lib/markdown-format';

function apply(doc: string, edit: MarkEdit): string {
  let out = doc;
  for (const c of [...edit.changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return out;
}

describe('toggleMark', () => {
  it('sin selección inserta la marca doble con el cursor en el medio', () => {
    const edit = toggleMark('hola ', 5, 5, '**');
    expect(apply('hola ', edit)).toBe('hola ****');
    expect([edit.anchor, edit.head]).toEqual([7, 7]);
  });

  it('envuelve la selección y la mantiene seleccionada', () => {
    const doc = 'un texto largo';
    const edit = toggleMark(doc, 3, 8, '**');
    const out = apply(doc, edit);
    expect(out).toBe('un **texto** largo');
    expect(out.slice(edit.anchor, edit.head)).toBe('texto');
  });

  it('saca la marca si está justo afuera de la selección', () => {
    const doc = 'un **texto** largo';
    const edit = toggleMark(doc, 5, 10, '**');
    const out = apply(doc, edit);
    expect(out).toBe('un texto largo');
    expect(out.slice(edit.anchor, edit.head)).toBe('texto');
  });

  it('saca la marca si la selección la incluye', () => {
    const doc = 'un **texto** largo';
    expect(apply(doc, toggleMark(doc, 3, 12, '**'))).toBe('un texto largo');
  });

  it('cursiva sobre una negrita no la confunde con cursiva', () => {
    const doc = '**hola**';
    expect(apply(doc, toggleMark(doc, 2, 6, '*'))).toBe('***hola***');
  });
});

describe('makeLink', () => {
  it('envuelve el texto y selecciona la url', () => {
    const doc = 'ver docs';
    const edit = makeLink(doc, 4, 8);
    const out = apply(doc, edit);
    expect(out).toBe('ver [docs](url)');
    expect(out.slice(edit.anchor, edit.head)).toBe('url');
  });

  it('sin selección deja el cursor dentro de los corchetes', () => {
    const edit = makeLink('', 0, 0);
    expect(apply('', edit)).toBe('[]()');
    expect(edit.anchor).toBe(1);
  });
});

describe('toggledTaskMarker', () => {
  it('alterna entre pendiente y hecha', () => {
    expect(toggledTaskMarker('[ ]')).toBe('[x]');
    expect(toggledTaskMarker('[x]')).toBe('[ ]');
    expect(toggledTaskMarker('[X]')).toBe('[ ]');
  });
});

describe('toggleMark con marcas combinadas', () => {
  it('saca solo la cursiva de un texto en negrita y cursiva', () => {
    const doc = '***hola***';
    expect(apply(doc, toggleMark(doc, 3, 7, '*'))).toBe('**hola**');
  });

  it('saca solo la negrita de un texto en negrita y cursiva', () => {
    const doc = '***hola***';
    expect(apply(doc, toggleMark(doc, 3, 7, '**'))).toBe('*hola*');
  });
});
