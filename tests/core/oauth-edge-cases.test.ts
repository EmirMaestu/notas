import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApiToken } from '@/core/api-tokens';
import { authenticateBearer } from '@/core/bearer';
import {
  ACCESS_TOKEN_TTL_MS, authenticateAccessToken, createAuthorizationCode, exchangeAuthorizationCode, isAllowedRedirectUri,
  isLoopbackRedirect, matchesRegisteredRedirect, refreshAccessToken, registerClient, revokeToken, validateAuthorizationRequest,
  verifyPkce,
} from '@/core/oauth';
import { users } from '@/db/schema';
import type { DB } from '@/db/types';
import { createTestDb, createTestUser } from '../helpers/db';
import { REDIRECT, RESOURCE, createTestClient, issueTestCode, issueTestTokens, pkcePair } from '../helpers/oauth';

let db: DB;
let userId: string;
const opts = { resource: RESOURCE };

beforeEach(async () => {
  db = await createTestDb();
  userId = (await createTestUser(db)).id;
});

const challengeOf = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

describe('PKCE', () => {
  it('el verifier mide entre 43 y 128 caracteres "unreserved"', () => {
    for (const [length, ok] of [[42, false], [43, true], [128, true], [129, false]] as const) {
      const verifier = 'a'.repeat(length);
      expect(verifyPkce(verifier, challengeOf(verifier)), `largo ${length}`).toBe(ok);
    }
    const unreserved = `${'A'.repeat(20)}-._~${'z'.repeat(19)}`;
    expect(unreserved).toHaveLength(43);
    expect(verifyPkce(unreserved, challengeOf(unreserved))).toBe(true);
    for (const bad of ['+', '/', '=', ' ', 'ñ', '\n']) {
      const verifier = `${'a'.repeat(42)}${bad}`;
      expect(verifyPkce(verifier, challengeOf(verifier)), JSON.stringify(bad)).toBe(false);
    }
  });

  it('el code_challenge debe ser base64url de exactamente 43 caracteres', async () => {
    const client = await createTestClient(db);
    const base = {
      responseType: 'code', clientId: client.clientId, redirectUri: REDIRECT, codeChallengeMethod: 'S256',
    };
    const check = (codeChallenge: string) => validateAuthorizationRequest(db, { ...base, codeChallenge }, opts);
    expect(await check('a'.repeat(43))).toMatchObject({ ok: true });
    for (const bad of ['a'.repeat(44), 'a'.repeat(42), `${'a'.repeat(42)}+`, `${'a'.repeat(42)}/`, `${'a'.repeat(42)}=`]) {
      expect(await check(bad), bad).toMatchObject({ ok: false, redirect: true, error: 'invalid_request' });
    }
  });
});

describe('redirect URIs', () => {
  it('rechaza fragmento, hosts parecidos a localhost, esquemas peligrosos y URIs larguísimas', () => {
    expect(isAllowedRedirectUri('https://x.example.com/cb#')).toBe(false);
    expect(isAllowedRedirectUri('http://localhost.evil.com/cb')).toBe(false);
    expect(isAllowedRedirectUri('http://evil.com/localhost')).toBe(false);
    expect(isAllowedRedirectUri('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isAllowedRedirectUri('file:///etc/passwd')).toBe(false);
    expect(isAllowedRedirectUri(`https://x.example.com/${'a'.repeat(2000)}`)).toBe(false);
    expect(isAllowedRedirectUri(`https://x.example.com/${'a'.repeat(1900)}`)).toBe(true);
  });

  it('esquema y host se normalizan a minúsculas: HTTP://LOCALHOST/cb es loopback y se acepta', () => {
    // Decisión: se acepta lo que el parser URL considera idéntico (RFC 3986 §6.2.2.1); no abre nada nuevo.
    expect(isAllowedRedirectUri('HTTP://LOCALHOST/cb')).toBe(true);
    expect(isLoopbackRedirect('HTTP://LOCALHOST/cb')).toBe(true);
    expect(matchesRegisteredRedirect(['http://localhost/cb'], 'HTTP://LOCALHOST:5000/cb')).toBe(true);
    expect(matchesRegisteredRedirect(['HTTP://LOCALHOST/cb'], 'http://localhost:5000/cb')).toBe(true);
    expect(matchesRegisteredRedirect(['http://localhost/cb'], 'HTTP://LOCALHOST.EVIL.COM/cb')).toBe(false);
  });

  it('el registro rechaza redirect_uris que no son strings', async () => {
    for (const redirect_uris of [[42], [null], [{}], [['https://x.example.com/cb']], 'https://x.example.com/cb', {}, 42]) {
      await expect(registerClient(db, { redirect_uris }), JSON.stringify(redirect_uris))
        .rejects.toMatchObject({ code: 'invalid_redirect_uri' });
    }
    await expect(registerClient(db, { redirect_uris: ['data:text/html,x'] })).rejects.toMatchObject({ code: 'invalid_redirect_uri' });
  });

  it('canje con la misma ruta loopback pero otro puerto → invalid_grant', async () => {
    const client = await registerClient(db, { redirect_uris: ['http://localhost/callback'] });
    const { verifier, challenge } = pkcePair();
    const code = await createAuthorizationCode(db, {
      clientId: client.clientId, userId, redirectUri: 'http://localhost:3118/callback', codeChallenge: challenge,
      scope: 'tasks', resource: RESOURCE,
    });
    await expect(exchangeAuthorizationCode(db, {
      code, clientId: client.clientId, redirectUri: 'http://localhost:4000/callback', codeVerifier: verifier,
    }, opts)).rejects.toMatchObject({ code: 'invalid_grant' });
  });
});

describe('códigos y refresh', () => {
  it('canje, refresh y reuso del código revoca también el token refrescado', async () => {
    const { client, code, verifier } = await issueTestCode(db, userId);
    const input = { code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: verifier };
    const first = await exchangeAuthorizationCode(db, input, opts);
    const next = await refreshAccessToken(db, { refreshToken: first.refresh_token, clientId: client.clientId }, opts);
    expect(await authenticateAccessToken(db, next.access_token, opts)).not.toBeNull();
    await expect(exchangeAuthorizationCode(db, input, opts)).rejects.toMatchObject({ code: 'invalid_grant' });
    expect(await authenticateAccessToken(db, next.access_token, opts)).toBeNull();
    await expect(refreshAccessToken(db, { refreshToken: next.refresh_token, clientId: client.clientId }, opts))
      .rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('refresh con un resource ajeno → invalid_target, sin gastar el token', async () => {
    const { client, tokens } = await issueTestTokens(db, userId);
    await expect(refreshAccessToken(db, {
      refreshToken: tokens.refresh_token, clientId: client.clientId, resource: 'https://otro.test/mcp',
    }, opts)).rejects.toMatchObject({ code: 'invalid_target' });
    await expect(refreshAccessToken(db, { refreshToken: tokens.refresh_token, clientId: client.clientId }, opts))
      .resolves.toBeDefined();
  });

  it('dos canjes simultáneos del mismo código: exactamente uno tiene éxito', async () => {
    const { client, code, verifier } = await issueTestCode(db, userId);
    const input = { code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: verifier };
    const results = await Promise.allSettled([
      exchangeAuthorizationCode(db, input, opts), exchangeAuthorizationCode(db, input, opts),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'invalid_grant' } });
  });

  it('revokeToken con basura, nac_ o ntk_ no hace nada ni falla', async () => {
    const { tokens } = await issueTestTokens(db, userId);
    const { token: personal } = await createApiToken(db, userId, 'x');
    const { code } = await issueTestCode(db, userId);
    for (const token of ['basura', 'nac_basura', code, 'ntk_basura', personal, 'x'.repeat(5000)]) {
      await expect(revokeToken(db, { token })).resolves.toBeUndefined();
    }
    expect(await authenticateAccessToken(db, tokens.access_token, opts)).not.toBeNull();
    expect(await authenticateBearer(db, personal, opts)).not.toBeNull();
  });
});

describe('authenticateBearer', () => {
  it('nat_ vencido o emitido para otro recurso → null', async () => {
    const now = new Date('2026-10-10T12:00:00Z');
    const { tokens } = await issueTestTokens(db, userId, now);
    expect(await authenticateBearer(db, tokens.access_token, { ...opts, now })).not.toBeNull();
    expect(await authenticateBearer(db, tokens.access_token, { ...opts, now: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS) }))
      .toBeNull();
    expect(await authenticateBearer(db, tokens.access_token, { resource: 'https://otro.test/mcp', now })).toBeNull();
  });

  it('token personal de un usuario borrado → null', async () => {
    const { token } = await createApiToken(db, userId, 'x');
    expect(await authenticateBearer(db, token, opts)).not.toBeNull();
    await db.delete(users).where(eq(users.id, userId));
    expect(await authenticateBearer(db, token, opts)).toBeNull();
  });
});
