import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, todayIn } from '@/core/dates';
import { DEFAULT_TIMEZONE } from '@/core/users';
import type { DB } from '@/db/types';
import type { ToolContext } from '@/mcp/tools';
import { createTestDb, createTestUser } from '../helpers/db';
import { callError, callOk } from '../helpers/mcp';
import { createSharingFixture } from '../helpers/sharing';

let db: DB;
let ctx: ToolContext;

beforeEach(async () => {
  db = await createTestDb();
  ctx = { db, userId: (await createTestUser(db)).id };
});

const TASK_KEYS = [
  'assignee', 'completed_at', 'deleted_at', 'description', 'due_date', 'due_time', 'id', 'list_id', 'list_name',
  'other_tags', 'priority', 'status', 'subtasks', 'tags', 'title',
];

describe('crear y leer tareas', () => {
  it('create_task con todos los campos devuelve la tarea compacta', async () => {
    const list = await callOk(ctx, 'create_list', { name: 'Casa' });
    const task = await callOk(ctx, 'create_task', {
      title: 'Pagar luz', description: 'Antes del 15', list_id: list.id, due_date: '2026-10-20', due_time: '09:30',
      priority: 5, tags: ['#Casa', 'pagos'], subtasks: ['Buscar factura', 'Pagar'],
    });
    expect(Object.keys(task).sort()).toEqual(TASK_KEYS);
    expect(task).toMatchObject({
      title: 'Pagar luz', description: 'Antes del 15', list_id: list.id, list_name: 'Casa', due_date: '2026-10-20',
      due_time: '09:30', priority: 5, status: 'pending', completed_at: null, deleted_at: null,
      tags: ['casa', 'pagos'], other_tags: [], assignee: null,
    });
    expect(task.subtasks.map((s: { title: string; done: boolean }) => [s.title, s.done]))
      .toEqual([['Buscar factura', false], ['Pagar', false]]);
    expect(await callOk(ctx, 'get_task', { task_id: task.id })).toEqual(task);
  });

  it('sin lista va a la Bandeja', async () => {
    expect(await callOk(ctx, 'create_task', { title: 'Suelta' })).toMatchObject({ list_name: 'Bandeja', priority: 0 });
  });

  it('valida fechas, horas, prioridades y claves desconocidas', async () => {
    expect(await callError(ctx, 'create_task', { title: 'X', due_date: '10/10/2026' }))
      .toContain('Fecha inválida (formato YYYY-MM-DD)');
    expect(await callError(ctx, 'create_task', { title: 'X', due_date: '2026-10-10', due_time: '9:30' }))
      .toContain('Hora inválida (formato HH:mm, 24 hs)');
    expect(await callError(ctx, 'create_task', { title: 'X', priority: 2 })).toContain('Argumentos inválidos');
    expect(await callError(ctx, 'create_task', { title: 'X', dueDate: '2026-10-10' })).toContain('Argumentos inválidos');
  });

  it('list_tasks: vistas, filtros y paginación', async () => {
    const today = todayIn(DEFAULT_TIMEZONE);
    await callOk(ctx, 'create_task', { title: 'Hoy', due_date: today, tags: ['casa'] });
    await callOk(ctx, 'create_task', { title: 'En 3 días', due_date: addDays(today, 3) });
    await callOk(ctx, 'create_task', { title: 'Sin fecha' });
    const titles = async (args: Record<string, unknown>) =>
      (await callOk(ctx, 'list_tasks', args)).tasks.map((t: { title: string }) => t.title);
    expect(await titles({ view: 'today' })).toEqual(['Hoy']);
    expect(await titles({ view: 'next7' })).toEqual(['Hoy', 'En 3 días']);
    expect(await titles({ view: 'inbox' })).toEqual(['Hoy', 'En 3 días', 'Sin fecha']);
    expect(await titles({ tag: 'casa' })).toEqual(['Hoy']);
    expect(await callOk(ctx, 'list_tasks', { view: 'inbox', limit: 2 })).toMatchObject({ count: 2, has_more: true });
    expect(await callOk(ctx, 'list_tasks', { view: 'inbox', limit: 2, offset: 2 })).toMatchObject({ count: 1, has_more: false });
    expect(await callError(ctx, 'list_tasks', { view: 'mañana' })).toContain('Argumentos inválidos');
  });

  it('search_tasks busca en título y descripción', async () => {
    await callOk(ctx, 'create_task', { title: 'Comprar pan', description: 'integral' });
    await callOk(ctx, 'create_task', { title: 'Llamar a Ana' });
    const found = await callOk(ctx, 'search_tasks', { query: 'INTEGRAL' });
    expect(found.tasks.map((t: { title: string }) => t.title)).toEqual(['Comprar pan']);
    expect(await callError(ctx, 'search_tasks', { query: '  ' })).toBe('La búsqueda no puede estar vacía');
    expect(found.has_more).toBe(false);
  });

  it('search_tasks informa has_more cuando llega al tope de 50', async () => {
    for (let i = 0; i < 51; i++) await callOk(ctx, 'create_task', { title: `Pendiente ${i}` });
    const found = await callOk(ctx, 'search_tasks', { query: 'Pendiente' });
    expect(found.tasks).toHaveLength(50);
    expect(found.has_more).toBe(true);
  });

  it('los listados recortan descripciones largas; get_task las da completas', async () => {
    const long = 'a'.repeat(250);
    const created = await callOk(ctx, 'create_task', { title: 'Larga', description: long });
    expect(created.description).toBe(long);
    expect(created).not.toHaveProperty('description_truncated');
    await callOk(ctx, 'create_task', { title: 'Corta', description: 'a'.repeat(200) });
    const inbox = (await callOk(ctx, 'list_tasks', { view: 'inbox' })).tasks;
    for (const found of [inbox, (await callOk(ctx, 'search_tasks', { query: 'Larga' })).tasks]) {
      const task = found.find((t: { title: string }) => t.title === 'Larga');
      expect(task.description).toBe(`${'a'.repeat(200)}…`);
      expect(task.description_truncated).toBe(true);
    }
    const short = inbox.find((t: { title: string }) => t.title === 'Corta');
    expect(short.description).toHaveLength(200);
    expect(short).not.toHaveProperty('description_truncated');
    expect((await callOk(ctx, 'get_task', { task_id: created.id })).description).toBe(long);
  });

  it('completed_at y deleted_at salen como YYYY-MM-DD HH:mm en la zona del usuario', async () => {
    const task = await callOk(ctx, 'create_task', { title: 'Hecha' });
    const done = await callOk(ctx, 'complete_task', { task_id: task.id });
    expect(done.completed_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    await callOk(ctx, 'delete_task', { task_id: task.id });
    const deleted = await callOk(ctx, 'get_task', { task_id: task.id, include_deleted: true });
    expect(deleted.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('un id que no existe sugiere cómo obtener ids válidos', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    expect(await callError(ctx, 'get_task', { task_id: missing })).toBe('La tarea no existe; usá list_tasks o search_tasks para obtener ids válidos');
    expect(await callError(ctx, 'move_task', { task_id: missing, list_id: (await callOk(ctx, 'create_list', { name: 'X' })).id })).toBe('La tarea no existe; usá list_tasks o search_tasks para obtener ids válidos');
    expect(await callError(ctx, 'list_members', { list_id: missing })).toBe('La lista no existe; usá list_lists');
    expect(await callError(ctx, 'update_subtask', { subtask_id: missing, done: true }))
      .toBe('La subtarea no existe; usá get_task para ver las subtareas');
    expect(await callError(ctx, 'get_task', { task_id: 'no-es-uuid' })).toContain('Argumentos inválidos');
  });
});

describe('modificar tareas', () => {
  it('update_task cambia solo lo enviado; null quita la fecha (y la hora)', async () => {
    const task = await callOk(ctx, 'create_task', {
      title: 'A', due_date: '2026-10-20', due_time: '10:00', tags: ['uno'], subtasks: ['s1', 's2'],
    });
    const [s1] = task.subtasks;
    const updated = await callOk(ctx, 'update_task', {
      task_id: task.id, title: 'B', due_date: null, tags: ['dos'],
      subtasks: [{ id: s1.id, title: 's1 editada', done: true }, { title: 's3' }],
    });
    expect(updated).toMatchObject({ title: 'B', due_date: null, due_time: null, tags: ['dos'], priority: 0 });
    expect(updated.subtasks).toEqual([
      { id: s1.id, title: 's1 editada', done: true }, { id: expect.any(String), title: 's3', done: false },
    ]);
  });

  it('completar, reabrir, mover, borrar y restaurar', async () => {
    const list = await callOk(ctx, 'create_list', { name: 'Trabajo' });
    const task = await callOk(ctx, 'create_task', { title: 'Informe' });
    expect(await callOk(ctx, 'complete_task', { task_id: task.id })).toMatchObject({ status: 'completed' });
    expect((await callOk(ctx, 'list_tasks', { view: 'completed' })).count).toBe(1);
    expect(await callOk(ctx, 'uncomplete_task', { task_id: task.id })).toMatchObject({ status: 'pending', completed_at: null });
    expect(await callOk(ctx, 'move_task', { task_id: task.id, list_id: list.id })).toMatchObject({ list_name: 'Trabajo' });
    expect(await callOk(ctx, 'delete_task', { task_id: task.id })).toEqual({ deleted: true, task_id: task.id });
    expect(await callError(ctx, 'get_task', { task_id: task.id })).toBe('La tarea no existe; usá list_tasks o search_tasks para obtener ids válidos');
    expect((await callOk(ctx, 'get_task', { task_id: task.id, include_deleted: true })).deleted_at).not.toBeNull();
    expect((await callOk(ctx, 'list_tasks', { view: 'trash' })).count).toBe(1);
    expect(await callOk(ctx, 'restore_task', { task_id: task.id })).toMatchObject({ deleted_at: null });
  });
});

describe('asignación y aislamiento', () => {
  it('asigna por email a quien tiene acceso a la lista y se puede quitar', async () => {
    const { owner, member, stranger, shared } = await createSharingFixture(db);
    const ownerCtx = { db, userId: owner.id };
    const task = await callOk(ownerCtx, 'create_task', {
      title: 'Compartida', list_id: shared.id, assignee_email: 'MIEMBRO@example.com',
    });
    expect(task.assignee).toBe(member.email);
    expect(await callError(ownerCtx, 'update_task', { task_id: task.id, assignee_email: stranger.email }))
      .toContain('Esa persona no tiene acceso a la lista');
    expect(await callError(ownerCtx, 'create_task', { title: 'X', assignee_email: member.email }))
      .toContain('Esa persona no tiene acceso a la lista');
    expect(await callOk(ownerCtx, 'update_task', { task_id: task.id, assignee_email: null })).toMatchObject({ assignee: null });
    // El miembro la ve en su lista compartida.
    const memberView = await callOk({ db, userId: member.id }, 'list_tasks', { list_id: shared.id });
    expect(memberView.tasks.map((t: { title: string }) => t.title)).toEqual(['Compartida']);
  });

  it('un usuario no ve ni toca tareas de otro', async () => {
    const task = await callOk(ctx, 'create_task', { title: 'Secreta' });
    const other = { db, userId: (await createTestUser(db, 'otra@example.com')).id };
    expect(await callError(other, 'get_task', { task_id: task.id })).toBe('La tarea no existe; usá list_tasks o search_tasks para obtener ids válidos');
    expect(await callError(other, 'complete_task', { task_id: task.id })).toBe('La tarea no existe; usá list_tasks o search_tasks para obtener ids válidos');
    expect(await callError(other, 'delete_task', { task_id: task.id })).toBe('La tarea no existe; usá list_tasks o search_tasks para obtener ids válidos');
    expect((await callOk(other, 'search_tasks', { query: 'Secreta' })).tasks).toEqual([]);
  });
});
