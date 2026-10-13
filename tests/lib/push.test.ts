import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock se eleva al principio del archivo: el mock tiene que crearse con vi.hoisted para poder usarlo adentro.
const { sendNotification } = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock('web-push', () => {
  class WebPushError extends Error {
    constructor(message: string, public statusCode: number) {
      super(message);
    }
  }
  return { default: { sendNotification, WebPushError }, sendNotification, WebPushError };
});

const { createWebPushSender, vapidConfig, vapidPublicKey } = await import('@/lib/push');
const { WebPushError } = (await import('web-push')) as unknown as {
  WebPushError: new (message: string, statusCode: number) => Error;
};

const ENV = { VAPID_PUBLIC_KEY: 'BPub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:yo@example.com' };
const target = { endpoint: 'https://push.example.com/1', p256dh: 'BKey', auth: 'auth' };
const payload = { title: 'Pagar luz', body: 'Hoy a las 15:00', url: '/app/today', tag: 'r-1' };

describe('vapidConfig', () => {
  it('necesita las tres variables y un subject mailto: o https:', () => {
    expect(vapidConfig(ENV)).toEqual({ publicKey: 'BPub', privateKey: 'priv', subject: 'mailto:yo@example.com' });
    expect(vapidConfig({ ...ENV, VAPID_SUBJECT: 'https://notas.example.com' })?.subject).toBe('https://notas.example.com');
    expect(vapidConfig({})).toBeNull();
    expect(vapidConfig({ ...ENV, VAPID_PRIVATE_KEY: ' ' })).toBeNull();
    expect(vapidConfig({ ...ENV, VAPID_SUBJECT: 'yo@example.com' })).toBeNull();
    expect(vapidPublicKey(ENV)).toBe('BPub');
    expect(vapidPublicKey({})).toBeNull();
  });
});

describe('createWebPushSender', () => {
  beforeEach(() => {
    sendNotification.mockReset();
  });

  it('manda el JSON con las claves VAPID por envío, TTL corto y urgencia alta', async () => {
    sendNotification.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    const send = createWebPushSender(vapidConfig(ENV)!);
    expect(await send(target, payload)).toBe('ok');
    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: target.endpoint, keys: { p256dh: 'BKey', auth: 'auth' } },
      JSON.stringify(payload),
      {
        vapidDetails: { subject: 'mailto:yo@example.com', publicKey: 'BPub', privateKey: 'priv' },
        TTL: 3600, urgency: 'high', timeout: 10_000,
      },
    );
  });

  it('404 y 410 son suscripciones muertas; otros errores, fallos', async () => {
    const send = createWebPushSender(vapidConfig(ENV)!, { error: vi.fn() });
    sendNotification.mockRejectedValueOnce(new WebPushError('Gone', 410));
    expect(await send(target, payload)).toBe('gone');
    sendNotification.mockRejectedValueOnce(new WebPushError('Not Found', 404));
    expect(await send(target, payload)).toBe('gone');
    sendNotification.mockRejectedValueOnce(new WebPushError('Too many', 429));
    expect(await send(target, payload)).toBe('failed');
    sendNotification.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await send(target, payload)).toBe('failed');
  });
});
