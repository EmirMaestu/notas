import { describe, expect, it } from 'vitest';
import { safeRedirect } from '@/lib/safe-redirect';

describe('safeRedirect', () => {
  it('acepta rutas internas', () => {
    expect(safeRedirect('/app/inbox')).toBe('/app/inbox');
    expect(safeRedirect('/oauth/authorize?client_id=x')).toBe('/oauth/authorize?client_id=x');
  });
  it('no deja una ruta protocolo-relativa con %2F codificado', () => {
    expect(safeRedirect('/%2F%2Fevil.com').startsWith('//')).toBe(false);
  });
  it('rechaza externas, protocolo-relativas y basura', () => {
    for (const bad of [
      'https://evil.com', '//evil.com', '/\\evil.com', '/\t/evil.com', '/\n/evil.com', '/\t\\evil.com',
      '/.//evil.com', '/..//evil.com', '/a/..//evil.com', '/%2e//evil.com',
      'javascript:alert(1)', '', null, undefined, 42,
    ]) {
      expect(safeRedirect(bad)).toBe('/app/today');
    }
  });
});
