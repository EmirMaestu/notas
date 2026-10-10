import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { folders, listMembers, lists, tasks, users } from '@/db/schema';
import type { DB } from '@/db/types';
import { getAccessibleList, lockList, requireListOwner, type ListRole } from './access';
import { NotFoundError, ValidationError, isUniqueViolation, isUuid } from './errors';
import { checkColor } from './validation';

export type List = typeof lists.$inferSelect;
export type Folder = typeof folders.$inferSelect;
/** Lista vista por un usuario: su rol y si está compartida (tiene al menos un miembro). */
export type ListWithRole = List & { role: ListRole; shared: boolean };

const INT4_MAX = 2147483647;

function cleanName(name: string): string {
  const clean = name.trim();
  if (!clean) throw new ValidationError('El nombre no puede estar vacío');
  if (clean.length > 100) throw new ValidationError('El nombre no puede superar los 100 caracteres');
  return clean;
}

// ---------- Carpetas ----------

export async function listFolders(db: DB, userId: string): Promise<Folder[]> {
  return db.select().from(folders).where(eq(folders.userId, userId)).orderBy(asc(folders.sortOrder), asc(folders.name));
}

export async function getFolder(db: DB, userId: string, folderId: string): Promise<Folder> {
  if (!isUuid(folderId)) throw new NotFoundError('La carpeta');
  const [folder] = await db.select().from(folders).where(and(eq(folders.id, folderId), eq(folders.userId, userId)));
  if (!folder) throw new NotFoundError('La carpeta');
  return folder;
}

/** Busca una carpeta por el id que tenía en el sistema de origen (importación idempotente). */
export async function getFolderByExternalId(db: DB, userId: string, externalId: string): Promise<Folder | null> {
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.userId, userId), eq(folders.externalId, externalId)));
  return folder ?? null;
}

export async function createFolder(db: DB, userId: string, input: { name: string; externalId?: string }): Promise<Folder> {
  const name = cleanName(input.name);
  try {
    const [folder] = await db
      .insert(folders)
      .values({ userId, name, externalId: input.externalId ?? null })
      .returning();
    return folder;
  } catch (err) {
    if (isUniqueViolation(err)) throw new ValidationError(`Ya existe una carpeta con el id externo "${input.externalId}"`);
    throw err;
  }
}

export async function renameFolder(db: DB, userId: string, folderId: string, name: string): Promise<Folder> {
  const folder = await getFolder(db, userId, folderId);
  const [updated] = await db.update(folders).set({ name: cleanName(name) }).where(eq(folders.id, folder.id)).returning();
  return updated;
}

/** Borra la carpeta; sus listas quedan sueltas (no se borran). */
export async function deleteFolder(db: DB, userId: string, folderId: string): Promise<void> {
  const folder = await getFolder(db, userId, folderId);
  await db.delete(folders).where(eq(folders.id, folder.id));
}

// ---------- Listas ----------

export async function getInbox(db: DB, userId: string): Promise<List> {
  const [inbox] = await db.select().from(lists).where(and(eq(lists.userId, userId), eq(lists.isInbox, true)));
  if (!inbox) throw new NotFoundError('La Bandeja');
  return inbox;
}

const sharedExpr = sql<boolean>`exists (select 1 from ${listMembers} where ${listMembers.listId} = ${lists.id})`;

async function isShared(db: DB, listId: string): Promise<boolean> {
  const [row] = await db
    .select({ listId: listMembers.listId })
    .from(listMembers)
    .where(eq(listMembers.listId, listId))
    .limit(1);
  return row !== undefined;
}

/** Para un miembro la carpeta es del dueño: la lista se ve suelta. */
function asSeenBy(list: List, role: ListRole, shared: boolean): ListWithRole {
  return { ...list, folderId: role === 'owner' ? list.folderId : null, role, shared };
}

/** Listas propias (Bandeja primero) y, después, las compartidas con el usuario ordenadas por nombre. */
export async function listLists(db: DB, userId: string): Promise<ListWithRole[]> {
  const own = await db
    .select({ list: lists, shared: sharedExpr })
    .from(lists)
    .where(eq(lists.userId, userId))
    .orderBy(desc(lists.isInbox), asc(lists.sortOrder), asc(lists.name));
  const sharedWithMe = await db
    .select({ list: lists })
    .from(lists)
    .innerJoin(listMembers, eq(listMembers.listId, lists.id))
    .where(eq(listMembers.userId, userId))
    .orderBy(asc(lists.name), asc(lists.id));
  return [
    ...own.map((r) => asSeenBy(r.list, 'owner', Boolean(r.shared))),
    ...sharedWithMe.map((r) => asSeenBy(r.list, 'member', true)),
  ];
}

/** Datos mínimos del dueño de una lista. */
export interface ListOwner {
  id: string;
  name: string;
  email: string;
}

/** Dueño de cada lista compartida con el usuario (id de lista → dueño), para su avatar en la barra lateral. */
export async function sharedListOwners(db: DB, userId: string): Promise<Record<string, ListOwner>> {
  const rows = await db
    .select({ listId: lists.id, id: users.id, name: users.name, email: users.email })
    .from(listMembers)
    .innerJoin(lists, eq(lists.id, listMembers.listId))
    .innerJoin(users, eq(users.id, lists.userId))
    .where(eq(listMembers.userId, userId));
  return Object.fromEntries(rows.map(({ listId, ...owner }) => [listId, owner]));
}

/** Lista a la que el usuario accede (propia o compartida con él); NotFoundError si no. */
export async function getList(db: DB, userId: string, listId: string): Promise<ListWithRole> {
  const { list, role } = await getAccessibleList(db, userId, listId);
  return asSeenBy(list, role, role === 'member' || (await isShared(db, list.id)));
}

/** Busca una lista por el id que tenía en el sistema de origen (importación idempotente). */
export async function getListByExternalId(db: DB, userId: string, externalId: string): Promise<List | null> {
  const [list] = await db.select().from(lists).where(and(eq(lists.userId, userId), eq(lists.externalId, externalId)));
  return list ?? null;
}

export interface CreateListInput {
  name: string;
  color?: string | null;
  folderId?: string | null;
  externalId?: string;
}

export async function createList(db: DB, userId: string, input: CreateListInput): Promise<List> {
  const name = cleanName(input.name);
  const color = checkColor(input.color) ?? null;
  const folderId = input.folderId ? (await getFolder(db, userId, input.folderId)).id : null;
  try {
    const [list] = await db
      .insert(lists)
      .values({ userId, name, color, folderId, externalId: input.externalId ?? null })
      .returning();
    return list;
  } catch (err) {
    if (isUniqueViolation(err)) throw new ValidationError(`Ya existe una lista con el id externo "${input.externalId}"`);
    throw err;
  }
}

export interface UpdateListInput {
  name?: string;
  color?: string | null;
  folderId?: string | null;
  sortOrder?: number;
}

export async function updateList(db: DB, userId: string, listId: string, input: UpdateListInput): Promise<List> {
  const list = await requireListOwner(db, userId, listId, 'modificarla');
  const patch: Partial<typeof lists.$inferInsert> = {};
  if (input.name !== undefined) {
    if (list.isInbox) throw new ValidationError('La Bandeja no se puede renombrar');
    patch.name = cleanName(input.name);
  }
  if (input.color !== undefined) patch.color = checkColor(input.color);
  if (input.folderId !== undefined) {
    if (list.isInbox && input.folderId !== null) throw new ValidationError('La Bandeja no se puede mover a una carpeta');
    patch.folderId = input.folderId === null ? null : (await getFolder(db, userId, input.folderId)).id;
  }
  if (input.sortOrder !== undefined) {
    if (!Number.isInteger(input.sortOrder) || Math.abs(input.sortOrder) > INT4_MAX) {
      throw new ValidationError('El orden debe ser un número entero');
    }
    patch.sortOrder = input.sortOrder;
  }
  if (Object.keys(patch).length === 0) return list;
  const [updated] = await db.update(lists).set(patch).where(eq(lists.id, list.id)).returning();
  return updated;
}

/**
 * Borra la lista (solo el dueño). Todas sus tareas, las haya creado quien sea, pasan a la papelera
 * dentro de la Bandeja del dueño para poder restaurarlas; como la Bandeja es privada, se limpian
 * las asignaciones a otras personas. Las membresías se borran en cascada.
 */
export async function deleteList(db: DB, userId: string, listId: string): Promise<{ movedToTrash: number }> {
  if (!isUuid(listId)) throw new NotFoundError('La lista');
  return db.transaction(async (tx) => {
    // Bloquea la fila mientras se mueven las tareas.
    await lockList(tx, listId, 'update');
    const list = await requireListOwner(tx, userId, listId, 'borrarla');
    if (list.isInbox) throw new ValidationError('La Bandeja no se puede borrar');
    const inbox = await getInbox(tx, userId);
    const now = new Date();
    await tx
      .update(tasks)
      .set({ assigneeId: null, updatedAt: now })
      .where(and(eq(tasks.listId, list.id), ne(tasks.assigneeId, userId)));
    const trashed = await tx
      .update(tasks)
      .set({ deletedAt: now, updatedAt: now, listId: inbox.id })
      .where(and(eq(tasks.listId, list.id), isNull(tasks.deletedAt)))
      .returning({ id: tasks.id });
    await tx.update(tasks).set({ listId: inbox.id }).where(eq(tasks.listId, list.id));
    await tx.delete(lists).where(eq(lists.id, list.id));
    return { movedToTrash: trashed.length };
  });
}
