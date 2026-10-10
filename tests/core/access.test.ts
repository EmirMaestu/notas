import { beforeEach, describe, expect, it } from 'vitest';
import { inArray, type SQLWrapper } from 'drizzle-orm';
import { listMembers, lists } from '@/db/schema';
import type { DB } from '@/db/types';
import {
  accessibleListIds, canAccessList, getAccessibleList, memberListIds, ownedListIds, requireListOwner,
} from '@/core/access';
import { NotFoundError, ValidationError } from '@/core/errors';
import { createList, getInbox, type List } from '@/core/lists';
import type { PublicUser as User } from '@/core/users';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
let owner: User;
let member: User;
let stranger: User;
let shared: List;

beforeEach(async () => {
  db = await createTestDb();
  owner = await createTestUser(db, 'duenio@example.com');
  member = await createTestUser(db, 'miembro@example.com');
  stranger = await createTestUser(db, 'ajeno@example.com');
  shared = await createList(db, owner.id, { name: 'Compartida' });
  await db.insert(listMembers).values({ listId: shared.id, userId: member.id });
});

/** Ids de lista que devuelve una subconsulta, ordenados. */
async function idsOf(sub: SQLWrapper): Promise<string[]> {
  const rows = await db.select({ id: lists.id }).from(lists).where(inArray(lists.id, sub));
  return rows.map((r) => r.id).sort();
}

describe('subconsultas de acceso', () => {
  it('accessibleListIds: listas propias más las compartidas conmigo', async () => {
    const memberInbox = await getInbox(db, member.id);
    const ownerInbox = await getInbox(db, owner.id);
    const strangerInbox = await getInbox(db, stranger.id);
    expect(await idsOf(accessibleListIds(db, member.id))).toEqual([memberInbox.id, shared.id].sort());
    expect(await idsOf(accessibleListIds(db, owner.id))).toEqual([ownerInbox.id, shared.id].sort());
    expect(await idsOf(accessibleListIds(db, stranger.id))).toEqual([strangerInbox.id]);
  });

  it('ownedListIds y memberListIds', async () => {
    expect(await idsOf(ownedListIds(db, member.id))).toEqual([(await getInbox(db, member.id)).id]);
    expect(await idsOf(memberListIds(db, member.id))).toEqual([shared.id]);
    expect(await idsOf(memberListIds(db, owner.id))).toEqual([]);
  });
});

describe('getAccessibleList', () => {
  it('devuelve la lista con el rol de quien consulta', async () => {
    expect(await getAccessibleList(db, owner.id, shared.id)).toMatchObject({ list: { id: shared.id }, role: 'owner' });
    expect(await getAccessibleList(db, member.id, shared.id)).toMatchObject({ list: { id: shared.id }, role: 'member' });
  });

  it('un ajeno, un id inválido o inexistente es NotFoundError', async () => {
    await expect(getAccessibleList(db, stranger.id, shared.id)).rejects.toThrow(NotFoundError);
    await expect(getAccessibleList(db, member.id, 'basura')).rejects.toThrow(NotFoundError);
    await expect(getAccessibleList(db, member.id, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(NotFoundError);
  });
});

describe('requireListOwner y canAccessList', () => {
  it('dueño ok, miembro ValidationError, ajeno NotFoundError', async () => {
    expect((await requireListOwner(db, owner.id, shared.id, 'borrarla')).id).toBe(shared.id);
    const err = await requireListOwner(db, member.id, shared.id, 'borrarla').catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe('Solo el dueño de la lista puede borrarla');
    await expect(requireListOwner(db, stranger.id, shared.id, 'borrarla')).rejects.toThrow(NotFoundError);
  });

  it('canAccessList', async () => {
    expect(await canAccessList(db, owner.id, shared.id)).toBe(true);
    expect(await canAccessList(db, member.id, shared.id)).toBe(true);
    expect(await canAccessList(db, stranger.id, shared.id)).toBe(false);
    expect(await canAccessList(db, 'basura', shared.id)).toBe(false);
    expect(await canAccessList(db, member.id, 'basura')).toBe(false);
  });
});
