import { beforeEach, describe, expect, it } from 'vitest';
import { createApiToken, revokeApiToken } from '@/core/api-tokens';
import { authenticateBearer } from '@/core/bearer';
import { revokeToken } from '@/core/oauth';
import type { DB } from '@/db/types';
import { createTestDb, createTestUser } from '../helpers/db';
import { RESOURCE, issueTestTokens } from '../helpers/oauth';

let db: DB;
let userId: string;

beforeEach(async () => {
  db = await createTestDb();
  userId = (await createTestUser(db)).id;
});

const bearer = (token: string) => authenticateBearer(db, token, { resource: RESOURCE });

describe('authenticateBearer', () => {
  it('token personal → via personal', async () => {
    const { token, summary } = await createApiToken(db, userId, 'Cursor');
    expect(await bearer(token)).toEqual({ userId, via: 'personal', tokenId: summary.id });
    await revokeApiToken(db, userId, summary.id);
    expect(await bearer(token)).toBeNull();
  });

  it('access token OAuth → via oauth con el cliente', async () => {
    const { client, tokens } = await issueTestTokens(db, userId);
    expect(await bearer(tokens.access_token)).toEqual({ userId, via: 'oauth', clientId: client.clientId });
    await revokeToken(db, { token: tokens.access_token });
    expect(await bearer(tokens.access_token)).toBeNull();
  });

  it('refresh token, otro prefijo, vacío o demasiado largo → null', async () => {
    const { tokens } = await issueTestTokens(db, userId);
    expect(await bearer(tokens.refresh_token)).toBeNull();
    expect(await bearer('Bearer algo')).toBeNull();
    expect(await bearer('')).toBeNull();
    expect(await bearer(`ntk_${'a'.repeat(300)}`)).toBeNull();
  });
});
