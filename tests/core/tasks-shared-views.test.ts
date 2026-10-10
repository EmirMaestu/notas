import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '@/db/types';
import type { List } from '@/core/lists';
import { completeTask, createTask, deleteTask, listTasks } from '@/core/tasks';
import type { PublicUser as User } from '@/core/users';
import { createTestDb } from '../helpers/db';
import { createSharingFixture } from '../helpers/sharing';

let db: DB;
let owner: User;
let member: User;
let shared: List;
let ownerPrivate: List;
// 15:00 UTC = 12:00 del 8/10 en Buenos Aires
const NOW = new Date('2026-10-08T15:00:00Z');

beforeEach(async () => {
  db = await createTestDb();
  ({ owner, member, shared, ownerPrivate } = await createSharingFixture(db));
  await createTask(db, owner.id, { title: 'compartida-sin-asignar', listId: shared.id, dueDate: '2026-10-08' });
  await createTask(db, owner.id, { title: 'compartida-para-miembro', listId: shared.id, dueDate: '2026-10-08', assigneeId: member.id });
  await createTask(db, owner.id, { title: 'compartida-para-miembro-sin-fecha', listId: shared.id, assigneeId: member.id });
  await createTask(db, member.id, { title: 'propia-del-miembro', dueDate: '2026-10-10' });
  await createTask(db, owner.id, { title: 'privada-del-duenio', listId: ownerPrivate.id, dueDate: '2026-10-08' });
});

const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();

describe('vistas con listas compartidas', () => {
  it('Hoy y 7 días del miembro: sus listas y, de las compartidas, solo lo asignado a él', async () => {
    expect(titles(await listTasks(db, member.id, { view: 'today', now: NOW }))).toEqual(['compartida-para-miembro']);
    expect(titles(await listTasks(db, member.id, { view: 'next7', now: NOW })))
      .toEqual(['compartida-para-miembro', 'propia-del-miembro']);
  });

  it('Hoy del dueño incluye todas las tareas de sus listas, asignadas o no', async () => {
    expect(titles(await listTasks(db, owner.id, { view: 'today', now: NOW })))
      .toEqual(['compartida-para-miembro', 'compartida-sin-asignar', 'privada-del-duenio']);
  });

  it('Asignadas a mí: pendientes asignadas en cualquier lista accesible', async () => {
    expect(titles(await listTasks(db, member.id, { view: 'assigned' })))
      .toEqual(['compartida-para-miembro', 'compartida-para-miembro-sin-fecha']);
    expect(await listTasks(db, owner.id, { view: 'assigned' })).toEqual([]);
    const [first] = await listTasks(db, member.id, { view: 'assigned' });
    await completeTask(db, member.id, first.id);
    expect(await listTasks(db, member.id, { view: 'assigned' })).toHaveLength(1);
    expect(await listTasks(db, member.id, { view: 'assigned', includeCompleted: true })).toHaveLength(2);
  });

  it('Bandeja: solo la propia', async () => {
    expect(titles(await listTasks(db, member.id, { view: 'inbox' }))).toEqual(['propia-del-miembro']);
  });

  it('Completadas y Papelera incluyen las de listas compartidas', async () => {
    const [a, b] = await listTasks(db, owner.id, { listId: shared.id });
    await completeTask(db, owner.id, a.id);
    await deleteTask(db, owner.id, b.id);
    expect(titles(await listTasks(db, member.id, { view: 'completed' }))).toEqual([a.title]);
    expect(titles(await listTasks(db, member.id, { view: 'trash' }))).toEqual([b.title]);
  });
});
