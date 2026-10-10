import { createList } from '@/core/lists';
import { addListMember } from '@/core/members';
import type { DB } from '@/db/types';
import { createTestUser } from './db';

/**
 * Dueño con una lista "Compartida" (con un miembro) y una "Privada", más un usuario ajeno.
 * Todos se llaman "Emir" (createTestUser); los emails los distinguen.
 */
export async function createSharingFixture(db: DB) {
  const owner = await createTestUser(db, 'duenio@example.com');
  const member = await createTestUser(db, 'miembro@example.com');
  const stranger = await createTestUser(db, 'ajeno@example.com');
  const shared = await createList(db, owner.id, { name: 'Compartida' });
  const ownerPrivate = await createList(db, owner.id, { name: 'Privada' });
  await addListMember(db, owner.id, shared.id, member.email);
  return { owner, member, stranger, shared, ownerPrivate };
}
