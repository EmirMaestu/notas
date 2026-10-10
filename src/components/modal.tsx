'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropPressed = useRef(false);
  // Se captura durante el render: un `autoFocus` hijo ya habrá movido el foco cuando corran los efectos.
  const [previous] = useState(() => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)));
  // Siempre la última versión de onClose, sin reinstalar los listeners ni volver a enfocar en cada render.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // Foco: al abrir entra al diálogo, Tab queda atrapado adentro y al cerrar vuelve a donde estaba.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.contains(document.activeElement)) {
      dialog.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onCloseRef.current();
      if (e.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return e.preventDefault();
      const first = items[0];
      const last = items[items.length - 1];
      if (!dialog.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [previous]);

  // Bloquea el scroll del fondo mientras el diálogo está abierto.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Portal al body: dentro de la barra lateral (con transform) un `fixed` se posicionaría respecto de ella.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => { backdropPressed.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (backdropPressed.current && e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="w-full max-w-md rounded-xl border border-line bg-bg p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Cerrar" className="rounded p-1 hover:bg-hover"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
