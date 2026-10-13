import webpush from 'web-push';
import type { PushPayload, PushResult, PushTarget, SendPush } from '@/core/push-subscriptions';

export type Env = Readonly<Record<string, string | undefined>>;

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** Claves VAPID del entorno, o null si falta alguna (las notificaciones quedan apagadas). */
export function vapidConfig(env: Env = process.env): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (!subject.startsWith('mailto:') && !subject.startsWith('https:')) return null;
  return { publicKey, privateKey, subject };
}

/** Un host cualquiera de push: solo sirve para que `web-push` arme y firme la cabecera VAPID de prueba. */
const PROBE_AUDIENCE = 'https://fcm.googleapis.com';
const checked = new Map<string, boolean>();

/**
 * La configuración VAPID, solo si las claves sirven (se prueba firmando una cabecera). Con claves inválidas
 * (mal copiadas, formato equivocado) lo loguea una sola vez y las notificaciones quedan apagadas, en vez de
 * fallar en cada envío.
 */
export function activeVapidConfig(env: Env = process.env, logger: Pick<Console, 'error'> = console): VapidConfig | null {
  const config = vapidConfig(env);
  if (!config) return null;
  const key = `${config.publicKey}|${config.privateKey}|${config.subject}`;
  let valid = checked.get(key);
  if (valid === undefined) {
    try {
      webpush.getVapidHeaders(PROBE_AUDIENCE, config.subject, config.publicKey, config.privateKey, 'aes128gcm');
      valid = true;
    } catch {
      valid = false;
      logger.error('[push] claves VAPID inválidas: notificaciones desactivadas');
    }
    checked.set(key, valid);
  }
  return valid ? config : null;
}

/** Clave pública para el navegador (`applicationServerKey`), o null si no hay notificaciones. */
export function vapidPublicKey(env: Env = process.env): string | null {
  return activeVapidConfig(env)?.publicKey ?? null;
}

/** Un aviso viejo no sirve: el servicio de push lo descarta si no lo pudo entregar en 1 hora. */
const TTL_SECONDS = 3600;

/** 429 y 5xx son del servicio y pasan solos; otro 4xx es de la suscripción; sin código HTTP no sabemos. */
function classifyFailure(status: unknown): PushResult {
  if (typeof status !== 'number') return 'error';
  if (status === 429 || status >= 500) return 'retry';
  if (status >= 400) return 'failed';
  return 'error';
}

/** `SendPush` real. Las claves van en cada envío (sin estado global de `web-push`). Nunca lanza. */
export function createWebPushSender(config: VapidConfig, logger: Pick<Console, 'error'> = console): SendPush {
  return async (target: PushTarget, payload: PushPayload): Promise<PushResult> => {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        {
          vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
          TTL: TTL_SECONDS, urgency: 'high', timeout: 5000,
        },
      );
      return 'sent';
    } catch (err) {
      const status = typeof err === 'object' && err !== null ? (err as { statusCode?: unknown }).statusCode : undefined;
      if (status === 404 || status === 410) return 'gone';
      // Sin el endpoint en el log: identifica al dispositivo.
      logger.error(`[push] falló un envío (${typeof status === 'number' ? status : 'sin respuesta'})`);
      return classifyFailure(status);
    }
  };
}

const globalForPush = globalThis as unknown as { __notasPushSender?: { key: string; send: SendPush | null } };

/** El `SendPush` configurado con el entorno, o null si no hay claves VAPID. Se cachea por proceso. */
export function getPushSender(env: Env = process.env): SendPush | null {
  const config = activeVapidConfig(env);
  const key = config ? `${config.publicKey}|${config.subject}` : '';
  if (globalForPush.__notasPushSender?.key !== key) {
    globalForPush.__notasPushSender = { key, send: config ? createWebPushSender(config) : null };
  }
  return globalForPush.__notasPushSender.send;
}
