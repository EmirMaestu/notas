import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '@/db/types';
import type { List } from '@/core/lists';
import { addListMember, leaveList, removeListMember } from '@/core/members';
import { createTask, getTask, listTasks, moveTask, updateTask } from '@/core/tasks';
import type { PublicUser as User } from '@/core/users';
import { createTestDb } from '../helpers/db';
import { createSharingFixture } from '../helpers/sharing';

let db: DB;
let owner: User;
let member: User;
let stranger: User;
let shared: List;
let ownerPrivate: List;

beforeEach(async () => {
  db = await createTestDb();
  ({ owner, member, stranger, shared, ownerPrivate } = await createSharingFixture(db));
});

const ASSIGNEE_MSG = 'Solo se puede asignar la tarea al dueño o a un miembro de la lista';

describe('asignación', () => {
  it('se asigna al dueño o a un miembro, y null la quita', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id, assigneeId: member.id });
    expect(t.assigneeId).toBe(member.id);
    expect(t.assignee).toEqual({ id: member.id, email: 'miembro@example.com', name: 'Emir' });
    expect((await updateTask(db, member.id, t.id, { assigneeId: owner.id })).assignee?.id).toBe(owner.id);
    const cleared = await updateTask(db, owner.id, t.id, { assigneeId: null });
    expect(cleared.assigneeId).toBeNull();
    expect(cleared.assignee).toBeNull();
    expect((await createTask(db, owner.id, { title: 'B' })).assignee).toBeNull();
  });

  it('updateTask sin assigneeId conserva la asignación', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id, assigneeId: member.id });
    expect((await updateTask(db, owner.id, t.id, { title: 'B' })).assigneeId).toBe(member.id);
  });

  it('no se puede asignar a alguien sin acceso a la lista', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id });
    for (const bad of [stranger.id, 'basura', 5 as unknown as string]) {
      await expect(updateTask(db, owner.id, t.id, { assigneeId: bad })).rejects.toThrow(ASSIGNEE_MSG);
    }
    await expect(
      createTask(db, owner.id, { title: 'B', listId: ownerPrivate.id, assigneeId: member.id }),
    ).rejects.toThrow(ASSIGNEE_MSG);
    expect(await listTasks(db, owner.id, { listId: ownerPrivate.id })).toEqual([]);
    expect((await getTask(db, owner.id, t.id)).assigneeId).toBeNull();
  });

  it('mover a una lista donde el asignado no tiene acceso limpia la asignación', async () => {
    const toMember = await createTask(db, owner.id, { title: 'A', listId: shared.id, assigneeId: member.id });
    const toOwner = await createTask(db, owner.id, { title: 'B', listId: shared.id, assigneeId: owner.id });
    expect((await moveTask(db, owner.id, toMember.id, ownerPrivate.id)).assignee).toBeNull();
    expect((await moveTask(db, owner.id, toOwner.id, ownerPrivate.id)).assigneeId).toBe(owner.id);
  });

  it('quitar al miembro o que salga limpia sus asignaciones en la lista', async () => {
    const a = await createTask(db, owner.id, { title: 'A', listId: shared.id, assigneeId: member.id });
    await removeListMember(db, owner.id, shared.id, member.id);
    expect((await getTask(db, owner.id, a.id)).assignee).toBeNull();

    const b = await createTask(db, owner.id, { title: 'B', listId: shared.id });
    await addListMember(db, owner.id, shared.id, member.email);
    await updateTask(db, member.id, b.id, { assigneeId: member.id });
    await leaveList(db, member.id, shared.id);
    expect((await getTask(db, owner.id, b.id)).assigneeId).toBeNull();
  });
});
