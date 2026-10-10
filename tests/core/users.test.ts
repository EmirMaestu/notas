import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { lists } from '@/db/schema';
import type { DB } from '@/db/types';
import { NotFoundError, ValidationError } from '@/core/errors';
import { createUser, getUser, updateUserTimezone, verifyCredentials } from '@/core/users';
import { createTestDb } from '../helpers/db';

let db: DB;
beforeEach(async () => {
  db = await createTestDb();
});

describe('createUser', () => {
  it('limita el nombre a 100 caracteres y exige texto', async () => {
    await expect(createUser(db, { email: 'n@x.com', password: '12345678', name: 'a'.repeat(101) })).rejects.toThrow(ValidationError);
    const ok = await createUser(db, { email: 'n@x.com', password: '12345678', name: ` ${'a'.repeat(100)} ` });
    expect(ok.name).toHaveLength(100);
    const bad = (v: unknown) => v as never;
    await expect(createUser(db, { email: bad(1), password: '12345678' })).rejects.toThrow(ValidationError);
    await expect(createUser(db, { email: 'm@x.com', password: bad(12345678) })).rejects.toThrow(ValidationError);
    await expect(createUser(db, { email: 'm@x.com', password: '12345678', name: bad(['x']) })).rejects.toThrow(ValidationError);
  });

  it('crea el usuario con su Bandeja y zona horaria por defecto', async () => {
    const user = await createUser(db, { email: '  Emir@Example.com ', password: 'contraseña-segura', name: 'Emir' });
    expect(user.email).toBe('emir@example.com');
    expect(user.timezone).toBe('America/Argentina/Buenos_Aires');
    expect('passwordHash' in user).toBe(false);
    const userLists = await db.select().from(lists).where(eq(lists.userId, user.id));
    expect(userLists).toHaveLength(1);
    expect(userLists[0]).toMatchObject({ name: 'Bandeja', isInbox: true });
  });

  it('rechaza email duplicado, inválido, contraseña corta y zona inválida', async () => {
    await createUser(db, { email: 'a@b.com', password: '12345678' });
    await expect(createUser(db, { email: 'A@B.com', password: '12345678' })).rejects.toThrow(ValidationError);
    await expect(createUser(db, { email: 'no-es-email', password: '12345678' })).rejects.toThrow('Email inválido');
    await expect(createUser(db, { email: 'c@d.com', password: '1234' })).rejects.toThrow(ValidationError);
    await expect(createUser(db, { email: 'e@f.com', password: '12345678', timezone: 'Marte/X' })).rejects.toThrow(ValidationError);
  });

  it('rechaza contraseñas de solo espacios y de más de 72 bytes', async () => {
    await expect(createUser(db, { email: 'a@b.com', password: '          ' })).rejects.toThrow(
      'La contraseña debe tener al menos 8 caracteres',
    );
    await expect(createUser(db, { email: 'a@b.com', password: 'a'.repeat(73) })).rejects.toThrow(
      'La contraseña no puede superar los 72 bytes',
    );
    // 40 caracteres de 2 bytes = 80 bytes
    await expect(createUser(db, { email: 'a@b.com', password: 'ñ'.repeat(40) })).rejects.toThrow(
      'La contraseña no puede superar los 72 bytes',
    );
    await expect(createUser(db, { email: 'a@b.com', password: 'a'.repeat(72) })).resolves.toBeDefined();
  });

  it('con creaciones concurrentes del mismo email falla una sola con ValidationError', async () => {
    const results = await Promise.allSettled([
      createUser(db, { email: 'a@b.com', password: '12345678' }),
      createUser(db, { email: 'a@b.com', password: '12345678' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ValidationError);
    expect(rejected[0].reason.message).toBe('Ya existe un usuario con ese email');
  });

  it('guarda la zona horaria en forma canónica', async () => {
    const user = await createUser(db, { email: 'a@b.com', password: '12345678', timezone: 'europe/madrid' });
    expect(user.timezone).toBe('Europe/Madrid');
  });
});

describe('verifyCredentials', () => {
  it('valida email y contraseña', async () => {
    const user = await createUser(db, { email: 'a@b.com', password: 'contraseña-segura' });
    expect((await verifyCredentials(db, 'A@b.com', 'contraseña-segura'))?.id).toBe(user.id);
    expect(await verifyCredentials(db, 'a@b.com', 'otra-cosa')).toBeNull();
    expect(await verifyCredentials(db, 'nadie@b.com', 'contraseña-segura')).toBeNull();
    expect('passwordHash' in (await verifyCredentials(db, 'a@b.com', 'contraseña-segura'))!).toBe(false);
  });
});

describe('getUser / updateUserTimezone', () => {
  it('obtiene y actualiza la zona horaria', async () => {
    const user = await createUser(db, { email: 'a@b.com', password: '12345678' });
    expect((await getUser(db, user.id)).email).toBe('a@b.com');
    expect('passwordHash' in (await getUser(db, user.id))).toBe(false);
    const updated = await updateUserTimezone(db, user.id, 'Europe/Madrid');
    expect(updated.timezone).toBe('Europe/Madrid');
    expect('passwordHash' in updated).toBe(false);
    expect((await updateUserTimezone(db, user.id, 'europe/madrid')).timezone).toBe('Europe/Madrid');
    await expect(updateUserTimezone(db, user.id, 'Marte/X')).rejects.toThrow(ValidationError);
  });

  it('lanza NotFoundError con id inexistente o mal formado', async () => {
    await expect(getUser(db, 'no-es-uuid')).rejects.toThrow(NotFoundError);
    await expect(getUser(db, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(NotFoundError);
  });
});
