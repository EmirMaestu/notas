import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lte } from 'drizzle-orm';
import { sessions } from '@/db/schema';
import type { DB } from '@/db/types';
import { getUser, type PublicUser } from './users';

export const SESSION_TTL_DAYS = 30;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Crea una sesión. El token solo se devuelve acá; en la base se guarda su hash. */
export async function createSession(
  db: DB, userId: string, now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  return { token, expiresAt };
}

export async function getSessionUser(db: DB, token: string, now: Date = new Date()): Promise<PublicUser | null> {
  if (!token) return null;
  const [row] = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)));
  return row ? getUser(db, row.userId) : null;
}

export async function deleteSession(db: DB, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** Borra todas las sesiones de un usuario (p. ej. al cambiar la contraseña). */
export async function deleteUserSessions(db: DB, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Borra sesiones vencidas de TODOS los usuarios. Solo para el job de mantenimiento. */
export async function purgeExpiredSessions(db: DB, now: Date = new Date()): Promise<number> {
  const deleted = await db.delete(sessions).where(lte(sessions.expiresAt, now)).returning({ id: sessions.id });
  return deleted.length;
}
