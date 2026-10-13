import { beforeEach, describe, expect, it } from 'vitest';
import { ValidationError } from '@/core/errors';
import {
  MAX_PUSH_FAILURES, MAX_SUBSCRIPTIONS_PER_USER, checkPushSubscription, countPushSubscriptions, deletePushSubscription,
  listPushSubscriptions, recordPushResult, savePushSubscription,
} from '@/core/push-subscriptions';
import type { DB } from '@/db/types';
import { createTestDb, createTestUser } from '../helpers/db';
import { subscriptionInput } from '../helpers/push';

let db: DB;
beforeEach(async () => {
  db = await createTestDb();
});

describe('validación', () => {
  it('acepta lo que manda el navegador', () => {
    expect(checkPushSubscription(subscriptionInput(1))).toEqual({
      endpoint: 'https://push.example.com/send/1', p256dh: 'BClavePublica1_-', auth: 'auth1', userAgent: 'Vitest',
    });
  });

  it('rechaza endpoints que no son https, largos o inválidos', () => {
    expect(() => checkPushSubscription(subscriptionInput(1, { endpoint: 'http://push.example.com/x' }))).toThrow(/https/);
    expect(() => checkPushSubscription(subscriptionInput(1, { endpoint: `https://x.example.com/${'a'.repeat(2100)}` }))).toThrow(ValidationError);
    expect(() => checkPushSubscription(subscriptionInput(1, { endpoint: 'no es una url' }))).toThrow(ValidationError);
    expect(() => checkPushSubscription(subscriptionInput(1, { endpoint: 5 }))).toThrow(ValidationError);
    expect(() => checkPushSubscription('nada')).toThrow(ValidationError);
  });

  it('rechaza claves faltantes, largas o con caracteres raros', () => {
    expect(() => checkPushSubscription(subscriptionInput(1, { keys: undefined }))).toThrow(/Claves/);
    expect(() => checkPushSubscription(subscriptionInput(1, { keys: { p256dh: 'a b', auth: 'x' } }))).toThrow(/Claves/);
    expect(() => checkPushSubscription(subscriptionInput(1, { keys: { p256dh: 'a'.repeat(201), auth: 'x' } }))).toThrow(/Claves/);
    expect(() => checkPushSubscription(subscriptionInput(1, { keys: { p256dh: 'abc', auth: '' } }))).toThrow(/Claves/);
  });

  it('recorta el user agent y lo deja en null si no es texto', () => {
    expect(checkPushSubscription(subscriptionInput(1, { userAgent: 'x'.repeat(400) })).userAgent).toHaveLength(300);
    expect(checkPushSubscription(subscriptionInput(1, { userAgent: 42 })).userAgent).toBeNull();
  });
});

describe('alta, baja y tope', () => {
  it('guarda, lista y cuenta; el mismo endpoint no se duplica', async () => {
    const user = await createTestUser(db);
    await savePushSubscription(db, user.id, subscriptionInput(1));
    await savePushSubscription(db, user.id, subscriptionInput(1, { keys: { p256dh: 'Otra', auth: 'otra' } }));
    const subs = await listPushSubscriptions(db, user.id);
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ p256dh: 'Otra', auth: 'otra', failureCount: 0 });
    expect(await countPushSubscriptions(db, user.id)).toBe(1);
  });

  it('el mismo navegador con otra cuenta pasa a la cuenta nueva', async () => {
    const a = await createTestUser(db, 'a@example.com');
    const b = await createTestUser(db, 'b@example.com');
    await savePushSubscription(db, a.id, subscriptionInput(1));
    await savePushSubscription(db, b.id, subscriptionInput(1));
    expect(await countPushSubscriptions(db, a.id)).toBe(0);
    expect(await countPushSubscriptions(db, b.id)).toBe(1);
  });

  it(`como mucho ${MAX_SUBSCRIPTIONS_PER_USER} por usuario: se borra la más vieja`, async () => {
    const user = await createTestUser(db);
    for (let i = 0; i <= MAX_SUBSCRIPTIONS_PER_USER; i++) {
      await savePushSubscription(db, user.id, subscriptionInput(i), new Date(Date.UTC(2030, 0, 1, 0, i)));
    }
    const endpoints = (await listPushSubscriptions(db, user.id)).map((s) => s.endpoint);
    expect(endpoints).toHaveLength(MAX_SUBSCRIPTIONS_PER_USER);
    expect(endpoints).not.toContain('https://push.example.com/send/0');
    expect(endpoints[0]).toBe(`https://push.example.com/send/${MAX_SUBSCRIPTIONS_PER_USER}`);
  });

  it('cada uno borra solo sus suscripciones', async () => {
    const a = await createTestUser(db, 'a@example.com');
    const b = await createTestUser(db, 'b@example.com');
    await savePushSubscription(db, a.id, subscriptionInput(1));
    expect(await deletePushSubscription(db, b.id, 'https://push.example.com/send/1')).toBe(false);
    expect(await deletePushSubscription(db, a.id, 'https://push.example.com/send/1')).toBe(true);
    expect(await deletePushSubscription(db, a.id, 5)).toBe(false);
  });
});

describe('resultado de un envío', () => {
  it('ok marca el éxito y reinicia los fallos; gone borra; failed suma y borra al llegar al tope', async () => {
    const user = await createTestUser(db);
    const sub = await savePushSubscription(db, user.id, subscriptionInput(1));
    const now = new Date('2030-01-01T10:00:00Z');
    await recordPushResult(db, sub.id, 'failed', now);
    await recordPushResult(db, sub.id, 'ok', now);
    expect((await listPushSubscriptions(db, user.id))[0]).toMatchObject({ failureCount: 0, lastSuccessAt: now });
    for (let i = 0; i < MAX_PUSH_FAILURES - 1; i++) await recordPushResult(db, sub.id, 'failed', now);
    expect((await listPushSubscriptions(db, user.id))[0].failureCount).toBe(MAX_PUSH_FAILURES - 1);
    await recordPushResult(db, sub.id, 'failed', now);
    expect(await countPushSubscriptions(db, user.id)).toBe(0);

    const other = await savePushSubscription(db, user.id, subscriptionInput(2));
    await recordPushResult(db, other.id, 'gone', now);
    expect(await countPushSubscriptions(db, user.id)).toBe(0);
  });
});
