import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient } from '@/core/oauth';
import { createSession, getSessionUser } from '@/core/sessions';
import { createTask, listTasks } from '@/core/tasks';
import { tasks } from '@/db/schema';
import type { DB } from '@/db/types';
import {
  MAINTENANCE_INITIAL_DELAY_MS, MAINTENANCE_INTERVAL_MS, formatMaintenanceReport, maintenanceEnabled,
  runMaintenance, scheduleMaintenance, type MaintenanceReport, type MaintenanceRun,
} from '@/lib/maintenance';
import { createTestDb, createTestUser } from '../helpers/db';
import { createTestClient } from '../helpers/oauth';

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-01-01T00:00:00Z');
const EMPTY: MaintenanceReport = { sessions: 0, trash: 0, oauthCodes: 0, oauthTokens: 0, oauthClients: 0, deliveries: 0 };

describe('runMaintenance', () => {
  it('borra sesiones vencidas, papelera vieja y clientes OAuth huérfanos; lo vigente queda', async () => {
    const db = await createTestDb();
    const user = await createTestUser(db);
    const now = new Date(T0.getTime() + 40 * DAY);
    await createSession(db, user.id, T0); // vence a los 30 días
    const live = await createSession(db, user.id, now);
    const old = await createTask(db, user.id, { title: 'vieja' });
    const recent = await createTask(db, user.id, { title: 'reciente' });
    await db.update(tasks).set({ deletedAt: T0 }).where(eq(tasks.id, old.id));
    await db.update(tasks).set({ deletedAt: new Date(now.getTime() - DAY) }).where(eq(tasks.id, recent.id));
    const orphan = await createTestClient(db, undefined, T0);

    expect(await runMaintenance(db, now)).toEqual({
      sessions: 1, trash: 1, oauthCodes: 0, oauthTokens: 0, oauthClients: 1, deliveries: 0,
    });
    expect(await getSessionUser(db, live.token, now)).not.toBeNull();
    expect((await listTasks(db, user.id, { view: 'trash' })).map((t) => t.title)).toEqual(['reciente']);
    expect(await getClient(db, orphan.clientId)).toBeNull();
    // Idempotente: una segunda pasada no encuentra nada.
    expect(await runMaintenance(db, now)).toEqual(EMPTY);
  });
});

describe('formatMaintenanceReport', () => {
  it('resume los conteos en una línea de log', () => {
    expect(formatMaintenanceReport({ sessions: 1, trash: 2, oauthCodes: 3, oauthTokens: 4, oauthClients: 5, deliveries: 6 }))
      .toBe('[mantenimiento] sesiones vencidas: 1, papelera: 2, OAuth: 3 códigos, 4 tokens, 5 clientes, avisos: 6');
  });
});

describe('maintenanceEnabled', () => {
  it('corre en producción y desarrollo; no en tests ni con NOTAS_DISABLE_MAINTENANCE=1', () => {
    expect(maintenanceEnabled({ NODE_ENV: 'production' })).toBe(true);
    expect(maintenanceEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(maintenanceEnabled({ NODE_ENV: 'production', NOTAS_DISABLE_MAINTENANCE: '0' })).toBe(true);
    expect(maintenanceEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(maintenanceEnabled({ NODE_ENV: 'production', NOTAS_DISABLE_MAINTENANCE: '1' })).toBe(false);
  });
});

describe('scheduleMaintenance', () => {
  const fakeDb = {} as DB;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(run = vi.fn<MaintenanceRun>(async () => EMPTY)) {
    const logger = { log: vi.fn(), error: vi.fn() };
    const getDb = vi.fn(async () => fakeDb);
    const stop = scheduleMaintenance({ getDb, run, logger, now: () => T0 });
    return { run, logger, getDb, stop };
  }

  it('corre 1 minuto después de arrancar y luego cada 24 h, y loguea el resultado', async () => {
    const { run, logger, stop } = setup();
    await vi.advanceTimersByTimeAsync(MAINTENANCE_INITIAL_DELAY_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(fakeDb, T0);
    expect(logger.log).toHaveBeenCalledWith(formatMaintenanceReport(EMPTY));
    await vi.advanceTimersByTimeAsync(MAINTENANCE_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it('un error se loguea y no corta las corridas siguientes', async () => {
    const run = vi.fn<MaintenanceRun>().mockRejectedValueOnce(new Error('base caída')).mockResolvedValue(EMPTY);
    const { logger, stop } = setup(run);
    await vi.advanceTimersByTimeAsync(MAINTENANCE_INITIAL_DELAY_MS);
    expect(logger.error).toHaveBeenCalledWith('[mantenimiento] falló:', expect.any(Error));
    await vi.advanceTimersByTimeAsync(MAINTENANCE_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    expect(logger.log).toHaveBeenCalledTimes(1);
    stop();
  });

  it('no se solapa si una corrida tarda más que el intervalo', async () => {
    const run = vi.fn<MaintenanceRun>(() => new Promise<MaintenanceReport>(() => {}));
    const logger = { log: vi.fn(), error: vi.fn() };
    const stop = scheduleMaintenance({ getDb: async () => fakeDb, run, logger, initialDelayMs: 0, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stop() cancela lo programado', async () => {
    const { run, stop } = setup();
    stop();
    await vi.advanceTimersByTimeAsync(MAINTENANCE_INITIAL_DELAY_MS + MAINTENANCE_INTERVAL_MS);
    expect(run).not.toHaveBeenCalled();
  });
});
