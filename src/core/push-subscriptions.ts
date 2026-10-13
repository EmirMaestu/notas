import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { pushSubscriptions } from '@/db/schema';
import type { DB } from '@/db/types';
import { ValidationError } from './errors';

export const MAX_SUBSCRIPTIONS_PER_USER = 10;
/** Fallos seguidos (que no son 404/410) después de los cuales se da por muerta la suscripción. */
export const MAX_PUSH_FAILURES = 10;
const MAX_ENDPOINT = 2048;
const MAX_P256DH = 200;
const MAX_AUTH = 100;
const MAX_USER_AGENT = 300;
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/** Servicios de push de los navegadores. El servidor hace un POST al endpoint: solo a estos hosts (anti-SSRF). */
const PUSH_HOSTS = new Set(['fcm.googleapis.com', 'web.push.apple.com']);
const PUSH_HOST_SUFFIXES = ['.push.services.mozilla.com', '.notify.windows.com', '.push.apple.com'];
const HOST_MSG = 'El endpoint no es de un servicio de notificaciones conocido';

function isPushServiceUrl(url: URL): boolean {
  if (url.username || url.password || url.port !== '') return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.has(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

/** A dónde se manda (lo mínimo que necesita `web-push`). */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Contenido del aviso (lo lee `public/sw.js`). `url` es relativa al sitio. */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/**
 * Cómo salió un envío:
 * - 'sent': llegó al servicio de push.
 * - 'gone': el servicio respondió 404/410, la suscripción ya no existe (se borra).
 * - 'failed': el servicio rechazó el envío con otro 4xx (menos 429): es culpa de la suscripción, cuenta para borrarla.
 * - 'retry': 429 o 5xx, problema pasajero del servicio: no cuenta.
 * - 'error': sin respuesta HTTP (red, configuración): no cuenta.
 */
export type PushResult = 'sent' | 'gone' | 'failed' | 'retry' | 'error';
export type SendPush = (target: PushTarget, payload: PushPayload) => Promise<PushResult>;

const KEYS_MSG = 'Claves de la suscripción inválidas';

function checkKey(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || !B64URL.test(value)) {
    throw new ValidationError(KEYS_MSG);
  }
  return value;
}

/** Valida lo que manda el navegador (`PushSubscription.toJSON()` más el user agent). */
export function checkPushSubscription(input: unknown): PushTarget & { userAgent: string | null } {
  if (typeof input !== 'object' || input === null) throw new ValidationError('Suscripción inválida');
  const i = input as { endpoint?: unknown; keys?: unknown; userAgent?: unknown };
  if (typeof i.endpoint !== 'string' || i.endpoint.length > MAX_ENDPOINT) throw new ValidationError('Suscripción inválida');
  let url: URL;
  try {
    url = new URL(i.endpoint);
  } catch {
    throw new ValidationError('Suscripción inválida');
  }
  if (url.protocol !== 'https:') throw new ValidationError('La suscripción tiene que usar https');
  if (!isPushServiceUrl(url)) throw new ValidationError(HOST_MSG);
  if (typeof i.keys !== 'object' || i.keys === null) throw new ValidationError(KEYS_MSG);
  const keys = i.keys as { p256dh?: unknown; auth?: unknown };
  return {
    endpoint: i.endpoint,
    p256dh: checkKey(keys.p256dh, MAX_P256DH),
    auth: checkKey(keys.auth, MAX_AUTH),
    userAgent: typeof i.userAgent === 'string' ? i.userAgent.slice(0, MAX_USER_AGENT) : null,
  };
}

/**
 * Guarda la suscripción de este dispositivo. Si el endpoint ya existía (aunque fuera de otra cuenta: mismo
 * navegador, otra sesión), se actualiza y pasa a este usuario. Con más de MAX_SUBSCRIPTIONS_PER_USER se borran
 * las más viejas.
 */
export async function savePushSubscription(
  db: DB, userId: string, input: unknown, now: Date = new Date(),
): Promise<PushSubscriptionRow> {
  const sub = checkPushSubscription(input);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(pushSubscriptions)
      .values({ userId, ...sub, createdAt: now })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId, p256dh: sub.p256dh, auth: sub.auth, userAgent: sub.userAgent, failureCount: 0, createdAt: now },
      })
      .returning();
    const all = await tx
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .orderBy(desc(pushSubscriptions.createdAt), desc(pushSubscriptions.id));
    const extra = all.slice(MAX_SUBSCRIPTIONS_PER_USER).map((s) => s.id);
    if (extra.length > 0) await tx.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, extra));
    return row;
  });
}

/** Borra la suscripción de este dispositivo; solo si es del usuario. */
export async function deletePushSubscription(db: DB, userId: string, endpoint: unknown): Promise<boolean> {
  if (typeof endpoint !== 'string') return false;
  const deleted = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
    .returning({ id: pushSubscriptions.id });
  return deleted.length > 0;
}

/** Las más nuevas primero. */
export function listPushSubscriptions(db: DB, userId: string): Promise<PushSubscriptionRow[]> {
  return db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(desc(pushSubscriptions.createdAt), desc(pushSubscriptions.id));
}

export async function countPushSubscriptions(db: DB, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  return Number(row.n);
}

/** Registra cómo salió un envío: éxito, suscripción muerta (se borra) o rechazo (se cuenta). 'retry' y 'error' no cuentan. */
export async function recordPushResult(db: DB, subscriptionId: string, result: PushResult, now: Date = new Date()): Promise<void> {
  if (result === 'gone') {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscriptionId));
    return;
  }
  if (result === 'sent') {
    await db.update(pushSubscriptions).set({ lastSuccessAt: now, failureCount: 0 }).where(eq(pushSubscriptions.id, subscriptionId));
    return;
  }
  if (result !== 'failed') return;
  const [row] = await db
    .update(pushSubscriptions)
    .set({ failureCount: sql`${pushSubscriptions.failureCount} + 1` })
    .where(eq(pushSubscriptions.id, subscriptionId))
    .returning({ failures: pushSubscriptions.failureCount });
  if (row && row.failures >= MAX_PUSH_FAILURES) {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscriptionId));
  }
}
