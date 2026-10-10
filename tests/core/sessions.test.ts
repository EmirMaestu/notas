import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '@/db/types';
import { createSession, deleteSession, deleteUserSessions, getSessionUser, purgeExpiredSessions } from '@/core/sessions';
import type { PublicUser } from '@/core/users';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
let user: PublicUser;
beforeEach(async () => {
  db = await createTestDb();
  user = await createTestUser(db);
});

describe('sesiones', () => {
  it('crea una sesión y devuelve el usuario sin hash de contraseña', async () => {
    const { token, expiresAt } = await createSession(db, user.id);
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 864e5);
    const found = await getSessionUser(db, token);
    expect(found?.id).toBe(user.id);
    expect(found && 'passwordHash' in found).toBe(false);
  });

  it('token desconocido, vacío o vencido → null', async () => {
    expect(await getSessionUser(db, 'no-existe')).toBeNull();
    expect(await getSessionUser(db, '')).toBeNull();
    const { token } = await createSession(db, user.id, new Date('2020-01-01T00:00:00Z'));
    expect(await getSessionUser(db, token)).toBeNull();
  });

  it('borrar la sesión la invalida', async () => {
    const { token } = await createSession(db, user.id);
    await deleteSession(db, token);
    expect(await getSessionUser(db, token)).toBeNull();
  });

  it('deleteUserSessions borra todas las sesiones del usuario y no toca las de otros', async () => {
    const other = await createTestUser(db, 'otra@example.com');
    const a = await createSession(db, user.id);
    const b = await createSession(db, user.id);
    const c = await createSession(db, other.id);
    await deleteUserSessions(db, user.id);
    expect(await getSessionUser(db, a.token)).toBeNull();
    expect(await getSessionUser(db, b.token)).toBeNull();
    expect((await getSessionUser(db, c.token))?.id).toBe(other.id);
  });

  it('purgeExpiredSessions borra solo las vencidas', async () => {
    await createSession(db, user.id, new Date('2020-01-01T00:00:00Z'));
    const { token } = await createSession(db, user.id);
    expect(await purgeExpiredSessions(db)).toBe(1);
    expect(await getSessionUser(db, token)).not.toBeNull();
  });
});
