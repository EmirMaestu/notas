import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { apiTokens, oauthClients, oauthCodes, oauthTokens, users } from '@/db/schema';
import { createTestDb, createTestUser } from '../helpers/db';

const later = () => new Date(Date.now() + 60_000);

async function seed() {
  const db = await createTestDb();
  const user = await createTestUser(db);
  await db.insert(oauthClients).values({ clientId: 'ncl_a', clientName: 'Cliente', redirectUris: ['https://app.example.com/cb'] });
  await db.insert(apiTokens).values({ userId: user.id, name: 'Claude', tokenHash: 'h1', prefix: 'ntk_abcdefgh' });
  await db.insert(oauthCodes).values({
    codeHash: 'c1', clientId: 'ncl_a', userId: user.id, redirectUri: 'https://app.example.com/cb',
    codeChallenge: 'x', scope: 'tasks', resource: 'https://notas.test/mcp', expiresAt: later(),
  });
  await db.insert(oauthTokens).values({
    familyId: randomUUID(), accessTokenHash: 'a1', refreshTokenHash: 'r1', clientId: 'ncl_a', userId: user.id,
    scope: 'tasks', resource: 'https://notas.test/mcp', accessExpiresAt: later(), refreshExpiresAt: later(),
  });
  return { db, user };
}

describe('tablas de tokens y OAuth', () => {
  it('guardan redirect_uris como lista y los hashes son únicos', async () => {
    const { db, user } = await seed();
    const [client] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, 'ncl_a'));
    expect(client.redirectUris).toEqual(['https://app.example.com/cb']);
    await expect(
      db.insert(apiTokens).values({ userId: user.id, name: 'Otro', tokenHash: 'h1', prefix: 'ntk_x' }),
    ).rejects.toThrow();
    await expect(db.insert(oauthTokens).values({
      familyId: randomUUID(), accessTokenHash: 'a1', refreshTokenHash: 'r2', clientId: 'ncl_a', userId: user.id,
      scope: 'tasks', resource: 'r', accessExpiresAt: later(), refreshExpiresAt: later(),
    })).rejects.toThrow();
  });

  it('al borrar el usuario se van sus tokens, códigos y tokens OAuth', async () => {
    const { db, user } = await seed();
    await db.delete(users).where(eq(users.id, user.id));
    expect(await db.select().from(apiTokens)).toEqual([]);
    expect(await db.select().from(oauthCodes)).toEqual([]);
    expect(await db.select().from(oauthTokens)).toEqual([]);
    expect(await db.select().from(oauthClients)).toHaveLength(1);
  });

  it('al borrar el cliente se van sus códigos y tokens', async () => {
    const { db } = await seed();
    await db.delete(oauthClients).where(eq(oauthClients.clientId, 'ncl_a'));
    expect(await db.select().from(oauthCodes)).toEqual([]);
    expect(await db.select().from(oauthTokens)).toEqual([]);
    expect(await db.select().from(apiTokens)).toHaveLength(1);
  });
});
