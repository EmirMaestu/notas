import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  authenticateAccessToken, authorizationParamsFrom, createAuthorizationCode, exchangeAuthorizationCode, formValue, getClient,
  purgeExpiredOAuthData, refreshAccessToken, registerClient, revokeOAuthConnection, revokeToken, validateAuthorizationRequest,
} from '@/core/oauth';
import { sha256Hex } from '@/core/secrets';
import { oauthTokens } from '@/db/schema';
import type { DB } from '@/db/types';
import { createTestDb, createTestUser } from '../helpers/db';
import { REDIRECT, RESOURCE, createTestClient, issueTestCode, issueTestTokens, pkcePair } from '../helpers/oauth';

let db: DB;
let userId: string;

beforeEach(async () => {
  db = await createTestDb();
  userId = (await createTestUser(db)).id;
});

const opts = { resource: RESOURCE };

describe('desconectar una app', () => {
  it('un código pendiente no se puede canjear después de desconectar', async () => {
    const { client, code, verifier } = await issueTestCode(db, userId);
    await revokeOAuthConnection(db, userId, client.clientId);
    await expect(exchangeAuthorizationCode(
      db, { code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: verifier }, opts,
    )).rejects.toMatchObject({ code: 'invalid_grant' });
    // Ya no queda nada que desconectar.
    await expect(revokeOAuthConnection(db, userId, client.clientId)).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('revoca varias familias del mismo cliente', async () => {
    const client = await createTestClient(db);
    const tokens = [];
    for (let i = 0; i < 2; i++) {
      const { verifier, challenge } = pkcePair();
      const code = await createAuthorizationCode(db, {
        clientId: client.clientId, userId, redirectUri: REDIRECT, codeChallenge: challenge, scope: 'tasks', resource: RESOURCE,
      });
      tokens.push(await exchangeAuthorizationCode(
        db, { code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: verifier }, opts,
      ));
    }
    await revokeOAuthConnection(db, userId, client.clientId);
    for (const t of tokens) expect(await authenticateAccessToken(db, t.access_token, opts)).toBeNull();
  });
});

describe('parámetros repetidos y de tipo inválido', () => {
  const rejects = (input: Record<string, unknown>) =>
    exchangeAuthorizationCode(db, input as never, opts);

  it('formValue: ausente, vacío, único o repetido', () => {
    const form = new URLSearchParams('a=1&b=&c=1&c=2&d=x&d=x');
    expect(formValue(form, 'a')).toBe('1');
    expect(formValue(form, 'b')).toBeUndefined();
    expect(formValue(form, 'zzz')).toBeUndefined();
    expect(formValue(form, 'c')).toEqual(['1', '2']);
    expect(formValue(form, 'd')).toEqual(['x', 'x']);
  });

  it('canje: un parámetro repetido o no-string → invalid_request; resource repetido → invalid_target', async () => {
    const { client, code, verifier } = await issueTestCode(db, userId);
    const ok = { code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: verifier };
    for (const field of ['code', 'clientId', 'redirectUri', 'codeVerifier']) {
      for (const bad of [['a', 'b'], 42, {}, true, null]) {
        await expect(rejects({ ...ok, [field]: bad })).rejects.toMatchObject({ code: 'invalid_request' });
      }
    }
    await expect(rejects({ ...ok, resource: [RESOURCE, RESOURCE] })).rejects.toMatchObject({ code: 'invalid_target' });
    await expect(rejects({ ...ok, resource: 5 })).rejects.toMatchObject({ code: 'invalid_target' });
    // Nada de lo anterior gastó el código.
    await expect(exchangeAuthorizationCode(db, ok, opts)).resolves.toBeDefined();
  });

  it('refresh y revocación: no-string → invalid_request, sin TypeError', async () => {
    const { client, tokens } = await issueTestTokens(db, userId);
    for (const bad of [['a', 'b'], 42, {}, true]) {
      await expect(refreshAccessToken(db, { refreshToken: bad, clientId: client.clientId } as never, opts))
        .rejects.toMatchObject({ code: 'invalid_request' });
      await expect(refreshAccessToken(db, { refreshToken: tokens.refresh_token, clientId: bad } as never, opts))
        .rejects.toMatchObject({ code: 'invalid_request' });
      await expect(refreshAccessToken(db, { refreshToken: 'x', clientId: 'y', resource: bad } as never, opts))
        .rejects.toMatchObject({ code: 'invalid_target' });
      await expect(revokeToken(db, { token: bad } as never)).rejects.toMatchObject({ code: 'invalid_request' });
      await expect(revokeToken(db, { token: tokens.access_token, clientId: bad } as never))
        .rejects.toMatchObject({ code: 'invalid_request' });
    }
    expect(await getClient(db, 42 as never)).toBeNull();
    expect(await authenticateAccessToken(db, tokens.access_token, opts)).not.toBeNull();
  });

  it('autorización: parámetro repetido → invalid_request (resource → invalid_target); client/redirect repetidos → sin redirigir', async () => {
    const client = await createTestClient(db);
    const { challenge } = pkcePair();
    const base: Record<string, string | string[]> = {
      response_type: 'code', client_id: client.clientId, redirect_uri: REDIRECT, code_challenge: challenge,
      code_challenge_method: 'S256', state: 's', scope: 'tasks', resource: RESOURCE,
    };
    const check = (overrides: Record<string, string | string[]>) => {
      const all = { ...base, ...overrides };
      return validateAuthorizationRequest(db, authorizationParamsFrom((n) => all[n]), opts);
    };
    expect(await check({})).toMatchObject({ ok: true });
    expect(await check({ response_type: ['code', 'code'] })).toMatchObject({ ok: false, redirect: true, error: 'invalid_request' });
    expect(await check({ code_challenge: [challenge, challenge] })).toMatchObject({ redirect: true, error: 'invalid_request' });
    expect(await check({ state: ['a', 'b'] })).toMatchObject({ redirect: true, error: 'invalid_request' });
    expect(await check({ scope: ['tasks', 'tasks'] })).toMatchObject({ redirect: true, error: 'invalid_request' });
    expect(await check({ resource: [RESOURCE, RESOURCE] })).toMatchObject({ redirect: true, error: 'invalid_target' });
    expect(await check({ client_id: [client.clientId, client.clientId] })).toMatchObject({ ok: false, redirect: false });
    expect(await check({ redirect_uri: [REDIRECT, REDIRECT] })).toMatchObject({ ok: false, redirect: false });
  });
});

describe('nombre del cliente', () => {
  it('quita caracteres bidi y de ancho cero (no se puede disfrazar el nombre en el consentimiento)', async () => {
    const client = await registerClient(db, {
      client_name: '‮evil​‏⁦x⁩﻿‪ app', redirect_uris: [REDIRECT],
    });
    expect(client.clientName).toBe('evilx app');
    const onlyHidden = await registerClient(db, { client_name: '​﻿‮', redirect_uris: [REDIRECT] });
    expect(onlyHidden.clientName).toBe('Aplicación sin nombre');
  });
});

describe('mantenimiento', () => {
  it('purge: un cliente con un código reciente no se borra aunque sea viejo', async () => {
    const DAY = 24 * 60 * 60 * 1000;
    const t0 = new Date('2026-01-01T00:00:00Z');
    const withCode = await createTestClient(db, [REDIRECT], t0);
    const empty = await createTestClient(db, [REDIRECT], t0);
    await createAuthorizationCode(db, {
      clientId: withCode.clientId, userId, redirectUri: REDIRECT, codeChallenge: pkcePair().challenge, scope: 'tasks',
      resource: RESOURCE,
    }, new Date(t0.getTime() + 1.9 * DAY));
    expect(await purgeExpiredOAuthData(db, new Date(t0.getTime() + 2 * DAY))).toEqual({ codes: 0, tokens: 0, clients: 1 });
    expect(await getClient(db, empty.clientId)).toBeNull();
    expect(await getClient(db, withCode.clientId)).not.toBeNull();
  });
});

describe('vida absoluta de la familia de refresh', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('rota hasta los 180 días desde el canje original; después, invalid_grant', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const { client, tokens } = await issueTestTokens(db, userId, t0);
    let refresh = tokens.refresh_token;
    const rotate = (days: number) => refreshAccessToken(
      db, { refreshToken: refresh, clientId: client.clientId }, { resource: RESOURCE, now: new Date(t0.getTime() + days * DAY) },
    );
    // Cada rotación llega antes de que venza el refresh de 60 días.
    for (const days of [50, 100, 150, 179]) refresh = (await rotate(days)).refresh_token;
    await expect(rotate(181)).rejects.toMatchObject({ code: 'invalid_grant' });
    // La familia queda revocada: ni el access token más reciente sirve.
    expect(await authenticateAccessToken(db, tokens.access_token, { resource: RESOURCE, now: t0 })).toBeNull();
  });

  it('el refresh emitido cerca del límite vence a los 180 días, no a los 60 siguientes', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const { client, tokens } = await issueTestTokens(db, userId, t0);
    let refresh = tokens.refresh_token;
    for (const days of [55, 110, 165]) {
      refresh = (await refreshAccessToken(db, { refreshToken: refresh, clientId: client.clientId }, {
        resource: RESOURCE, now: new Date(t0.getTime() + days * DAY),
      })).refresh_token;
    }
    const [row] = await db.select().from(oauthTokens).where(eq(oauthTokens.refreshTokenHash, sha256Hex(refresh)));
    expect(row.refreshExpiresAt.getTime()).toBe(t0.getTime() + 180 * DAY);
    expect(row.familyCreatedAt.getTime()).toBe(t0.getTime());
  });
});
