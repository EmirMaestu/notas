import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '@/db/types';
import { ValidationError } from '@/core/errors';
import { addSubtask, createTask, updateSubtask, updateTask } from '@/core/tasks';
import type { PublicUser as User } from '@/core/users';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
let user: User;
const bad = (v: unknown) => v as never;

beforeEach(async () => {
  db = await createTestDb();
  user = await createTestUser(db);
});

describe('tipos en tiempo de ejecución', () => {
  it('done debe ser booleano', async () => {
    const msg = 'El estado de la subtarea debe ser verdadero o falso';
    await expect(createTask(db, user.id, { title: 'A', subtasks: [{ title: 's', done: bad('false') }] })).rejects.toThrow(msg);
    const task = await createTask(db, user.id, { title: 'A', subtasks: ['s'] });
    await expect(updateTask(db, user.id, task.id, { subtasks: [{ title: 's', done: bad(1) }] })).rejects.toThrow(msg);
    await expect(updateSubtask(db, user.id, task.subtasks[0].id, { done: bad('si') })).rejects.toThrow(msg);
  });

  it('título y descripción deben ser texto', async () => {
    await expect(createTask(db, user.id, { title: bad(5) })).rejects.toThrow(ValidationError);
    await expect(createTask(db, user.id, { title: 'A', description: bad(5) })).rejects.toThrow(ValidationError);
    const task = await createTask(db, user.id, { title: 'A' });
    await expect(updateTask(db, user.id, task.id, { title: bad({}) })).rejects.toThrow(ValidationError);
    await expect(updateTask(db, user.id, task.id, { description: bad([]) })).rejects.toThrow(ValidationError);
    await expect(addSubtask(db, user.id, task.id, bad(null))).rejects.toThrow(ValidationError);
    await expect(createTask(db, user.id, { title: 'A', subtasks: [bad(7)] })).rejects.toThrow(ValidationError);
  });

  it('limita subtareas a 100 y etiquetas a 30', async () => {
    const subs = Array.from({ length: 101 }, (_, i) => `s${i}`);
    const tagNames = Array.from({ length: 31 }, (_, i) => `t${i}`);
    await expect(createTask(db, user.id, { title: 'A', subtasks: subs })).rejects.toThrow('Una tarea no puede tener más de 100 subtareas');
    await expect(createTask(db, user.id, { title: 'A', tags: tagNames })).rejects.toThrow('Una tarea no puede tener más de 30 etiquetas');
    const task = await createTask(db, user.id, { title: 'A', subtasks: subs.slice(0, 100), tags: tagNames.slice(0, 30) });
    expect(task.subtasks).toHaveLength(100);
    await expect(updateTask(db, user.id, task.id, { subtasks: subs })).rejects.toThrow(ValidationError);
    await expect(updateTask(db, user.id, task.id, { tags: tagNames })).rejects.toThrow(ValidationError);
    await expect(addSubtask(db, user.id, task.id, 'una más')).rejects.toThrow('Una tarea no puede tener más de 100 subtareas');
  });
});
