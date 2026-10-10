import { and, asc, eq, sql } from 'drizzle-orm';
import { listMembers, tasks, users } from '@/db/schema';
import type { DB } from '@/db/types';
import { getAccessibleList, lockList, requireListOwner, type ListRole } from './access';
import { NotFoundError, ValidationError, isUuid } from './errors';

/** Persona con acceso a una lista (sin datos sensibles). */
export interface ListMember {
  id: string;
  email: string;
  name: string;
  role: ListRole;
}

const MANAGE = 'administrar sus miembros';
const MAX_MEMBERS = 50;
const personColumns = { id: users.id, email: users.email, name: users.name };

/** Dueño primero y después los miembros por orden de alta. Lo pueden ver el dueño y los miembros. */
export async function getListMembers(db: DB, userId: string, listId: string): Promise<ListMember[]> {
  const { list } = await getAccessibleList(db, userId, listId);
  const [owner] = await db.select(personColumns).from(users).where(eq(users.id, list.userId));
  const members = await db
    .select(personColumns)
    .from(listMembers)
    .innerJoin(users, eq(users.id, listMembers.userId))
    .where(eq(listMembers.listId, list.id))
    .orderBy(asc(listMembers.addedAt), asc(users.email));
  return [
    { ...owner, role: 'owner' as const },
    ...members.map((m) => ({ ...m, role: 'member' as const })),
  ];
}

/** El dueño agrega a un usuario ya registrado, por email. La Bandeja no se comparte. */
export async function addListMember(db: DB, ownerId: string, listId: string, email: string): Promise<ListMember> {
  return db.transaction(async (tx) => {
    // Bloquea la lista para que el control del máximo de miembros no tenga carreras.
    await lockList(tx, listId, 'update');
    // Primero el permiso: un miembro o un ajeno no llega a la búsqueda por email. Ojo: esto NO impide que
    // cualquier usuario (todos tienen listas propias) averigüe qué emails tienen cuenta; ese sondeo se
    // mitiga con el límite de frecuencia de la acción del servidor.
    const list = await requireListOwner(tx, ownerId, listId, MANAGE);
    if (list.isInbox) throw new ValidationError('La Bandeja no se puede compartir');
    if (typeof email !== 'string') throw new ValidationError('Email inválido');
    const clean = email.trim().toLowerCase();
    if (!clean) throw new ValidationError('Ingresá el email de la persona');
    const [user] = await tx.select(personColumns).from(users).where(eq(users.email, clean));
    if (!user) throw new ValidationError('No hay ninguna cuenta con ese email');
    if (user.id === ownerId) throw new ValidationError('Ya sos el dueño de esta lista');
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(listMembers)
      .where(eq(listMembers.listId, list.id));
    if (Number(count) >= MAX_MEMBERS) {
      throw new ValidationError(`Una lista puede tener como máximo ${MAX_MEMBERS} miembros`);
    }
    const inserted = await tx
      .insert(listMembers)
      .values({ listId: list.id, userId: user.id })
      .onConflictDoNothing()
      .returning({ userId: listMembers.userId });
    if (inserted.length === 0) throw new ValidationError('Esa persona ya es miembro de la lista');
    return { ...user, role: 'member' as const };
  });
}

/**
 * Quita la membresía y las asignaciones de esa persona en la lista. NotFoundError si no era miembro.
 * Los llamadores ya bloquearon la fila de la lista (FOR UPDATE) para serializar con quien crea o asigna tareas.
 */
async function dropMembership(db: DB, listId: string, userId: string): Promise<void> {
  const removed = await db
    .delete(listMembers)
    .where(and(eq(listMembers.listId, listId), eq(listMembers.userId, userId)))
    .returning({ userId: listMembers.userId });
  if (removed.length === 0) throw new NotFoundError('El miembro');
  await db
    .update(tasks)
    .set({ assigneeId: null, updatedAt: new Date() })
    .where(and(eq(tasks.listId, listId), eq(tasks.assigneeId, userId)));
}

export async function removeListMember(db: DB, ownerId: string, listId: string, memberId: string): Promise<void> {
  return db.transaction(async (tx) => {
    await lockList(tx, listId, 'update');
    const list = await requireListOwner(tx, ownerId, listId, MANAGE);
    if (!isUuid(memberId)) throw new NotFoundError('El miembro');
    await dropMembership(tx, list.id, memberId);
  });
}

/** Un miembro deja la lista (el dueño no puede). */
export async function leaveList(db: DB, userId: string, listId: string): Promise<void> {
  return db.transaction(async (tx) => {
    await lockList(tx, listId, 'update');
    const { list, role } = await getAccessibleList(tx, userId, listId);
    if (role === 'owner') throw new ValidationError('El dueño no puede salir de su propia lista');
    await dropMembership(tx, list.id, userId);
  });
}
