import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/health/route';
import { setDbForTests } from '@/db';
import type { DB } from '@/db/types';
import { createTestDb } from '../helpers/db';

afterEach(() => {
  setDbForTests(undefined);
  vi.restoreAllMocks();
});

describe('/api/health', () => {
  it('200 con la base sana', async () => {
    setDbForTests(await createTestDb());
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('503 sin detalles si la base no responde', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setDbForTests({
      execute: async () => {
        throw new Error('conexión rechazada');
      },
    } as unknown as DB);
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'error' });
    expect(consoleError).toHaveBeenCalled();
  });
});
