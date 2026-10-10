import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '@/db/types';
import { ValidationError } from '@/core/errors';
import { createTag, ensureTags, listTags, normalizeTagName } from '@/core/tags';
import type { PublicUser as User } from '@/core/users';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
let user: User;
beforeEach(async () => {
  db = await createTestDb();
  user = await createTestUser(db);
});

describe('etiquetas', () => {
  it('normaliza nombres', () => {
    expect(normalizeTagName('  #Casa ')).toBe('casa');
    expect(() => normalizeTagName('#')).toThrow(ValidationError);
    expect(() => normalizeTagName('dos palabras')).toThrow(ValidationError);
  });

  it('limita el largo y rechaza comas y # internos', () => {
    expect(normalizeTagName('a'.repeat(50))).toBe('a'.repeat(50));
    expect(() => normalizeTagName('a'.repeat(51))).toThrow('50 caracteres');
    expect(() => normalizeTagName('a,b')).toThrow(ValidationError);
    expect(() => normalizeTagName('a#b')).toThrow(ValidationError);
    expect(normalizeTagName('##casa')).toBe('casa');
  });

  it('createTag valida el color', async () => {
    await expect(createTag(db, user.id, { name: 'x', color: 'rojo' })).rejects.toThrow(ValidationError);
    expect((await createTag(db, user.id, { name: 'y', color: '#ff0000' })).color).toBe('#ff0000');
    expect((await createTag(db, user.id, { name: 'y', color: '' })).color).toBeNull();
  });

  it('createTag es idempotente y guarda color', async () => {
    const a = await createTag(db, user.id, { name: 'Casa', color: '#ff0000' });
    const b = await createTag(db, user.id, { name: '#casa' });
    expect(b.id).toBe(a.id);
    expect(b.color).toBe('#ff0000');
    expect((await listTags(db, user.id)).map((t) => t.name)).toEqual(['casa']);
  });

  it('ensureTags crea solo las que faltan', async () => {
    await createTag(db, user.id, { name: 'casa' });
    const tags = await ensureTags(db, user.id, ['Casa', 'super', 'super']);
    expect(tags.map((t) => t.name).sort()).toEqual(['casa', 'super']);
    expect(await listTags(db, user.id)).toHaveLength(2);
    expect(await ensureTags(db, user.id, [])).toEqual([]);
  });

  it('las etiquetas son por usuario', async () => {
    const other = await createTestUser(db, 'otro@example.com');
    await createTag(db, other.id, { name: 'secreta' });
    expect(await listTags(db, user.id)).toEqual([]);
  });
});
