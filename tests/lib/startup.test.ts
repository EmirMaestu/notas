import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DB } from '@/db/types';
import type { Env } from '@/lib/maintenance';
import { MAINTENANCE_FLAG, startServer } from '@/lib/startup';

function deps(env: Env, getDb: () => Promise<DB> = vi.fn(async () => ({}) as DB)) {
  return {
    getDb,
    env,
    exit: vi.fn(),
    logger: { log: vi.fn(), error: vi.fn() },
    schedule: vi.fn(() => () => {}),
  };
}

const failingDb = () => vi.fn(async (): Promise<DB> => {
  throw new Error('DATABASE_URL no está configurada');
});

describe('startServer', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>)[MAINTENANCE_FLAG];
  });

  it('no programa el mantenimiento dos veces en el mismo proceso', async () => {
    const a = deps({ NODE_ENV: 'production' });
    const b = deps({ NODE_ENV: 'production' });
    await startServer(a);
    await startServer(b);
    expect(a.schedule).toHaveBeenCalledTimes(1);
    expect(b.schedule).not.toHaveBeenCalled();
  });

  it('abre la base (aplica las migraciones) y programa el mantenimiento', async () => {
    const d = deps({ NODE_ENV: 'production' });
    await startServer(d);
    expect(d.getDb).toHaveBeenCalledTimes(1);
    expect(d.logger.log).toHaveBeenCalledWith('[notas] base de datos lista (migraciones aplicadas)');
    expect(d.schedule).toHaveBeenCalledWith({ getDb: d.getDb, logger: d.logger });
    expect(d.exit).not.toHaveBeenCalled();
  });

  it('en producción, si la base falla, sale con código 1 y no programa nada', async () => {
    const d = deps({ NODE_ENV: 'production' }, failingDb());
    await startServer(d);
    expect(d.logger.error).toHaveBeenCalledWith(
      '[notas] no se pudo abrir la base o aplicar las migraciones:', expect.any(Error),
    );
    expect(d.exit).toHaveBeenCalledWith(1);
    expect(d.schedule).not.toHaveBeenCalled();
  });

  it('en desarrollo, si la base falla, lo loguea y sigue (getDb reintenta en la próxima request)', async () => {
    const d = deps({ NODE_ENV: 'development' }, failingDb());
    await startServer(d);
    expect(d.logger.error).toHaveBeenCalled();
    expect(d.exit).not.toHaveBeenCalled();
    expect(d.schedule).toHaveBeenCalledTimes(1);
  });

  it('no programa el mantenimiento en tests ni con NOTAS_DISABLE_MAINTENANCE=1', async () => {
    const enTests = deps({ NODE_ENV: 'test' });
    await startServer(enTests);
    expect(enTests.schedule).not.toHaveBeenCalled();
    const desactivado = deps({ NODE_ENV: 'production', NOTAS_DISABLE_MAINTENANCE: '1' });
    await startServer(desactivado);
    expect(desactivado.getDb).toHaveBeenCalledTimes(1);
    expect(desactivado.schedule).not.toHaveBeenCalled();
  });
});
