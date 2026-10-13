import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DB } from '@/db/types';
import type { Env } from '@/lib/maintenance';
import type { SendPush } from '@/core/push-subscriptions';
import { MAINTENANCE_FLAG, NOTIFICATIONS_FLAG, startServer } from '@/lib/startup';

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

describe('notificaciones al arrancar', () => {
  const g = globalThis as Record<string, unknown>;
  beforeEach(() => {
    delete g[MAINTENANCE_FLAG];
    delete g[NOTIFICATIONS_FLAG];
  });

  function withPush(env: Env, pushSender: SendPush | null) {
    return { ...deps(env), pushSender, scheduleNotifications: vi.fn(() => () => {}) };
  }

  it('con claves VAPID programa el envío una sola vez por proceso', async () => {
    const send = vi.fn<SendPush>();
    const a = withPush({ NODE_ENV: 'production' }, send);
    await startServer(a);
    expect(a.scheduleNotifications).toHaveBeenCalledWith({ getDb: a.getDb, send, logger: a.logger });
    expect(a.logger.log).toHaveBeenCalledWith('[notas] notificaciones push activas');
    const b = withPush({ NODE_ENV: 'production' }, send);
    await startServer(b);
    expect(b.scheduleNotifications).not.toHaveBeenCalled();
  });

  it('sin claves no programa nada y lo dice en el log', async () => {
    const d = withPush({ NODE_ENV: 'production' }, null);
    await startServer(d);
    expect(d.scheduleNotifications).not.toHaveBeenCalled();
    expect(d.logger.log).toHaveBeenCalledWith(
      '[notas] notificaciones push desactivadas (faltan VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY o VAPID_SUBJECT)',
    );
  });

  it('en tests o con NOTAS_DISABLE_MAINTENANCE=1 tampoco', async () => {
    const send = vi.fn<SendPush>();
    const enTests = withPush({ NODE_ENV: 'test' }, send);
    await startServer(enTests);
    const desactivado = withPush({ NODE_ENV: 'production', NOTAS_DISABLE_MAINTENANCE: '1' }, send);
    await startServer(desactivado);
    expect(enTests.scheduleNotifications).not.toHaveBeenCalled();
    expect(desactivado.scheduleNotifications).not.toHaveBeenCalled();
  });
});
