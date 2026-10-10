import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import * as schema from './schema';
import type { DB } from './types';

const MIGRATIONS = path.join(process.cwd(), 'drizzle');

// Se cachea en globalThis para sobrevivir al hot reload de Next.js en desarrollo.
const globalForDb = globalThis as unknown as { __notasDb?: Promise<DB> };

/**
 * Conexión única a la base, con migraciones aplicadas.
 * - Con DATABASE_URL: PostgreSQL (producción).
 * - Sin DATABASE_URL en desarrollo: PGlite en disco (PGLITE_DIR o .data/pglite).
 */
export function getDb(): Promise<DB> {
  globalForDb.__notasDb ??= connect().catch((err) => {
    globalForDb.__notasDb = undefined;
    throw err;
  });
  return globalForDb.__notasDb;
}

/**
 * Solo para tests: hace que getDb() devuelva esta base (undefined = olvidarla). Así los route handlers
 * se prueban contra PGlite en memoria. Lanza fuera de Vitest (que pone NODE_ENV=test).
 */
export function setDbForTests(db: DB | undefined): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('setDbForTests solo se puede usar en tests');
  globalForDb.__notasDb = db ? Promise.resolve(db) : undefined;
}

async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import('postgres');
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    const sql = postgres(url);
    const db = drizzle(sql, { schema });
    try {
      await migrate(db, { migrationsFolder: MIGRATIONS });
    } catch (err) {
      await sql.end(); // no dejar la conexión abierta si fallan las migraciones
      throw err;
    }
    return db;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL no está configurada');
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), '.data', 'pglite');
  await mkdir(dir, { recursive: true }); // PGlite no crea los directorios intermedios (.data)
  // Un directorio de PGlite solo puede abrirlo un proceso a la vez.
  const pg = new PGlite(dir);
  const db = drizzle(pg, { schema });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS });
  } catch (err) {
    await pg.close();
    throw err;
  }
  return db as unknown as DB;
}
