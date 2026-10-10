'use client';

import { Check } from 'lucide-react';
import { useState } from 'react';

const COLOR: Record<number, string> = { 0: 'var(--p-none)', 1: 'var(--p-low)', 3: 'var(--p-med)', 5: 'var(--p-high)' };

export function PriorityCheckbox({
  checked, priority, onChange, disabled, label, size = 'md',
}: {
  checked: boolean; priority: number; onChange: () => void; disabled?: boolean; label?: string; size?: 'md' | 'lg';
}) {
  const [animating, setAnimating] = useState(false);
  const color = COLOR[priority] ?? COLOR[0];
  return (
    <button
      type="button" role="checkbox" aria-checked={checked} disabled={disabled}
      aria-label={label ?? (checked ? 'Marcar como pendiente' : 'Completar tarea')}
      onClick={() => { setAnimating(!checked); onChange(); }}
      onAnimationEnd={() => setAnimating(false)}
      style={{ '--cb-color': color } as React.CSSProperties}
      className={`group/cb relative flex shrink-0 items-center justify-center rounded-full transition-[background-color,box-shadow] duration-200 before:absolute before:-inset-2.5 before:content-[''] disabled:cursor-default ${size === 'lg' ? 'mt-[3px] h-[22px] w-[22px]' : 'h-5 w-5'} ${checked ? 'bg-accent shadow-[inset_0_0_0_11px_var(--accent)]' : 'shadow-[inset_0_0_0_2px_var(--cb-color)] hover:bg-[color-mix(in_oklab,var(--cb-color)_14%,transparent)]'} ${animating ? 'animate-check' : ''}`}
    >
      <Check
        size={size === 'lg' ? 13 : 12} strokeWidth={3.5} aria-hidden="true"
        className={checked
          ? `text-accent-fg ${animating ? 'animate-check-mark' : ''}`
          : 'text-[var(--cb-color)] opacity-0 transition-opacity duration-120 group-hover/cb:opacity-100'}
      />
    </button>
  );
}
