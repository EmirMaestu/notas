import { describe, expect, it } from 'vitest';
import { clientIpFrom, rateLimitKey, trustedProxyHops } from '@/lib/client-ip';

describe('clientIpFrom', () => {
  it('con 1 salto toma la última entrada (la que agregó el proxy)', () => {
    expect(clientIpFrom('6.6.6.6, 1.2.3.4', 1)).toBe('1.2.3.4');
  });
  it('con 2 saltos toma la penúltima', () => {
    expect(clientIpFrom('9.9.9.9, 1.2.3.4, 10.0.0.1', 2)).toBe('1.2.3.4');
  });
  it('recorta espacios', () => {
    expect(clientIpFrom('  1.2.3.4  ', 1)).toBe('1.2.3.4');
  });
  it('si hay menos entradas que saltos usa la primera', () => {
    expect(clientIpFrom('1.2.3.4', 3)).toBe('1.2.3.4');
  });
  it('sin cabecera o vacía devuelve local', () => {
    expect(clientIpFrom(null, 1)).toBe('local');
    expect(clientIpFrom('', 1)).toBe('local');
    expect(clientIpFrom(' , ', 1)).toBe('local');
  });
  it('con 0 saltos ignora la cabecera', () => {
    expect(clientIpFrom('1.2.3.4', 0)).toBe('local');
  });
});

describe('rateLimitKey', () => {
  it('deja IPv4 y valores no-IP como están', () => {
    expect(rateLimitKey('1.2.3.4')).toBe('1.2.3.4');
    expect(rateLimitKey('local')).toBe('local');
  });
  it('agrupa IPv6 por /64', () => {
    const a = rateLimitKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    expect(a).toBe('2001:0db8:0001:0002::/64');
    expect(rateLimitKey('2001:DB8:1:2::1')).toBe(a);
    expect(rateLimitKey('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe(a);
    expect(rateLimitKey('2001:db8:1:3::1')).not.toBe(a);
  });
  it('maneja :: al inicio, corchetes y zona', () => {
    expect(rateLimitKey('::1')).toBe('0000:0000:0000:0000::/64');
    expect(rateLimitKey('[2001:db8::5]')).toBe('2001:0db8:0000:0000::/64');
    expect(rateLimitKey('fe80::1%eth0')).toBe('fe80:0000:0000:0000::/64');
  });
  it('IPv4 mapeada cuenta como la IPv4', () => {
    expect(rateLimitKey('::ffff:1.2.3.4')).toBe('1.2.3.4');
  });
  it('IPv6 inválida queda igual', () => {
    expect(rateLimitKey('1:2:3')).toBe('1:2:3');
    expect(rateLimitKey('1::2::3')).toBe('1::2::3');
  });
});

describe('trustedProxyHops', () => {
  it('usa 1 por defecto y ante valores inválidos', () => {
    expect(trustedProxyHops(undefined)).toBe(1);
    expect(trustedProxyHops('')).toBe(1);
    expect(trustedProxyHops('abc')).toBe(1);
    expect(trustedProxyHops('-1')).toBe(1);
  });
  it('parsea enteros >= 0', () => {
    expect(trustedProxyHops('0')).toBe(0);
    expect(trustedProxyHops('2')).toBe(2);
  });
});
