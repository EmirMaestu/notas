import { describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { listMembers, lists, tasks, users } from '@/db/schema';
import { createTestDb, createTestUser } from '../helpers/db';

describe('migraciones', () => {
  it('crean todas las tablas', async () => {
    const db = await createTestDb();
    const result = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const names = (result as unknown as { rows: { table_name: string }[] }).rows.map((r) => r.table_name);
    expect(names).toEqual([
      'api_tokens', 'folders', 'list_members', 'lists', 'oauth_clients', 'oauth_codes', 'oauth_tokens',
      'sessions', 'subtasks', 'tags', 'task_tags', 'tasks', 'users',
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
});
