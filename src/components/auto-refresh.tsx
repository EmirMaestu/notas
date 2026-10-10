'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const INTERVAL_MS = 30_000;

/** Nada se mueve bajo el cursor: con un campo enfocado o un diálogo abierto se espera al próximo turno. */
function busy(): boolean {
  const active = document.activeElement;
  return Boolean(document.querySelector('[aria-modal="true"]'))
    || (active instanceof HTMLElement && (active.isContentEditable || active.matches('input, textarea, select')));
}

/** Trae cambios hechos en otro lado (otra pestaña, la IA por MCP): al volver a la pestaña y cada 30 s. */
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && !busy()) router.refresh();
    };
    const timer = setInterval(refresh, INTERVAL_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router]);
  return null;
}
