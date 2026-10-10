import { describe, expect, it } from 'vitest';
import { nextLocalValue } from '@/lib/synced-field';

describe('nextLocalValue', () => {
  it('adopta el valor remoto si el campo no está sucio', () => {
    expect(nextLocalValue('Viejo', 'Viejo', 'Renombrada')).toBe('Renombrada');
  });

  it('conserva lo que el usuario está escribiendo', () => {
    expect(nextLocalValue('Mi edición', 'Viejo', 'Renombrada')).toBe('Mi edición');
  });
});
