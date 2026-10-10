import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTask } from '@/core/tasks';
import type { DB } from '@/db/types';
import { TOOLS, callTool, type ToolContext } from '@/mcp/tools';
import { createTestDb, createTestUser } from '../helpers/db';
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
      id: expect.any(String), name: 'Casa', color: '#ff0000', is_inbox: false, role: 'owner', shared: false,
    });
    expect((await callOk(ctx, 'list_lists')).lists.map((l: { name: string }) => l.name)).toEqual(['Bandeja', 'Casa']);

    const updated = await callOk(ctx, 'update_list', { list_id: created.id, name: 'Hogar', color: null });
    expect(updated).toMatchObject({ name: 'Hogar', color: null });

    await createTask(db, ctx.userId, { title: 'Barrer', listId: created.id });
    expect(await callOk(ctx, 'delete_list', { list_id: created.id })).toEqual({ deleted: true, moved_to_trash: 1 });
    expect(await callError(ctx, 'create_list', { name: '   ' })).toBe('El nombre no puede estar vacío');
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
