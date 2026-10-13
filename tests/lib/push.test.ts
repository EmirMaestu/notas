import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock se eleva al principio del archivo: el mock tiene que crearse con vi.hoisted para poder usarlo adentro.
const { sendNotification, getVapidHeaders } = vi.hoisted(() => ({ sendNotification: vi.fn(), getVapidHeaders: vi.fn(() => ({})) }));
vi.mock('web-push', () => {
  class WebPushError extends Error {
    constructor(message: string, public statusCode: number) {
      super(message);
    }
  }
  return { default: { sendNotification, getVapidHeaders, WebPushError }, sendNotification, getVapidHeaders, WebPushError };
});

const { createWebPushSender, getPushSender, vapidConfig, vapidPublicKey } = await import('@/lib/push');
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
    expect(await send(target, payload)).toBe('sent');
    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: target.endpoint, keys: { p256dh: 'BKey', auth: 'auth' } },
      JSON.stringify(payload),
      {
        vapidDetails: { subject: 'mailto:yo@example.com', publicKey: 'BPub', privateKey: 'priv' },
        TTL: 3600, urgency: 'high', timeout: 5000,
      },
    );
  });

  it('clasifica por código HTTP: gone, failed, retry; sin código es error', async () => {
    const send = createWebPushSender(vapidConfig(ENV)!, { error: vi.fn() });
    const cases: [number, string][] = [
      [404, 'gone'], [410, 'gone'], [429, 'retry'], [500, 'retry'], [503, 'retry'],
      [400, 'failed'], [401, 'failed'], [403, 'failed'], [413, 'failed'],
    ];
    for (const [status, expected] of cases) {
      sendNotification.mockRejectedValueOnce(new WebPushError('x', status));
      expect(await send(target, payload), String(status)).toBe(expected);
    }
    sendNotification.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await send(target, payload)).toBe('error');
  });
});

describe('claves VAPID inválidas', () => {
  it('apagan las notificaciones y lo avisan una sola vez', () => {
    getVapidHeaders.mockImplementation(() => {
      throw new Error('Vapid public key must be 65 bytes long');
    });
    const env = { ...ENV, VAPID_PUBLIC_KEY: 'BInvalida' };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(getPushSender(env)).toBeNull();
    expect(getPushSender(env)).toBeNull();
    expect(vapidPublicKey(env)).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('claves VAPID inválidas: notificaciones desactivadas'));
    error.mockRestore();
    getVapidHeaders.mockImplementation(() => ({}));
  });

  it('con claves válidas hay sender y clave pública', () => {
    const env = { ...ENV, VAPID_PUBLIC_KEY: 'BValida' };
    expect(getPushSender(env)).toBeTypeOf('function');
    expect(vapidPublicKey(env)).toBe('BValida');
  });
});
