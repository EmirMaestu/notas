import type { SendPush } from '@/core/push-subscriptions';
import type { DB } from '@/db/types';
import { maintenanceEnabled, scheduleMaintenance, type Env, type Logger, type ScheduleOptions } from './maintenance';
import { scheduleNotifications as defaultScheduleNotifications, type NotificationScheduleOptions } from './notification-scheduler';
import { getPushSender } from './push';

/** Marca en globalThis: register() puede ejecutarse más de una vez en el mismo proceso (p. ej. HMR en desarrollo). */
export const MAINTENANCE_FLAG = '__notasMaintenanceScheduled';

/** Igual que MAINTENANCE_FLAG, para el programador de notificaciones. */
export const NOTIFICATIONS_FLAG = '__notasNotificationsScheduled';

export interface StartupDeps {
  getDb: () => Promise<DB>;
  env?: Env;
  exit?: (code: number) => void;
  logger?: Logger;
  schedule?: (options: ScheduleOptions) => () => void;
  /** Cómo mandar push; por defecto, el configurado con VAPID_* (null = notificaciones apagadas). */
  pushSender?: SendPush | null;
  scheduleNotifications?: (options: NotificationScheduleOptions) => () => void;
}

/**
 * Se llama una vez al arrancar el servidor (desde src/instrumentation.ts). Abre la base, lo que aplica las
 * migraciones pendientes; en producción, si falla, termina el proceso para que Docker lo reinicie y el
 * despliegue lo detecte (mejor que servir errores 500). Después programa la limpieza diaria y, si hay claves VAPID,
 * el envío de notificaciones cada minuto.
 */
export async function startServer({
  getDb,
  env = process.env,
  exit = (code) => process.exit(code),
  logger = console,
  schedule = scheduleMaintenance,
  pushSender = getPushSender(env),
  scheduleNotifications = defaultScheduleNotifications,
}: StartupDeps): Promise<void> {
  try {
    await getDb();
    logger.log('[notas] base de datos lista (migraciones aplicadas)');
  } catch (err) {
    logger.error('[notas] no se pudo abrir la base o aplicar las migraciones:', err);
    if (env.NODE_ENV === 'production') {
      exit(1);
      return;
    }
  }
  const g = globalThis as Record<string, unknown>;
  if (maintenanceEnabled(env) && !g[MAINTENANCE_FLAG]) {
    g[MAINTENANCE_FLAG] = true;
    schedule({ getDb, logger });
  }
  // Mismo interruptor que la limpieza: nada en tests ni con NOTAS_DISABLE_MAINTENANCE=1 (los e2e).
  if (maintenanceEnabled(env) && !g[NOTIFICATIONS_FLAG]) {
    if (pushSender) {
      g[NOTIFICATIONS_FLAG] = true;
      scheduleNotifications({ getDb, send: pushSender, logger });
      logger.log('[notas] notificaciones push activas');
    } else {
      logger.log('[notas] notificaciones push desactivadas (faltan VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY o VAPID_SUBJECT)');
    }
  }
}
