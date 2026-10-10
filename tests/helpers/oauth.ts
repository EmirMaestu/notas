import { createHash, randomBytes } from 'node:crypto';
import { createAuthorizationCode, exchangeAuthorizationCode, registerClient } from '@/core/oauth';
import type { DB } from '@/db/types';

/** Recurso MCP de los tests (coincide con APP_URL=https://notas.test). */
export const RESOURCE = 'https://notas.test/mcp';
export const REDIRECT = 'https://cliente.example.com/callback';

/** Par PKCE S256 nuevo. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export async function createTestClient(db: DB, redirectUris: string[] = [REDIRECT], now: Date = new Date()) {
  return registerClient(db, { client_name: 'Cliente de prueba', redirect_uris: redirectUris }, now);
}

/** Cliente nuevo + código de autorización emitido para `userId`, listo para canjear. */
export async function issueTestCode(db: DB, userId: string, now: Date = new Date()) {
  const client = await createTestClient(db, [REDIRECT], now);
  const { verifier, challenge } = pkcePair();
  const code = await createAuthorizationCode(db, {
    clientId: client.clientId, userId, redirectUri: REDIRECT, codeChallenge: challenge, scope: 'tasks', resource: RESOURCE,
  }, now);
  return { client, code, verifier };
}

/** Flujo completo: cliente + código + canje. Devuelve el cliente y los tokens. */
export async function issueTestTokens(db: DB, userId: string, now: Date = new Date()) {
  const { client, code, verifier } = await issueTestCode(db, userId, now);
  const tokens = await exchangeAuthorizationCode(
    db, { code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: verifier }, { resource: RESOURCE, now },
  );
  return { client, tokens };
}
