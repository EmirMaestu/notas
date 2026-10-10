import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  authenticateApiToken, createApiToken, listApiTokens, revokeApiToken,
} from '@/core/api-tokens';
import { NotFoundError, ValidationError } from '@/core/errors';
import { apiTokens } from '@/db/schema';
import type { DB } from '@/db/types';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
let userId: string;
let otherId: string;

beforeEach(async () => {
  db = await createTestDb();
  userId = (await createTestUser(db)).id;
  otherId = (await createTestUser(db, 'otra@example.com')).id;
});

describe('tokens personales', () => {
  it('crea un token ntk_ que se devuelve una sola vez y se guarda hasheado', async () => {
    const { token, summary } = await createApiToken(db, userId, '  Claude Desktop ');
    expect(token).toMatch(/^ntk_[A-Za-z0-9_-]{43}$/);
    expect(summary).toMatchObject({ name: 'Claude Desktop', prefix: token.slice(0, 12), lastUsedAt: null });
    expect(summary.createdAt).toBeInstanceOf(Date);
    const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, summary.id));
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.tokenHash).not.toContain(token.slice(4));
  });

  it('valida el nombre y permite como máximo 20 tokens activos', async () => {
    await expect(createApiToken(db, userId, '   ')).rejects.toBeInstanceOf(ValidationError);
    await expect(createApiToken(db, userId, 'x'.repeat(101))).rejects.toBeInstanceOf(ValidationError);
    await expect(createApiToken(db, userId, 5 as unknown as string)).rejects.toBeInstanceOf(ValidationError);
    for (let i = 0; i < 20; i++) await createApiToken(db, userId, `t${i}`);
    await expect(createApiToken(db, userId, 'uno más')).rejects.toThrow('como máximo 20');
    // Revocar libera lugar.
    const [first] = await listApiTokens(db, userId);
    await revokeApiToken(db, userId, first.id);
    await expect(createApiToken(db, userId, 'ahora sí')).resolves.toBeDefined();
  });

  it('creaciones simultáneas no superan el máximo de 20 tokens activos', async () => {
    const results = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => createApiToken(db, userId, `t${i}`)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(20);
    expect(await listApiTokens(db, userId)).toHaveLength(20);
  });

  it('lista solo los tokens activos del usuario', async () => {
    const a = await createApiToken(db, userId, 'A');
    await createApiToken(db, userId, 'B');
    await createApiToken(db, otherId, 'Ajeno');
    await revokeApiToken(db, userId, a.summary.id);
    const names = (await listApiTokens(db, userId)).map((t) => t.name);
    expect(names).toEqual(['B']);
  });

  it('autentica y actualiza last_used_at como mucho una vez por minuto', async () => {
    const { token, summary } = await createApiToken(db, userId, 'Cursor');
    const t0 = new Date('2026-10-10T12:00:00Z');
    expect(await authenticateApiToken(db, token, t0)).toEqual({ userId, tokenId: summary.id });
    const lastUsed = async () => (await listApiTokens(db, userId))[0].lastUsedAt?.toISOString();
    expect(await lastUsed()).toBe(t0.toISOString());
    await authenticateApiToken(db, token, new Date(t0.getTime() + 30_000));
    expect(await lastUsed()).toBe(t0.toISOString());
    const t2 = new Date(t0.getTime() + 61_000);
    await authenticateApiToken(db, token, t2);
    expect(await lastUsed()).toBe(t2.toISOString());
  });

  it('revocar invalida el token; no se puede revocar el de otro ni dos veces', async () => {
    const { token, summary } = await createApiToken(db, userId, 'n8n');
    await expect(revokeApiToken(db, otherId, summary.id)).rejects.toBeInstanceOf(NotFoundError);
    await revokeApiToken(db, userId, summary.id);
    expect(await authenticateApiToken(db, token)).toBeNull();
    await expect(revokeApiToken(db, userId, summary.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(revokeApiToken(db, userId, 'no-es-uuid')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rechaza tokens desconocidos o con otro prefijo', async () => {
    const { token } = await createApiToken(db, userId, 'x');
    expect(await authenticateApiToken(db, `${token}x`)).toBeNull();
    expect(await authenticateApiToken(db, token.replace('ntk_', 'nat_'))).toBeNull();
    expect(await authenticateApiToken(db, '')).toBeNull();
  });
});
