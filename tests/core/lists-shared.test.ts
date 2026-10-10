import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { listMembers, tasks } from '@/db/schema';
import { getAccessibleList } from '@/core/access';
import type { DB } from '@/db/types';
import { NotFoundError, ValidationError } from '@/core/errors';
import { createFolder, createList, deleteList, getInbox, getList, listLists, updateList, type List } from '@/core/lists';
import type { PublicUser as User } from '@/core/users';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
let owner: User;
let member: User;
let stranger: User;
let shared: List;

beforeEach(async () => {
  db = await createTestDb();
  owner = await createTestUser(db, 'duenio@example.com');
  member = await createTestUser(db, 'miembro@example.com');
  stranger = await createTestUser(db, 'ajeno@example.com');
  const folder = await createFolder(db, owner.id, { name: 'Casa' });
  shared = await createList(db, owner.id, { name: 'Súper', folderId: folder.id });
  await createList(db, owner.id, { name: 'Privada' });
  await db.insert(listMembers).values({ listId: shared.id, userId: member.id });
});

describe('listLists con listas compartidas', () => {
  it('el dueño ve sus listas con rol owner y cuáles están compartidas', async () => {
    const rows = await listLists(db, owner.id);
    expect(rows.map((l) => [l.name, l.role, l.shared])).toEqual([
      ['Bandeja', 'owner', false], ['Privada', 'owner', false], ['Súper', 'owner', true],
    ]);
    expect(rows[2].folderId).toBe(shared.folderId);
  });

  it('el miembro ve la compartida después de las suyas, con rol member y sin carpeta', async () => {
    await createList(db, member.id, { name: 'Zeta' });
    const rows = await listLists(db, member.id);
    expect(rows.map((l) => [l.name, l.role, l.shared])).toEqual([
      ['Bandeja', 'owner', false], ['Zeta', 'owner', false], ['Súper', 'member', true],
    ]);
    expect(rows[2].folderId).toBeNull();
  });

  it('un ajeno no ve la lista', async () => {
    expect((await listLists(db, stranger.id)).map((l) => l.name)).toEqual(['Bandeja']);
  });
});

describe('getList', () => {
  it('el miembro accede con rol member; el ajeno no', async () => {
    expect(await getList(db, member.id, shared.id)).toMatchObject({ id: shared.id, role: 'member', shared: true, folderId: null });
    expect(await getList(db, owner.id, shared.id)).toMatchObject({ role: 'owner', shared: true, folderId: shared.folderId });
    await expect(getList(db, stranger.id, shared.id)).rejects.toThrow(NotFoundError);
  });
});

describe('getAccessibleList', () => {
  it('no expone la carpeta del dueño a los miembros', async () => {
    expect(shared.folderId).not.toBeNull();
    expect(await getAccessibleList(db, member.id, shared.id)).toMatchObject({ role: 'member', list: { id: shared.id, folderId: null } });
    expect(await getAccessibleList(db, owner.id, shared.id)).toMatchObject({ role: 'owner', list: { folderId: shared.folderId } });
  });
});

describe('solo el dueño administra la lista', () => {
  it('un miembro no puede cambiar color, carpeta ni orden', async () => {
    for (const input of [{ color: '#ff0000' }, { folderId: shared.folderId }, { folderId: null }, { sortOrder: 5 }]) {
      const err = await updateList(db, member.id, shared.id, input).catch((e) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.message).toBe('Solo el dueño de la lista puede modificarla');
    }
    expect(await getList(db, owner.id, shared.id)).toMatchObject({ color: null, folderId: shared.folderId, sortOrder: 0 });
  });

  it('al borrarla, limpia la asignación de una tarea que ya estaba en la papelera y actualiza updatedAt', async () => {
    const old = new Date('2020-01-01T00:00:00Z');
    const [t] = await db
      .insert(tasks)
      .values({ userId: owner.id, listId: shared.id, title: 'vieja', assigneeId: member.id, deletedAt: old, updatedAt: old })
      .returning();
    expect(await deleteList(db, owner.id, shared.id)).toEqual({ movedToTrash: 0 });
    const [row] = await db.select().from(tasks).where(eq(tasks.id, t.id));
    expect(row.assigneeId).toBeNull();
    expect(row.updatedAt.getTime()).toBeGreaterThan(old.getTime());
    expect(row.deletedAt).toEqual(old);
  });

  it('un miembro no puede modificarla', async () => {
    const err = await updateList(db, member.id, shared.id, { name: 'Hack' }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe('Solo el dueño de la lista puede modificarla');
    expect((await getList(db, owner.id, shared.id)).name).toBe('Súper');
  });

  it('un miembro no puede borrarla', async () => {
    const err = await deleteList(db, member.id, shared.id).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe('Solo el dueño de la lista puede borrarla');
    await expect(getList(db, owner.id, shared.id)).resolves.toBeDefined();
  });

  it('un ajeno recibe NotFoundError', async () => {
    await expect(updateList(db, stranger.id, shared.id, { name: 'Hack' })).rejects.toThrow(NotFoundError);
    await expect(deleteList(db, stranger.id, shared.id)).rejects.toThrow(NotFoundError);
  });

  it('al borrarla, todas sus tareas van a la papelera de la Bandeja del dueño y los miembros pierden acceso', async () => {
    await db.insert(tasks).values([
      { userId: owner.id, listId: shared.id, title: 'del dueño', assigneeId: owner.id },
      { userId: member.id, listId: shared.id, title: 'del miembro', assigneeId: member.id },
    ]);
    expect(await deleteList(db, owner.id, shared.id)).toEqual({ movedToTrash: 2 });
    const inbox = await getInbox(db, owner.id);
    const rows = await db.select().from(tasks);
    expect(rows.every((t) => t.listId === inbox.id && t.deletedAt !== null)).toBe(true);
    expect(rows.find((t) => t.title === 'del dueño')!.assigneeId).toBe(owner.id);
    expect(rows.find((t) => t.title === 'del miembro')!.assigneeId).toBeNull();
    await expect(getList(db, member.id, shared.id)).rejects.toThrow(NotFoundError);
    expect(await db.select().from(listMembers).where(eq(listMembers.listId, shared.id))).toEqual([]);
  });
});
