'use client';

import { Menu } from 'lucide-react';
import Link from 'next/link';
import { useShell } from './app-shell';
import { Avatar } from './avatar';

/** Encabezado de celular (oculto desde md): menú, título y subtítulo de la vista, avatar → Configuración. */
export function MobileHeader({ title, subtitle }: { title: React.ReactNode; subtitle?: React.ReactNode }) {
  const { user, drawerOpen, openDrawer } = useShell();
  return (
    <header className="flex shrink-0 items-center gap-1.5 px-2.5 pb-2.5 pt-1 md:hidden">
      <button
        type="button" onClick={openDrawer} aria-label="Abrir menú" aria-expanded={drawerOpen} aria-controls="app-drawer"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-row text-fg transition-colors duration-120 hover:bg-hover"
      >
        <Menu size={22} aria-hidden="true" />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="flex items-center gap-2 truncate text-[22px] font-extrabold leading-[1.15] tracking-[-0.025em]">{title}</h1>
        {subtitle && <p className="truncate text-caption text-muted">{subtitle}</p>}
      </div>
      <Link href="/app/settings" aria-label="Tu cuenta" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
        <Avatar person={user} size={30} />
      </Link>
    </header>
  );
}
