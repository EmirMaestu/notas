import { describe, expect, it } from 'vitest';
import { avatarTone, initials } from '@/lib/initials';

describe('initials', () => {
  it('dos palabras del nombre → sus iniciales', () => {
    expect(initials({ name: 'Emir Maestu', email: 'x@example.com' })).toBe('EM');
    expect(initials({ name: '  ana  maría  lópez ', email: 'x@example.com' })).toBe('AM');
  });

  it('una palabra → su primera letra (como el diseño: «E»)', () => {
    expect(initials({ name: 'Ángel', email: 'x@example.com' })).toBe('Á');
  });

  it('sin nombre → la primera letra del email', () => {
    expect(initials({ name: '', email: 'juan@example.com' })).toBe('J');
    expect(initials({ name: '   ', email: 'z@example.com' })).toBe('Z');
  });

  it('avatarTone: estable, entre 1 y 6 y repartido', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const tones = ids.map(avatarTone);
    expect(tones.every((t) => Number.isInteger(t) && t >= 1 && t <= 6)).toBe(true);
    expect(ids.map(avatarTone)).toEqual(tones);
    expect(new Set(tones).size).toBeGreaterThanOrEqual(4);
  });

  it('no parte emojis ni caracteres compuestos por dos unidades', () => {
    expect(initials({ name: '😀 Feliz', email: 'x@example.com' })).toBe('😀F');
  });
});
