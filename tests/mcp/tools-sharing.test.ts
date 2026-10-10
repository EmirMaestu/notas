import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '@/db/types';
import { shareLimiter } from '@/lib/limits';
import type { ToolContext } from '@/mcp/tools';
import { createTestDb, createTestUser } from '../helpers/db';
import { callError, callOk } from '../helpers/mcp';
import { createSharingFixture } from '../helpers/sharing';

let db: DB;

beforeEach(async () => {
  db = await createTestDb();
});

describe('subtareas', () => {
  it('agregar, modificar y borrar', async () => {
    const ctx: ToolContext = { db, userId: (await createTestUser(db)).id };
    const task = await callOk(ctx, 'create_task', { title: 'Viaje' });
    const withOne = await callOk(ctx, 'add_subtask', { task_id: task.id, title: 'Pasaje' });
    const [sub] = withOne.subtasks;
    expect(sub).toEqual({ id: expect.any(String), title: 'Pasaje', done: false });
    expect((await callOk(ctx, 'update_subtask', { subtask_id: sub.id, done: true })).subtasks[0].done).toBe(true);
    expect((await callOk(ctx, 'update_subtask', { subtask_id: sub.id, title: 'Pasaje ida' })).subtasks[0].title).toBe('Pasaje ida');
    expect((await callOk(ctx, 'delete_subtask', { subtask_id: sub.id })).subtasks).toEqual([]);
    expect(await callError(ctx, 'delete_subtask', { subtask_id: sub.id })).toBe('La subtarea no existe; usá get_task para ver las subtareas');
  });
});

describe('listas compartidas', () => {
  it('el dueño comparte por email y ve los miembros; un miembro no puede compartir', async () => {
    const { owner, member, stranger, ownerPrivate, shared } = await createSharingFixture(db);
    const ownerCtx = { db, userId: owner.id };
    expect(await callOk(ownerCtx, 'share_list', { list_id: ownerPrivate.id, email: 'AJENO@example.com' }))
      .toEqual({ email: stranger.email, name: 'Emir', role: 'member' });
    expect(await callOk(ownerCtx, 'list_members', { list_id: ownerPrivate.id })).toEqual({
      members: [
        { email: owner.email, name: 'Emir', role: 'owner' },
        { email: stranger.email, name: 'Emir', role: 'member' },
      ],
    });
    expect(await callError(ownerCtx, 'share_list', { list_id: ownerPrivate.id, email: 'nadie@example.com' }))
      .toBe('No hay ninguna cuenta con ese email');
    expect(await callError({ db, userId: member.id }, 'share_list', { list_id: shared.id, email: stranger.email }))
      .toBe('Solo el dueño de la lista puede administrar sus miembros');
  });

  it('el dueño quita miembros por email; el miembro puede salir y el dueño no', async () => {
    const { owner, member, shared } = await createSharingFixture(db);
    const ownerCtx = { db, userId: owner.id };
    const memberCtx = { db, userId: member.id };
    expect(await callError(ownerCtx, 'unshare_list', { list_id: shared.id, email: 'nadie@example.com' }))
      .toBe('El miembro no existe');
    expect(await callError(ownerCtx, 'unshare_list', { list_id: shared.id, email: owner.email }))
      .toBe('El miembro no existe');
    expect(await callOk(ownerCtx, 'unshare_list', { list_id: shared.id, email: ' Miembro@Example.com ' }))
      .toEqual({ removed: member.email });
    expect(await callError(memberCtx, 'list_members', { list_id: shared.id })).toBe('La lista no existe; usá list_lists');

    await callOk(ownerCtx, 'share_list', { list_id: shared.id, email: member.email });
    expect(await callOk(memberCtx, 'leave_list', { list_id: shared.id })).toEqual({ left: true, list_id: shared.id });
    expect(await callError(ownerCtx, 'leave_list', { list_id: shared.id })).toBe('El dueño no puede salir de su propia lista');
  });

  it('share_list se limita a 20 intentos por hora y usuario', async () => {
    const { owner, ownerPrivate } = await createSharingFixture(db);
    const ownerCtx = { db, userId: owner.id };
    for (let i = 0; i < 20; i++) {
      expect(await callError(ownerCtx, 'share_list', { list_id: ownerPrivate.id, email: `x${i}@example.com` }))
        .toBe('No hay ninguna cuenta con ese email');
    }
    expect(await callError(ownerCtx, 'share_list', { list_id: ownerPrivate.id, email: 'y@example.com' }))
      .toBe('Compartiste demasiadas veces seguidas. Probá más tarde.');
  });
});

describe('límite compartido de altas de miembros', () => {
  it('share_list usa el mismo limitador que la web (lib/limits)', async () => {
    const ctx: ToolContext = { db, userId: (await createTestUser(db)).id };
    const list = await callOk(ctx, 'create_list', { name: 'Compartida' });
    for (let i = 0; i < 20; i++) shareLimiter.check(ctx.userId); // cupo gastado, p. ej. desde la web
    expect(await callError(ctx, 'share_list', { list_id: list.id, email: 'nadie@example.com' }))
      .toBe('Compartiste demasiadas veces seguidas. Probá más tarde.');
    shareLimiter.reset(ctx.userId);
  });
});
