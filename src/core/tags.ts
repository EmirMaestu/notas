import { and, asc, eq, inArray } from 'drizzle-orm';
import { tags } from '@/db/schema';
import type { DB } from '@/db/types';
import { normalizeTagName } from './tag-name';
import { checkColor } from './validation';

export { normalizeTagName };

export type Tag = typeof tags.$inferSelect;

export async function listTags(db: DB, userId: string): Promise<Tag[]> {
  return db.select().from(tags).where(eq(tags.userId, userId)).orderBy(asc(tags.name));
}

/** Devuelve las etiquetas pedidas, creando las que no existen. */
export async function ensureTags(db: DB, userId: string, names: string[]): Promise<Tag[]> {
  const normalized = [...new Set(names.map(normalizeTagName))];
  if (normalized.length === 0) return [];
  await db
    .insert(tags)
    .values(normalized.map((name) => ({ userId, name })))
    .onConflictDoNothing({ target: [tags.userId, tags.name] });
  return db.select().from(tags).where(and(eq(tags.userId, userId), inArray(tags.name, normalized)));
}

/** Crea la etiqueta o devuelve la existente; si se pasa color, lo actualiza. */
export async function createTag(db: DB, userId: string, input: { name: string; color?: string | null }): Promise<Tag> {
  const color = checkColor(input.color);
  const [tag] = await ensureTags(db, userId, [input.name]);
  if (color === undefined) return tag;
  const [updated] = await db.update(tags).set({ color }).where(eq(tags.id, tag.id)).returning();
  return updated;
}
