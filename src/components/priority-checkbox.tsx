'use client';

import { Check } from 'lucide-react';

const BORDER: Record<number, string> = { 0: 'border-muted', 1: 'border-p-low', 3: 'border-p-med', 5: 'border-p-high' };

export function PriorityCheckbox({
  checked, priority, onChange, disabled, label,
}: { checked: boolean; priority: number; onChange: () => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button" role="checkbox" aria-checked={checked} disabled={disabled} onClick={onChange}
      aria-label={label ?? (checked ? 'Marcar como pendiente' : 'Completar tarea')}
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border-2 ${checked ? 'border-muted bg-muted' : BORDER[priority] ?? BORDER[0]}`}
    >
      {checked && <Check size={12} strokeWidth={3} className="text-bg" />}
    </button>
  );
}
