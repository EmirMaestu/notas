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

/** Clave pública para el navegador (`applicationServerKey`), o null si no hay notificaciones. */
export function vapidPublicKey(env: Env = process.env): string | null {
  return vapidConfig(env)?.publicKey ?? null;
}

/** Un aviso viejo no sirve: el servicio de push lo descarta si no lo pudo entregar en 1 hora. */
const TTL_SECONDS = 3600;

/** `SendPush` real. Las claves van en cada envío (sin estado global de `web-push`). Nunca lanza. */
export function createWebPushSender(config: VapidConfig, logger: Pick<Console, 'error'> = console): SendPush {
  return async (target: PushTarget, payload: PushPayload): Promise<PushResult> => {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        {
          vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
          TTL: TTL_SECONDS, urgency: 'high', timeout: 10_000,
        },
      );
      return 'ok';
    } catch (err) {
      const status = typeof err === 'object' && err !== null ? (err as { statusCode?: unknown }).statusCode : undefined;
      if (status === 404 || status === 410) return 'gone';
      // Sin el endpoint en el log: identifica al dispositivo.
      logger.error(`[push] falló un envío (${typeof status === 'number' ? status : 'sin respuesta'})`);
      return 'failed';
    }
  };
}

const globalForPush = globalThis as unknown as { __notasPushSender?: { key: string; send: SendPush | null } };

/** El `SendPush` configurado con el entorno, o null si no hay claves VAPID. Se cachea por proceso. */
export function getPushSender(env: Env = process.env): SendPush | null {
  const config = vapidConfig(env);
  const key = config ? `${config.publicKey}|${config.subject}` : '';
  if (globalForPush.__notasPushSender?.key !== key) {
    globalForPush.__notasPushSender = { key, send: config ? createWebPushSender(config) : null };
  }
  return globalForPush.__notasPushSender.send;
}
