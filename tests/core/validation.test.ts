import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/core/errors';
import { checkColor } from '@/core/validation';

describe('checkColor', () => {
  it('acepta #rrggbb, normaliza vacío a null y respeta undefined', () => {
    expect(checkColor('#a1B2c3')).toBe('#a1B2c3');
    expect(checkColor('')).toBeNull();
    expect(checkColor(null)).toBeNull();
    expect(checkColor(undefined)).toBeUndefined();
  });
  it('rechaza formatos inválidos', () => {
    expect(() => checkColor('rojo')).toThrow(ValidationError);
    expect(() => checkColor('#fff')).toThrow(ValidationError);
  });
});
