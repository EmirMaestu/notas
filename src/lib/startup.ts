import type { DB } from '@/db/types';
import { maintenanceEnabled, scheduleMaintenance, type Env, type Logger, type ScheduleOptions } from './maintenance';

/** Marca en globalThis: register() puede ejecutarse más de una vez en el mismo proceso (p. ej. HMR en desarrollo). */
export const MAINTENANCE_FLAG = '__notasMaintenanceScheduled';

export interface StartupDeps {
  getDb: () => Promise<DB>;
  env?: Env;
  exit?: (code: number) => void;
  logger?: Logger;
  schedule?: (options: ScheduleOptions) => () => void;
}

/**
 * Se llama una vez al arrancar el servidor (desde src/instrumentation.ts). Abre la base, lo que aplica las
 * migraciones pendientes; en producción, si falla, termina el proceso para que Docker lo reinicie y el
 * despliegue lo detecte (mejor que servir errores 500). Después programa la limpieza diaria.
 */
export async function startServer({
  getDb,
  env = process.env,
  exit = (code) => process.exit(code),
  logger = console,
  schedule = scheduleMaintenance,
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
}
