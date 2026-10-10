'use client';

import { ChevronDown, Globe } from 'lucide-react';
import { useState, useTransition } from 'react';
import { updateTimezoneAction } from '@/app/app/actions';
import { field } from './ui';

/** `zones` se calcula en el servidor para evitar diferencias de hidratación entre ICU del servidor y del navegador. */
export function TimezoneForm({ current, zones }: { current: string; zones: string[] }) {
  const [value, setValue] = useState(current);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    const previous = value;
    setValue(next);
    setMessage(null);
    startTransition(async () => {
      const result = await updateTimezoneAction(next);
      if (result.ok) {
        setMessage({ ok: true, text: 'Guardado' });
      } else {
        setValue(previous);
        setMessage({ ok: false, text: result.error });
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="relative flex items-center">
        <Globe size={15} aria-hidden="true" className="pointer-events-none absolute left-3 text-muted" />
        <select
          value={value} onChange={(e) => change(e.target.value)} aria-label="Zona horaria"
          className={`${field} h-10 cursor-pointer appearance-none bg-surface pl-[35px] pr-9`}
        >
          {zones.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        <ChevronDown size={14} strokeWidth={2.4} aria-hidden="true" className="pointer-events-none absolute right-2.5 text-muted" />
      </span>
      <span role="status" className={`min-h-[17px] text-meta ${message?.ok === false ? 'text-danger' : 'text-muted'}`}>
        {pending ? 'Guardando…' : message?.text}
      </span>
    </div>
  );
}
