'use client';

import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicUser } from '@/core/users';
import { useMediaQuery } from '@/lib/use-media-query';
import { AutoRefresh } from './auto-refresh';
import { ToastProvider } from './toast';

interface ShellContextValue {
  user: PublicUser;
  drawerOpen: boolean;
  openDrawer: () => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

/** Usuario actual y control del cajón de celular (para los encabezados de cada página). */
export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error('useShell solo funciona dentro de AppShell');
  return value;
}

/** Layout responsive: barra lateral fija en escritorio, cajón deslizable de 300 px en celular. */
export function AppShell({ user, sidebar, children }: { user: PublicUser; sidebar: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // En el servidor y al hidratar se asume escritorio (como antes); después se corrige.
  const isDesktop = useMediaQuery('(min-width: 768px)', true);
  const pathname = usePathname();
  const asideRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => setOpen(false), [pathname]);

  const openDrawer = useCallback(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);
  const closeDrawer = useCallback(() => {
    setOpen(false);
    openerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    asideRef.current?.querySelector('a')?.focus();
    const onKey = (e: KeyboardEvent) => {
      // El diálogo abierto atiende su propio Escape.
      if (e.key !== 'Escape' || document.querySelector('[aria-modal="true"]')) return;
      closeDrawer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeDrawer]);

  const shell = useMemo(() => ({ user, drawerOpen: open, openDrawer }), [user, open, openDrawer]);

  return (
    <ShellContext.Provider value={shell}>
      <ToastProvider>
        <div className="flex h-dvh overflow-hidden bg-bg">
          <aside
            id="app-drawer" ref={asideRef} inert={!open && !isDesktop}
            onClick={(e) => { if ((e.target as Element).closest('a')) setOpen(false); }}
            className={`fixed inset-y-0 left-0 z-40 w-[300px] bg-sidebar transition-transform duration-280 ease-out md:static md:w-[248px] md:shrink-0 md:translate-x-0 md:border-r md:border-line md:shadow-none ${open ? 'translate-x-0 shadow-pop' : '-translate-x-full'}`}
          >
            {sidebar}
          </aside>
          {open && <div className="fixed inset-0 z-30 animate-fade-in bg-scrim md:hidden" onClick={closeDrawer} />}
          <main className="min-h-0 min-w-0 flex-1">{children}</main>
        </div>
        <AutoRefresh />
      </ToastProvider>
    </ShellContext.Provider>
  );
}
