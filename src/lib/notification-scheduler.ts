import { runNotifications, type NotificationsReport } from '@/core/notifications';
import type { SendPush } from '@/core/push-subscriptions';
import type { DB } from '@/db/types';
import type { Logger } from './maintenance';

/** Cada minuto: los recordatorios tienen una ventana de 10 min, así que un tick perdido no pierde avisos. */
export const NOTIFICATIONS_INTERVAL_MS = 60_000;

export type NotificationsRun = (db: DB, now: Date, send: SendPush) => Promise<NotificationsReport>;

export interface NotificationScheduleOptions {
  getDb: () => Promise<DB>;
  send: SendPush;
  run?: NotificationsRun;
  logger?: Logger;
  intervalMs?: number;
  now?: () => Date;
}

/**
 * Programa el envío de notificaciones cada `intervalMs`. El timer no mantiene vivo el proceso (`unref`), una
 * corrida nunca se solapa con la anterior y un error solo se loguea. Devuelve una función que lo cancela.
 */
export function scheduleNotifications({
  getDb,
  send,
  run = runNotifications,
  logger = console,
  intervalMs = NOTIFICATIONS_INTERVAL_MS,
  now = () => new Date(),
}: NotificationScheduleOptions): () => void {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const report = await run(await getDb(), now(), send);
      if (report.reminders > 0 || report.digests > 0) {
        logger.log(`[notificaciones] recordatorios: ${report.reminders}, resúmenes: ${report.digests}`);
      }
    } catch (err) {
      logger.error('[notificaciones] falló:', err);
    } finally {
      running = false;
    }
  };

  const interval = setInterval(() => void tick(), intervalMs);
  interval.unref?.();
  return () => clearInterval(interval);
}
