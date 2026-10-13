import { beforeEach, describe, expect, it } from 'vitest';
import { ValidationError } from '@/core/errors';
import { checkNotificationPrefs, getNotificationPrefs, updateNotificationPrefs } from '@/core/notification-prefs';
import type { DB } from '@/db/types';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
beforeEach(async () => {
  db = await createTestDb();
});

describe('preferencias de notificación', () => {
  it('valores por defecto', async () => {
    const user = await createTestUser(db);
    expect(await getNotificationPrefs(db, user.id)).toEqual({
      reminderDefaultMinutes: null, allDayReminderTime: '09:00', digestEnabled: false, digestTime: '08:00', notifyAssigned: true,
    });
  });

  it('guarda solo los campos enviados', async () => {
    const user = await createTestUser(db);
    await updateNotificationPrefs(db, user.id, { reminderDefaultMinutes: 15, digestEnabled: true });
    expect(await updateNotificationPrefs(db, user.id, { digestTime: '07:30', notifyAssigned: false })).toEqual({
      reminderDefaultMinutes: 15, allDayReminderTime: '09:00', digestEnabled: true, digestTime: '07:30', notifyAssigned: false,
    });
    expect((await updateNotificationPrefs(db, user.id, { reminderDefaultMinutes: null })).reminderDefaultMinutes).toBeNull();
  });

  it('valida cada campo', () => {
    expect(() => checkNotificationPrefs(null)).toThrow(ValidationError);
    expect(() => checkNotificationPrefs({ reminderDefaultMinutes: 30 })).toThrow(/Recordatorio por defecto inválido/);
    expect(() => checkNotificationPrefs({ reminderDefaultMinutes: '15' })).toThrow(ValidationError);
    expect(() => checkNotificationPrefs({ allDayReminderTime: '9:00' })).toThrow(/Hora inválida/);
    expect(() => checkNotificationPrefs({ digestTime: '24:00' })).toThrow(/Hora inválida/);
    expect(() => checkNotificationPrefs({ digestEnabled: 'sí' })).toThrow(/verdadero o falso/);
    expect(() => checkNotificationPrefs({ notifyAssigned: 1 })).toThrow(/verdadero o falso/);
    expect(checkNotificationPrefs({ reminderDefaultMinutes: 0, otra: 'cosa' })).toEqual({ reminderDefaultMinutes: 0 });
  });

  it('usuario inexistente → NotFoundError', async () => {
    await expect(updateNotificationPrefs(db, '00000000-0000-4000-8000-000000000000', { digestEnabled: true }))
      .rejects.toThrow('El usuario no existe');
  });
});
