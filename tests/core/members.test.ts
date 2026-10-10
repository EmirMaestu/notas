import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { listMembers, tasks, users } from '@/db/schema';
import type { DB } from '@/db/types';
import { canAccessList } from '@/core/access';
import { NotFoundError, ValidationError } from '@/core/errors';
import { createList, getInbox, type List } from '@/core/lists';
import { addListMember, getListMembers, leaveList, removeListMember } from '@/core/members';
import type { PublicUser as User } from '@/core/users';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
let owner: User;
let member: User;
let stranger: User;
let shared: List;
let other: List;

beforeEach(async () => {
  db = await createTestDb();
  owner = await createTestUser(db, 'duenio@example.com');
  member = await createTestUser(db, 'miembro@example.com');
  stranger = await createTestUser(db, 'ajeno@example.com');
  shared = await createList(db, owner.id, { name: 'Compartida' });
  other = await createList(db, owner.id, { name: 'Otra' });
});

/** El error con que se rechaza la promesa (o null si se resuelve). */
const errorOf = (p: Promise<unknown>) => p.then(() => null, (e) => e);

describe('addListMember', () => {
  it('agrega por email (sin importar mayúsculas ni espacios) y devuelve el miembro', async () => {
    const added = await addListMember(db, owner.id, shared.id, '  MIEMBRO@Example.com ');
    expect(added).toEqual({ id: member.id, email: 'miembro@example.com', name: 'Emir', role: 'member' });
    expect(await canAccessList(db, member.id, shared.id)).toBe(true);
  });

  it('rechaza emails sin cuenta, al propio dueño, duplicados, vacíos y la Bandeja', async () => {
    expect((await errorOf(addListMember(db, owner.id, shared.id, 'nadie@example.com'))).message)
      .toBe('No hay ninguna cuenta con ese email');
    expect((await errorOf(addListMember(db, owner.id, shared.id, 'duenio@example.com'))).message)
      .toBe('Ya sos el dueño de esta lista');
    await addListMember(db, owner.id, shared.id, member.email);
    expect((await errorOf(addListMember(db, owner.id, shared.id, member.email))).message)
      .toBe('Esa persona ya es miembro de la lista');
    const inbox = await getInbox(db, owner.id);
    expect((await errorOf(addListMember(db, owner.id, inbox.id, member.email))).message)
      .toBe('La Bandeja no se puede compartir');
    expect(await errorOf(addListMember(db, owner.id, shared.id, '  '))).toBeInstanceOf(ValidationError);
  });

  it('un miembro recibe el error de permiso aunque el email no exista (el permiso se revisa primero)', async () => {
    await addListMember(db, owner.id, shared.id, member.email);
    const err = await errorOf(addListMember(db, member.id, shared.id, 'nadie@example.com'));
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe('Solo el dueño de la lista puede administrar sus miembros');
  });

  it('un miembro no puede agregar (ValidationError) y un ajeno no ve la lista (NotFoundError)', async () => {
    await addListMember(db, owner.id, shared.id, member.email);
    const err = await errorOf(addListMember(db, member.id, shared.id, stranger.email));
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe('Solo el dueño de la lista puede administrar sus miembros');
    expect(await errorOf(addListMember(db, stranger.id, shared.id, stranger.email))).toBeInstanceOf(NotFoundError);
    expect(await canAccessList(db, stranger.id, shared.id)).toBe(false);
  });
});

describe('límite de miembros', () => {
  it('una lista admite como máximo 50 miembros', async () => {
    const rows = await db
      .insert(users)
      .values(Array.from({ length: 50 }, (_, i) => ({ email: `m${i}@example.com`, passwordHash: 'x' })))
      .returning({ id: users.id });
    await db.insert(listMembers).values(rows.slice(0, 49).map((u) => ({ listId: shared.id, userId: u.id })));
    await addListMember(db, owner.id, shared.id, 'm49@example.com'); // el miembro 50
    const err = await errorOf(addListMember(db, owner.id, shared.id, member.email));
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe('Una lista puede tener como máximo 50 miembros');
    expect(await db.select().from(listMembers).where(eq(listMembers.listId, shared.id))).toHaveLength(50);
  });
});

describe('getListMembers', () => {
  it('dueño primero y después los miembros por orden de alta; lo ven el dueño y los miembros', async () => {
    const third = await createTestUser(db, 'tercero@example.com');
    await addListMember(db, owner.id, shared.id, member.email);
    await addListMember(db, owner.id, shared.id, third.email);
    const expected = [
      { id: owner.id, email: 'duenio@example.com', name: 'Emir', role: 'owner' },
      { id: member.id, email: 'miembro@example.com', name: 'Emir', role: 'member' },
      { id: third.id, email: 'tercero@example.com', name: 'Emir', role: 'member' },
    ];
    expect(await getListMembers(db, owner.id, shared.id)).toEqual(expected);
    expect(await getListMembers(db, member.id, shared.id)).toEqual(expected);
    await expect(getListMembers(db, stranger.id, shared.id)).rejects.toThrow(NotFoundError);
  });

  it('una lista sin miembros devuelve solo al dueño', async () => {
    expect((await getListMembers(db, owner.id, other.id)).map((m) => m.role)).toEqual(['owner']);
  });
});

describe('removeListMember', () => {
  it('quita el acceso y limpia solo sus asignaciones en esa lista', async () => {
    await addListMember(db, owner.id, shared.id, member.email);
    await addListMember(db, owner.id, other.id, member.email);
    const [inShared, inOther, ownerTask] = await db
      .insert(tasks)
      .values([
        { userId: owner.id, listId: shared.id, title: 'a', assigneeId: member.id },
        { userId: owner.id, listId: other.id, title: 'b', assigneeId: member.id },
        { userId: owner.id, listId: shared.id, title: 'c', assigneeId: owner.id },
      ])
      .returning();
    await removeListMember(db, owner.id, shared.id, member.id);
    expect(await canAccessList(db, member.id, shared.id)).toBe(false);
    const assigneeOf = async (id: string) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0].assigneeId;
    expect(await assigneeOf(inShared.id)).toBeNull();
    expect(await assigneeOf(inOther.id)).toBe(member.id);
    expect(await assigneeOf(ownerTask.id)).toBe(owner.id);
  });

  it('solo el dueño quita miembros; quitar a quien no es miembro es NotFoundError', async () => {
    await addListMember(db, owner.id, shared.id, member.email);
    expect(await errorOf(removeListMember(db, member.id, shared.id, member.id))).toBeInstanceOf(ValidationError);
    expect(await errorOf(removeListMember(db, stranger.id, shared.id, member.id))).toBeInstanceOf(NotFoundError);
    expect(await errorOf(removeListMember(db, owner.id, shared.id, stranger.id))).toBeInstanceOf(NotFoundError);
    expect(await errorOf(removeListMember(db, owner.id, shared.id, owner.id))).toBeInstanceOf(NotFoundError);
    expect(await errorOf(removeListMember(db, owner.id, shared.id, 'basura'))).toBeInstanceOf(NotFoundError);
    expect(await canAccessList(db, member.id, shared.id)).toBe(true);
  });
});

describe('leaveList', () => {
  it('el miembro sale, pierde el acceso y se limpian sus asignaciones', async () => {
    await addListMember(db, owner.id, shared.id, member.email);
    const [t] = await db
      .insert(tasks)
      .values({ userId: owner.id, listId: shared.id, title: 'a', assigneeId: member.id })
      .returning();
    await leaveList(db, member.id, shared.id);
    expect(await canAccessList(db, member.id, shared.id)).toBe(false);
    expect((await db.select().from(tasks).where(eq(tasks.id, t.id)))[0].assigneeId).toBeNull();
    expect(await errorOf(leaveList(db, member.id, shared.id))).toBeInstanceOf(NotFoundError);
  });

  it('el dueño no puede salir y un ajeno recibe NotFoundError', async () => {
    const err = await errorOf(leaveList(db, owner.id, shared.id));
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe('El dueño no puede salir de su propia lista');
    expect(await errorOf(leaveList(db, stranger.id, shared.id))).toBeInstanceOf(NotFoundError);
  });
});
