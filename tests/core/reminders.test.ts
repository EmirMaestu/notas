import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError } from '@/core/errors';
import { createTask, getTask, listTasks, updateTask } from '@/core/tasks';
import { taskReminders, users } from '@/db/schema';
import type { DB } from '@/db/types';
import { createTestDb, createTestUser } from '../helpers/db';
import { createSharingFixture } from '../helpers/sharing';

let db: DB;

beforeEach(async () => {
  db = await createTestDb();
});

describe('recordatorio al crear y modificar', () => {
  it('createTask guarda el recordatorio de quien crea y getTask lo devuelve', async () => {
    const user = await createTestUser(db);
    const task = await createTask(db, user.id, { title: 'Dentista', dueDate: '2030-06-10', dueTime: '15:00', reminder: '30m' });
    expect(task.reminder).toBe('30m');
    expect((await getTask(db, user.id, task.id)).reminder).toBe('30m');
    expect((await listTasks(db, user.id))[0].reminder).toBe('30m');
  });

  it('sin recordatorio, reminder es null', async () => {
    const user = await createTestUser(db);
    const task = await createTask(db, user.id, { title: 'Algo' });
    expect(task.reminder).toBeNull();
  });

  it('updateTask pone, cambia y quita (null) el recordatorio', async () => {
    const user = await createTestUser(db);
    const task = await createTask(db, user.id, { title: 'Pagar luz', dueDate: '2030-06-10' });
    expect((await updateTask(db, user.id, task.id, { reminder: 'day_before' })).reminder).toBe('day_before');
    expect((await updateTask(db, user.id, task.id, { reminder: 'same_day' })).reminder).toBe('same_day');
    expect((await updateTask(db, user.id, task.id, { reminder: null })).reminder).toBeNull();
    expect(await db.select().from(taskReminders)).toEqual([]);
  });

  it('valida: sin fecha, opción «antes» sin hora y valores desconocidos', async () => {
    const user = await createTestUser(db);
    await expect(createTask(db, user.id, { title: 'X', reminder: 'same_day' })).rejects.toThrow('Para poner un recordatorio la tarea necesita fecha');
    await expect(createTask(db, user.id, { title: 'X', dueDate: '2030-06-10', reminder: '15m' })).rejects.toThrow(ValidationError);
    const task = await createTask(db, user.id, { title: 'Y', dueDate: '2030-06-10' });
    // @ts-expect-error valor inválido a propósito
    await expect(updateTask(db, user.id, task.id, { reminder: '2h' })).rejects.toThrow(/Recordatorio inválido/);
    // Se valida contra la fecha/hora que queda: sacar la fecha y poner recordatorio a la vez no se puede.
    await expect(updateTask(db, user.id, task.id, { dueDate: null, reminder: 'same_day' })).rejects.toThrow(/necesita fecha/);
    // Poner hora y una opción «antes» en el mismo cambio sí.
    expect((await updateTask(db, user.id, task.id, { dueTime: '10:00', reminder: '5m' })).reminder).toBe('5m');
  });

  it('cada persona tiene su propio recordatorio en una tarea compartida', async () => {
    const { owner, member, stranger, shared } = await createSharingFixture(db);
    const task = await createTask(db, owner.id, { title: 'Compartida', listId: shared.id, dueDate: '2030-06-10', reminder: 'same_day' });
    expect((await getTask(db, member.id, task.id)).reminder).toBeNull();
    await updateTask(db, member.id, task.id, { reminder: 'day_before' });
    expect((await getTask(db, member.id, task.id)).reminder).toBe('day_before');
    expect((await getTask(db, owner.id, task.id)).reminder).toBe('same_day');
    // Un ajeno no puede poner recordatorios (no ve la tarea).
    await expect(updateTask(db, stranger.id, task.id, { reminder: 'same_day' })).rejects.toThrow(NotFoundError);
  });
});

describe('recordatorio por defecto', () => {
  async function userWithDefault(minutes: number | null) {
    const user = await createTestUser(db);
    await db.update(users).set({ reminderDefaultMinutes: minutes }).where(eq(users.id, user.id));
    return user;
  }

  it('se aplica al crear una tarea con hora', async () => {
    const user = await userWithDefault(15);
    expect((await createTask(db, user.id, { title: 'A', dueDate: '2030-06-10', dueTime: '09:00' })).reminder).toBe('15m');
    // Sin hora no hay recordatorio por defecto.
    expect((await createTask(db, user.id, { title: 'B', dueDate: '2030-06-10' })).reminder).toBeNull();
  });

  it('uno explícito (incluso null) gana sobre el por defecto', async () => {
    const user = await userWithDefault(60);
    expect((await createTask(db, user.id, { title: 'A', dueDate: '2030-06-10', dueTime: '09:00', reminder: 'at_time' })).reminder).toBe('at_time');
    expect((await createTask(db, user.id, { title: 'B', dueDate: '2030-06-10', dueTime: '09:00', reminder: null })).reminder).toBeNull();
  });

  it('se aplica al ponerle hora a una tarea que no tenía, sin pisar uno existente', async () => {
    const user = await userWithDefault(0);
    const task = await createTask(db, user.id, { title: 'A', dueDate: '2030-06-10' });
    expect((await updateTask(db, user.id, task.id, { dueTime: '18:00' })).reminder).toBe('at_time');
    await updateTask(db, user.id, task.id, { reminder: '1h' });
    await updateTask(db, user.id, task.id, { dueTime: null });
    expect((await updateTask(db, user.id, task.id, { dueTime: '19:00' })).reminder).toBe('1h');
  });

  it('sin preferencia no se agrega nada', async () => {
    const user = await userWithDefault(null);
    expect((await createTask(db, user.id, { title: 'A', dueDate: '2030-06-10', dueTime: '09:00' })).reminder).toBeNull();
  });
});
