import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST, OPTIONS } from '@/app/oauth/register/route';
import { getClient } from '@/core/oauth';
import { setDbForTests } from '@/db';
import type { DB } from '@/db/types';
import { createTestDb } from '../helpers/db';
import { REDIRECT } from '../helpers/oauth';

let db: DB;

beforeEach(async () => {
  db = await createTestDb();
  setDbForTests(db);
});
afterEach(() => {
  setDbForTests(undefined);
});

function register(body: string, ip = '10.0.0.1'): Promise<Response> {
  return POST(new Request('https://notas.test/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body,
  }));
}

describe('POST /oauth/register', () => {
  it('registra y responde 201 con el cliente público', async () => {
    const res = await register(JSON.stringify({
      client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: 'none',
    }));
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = await res.json();
    expect(body).toMatchObject({
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'tasks',
    });
    expect(body.client_id).toMatch(/^ncl_/);
    expect(typeof body.client_id_issued_at).toBe('number');
    expect(body).not.toHaveProperty('client_secret');
    expect(await getClient(db, body.client_id)).not.toBeNull();
  });

  it('errores RFC 7591 con 400', async () => {
    let res = await register(JSON.stringify({ redirect_uris: ['http://evil.example.com/cb'] }), '10.0.0.2');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_redirect_uri' });
    res = await register('{no es json', '10.0.0.2');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_client_metadata' });
    res = await register(JSON.stringify({ redirect_uris: [REDIRECT], client_name: 'x'.repeat(20_000) }), '10.0.0.2');
    expect(res.status).toBe(413);
  });

  it('limita a 20 registros por hora e IP, con Retry-After', async () => {
    const body = JSON.stringify({ redirect_uris: [REDIRECT] });
    for (let i = 0; i < 20; i++) expect((await register(body, '10.9.9.9')).status).toBe(201);
    const limited = await register(body, '10.9.9.9');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('3600');
    expect(await limited.json()).toMatchObject({ error: 'invalid_request' });
    expect((await register(body, '10.9.9.8')).status).toBe(201);
  });

  it('agrupa las IPv6 por /64 al limitar', async () => {
    const body = JSON.stringify({ redirect_uris: [REDIRECT] });
    for (let i = 0; i < 20; i++) expect((await register(body, `2001:db8:aa:bb::${i + 1}`)).status).toBe(201);
    expect((await register(body, '2001:db8:aa:bb:1:2:3:4')).status).toBe(429);
    expect((await register(body, '2001:db8:aa:cc::1')).status).toBe(201);
  });

  it('exige Content-Type application/json', async () => {
    const body = JSON.stringify({ redirect_uris: [REDIRECT] });
    const variants: Record<string, string>[] = [{}, { 'content-type': 'text/plain' }, { 'content-type': 'application/x-www-form-urlencoded' }];
    for (const headers of variants) {
      const res = await POST(new Request('https://notas.test/oauth/register', {
        method: 'POST', headers: { 'x-forwarded-for': '10.3.3.3', ...headers }, body,
      }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid_client_metadata' });
    }
    const ok = await POST(new Request('https://notas.test/oauth/register', {
      method: 'POST', headers: { 'x-forwarded-for': '10.3.3.3', 'content-type': 'Application/JSON; charset=utf-8' }, body,
    }));
    expect(ok.status).toBe(201);
  });

  it('rechaza JSON que no es un objeto, demasiadas redirect_uris y client_name no string', async () => {
    for (const body of ['null', '[]', '[{"redirect_uris":[]}]', '42', '"texto"']) {
      const res = await register(body, '10.4.4.4');
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid_client_metadata' });
    }
    const many = Array.from({ length: 11 }, (_, i) => `https://c${i}.example.com/cb`);
    const tooMany = await register(JSON.stringify({ redirect_uris: many }), '10.4.4.4');
    expect(tooMany.status).toBe(400);
    expect(await tooMany.json()).toMatchObject({ error: 'invalid_redirect_uri' });
    for (const name of [123, { a: 1 }, ['x'], true]) {
      const res = await register(JSON.stringify({ redirect_uris: [REDIRECT], client_name: name }), '10.4.4.4');
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid_client_metadata' });
    }
  });

  it('rechaza un stream sin Content-Length que pasa el límite con 413', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(4000));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 4; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const res = await POST(new Request('https://notas.test/oauth/register', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.5.5.5' }, body, duplex: 'half',
    } as RequestInit));
    expect(res.status).toBe(413);
  });

  it('responde el preflight CORS', () => {
    expect(OPTIONS().status).toBe(204);
  });
});
