import { describe, expect, it } from 'vitest';
import { createTask, deleteTask, emptyTrash, listTasks } from '@/core/tasks';
import { createTestDb } from '../helpers/db';
import { createSharingFixture } from '../helpers/sharing';

describe('emptyTrash', () => {
  it('borra para siempre solo lo que está en la papelera de listas propias', async () => {
    const db = await createTestDb();
    const { owner, member, shared, ownerPrivate } = await createSharingFixture(db);
    const pending = await createTask(db, owner.id, { title: 'Pendiente', listId: ownerPrivate.id });
    const mine = await createTask(db, owner.id, { title: 'Borrada mía', listId: ownerPrivate.id });
    const inShared = await createTask(db, member.id, { title: 'Borrada en compartida', listId: shared.id });
    const memberOwn = await createTask(db, member.id, { title: 'Borrada del miembro' });
    await deleteTask(db, owner.id, mine.id);
    await deleteTask(db, member.id, inShared.id);
    await deleteTask(db, member.id, memberOwn.id);

    // El miembro vacía: se va lo de su Bandeja, no lo de la lista compartida (es del dueño).
    expect(await emptyTrash(db, member.id)).toEqual({ deleted: 1, remaining: 1 });
    expect((await listTasks(db, member.id, { view: 'trash' })).map((t) => t.title)).toEqual(['Borrada en compartida']);

    // El dueño vacía: se van la suya y la de su lista compartida; la pendiente queda.
    expect(await emptyTrash(db, owner.id)).toEqual({ deleted: 2, remaining: 0 });
    expect(await listTasks(db, owner.id, { view: 'trash' })).toEqual([]);
    expect((await listTasks(db, owner.id, { listId: ownerPrivate.id })).map((t) => t.id)).toEqual([pending.id]);
  });
});
