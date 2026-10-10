import type { PgDatabase } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

// `any` en el HKT permite pasar tanto la base de producción (postgres.js) como la de tests (PGlite).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DB = PgDatabase<any, typeof schema>;
