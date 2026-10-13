import type { PushPayload, PushResult, SendPush } from '@/core/push-subscriptions';

/** Datos de una suscripción como los manda el navegador (`PushSubscription.toJSON()` + user agent). */
export function subscriptionInput(n = 1, overrides: Record<string, unknown> = {}) {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${n}`,
    keys: { p256dh: `BClavePublica${n}_-`, auth: `auth${n}` },
    userAgent: 'Vitest',
    ...overrides,
  };
}

/** `send` falso: registra cada envío y responde según el endpoint ('ok' si no se indica). */
export function fakeSender(results: Record<string, PushResult> = {}) {
  const calls: { endpoint: string; payload: PushPayload }[] = [];
  const send: SendPush = async (target, payload) => {
    calls.push({ endpoint: target.endpoint, payload });
    return results[target.endpoint] ?? 'ok';
  };
  return { send, calls };
}
