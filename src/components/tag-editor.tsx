'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { normalizeTagName } from '@/core/tag-name';

/**
 * Lista optimista: los cambios se arman siempre sobre la lista local (no sobre la prop),
 * así que agregar o quitar varias etiquetas seguidas no pisa los cambios anteriores.
 * `onFail` revierte la lista local al valor del servidor si el guardado falla.
 */
export function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[], onFail: () => void) => void }) {
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
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Etiquetas</h3>
      <div className="flex flex-wrap items-center gap-1.5">
        {local.map((t) => (
          <span key={t} className="flex items-center gap-1 rounded bg-hover px-2 py-0.5 text-xs">
            #{t}
            <button onClick={() => commit(current.current.filter((x) => x !== t))} aria-label={`Quitar etiqueta ${t}`}><X size={12} /></button>
          </span>
        ))}
        <input
          value={draft} onChange={(e) => { setDraft(e.target.value); setError(null); }}
          placeholder="+ etiqueta" aria-label="Agregar etiqueta" aria-invalid={error !== null}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} onBlur={add}
          className="w-28 bg-transparent text-xs outline-none placeholder:text-muted"
        />
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
