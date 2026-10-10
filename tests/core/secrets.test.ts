import { describe, expect, it } from 'vitest';
import { generateSecret, safeEqual, sha256Base64Url, sha256Hex } from '@/core/secrets';

describe('secretos', () => {
  it('generateSecret: prefijo + base64url de 32 bytes (o los pedidos), siempre distinto', () => {
    const a = generateSecret('ntk_');
    expect(a).toMatch(/^ntk_[A-Za-z0-9_-]{43}$/);
    expect(generateSecret('ntk_')).not.toBe(a);
    expect(generateSecret('ncl_', 16)).toMatch(/^ncl_[A-Za-z0-9_-]{22}$/);
  });

  it('hashes SHA-256 en hex y en base64url', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    // RFC 7636, apéndice B
    expect(sha256Base64Url('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('safeEqual compara textos de cualquier largo', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
