'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { updateNotificationPrefsAction } from '@/app/app/actions';
import { isValidTime } from '@/core/dates';
import type { NotificationPrefs } from '@/core/notification-prefs';
import { field } from './ui';

const DEFAULT_CHOICES = [
  { value: '', label: 'Ninguno' },
  { value: '0', label: 'A la hora' },
  { value: '15', label: '15 minutos antes' },
  { value: '60', label: '1 hora antes' },
];

const ROW = 'flex flex-col gap-1.5 border-b border-line pb-3 last:border-b-0 last:pb-0';
const HELP = 'text-caption text-pretty text-muted';
const TIME = `${field} h-10 w-[120px] bg-surface font-normal tabular-nums`;

/** Hora que se edita en un input nativo: se guarda solo con un valor completo y distinto; al salir, si quedó a medias, vuelve. */
function useTimeDraft(saved: string) {
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);
  return [draft, setDraft] as const;
}

/** Preferencias de notificación. Cada cambio se guarda al instante (como la zona horaria). */
export function NotificationPrefsForm({ initial }: { initial: NotificationPrefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [allDay, setAllDay] = useTimeDraft(prefs.allDayReminderTime);
  const [digest, setDigest] = useTimeDraft(prefs.digestTime);

  function save(patch: Partial<NotificationPrefs>) {
    const previous = prefs;
    setPrefs({ ...prefs, ...patch });
    setMessage(null);
    startTransition(async () => {
      const result = await updateNotificationPrefsAction(patch);
      if (result.ok) {
        setPrefs(result.data);
        setMessage({ ok: true, text: 'Guardado' });
      } else {
        setPrefs(previous);
        setMessage({ ok: false, text: result.error });
      }
    });
  }

  function commitTime(key: 'allDayReminderTime' | 'digestTime', value: string, onBlur: boolean) {
    if (isValidTime(value)) {
      if (value !== prefs[key]) save(key === 'allDayReminderTime' ? { allDayReminderTime: value } : { digestTime: value });
    } else if (onBlur) {
      (key === 'allDayReminderTime' ? setAllDay : setDigest)(prefs[key]);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <div className={ROW}>
        <span className="text-[13px] font-semibold">Recordatorio por defecto</span>
        <span className={HELP}>Se agrega a las tareas nuevas con hora; en cada tarea lo podés cambiar.</span>
        <span className="relative flex max-w-[240px] items-center">
          <select
            aria-label="Recordatorio por defecto"
            value={prefs.reminderDefaultMinutes === null ? '' : String(prefs.reminderDefaultMinutes)}
            onChange={(e) => save({
              reminderDefaultMinutes: e.target.value === '' ? null : (Number(e.target.value) as 0 | 15 | 60),
            })}
            className={`${field} h-10 cursor-pointer appearance-none bg-surface pr-9 font-normal`}
          >
            {DEFAULT_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <ChevronDown size={14} strokeWidth={2.4} aria-hidden="true" className="pointer-events-none absolute right-2.5 text-muted" />
        </span>
      </div>

      <div className={ROW}>
        <span className="text-[13px] font-semibold">Hora de los recordatorios sin hora</span>
        <span className={HELP}>«El mismo día» y «El día anterior» suenan a esta hora.</span>
        <input
          type="time" aria-label="Hora de los recordatorios sin hora" value={allDay} className={TIME}
          onChange={(e) => { setAllDay(e.target.value); commitTime('allDayReminderTime', e.target.value, false); }}
          onBlur={(e) => commitTime('allDayReminderTime', e.target.value, true)}
        />
      </div>

      <div className={ROW}>
        <label className="flex items-center gap-2.5 text-[13px] font-semibold">
          <input
            type="checkbox" checked={prefs.digestEnabled} onChange={(e) => save({ digestEnabled: e.target.checked })}
            className="h-4 w-4 cursor-pointer accent-accent"
          />
          Resumen diario
        </label>
        <span className={HELP}>Un aviso por día con cuántas tareas tenés para hoy y cuántas vencidas (solo si hay).</span>
        <input
          type="time" aria-label="Hora del resumen diario" value={digest} disabled={!prefs.digestEnabled} className={TIME}
          onChange={(e) => { setDigest(e.target.value); commitTime('digestTime', e.target.value, false); }}
          onBlur={(e) => commitTime('digestTime', e.target.value, true)}
        />
      </div>

      <div className={ROW}>
        <label className="flex items-center gap-2.5 text-[13px] font-semibold">
          <input
            type="checkbox" checked={prefs.notifyAssigned} onChange={(e) => save({ notifyAssigned: e.target.checked })}
            className="h-4 w-4 cursor-pointer accent-accent"
          />
          Avisarme cuando me asignan una tarea
        </label>
      </div>

      <span role="status" className={`min-h-[17px] text-meta ${message?.ok === false ? 'text-danger' : 'text-muted'}`}>
        {pending ? 'Guardando…' : message?.text}
      </span>
    </div>
  );
}
