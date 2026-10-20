'use client';

import { useEffect, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';

/**
 * Campo de texto con Markdown en vivo: se escribe Markdown y se ve el formato aplicado en el momento
 * (ver `@/lib/markdown-live`). El valor es siempre el Markdown crudo, igual que un textarea.
 *
 * Hasta que CodeMirror termina de cargar (y en el render del servidor) se muestra el texto tal cual, con el mismo
 * tamaño, para que no haya salto.
 */
export function MarkdownEditor({
  value, onChange, onBlur, label, placeholder, minHeight,
}: {
  value: string; onChange: (value: string) => void;
  /** Guardar: al salir del editor, o enseguida si el cambio se hizo sin el foco puesto (tildar una casilla). */
  onBlur: (value: string) => void;
  label: string; placeholder: string; minHeight?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const latest = useRef(value);
  const [ready, setReady] = useState(false);

  useEffect(() => { onChangeRef.current = onChange; onBlurRef.current = onBlur; });
  useEffect(() => { latest.current = value; });

  useEffect(() => {
    let cancelled = false;
    let view: EditorView | null = null;
    void import('@/lib/markdown-live').then(({ createLiveEditor }) => {
      if (cancelled || !hostRef.current) return;
      view = createLiveEditor({
        parent: hostRef.current, doc: latest.current, label, placeholder,
        onChange: (v, focused) => {
          latest.current = v;
          onChangeRef.current(v);
          if (!focused) onBlurRef.current(v);
        },
      });
      viewRef.current = view;
      setReady(true);
    });
    return () => {
      cancelled = true;
      view?.destroy();
      viewRef.current = null;
    };
    // El editor se crea una sola vez; los cambios de valor entran por el efecto de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cambio que no vino del editor (p. ej. otra persona editó la tarea y el campo no estaba sucio).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    void import('@/lib/markdown-live').then(({ replaceDoc }) => replaceDoc(view, value));
  }, [value]);

  return (
    <div
      className="w-full shrink-0 text-body leading-[1.6] text-fg"
      style={minHeight ? ({ '--md-min-h': minHeight } as React.CSSProperties) : undefined}
      // El foco sale del editor (y no va a otra parte de él): se guarda. Es síncrono, así que también corre
      // cuando Esc cierra el detalle justo después.
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onBlur(latest.current); }}
      data-testid="description-editor"
    >
      <div ref={hostRef} />
      {!ready && (
        <div
          aria-hidden="true"
          className={`whitespace-pre-wrap break-words ${value ? '' : 'text-muted'}`}
          style={{ minHeight: minHeight ?? '3.2em' }}
        >
          {value || placeholder}
        </div>
      )}
    </div>
  );
}
