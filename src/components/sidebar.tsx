'use client';

import {
  CalendarDays, CheckCircle2, ChevronDown, Folder as FolderIcon, Hash, Inbox, Pencil, Plus, Settings, Sun, Trash2,
  UserCheck, Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { Folder, ListWithRole } from '@/core/lists';
import type { Tag } from '@/core/tags';
import type { PublicUser } from '@/core/users';
import { deleteFolderAction, renameFolderAction } from '@/app/app/actions';
import { ListDialog } from './list-dialog';

const SMART_VIEWS = [
  { href: '/app/inbox', label: 'Bandeja', icon: Inbox },
  { href: '/app/today', label: 'Hoy', icon: Sun },
  { href: '/app/next7', label: 'Próximos 7 días', icon: CalendarDays },
  { href: '/app/assigned', label: 'Asignadas a mí', icon: UserCheck },
  { href: '/app/completed', label: 'Completadas', icon: CheckCircle2 },
  { href: '/app/trash', label: 'Papelera', icon: Trash2 },
];

// Una URL mal formada (p. ej. /app/tag/%ZZ) no debe romper la barra lateral.
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href} aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 ${active ? 'bg-selected font-medium' : 'hover:bg-hover'}`}
    >
      {children}
    </Link>
  );
}

function ListLink({ list, pathname, onEdit }: { list: ListWithRole; pathname: string; onEdit: () => void }) {
  const href = `/app/list/${list.id}`;
  const isOwner = list.role === 'owner';
  return (
    <li className="group relative">
      <NavLink href={href} active={pathname === href}>
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: list.color ?? 'var(--muted)' }} />
        <span className="truncate">{list.name}</span>
        {isOwner && list.shared && (
          <>
            <Users size={13} className="shrink-0 text-muted" aria-hidden="true" />
            <span className="sr-only">(compartida)</span>
          </>
        )}
      </NavLink>
      <button
        onClick={onEdit} aria-label={isOwner ? `Editar ${list.name}` : `Miembros de ${list.name}`}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:bg-hover md:opacity-0 md:focus-visible:opacity-100 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
      >
        {isOwner ? <Pencil size={13} /> : <Users size={13} />}
      </button>
    </li>
  );
}

export function Sidebar({
  user, lists, folders, tags,
}: { user: PublicUser; lists: ListWithRole[]; folders: Folder[]; tags: Tag[] }) {
  const pathname = usePathname();
  const [dialog, setDialog] = useState<{ list?: ListWithRole } | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [, startTransition] = useTransition();
  const ownLists = lists.filter((l) => !l.isInbox && l.role === 'owner');
  const sharedWithMe = lists.filter((l) => l.role === 'member');

  function renameFolder(folder: Folder) {
    const name = prompt('Nuevo nombre de la carpeta', folder.name);
    if (name && name !== folder.name) {
      startTransition(async () => {
        const result = await renameFolderAction(folder.id, name);
        if (!result.ok) alert(result.error);
      });
    }
  }
  function removeFolder(folder: Folder) {
    if (confirm(`¿Borrar la carpeta "${folder.name}"? Sus listas quedan sueltas.`)) {
      startTransition(async () => {
        const result = await deleteFolderAction(folder.id);
        if (!result.ok) alert(result.error);
      });
    }
  }

  return (
    <nav className="flex h-full flex-col overflow-y-auto p-3 text-sm" aria-label="Navegación principal">
      <div className="mb-4 px-2 text-base font-semibold">Notas</div>
      <ul className="space-y-0.5">
        {SMART_VIEWS.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <NavLink href={href} active={pathname === href}><Icon size={16} className="text-muted" />{label}</NavLink>
          </li>
        ))}
      </ul>

      <div className="mb-1 mt-5 flex items-center justify-between px-2 text-xs font-semibold uppercase tracking-wide text-muted">
        Listas
        <button onClick={() => setDialog({})} aria-label="Nueva lista" className="rounded p-1 hover:bg-hover"><Plus size={14} /></button>
      </div>
      {folders.map((folder) => {
        const inFolder = ownLists.filter((l) => l.folderId === folder.id);
        const isCollapsed = collapsed[folder.id];
        return (
          <div key={folder.id} className="mb-1">
            <div className="group flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-hover">
              <button
                onClick={() => setCollapsed((c) => ({ ...c, [folder.id]: !c[folder.id] }))}
                aria-expanded={!isCollapsed} className="flex flex-1 items-center gap-2 text-left"
              >
                <ChevronDown size={14} className={`text-muted transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                <FolderIcon size={15} className="text-muted" />
                <span className="truncate">{folder.name}</span>
              </button>
              <button onClick={() => renameFolder(folder)} aria-label={`Renombrar ${folder.name}`} className="rounded p-1 text-muted md:opacity-0 md:focus-visible:opacity-100 md:group-focus-within:opacity-100 md:group-hover:opacity-100"><Pencil size={13} /></button>
              <button onClick={() => removeFolder(folder)} aria-label={`Borrar ${folder.name}`} className="rounded p-1 text-muted md:opacity-0 md:focus-visible:opacity-100 md:group-focus-within:opacity-100 md:group-hover:opacity-100"><Trash2 size={13} /></button>
            </div>
            {!isCollapsed && (
              <ul className="ml-4 space-y-0.5">
                {inFolder.map((l) => <ListLink key={l.id} list={l} pathname={pathname} onEdit={() => setDialog({ list: l })} />)}
              </ul>
            )}
          </div>
        );
      })}
      <ul className="space-y-0.5">
        {ownLists.filter((l) => !l.folderId).map((l) => (
          <ListLink key={l.id} list={l} pathname={pathname} onEdit={() => setDialog({ list: l })} />
        ))}
      </ul>

      {sharedWithMe.length > 0 && (
        <>
          <div className="mb-1 mt-5 px-2 text-xs font-semibold uppercase tracking-wide text-muted">Compartidas conmigo</div>
          <ul className="space-y-0.5">
            {sharedWithMe.map((l) => (
              <ListLink key={l.id} list={l} pathname={pathname} onEdit={() => setDialog({ list: l })} />
            ))}
          </ul>
        </>
      )}

      {tags.length > 0 && (
        <>
          <div className="mb-1 mt-5 px-2 text-xs font-semibold uppercase tracking-wide text-muted">Etiquetas</div>
          <ul className="space-y-0.5">
            {tags.map((t) => {
              const href = `/app/tag/${encodeURIComponent(t.name)}`;
              return (
                <li key={t.id}>
                  <NavLink href={href} active={pathname === href || safeDecode(pathname) === `/app/tag/${t.name}`}>
                    <Hash size={15} className="text-muted" />{t.name}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="mt-auto space-y-1 border-t border-line pt-3">
        <NavLink href="/app/settings" active={pathname === '/app/settings'}><Settings size={16} className="text-muted" />Configuración</NavLink>
        <p className="truncate px-2 text-xs text-muted">{user.email}</p>
      </div>

      {dialog && <ListDialog list={dialog.list} folders={folders} onClose={() => setDialog(null)} />}
    </nav>
  );
}
