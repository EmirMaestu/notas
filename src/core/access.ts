import { and, eq, inArray, or } from 'drizzle-orm';
import { listMembers, lists } from '@/db/schema';
import type { DB } from '@/db/types';
import { NotFoundError, ValidationError, isUuid } from './errors';
import type { List } from './lists';

/**
 * Regla de acceso de Notas: un usuario accede a una lista si es su dueño (`lists.user_id`)
 * o miembro (`list_members`). Las tareas se acceden a través de su lista.
 */
export type ListRole = 'owner' | 'member';

/** Subconsulta: ids de las listas compartidas con el usuario (donde es miembro). */
export function memberListIds(db: DB, userId: string) {
  return db.select({ id: listMembers.listId }).from(listMembers).where(eq(listMembers.userId, userId));
}

/** Subconsulta: ids de las listas propias del usuario. */
export function ownedListIds(db: DB, userId: string) {
  return db.select({ id: lists.id }).from(lists).where(eq(lists.userId, userId));
}

/** Subconsulta: ids de todas las listas a las que accede el usuario (propias + compartidas). Para `inArray`. */
export function accessibleListIds(db: DB, userId: string) {
  return db
    .select({ id: lists.id })
    .from(lists)
    .where(or(eq(lists.userId, userId), inArray(lists.id, memberListIds(db, userId))));
}

/**
 * La lista y el rol del usuario en ella; NotFoundError si no existe o no tiene acceso (no se distingue).
 * Para un miembro `folderId` es null: la carpeta es del dueño y no se expone.
 */
export async function getAccessibleList(
  db: DB, userId: string, listId: string,
): Promise<{ list: List; role: ListRole }> {
  if (!isUuid(listId)) throw new NotFoundError('La lista');
  const [row] = await db
    .select({ list: lists, memberId: listMembers.userId })
    .from(lists)
    .leftJoin(listMembers, and(eq(listMembers.listId, lists.id), eq(listMembers.userId, userId)))
    .where(eq(lists.id, listId));
  if (!row) throw new NotFoundError('La lista');
  if (row.list.userId === userId) return { list: row.list, role: 'owner' };
  if (row.memberId !== null) return { list: { ...row.list, folderId: null }, role: 'member' };
  throw new NotFoundError('La lista');
}

/**
 * Bloquea la fila de la lista dentro de la transacción: `share` para quien depende de que la lista y sus
 * membresías sigan igual (crear/asignar), `update` para quien las cambia (quitar miembros, borrar la lista).
 * Así ambas operaciones se serializan. NotFoundError si la lista ya no existe. Llamar dentro de una transacción.
 */
export async function lockList(db: DB, listId: string, mode: 'share' | 'update'): Promise<void> {
  if (!isUuid(listId)) throw new NotFoundError('La lista');
  const query = db.select({ id: lists.id }).from(lists).where(eq(lists.id, listId));
  const rows = await (mode === 'share' ? query.for('share') : query.for('update'));
  if (rows.length === 0) throw new NotFoundError('La lista');
}

/** La lista si el usuario es su dueño. Un miembro recibe ValidationError; un ajeno, NotFoundError. */
export async function requireListOwner(db: DB, userId: string, listId: string, action: string): Promise<List> {
  const { list, role } = await getAccessibleList(db, userId, listId);
  if (role !== 'owner') throw new ValidationError(`Solo el dueño de la lista puede ${action}`);
  return list;
}

/** ¿El usuario es dueño o miembro de la lista? (ids inválidos → false) */
export async function canAccessList(db: DB, userId: string, listId: string): Promise<boolean> {
  if (!isUuid(userId) || !isUuid(listId)) return false;
  const [row] = await db
    .select({ id: lists.id })
    .from(lists)
    .where(and(eq(lists.id, listId), inArray(lists.id, accessibleListIds(db, userId))));
  return row !== undefined;
}
