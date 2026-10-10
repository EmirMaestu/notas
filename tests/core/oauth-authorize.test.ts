import { beforeEach, describe, expect, it } from 'vitest';
import {
  CODE_TTL_MS, authorizationParamsFrom, buildRedirectUrl, createAuthorizationCode, validateAuthorizationRequest,
  type AuthorizationParams, type OAuthClient,
} from '@/core/oauth';
import { oauthCodes } from '@/db/schema';
import type { DB } from '@/db/types';
import { createTestDb, createTestUser } from '../helpers/db';
import { REDIRECT, RESOURCE, createTestClient, pkcePair } from '../helpers/oauth';

let db: DB;
let client: OAuthClient;
const { challenge } = pkcePair();

beforeEach(async () => {
  db = await createTestDb();
  client = await createTestClient(db);
});

function params(overrides: Partial<AuthorizationParams> = {}): AuthorizationParams {
  return {
    responseType: 'code', clientId: client.clientId, redirectUri: REDIRECT, codeChallenge: challenge,
    codeChallengeMethod: 'S256', state: 'abc', scope: 'tasks', resource: RESOURCE, ...overrides,
  };
}

const validate = (p: AuthorizationParams) => validateAuthorizationRequest(db, p, { resource: RESOURCE });

describe('validateAuthorizationRequest', () => {
  it('acepta una solicitud válida', async () => {
    expect(await validate(params())).toMatchObject({
      ok: true, redirectUri: REDIRECT, codeChallenge: challenge, state: 'abc', scope: 'tasks', resource: RESOURCE,
    });
  });

  it('cliente o redirect inválidos → error en pantalla, nunca redirige', async () => {
    for (const p of [
      params({ clientId: undefined }),
      params({ clientId: 'ncl_desconocido' }),
      params({ redirectUri: undefined }),
      params({ redirectUri: 'https://otro.example.com/callback' }),
    ]) {
      expect(await validate(p)).toMatchObject({ ok: false, redirect: false });
    }
  });

  it('el resto de los errores vuelve al redirect_uri con el código OAuth y el state', async () => {
    const cases: [Partial<AuthorizationParams>, string][] = [
      [{ responseType: 'token' }, 'unsupported_response_type'],
      [{ codeChallengeMethod: 'plain' }, 'invalid_request'],
      [{ codeChallengeMethod: undefined }, 'invalid_request'],
      [{ codeChallenge: 'corto' }, 'invalid_request'],
      [{ resource: 'https://otro.test/mcp' }, 'invalid_target'],
    ];
    for (const [overrides, error] of cases) {
      expect(await validate(params(overrides))).toMatchObject({
        ok: false, redirect: true, redirectUri: REDIRECT, state: 'abc', error,
      });
    }
  });

  it('state: hasta 2000 caracteres; más es invalid_request sin devolver el state', async () => {
    expect(await validate(params({ state: 's'.repeat(2000) }))).toMatchObject({ ok: true });
    const res = await validate(params({ state: 's'.repeat(2001) }));
    expect(res).toMatchObject({ ok: false, redirect: true, redirectUri: REDIRECT, error: 'invalid_request' });
    expect(res.ok === false && res.redirect && res.state).toBeUndefined();
  });

  it('scope y resource son opcionales; siempre se concede "tasks" para el recurso propio', async () => {
    expect(await validate(params({ scope: 'openid otra', resource: undefined }))).toMatchObject({
      ok: true, scope: 'tasks', resource: RESOURCE,
    });
  });
});

describe('helpers de autorización', () => {
  it('authorizationParamsFrom lee los nombres OAuth e ignora los vacíos', () => {
    const sp = new URLSearchParams({ response_type: 'code', client_id: 'ncl_1', state: '', redirect_uri: 'https://x.example.com/cb' });
    expect(authorizationParamsFrom((name) => sp.get(name) ?? undefined)).toEqual({
      responseType: 'code', clientId: 'ncl_1', redirectUri: 'https://x.example.com/cb',
    });
  });

  it('buildRedirectUrl conserva la query existente y omite los undefined', () => {
    expect(buildRedirectUrl('https://x.example.com/cb?a=1', { code: 'c', state: undefined, iss: 'https://notas.test' }))
      .toBe('https://x.example.com/cb?a=1&code=c&iss=https%3A%2F%2Fnotas.test');
  });

  it('createAuthorizationCode guarda solo el hash y vence a los 5 minutos', async () => {
    const user = await createTestUser(db);
    const now = new Date('2026-10-10T12:00:00Z');
    const code = await createAuthorizationCode(db, {
      clientId: client.clientId, userId: user.id, redirectUri: REDIRECT, codeChallenge: challenge,
      scope: 'tasks', resource: RESOURCE,
    }, now);
    expect(code).toMatch(/^nac_[A-Za-z0-9_-]{43}$/);
    const rows = await db.select().from(oauthCodes);
    expect(rows).toHaveLength(1);
    expect(rows[0].codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].expiresAt.getTime() - now.getTime()).toBe(CODE_TTL_MS);
    expect(rows[0].usedAt).toBeNull();
    expect(rows[0].familyId).toBeNull();
  });
});
