'use client';

import { ChevronDown } from 'lucide-react';

/** Dónde va el ícono y cuánto texto se corre: [izquierda del ícono, padding izquierdo del select]. */
const INSET = {
  none: [0, 10],
  flag: [8, 28],
  dot: [10, 25],
  avatar: [5, 32],
} as const;

/** Select nativo con aspecto de píldora: ícono a la izquierda, chevron a la derecha. */
export function SelectPill({
  label, value, onChange, leading, leadingInset = 'none', disabled, children,
}: {
  /** Nombre accesible del select (los tests y los lectores lo usan). */
  label: string;
  value: string;
  onChange: (value: string) => void;
  leading?: React.ReactNode;
  leadingInset?: keyof typeof INSET;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const [left, padding] = INSET[leading ? leadingInset : 'none'];
  return (
    <span className="relative inline-flex h-[30px] max-w-full items-center">
      {leading && (
        <span aria-hidden="true" className="pointer-events-none absolute flex items-center" style={{ left }}>{leading}</span>
      )}
      <select
        aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
        style={{ paddingLeft: padding }}
        className="h-full max-w-full cursor-pointer appearance-none truncate rounded-pill border border-line bg-surface pr-7 text-[13.5px] font-semibold text-fg transition-[background-color,border-color,box-shadow] duration-120 hover:bg-hover focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--selected)] focus-visible:outline-none disabled:cursor-default disabled:opacity-55"
      >
        {children}
      </select>
      <ChevronDown size={12} strokeWidth={2.4} aria-hidden="true" className="pointer-events-none absolute right-2.5 text-muted" />
    </span>
  );
}
