'use client';

import { Plus } from 'lucide-react';
import { useMemo, useState, useTransition } from 'react';
import { parseQuickAdd } from '@/core/quick-add';
import { formatDueLabel } from '@/lib/format';
import { quickAddAction, type QuickAddContext } from '@/app/app/actions';

const PRIORITY_LABEL: Record<number, string> = { 1: 'Baja', 3: 'Media', 5: 'Alta' };

export function QuickAdd({ context, today }: { context: QuickAddContext; today: string }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const preview = useMemo(() => (text.trim() ? parseQuickAdd(text, today) : null), [text, today]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const submitted = text;
    if (!submitted.trim()) return;
    setText('');
    setError(null);
    startTransition(async () => {
      const result = await quickAddAction(submitted, context);
      if (!result.ok) {
        // Devuelve el texto para no perderlo, salvo que ya haya empezado a escribir otra cosa.
        setText((current) => current || submitted);
        setError(result.error);
      }
    });
  }

  const chips = preview
    ? [
        preview.dueDate && formatDueLabel(preview.dueDate, today),
        preview.priority ? `Prioridad ${PRIORITY_LABEL[preview.priority]}` : null,
        ...preview.tags.map((t) => `#${t}`),
      ].filter(Boolean)
    : [];

  return (
    <form onSubmit={submit} className="px-4 pb-2 md:px-6">
      <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 focus-within:border-accent">
        <Plus size={16} className="text-muted" />
        <input
          value={text} onChange={(e) => setText(e.target.value)} aria-label="Nueva tarea"
          placeholder='Agregar tarea… ej: "Pagar luz mañana !alta #casa"'
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
        />
        {pending && <span className="text-xs text-muted">Guardando…</span>}
      </div>
      {chips.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
          {chips.map((c) => <span key={c as string} className="rounded bg-selected px-1.5 py-0.5 text-accent">{c}</span>)}
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </form>
  );
}
