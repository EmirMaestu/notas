import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationsReport } from '@/core/notifications';
import type { SendPush } from '@/core/push-subscriptions';
import type { DB } from '@/db/types';
import { NOTIFICATIONS_INTERVAL_MS, scheduleNotifications, type NotificationsRun } from '@/lib/notification-scheduler';

const T0 = new Date('2030-01-01T00:00:00Z');
const NONE: NotificationsReport = { reminders: 0, digests: 0 };

describe('scheduleNotifications', () => {
  const fakeDb = {} as DB;
  const send: SendPush = async () => 'sent';

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(run = vi.fn<NotificationsRun>(async () => NONE)) {
    const logger = { log: vi.fn(), error: vi.fn() };
    const getDb = vi.fn(async () => fakeDb);
    const stop = scheduleNotifications({ getDb, send, run, logger, now: () => T0 });
    return { run, logger, stop };
  }

  it('corre cada minuto con la base, el reloj y el send', async () => {
    const { run, stop } = setup();
    await vi.advanceTimersByTimeAsync(NOTIFICATIONS_INTERVAL_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledWith(fakeDb, T0, send);
    await vi.advanceTimersByTimeAsync(2 * NOTIFICATIONS_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(5 * NOTIFICATIONS_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('loguea solo cuando mandó algo', async () => {
    const run = vi.fn<NotificationsRun>()
      .mockResolvedValueOnce(NONE)
      .mockResolvedValueOnce({ reminders: 2, digests: 1 });
    const { logger, stop } = setup(run);
    await vi.advanceTimersByTimeAsync(2 * NOTIFICATIONS_INTERVAL_MS);
    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith('[notificaciones] recordatorios: 2, resúmenes: 1');
    stop();
  });

  it('no se solapa con una corrida lenta y un error solo se loguea', async () => {
    let finish: () => void = () => {};
    const run = vi.fn<NotificationsRun>()
      .mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve(NONE); }))
      .mockRejectedValueOnce(new Error('boom'));
    const { logger, stop } = setup(run);
    await vi.advanceTimersByTimeAsync(3 * NOTIFICATIONS_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(1); // la primera sigue corriendo
    finish();
    await vi.advanceTimersByTimeAsync(NOTIFICATIONS_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith('[notificaciones] falló:', expect.any(Error));
    stop();
  });
});
