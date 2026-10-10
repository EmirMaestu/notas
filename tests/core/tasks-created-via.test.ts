import { beforeEach, describe, expect, it } from 'vitest';
import { ValidationError } from '@/core/errors';
import { createTask, getTask, listTasks, updateTask } from '@/core/tasks';
import type { PublicUser as User } from '@/core/users';
import type { DB } from '@/db/types';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
let user: User;

beforeEach(async () => {
  db = await createTestDb();
  user = await createTestUser(db);
});

describe('createdVia', () => {
  it('por defecto queda en null (tareas viejas o importadas)', async () => {
    expect((await createTask(db, user.id, { title: 'A' })).createdVia).toBeNull();
  });

  it('guarda "web" o "mcp:<cliente>" y lo devuelve en las lecturas', async () => {
    const web = await createTask(db, user.id, { title: 'Web', createdVia: 'web' });
    const ai = await createTask(db, user.id, { title: 'IA', createdVia: 'mcp:Claude' });
    expect(web.createdVia).toBe('web');
    expect((await getTask(db, user.id, ai.id)).createdVia).toBe('mcp:Claude');
    expect((await listTasks(db, user.id, { view: 'inbox' })).map((t) => [t.title, t.createdVia])).toEqual([
      ['Web', 'web'], ['IA', 'mcp:Claude'],
    ]);
  });

  it('rechaza cualquier otro valor', async () => {
    for (const createdVia of ['otro', 'mcp:', 'MCP:Claude', `mcp:${'x'.repeat(200)}`, 5 as never]) {
      await expect(createTask(db, user.id, { title: 'A', createdVia })).rejects.toThrow(ValidationError);
    }
  });

  it('no cambia al editar la tarea', async () => {
    const task = await createTask(db, user.id, { title: 'A', createdVia: 'mcp:Claude' });
    expect((await updateTask(db, user.id, task.id, { title: 'B' })).createdVia).toBe('mcp:Claude');
  });
});
