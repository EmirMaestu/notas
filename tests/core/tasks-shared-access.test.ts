import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '@/db/types';
import { NotFoundError } from '@/core/errors';
import { createList, deleteList, getInbox, type List } from '@/core/lists';
import { addListMember, leaveList, removeListMember } from '@/core/members';
import {
  addSubtask, completeTask, createTask, deleteSubtask, deleteTask, getTask, getTaskByExternalId, listTasks, moveTask,
  restoreTask, searchTasks, setSubtaskDone, uncompleteTask, updateSubtask, updateTask,
} from '@/core/tasks';
import type { PublicUser as User } from '@/core/users';
import { createTestDb } from '../helpers/db';
import { createSharingFixture } from '../helpers/sharing';

let db: DB;
let owner: User;
let member: User;
let stranger: User;
let shared: List;
let ownerPrivate: List;

beforeEach(async () => {
  db = await createTestDb();
  ({ owner, member, stranger, shared, ownerPrivate } = await createSharingFixture(db));
});

const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();

describe('el miembro trabaja sobre las tareas de la lista compartida', () => {
  it('ve, crea, edita, completa, borra y restaura', async () => {
    const t = await createTask(db, owner.id, { title: 'Del dueño', listId: shared.id });
    expect((await getTask(db, member.id, t.id)).title).toBe('Del dueño');
    const mine = await createTask(db, member.id, { title: 'Del miembro', listId: shared.id });
    expect(mine.userId).toBe(member.id); // user_id = "creada por"
    expect((await getTask(db, owner.id, mine.id)).title).toBe('Del miembro');
    expect((await updateTask(db, member.id, t.id, { title: 'Editada' })).title).toBe('Editada');
    expect((await completeTask(db, member.id, t.id)).status).toBe('completed');
    expect((await uncompleteTask(db, member.id, t.id)).status).toBe('pending');
    await deleteTask(db, member.id, t.id);
    await expect(getTask(db, owner.id, t.id)).rejects.toThrow(NotFoundError);
    expect((await restoreTask(db, member.id, t.id)).deletedAt).toBeNull();
  });

  it('administra subtareas', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id, subtasks: ['uno'] });
    const sid = t.subtasks[0].id;
    expect((await addSubtask(db, member.id, t.id, 'dos')).subtasks).toHaveLength(2);
    expect((await updateSubtask(db, member.id, sid, { title: 'uno bis' })).subtasks[0].title).toBe('uno bis');
    expect((await setSubtaskDone(db, member.id, sid, true)).subtasks[0].done).toBe(true);
    expect((await deleteSubtask(db, member.id, sid)).subtasks.map((s) => s.title)).toEqual(['dos']);
  });

  it('listTasks y searchTasks incluyen las tareas de la lista compartida', async () => {
    await createTask(db, owner.id, { title: 'Leche', listId: shared.id });
    await createTask(db, member.id, { title: 'Pan' });
    expect(titles(await listTasks(db, member.id, { listId: shared.id }))).toEqual(['Leche']);
    expect(titles(await listTasks(db, member.id))).toEqual(['Leche', 'Pan']);
    expect(titles(await searchTasks(db, member.id, 'leche'))).toEqual(['Leche']);
  });

  it('mueve solo entre listas a las que tiene acceso', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id });
    await expect(moveTask(db, member.id, t.id, ownerPrivate.id)).rejects.toThrow(NotFoundError);
    // Con acceso a otra lista del mismo dueño sí puede (ver tasks-move-shared.test.ts).
    const other = await createList(db, owner.id, { name: 'Otra' });
    await addListMember(db, owner.id, other.id, member.email);
    expect((await moveTask(db, member.id, t.id, other.id)).listId).toBe(other.id);
  });
});

describe('aislamiento', () => {
  it('un ajeno no accede a nada de la lista compartida', async () => {
    const t = await createTask(db, owner.id, { title: 'Secreta', listId: shared.id, subtasks: ['s'] });
    const sid = t.subtasks[0].id;
    const strangerInbox = await getInbox(db, stranger.id);
    const attempts = [
      () => getTask(db, stranger.id, t.id),
      () => getTask(db, stranger.id, t.id, { includeDeleted: true }),
      () => updateTask(db, stranger.id, t.id, { title: 'Hack' }),
      () => completeTask(db, stranger.id, t.id),
      () => uncompleteTask(db, stranger.id, t.id),
      () => deleteTask(db, stranger.id, t.id),
      () => restoreTask(db, stranger.id, t.id),
      () => moveTask(db, stranger.id, t.id, shared.id),
      () => moveTask(db, stranger.id, t.id, strangerInbox.id),
      () => addSubtask(db, stranger.id, t.id, 'x'),
      () => updateSubtask(db, stranger.id, sid, { title: 'x' }),
      () => deleteSubtask(db, stranger.id, sid),
      () => createTask(db, stranger.id, { title: 'x', listId: shared.id }),
      () => listTasks(db, stranger.id, { listId: shared.id }),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toThrow(NotFoundError);
    }
    expect(await listTasks(db, stranger.id)).toEqual([]);
    expect(await searchTasks(db, stranger.id, 'Secreta')).toEqual([]);
    expect((await getTask(db, owner.id, t.id)).title).toBe('Secreta');
  });

  it('la Bandeja del dueño sigue siendo privada', async () => {
    const t = await createTask(db, owner.id, { title: 'Privada' });
    await expect(getTask(db, member.id, t.id)).rejects.toThrow(NotFoundError);
    expect(await listTasks(db, member.id)).toEqual([]);
  });

  it('al salir de la lista se pierde el acceso', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id });
    await leaveList(db, member.id, shared.id);
    await expect(getTask(db, member.id, t.id)).rejects.toThrow(NotFoundError);
    expect(await listTasks(db, member.id)).toEqual([]);
  });

  it('al ser quitado de la lista se pierde el acceso', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id });
    await removeListMember(db, owner.id, shared.id, member.id);
    await expect(updateTask(db, member.id, t.id, { title: 'x' })).rejects.toThrow(NotFoundError);
    expect(await searchTasks(db, member.id, 'A')).toEqual([]);
  });

  it('si el dueño borra la lista, el miembro no puede restaurar sus tareas', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id });
    await deleteTask(db, member.id, t.id);
    await deleteList(db, owner.id, shared.id);
    await expect(restoreTask(db, member.id, t.id)).rejects.toThrow(NotFoundError);
    await expect(getTask(db, member.id, t.id, { includeDeleted: true })).rejects.toThrow(NotFoundError);
  });

  it('getTaskByExternalId busca solo entre las creadas por el usuario y accesibles', async () => {
    await createTask(db, member.id, { title: 'Importada', listId: shared.id, externalId: 'tt-1' });
    expect((await getTaskByExternalId(db, member.id, 'tt-1'))?.title).toBe('Importada');
    expect(await getTaskByExternalId(db, owner.id, 'tt-1')).toBeNull();
    await leaveList(db, member.id, shared.id);
    expect(await getTaskByExternalId(db, member.id, 'tt-1')).toBeNull();
  });
});
