import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AuthorizationParams, type OAuthClient, validateAuthorizationRequest,
} from '@/core/oauth';
import { oauthCodes } from '@/db/schema';
import type { DB } from '@/db/types';
import {
  authorizePath, errorPageView, isSameOriginSubmission, loginUrlFor, resolveConsent,
  type RedirectableError,
} from '@/lib/oauth-consent';
import { createTestDb, createTestUser } from '../helpers/db';
import { REDIRECT, RESOURCE, createTestClient, pkcePair } from '../helpers/oauth';

const ISSUER = 'https://notas.test';
const { challenge } = pkcePair();

let db: DB;
let client: OAuthClient;
let userId: string;

beforeEach(async () => {
  db = await createTestDb();
  client = await createTestClient(db);
  userId = (await createTestUser(db)).id;
});

function params(overrides: Partial<AuthorizationParams> = {}): AuthorizationParams {
  return {
    responseType: 'code', clientId: client.clientId, redirectUri: REDIRECT, codeChallenge: challenge,
    codeChallengeMethod: 'S256', state: 'est ado&x=1', resource: RESOURCE, ...overrides,
  };
}

const consent = (p: AuthorizationParams, approve = true, user: { id: string } | null = { id: userId }) =>
  resolveConsent(db, p, { approve, user, issuer: ISSUER, resource: RESOURCE });

describe('página: errores sin redirección automática', () => {
  it('cliente desconocido → error en pantalla (no redirigible)', async () => {
    const check = await validateAuthorizationRequest(db, params({ clientId: 'ncl_nada' }), { resource: RESOURCE });
    expect(check).toMatchObject({ ok: false, redirect: false });
  });

  it('redirect_uri no registrada → error en pantalla (no redirigible)', async () => {
    const check = await validateAuthorizationRequest(
      db, params({ redirectUri: 'https://evil.example.com/cb' }), { resource: RESOURCE },
    );
    expect(check).toMatchObject({ ok: false, redirect: false });
  });

  it('response_type inválido con cliente y redirect válidos → vista con enlace "Volver a" con error, state e iss', async () => {
    const check = await validateAuthorizationRequest(db, params({ responseType: 'token' }), { resource: RESOURCE });
    if (check.ok || !check.redirect) throw new Error('se esperaba un error redirigible');
    const view = errorPageView(check as RedirectableError, ISSUER);
    expect(view.host).toBe('cliente.example.com');
    expect(view.message).toBeTruthy();
    expect(view.code).toBe('unsupported_response_type');
    const url = new URL(view.href);
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT);
    expect(url.searchParams.get('error')).toBe('unsupported_response_type');
    expect(url.searchParams.get('state')).toBe('est ado&x=1');
    expect(url.searchParams.get('iss')).toBe(ISSUER);
    expect(url.searchParams.get('error_description')).toBeTruthy();
  });
});

describe('resolveConsent', () => {
  it('aprobar → código, state e iss; el código queda guardado para el usuario', async () => {
    const out = await consent(params());
    if (out.type !== 'redirect') throw new Error(`se esperaba redirect, llegó ${out.type}`);
    const url = new URL(out.url);
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT);
    expect(url.searchParams.get('code')).toMatch(/^nac_/);
    expect(url.searchParams.get('state')).toBe('est ado&x=1');
    expect(url.searchParams.get('iss')).toBe(ISSUER);
    expect(url.searchParams.get('error')).toBeNull();
    const rows = await db.select().from(oauthCodes);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId, clientId: client.clientId, redirectUri: REDIRECT });
  });

  it('cancelar → access_denied con state e iss y sin código', async () => {
    const out = await consent(params(), false);
    if (out.type !== 'redirect') throw new Error('se esperaba redirect');
    const url = new URL(out.url);
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('state')).toBe('est ado&x=1');
    expect(url.searchParams.get('iss')).toBe(ISSUER);
    expect(url.searchParams.get('code')).toBeNull();
    expect(await db.select().from(oauthCodes)).toHaveLength(0);
  });

  it('cliente desconocido o redirect no registrada → error sin redirigir', async () => {
    expect(await consent(params({ clientId: 'ncl_nada' }))).toMatchObject({ type: 'error' });
    expect(await consent(params({ redirectUri: 'https://evil.example.com/cb' }))).toMatchObject({ type: 'error' });
  });

  it('solicitud manipulada con cliente válido → redirige el error al cliente', async () => {
    const out = await consent(params({ responseType: 'token' }));
    if (out.type !== 'redirect') throw new Error('se esperaba redirect');
    expect(new URL(out.url).searchParams.get('error')).toBe('unsupported_response_type');
    expect(await db.select().from(oauthCodes)).toHaveLength(0);
  });

  it('sesión vencida → login con next reconstruido desde los campos validados', async () => {
    const out = await consent(params({ scope: 'otra cosa' }), true, null);
    if (out.type !== 'login') throw new Error(`se esperaba login, llegó ${out.type}`);
    expect(out.url.startsWith('/login?next=')).toBe(true);
    const next = decodeURIComponent(out.url.slice('/login?next='.length));
    const back = new URL(next, ISSUER);
    expect(back.pathname).toBe('/oauth/authorize');
    expect(back.searchParams.get('client_id')).toBe(client.clientId);
    expect(back.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(back.searchParams.get('code_challenge')).toBe(challenge);
    expect(back.searchParams.get('code_challenge_method')).toBe('S256');
    expect(back.searchParams.get('response_type')).toBe('code');
    expect(back.searchParams.get('state')).toBe('est ado&x=1');
    expect(back.searchParams.get('resource')).toBe(RESOURCE);
    expect(back.searchParams.has('scope')).toBe(false);
    expect(await db.select().from(oauthCodes)).toHaveLength(0);
  });
});

describe('helpers', () => {
  it('authorizePath omite los campos ausentes y codifica los valores', () => {
    expect(authorizePath({ clientId: 'ncl_1', state: 'a&b' })).toBe('/oauth/authorize?client_id=ncl_1&state=a%26b');
    expect(loginUrlFor({ clientId: 'ncl_1' })).toBe(`/login?next=${encodeURIComponent('/oauth/authorize?client_id=ncl_1')}`);
  });

  it('isSameOriginSubmission: sin cabecera o same-origin pasa; el resto no', () => {
    expect(isSameOriginSubmission(null)).toBe(true);
    expect(isSameOriginSubmission('same-origin')).toBe(true);
    for (const v of ['cross-site', 'same-site', 'none', '']) expect(isSameOriginSubmission(v)).toBe(false);
  });
});
