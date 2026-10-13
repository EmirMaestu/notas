import { beforeEach, describe, expect, it } from 'vitest';
import { savePushSubscription } from '@/core/push-subscriptions';
import type { DB } from '@/db/types';
import type { ToolContext } from '@/mcp/tools';
import { createTestDb } from '../helpers/db';
import { callError, callOk } from '../helpers/mcp';
import { fakeSender, subscriptionInput } from '../helpers/push';
import { createSharingFixture } from '../helpers/sharing';

let db: DB;
let fixture: Awaited<ReturnType<typeof createSharingFixture>>;
let sender: ReturnType<typeof fakeSender>;
let owner: ToolContext;
let member: ToolContext;

beforeEach(async () => {
  db = await createTestDb();
  fixture = await createSharingFixture(db);
  sender = fakeSender();
  owner = { db, userId: fixture.owner.id, sendPush: sender.send };
  member = { db, userId: fixture.member.id, sendPush: sender.send };
  await savePushSubscription(db, fixture.member.id, subscriptionInput(2));
});

describe('reminder', () => {
  it('create_task y update_task ponen, cambian y quitan el recordatorio de quien llama', async () => {
    const task = await callOk(owner, 'create_task', { title: 'Dentista', due_date: '2030-06-10', due_time: '15:00', reminder: '30m' });
    expect(task.reminder).toBe('30m');
    expect((await callOk(owner, 'get_task', { task_id: task.id })).reminder).toBe('30m');
    expect((await callOk(owner, 'update_task', { task_id: task.id, reminder: 'at_time' })).reminder).toBe('at_time');
    expect((await callOk(owner, 'update_task', { task_id: task.id, reminder: null })).reminder).toBeNull();
  });

  it('valida la opción y que la tarea tenga fecha (y hora para las opciones «antes»)', async () => {
    expect(await callError(owner, 'create_task', { title: 'X', due_date: '2030-06-10', reminder: '2h' })).toContain('Argumentos inválidos');
    expect(await callError(owner, 'create_task', { title: 'X', reminder: 'same_day' })).toContain('necesita fecha');
    expect(await callError(owner, 'create_task', { title: 'X', due_date: '2030-06-10', reminder: '15m' })).toContain('same_day');
    const ok = await callOk(owner, 'create_task', { title: 'Luz', due_date: '2030-06-10', reminder: 'day_before' });
    expect(ok.reminder).toBe('day_before');
  });

  it('cada persona ve y pone solo el suyo', async () => {
    const task = await callOk(owner, 'create_task', {
      title: 'Compartida', list_id: fixture.shared.id, due_date: '2030-06-10', reminder: 'same_day',
    });
    expect((await callOk(member, 'get_task', { task_id: task.id })).reminder).toBeNull();
    await callOk(member, 'update_task', { task_id: task.id, reminder: 'day_before' });
    expect((await callOk(owner, 'get_task', { task_id: task.id })).reminder).toBe('same_day');
    expect((await callOk(member, 'list_tasks', { list_id: fixture.shared.id })).tasks[0].reminder).toBe('day_before');
  });
});

describe('aviso de asignación por MCP', () => {
  it('create_task con assignee_email avisa a la persona asignada', async () => {
    const task = await callOk(owner, 'create_task', {
      title: 'Comprar pan', list_id: fixture.shared.id, assignee_email: fixture.member.email,
    });
    expect(sender.calls).toEqual([{
      endpoint: 'https://push.example.com/send/2',
      payload: { title: 'Te asignaron una tarea', body: 'Emir te asignó «Comprar pan»', url: `/app/assigned?t=${task.id}`, tag: `assigned-${task.id}` },
    }]);
  });

  it('update_task avisa solo si la asignación cambia a otra persona', async () => {
    const task = await callOk(owner, 'create_task', { title: 'Comprar pan', list_id: fixture.shared.id });
    expect(sender.calls).toHaveLength(0);
    await callOk(owner, 'update_task', { task_id: task.id, assignee_email: fixture.member.email });
    expect(sender.calls).toHaveLength(1);
    await callOk(owner, 'update_task', { task_id: task.id, assignee_email: fixture.member.email }); // igual que antes
    await callOk(owner, 'update_task', { task_id: task.id, title: 'Comprar pan integral' }); // sin tocar la asignación
    await callOk(member, 'update_task', { task_id: task.id, assignee_email: fixture.owner.email }); // se la pasa al dueño (sin dispositivos)
    expect(sender.calls).toHaveLength(1);
  });

  it('sin sender (notificaciones apagadas) asigna igual', async () => {
    const off: ToolContext = { db, userId: fixture.owner.id, sendPush: null };
    const task = await callOk(off, 'create_task', { title: 'Sin push', list_id: fixture.shared.id, assignee_email: fixture.member.email });
    expect(task.assignee).toBe(fixture.member.email);
    expect(sender.calls).toHaveLength(0);
  });
});
