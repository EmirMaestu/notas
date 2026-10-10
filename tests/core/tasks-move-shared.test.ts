import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '@/db/types';
import { ValidationError } from '@/core/errors';
import { createList, getInbox, type List } from '@/core/lists';
import { addListMember } from '@/core/members';
import { createTask, moveTask } from '@/core/tasks';
import type { PublicUser as User } from '@/core/users';
import { createTestDb, createTestUser } from '../helpers/db';
import { createSharingFixture } from '../helpers/sharing';

const MOVE_MSG = 'Solo podés mover tareas de una lista compartida a otras listas del mismo dueño';

let db: DB;
let owner: User;
let member: User;
let shared: List;
let ownerPrivate: List;
let ownerOther: List;
let thirdOwner: User;
let thirdList: List;

beforeEach(async () => {
  db = await createTestDb();
  ({ owner, member, shared, ownerPrivate } = await createSharingFixture(db));
  // Otra lista del mismo dueño en la que el miembro también participa.
  ownerOther = await createList(db, owner.id, { name: 'Otra compartida' });
  await addListMember(db, owner.id, ownerOther.id, member.email);
  // Una lista de un tercer dueño donde tanto el miembro como el dueño original participan.
  thirdOwner = await createTestUser(db, 'tercero@example.com');
  thirdList = await createList(db, thirdOwner.id, { name: 'Del tercero' });
  await addListMember(db, thirdOwner.id, thirdList.id, member.email);
  await addListMember(db, thirdOwner.id, thirdList.id, owner.email);
});

describe('moveTask desde una lista compartida', () => {
  it('un miembro no puede llevarla a su propia Bandeja', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id });
    const inbox = await getInbox(db, member.id);
    const err = await moveTask(db, member.id, t.id, inbox.id).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe(MOVE_MSG);
  });

  it('un miembro puede moverla a otra lista del mismo dueño a la que accede', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id });
    expect((await moveTask(db, member.id, t.id, ownerOther.id)).listId).toBe(ownerOther.id);
  });

  it('un miembro no puede llevarla a la lista de un tercer dueño', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id });
    await expect(moveTask(db, member.id, t.id, thirdList.id)).rejects.toThrow(MOVE_MSG);
  });

  it('el dueño la mueve a cualquier lista accesible', async () => {
    const inbox = await getInbox(db, owner.id);
    for (const target of [ownerPrivate, thirdList, inbox]) {
      const t = await createTask(db, owner.id, { title: 'A', listId: shared.id });
      expect((await moveTask(db, owner.id, t.id, target.id)).listId).toBe(target.id);
    }
  });
});
