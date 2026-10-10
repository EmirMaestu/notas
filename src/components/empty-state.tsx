import type { LucideIcon } from 'lucide-react';

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}

export function EmptyState({
  icon: Icon, title, body, action,
}: { icon: LucideIcon; title: string; body: string; action?: EmptyStateAction }) {
  const actionClass = action?.variant === 'secondary'
    ? 'border-line bg-surface text-fg hover:bg-hover'
    : 'border-accent bg-accent text-accent-fg hover:bg-accent-hover';
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-7 py-16 text-center">
      <span className="mb-2 flex h-11 w-11 items-center justify-center rounded-card bg-hover text-muted">
        <Icon size={20} aria-hidden="true" />
      </span>
      <p className="text-[15px] font-bold tracking-[-0.01em]">{title}</p>
      <p className="max-w-[260px] text-[13px] text-pretty text-muted">{body}</p>
      {action && (
        <button
          type="button" onClick={action.onClick}
          className={`mt-3 inline-flex h-9 items-center rounded-input border px-3.5 text-[13px] font-bold transition-colors duration-120 ${actionClass}`}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
