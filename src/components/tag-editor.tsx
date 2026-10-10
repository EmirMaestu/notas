'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { normalizeTagName } from '@/core/tag-name';
import { sectionLabel } from './ui';

/**
 * Lista optimista: los cambios se arman siempre sobre la lista local (no sobre la prop),
 * así que agregar o quitar varias etiquetas seguidas no pisa los cambios anteriores.
 * `onFail` revierte la lista local al valor del servidor si el guardado falla.
 */
export function TagEditor({
  tags, otherTags, onChange,
}: { tags: string[]; otherTags: string[]; onChange: (tags: string[], onFail: () => void) => void }) {
  const [local, setLocal] = useState(tags);
  const current = useRef(tags);
  const serverTags = useRef(tags);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    serverTags.current = tags;
    current.current = tags;
    setLocal(tags);
  }, [tags]);

  function commit(next: string[]) {
    current.current = next;
    setLocal(next);
    onChange(next, () => {
      current.current = serverTags.current;
      setLocal(serverTags.current);
    });
  }

  function add() {
    if (!draft.trim()) { setError(null); setDraft(''); return; }
    let names: string[];
    try {
      names = draft.split(/[\s,]+/).filter(Boolean).map(normalizeTagName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Etiqueta inválida');
      return; // se conserva el borrador para corregirlo
    }
    setError(null);
    setDraft('');
    const next = [...new Set([...current.current, ...names])];
    if (next.length !== current.current.length) commit(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className={sectionLabel}>Etiquetas</h3>
      <div className="flex flex-wrap items-center gap-1.5">
        {local.map((t) => (
          <span key={t} className="inline-flex h-[26px] items-center gap-1 rounded-tag bg-hover pl-[9px] pr-1.5 text-caption font-semibold">
            #{t}
            <button
              type="button" onClick={() => commit(current.current.filter((x) => x !== t))} aria-label={`Quitar etiqueta ${t}`}
              className="flex h-4 w-4 items-center justify-center rounded-sm text-muted hover:text-fg"
            >
              <X size={11} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          value={draft} onChange={(e) => { setDraft(e.target.value); setError(null); }}
          placeholder="+ Etiqueta" aria-label="Agregar etiqueta" aria-invalid={error !== null}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} onBlur={add}
          className="h-[26px] w-[104px] rounded-tag border border-dashed border-line bg-transparent px-[9px] text-caption text-fg outline-none transition-[border-color,width] duration-120 placeholder:text-muted focus:w-40 focus:border-solid focus:border-accent focus-visible:outline-none aria-[invalid=true]:border-danger"
        />
      </div>
      {otherTags.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-meta text-muted">
          De otros miembros:
          {otherTags.map((t) => <span key={t} className="rounded-chip border border-line px-[7px] py-px">#{t}</span>)}
        </p>
      )}
      {error && <p role="alert" className="text-meta font-medium text-danger">{error}</p>}
    </div>
  );
}
