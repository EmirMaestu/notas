/** Encabezado de una vista en escritorio (en celular lo reemplaza MobileHeader). */
export function ViewHeader({
  title, subtitle, actions,
}: { title: React.ReactNode; subtitle: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 tabIndex={-1} className="flex min-w-0 items-center gap-2.5 text-display outline-none">{title}</h1>
        <p className="mt-[5px] truncate text-[13px] tabular-nums text-muted">{subtitle}</p>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
    </div>
  );
}
