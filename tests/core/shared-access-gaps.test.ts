import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '@/db/types';
import { NotFoundError } from '@/core/errors';
import type { List } from '@/core/lists';
import { getListMembers, removeListMember } from '@/core/members';
import {
  completeTask, createTask, deleteSubtask, deleteTask, getTask, listTasks, restoreTask, searchTasks, updateSubtask,
  updateTask, type TaskView,
} from '@/core/tasks';
import type { PublicUser as User } from '@/core/users';
import { createTestDb } from '../helpers/db';
import { createSharingFixture } from '../helpers/sharing';

let db: DB;
let owner: User;
let member: User;
let stranger: User;
let shared: List;
// 15:00 UTC = 12:00 del 8/10 en Buenos Aires
const NOW = new Date('2026-10-08T15:00:00Z');
const ASSIGNEE_MSG = 'Solo se puede asignar la tarea al dueño o a un miembro de la lista';
const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();

beforeEach(async () => {
  db = await createTestDb();
  ({ owner, member, stranger, shared } = await createSharingFixture(db));
});

describe('miembro removido', () => {
  it('pierde el acceso a subtareas, tareas en la papelera, vistas y miembros', async () => {
    const live = await createTask(db, owner.id, {
      title: 'viva', listId: shared.id, subtasks: ['s'], tags: ['casa'], dueDate: '2026-10-08', assigneeId: member.id,
    });
    const trashed = await createTask(db, owner.id, { title: 'papelera', listId: shared.id });
    await deleteTask(db, owner.id, trashed.id);
    const done = await createTask(db, owner.id, { title: 'hecha', listId: shared.id });
    await completeTask(db, owner.id, done.id);
    await updateTask(db, member.id, live.id, { tags: ['mia'] });
    expect(titles(await listTasks(db, member.id, { tag: 'mia' }))).toEqual(['viva']); // antes de salir sí

    await removeListMember(db, owner.id, shared.id, member.id);

    const sid = live.subtasks[0].id;
    await expect(updateSubtask(db, member.id, sid, { title: 'x' })).rejects.toThrow(NotFoundError);
    await expect(deleteSubtask(db, member.id, sid)).rejects.toThrow(NotFoundError);
    await expect(getTask(db, member.id, trashed.id, { includeDeleted: true })).rejects.toThrow(NotFoundError);
    await expect(restoreTask(db, member.id, trashed.id)).rejects.toThrow(NotFoundError);
    await expect(getListMembers(db, member.id, shared.id)).rejects.toThrow(NotFoundError);
    expect(await listTasks(db, member.id, { tag: 'mia' })).toEqual([]);
    expect(await listTasks(db, member.id, { tag: 'casa' })).toEqual([]);
    for (const view of ['completed', 'trash', 'assigned', 'today', 'next7'] as TaskView[]) {
      expect(await listTasks(db, member.id, { view, now: NOW })).toEqual([]);
    }
    // El dueño conserva todo.
    expect((await getTask(db, owner.id, trashed.id, { includeDeleted: true })).title).toBe('papelera');
  });
});

describe('ajeno', () => {
  it('las vistas no incluyen tareas de la lista compartida', async () => {
    await createTask(db, owner.id, { title: 'hoy', listId: shared.id, dueDate: '2026-10-08', assigneeId: member.id });
    const done = await createTask(db, owner.id, { title: 'hecha', listId: shared.id });
    await completeTask(db, owner.id, done.id);
    const trashed = await createTask(db, owner.id, { title: 'papelera', listId: shared.id });
    await deleteTask(db, owner.id, trashed.id);
    for (const view of ['today', 'next7', 'completed', 'trash', 'assigned'] as TaskView[]) {
      expect(await listTasks(db, stranger.id, { view, now: NOW })).toEqual([]);
    }
  });

  it('no puede ser asignado al crear una tarea en la lista compartida', async () => {
    await expect(
      createTask(db, owner.id, { title: 'x', listId: shared.id, assigneeId: stranger.id }),
    ).rejects.toThrow(ASSIGNEE_MSG);
    expect(await listTasks(db, owner.id, { listId: shared.id })).toEqual([]);
  });
});

describe('miembro', () => {
  it('filtrar por una etiqueta que solo usa el dueño no devuelve nada', async () => {
    await createTask(db, owner.id, { title: 'A', listId: shared.id, tags: ['solo-dueno'] });
    expect(await listTasks(db, member.id, { tag: 'solo-dueno' })).toEqual([]);
    expect(titles(await listTasks(db, owner.id, { tag: 'solo-dueno' }))).toEqual(['A']);
  });

  it('searchTasks no devuelve tareas en la papelera de la lista compartida', async () => {
    const t = await createTask(db, owner.id, { title: 'Leche', listId: shared.id });
    expect(titles(await searchTasks(db, member.id, 'leche'))).toEqual(['Leche']);
    await deleteTask(db, owner.id, t.id);
    expect(await searchTasks(db, member.id, 'leche', { includeCompleted: true })).toEqual([]);
  });
});
