import { and, eq, gte, inArray, isNotNull, isNull, lt, lte } from 'drizzle-orm';
import { notificationDeliveries, pushSubscriptions, taskReminders, tasks, users } from '@/db/schema';
import type { DB } from '@/db/types';
import { canAccessList } from './access';
import { addDays, todayIn } from './dates';
import { isUuid } from './errors';
import { listPushSubscriptions, recordPushResult, type PushPayload, type PushResult, type SendPush } from './push-subscriptions';
import { fromStored, reminderFireAt } from './reminder-options';
import { listTasks } from './tasks';

/**
 * Motor de notificaciones. No sabe de `web-push` ni de timers: recibe `send` y `now`. Opera sobre TODOS los
 * usuarios (lo llama el programador del proceso): nunca exponer `runNotifications` a usuarios ni por MCP.
 */

export type NotificationKind = 'reminder' | 'digest' | 'assigned' | 'test';

/** Un recordatorio se manda si su instante cayó en (now − 10 min, now]. Más atrasado se saltea. */
export const REMINDER_WINDOW_MS = 10 * 60_000;
/** El resumen diario sale si la hora local está en [hora elegida, hora elegida + 10 min). */
export const DIGEST_WINDOW_MINUTES = 10;
export const DELIVERY_RETENTION_DAYS = 30;
const MAX_TITLE = 120;

/**
 * Reclama una entrega: true si es la primera vez para (usuario, tipo, clave). Se llama ANTES de mandar, así un
 * aviso sale a lo sumo una vez aunque haya reinicios o dos corridas a la vez.
 */
export async function claimDelivery(
  db: DB,
  d: { userId: string; kind: NotificationKind; fireKey: string; taskId?: string | null; now: Date },
): Promise<boolean> {
  const rows = await db
    .insert(notificationDeliveries)
    .values({ userId: d.userId, kind: d.kind, fireKey: d.fireKey, taskId: d.taskId ?? null, sentAt: d.now })
    .onConflictDoNothing()
    .returning({ id: notificationDeliveries.id });
  return rows.length > 0;
}

export interface SendReport {
  sent: number;
  failed: number;
  removed: number;
}

/** Manda el aviso a todos los dispositivos del usuario y registra cada resultado (borra los muertos). */
export async function sendToUser(db: DB, userId: string, payload: PushPayload, send: SendPush, now: Date): Promise<SendReport> {
  const report: SendReport = { sent: 0, failed: 0, removed: 0 };
  for (const sub of await listPushSubscriptions(db, userId)) {
    let result: PushResult;
    try {
      result = await send({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, payload);
    } catch {
      result = 'error';
    }
    await recordPushResult(db, sub.id, result, now);
    if (result === 'sent') report.sent += 1;
    else if (result === 'gone') report.removed += 1;
    else report.failed += 1;
  }
  return report;
}

function clip(text: string): string {
  return text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE - 1)}…` : text;
}

/** 2030-06-20 → 20/06 */
function dayMonth(isoDate: string): string {
  return `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}`;
}

/** Cuerpo del recordatorio: «Hoy a las 15:00», «Mañana a las 09:30», «Vence hoy», «Vence el 20/06»… */
export function reminderBody(task: { dueDate: string; dueTime: string | null }, today: string): string {
  const tomorrow = addDays(today, 1);
  if (task.dueTime) {
    const day = task.dueDate === today ? 'Hoy' : task.dueDate === tomorrow ? 'Mañana' : `El ${dayMonth(task.dueDate)}`;
    return `${day} a las ${task.dueTime}`;
  }
  if (task.dueDate === today) return 'Vence hoy';
  if (task.dueDate === tomorrow) return 'Vence mañana';
  return `Vence el ${dayMonth(task.dueDate)}`;
}

/** «3 para hoy · 2 vencidas» (se omite la parte en 0). */
export function digestBody(today: number, overdue: number): string {
  const parts: string[] = [];
  if (today > 0) parts.push(`${today} para hoy`);
  if (overdue > 0) parts.push(`${overdue} ${overdue === 1 ? 'vencida' : 'vencidas'}`);
  return parts.join(' · ');
}

/** Subconsulta: usuarios con al menos un dispositivo suscripto. */
function usersWithDevices(db: DB) {
  return db.selectDistinct({ id: pushSubscriptions.userId }).from(pushSubscriptions);
}

/** Manda los recordatorios cuyo instante cayó en la ventana. Devuelve cuántos llegaron a algún dispositivo. */
export async function runReminders(db: DB, now: Date, send: SendPush): Promise<number> {
  // Un recordatorio suena entre el día anterior y el mismo día de la tarea, en la zona del usuario (UTC±14):
  // alcanza con mirar tareas que vencen entre 2 días antes y 2 días después de hoy en UTC.
  const utcToday = todayIn('UTC', now);
  const rows = await db
    .select({
      taskId: tasks.id, listId: tasks.listId, title: tasks.title, dueDate: tasks.dueDate, dueTime: tasks.dueTime,
      userId: taskReminders.userId, kind: taskReminders.kind, offsetMinutes: taskReminders.offsetMinutes,
      setAt: taskReminders.updatedAt, timezone: users.timezone, allDayTime: users.allDayReminderTime,
    })
    .from(taskReminders)
    .innerJoin(tasks, eq(tasks.id, taskReminders.taskId))
    .innerJoin(users, eq(users.id, taskReminders.userId))
    .where(and(
      eq(tasks.status, 'pending'),
      isNull(tasks.deletedAt),
      isNotNull(tasks.dueDate),
      gte(tasks.dueDate, addDays(utcToday, -2)),
      lte(tasks.dueDate, addDays(utcToday, 2)),
      inArray(taskReminders.userId, usersWithDevices(db)),
    ));

  let delivered = 0;
  for (const r of rows) {
    const option = fromStored(r);
    const fireAt = option ? reminderFireAt(r, option, r.timezone, r.allDayTime) : null;
    if (!fireAt) continue;
    const t = fireAt.getTime();
    if (t > now.getTime() || t <= now.getTime() - REMINDER_WINDOW_MS || t < r.setAt.getTime()) continue;
    // La persona puede haber dejado de tener acceso (la sacaron de la lista compartida).
    if (!(await canAccessList(db, r.userId, r.listId))) continue;
    const fireKey = `${r.taskId}:${fireAt.toISOString()}`;
    if (!(await claimDelivery(db, { userId: r.userId, kind: 'reminder', fireKey, taskId: r.taskId, now }))) continue;
    const report = await sendToUser(db, r.userId, {
      title: clip(r.title),
      body: reminderBody({ dueDate: r.dueDate!, dueTime: r.dueTime }, todayIn(r.timezone, now)),
      url: `/app/list/${r.listId}?t=${r.taskId}`,
      tag: `reminder-${r.taskId}`,
    }, send, now);
    if (report.sent > 0) delivered += 1;
  }
  return delivered;
}

/** Fecha y minutos del día locales. */
function localClock(now: Date, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { date: todayIn(timeZone, now), minutes: get('hour') * 60 + get('minute') };
}

function toMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** Resumen diario de Hoy (lo mismo que la vista «Hoy»). Devuelve cuántos llegaron a algún dispositivo. */
export async function runDigests(db: DB, now: Date, send: SendPush): Promise<number> {
  const rows = await db
    .select({ id: users.id, timezone: users.timezone, digestTime: users.digestTime })
    .from(users)
    .where(and(eq(users.digestEnabled, true), inArray(users.id, usersWithDevices(db))));
  let delivered = 0;
  for (const user of rows) {
    const clock = localClock(now, user.timezone);
    const start = toMinutes(user.digestTime);
    if (clock.minutes < start || clock.minutes >= start + DIGEST_WINDOW_MINUTES) continue;
    if (!(await claimDelivery(db, { userId: user.id, kind: 'digest', fireKey: clock.date, now }))) continue;
    const pending = await listTasks(db, user.id, { view: 'today', now, limit: 500 });
    if (pending.length === 0) continue;
    const overdue = pending.filter((t) => t.dueDate !== null && t.dueDate < clock.date).length;
    const report = await sendToUser(db, user.id, {
      title: 'Tu día en Notas', body: digestBody(pending.length - overdue, overdue), url: '/app/today', tag: 'digest',
    }, send, now);
    if (report.sent > 0) delivered += 1;
  }
  return delivered;
}

export interface NotificationsReport {
  reminders: number;
  digests: number;
}

/** Una pasada del programador. */
export async function runNotifications(db: DB, now: Date, send: SendPush): Promise<NotificationsReport> {
  const reminders = await runReminders(db, now, send);
  const digests = await runDigests(db, now, send);
  return { reminders, digests };
}

/**
 * Avisa a la persona asignada a la tarea, si no es quien asignó, tiene el aviso prendido y accede a la lista.
 * El llamador decide si la asignación cambió. Devuelve true si llegó a algún dispositivo.
 */
export async function notifyAssignment(
  db: DB, { actorId, taskId }: { actorId: string; taskId: string }, send: SendPush, now: Date,
): Promise<boolean> {
  if (!isUuid(taskId)) return false;
  const [task] = await db
    .select({ id: tasks.id, title: tasks.title, listId: tasks.listId, assigneeId: tasks.assigneeId, deletedAt: tasks.deletedAt })
    .from(tasks)
    .where(eq(tasks.id, taskId));
  if (!task || !task.assigneeId || task.assigneeId === actorId || task.deletedAt) return false;
  const [assignee] = await db.select({ notifyAssigned: users.notifyAssigned }).from(users).where(eq(users.id, task.assigneeId));
  if (!assignee?.notifyAssigned) return false;
  if (!(await canAccessList(db, task.assigneeId, task.listId))) return false;
  const [actor] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, actorId));
  const who = actor ? actor.name.trim() || actor.email : 'Alguien';
  const fireKey = `${task.id}:${now.toISOString()}`;
  if (!(await claimDelivery(db, { userId: task.assigneeId, kind: 'assigned', fireKey, taskId: task.id, now }))) return false;
  const report = await sendToUser(db, task.assigneeId, {
    title: 'Te asignaron una tarea',
    body: `${who} te asignó «${clip(task.title)}»`,
    url: `/app/assigned?t=${task.id}`,
    tag: `assigned-${task.id}`,
  }, send, now);
  return report.sent > 0;
}

/** «Enviar prueba» de Configuración: a todos los dispositivos del usuario. */
export async function sendTestNotification(db: DB, userId: string, send: SendPush, now: Date): Promise<SendReport> {
  await claimDelivery(db, { userId, kind: 'test', fireKey: `test:${now.toISOString()}`, now });
  return sendToUser(db, userId, {
    title: 'Notas', body: 'Las notificaciones de Notas funcionan en este dispositivo.', url: '/app/settings', tag: 'test',
  }, send, now);
}

/** Borra el registro de entregas viejas (mantenimiento diario). Devuelve cuántas. */
export async function purgeOldDeliveries(db: DB, now: Date = new Date(), days = DELIVERY_RETENTION_DAYS): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(notificationDeliveries)
    .where(lt(notificationDeliveries.sentAt, cutoff))
    .returning({ id: notificationDeliveries.id });
  return deleted.length;
}
