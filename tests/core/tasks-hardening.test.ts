import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { tasks } from '@/db/schema';
import type { DB } from '@/db/types';
import { NotFoundError, ValidationError } from '@/core/errors';
import { createFolder, createList, getFolderByExternalId, getListByExternalId } from '@/core/lists';
import {
  addSubtask, completeTask, createTask, deleteSubtask, deleteTask, getTask, getTaskByExternalId, listTasks,
  setSubtaskDone, updateSubtask, updateTask,
} from '@/core/tasks';
import type { PublicUser as User } from '@/core/users';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
let user: User;
let other: User;
const NOW = new Date('2026-10-08T15:00:00Z'); // 12:00 en Buenos Aires

beforeEach(async () => {
  db = await createTestDb();
  user = await createTestUser(db);
  other = await createTestUser(db, 'otra@example.com');
});

describe('transacciones', () => {
  it('createTask con una subtarea inválida no escribe nada', async () => {
    await expect(createTask(db, user.id, { title: 'A', subtasks: ['ok', '   '] })).rejects.toThrow(ValidationError);
    expect(await db.select().from(tasks)).toHaveLength(0);
  });

  it('createTask con externalId duplicado sigue dando ValidationError y no deja basura', async () => {
    await createTask(db, user.id, { title: 'A', externalId: 'x1' });
    await expect(
      createTask(db, user.id, { title: 'B', externalId: 'x1', tags: ['t'], subtasks: ['s'] }),
    ).rejects.toThrow(ValidationError);
    expect(await db.select().from(tasks)).toHaveLength(1);
  });

  it('updateTask concurrente sobre las mismas etiquetas no falla y deja una de las dos entradas', async () => {
    const task = await createTask(db, user.id, { title: 'A', tags: ['x'] });
    await Promise.all([
      updateTask(db, user.id, task.id, { tags: ['a', 'b'] }),
      updateTask(db, user.id, task.id, { tags: ['c', 'd'] }),
    ]);
    const final = (await getTask(db, user.id, task.id)).tags;
    expect([['a', 'b'], ['c', 'd']]).toContainEqual(final);
  });
});

describe('búsqueda por id externo', () => {
  it('getTaskByExternalId encuentra la tarea, ignora borradas y otros usuarios', async () => {
    const t = await createTask(db, user.id, { title: 'A', externalId: 'tt-1', tags: ['x'], subtasks: ['s'] });
    const found = await getTaskByExternalId(db, user.id, 'tt-1');
    expect(found?.id).toBe(t.id);
    expect(found?.tags).toEqual(['x']);
    expect(found?.subtasks).toHaveLength(1);
    expect(await getTaskByExternalId(db, user.id, 'nope')).toBeNull();
    expect(await getTaskByExternalId(db, other.id, 'tt-1')).toBeNull();
    await deleteTask(db, user.id, t.id);
    expect(await getTaskByExternalId(db, user.id, 'tt-1')).toBeNull();
  });

  it('getListByExternalId y getFolderByExternalId', async () => {
    const list = await createList(db, user.id, { name: 'L', externalId: 'l-1' });
    const folder = await createFolder(db, user.id, { name: 'F', externalId: 'f-1' });
    expect((await getListByExternalId(db, user.id, 'l-1'))?.id).toBe(list.id);
    expect((await getFolderByExternalId(db, user.id, 'f-1'))?.id).toBe(folder.id);
    expect(await getListByExternalId(db, user.id, 'zzz')).toBeNull();
    expect(await getFolderByExternalId(db, user.id, 'zzz')).toBeNull();
    expect(await getListByExternalId(db, other.id, 'l-1')).toBeNull();
    expect(await getFolderByExternalId(db, other.id, 'f-1')).toBeNull();
  });
});

describe('vistas con includeCompleted', () => {
  it('las vencidas solo aplican a pendientes', async () => {
    await createTask(db, user.id, { title: 'vieja-hecha', dueDate: '2026-09-08', status: 'completed' });
    await createTask(db, user.id, { title: 'hoy-hecha', dueDate: '2026-10-08', status: 'completed' });
    await createTask(db, user.id, { title: 'vieja-pendiente', dueDate: '2026-09-08' });
    const rows = await listTasks(db, user.id, { view: 'today', includeCompleted: true, now: NOW });
    expect(rows.map((r) => r.title).sort()).toEqual(['hoy-hecha', 'vieja-pendiente']);
    const week = await listTasks(db, user.id, { view: 'next7', includeCompleted: true, now: NOW });
    expect(week.map((r) => r.title).sort()).toEqual(['hoy-hecha', 'vieja-pendiente']);
  });
});

describe('subtareas individuales', () => {
  it('addSubtask agrega al final', async () => {
    const t = await createTask(db, user.id, { title: 'A', subtasks: ['uno', 'dos'] });
    const updated = await addSubtask(db, user.id, t.id, '  tres ');
    expect(updated.subtasks.map((s) => s.title)).toEqual(['uno', 'dos', 'tres']);
    expect(updated.subtasks[2].sortOrder).toBe(2);
    const empty = await createTask(db, user.id, { title: 'B' });
    expect((await addSubtask(db, user.id, empty.id, 'x')).subtasks[0].sortOrder).toBe(0);
    await expect(addSubtask(db, user.id, t.id, ' ')).rejects.toThrow(ValidationError);
    await expect(addSubtask(db, other.id, t.id, 'x')).rejects.toThrow(NotFoundError);
  });

  it('updateSubtask cambia título y/o done', async () => {
    const t = await createTask(db, user.id, { title: 'A', subtasks: ['uno'] });
    const id = t.subtasks[0].id;
    let u = await updateSubtask(db, user.id, id, { title: ' nuevo ' });
    expect(u.subtasks[0]).toMatchObject({ title: 'nuevo', done: false });
    u = await updateSubtask(db, user.id, id, { done: true });
    expect(u.subtasks[0]).toMatchObject({ title: 'nuevo', done: true });
    await expect(updateSubtask(db, user.id, id, { title: '' })).rejects.toThrow(ValidationError);
    await expect(updateSubtask(db, other.id, id, { done: false })).rejects.toThrow(NotFoundError);
    await expect(updateSubtask(db, user.id, 'no-uuid', { done: false })).rejects.toThrow(NotFoundError);
  });

  it('deleteSubtask borra y devuelve la tarea', async () => {
    const t = await createTask(db, user.id, { title: 'A', subtasks: ['uno', 'dos'] });
    await expect(deleteSubtask(db, other.id, t.subtasks[0].id)).rejects.toThrow(NotFoundError);
    const u = await deleteSubtask(db, user.id, t.subtasks[0].id);
    expect(u.subtasks.map((s) => s.title)).toEqual(['dos']);
  });

  it('updateTask conserva los ids de subtareas existentes', async () => {
    const t = await createTask(db, user.id, { title: 'A', subtasks: ['uno', { title: 'dos', done: true }, 'tres'] });
    const [s1, s2] = t.subtasks;
    const u = await updateTask(db, user.id, t.id, {
      subtasks: [{ id: s2.id, title: 'dos bis' }, 'nueva', { id: s1.id, title: 'uno', done: true }],
    });
    expect(u.subtasks.map((s) => s.title)).toEqual(['dos bis', 'nueva', 'uno']);
    expect(u.subtasks[0].id).toBe(s2.id);
    expect(u.subtasks[0].done).toBe(true); // done omitido: se conserva
    expect(u.subtasks[2].id).toBe(s1.id);
    expect(u.subtasks[2].done).toBe(true);
    expect(u.subtasks[1].id).not.toBe(s1.id);
    expect(u.subtasks).toHaveLength(3); // "tres" se borró
  });

  it('updateTask ignora ids de subtareas de otra tarea (crea nuevas)', async () => {
    const a = await createTask(db, user.id, { title: 'A', subtasks: ['uno'] });
    const b = await createTask(db, user.id, { title: 'B' });
    const u = await updateTask(db, user.id, b.id, { subtasks: [{ id: a.subtasks[0].id, title: 'copia' }] });
    expect(u.subtasks[0].id).not.toBe(a.subtasks[0].id);
    expect((await getTask(db, user.id, a.id)).subtasks).toHaveLength(1);
  });

  it('cualquier cambio de subtarea actualiza updatedAt de la tarea', async () => {
    const t = await createTask(db, user.id, { title: 'A', subtasks: ['uno'] });
    const old = new Date('2020-01-01T00:00:00Z');
    const reset = () => db.update(tasks).set({ updatedAt: old }).where(eq(tasks.id, t.id));
    const bumped = async () => (await getTask(db, user.id, t.id)).updatedAt.getTime() > old.getTime();
    const sid = t.subtasks[0].id;
    for (const op of [
      () => setSubtaskDone(db, user.id, sid, true),
      () => addSubtask(db, user.id, t.id, 'otra'),
      () => updateSubtask(db, user.id, sid, { title: 'x' }),
      () => deleteSubtask(db, user.id, sid),
    ]) {
      await reset();
      await op();
      expect(await bumped()).toBe(true);
    }
  });
});

describe('paginación', () => {
  beforeEach(async () => {
    for (const [i, n] of ['a', 'b', 'c', 'd', 'e'].entries()) {
      await createTask(db, user.id, { title: n, dueDate: `2026-10-0${i + 1}` });
    }
  });

  it('limit y offset', async () => {
    const titles = async (f: object) => (await listTasks(db, user.id, f)).map((t) => t.title);
    expect(await titles({ limit: 2 })).toEqual(['a', 'b']);
    expect(await titles({ limit: 2, offset: 2 })).toEqual(['c', 'd']);
    expect(await titles({ offset: 4 })).toEqual(['e']);
    expect(await titles({})).toHaveLength(5);
  });

  it('valida limit y offset', async () => {
    for (const bad of [0, -1, 1.5, 501, Number.NaN]) {
      await expect(listTasks(db, user.id, { limit: bad })).rejects.toThrow(ValidationError);
    }
    for (const bad of [-1, 1.5, Number.NaN]) {
      await expect(listTasks(db, user.id, { offset: bad })).rejects.toThrow(ValidationError);
    }
    await expect(listTasks(db, user.id, { limit: 500 })).resolves.toBeDefined();
  });
});

describe('orden y completado', () => {
  it('a igual fecha, la hora más temprana va primero aunque tenga menos prioridad', async () => {
    await createTask(db, user.id, { title: 'tarde', dueDate: '2026-10-08', dueTime: '18:00', priority: 5 });
    await createTask(db, user.id, { title: 'temprano', dueDate: '2026-10-08', dueTime: '09:00', priority: 0 });
    const rows = await listTasks(db, user.id, {});
    expect(rows.map((r) => r.title)).toEqual(['temprano', 'tarde']);
  });

  it('completar una tarea ya completada no cambia completedAt', async () => {
    const t = await createTask(db, user.id, { title: 'A' });
    const first = await completeTask(db, user.id, t.id);
    await new Promise((r) => setTimeout(r, 15));
    const second = await completeTask(db, user.id, t.id);
    expect(second.completedAt).toEqual(first.completedAt);
  });
});
