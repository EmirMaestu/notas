import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { tasks } from '@/db/schema';
import type { DB } from '@/db/types';
import { ValidationError } from '@/core/errors';
import { createList } from '@/core/lists';
import { completeTask, createTask, deleteTask, listTasks, purgeTrash, searchTasks } from '@/core/tasks';
import type { PublicUser as User } from '@/core/users';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
let user: User;
// 15:00 UTC = 12:00 en Buenos Aires del 8/10
const NOW = new Date('2026-10-08T15:00:00Z');

beforeEach(async () => {
  db = await createTestDb();
  user = await createTestUser(db);
});

const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

describe('vistas', () => {
  beforeEach(async () => {
    await createTask(db, user.id, { title: 'vencida', dueDate: '2026-10-01' });
    await createTask(db, user.id, { title: 'hoy-baja', dueDate: '2026-10-08', priority: 1 });
    await createTask(db, user.id, { title: 'hoy-alta', dueDate: '2026-10-08', priority: 5 });
    await createTask(db, user.id, { title: 'en-6-dias', dueDate: '2026-10-14' });
    await createTask(db, user.id, { title: 'en-7-dias', dueDate: '2026-10-15' });
    await createTask(db, user.id, { title: 'sin-fecha' });
  });

  it('hoy incluye vencidas, ordenadas por fecha y prioridad', async () => {
    expect(titles(await listTasks(db, user.id, { view: 'today', now: NOW }))).toEqual(['vencida', 'hoy-alta', 'hoy-baja']);
  });

  it('próximos 7 días incluye hasta hoy+6', async () => {
    expect(titles(await listTasks(db, user.id, { view: 'next7', now: NOW }))).toEqual(['vencida', 'hoy-alta', 'hoy-baja', 'en-6-dias']);
  });

  it('respeta la zona horaria del usuario', async () => {
    // 02:00 UTC del 9/10 sigue siendo 8/10 en Buenos Aires
    await createTask(db, user.id, { title: 'mañana', dueDate: '2026-10-09' });
    const lateNight = new Date('2026-10-09T02:00:00Z');
    expect(titles(await listTasks(db, user.id, { view: 'today', now: lateNight }))).not.toContain('mañana');
    // 04:00 UTC del 9/10 = 01:00 del 9/10 en Buenos Aires
    const afterMidnight = new Date('2026-10-09T04:00:00Z');
    expect(titles(await listTasks(db, user.id, { view: 'today', now: afterMidnight }))).toContain('mañana');
  });

  it('bandeja muestra pendientes sin fecha al final', async () => {
    const result = titles(await listTasks(db, user.id, { view: 'inbox' }));
    expect(result).toHaveLength(6);
    expect(result.at(-1)).toBe('sin-fecha');
  });
});

describe('filtros', () => {
  it('por lista, por etiqueta, completadas e includeCompleted', async () => {
    const list = await createList(db, user.id, { name: 'Trabajo' });
    await createTask(db, user.id, { title: 'en-lista', listId: list.id, tags: ['urgente'] });
    const done = await createTask(db, user.id, { title: 'hecha', tags: ['urgente'] });
    await completeTask(db, user.id, done.id);
    await createTask(db, user.id, { title: 'suelta' });

    expect(titles(await listTasks(db, user.id, { listId: list.id }))).toEqual(['en-lista']);
    expect(titles(await listTasks(db, user.id, { tag: '#Urgente' }))).toEqual(['en-lista']);
    expect(titles(await listTasks(db, user.id, { tag: 'urgente', includeCompleted: true })).sort()).toEqual(['en-lista', 'hecha']);
    expect(titles(await listTasks(db, user.id, { view: 'completed' }))).toEqual(['hecha']);
  });

  it('papelera', async () => {
    const task = await createTask(db, user.id, { title: 'borrada' });
    await createTask(db, user.id, { title: 'viva' });
    await deleteTask(db, user.id, task.id);
    expect(titles(await listTasks(db, user.id, { view: 'trash' }))).toEqual(['borrada']);
    expect(titles(await listTasks(db, user.id))).toEqual(['viva']);
  });

  it('nunca devuelve tareas de otro usuario', async () => {
    const other = await createTestUser(db, 'otro@example.com');
    await createTask(db, other.id, { title: 'ajena', dueDate: '2026-10-08' });
    expect(await listTasks(db, user.id, { view: 'today', now: NOW })).toEqual([]);
    expect(await searchTasks(db, user.id, 'ajena')).toEqual([]);
  });
});

describe('searchTasks', () => {
  it('busca en título y descripción, sin distinguir mayúsculas', async () => {
    await createTask(db, user.id, { title: 'Llamar al Banco' });
    await createTask(db, user.id, { title: 'Otra', description: 'hablar con el banco' });
    await createTask(db, user.id, { title: 'Nada que ver' });
    expect(titles(await searchTasks(db, user.id, 'BANCO')).sort()).toEqual(['Llamar al Banco', 'Otra']);
  });

  it('rechaza búsquedas vacías o de más de 200 caracteres', async () => {
    await expect(searchTasks(db, user.id, '   ')).rejects.toThrow(ValidationError);
    await expect(searchTasks(db, user.id, 'a'.repeat(201))).rejects.toThrow('200');
    await expect(searchTasks(db, user.id, 'a'.repeat(200))).resolves.toEqual([]);
  });

  it('trata % y _ como texto literal', async () => {
    await createTask(db, user.id, { title: 'Descuento 50%' });
    await createTask(db, user.id, { title: 'Descuento 500' });
    expect(titles(await searchTasks(db, user.id, '50%'))).toEqual(['Descuento 50%']);
  });
});

describe('purgeTrash', () => {
  it('borra definitivamente solo lo que lleva más de 30 días en la papelera', async () => {
    const old = await createTask(db, user.id, { title: 'vieja' });
    const recent = await createTask(db, user.id, { title: 'reciente' });
    await db.update(tasks).set({ deletedAt: new Date('2026-09-01T00:00:00Z') }).where(eq(tasks.id, old.id));
    await db.update(tasks).set({ deletedAt: new Date('2026-10-01T00:00:00Z') }).where(eq(tasks.id, recent.id));
    expect(await purgeTrash(db, NOW)).toBe(1);
    expect(titles(await listTasks(db, user.id, { view: 'trash' }))).toEqual(['reciente']);
  });
});
