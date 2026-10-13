import { and, eq, inArray } from 'drizzle-orm';
import { taskReminders, users } from '@/db/schema';
import type { DB } from '@/db/types';
import { fromStored, optionForMinutes, toStored, type ReminderOption } from './reminder-options';

/**
 * Recordatorios por persona. Estas funciones NO chequean acceso: las llaman createTask/updateTask dentro de su
 * transacción, después de haber validado que el usuario accede a la tarea.
 */

/** taskId → opción del recordatorio de `userId` en esas tareas. */
export async function remindersFor(db: DB, userId: string, taskIds: string[]): Promise<Map<string, ReminderOption>> {
  if (taskIds.length === 0) return new Map();
  const rows = await db
    .select({ taskId: taskReminders.taskId, kind: taskReminders.kind, offsetMinutes: taskReminders.offsetMinutes })
    .from(taskReminders)
    .where(and(eq(taskReminders.userId, userId), inArray(taskReminders.taskId, taskIds)));
  const map = new Map<string, ReminderOption>();
  for (const row of rows) {
    const option = fromStored(row);
    if (option) map.set(row.taskId, option);
  }
  return map;
}

/** Pone, cambia o (con null) quita el recordatorio de `userId` en la tarea. */
export async function writeReminder(
  db: DB, userId: string, taskId: string, option: ReminderOption | null, now: Date = new Date(),
): Promise<void> {
  if (option === null) {
    await db.delete(taskReminders).where(and(eq(taskReminders.taskId, taskId), eq(taskReminders.userId, userId)));
    return;
  }
  const { kind, offsetMinutes } = toStored(option);
  await db
    .insert(taskReminders)
    .values({ taskId, userId, kind, offsetMinutes, updatedAt: now })
    .onConflictDoUpdate({ target: [taskReminders.taskId, taskReminders.userId], set: { kind, offsetMinutes, updatedAt: now } });
}

/** Si el usuario tiene recordatorio por defecto y todavía no puso uno en esta tarea, lo agrega. */
export async function applyDefaultReminder(db: DB, userId: string, taskId: string, now: Date = new Date()): Promise<void> {
  const [user] = await db.select({ minutes: users.reminderDefaultMinutes }).from(users).where(eq(users.id, userId));
  const option = optionForMinutes(user?.minutes ?? null);
  if (!option) return;
  const { kind, offsetMinutes } = toStored(option);
  await db.insert(taskReminders).values({ taskId, userId, kind, offsetMinutes, updatedAt: now }).onConflictDoNothing();
}

/**
 * Marca como "recién puestos" los recordatorios de todas las personas en la tarea. Se llama cuando cambia su fecha
 * u hora: si el instante nuevo ya pasó, no se avisa tarde (un recordatorio no suena antes de su `updated_at`).
 */
export async function touchReminders(db: DB, taskId: string, now: Date = new Date()): Promise<void> {
  await db.update(taskReminders).set({ updatedAt: now }).where(eq(taskReminders.taskId, taskId));
}
