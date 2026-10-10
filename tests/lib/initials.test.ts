import { describe, expect, it } from 'vitest';
import { initials } from '@/lib/initials';

describe('initials', () => {
  it('dos palabras del nombre → sus iniciales', () => {
    expect(initials({ name: 'Emir Maestu', email: 'x@example.com' })).toBe('EM');
    expect(initials({ name: '  ana  maría  lópez ', email: 'x@example.com' })).toBe('AM');
  });

  it('una palabra → sus dos primeras letras', () => {
    expect(initials({ name: 'Ángel', email: 'x@example.com' })).toBe('ÁN');
  });

  it('sin nombre → las dos primeras letras del email', () => {
    expect(initials({ name: '', email: 'juan@example.com' })).toBe('JU');
    expect(initials({ name: '   ', email: 'z@example.com' })).toBe('Z@');
  });

  it('no parte emojis ni caracteres compuestos por dos unidades', () => {
    expect(initials({ name: '😀 Feliz', email: 'x@example.com' })).toBe('😀F');
  });
});
