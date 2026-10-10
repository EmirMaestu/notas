import { describe, expect, it } from 'vitest';
import { THEME_COOKIE, parseTheme } from '@/lib/theme';

describe('parseTheme', () => {
  it('acepta light y dark', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
  });

  it('cualquier otra cosa (o nada) es system', () => {
    expect(parseTheme(undefined)).toBe('system');
    expect(parseTheme('system')).toBe('system');
    expect(parseTheme('DARK')).toBe('system');
    expect(parseTheme(5)).toBe('system');
  });

  it('la cookie tiene nombre fijo', () => {
    expect(THEME_COOKIE).toBe('notas-theme');
  });
});
