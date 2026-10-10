'use client';

import { Flag } from 'lucide-react';

const OPTIONS = [
  { value: 0, label: 'Sin prioridad', className: 'text-muted' },
  { value: 1, label: 'Baja', className: 'text-p-low' },
  { value: 3, label: 'Media', className: 'text-p-med' },
  { value: 5, label: 'Alta', className: 'text-p-high' },
];

export function PrioritySelect({ value, onChange }: { value: number; onChange: (p: number) => void }) {
  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];
  return (
    <label className={`flex items-center gap-1 rounded px-1.5 py-1 hover:bg-hover ${current.className}`}>
      <Flag size={16} />
      <select
        value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Prioridad"
        className="bg-transparent text-sm outline-none"
      >
        {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
