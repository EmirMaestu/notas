import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { removeListMember } from '@/core/members';
import { updateNotificationPrefs } from '@/core/notification-prefs';
import {
  claimDelivery, digestBody, notifyAssignment, purgeOldDeliveries, reminderBody, runDigests, runNotifications,
  runReminders, sendTestNotification, sendToUser,
} from '@/core/notifications';
import { countPushSubscriptions, savePushSubscription, type SendPush } from '@/core/push-subscriptions';
import { completeTask, createTask, deleteTask, moveTask, updateTask } from '@/core/tasks';
import { notificationDeliveries, pushSubscriptions, taskReminders, users } from '@/db/schema';
import type { DB } from '@/db/types';
import { createTestDb, createTestUser } from '../helpers/db';
import { fakeSender, subscriptionInput } from '../helpers/push';
import { createSharingFixture } from '../helpers/sharing';

// Fechas en 2030 a propósito: un recordatorio no avisa instantes anteriores a cuando se guardó (updated_at = ahora real).
const MIN = 60_000;
/** 10/06/2030 15:00 en Buenos Aires (UTC−3) menos 15 minutos. */
const FIRE = new Date('2030-06-10T17:45:00Z');
const at = (ms: number) => new Date(FIRE.getTime() + ms);
const DUE = { dueDate: '2030-06-10', dueTime: '15:00' };

let db: DB;
beforeEach(async () => {
  db = await createTestDb();
});

async function userWithDevice(email = 'emir@example.com', n = 1) {
  const user = await createTestUser(db, email);
  await savePushSubscription(db, user.id, subscriptionInput(n));
  return user;
}

describe('textos', () => {
  it('reminderBody según el día y la hora', () => {
    expect(reminderBody({ dueDate: '2030-06-10', dueTime: '15:00' }, '2030-06-10')).toBe('Hoy a las 15:00');
    expect(reminderBody({ dueDate: '2030-06-11', dueTime: '09:30' }, '2030-06-10')).toBe('Mañana a las 09:30');
    expect(reminderBody({ dueDate: '2030-06-20', dueTime: '09:30' }, '2030-06-10')).toBe('El 20/06 a las 09:30');
    expect(reminderBody({ dueDate: '2030-06-10', dueTime: null }, '2030-06-10')).toBe('Vence hoy');
    expect(reminderBody({ dueDate: '2030-06-11', dueTime: null }, '2030-06-10')).toBe('Vence mañana');
    expect(reminderBody({ dueDate: '2030-06-20', dueTime: null }, '2030-06-10')).toBe('Vence el 20/06');
  });

  it('digestBody', () => {
    expect(digestBody(1, 0)).toBe('1 para hoy');
    expect(digestBody(0, 1)).toBe('1 vencida');
    expect(digestBody(3, 2)).toBe('3 para hoy · 2 vencidas');
  });
});

describe('recordatorios', () => {
  it('manda el recordatorio a su hora y una sola vez', async () => {
    const user = await userWithDevice();
    const task = await createTask(db, user.id, { title: 'Dentista', ...DUE, reminder: '15m' });
    const { send, calls } = fakeSender();
    expect(await runReminders(db, FIRE, send)).toBe(1);
    expect(calls).toEqual([{
      endpoint: 'https://fcm.googleapis.com/fcm/send/1',
      payload: { title: 'Dentista', body: 'Hoy a las 15:00', url: `/app/list/${task.listId}?t=${task.id}`, tag: `reminder-${task.id}` },
    }]);
    // Ni el mismo tick repetido (otro proceso, reinicio) ni el siguiente lo vuelven a mandar.
    expect(await runReminders(db, FIRE, send)).toBe(0);
    expect(await runReminders(db, at(MIN), send)).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('solo dentro de la ventana (now − 10 min, now]', async () => {
    const user = await userWithDevice();
    await createTask(db, user.id, { title: 'Dentista', ...DUE, reminder: '15m' });
    const { send, calls } = fakeSender();
    expect(await runReminders(db, at(-MIN), send)).toBe(0); // todavía no
    expect(await runReminders(db, at(10 * MIN), send)).toBe(0); // ya pasaron 10 min: se saltea
    expect(calls).toHaveLength(0);
    expect(await runReminders(db, at(9 * MIN), send)).toBe(1); // atrasado pero dentro de la ventana
  });

  it('no avisa tareas completadas ni en la papelera', async () => {
    const user = await userWithDevice();
    const done = await createTask(db, user.id, { title: 'Hecha', ...DUE, reminder: '15m' });
    const trashed = await createTask(db, user.id, { title: 'Borrada', ...DUE, reminder: '15m' });
    await completeTask(db, user.id, done.id);
    await deleteTask(db, user.id, trashed.id);
    const { send, calls } = fakeSender();
    expect(await runReminders(db, FIRE, send)).toBe(0);
    expect(calls).toEqual([]);
  });

  it('quien ya no es miembro de la lista no recibe su recordatorio; el dueño sí', async () => {
    const { owner, member, shared } = await createSharingFixture(db);
    await savePushSubscription(db, owner.id, subscriptionInput(1));
    await savePushSubscription(db, member.id, subscriptionInput(2));
    const task = await createTask(db, owner.id, { title: 'Compartida', listId: shared.id, ...DUE, reminder: '15m' });
    await updateTask(db, member.id, task.id, { reminder: '15m' });
    await removeListMember(db, owner.id, shared.id, member.id);
    const { send, calls } = fakeSender();
    expect(await runReminders(db, FIRE, send)).toBe(1);
    expect(calls.map((c) => c.endpoint)).toEqual(['https://fcm.googleapis.com/fcm/send/1']);
  });

  it('sin dispositivos no hace nada (ni registra la entrega)', async () => {
    const user = await createTestUser(db);
    await createTask(db, user.id, { title: 'Dentista', ...DUE, reminder: '15m' });
    expect(await runReminders(db, FIRE, fakeSender().send)).toBe(0);
    expect(await db.select().from(notificationDeliveries)).toEqual([]);
  });

  it('no manda avisos atrasados de recordatorios puestos después de su hora', async () => {
    const user = await userWithDevice();
    const task = await createTask(db, user.id, { title: 'Dentista', ...DUE, reminder: '15m' });
    await db.update(taskReminders).set({ updatedAt: at(MIN) }).where(eq(taskReminders.taskId, task.id));
    expect(await runReminders(db, at(2 * MIN), fakeSender().send)).toBe(0);
  });

  it('si cambia la hora de la tarea, suena otra vez para el instante nuevo', async () => {
    const user = await userWithDevice();
    const task = await createTask(db, user.id, { title: 'Dentista', ...DUE, reminder: '15m' });
    const { send } = fakeSender();
    expect(await runReminders(db, FIRE, send)).toBe(1);
    await updateTask(db, user.id, task.id, { dueTime: '16:00' });
    expect(await runReminders(db, at(60 * MIN), send)).toBe(1);
  });

  it('tareas sin hora: el día anterior a la hora elegida por el usuario', async () => {
    const user = await userWithDevice();
    await updateNotificationPrefs(db, user.id, { allDayReminderTime: '20:00' });
    await createTask(db, user.id, { title: 'Pagar luz', dueDate: '2030-06-10', reminder: 'day_before' });
    const { send, calls } = fakeSender();
    expect(await runReminders(db, new Date('2030-06-09T23:00:00Z'), send)).toBe(1); // 09/06 20:00 en Buenos Aires
    expect(calls[0].payload).toMatchObject({ title: 'Pagar luz', body: 'Vence mañana' });
  });

  it('borra la suscripción que respondió 410 y sigue con las demás', async () => {
    const user = await userWithDevice('emir@example.com', 1);
    await savePushSubscription(db, user.id, subscriptionInput(2));
    await createTask(db, user.id, { title: 'Dentista', ...DUE, reminder: '15m' });
    const { send, calls } = fakeSender({ 'https://fcm.googleapis.com/fcm/send/1': 'gone' });
    expect(await runReminders(db, FIRE, send)).toBe(1);
    expect(calls).toHaveLength(2);
    expect(await countPushSubscriptions(db, user.id)).toBe(1);
  });

  it('un send que lanza cuenta como fallo y no corta el resto', async () => {
    const a = await userWithDevice('a@example.com', 1);
    const b = await userWithDevice('b@example.com', 2);
    await createTask(db, a.id, { title: 'A', ...DUE, reminder: '15m' });
    await createTask(db, b.id, { title: 'B', ...DUE, reminder: '15m' });
    const sent: string[] = [];
    const send = async (target: { endpoint: string }) => {
      if (target.endpoint.endsWith('/1')) throw new Error('boom');
      sent.push(target.endpoint);
      return 'sent' as const;
    };
    expect(await runReminders(db, FIRE, send)).toBe(1);
    expect(sent).toEqual(['https://fcm.googleapis.com/fcm/send/2']);
  });
});

describe('resumen diario', () => {
  /** 10/06/2030 08:00 en Buenos Aires. */
  const EIGHT = new Date('2030-06-10T11:00:00Z');
  const after = (ms: number) => new Date(EIGHT.getTime() + ms);

  async function digestUser(email = 'emir@example.com', n = 1) {
    const user = await userWithDevice(email, n);
    await updateNotificationPrefs(db, user.id, { digestEnabled: true });
    return user;
  }

  it('a la hora local cuenta hoy y vencidas, una vez por día', async () => {
    const user = await digestUser();
    await createTask(db, user.id, { title: 'Hoy', dueDate: '2030-06-10' });
    await createTask(db, user.id, { title: 'Vencida 1', dueDate: '2030-06-08' });
    await createTask(db, user.id, { title: 'Vencida 2', dueDate: '2030-06-09' });
    await createTask(db, user.id, { title: 'Mañana', dueDate: '2030-06-11' });
    const { send, calls } = fakeSender();
    expect(await runDigests(db, after(-MIN), send)).toBe(0);
    expect(await runDigests(db, after(5 * MIN), send)).toBe(1);
    expect(calls[0].payload).toEqual({ title: 'Tu día en Notas', body: '1 para hoy · 2 vencidas', url: '/app/today', tag: 'digest' });
    expect(await runDigests(db, after(6 * MIN), send)).toBe(0);
    expect(await runDigests(db, after(24 * 60 * MIN), send)).toBe(1); // al día siguiente, otra vez
  });

  it('fuera de la ventana de 10 minutos no se manda', async () => {
    const user = await digestUser();
    await createTask(db, user.id, { title: 'Hoy', dueDate: '2030-06-10' });
    expect(await runDigests(db, after(10 * MIN), fakeSender().send)).toBe(0);
  });

  it('respeta la hora elegida', async () => {
    const user = await digestUser();
    await updateNotificationPrefs(db, user.id, { digestTime: '21:30' });
    await createTask(db, user.id, { title: 'Hoy', dueDate: '2030-06-10' });
    expect(await runDigests(db, EIGHT, fakeSender().send)).toBe(0);
    expect(await runDigests(db, new Date('2030-06-11T00:31:00Z'), fakeSender().send)).toBe(1); // 10/06 21:31
  });

  it('apagado o sin nada para hoy no manda', async () => {
    const off = await userWithDevice('off@example.com', 1);
    await createTask(db, off.id, { title: 'Hoy', dueDate: '2030-06-10' });
    await digestUser('vacio@example.com', 2);
    const { send, calls } = fakeSender();
    expect(await runDigests(db, EIGHT, send)).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe('aviso de asignación', () => {
  it('avisa a la persona asignada, no a quien asigna', async () => {
    const { owner, member, shared } = await createSharingFixture(db);
    await savePushSubscription(db, owner.id, subscriptionInput(1));
    await savePushSubscription(db, member.id, subscriptionInput(2));
    const task = await createTask(db, owner.id, { title: 'Comprar pan', listId: shared.id, assigneeId: member.id });
    const { send, calls } = fakeSender();
    expect(await notifyAssignment(db, { actorId: owner.id, taskId: task.id }, send, FIRE)).toBe(true);
    expect(calls).toEqual([{
      endpoint: 'https://fcm.googleapis.com/fcm/send/2',
      payload: { title: 'Te asignaron una tarea', body: 'Emir te asignó «Comprar pan»', url: `/app/assigned?t=${task.id}`, tag: `assigned-${task.id}` },
    }]);
    // Asignarse uno mismo no avisa.
    expect(await notifyAssignment(db, { actorId: member.id, taskId: task.id }, send, FIRE)).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('respeta la preferencia, el acceso y que la tarea exista y esté asignada', async () => {
    const { owner, member, shared } = await createSharingFixture(db);
    await savePushSubscription(db, member.id, subscriptionInput(2));
    const task = await createTask(db, owner.id, { title: 'Comprar pan', listId: shared.id, assigneeId: member.id });
    const { send } = fakeSender();
    await updateNotificationPrefs(db, member.id, { notifyAssigned: false });
    expect(await notifyAssignment(db, { actorId: owner.id, taskId: task.id }, send, FIRE)).toBe(false);
    await updateNotificationPrefs(db, member.id, { notifyAssigned: true });
    await removeListMember(db, owner.id, shared.id, member.id); // también le quita la asignación
    expect(await notifyAssignment(db, { actorId: owner.id, taskId: task.id }, send, FIRE)).toBe(false);
    expect(await notifyAssignment(db, { actorId: owner.id, taskId: 'no-es-un-id' }, send, FIRE)).toBe(false);
  });
});

describe('entregas, prueba y corrida completa', () => {
  it('claimDelivery es idempotente y purgeOldDeliveries borra lo de más de 30 días', async () => {
    const user = await createTestUser(db);
    const old = new Date('2030-01-01T00:00:00Z');
    expect(await claimDelivery(db, { userId: user.id, kind: 'digest', fireKey: '2030-01-01', now: old })).toBe(true);
    expect(await claimDelivery(db, { userId: user.id, kind: 'digest', fireKey: '2030-01-01', now: old })).toBe(false);
    await claimDelivery(db, { userId: user.id, kind: 'digest', fireKey: '2030-02-05', now: new Date('2030-02-05T00:00:00Z') });
    expect(await purgeOldDeliveries(db, new Date('2030-02-10T00:00:00Z'))).toBe(1);
    expect(await db.select().from(notificationDeliveries)).toHaveLength(1);
  });

  it('sendTestNotification manda a todos los dispositivos del usuario', async () => {
    const user = await userWithDevice('emir@example.com', 1);
    await savePushSubscription(db, user.id, subscriptionInput(2));
    const { send, calls } = fakeSender();
    expect(await sendTestNotification(db, user.id, send, FIRE)).toEqual({ sent: 2, failed: 0, removed: 0 });
    expect(calls[0].payload).toEqual({
      title: 'Notas', body: 'Las notificaciones de Notas funcionan en este dispositivo.', url: '/app/settings', tag: 'test',
    });
  });

  it('runNotifications junta recordatorios y resúmenes', async () => {
    const user = await userWithDevice();
    await createTask(db, user.id, { title: 'Dentista', ...DUE, reminder: '15m' });
    expect(await runNotifications(db, FIRE, fakeSender().send)).toEqual({ reminders: 1, digests: 0 });
  });
});

describe('envío en paralelo y presupuesto de tiempo', () => {
  /** `send` que tarda un poco y mide cuántos envíos hay en vuelo a la vez. */
  function slowSender() {
    let inFlight = 0;
    const stats = { max: 0, calls: 0 };
    const send: SendPush = async () => {
      stats.calls += 1;
      inFlight += 1;
      stats.max = Math.max(stats.max, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return 'sent';
    };
    return { send, stats };
  }

  it('sendToUser manda a todos los dispositivos del usuario a la vez', async () => {
    const user = await userWithDevice('emir@example.com', 1);
    for (const n of [2, 3, 4, 5]) await savePushSubscription(db, user.id, subscriptionInput(n));
    const { send, stats } = slowSender();
    const payload = { title: 'T', body: 'B', url: '/app', tag: 't' };
    expect(await sendToUser(db, user.id, payload, send, FIRE)).toEqual({ sent: 5, failed: 0, removed: 0 });
    expect(stats.max).toBe(5);
  });

  it('retry y error cuentan como no enviados pero no suman fallos de la suscripción', async () => {
    const user = await userWithDevice('emir@example.com', 1);
    await savePushSubscription(db, user.id, subscriptionInput(2));
    const { send } = fakeSender({ [subscriptionInput(1).endpoint]: 'retry', [subscriptionInput(2).endpoint]: 'error' });
    const payload = { title: 'T', body: 'B', url: '/app', tag: 't' };
    expect(await sendToUser(db, user.id, payload, send, FIRE)).toEqual({ sent: 0, failed: 2, removed: 0 });
    const subs = await db.select({ n: pushSubscriptions.failureCount }).from(pushSubscriptions);
    expect(subs.map((s) => s.n)).toEqual([0, 0]);
  });

  it('los recordatorios de distintos usuarios se procesan en tandas acotadas', async () => {
    for (let i = 1; i <= 7; i++) {
      const user = await userWithDevice(`u${i}@example.com`, i);
      await createTask(db, user.id, { title: `T${i}`, ...DUE, reminder: '15m' });
    }
    const { send, stats } = slowSender();
    expect(await runReminders(db, FIRE, send, { concurrency: 3 })).toBe(7);
    expect(stats.calls).toBe(7);
    expect(stats.max).toBeGreaterThan(1);
    expect(stats.max).toBeLessThanOrEqual(3);
  });

  it('al agotarse el presupuesto no empieza envíos nuevos y la pasada siguiente retoma lo que falta', async () => {
    for (let i = 1; i <= 7; i++) {
      const user = await userWithDevice(`u${i}@example.com`, i);
      await createTask(db, user.id, { title: `T${i}`, ...DUE, reminder: '15m' });
    }
    // Reloj inyectado: cada envío "tarda" 30 s, así que tras la primera tanda ya pasaron los 45 s.
    let clock = 0;
    const calls: string[] = [];
    const slow: SendPush = async (target) => {
      calls.push(target.endpoint);
      clock += 30_000;
      return 'sent';
    };
    const logger = { error: vi.fn() };
    expect(await runReminders(db, FIRE, slow, { concurrency: 3, clock: () => clock, logger })).toBe(3);
    expect(calls).toHaveLength(3);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('quedan 4'));
    // Siguiente pasada (dentro de la ventana de 10 min): sale el resto, sin repetir lo ya mandado.
    const { send, calls: next } = fakeSender();
    expect(await runReminders(db, at(MIN), send)).toBe(4);
    expect(next).toHaveLength(4);
    for (const c of next) expect(calls).not.toContain(c.endpoint);
  });
});

describe('aislamiento de errores', () => {
  const quiet = () => ({ error: vi.fn() });

  async function breakTimezone(userId: string) {
    await db.update(users).set({ timezone: 'No/Existe' }).where(eq(users.id, userId));
  }

  it('un recordatorio que lanza no impide los demás', async () => {
    const bad = await userWithDevice('mala@example.com', 1);
    const good = await userWithDevice('buena@example.com', 2);
    await createTask(db, bad.id, { title: 'Mala', ...DUE, reminder: '15m' });
    await createTask(db, good.id, { title: 'Buena', ...DUE, reminder: '15m' });
    await breakTimezone(bad.id);
    const logger = quiet();
    const { send, calls } = fakeSender();
    expect(await runReminders(db, FIRE, send, { logger })).toBe(1);
    expect(calls.map((c) => c.payload.title)).toEqual(['Buena']);
    expect(logger.error).toHaveBeenCalled();
  });

  it('un resumen que lanza no impide los demás', async () => {
    const bad = await userWithDevice('mala@example.com', 1);
    const good = await userWithDevice('buena@example.com', 2);
    for (const u of [bad, good]) await updateNotificationPrefs(db, u.id, { digestEnabled: true });
    await createTask(db, good.id, { title: 'Hoy', dueDate: '2030-06-10' });
    await breakTimezone(bad.id);
    const logger = quiet();
    const { send, calls } = fakeSender();
    expect(await runDigests(db, new Date('2030-06-10T11:00:00Z'), send, { logger })).toBe(1);
    expect(calls).toHaveLength(1);
    expect(logger.error).toHaveBeenCalled();
  });

  it('si fallan los recordatorios enteros, los resúmenes igual salen', async () => {
    const user = await userWithDevice();
    await updateNotificationPrefs(db, user.id, { digestEnabled: true });
    await createTask(db, user.id, { title: 'Hoy', dueDate: '2030-06-10' });
    // La primera consulta de la pasada es la de los recordatorios (arranca antes que la de los resúmenes): la rompemos.
    let selects = 0;
    const flaky = new Proxy(db, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target);
        if (prop !== 'select') return typeof value === 'function' ? value.bind(target) : value;
        return (...args: unknown[]) => {
          selects += 1;
          if (selects === 1) throw new Error('base caída');
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const logger = quiet();
    const report = await runNotifications(flaky, new Date('2030-06-10T11:00:00Z'), fakeSender().send, { logger });
    expect(report).toEqual({ reminders: 0, digests: 1 });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('recordatorios'), expect.anything());
  });
});

describe('acceso a la lista al sonar', () => {
  it('el recordatorio no suena si la tarea se movió a una lista a la que la persona no accede', async () => {
    const { owner, member, shared, ownerPrivate } = await createSharingFixture(db);
    await savePushSubscription(db, member.id, subscriptionInput(2));
    const task = await createTask(db, owner.id, { title: 'Compartida', listId: shared.id, ...DUE });
    await updateTask(db, member.id, task.id, { reminder: '15m' });
    await moveTask(db, owner.id, task.id, ownerPrivate.id);
    const { send, calls } = fakeSender();
    expect(await runReminders(db, FIRE, send)).toBe(0);
    expect(calls).toEqual([]);
  });
});
