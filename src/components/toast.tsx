'use client';

import { CircleAlert, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export type ToastTone = 'trash' | 'ai' | 'error';

export interface ToastInput {
  tone: ToastTone;
  message: string;
  action?: { label: string; onClick: () => void };
  /** ms; por defecto 6 s (papelera, IA) u 8 s (error). */
  duration?: number;
}

interface ToastState extends ToastInput {
  id: number;
}

const DEFAULT_DURATION: Record<ToastTone, number> = { trash: 6000, ai: 6000, error: 8000 };

const ToastContext = createContext<(toast: ToastInput) => void>(() => {});

/** Muestra un toast (reemplaza al que hubiera). */
export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const nextId = useRef(0);
  const show = useCallback((input: ToastInput) => setToast({ ...input, id: ++nextId.current }), []);
  const dismiss = useCallback(() => setToast(null), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* Abajo a la izquierda del contenido; en celular, encima del agregado rápido. */}
      <div className="pointer-events-none fixed inset-x-4 bottom-[96px] z-[60] flex md:bottom-6 md:left-[272px] md:right-auto">
        {toast && <Toast key={toast.id} toast={toast} onDone={dismiss} />}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ toast, onDone }: { toast: ToastState; onDone: () => void }) {
  const duration = toast.duration ?? DEFAULT_DURATION[toast.tone];
  const [paused, setPaused] = useState(false);
  const remaining = useRef(duration);

  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const timer = setTimeout(onDone, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt;
    };
  }, [paused, onDone]);

  const Icon = toast.tone === 'trash' ? Trash2 : toast.tone === 'ai' ? Sparkles : CircleAlert;
  const iconClass = toast.tone === 'ai' ? 'text-toast-accent' : toast.tone === 'error' ? 'text-toast-danger' : 'opacity-80';
  const hover = 'hover:bg-[color-mix(in_oklab,var(--toast-fg)_10%,transparent)]';

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      className="pointer-events-auto relative flex min-h-12 max-w-full animate-toast-in items-center gap-3 overflow-hidden rounded-card bg-toast-bg py-1.5 pl-4 pr-2 text-[13.5px] font-medium text-toast-fg shadow-pop"
    >
      <Icon size={16} strokeWidth={2.2} aria-hidden="true" className={`shrink-0 ${iconClass}`} />
      <span className="min-w-0 line-clamp-2">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => { toast.action!.onClick(); onDone(); }}
          className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-pill px-2.5 font-bold text-toast-accent ${hover} focus-visible:outline-toast-accent`}
        >
          {toast.tone === 'trash' && <Undo2 size={14} strokeWidth={2.4} aria-hidden="true" />}
          {toast.action.label}
        </button>
      )}
      {toast.tone !== 'error' && (
        <button
          type="button" onClick={onDone} aria-label="Cerrar aviso"
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-pill opacity-70 hover:opacity-100 ${hover} focus-visible:outline-toast-accent`}
        >
          <X size={15} strokeWidth={2.2} aria-hidden="true" />
        </button>
      )}
      {toast.tone === 'trash' && (
        <span
          data-toast-bar aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-toast-accent"
          style={{ animation: `notas-toast-bar ${duration}ms linear forwards`, animationPlayState: paused ? 'paused' : 'running' }}
        />
      )}
    </div>
  );
}
