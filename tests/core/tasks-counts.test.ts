import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, todayIn } from '@/core/dates';
import { createList } from '@/core/lists';
import { completeTask, countTasks, createTask, deleteTask, listTasks, type ListTasksFilter } from '@/core/tasks';
import type { PublicUser as User } from '@/core/users';
import type { DB } from '@/db/types';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
let user: User;

beforeEach(async () => {
  db = await createTestDb();
  user = await createTestUser(db);
});

describe('countTasks', () => {
  it('cuenta lo mismo que listTasks en cada vista', async () => {
    const today = todayIn(user.timezone);
    const list = await createList(db, user.id, { name: 'Casa' });
    await createTask(db, user.id, { title: 'Bandeja sin fecha' });
    await createTask(db, user.id, { title: 'Bandeja hoy', dueDate: today });
    await createTask(db, user.id, { title: 'Vencida', listId: list.id, dueDate: addDays(today, -2) });
    const done = await createTask(db, user.id, { title: 'Hecha hoy', dueDate: today });
    await completeTask(db, user.id, done.id);
    const trashed = await createTask(db, user.id, { title: 'Borrada' });
    await deleteTask(db, user.id, trashed.id);

    const filters: ListTasksFilter[] = [
      { view: 'inbox' }, { view: 'today' }, { view: 'next7' }, { view: 'completed' }, { view: 'trash' }, { listId: list.id },
    ];
    for (const filter of filters) {
      expect(await countTasks(db, user.id, filter)).toBe((await listTasks(db, user.id, filter)).length);
    }
    expect(await countTasks(db, user.id, { view: 'inbox' })).toBe(2);
    expect(await countTasks(db, user.id, { view: 'today' })).toBe(2);
  });

  it('no tiene el límite de 100 de listTasks', async () => {
    for (let i = 0; i < 102; i++) await createTask(db, user.id, { title: `T${i}` });
    expect(await countTasks(db, user.id, { view: 'inbox' })).toBe(102);
  });
});
