'use client';

import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';
import { setThemeAction } from '@/app/theme-actions';
import type { ThemePreference } from '@/lib/theme';

const OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: 'Sistema', icon: Monitor },
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Oscuro', icon: Moon },
];

/** Sistema / Claro / Oscuro. Se aplica al instante y se guarda en una cookie para el próximo render del servidor. */
export function ThemeForm({ current }: { current: ThemePreference }) {
  const [value, setValue] = useState(current);
  const [, startTransition] = useTransition();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function choose(next: ThemePreference) {
    setValue(next);
    const root = document.documentElement;
    if (next === 'system') delete root.dataset.theme;
    else root.dataset.theme = next;
    startTransition(async () => { await setThemeAction(next); });
  }

  // Radiogroup: las flechas mueven la selección (y el foco) entre las opciones.
  function onKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (index + (e.key === 'ArrowRight' ? 1 : OPTIONS.length - 1)) % OPTIONS.length;
    choose(OPTIONS[next].value);
    buttons.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup" aria-label="Tema"
      className="inline-flex h-10 items-center gap-1 justify-self-start rounded-input border border-line bg-surface p-1"
    >
      {OPTIONS.map(({ value: option, label, icon: Icon }, i) => {
        const checked = value === option;
        return (
          <button
            key={option} ref={(el) => { buttons.current[i] = el; }} type="button" role="radio" aria-checked={checked}
            tabIndex={checked ? 0 : -1} onClick={() => choose(option)} onKeyDown={(e) => onKeyDown(e, i)}
            className={`inline-flex h-[30px] items-center gap-1.5 rounded-pill px-3 text-[13px] font-semibold transition-colors duration-120 ${checked ? 'bg-selected text-accent' : 'text-muted hover:bg-hover hover:text-fg'}`}
          >
            <Icon size={14} aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
