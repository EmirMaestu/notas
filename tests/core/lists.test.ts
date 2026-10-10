import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { tasks } from '@/db/schema';
import type { DB } from '@/db/types';
import { NotFoundError, ValidationError } from '@/core/errors';
import {
  createFolder, createList, deleteFolder, deleteList, getInbox, getList, listFolders, listLists, renameFolder, updateList,
} from '@/core/lists';
import type { PublicUser as User } from '@/core/users';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
let user: User;
let other: User;
beforeEach(async () => {
  db = await createTestDb();
  user = await createTestUser(db);
  other = await createTestUser(db, 'otro@example.com');
});

describe('listas', () => {
  it('crea y lista con la Bandeja primero', async () => {
    await createList(db, user.id, { name: 'Trabajo', color: '#3366ff' });
    await createList(db, user.id, { name: '  Casa ' });
    const names = (await listLists(db, user.id)).map((l) => l.name);
    expect(names).toEqual(['Bandeja', 'Casa', 'Trabajo']);
    expect(await listLists(db, other.id)).toHaveLength(1);
  });

  it('valida nombre y color', async () => {
    await expect(createList(db, user.id, { name: '   ' })).rejects.toThrow(ValidationError);
    await expect(createList(db, user.id, { name: 'X', color: 'rojo' })).rejects.toThrow(ValidationError);
  });

  it('color vacío se guarda como null', async () => {
    expect((await createList(db, user.id, { name: 'X', color: '' })).color).toBeNull();
    const list = await createList(db, user.id, { name: 'Y', color: '#112233' });
    expect((await updateList(db, user.id, list.id, { color: '' })).color).toBeNull();
  });

  it('externalId duplicado es ValidationError', async () => {
    await createList(db, user.id, { name: 'A', externalId: 'ext-1' });
    const err = await createList(db, user.id, { name: 'B', externalId: 'ext-1' }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain('ext-1');
    // otro usuario puede reutilizarlo
    await expect(createList(db, other.id, { name: 'A', externalId: 'ext-1' })).resolves.toBeDefined();
  });

  it('sortOrder debe ser un entero int4', async () => {
    const list = await createList(db, user.id, { name: 'Z' });
    await expect(updateList(db, user.id, list.id, { sortOrder: 1.5 })).rejects.toThrow(ValidationError);
    await expect(updateList(db, user.id, list.id, { sortOrder: 2147483648 })).rejects.toThrow(ValidationError);
    await expect(updateList(db, user.id, list.id, { sortOrder: Number.NaN })).rejects.toThrow(ValidationError);
    expect((await updateList(db, user.id, list.id, { sortOrder: 3 })).sortOrder).toBe(3);
  });

  it('la Bandeja no se puede mover a una carpeta', async () => {
    const inbox = await getInbox(db, user.id);
    const folder = await createFolder(db, user.id, { name: 'F' });
    await expect(updateList(db, user.id, inbox.id, { folderId: folder.id })).rejects.toThrow(
      'La Bandeja no se puede mover a una carpeta',
    );
    await expect(updateList(db, user.id, inbox.id, { folderId: null })).resolves.toBeDefined();
  });

  it('updateList con carpeta de otro usuario es NotFoundError', async () => {
    const folder = await createFolder(db, other.id, { name: 'Ajena' });
    const list = await createList(db, user.id, { name: 'Mia' });
    await expect(updateList(db, user.id, list.id, { folderId: folder.id })).rejects.toThrow(NotFoundError);
  });

  it('deleteList de otro usuario es NotFoundError y no borra nada', async () => {
    const list = await createList(db, other.id, { name: 'Ajena' });
    await expect(deleteList(db, user.id, list.id)).rejects.toThrow(NotFoundError);
    await expect(deleteList(db, user.id, 'basura')).rejects.toThrow(NotFoundError);
    await expect(getList(db, other.id, list.id)).resolves.toBeDefined();
  });

  it('una tarea que ya estaba en la papelera sobrevive al borrar la lista', async () => {
    const list = await createList(db, user.id, { name: 'Temporal' });
    const earlier = new Date('2026-01-01T00:00:00Z');
    const [old] = await db.insert(tasks).values({ userId: user.id, listId: list.id, title: 'vieja', deletedAt: earlier }).returning();
    await db.insert(tasks).values({ userId: user.id, listId: list.id, title: 'viva' });
    expect(await deleteList(db, user.id, list.id)).toEqual({ movedToTrash: 1 });
    const inbox = await getInbox(db, user.id);
    const [row] = await db.select().from(tasks).where(eq(tasks.id, old.id));
    expect(row.listId).toBe(inbox.id);
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedAt!.getTime()).toBe(earlier.getTime());
  });

  it('no permite acceder a listas de otro usuario', async () => {
    const list = await createList(db, other.id, { name: 'Privada' });
    await expect(getList(db, user.id, list.id)).rejects.toThrow(NotFoundError);
    await expect(updateList(db, user.id, list.id, { name: 'Hack' })).rejects.toThrow(NotFoundError);
    await expect(getList(db, user.id, 'basura')).rejects.toThrow(NotFoundError);
  });

  it('actualiza nombre, color y carpeta', async () => {
    const folder = await createFolder(db, user.id, { name: 'Personal' });
    const list = await createList(db, user.id, { name: 'Casa' });
    const updated = await updateList(db, user.id, list.id, { name: 'Hogar', color: '#00aa00', folderId: folder.id });
    expect(updated).toMatchObject({ name: 'Hogar', color: '#00aa00', folderId: folder.id });
    expect((await updateList(db, user.id, list.id, { folderId: null })).folderId).toBeNull();
  });

  it('la Bandeja no se puede renombrar ni borrar', async () => {
    const inbox = await getInbox(db, user.id);
    await expect(updateList(db, user.id, inbox.id, { name: 'Otra' })).rejects.toThrow(ValidationError);
    await expect(deleteList(db, user.id, inbox.id)).rejects.toThrow(ValidationError);
  });

  it('borrar una lista manda sus tareas a la papelera dentro de la Bandeja', async () => {
    const list = await createList(db, user.id, { name: 'Temporal' });
    await db.insert(tasks).values([
      { userId: user.id, listId: list.id, title: 'a' },
      { userId: user.id, listId: list.id, title: 'b' },
    ]);
    expect(await deleteList(db, user.id, list.id)).toEqual({ movedToTrash: 2 });
    const inbox = await getInbox(db, user.id);
    const rows = await db.select().from(tasks).where(eq(tasks.userId, user.id));
    expect(rows.every((t) => t.listId === inbox.id && t.deletedAt !== null)).toBe(true);
    await expect(getList(db, user.id, list.id)).rejects.toThrow(NotFoundError);
  });
});

describe('carpetas', () => {
  it('crea, renombra, lista y borra (las listas quedan sin carpeta)', async () => {
    const folder = await createFolder(db, user.id, { name: 'Trabajo' });
    const list = await createList(db, user.id, { name: 'Clientes', folderId: folder.id });
    expect((await renameFolder(db, user.id, folder.id, 'Laburo')).name).toBe('Laburo');
    expect((await listFolders(db, user.id)).map((f) => f.name)).toEqual(['Laburo']);
    await deleteFolder(db, user.id, folder.id);
    expect(await listFolders(db, user.id)).toEqual([]);
    expect((await getList(db, user.id, list.id)).folderId).toBeNull();
  });

  it('externalId duplicado es ValidationError', async () => {
    await createFolder(db, user.id, { name: 'A', externalId: 'f-1' });
    const err = await createFolder(db, user.id, { name: 'B', externalId: 'f-1' }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain('f-1');
  });

  it('renombrar y borrar carpetas de otro usuario es NotFoundError', async () => {
    const folder = await createFolder(db, other.id, { name: 'Ajena' });
    await expect(renameFolder(db, user.id, folder.id, 'Mia')).rejects.toThrow(NotFoundError);
    await expect(deleteFolder(db, user.id, folder.id)).rejects.toThrow(NotFoundError);
    expect(await listFolders(db, other.id)).toHaveLength(1);
  });

  it('no permite usar carpetas de otro usuario', async () => {
    const folder = await createFolder(db, other.id, { name: 'Ajena' });
    await expect(createList(db, user.id, { name: 'X', folderId: folder.id })).rejects.toThrow(NotFoundError);
  });
});
