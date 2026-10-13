import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFolder, updateList } from '@/core/lists';
import { createTask } from '@/core/tasks';
import type { DB } from '@/db/types';
import { TOOLS, callTool, type ToolContext } from '@/mcp/tools';
import { createTestDb, createTestUser } from '../helpers/db';
import { createSharingFixture } from '../helpers/sharing';
import { callError, callOk } from '../helpers/mcp';

let db: DB;
let ctx: ToolContext;
let other: ToolContext;

beforeEach(async () => {
  db = await createTestDb();
  ctx = { db, userId: (await createTestUser(db)).id };
  other = { db, userId: (await createTestUser(db, 'otra@example.com')).id };
});

describe('despachador', () => {
  it('cada herramienta tiene nombre único, título y descripción', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of TOOLS) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it('herramienta desconocida o argumentos inválidos → isError', async () => {
    expect(await callTool(ctx, 'no_existe', {})).toEqual({
      content: [{ type: 'text', text: 'Herramienta desconocida: no_existe' }], isError: true,
    });
    expect(await callError(ctx, 'create_list', { nombre: 'x' })).toContain('Argumentos inválidos');
    expect(await callError(ctx, 'create_list', { name: 5 })).toContain('Argumentos inválidos');
  });

  it('errores de dominio → isError con su mensaje; inesperados → mensaje genérico y log', async () => {
    const [inbox] = (await callOk(ctx, 'list_lists')).lists;
    expect(await callError(ctx, 'update_list', { list_id: inbox.id, name: 'Otra' })).toBe('La Bandeja no se puede renombrar');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = {
      db: new Proxy({}, { get() { throw new Error('conexión caída 10.0.0.5'); } }) as unknown as DB,
      userId: ctx.userId,
    };
    const message = await callError(broken, 'list_lists');
    expect(message).toBe('Ocurrió un error inesperado en Notas. Probá de nuevo más tarde.');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('get_today_context', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('usa la zona horaria del usuario', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T02:30:00Z')); // 23:30 del viernes 9 en Buenos Aires
    expect(await callOk(ctx, 'get_today_context')).toEqual({
      today: '2026-10-09', weekday: 'viernes', time: '23:30', timezone: 'America/Argentina/Buenos_Aires',
      user: { email: 'emir@example.com', name: 'Emir' },
    });
  });
});

describe('listas', () => {
  it('crear, listar, modificar y borrar', async () => {
    const created = await callOk(ctx, 'create_list', { name: 'Casa', color: '#ff0000' });
    expect(created).toEqual({
      id: expect.any(String), name: 'Casa', folder: null, color: '#ff0000', is_inbox: false, role: 'owner', shared: false,
    });
    expect((await callOk(ctx, 'list_lists')).lists.map((l: { name: string }) => l.name)).toEqual(['Bandeja', 'Casa']);

    const updated = await callOk(ctx, 'update_list', { list_id: created.id, name: 'Hogar', color: null });
    expect(updated).toMatchObject({ name: 'Hogar', color: null });

    await createTask(db, ctx.userId, { title: 'Barrer', listId: created.id });
    expect(await callOk(ctx, 'delete_list', { list_id: created.id })).toEqual({ deleted: true, moved_to_trash: 1 });
    expect(await callError(ctx, 'create_list', { name: '   ' })).toBe('El nombre no puede estar vacío');
  });

  it('list_lists y las mutaciones incluyen la carpeta (nombre) para distinguir listas con el mismo nombre', async () => {
    const rider = await createFolder(db, ctx.userId, { name: 'Rider G' });
    const sitrack = await createFolder(db, ctx.userId, { name: 'Sitrack' });
    const a = await callOk(ctx, 'create_list', { name: 'Tareas' });
    const b = await callOk(ctx, 'create_list', { name: 'Tareas' });
    await updateList(db, ctx.userId, a.id, { folderId: rider.id });
    await updateList(db, ctx.userId, b.id, { folderId: sitrack.id });
    const { lists } = await callOk(ctx, 'list_lists');
    expect(lists.map((l: { id: string; name: string; folder: string | null }) => [l.id, l.name, l.folder])).toEqual([
      [lists[0].id, 'Bandeja', null], [a.id, 'Tareas', 'Rider G'], [b.id, 'Tareas', 'Sitrack'],
    ]);
    expect(await callOk(ctx, 'update_list', { list_id: a.id, color: '#00ff00' })).toMatchObject({ id: a.id, folder: 'Rider G' });
  });

  it('las listas compartidas conmigo no muestran la carpeta del dueño', async () => {
    const { owner, member, shared } = await createSharingFixture(db);
    await updateList(db, owner.id, shared.id, { folderId: (await createFolder(db, owner.id, { name: 'Del dueño' })).id });
    const mine = (await callOk({ db, userId: member.id }, 'list_lists')).lists.find((l: { id: string }) => l.id === shared.id);
    expect(mine).toMatchObject({ role: 'member', folder: null });
    expect((await callOk({ db, userId: owner.id }, 'list_lists')).lists.find((l: { id: string }) => l.id === shared.id))
      .toMatchObject({ role: 'owner', folder: 'Del dueño' });
  });

  it('las descripciones avisan que los nombres pueden repetirse y que hay que usar ids', () => {
    for (const name of ['list_lists', 'list_tasks', 'move_task']) {
      expect(TOOLS.find((t) => t.name === name)!.description).toMatch(/se repit|repet/);
    }
  });

  it('no deja tocar listas de otro usuario', async () => {
    const created = await callOk(ctx, 'create_list', { name: 'Privada' });
    expect(await callError(other, 'update_list', { list_id: created.id, name: 'Mía' })).toBe('La lista no existe; usá list_lists');
    expect(await callError(other, 'delete_list', { list_id: created.id })).toBe('La lista no existe; usá list_lists');
  });
});

describe('etiquetas', () => {
  it('crear (normaliza el nombre) y listar', async () => {
    expect(await callOk(ctx, 'create_tag', { name: '#Casa', color: '#00ff00' })).toEqual({ name: 'casa', color: '#00ff00' });
    expect(await callOk(ctx, 'list_tags')).toEqual({ tags: [{ name: 'casa', color: '#00ff00' }] });
    expect(await callOk(other, 'list_tags')).toEqual({ tags: [] });
  });
});
