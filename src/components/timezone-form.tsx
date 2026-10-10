'use client';

import { useState, useTransition } from 'react';
import { updateTimezoneAction } from '@/app/app/actions';

/** `zones` se calcula en el servidor para evitar diferencias de hidratación entre ICU del servidor y del navegador. */
export function TimezoneForm({ current, zones }: { current: string; zones: string[] }) {
  const [value, setValue] = useState(current);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await updateTimezoneAction(value);
          setMessage(result.ok ? { ok: true, text: 'Guardado' } : { ok: false, text: result.error });
        });
      }}
    >
      <select
        value={value} onChange={(e) => { setValue(e.target.value); setMessage(null); }} aria-label="Zona horaria"
        className="rounded-md border border-line bg-bg px-3 py-2 text-sm"
      >
        {zones.map((z) => <option key={z} value={z}>{z}</option>)}
      </select>
      <button type="submit" disabled={pending} className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg disabled:opacity-60">
        Guardar
      </button>
      {message && <span role="status" className={`text-sm ${message.ok ? 'text-muted' : 'text-danger'}`}>{message.text}</span>}
    </form>
  );
}
