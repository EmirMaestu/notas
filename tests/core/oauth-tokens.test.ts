import { beforeEach, describe, expect, it } from 'vitest';
import { NotFoundError } from '@/core/errors';
import {
  ACCESS_TOKEN_TTL_MS, CODE_TTL_MS, REFRESH_TOKEN_TTL_MS, authenticateAccessToken, exchangeAuthorizationCode,
  getClient, listOAuthConnections, purgeExpiredOAuthData, refreshAccessToken, revokeOAuthConnection, revokeToken,
  verifyPkce,
} from '@/core/oauth';
import type { DB } from '@/db/types';
import { createTestDb, createTestUser } from '../helpers/db';
import {
  REDIRECT, RESOURCE, createTestClient, issueTestCode, issueTestTokens, pkcePair,
} from '../helpers/oauth';

const DAY = 24 * 60 * 60 * 1000;
let db: DB;
let userId: string;
let otherId: string;

beforeEach(async () => {
  db = await createTestDb();
  userId = (await createTestUser(db)).id;
  otherId = (await createTestUser(db, 'otra@example.com')).id;
});

const auth = (token: string, now?: Date) => authenticateAccessToken(db, token, { resource: RESOURCE, now });

describe('PKCE', () => {
  it('S256 con el vector del RFC 7636 (apéndice B)', () => {
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(verifyPkce('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', challenge)).toBe(true);
    expect(verifyPkce('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXl', challenge)).toBe(false);
    expect(verifyPkce('corto', challenge)).toBe(false);
    expect(verifyPkce(undefined, challenge)).toBe(false);
  });
});

describe('canje del código', () => {
  it('devuelve tokens nat_/nrt_ de 1 hora atados al recurso', async () => {
    const now = new Date('2026-10-10T12:00:00Z');
    const { client, code, verifier } = await issueTestCode(db, userId, now);
    const tokens = await exchangeAuthorizationCode(db, {
      code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: verifier, resource: RESOURCE,
    }, { resource: RESOURCE, now });
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'tasks' });
    expect(tokens.access_token).toMatch(/^nat_[A-Za-z0-9_-]{43}$/);
    expect(tokens.refresh_token).toMatch(/^nrt_[A-Za-z0-9_-]{43}$/);
    expect(await auth(tokens.access_token, now)).toEqual({ userId, clientId: client.clientId });
    expect(await auth(tokens.access_token, new Date(now.getTime() + ACCESS_TOKEN_TTL_MS))).toBeNull();
    expect(await authenticateAccessToken(db, tokens.access_token, { resource: 'https://otro.test/mcp', now })).toBeNull();
  });

  it('el código es de un solo uso y reusarlo revoca los tokens que se emitieron con él', async () => {
    const { client, code, verifier } = await issueTestCode(db, userId);
    const input = { code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: verifier };
    const tokens = await exchangeAuthorizationCode(db, input, { resource: RESOURCE });
    await expect(exchangeAuthorizationCode(db, input, { resource: RESOURCE })).rejects.toMatchObject({ code: 'invalid_grant' });
    expect(await auth(tokens.access_token)).toBeNull();
  });

  it('vencido, de otro cliente, con otro redirect o con otro verifier → invalid_grant y el código queda quemado', async () => {
    const other = await createTestClient(db);
    type Ctx = { clientId: string; verifier: string };
    const scenarios = [
      (c: Ctx) => ({
        input: { clientId: c.clientId, redirectUri: REDIRECT, codeVerifier: c.verifier },
        now: new Date(Date.now() + CODE_TTL_MS),
      }),
      (c: Ctx) => ({ input: { clientId: other.clientId, redirectUri: REDIRECT, codeVerifier: c.verifier }, now: undefined }),
      (c: Ctx) => ({
        input: { clientId: c.clientId, redirectUri: 'https://cliente.example.com/otra', codeVerifier: c.verifier },
        now: undefined,
      }),
      (c: Ctx) => ({ input: { clientId: c.clientId, redirectUri: REDIRECT, codeVerifier: pkcePair().verifier }, now: undefined }),
    ];
    for (const scenario of scenarios) {
      const { client, code, verifier } = await issueTestCode(db, userId);
      const { input, now } = scenario({ clientId: client.clientId, verifier });
      await expect(exchangeAuthorizationCode(db, { code, ...input }, { resource: RESOURCE, now }))
        .rejects.toMatchObject({ code: 'invalid_grant' });
      // Aun con los datos correctos, el código ya no sirve.
      await expect(exchangeAuthorizationCode(
        db, { code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: verifier }, { resource: RESOURCE },
      )).rejects.toMatchObject({ code: 'invalid_grant' });
    }
  });

  it('faltan parámetros → invalid_request; resource ajeno → invalid_target', async () => {
    const { client, code, verifier } = await issueTestCode(db, userId);
    await expect(exchangeAuthorizationCode(db, { code, clientId: client.clientId, redirectUri: REDIRECT }, { resource: RESOURCE }))
      .rejects.toMatchObject({ code: 'invalid_request' });
    await expect(exchangeAuthorizationCode(db, {
      code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: verifier, resource: 'https://otro.test/mcp',
    }, { resource: RESOURCE })).rejects.toMatchObject({ code: 'invalid_target' });
  });
});

describe('refresh', () => {
  it('rota los tokens: el par viejo deja de servir', async () => {
    const { client, tokens } = await issueTestTokens(db, userId);
    const next = await refreshAccessToken(
      db, { refreshToken: tokens.refresh_token, clientId: client.clientId, resource: RESOURCE }, { resource: RESOURCE },
    );
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect(next.access_token).not.toBe(tokens.access_token);
    expect(await auth(tokens.access_token)).toBeNull();
    expect(await auth(next.access_token)).toEqual({ userId, clientId: client.clientId });
  });

  it('reusar un refresh ya rotado revoca toda la familia', async () => {
    const { client, tokens } = await issueTestTokens(db, userId);
    const refresh = (refreshToken: string) =>
      refreshAccessToken(db, { refreshToken, clientId: client.clientId }, { resource: RESOURCE });
    const next = await refresh(tokens.refresh_token);
    await expect(refresh(tokens.refresh_token)).rejects.toMatchObject({ code: 'invalid_grant' });
    expect(await auth(next.access_token)).toBeNull();
    await expect(refresh(next.refresh_token)).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('vencido, de otro cliente o desconocido → invalid_grant', async () => {
    const now = new Date('2026-10-10T12:00:00Z');
    const { client, tokens } = await issueTestTokens(db, userId, now);
    await expect(refreshAccessToken(db, { refreshToken: tokens.refresh_token, clientId: client.clientId }, {
      resource: RESOURCE, now: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
    })).rejects.toMatchObject({ code: 'invalid_grant' });

    const second = await issueTestTokens(db, userId);
    const intruder = await createTestClient(db);
    await expect(refreshAccessToken(
      db, { refreshToken: second.tokens.refresh_token, clientId: intruder.clientId }, { resource: RESOURCE },
    )).rejects.toMatchObject({ code: 'invalid_grant' });
    // Un refresh presentado por otro cliente se considera robado: la familia queda revocada.
    expect(await auth(second.tokens.access_token)).toBeNull();

    await expect(refreshAccessToken(db, { refreshToken: 'nrt_desconocido', clientId: client.clientId }, { resource: RESOURCE }))
      .rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(refreshAccessToken(db, { clientId: client.clientId }, { resource: RESOURCE }))
      .rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('revocación y conexiones', () => {
  it('revokeToken revoca el par por access o por refresh y respeta client_id', async () => {
    const a = await issueTestTokens(db, userId);
    await revokeToken(db, { token: a.tokens.access_token, clientId: 'ncl_otro' });
    expect(await auth(a.tokens.access_token)).not.toBeNull();
    await revokeToken(db, { token: a.tokens.access_token, clientId: a.client.clientId });
    expect(await auth(a.tokens.access_token)).toBeNull();

    const b = await issueTestTokens(db, userId);
    await revokeToken(db, { token: b.tokens.refresh_token });
    expect(await auth(b.tokens.access_token)).toBeNull();
    await expect(revokeToken(db, {})).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('lista las apps conectadas del usuario y permite desconectarlas', async () => {
    const { client } = await issueTestTokens(db, userId);
    await issueTestTokens(db, otherId);
    expect(await listOAuthConnections(db, userId)).toEqual([
      { clientId: client.clientId, clientName: 'Cliente de prueba', lastUsedAt: null },
    ]);
    await expect(revokeOAuthConnection(db, otherId, client.clientId)).rejects.toBeInstanceOf(NotFoundError);
    await revokeOAuthConnection(db, userId, client.clientId);
    expect(await listOAuthConnections(db, userId)).toEqual([]);
    await expect(revokeOAuthConnection(db, userId, client.clientId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('authenticateAccessToken actualiza last_used_at como mucho una vez por minuto', async () => {
    const t0 = new Date('2026-10-10T12:00:00Z');
    const { tokens } = await issueTestTokens(db, userId, t0);
    const lastUsed = async () => (await listOAuthConnections(db, userId, t0))[0].lastUsedAt?.toISOString();
    await auth(tokens.access_token, t0);
    expect(await lastUsed()).toBe(t0.toISOString());
    await auth(tokens.access_token, new Date(t0.getTime() + 30_000));
    expect(await lastUsed()).toBe(t0.toISOString());
    const t2 = new Date(t0.getTime() + 61_000);
    await auth(tokens.access_token, t2);
    expect(await lastUsed()).toBe(t2.toISOString());
  });

  it('purgeExpiredOAuthData borra códigos y tokens vencidos y clientes huérfanos', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const orphan = await createTestClient(db, [REDIRECT], t0);
    const { client: used } = await issueTestTokens(db, userId, t0);
    // A los 2 días: se va el código (vencido hace más de 1 día) y el cliente sin códigos ni tokens.
    expect(await purgeExpiredOAuthData(db, new Date(t0.getTime() + 2 * DAY))).toEqual({ codes: 1, tokens: 0, clients: 1 });
    expect(await getClient(db, orphan.clientId)).toBeNull();
    expect(await getClient(db, used.clientId)).not.toBeNull();
    // A los 61 días venció el refresh: se van los tokens y, sin nada colgando, el cliente.
    expect(await purgeExpiredOAuthData(db, new Date(t0.getTime() + 61 * DAY))).toEqual({ codes: 0, tokens: 1, clients: 1 });
    expect(await getClient(db, used.clientId)).toBeNull();
  });
});
