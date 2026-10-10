import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDb, setDbForTests } from '@/db';
import { createTestDb } from '../helpers/db';

describe('setDbForTests', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    setDbForTests(undefined);
  });

  it('hace que getDb devuelva la base inyectada', async () => {
    const db = await createTestDb();
    setDbForTests(db);
    expect(await getDb()).toBe(db);
  });

  it('fuera de los tests lanza', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => setDbForTests(undefined)).toThrow('solo se puede usar en tests');
  });
});
