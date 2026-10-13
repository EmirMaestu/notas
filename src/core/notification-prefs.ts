import { eq } from 'drizzle-orm';
import { users } from '@/db/schema';
import type { DB } from '@/db/types';
import { isValidTime } from './dates';
import { ValidationError } from './errors';
import { getUser, type PublicUser } from './users';

/** Opciones del recordatorio por defecto (minutos antes; null = ninguno). */
export const DEFAULT_REMINDER_CHOICES = [null, 0, 15, 60] as const;
export type DefaultReminderMinutes = (typeof DEFAULT_REMINDER_CHOICES)[number];

export interface NotificationPrefs {
  reminderDefaultMinutes: DefaultReminderMinutes;
  allDayReminderTime: string;
  digestEnabled: boolean;
  digestTime: string;
  notifyAssigned: boolean;
}

export function notificationPrefsOf(user: Pick<PublicUser, keyof NotificationPrefs>): NotificationPrefs {
  return {
    reminderDefaultMinutes: (DEFAULT_REMINDER_CHOICES as readonly (number | null)[]).includes(user.reminderDefaultMinutes)
      ? (user.reminderDefaultMinutes as DefaultReminderMinutes) : null,
    allDayReminderTime: user.allDayReminderTime,
    digestEnabled: user.digestEnabled,
    digestTime: user.digestTime,
    notifyAssigned: user.notifyAssigned,
  };
}

function checkTime(value: unknown): string {
  if (typeof value !== 'string' || !isValidTime(value)) throw new ValidationError('Hora inválida (formato HH:mm, 24 hs)');
  return value;
}

function checkBool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new ValidationError('Valor inválido: tiene que ser verdadero o falso');
  return value;
}

/** Valida un cambio parcial de preferencias. Los campos que no son de preferencias se ignoran. */
export function checkNotificationPrefs(input: unknown): Partial<NotificationPrefs> {
  if (typeof input !== 'object' || input === null) throw new ValidationError('Preferencias inválidas');
  const i = input as Record<string, unknown>;
  const out: Partial<NotificationPrefs> = {};
  if (i.reminderDefaultMinutes !== undefined) {
    if (!(DEFAULT_REMINDER_CHOICES as readonly unknown[]).includes(i.reminderDefaultMinutes)) {
      throw new ValidationError('Recordatorio por defecto inválido: ninguno, a la hora, 15 o 60 minutos antes');
    }
    out.reminderDefaultMinutes = i.reminderDefaultMinutes as DefaultReminderMinutes;
  }
  if (i.allDayReminderTime !== undefined) out.allDayReminderTime = checkTime(i.allDayReminderTime);
  if (i.digestEnabled !== undefined) out.digestEnabled = checkBool(i.digestEnabled);
  if (i.digestTime !== undefined) out.digestTime = checkTime(i.digestTime);
  if (i.notifyAssigned !== undefined) out.notifyAssigned = checkBool(i.notifyAssigned);
  return out;
}

export async function getNotificationPrefs(db: DB, userId: string): Promise<NotificationPrefs> {
  return notificationPrefsOf(await getUser(db, userId));
}

export async function updateNotificationPrefs(db: DB, userId: string, input: unknown): Promise<NotificationPrefs> {
  const patch = checkNotificationPrefs(input);
  await getUser(db, userId);
  if (Object.keys(patch).length > 0) await db.update(users).set(patch).where(eq(users.id, userId));
  return getNotificationPrefs(db, userId);
}
