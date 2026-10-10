import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '@/db/types';
import { NotFoundError, ValidationError } from '@/core/errors';
import { createList, getInbox } from '@/core/lists';
import {
  completeTask, createTask, deleteTask, getTask, moveTask, restoreTask, setSubtaskDone, uncompleteTask, updateTask,
} from '@/core/tasks';
import type { PublicUser as User } from '@/core/users';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
let user: User;
let other: User;
beforeEach(async () => {
  db = await createTestDb();
  user = await createTestUser(db);
  other = await createTestUser(db, 'otro@example.com');
});

describe('createTask', () => {
  it('por defecto va a la Bandeja, pendiente y sin prioridad', async () => {
    const task = await createTask(db, user.id, { title: '  Comprar pan ' });
    expect(task).toMatchObject({
      title: 'Comprar pan', listId: (await getInbox(db, user.id)).id, status: 'pending', priority: 0,
      dueDate: null, dueTime: null, description: '', tags: [], subtasks: [],
    });
  });

  it('acepta todos los campos', async () => {
    const list = await createList(db, user.id, { name: 'Casa' });
    const task = await createTask(db, user.id, {
      title: 'Limpiar', description: 'Toda la casa', listId: list.id, dueDate: '2026-10-10', dueTime: '09:30',
      priority: 5, tags: ['#Casa', 'finde'], subtasks: ['Cocina', { title: 'Baño', done: true }],
    });
    expect(task).toMatchObject({ listId: list.id, dueDate: '2026-10-10', dueTime: '09:30', priority: 5, tags: ['casa', 'finde'] });
    expect(task.subtasks.map((s) => [s.title, s.done])).toEqual([['Cocina', false], ['Baño', true]]);
  });

  it('valida los datos', async () => {
    await expect(createTask(db, user.id, { title: '  ' })).rejects.toThrow(ValidationError);
    await expect(createTask(db, user.id, { title: 'x', dueDate: '10/10/2026' })).rejects.toThrow('Fecha inválida');
    await expect(createTask(db, user.id, { title: 'x', dueTime: '09:00' })).rejects.toThrow('hora sin fecha');
    await expect(createTask(db, user.id, { title: 'x', dueDate: '2026-10-10', dueTime: '9am' })).rejects.toThrow(ValidationError);
    await expect(createTask(db, user.id, { title: 'x', priority: 2 })).rejects.toThrow('Prioridad inválida');
  });

  it('no permite usar listas de otro usuario', async () => {
    const foreign = await createList(db, other.id, { name: 'Ajena' });
    await expect(createTask(db, user.id, { title: 'x', listId: foreign.id })).rejects.toThrow(NotFoundError);
  });

  it('puede crearse completada (para migraciones)', async () => {
    const at = new Date('2026-01-01T10:00:00Z');
    const task = await createTask(db, user.id, { title: 'Vieja', status: 'completed', completedAt: at, externalId: 'tt-1' });
    expect(task).toMatchObject({ status: 'completed', completedAt: at, externalId: 'tt-1' });
  });
});

describe('createTask — robustez', () => {
  it('rechaza descripciones de más de 10000 caracteres', async () => {
    await expect(createTask(db, user.id, { title: 'x', description: 'a'.repeat(10001) })).rejects.toThrow(ValidationError);
    const task = await createTask(db, user.id, { title: 'x', description: 'a'.repeat(10000) });
    await expect(updateTask(db, user.id, task.id, { description: 'a'.repeat(10001) })).rejects.toThrow('descripción');
  });

  it('rechaza un id externo duplicado para el mismo usuario', async () => {
    await createTask(db, user.id, { title: 'A', externalId: 'tt-9' });
    await expect(createTask(db, user.id, { title: 'B', externalId: 'tt-9' })).rejects.toThrow(ValidationError);
    await expect(createTask(db, user.id, { title: 'B', externalId: 'tt-9' })).rejects.toThrow('tt-9');
    // otro usuario puede reutilizarlo
    await expect(createTask(db, other.id, { title: 'C', externalId: 'tt-9' })).resolves.toBeDefined();
  });
});

describe('getTask', () => {
  it('no devuelve tareas de otro usuario', async () => {
    const task = await createTask(db, other.id, { title: 'Secreta' });
    await expect(getTask(db, user.id, task.id)).rejects.toThrow(NotFoundError);
    await expect(getTask(db, user.id, 'no-es-uuid')).rejects.toThrow(NotFoundError);
  });
});

describe('updateTask', () => {
  it('actualiza solo lo indicado', async () => {
    const task = await createTask(db, user.id, { title: 'A', priority: 3, dueDate: '2026-10-10' });
    const updated = await updateTask(db, user.id, task.id, { title: 'B' });
    expect(updated).toMatchObject({ title: 'B', priority: 3, dueDate: '2026-10-10' });
  });

  it('quitar la fecha quita también la hora', async () => {
    const task = await createTask(db, user.id, { title: 'A', dueDate: '2026-10-10', dueTime: '10:00' });
    expect(await updateTask(db, user.id, task.id, { dueDate: null })).toMatchObject({ dueDate: null, dueTime: null });
  });

  it('agregar hora a una tarea con fecha existente', async () => {
    const task = await createTask(db, user.id, { title: 'A', dueDate: '2026-10-10' });
    expect((await updateTask(db, user.id, task.id, { dueTime: '18:00' })).dueTime).toBe('18:00');
  });

  it('reemplaza etiquetas y subtareas', async () => {
    const task = await createTask(db, user.id, { title: 'A', tags: ['x'], subtasks: ['uno'] });
    const updated = await updateTask(db, user.id, task.id, { tags: ['y', 'z'], subtasks: [{ title: 'dos', done: true }] });
    expect(updated.tags).toEqual(['y', 'z']);
    expect(updated.subtasks.map((s) => s.title)).toEqual(['dos']);
  });

  it('no modifica tareas de otro usuario', async () => {
    const task = await createTask(db, other.id, { title: 'Secreta' });
    await expect(updateTask(db, user.id, task.id, { title: 'Hack' })).rejects.toThrow(NotFoundError);
  });
});

describe('acciones', () => {
  it('completar y descompletar', async () => {
    const task = await createTask(db, user.id, { title: 'A' });
    const done = await completeTask(db, user.id, task.id);
    expect(done.status).toBe('completed');
    expect(done.completedAt).toBeInstanceOf(Date);
    expect(await uncompleteTask(db, user.id, task.id)).toMatchObject({ status: 'pending', completedAt: null });
  });

  it('mover de lista', async () => {
    const list = await createList(db, user.id, { name: 'Trabajo' });
    const task = await createTask(db, user.id, { title: 'A' });
    expect((await moveTask(db, user.id, task.id, list.id)).listId).toBe(list.id);
    const foreign = await createList(db, other.id, { name: 'Ajena' });
    await expect(moveTask(db, user.id, task.id, foreign.id)).rejects.toThrow(NotFoundError);
  });

  it('borrar manda a la papelera y restaurar la recupera', async () => {
    const task = await createTask(db, user.id, { title: 'A' });
    await deleteTask(db, user.id, task.id);
    await expect(getTask(db, user.id, task.id)).rejects.toThrow(NotFoundError);
    expect((await getTask(db, user.id, task.id, { includeDeleted: true })).deletedAt).toBeInstanceOf(Date);
    expect((await restoreTask(db, user.id, task.id)).deletedAt).toBeNull();
  });

  it('marcar subtarea', async () => {
    const task = await createTask(db, user.id, { title: 'A', subtasks: ['uno'] });
    const updated = await setSubtaskDone(db, user.id, task.subtasks[0].id, true);
    expect(updated.subtasks[0].done).toBe(true);
    await expect(setSubtaskDone(db, other.id, task.subtasks[0].id, false)).rejects.toThrow(NotFoundError);
  });
});
