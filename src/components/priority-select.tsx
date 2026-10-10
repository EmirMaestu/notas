'use client';

import { Flag } from 'lucide-react';
import { SelectPill } from './select-pill';

const OPTIONS = [
  { value: 0, label: 'Ninguna', color: 'var(--p-none)' },
  { value: 1, label: 'Baja', color: 'var(--p-low)' },
  { value: 3, label: 'Media', color: 'var(--p-med)' },
  { value: 5, label: 'Alta', color: 'var(--p-high)' },
];

export function PrioritySelect({ value, onChange }: { value: number; onChange: (p: number) => void }) {
  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];
  return (
    <SelectPill
      label="Prioridad" value={String(value)} onChange={(v) => onChange(Number(v))} leadingInset="flag"
      leading={<Flag size={13} strokeWidth={2} color={current.color} fill={current.value ? current.color : 'none'} />}
    >
      {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </SelectPill>
  );
}
