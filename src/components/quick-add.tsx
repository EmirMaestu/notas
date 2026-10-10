'use client';

import { Calendar, Flag, Hash, Plus } from 'lucide-react';
import { useMemo, useRef, useState, useTransition } from 'react';
import { parseQuickAdd, quickAddHighlights, type TextRange } from '@/core/quick-add';
import { formatChipDate } from '@/lib/format';
import { useMediaQuery } from '@/lib/use-media-query';
import { quickAddAction, type QuickAddContext } from '@/app/app/actions';
import { useToast } from './toast';
import { SAVE_ERROR } from './workspace-context';

const PRIORITY: Record<number, { label: string; color: string }> = {
  1: { label: 'baja', color: 'var(--p-low)' },
  3: { label: 'media', color: 'var(--p-med)' },
  5: { label: 'alta', color: 'var(--p-high)' },
};

const CHIP = 'inline-flex h-6 items-center gap-[5px] rounded-tag px-2 text-meta font-semibold';

/** Parte el texto en tramos normales y resaltados. */
function segments(text: string, ranges: TextRange[]): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.start > pos) out.push({ text: text.slice(pos, r.start), hit: false });
    out.push({ text: text.slice(r.start, r.end), hit: true });
    pos = r.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), hit: false });
  return out;
}

export function QuickAdd({
  context, today, placeholder, destination,
}: {
  context: QuickAddContext; today: string; placeholder: string;
  /** Lista donde va a caer la tarea (la de la vista o la Bandeja). */
  destination: { name: string; color: string | null };
}) {
  const [text, setText] = useState('');
  const [pending, startTransition] = useTransition();
  const mirrorRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const preview = useMemo(() => (text.trim() ? parseQuickAdd(text, today) : null), [text, today]);
  const parts = useMemo(() => segments(text, quickAddHighlights(text, today)), [text, today]);
  const detected = preview !== null && (preview.dueDate !== null || preview.priority > 0 || preview.tags.length > 0);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const submitted = text;
    if (!submitted.trim()) return;
    setText('');
    startTransition(async () => {
      let error: string | null = null;
      try {
        const result = await quickAddAction(submitted, context);
        if (!result.ok) error = result.error;
      } catch {
        error = SAVE_ERROR;
      }
      if (error !== null) {
        // Devuelve el texto para no perderlo, salvo que ya haya empezado a escribir otra cosa.
        setText((current) => current || submitted);
        toast({ tone: 'error', message: error });
      }
    });
  }

  const kbd = 'hidden shrink-0 rounded-chip border border-line px-1.5 py-px font-sans text-[11px] font-semibold text-muted md:inline-block';

  return (
    <form onSubmit={submit} className="flex flex-col-reverse gap-2 md:flex-col">
      <div
        className="group/qa flex h-12 items-center gap-3 rounded-card border border-line bg-surface px-3.5 transition-[border-color,box-shadow] duration-120 focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--selected)] md:h-[46px] md:rounded-row"
      >
        <Plus
          aria-hidden="true"
          className="h-[18px] w-[18px] shrink-0 stroke-[2.4] text-accent md:h-[17px] md:w-[17px] md:stroke-[2.2] md:text-muted md:group-focus-within/qa:text-accent"
        />
        <div className="relative min-w-0 flex-1 self-stretch">
          {/* Capa espejo: el mismo texto con lo detectado en acento, detrás del input transparente. */}
          <div
            ref={mirrorRef} aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre text-[15px] text-fg md:text-body"
          >
            <span>
              {parts.map((p, i) => <span key={i} className={p.hit ? 'text-accent' : undefined}>{p.text}</span>)}
            </span>
          </div>
          <input
            id="quick-add-input" value={text} onChange={(e) => setText(e.target.value)}
            onScroll={(e) => { if (mirrorRef.current) mirrorRef.current.scrollLeft = e.currentTarget.scrollLeft; }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && text) {
                e.preventDefault(); // no cierra el detalle: solo limpia
                setText('');
              }
            }}
            aria-label="Nueva tarea" placeholder={isMobile ? 'Agregar tarea…' : placeholder}
            autoComplete="off" enterKeyHint="done"
            className="relative h-full w-full bg-transparent text-[15px] text-transparent caret-fg outline-none selection:bg-[color-mix(in_oklab,var(--accent)_22%,transparent)] placeholder:text-muted focus-visible:outline-none md:text-body"
          />
        </div>
        {pending ? (
          <span className="shrink-0 text-meta text-muted">Guardando…</span>
        ) : text ? (
          <kbd className={kbd}>↵</kbd>
        ) : (
          <kbd className={`${kbd} md:group-focus-within/qa:hidden`}>N</kbd>
        )}
      </div>
      {detected && preview && (
        <div className="flex flex-wrap gap-1.5 pl-0.5" aria-live="polite">
          {preview.dueDate && (
            <span className={`${CHIP} bg-selected text-accent`}>
              <Calendar size={12} strokeWidth={2.2} aria-hidden="true" />
              {formatChipDate(preview.dueDate, today)}
            </span>
          )}
          {preview.priority > 0 && (
            <span className={`${CHIP} bg-selected text-accent`}>
              <Flag
                size={12} strokeWidth={2} aria-hidden="true"
                color={PRIORITY[preview.priority].color} fill={PRIORITY[preview.priority].color}
              />
              Prioridad {PRIORITY[preview.priority].label}
            </span>
          )}
          {preview.tags.map((t) => (
            <span key={t} className={`${CHIP} bg-selected text-accent`}>
              <Hash size={12} strokeWidth={2.2} aria-hidden="true" />
              {t}
            </span>
          ))}
          <span className={`${CHIP} bg-hover text-muted`}>
            <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full" style={{ backgroundColor: destination.color ?? 'var(--muted)' }} />
            <span className="sr-only">Va a </span>
            {destination.name}
          </span>
        </div>
      )}
    </form>
  );
}
