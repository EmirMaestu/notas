'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { btn } from './ui';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Diálogos abiertos, del más viejo al más nuevo: solo el de arriba atiende Escape y Tab. */
const openDialogs: symbol[] = [];

export function Modal({
  title, titleAdornment, onClose, children, footer, size = 'md', role = 'dialog',
}: {
  title: string;
  /** Algo antes del título (p. ej. el punto de color de la lista). */
  titleAdornment?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** Franja inferior con los botones. */
  footer?: React.ReactNode;
  size?: 'sm' | 'md';
  role?: 'dialog' | 'alertdialog';
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropPressed = useRef(false);
  // El elemento que ya tenía el foco al abrir (un `autoFocus` hijo): sobrevive al doble efecto de StrictMode en desarrollo.
  const initialFocus = useRef<HTMLElement | null>(null);
  // Se captura durante el render: un `autoFocus` hijo ya habrá movido el foco cuando corran los efectos.
  const [previous] = useState(() => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)));
  // Siempre la última versión de onClose, sin reinstalar los listeners ni volver a enfocar en cada render.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // Foco: al abrir entra al diálogo, Tab queda atrapado adentro y al cerrar vuelve a donde estaba.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const token = Symbol('dialog');
    openDialogs.push(token);
    const isTop = () => openDialogs[openDialogs.length - 1] === token;
    if (dialog.contains(document.activeElement)) {
      initialFocus.current = document.activeElement as HTMLElement;
    } else if (initialFocus.current?.isConnected) {
      initialFocus.current.focus();
    } else {
      dialog.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return; // hay otro diálogo encima: que lo atienda él
      if (e.key === 'Escape') {
        e.preventDefault();
        return onCloseRef.current();
      }
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
      openDialogs.splice(openDialogs.indexOf(token), 1);
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
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-scrim p-4"
      onMouseDown={(e) => { backdropPressed.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (backdropPressed.current && e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef} role={role} aria-modal="true" aria-labelledby={titleId}
        className={`flex max-h-[calc(100dvh-32px)] w-full flex-col rounded-dialog border border-line bg-surface text-fg shadow-pop ${size === 'sm' ? 'max-w-[400px]' : 'max-w-[480px]'}`}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-[18px]">
          <h2 id={titleId} className="flex min-w-0 items-center gap-2.5 text-heading">
            {titleAdornment}
            <span className="truncate">{title}</span>
          </h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className={`${btn.icon} h-8 w-8`}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-[18px]">{children}</div>
        {footer && (
          <div className="flex shrink-0 items-center gap-2.5 rounded-b-dialog border-t border-line bg-bg px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
