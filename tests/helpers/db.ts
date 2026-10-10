import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { createUser } from '@/core/users';
import * as schema from '@/db/schema';
import type { DB } from '@/db/types';

/** Base Postgres en memoria con las migraciones reales aplicadas. */
export async function createTestDb(): Promise<DB> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: './drizzle' });
  return db as unknown as DB;
}

export async function createTestUser(db: DB, email = 'emir@example.com') {
  return createUser(db, { email, password: 'contraseña-segura', name: 'Emir' });
}
