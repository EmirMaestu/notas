import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { apiTokens } from '@/db/schema';
import type { DB } from '@/db/types';
import { NotFoundError, ValidationError, isUuid } from './errors';
import { generateSecret, sha256Hex } from './secrets';

export const PERSONAL_TOKEN_PREFIX = 'ntk_';
const MAX_ACTIVE_TOKENS = 20;
/** "ntk_" + 8 caracteres: alcanza para reconocer el token en la UI sin servir para usarlo. */
const DISPLAY_PREFIX_LENGTH = 12;
/** last_used_at se escribe como mucho una vez por minuto por token. */
const TOUCH_INTERVAL_MS = 60_000;

/** Lo que se muestra de un token (nunca el token ni su hash). */
export interface ApiTokenSummary {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

const summaryColumns = {
  id: apiTokens.id,
  name: apiTokens.name,
  prefix: apiTokens.prefix,
  createdAt: apiTokens.createdAt,
  lastUsedAt: apiTokens.lastUsedAt,
};

function cleanTokenName(name: unknown): string {
  if (typeof name !== 'string') throw new ValidationError('El nombre debe ser texto');
  const clean = name.trim();
  if (!clean) throw new ValidationError('Poné un nombre para reconocer el token (p. ej. "Cursor")');
  if (clean.length > 100) throw new ValidationError('El nombre no puede superar los 100 caracteres');
  return clean;
}

/** Crea un token personal. El token en claro solo se devuelve acá; en la base queda su hash. */
export async function createApiToken(
  db: DB, userId: string, name: string,
): Promise<{ token: string; summary: ApiTokenSummary }> {
  const clean = cleanTokenName(name);
  const token = generateSecret(PERSONAL_TOKEN_PREFIX);
  // Se bloquea la fila del usuario antes de contar: dos creaciones simultáneas se serializan y no pasan del máximo.
  const summary = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from users where id = ${userId} for update`);
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(apiTokens)
      .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)));
    if (Number(count) >= MAX_ACTIVE_TOKENS) {
      throw new ValidationError(`Podés tener como máximo ${MAX_ACTIVE_TOKENS} tokens activos: revocá alguno`);
    }
    const [row] = await tx
      .insert(apiTokens)
      .values({ userId, name: clean, tokenHash: sha256Hex(token), prefix: token.slice(0, DISPLAY_PREFIX_LENGTH) })
      .returning(summaryColumns);
    return row;
  });
  return { token, summary };
}

/** Tokens activos del usuario, los más nuevos primero. */
export async function listApiTokens(db: DB, userId: string): Promise<ApiTokenSummary[]> {
  return db
    .select(summaryColumns)
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt), desc(apiTokens.id));
}

/** Revoca un token activo del usuario; NotFoundError si no existe, es de otro o ya estaba revocado. */
export async function revokeApiToken(db: DB, userId: string, tokenId: string): Promise<void> {
  if (!isUuid(tokenId)) throw new NotFoundError('El token');
  const revoked = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  if (revoked.length === 0) throw new NotFoundError('El token');
}

/** Usuario dueño de un token personal activo, o null. */
export async function authenticateApiToken(
  db: DB, token: string, now: Date = new Date(),
): Promise<{ userId: string; tokenId: string } | null> {
  if (!token.startsWith(PERSONAL_TOKEN_PREFIX)) return null;
  const [row] = await db
    .select({ id: apiTokens.id, userId: apiTokens.userId })
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, sha256Hex(token)), isNull(apiTokens.revokedAt)));
  if (!row) return null;
  await db
    .update(apiTokens)
    .set({ lastUsedAt: now })
    .where(and(
      eq(apiTokens.id, row.id),
      or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, new Date(now.getTime() - TOUCH_INTERVAL_MS))),
    ));
  return { userId: row.userId, tokenId: row.id };
}
