import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '@/db/types';
import { getInbox, listFolders, listLists } from '@/core/lists';
import { listTags } from '@/core/tags';
import { listTasks } from '@/core/tasks';
import type { PublicUser } from '@/core/users';
import { importTickTick, type TickTickExport } from '@/lib/ticktick-import';
import { createTestDb, createTestUser } from '../helpers/db';

const EXPORT: TickTickExport = {
  folders: [{ id: 'g1', name: '💼Work' }],
  lists: [
    { id: 'p1', name: '🗼Torre', color: null, folderId: 'g1' },
    { id: 'p2', name: '🏡Yo', color: '#FFD324', folderId: null },
  ],
  tags: [{ name: 'bug', color: '#EF2D24' }, { name: 'claude', color: null }],
  tasks: [
    {
      id: 't1', listId: 'p1', title: 'Probar login', content: 'Detalle', dueDate: '2026-10-01', dueTime: null,
      priority: 3, tags: ['claude', 'bug'], status: 'pending', completedAt: null, subtasks: [],
    },
    {
      id: 't2', listId: 'p2', title: 'Checklist', content: '', dueDate: null, dueTime: null, priority: 0, tags: [],
      status: 'pending', completedAt: null,
      subtasks: [{ title: 'uno', done: false }, { title: 'dos', done: true }],
    },
    {
      id: 't3', listId: null, title: 'Vieja', content: '', dueDate: '2026-09-22', dueTime: null, priority: 0,
      tags: [], status: 'completed', completedAt: '2026-09-29T16:23:57.000Z', subtasks: [],
    },
  ],
};

let db: DB;
let user: PublicUser;
beforeEach(async () => {
  db = await createTestDb();
  user = await createTestUser(db, 'maestu@example.com');
});

describe('importTickTick', () => {
  it('importa carpetas, listas, etiquetas y tareas', async () => {
    const summary = await importTickTick(db, 'Maestu@Example.com', EXPORT);
    expect(summary).toMatchObject({
      folders: { created: 1, existing: 0 },
      lists: { created: 2, existing: 0 },
      tasks: { created: 3, existing: 0 },
    });

    const [folder] = await listFolders(db, user.id);
    expect(folder.name).toBe('💼Work');
    const lists = await listLists(db, user.id);
    const torre = lists.find((l) => l.name === '🗼Torre')!;
    expect(torre.folderId).toBe(folder.id);
    expect(lists.find((l) => l.name === '🏡Yo')!.color).toBe('#FFD324');
    expect((await listTags(db, user.id)).map((t) => [t.name, t.color])).toEqual([['bug', '#EF2D24'], ['claude', null]]);

    const [probar] = await listTasks(db, user.id, { listId: torre.id });
    expect(probar).toMatchObject({ title: 'Probar login', description: 'Detalle', dueDate: '2026-10-01', priority: 3 });
    expect(probar.tags).toEqual(['bug', 'claude']);

    const checklist = (await listTasks(db, user.id, { includeCompleted: true })).find((t) => t.title === 'Checklist')!;
    expect(checklist.subtasks.map((s) => [s.title, s.done])).toEqual([['uno', false], ['dos', true]]);

    const [vieja] = await listTasks(db, user.id, { view: 'completed' });
    expect(vieja.listId).toBe((await getInbox(db, user.id)).id);
    expect(vieja.completedAt?.toISOString()).toBe('2026-09-29T16:23:57.000Z');
  });

  it('es idempotente: la segunda corrida no duplica nada', async () => {
    await importTickTick(db, 'maestu@example.com', EXPORT);
    const second = await importTickTick(db, 'maestu@example.com', EXPORT);
    expect(second).toMatchObject({
      folders: { created: 0, existing: 1 },
      lists: { created: 0, existing: 2 },
      tasks: { created: 0, existing: 3 },
    });
    expect(await listLists(db, user.id)).toHaveLength(3);
    // 2 pendientes + 1 completada, sin duplicados.
    expect(await listTasks(db, user.id, { includeCompleted: true })).toHaveLength(3);
  });

  it('cuenta pendientes y completadas por lista', async () => {
    const summary = await importTickTick(db, 'maestu@example.com', EXPORT);
    expect(summary.perList).toEqual({
      '🗼Torre': { pending: 1, completed: 0 },
      '🏡Yo': { pending: 1, completed: 0 },
      Bandeja: { pending: 0, completed: 1 },
    });
  });

  it('falla si el usuario no existe o una tarea apunta a una lista desconocida', async () => {
    await expect(importTickTick(db, 'nadie@example.com', EXPORT)).rejects.toThrow('No hay ningún usuario');
    const roto = { ...EXPORT, tasks: [{ ...EXPORT.tasks[0], listId: 'p9' }] };
    await expect(importTickTick(db, 'maestu@example.com', roto)).rejects.toThrow('lista desconocida');
  });
});
