import { purgeOldDeliveries } from '@/core/notifications';
import { purgeExpiredOAuthData } from '@/core/oauth';
import { purgeExpiredSessions } from '@/core/sessions';
import { purgeTrash } from '@/core/tasks';
import type { DB } from '@/db/types';

/** Primera limpieza: 1 minuto después de arrancar (no compite con el arranque ni con el primer tráfico). */
export const MAINTENANCE_INITIAL_DELAY_MS = 60_000;
/** Después, una vez por día. */
export const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface MaintenanceReport {
  sessions: number;
  trash: number;
  oauthCodes: number;
  oauthTokens: number;
  oauthClients: number;
  deliveries: number;
}

export type MaintenanceRun = (db: DB, now: Date) => Promise<MaintenanceReport>;
export type Env = Readonly<Record<string, string | undefined>>;
export type Logger = Pick<Console, 'log' | 'error'>;

/**
 * Limpieza de TODOS los usuarios: sesiones vencidas, tareas con más de 30 días en la papelera y datos OAuth
 * vencidos (códigos, tokens y clientes de registro dinámico huérfanos) y el registro de avisos de más de 30 días.
 * Idempotente.
 */
export async function runMaintenance(db: DB, now: Date = new Date()): Promise<MaintenanceReport> {
  const sessions = await purgeExpiredSessions(db, now);
  const trash = await purgeTrash(db, now);
  const oauth = await purgeExpiredOAuthData(db, now);
  const deliveries = await purgeOldDeliveries(db, now);
  return {
    sessions, trash, oauthCodes: oauth.codes, oauthTokens: oauth.tokens, oauthClients: oauth.clients, deliveries,
  };
}

export function formatMaintenanceReport(r: MaintenanceReport): string {
  return `[mantenimiento] sesiones vencidas: ${r.sessions}, papelera: ${r.trash}, `
    + `OAuth: ${r.oauthCodes} códigos, ${r.oauthTokens} tokens, ${r.oauthClients} clientes, avisos: ${r.deliveries}`;
}

/** La limpieza programada no corre en tests ni si se desactiva con NOTAS_DISABLE_MAINTENANCE=1. */
export function maintenanceEnabled(env: Env = process.env): boolean {
  return env.NODE_ENV !== 'test' && env.NOTAS_DISABLE_MAINTENANCE !== '1';
}

export interface ScheduleOptions {
  getDb: () => Promise<DB>;
  run?: MaintenanceRun;
  logger?: Logger;
  initialDelayMs?: number;
  intervalMs?: number;
  now?: () => Date;
}

/**
 * Programa la limpieza: una vez a los `initialDelayMs` y después cada `intervalMs`. Los timers no mantienen vivo
 * el proceso (`unref`), una corrida nunca se solapa con la anterior y un error solo se loguea.
 * Devuelve una función que cancela lo programado.
 */
export function scheduleMaintenance({
  getDb,
  run = runMaintenance,
  logger = console,
  initialDelayMs = MAINTENANCE_INITIAL_DELAY_MS,
  intervalMs = MAINTENANCE_INTERVAL_MS,
  now = () => new Date(),
}: ScheduleOptions): () => void {
  let running = false;
  let interval: ReturnType<typeof setInterval> | undefined;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const report = await run(await getDb(), now());
      logger.log(formatMaintenanceReport(report));
    } catch (err) {
      logger.error('[mantenimiento] falló:', err);
    } finally {
      running = false;
    }
  };

  const first = setTimeout(() => {
    void tick();
    interval = setInterval(() => void tick(), intervalMs);
    interval.unref?.();
  }, initialDelayMs);
  first.unref?.();

  return () => {
    clearTimeout(first);
    if (interval) clearInterval(interval);
  };
}
