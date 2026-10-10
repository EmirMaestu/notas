import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '@/db/types';
import type { List } from '@/core/lists';
import { listTags } from '@/core/tags';
import { createTask, getTask, listTasks, updateTask } from '@/core/tasks';
import type { PublicUser as User } from '@/core/users';
import { createTestDb } from '../helpers/db';
import { createSharingFixture } from '../helpers/sharing';

let db: DB;
let owner: User;
let member: User;
let stranger: User;
let shared: List;

beforeEach(async () => {
  db = await createTestDb();
  ({ owner, member, stranger, shared } = await createSharingFixture(db));
});

const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();

describe('etiquetas en tareas compartidas', () => {
  it('cada uno ve las suyas en `tags` y las de los demás en `otherTags` (sin repetir)', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id, tags: ['casa', 'urgente'] });
    const seenByMember = await updateTask(db, member.id, t.id, { tags: ['mia', 'casa'] });
    expect(seenByMember.tags).toEqual(['casa', 'mia']);
    expect(seenByMember.otherTags).toEqual(['urgente']); // 'casa' ya es propia: no se repite
    const seenByOwner = await getTask(db, owner.id, t.id);
    expect(seenByOwner.tags).toEqual(['casa', 'urgente']);
    expect(seenByOwner.otherTags).toEqual(['mia']);
  });

  it('una tarea sin etiquetas de otros tiene otherTags vacío', async () => {
    expect((await createTask(db, owner.id, { title: 'A', tags: ['x'] })).otherTags).toEqual([]);
  });

  it('editar etiquetas no borra las de otros usuarios', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id, tags: ['casa'] });
    await updateTask(db, member.id, t.id, { tags: ['mia'] });
    await updateTask(db, member.id, t.id, { tags: [] });
    expect((await getTask(db, owner.id, t.id)).tags).toEqual(['casa']);
    expect((await getTask(db, member.id, t.id)).tags).toEqual([]);
  });

  it('la vista por etiqueta usa solo las etiquetas propias, sobre las tareas accesibles', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id, tags: ['casa'] });
    await createTask(db, stranger.id, { title: 'Ajena', tags: ['casa'] });
    expect(await listTasks(db, member.id, { tag: 'casa' })).toEqual([]);
    await updateTask(db, member.id, t.id, { tags: ['casa'] });
    expect(titles(await listTasks(db, member.id, { tag: 'casa' }))).toEqual(['A']);
    expect(titles(await listTasks(db, owner.id, { tag: 'casa' }))).toEqual(['A']);
  });

  it('las etiquetas de otros no aparecen en la barra lateral (listTags)', async () => {
    await createTask(db, owner.id, { title: 'A', listId: shared.id, tags: ['urgente'] });
    expect(await listTags(db, member.id)).toEqual([]);
  });
});
