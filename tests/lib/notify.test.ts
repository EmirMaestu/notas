import { describe, expect, it, vi } from 'vitest';
import { savePushSubscription } from '@/core/push-subscriptions';
import { createTask } from '@/core/tasks';
import { assignmentChanged, notifyAssignmentSafely } from '@/lib/notify';
import { createTestDb } from '../helpers/db';
import { fakeSender, subscriptionInput } from '../helpers/push';
import { createSharingFixture } from '../helpers/sharing';

describe('assignmentChanged', () => {
  it('solo cuando queda asignada a otra persona distinta de antes', () => {
    expect(assignmentChanged(null, 'b', 'a')).toBe(true);
    expect(assignmentChanged('c', 'b', 'a')).toBe(true);
    expect(assignmentChanged('b', 'b', 'a')).toBe(false); // no cambió
    expect(assignmentChanged(null, 'a', 'a')).toBe(false); // me la asigné yo
    expect(assignmentChanged('b', null, 'a')).toBe(false); // se quitó
  });
});

describe('notifyAssignmentSafely', () => {
  it('avisa; sin sender no hace nada; un error no se propaga', async () => {
    const db = await createTestDb();
    const { owner, member, shared } = await createSharingFixture(db);
    await savePushSubscription(db, member.id, subscriptionInput(2));
    const task = await createTask(db, owner.id, { title: 'Comprar pan', listId: shared.id, assigneeId: member.id });
    const { send, calls } = fakeSender();
    await notifyAssignmentSafely(db, owner.id, task.id, send);
    expect(calls).toHaveLength(1);
    await expect(notifyAssignmentSafely(db, owner.id, task.id, null)).resolves.toBeUndefined();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { ...db, select: () => { throw new Error('base caída'); } } as unknown as typeof db;
    await expect(notifyAssignmentSafely(broken, owner.id, task.id, send)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
