import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPTIONS as REVOKE_OPTIONS, POST as REVOKE } from '@/app/oauth/revoke/route';
import { OPTIONS as TOKEN_OPTIONS, POST as TOKEN } from '@/app/oauth/token/route';
import { authenticateAccessToken } from '@/core/oauth';
import { setDbForTests } from '@/db';
import type { DB } from '@/db/types';
import { createTestDb, createTestUser } from '../helpers/db';
import { REDIRECT, RESOURCE, issueTestCode, issueTestTokens } from '../helpers/oauth';

let db: DB;
let userId: string;

beforeEach(async () => {
  vi.stubEnv('APP_URL', 'https://notas.test');
  db = await createTestDb();
  setDbForTests(db);
  userId = (await createTestUser(db)).id;
});
afterEach(() => {
  setDbForTests(undefined);
  vi.unstubAllEnvs();
});

function form(path: string, data: Record<string, string>): Request {
  return new Request(`https://notas.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '10.1.0.1' },
    body: new URLSearchParams(data).toString(),
  });
}

describe('POST /oauth/token', () => {
  it('authorization_code → tokens; refresh_token → tokens nuevos', async () => {
    const { client, code, verifier } = await issueTestCode(db, userId);
    const res = await TOKEN(form('/oauth/token', {
      grant_type: 'authorization_code', code, client_id: client.clientId, redirect_uri: REDIRECT,
      code_verifier: verifier, resource: RESOURCE,
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const tokens = await res.json();
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'tasks' });
    expect(await authenticateAccessToken(db, tokens.access_token, { resource: RESOURCE })).toMatchObject({ userId });

    const res2 = await TOKEN(form('/oauth/token', {
      grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.clientId,
    }));
    expect(res2.status).toBe(200);
    expect((await res2.json()).access_token).not.toBe(tokens.access_token);
  });

  it('devuelve errores OAuth con 400', async () => {
    const cases: [Request, string][] = [
      [form('/oauth/token', {
        grant_type: 'authorization_code', code: 'nac_x', client_id: 'ncl_x', redirect_uri: REDIRECT, code_verifier: 'a'.repeat(43),
      }), 'invalid_grant'],
      [form('/oauth/token', { grant_type: 'client_credentials' }), 'unsupported_grant_type'],
      [form('/oauth/token', { grant_type: 'refresh_token' }), 'invalid_request'],
      [form('/oauth/token', {}), 'invalid_request'],
      [form('/oauth/token', { grant_type: '' }), 'invalid_request'],
      [new Request('https://notas.test/oauth/token', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      }), 'invalid_request'],
    ];
    for (const [request, error] of cases) {
      const res = await TOKEN(request);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error });
    }
  });
});

describe('parámetros repetidos (RFC 6749 §3.1)', () => {
  const raw = (path: string, body: string) => new Request(`https://notas.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '10.1.0.1' },
    body,
  });

  it('token: repetir un parámetro → invalid_request; repetir resource → invalid_target; el código sigue sirviendo', async () => {
    const { client, code, verifier } = await issueTestCode(db, userId);
    const base = new URLSearchParams({
      grant_type: 'authorization_code', code, client_id: client.clientId, redirect_uri: REDIRECT, code_verifier: verifier,
    }).toString();
    const dup = await TOKEN(raw('/oauth/token', `${base}&code_verifier=${verifier}`));
    expect(dup.status).toBe(400);
    expect(await dup.json()).toMatchObject({ error: 'invalid_request' });
    const target = await TOKEN(raw('/oauth/token', `${base}&resource=${encodeURIComponent(RESOURCE)}&resource=${encodeURIComponent(RESOURCE)}`));
    expect(await target.json()).toMatchObject({ error: 'invalid_target' });
    expect((await TOKEN(raw('/oauth/token', base))).status).toBe(200);
  });

  it('revoke: token repetido → invalid_request y no revoca', async () => {
    const { tokens } = await issueTestTokens(db, userId);
    const res = await REVOKE(raw('/oauth/revoke', `token=${tokens.access_token}&token=${tokens.access_token}`));
    expect(res.status).toBe(400);
    expect(await authenticateAccessToken(db, tokens.access_token, { resource: RESOURCE })).not.toBeNull();
  });
});

describe('casos de /oauth/token y /oauth/revoke', () => {
  const post = (path: string, body: string, ip: string) => new Request(`https://notas.test${path}`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip }, body,
  });

  it('grant_type repetido → invalid_request (no unsupported_grant_type)', async () => {
    const res = await TOKEN(post('/oauth/token', 'grant_type=refresh_token&grant_type=refresh_token', '10.2.0.1'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('resource ajeno → invalid_target', async () => {
    const { client, code, verifier } = await issueTestCode(db, userId);
    const res = await TOKEN(form('/oauth/token', {
      grant_type: 'authorization_code', code, client_id: client.clientId, redirect_uri: REDIRECT,
      code_verifier: verifier, resource: 'https://otro.example.com/mcp',
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_target' });
  });

  it('redirect_uri distinto al de la autorización → invalid_grant', async () => {
    const { client, code, verifier } = await issueTestCode(db, userId);
    const res = await TOKEN(form('/oauth/token', {
      grant_type: 'authorization_code', code, client_id: client.clientId, redirect_uri: 'https://cliente.example.com/otro',
      code_verifier: verifier,
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('429 con invalid_request, descripción y Retry-After; revoke igual', async () => {
    const ip = '10.8.8.8';
    for (let i = 0; i < 60; i++) expect((await TOKEN(post('/oauth/token', 'grant_type=x', ip))).status).toBe(400);
    const res = await TOKEN(post('/oauth/token', 'grant_type=x', ip));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(await res.json()).toMatchObject({ error: 'invalid_request', error_description: expect.any(String) });

    for (let i = 0; i < 60; i++) await REVOKE(post('/oauth/revoke', 'token=x', ip));
    const rev = await REVOKE(post('/oauth/revoke', 'token=x', ip));
    expect(rev.status).toBe(429);
    expect(rev.headers.get('retry-after')).toBe('60');
  });

  it('OPTIONS (preflight CORS) en token y revoke', () => {
    for (const handler of [TOKEN_OPTIONS, REVOKE_OPTIONS]) {
      const res = handler();
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-allow-methods')).toContain('POST');
      expect(res.headers.get('access-control-allow-headers')).toContain('Content-Type');
    }
  });
});

describe('POST /oauth/revoke', () => {
  it('responde 200 siempre y el token deja de servir', async () => {
    const { client, tokens } = await issueTestTokens(db, userId);
    const res = await REVOKE(form('/oauth/revoke', { token: tokens.refresh_token, client_id: client.clientId }));
    expect(res.status).toBe(200);
    expect(await authenticateAccessToken(db, tokens.access_token, { resource: RESOURCE })).toBeNull();
    expect((await REVOKE(form('/oauth/revoke', { token: 'nat_desconocido' }))).status).toBe(200);
    expect((await REVOKE(form('/oauth/revoke', {}))).status).toBe(400);
  });
});
