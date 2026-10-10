'use client';

import { Menu } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/** Layout responsive: barra lateral fija en escritorio, cajón deslizable en móvil. */
export function AppShell({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // Arranca en `true` (igual que el render del servidor) y se corrige tras montar, para no desajustar la hidratación.
  const [isDesktop, setIsDesktop] = useState(true);
  const pathname = usePathname();
  const asideRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    asideRef.current?.querySelector('a')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"]')) return; // el diálogo abierto atiende su propio Escape
      setOpen(false);
      menuButtonRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside
        id="app-drawer" ref={asideRef} inert={!open && !isDesktop}
        onClick={(e) => { if ((e.target as Element).closest('a')) setOpen(false); }}
        className={`fixed inset-y-0 left-0 z-40 w-72 border-r border-line bg-sidebar transition-transform md:static md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {sidebar}
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-line px-3 py-2 md:hidden">
          <button
            ref={menuButtonRef} onClick={() => setOpen(true)} aria-label="Abrir menú"
            aria-expanded={open} aria-controls="app-drawer" className="rounded p-2 hover:bg-hover"
          >
            <Menu size={20} />
          </button>
          <span className="font-semibold">Notas</span>
        </header>
        <main className="min-h-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
