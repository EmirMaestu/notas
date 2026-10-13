import { describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { listMembers, lists, notificationDeliveries, pushSubscriptions, taskReminders, tasks, users } from '@/db/schema';
import { createTestDb, createTestUser } from '../helpers/db';

describe('migraciones', () => {
  it('crean todas las tablas', async () => {
    const db = await createTestDb();
    const result = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const names = (result as unknown as { rows: { table_name: string }[] }).rows.map((r) => r.table_name);
    expect(names).toEqual([
      'api_tokens', 'folders', 'list_members', 'lists', 'notification_deliveries', 'oauth_clients', 'oauth_codes',
      'oauth_tokens', 'push_subscriptions', 'sessions', 'subtasks', 'tags', 'task_reminders', 'task_tags', 'tasks', 'users',
    ]);
  });

  it('permite una sola bandeja de entrada por usuario', async () => {
    const db = await createTestDb();
    const user = await createTestUser(db);
    // createUser ya crea la bandeja de entrada.
    await expect(
      db.insert(lists).values({ userId: user.id, name: 'Otra', isInbox: true }),
    ).rejects.toThrow();
    await expect(
      db.insert(lists).values({ userId: user.id, name: 'Normal', isInbox: false }),
    ).resolves.toBeDefined();
  });

  it('list_members no repite miembros; al borrar al usuario se va su membresía y su asignación queda en null', async () => {
    const db = await createTestDb();
    const owner = await createTestUser(db);
    const member = await createTestUser(db, 'miembro@example.com');
    const [list] = await db.insert(lists).values({ userId: owner.id, name: 'Compartida' }).returning();
    await db.insert(listMembers).values({ listId: list.id, userId: member.id });
    await expect(db.insert(listMembers).values({ listId: list.id, userId: member.id })).rejects.toThrow();
    const [task] = await db
      .insert(tasks)
      .values({ userId: owner.id, listId: list.id, title: 'A', assigneeId: member.id })
      .returning();
    await db.delete(users).where(eq(users.id, member.id));
    const [row] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(row.assigneeId).toBeNull();
    expect(await db.select().from(listMembers)).toEqual([]);
  });

  it('preferencias de notificación con valores por defecto', async () => {
    const db = await createTestDb();
    const user = await createTestUser(db);
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row).toMatchObject({
      reminderDefaultMinutes: null, allDayReminderTime: '09:00', digestEnabled: false, digestTime: '08:00', notifyAssigned: true,
    });
  });

  it('task_reminders: una fila por persona y tarea, CHECK de kind/offset y borrado en cascada', async () => {
    const db = await createTestDb();
    const user = await createTestUser(db);
    const [list] = await db.insert(lists).values({ userId: user.id, name: 'L' }).returning();
    const [task] = await db.insert(tasks).values({ userId: user.id, listId: list.id, title: 'A' }).returning();
    await db.insert(taskReminders).values({ taskId: task.id, userId: user.id, kind: 'before', offsetMinutes: 15 });
    await expect(
      db.insert(taskReminders).values({ taskId: task.id, userId: user.id, kind: 'same_day', offsetMinutes: null }),
    ).rejects.toThrow();
    const other = await createTestUser(db, 'otra@example.com');
    // offset fuera de la lista, offset en un kind que no lo usa y kind desconocido: el CHECK los rechaza.
    await expect(db.insert(taskReminders).values({ taskId: task.id, userId: other.id, kind: 'before', offsetMinutes: 7 })).rejects.toThrow();
    await expect(db.insert(taskReminders).values({ taskId: task.id, userId: other.id, kind: 'same_day', offsetMinutes: 5 })).rejects.toThrow();
    await expect(db.insert(taskReminders).values({ taskId: task.id, userId: other.id, kind: 'before', offsetMinutes: null })).rejects.toThrow();
    await db.delete(tasks).where(eq(tasks.id, task.id));
    expect(await db.select().from(taskReminders)).toEqual([]);
  });

  it('push_subscriptions: endpoint único; notification_deliveries: única por (usuario, tipo, clave)', async () => {
    const db = await createTestDb();
    const user = await createTestUser(db);
    const sub = { userId: user.id, endpoint: 'https://push.example.com/a', p256dh: 'p', auth: 'a' };
    await db.insert(pushSubscriptions).values(sub);
    await expect(db.insert(pushSubscriptions).values(sub)).rejects.toThrow();
    const delivery = { userId: user.id, kind: 'digest' as const, fireKey: '2030-01-01' };
    await db.insert(notificationDeliveries).values(delivery);
    await expect(db.insert(notificationDeliveries).values(delivery)).rejects.toThrow();
    await db.insert(notificationDeliveries).values({ ...delivery, kind: 'test' });
    await db.delete(users).where(eq(users.id, user.id));
    expect(await db.select().from(pushSubscriptions)).toEqual([]);
    expect(await db.select().from(notificationDeliveries)).toEqual([]);
  });
});
