'use client';

import {
  CalendarDays, Check, ChevronDown, CircleCheck, Folder as FolderIcon, Hash, Inbox, Pencil, Plus, Settings, Sun, Trash2,
  UserCheck, Users, type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { Folder, ListOwner, ListWithRole } from '@/core/lists';
import type { Tag } from '@/core/tags';
import type { PublicUser } from '@/core/users';
import { deleteFolderAction, renameFolderAction } from '@/app/app/actions';
import { Avatar } from './avatar';
import { ConfirmDialog } from './confirm-dialog';
import { ListDialog } from './list-dialog';
import { useToast } from './toast';

interface SmartView {
  href: string;
  label: string;
  icon: LucideIcon;
  count?: 'inbox' | 'today';
}

const SMART_VIEWS: SmartView[] = [
  { href: '/app/inbox', label: 'Bandeja', icon: Inbox, count: 'inbox' },
  { href: '/app/today', label: 'Hoy', icon: Sun, count: 'today' },
  { href: '/app/next7', label: 'Próximos 7 días', icon: CalendarDays },
  { href: '/app/assigned', label: 'Asignadas a mí', icon: UserCheck },
  { href: '/app/completed', label: 'Completadas', icon: CircleCheck },
  { href: '/app/trash', label: 'Papelera', icon: Trash2 },
];

const SECTION_TITLE = 'text-[11px] font-bold uppercase tracking-[.08em] text-muted';
const REVEAL = 'md:opacity-0 md:focus-visible:opacity-100 md:group-focus-within:opacity-100 md:group-hover:opacity-100';

// Una URL mal formada (p. ej. /app/tag/%ZZ) no debe romper la barra lateral.
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Ítem de navegación: 32 px por defecto (36 las listas propias, 30 las etiquetas), activo en petróleo claro. */
function NavLink({
  href, active, height = 'h-8', describedBy, children,
}: { href: string; active: boolean; height?: string; describedBy?: string; children: React.ReactNode }) {
  return (
    <Link
      href={href} aria-current={active ? 'page' : undefined} aria-describedby={describedBy}
      className={`flex items-center gap-2.5 rounded-nav px-2.5 transition-colors duration-120 ${height} ${active ? 'bg-selected font-semibold text-accent' : 'font-medium text-fg hover:bg-hover'}`}
    >
      {children}
    </Link>
  );
}

function ListLink({
  list, pathname, owner, onEdit,
}: { list: ListWithRole; pathname: string; owner?: ListOwner; onEdit: () => void }) {
  const href = `/app/list/${list.id}`;
  const isOwner = list.role === 'owner';
  return (
    <li className="group relative">
      <NavLink href={href} active={pathname === href} height={isOwner ? 'h-9' : 'h-8'}>
        <span className="mx-[3.5px] h-[9px] w-[9px] shrink-0 rounded-full" style={{ backgroundColor: list.color ?? 'var(--muted)' }} />
        <span className="min-w-0 flex-1 truncate">{list.name}</span>
        {isOwner && list.shared && (
          <>
            <Users size={14} className="shrink-0 text-muted" aria-hidden="true" />
            <span className="sr-only">(compartida)</span>
          </>
        )}
        {/* El nombre del dueño no entra al nombre accesible del link (e2e y lectores: "Compras"). */}
        {!isOwner && owner && <Avatar person={owner} size={18} />}
      </NavLink>
      <button
        type="button" onClick={onEdit} aria-label={isOwner ? `Editar ${list.name}` : `Miembros de ${list.name}`}
        className={`absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-chip bg-hover text-muted hover:text-fg ${REVEAL}`}
      >
        {isOwner ? <Pencil size={13} aria-hidden="true" /> : <Users size={13} aria-hidden="true" />}
      </button>
    </li>
  );
}

export function Sidebar({
  user, lists, folders, tags, owners, counts,
}: {
  user: PublicUser; lists: ListWithRole[]; folders: Folder[]; tags: Tag[];
  owners: Record<string, ListOwner>; counts: { inbox: number; today: number };
}) {
  const pathname = usePathname();
  const toast = useToast();
  const [dialog, setDialog] = useState<{ list?: ListWithRole } | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<Folder | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pending, startTransition] = useTransition();
  const ownLists = lists.filter((l) => !l.isInbox && l.role === 'owner');
  const sharedWithMe = lists.filter((l) => l.role === 'member');

  function renameFolder(folder: Folder) {
    const name = prompt('Nuevo nombre de la carpeta', folder.name);
    if (name && name !== folder.name) {
      startTransition(async () => {
        try {
          const result = await renameFolderAction(folder.id, name);
          if (!result.ok) toast({ tone: 'error', message: result.error });
        } catch {
          toast({ tone: 'error', message: 'No se pudo renombrar la carpeta. Probá de nuevo.' });
        }
      });
    }
  }

  function removeFolder() {
    const folder = folderToDelete;
    if (!folder) return;
    startTransition(async () => {
      try {
        const result = await deleteFolderAction(folder.id);
        if (!result.ok) toast({ tone: 'error', message: result.error });
      } catch {
        toast({ tone: 'error', message: 'No se pudo borrar la carpeta. Probá de nuevo.' });
      } finally {
        setFolderToDelete(null);
      }
    });
  }

  return (
    <nav className="flex h-full flex-col overflow-y-auto px-3 pb-3 pt-3.5 text-fg" aria-label="Navegación principal">
      <div className="flex items-center gap-[9px] px-2.5 pb-3 pt-0.5">
        <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] bg-accent text-accent-fg">
          <Check size={13} strokeWidth={3.2} aria-hidden="true" />
        </span>
        <span className="text-[15px] font-extrabold tracking-[-0.02em]">Notas</span>
      </div>

      <ul className="flex flex-col gap-0.5">
        {SMART_VIEWS.map(({ href, label, icon: Icon, count }) => {
          const active = pathname === href;
          const n = count ? counts[count] : 0;
          return (
            <li key={href}>
              <NavLink href={href} active={active} describedBy={n > 0 ? `count-${count}` : undefined}>
                <Icon size={16} aria-hidden="true" className={`shrink-0 ${active ? '' : 'opacity-85'}`} />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {n > 0 && (
                  <>
                    <span aria-hidden="true" className="text-meta font-medium tabular-nums text-muted">{n > 99 ? '99+' : n}</span>
                    {/* Descripción (no nombre): el link sigue llamándose "Hoy" y el lector agrega "2 pendientes". */}
                    <span id={`count-${count}`} className="sr-only">{n} {n === 1 ? 'pendiente' : 'pendientes'}</span>
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between px-2.5 pb-1 pt-3.5">
        <h2 className={SECTION_TITLE}>Listas</h2>
        <button
          type="button" onClick={() => setDialog({})} aria-label="Nueva lista"
          className="flex h-6 w-6 items-center justify-center rounded-chip text-muted transition-colors duration-120 hover:bg-hover hover:text-fg"
        >
          <Plus size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-col gap-0.5">
        {folders.map((folder) => {
          const inFolder = ownLists.filter((l) => l.folderId === folder.id);
          const isCollapsed = collapsed[folder.id];
          return (
            <div key={folder.id} className="flex flex-col gap-0.5">
              <div className="group flex h-[30px] items-center gap-1 rounded-nav pl-2.5 pr-1 text-muted transition-colors duration-120 hover:bg-hover">
                <button
                  type="button" onClick={() => setCollapsed((c) => ({ ...c, [folder.id]: !c[folder.id] }))}
                  aria-expanded={!isCollapsed} className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left"
                >
                  <ChevronDown
                    size={13} strokeWidth={2.2} aria-hidden="true"
                    className={`shrink-0 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
                  />
                  <FolderIcon size={15} aria-hidden="true" className="shrink-0" />
                  <span className="truncate font-medium text-fg">{folder.name}</span>
                </button>
                <button
                  type="button" onClick={() => renameFolder(folder)} aria-label={`Renombrar ${folder.name}`}
                  className={`flex h-6 w-6 items-center justify-center rounded-chip hover:text-fg ${REVEAL}`}
                >
                  <Pencil size={13} aria-hidden="true" />
                </button>
                <button
                  type="button" onClick={() => setFolderToDelete(folder)} aria-label={`Borrar ${folder.name}`}
                  className={`flex h-6 w-6 items-center justify-center rounded-chip hover:text-danger ${REVEAL}`}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>
              {!isCollapsed && inFolder.length > 0 && (
                <ul className="ml-[22px] flex flex-col gap-0.5">
                  {inFolder.map((l) => <ListLink key={l.id} list={l} pathname={pathname} onEdit={() => setDialog({ list: l })} />)}
                </ul>
              )}
            </div>
          );
        })}
        <ul className="flex flex-col gap-0.5">
          {ownLists.filter((l) => !l.folderId).map((l) => (
            <ListLink key={l.id} list={l} pathname={pathname} onEdit={() => setDialog({ list: l })} />
          ))}
        </ul>
      </div>

      {sharedWithMe.length > 0 && (
        <div id="sidebar-shared">
          <h2 className={`${SECTION_TITLE} px-2.5 pb-1 pt-3.5`}>Compartidas conmigo</h2>
          <ul className="flex flex-col gap-0.5">
            {sharedWithMe.map((l) => (
              <ListLink key={l.id} list={l} pathname={pathname} owner={owners[l.id]} onEdit={() => setDialog({ list: l })} />
            ))}
          </ul>
        </div>
      )}

      {tags.length > 0 && (
        <>
          <h2 className={`${SECTION_TITLE} px-2.5 pb-1 pt-3.5`}>Etiquetas</h2>
          <ul className="flex flex-col gap-0.5">
            {tags.map((t) => {
              const href = `/app/tag/${encodeURIComponent(t.name)}`;
              return (
                <li key={t.id}>
                  <NavLink href={href} height="h-[30px]" active={pathname === href || safeDecode(pathname) === `/app/tag/${t.name}`}>
                    <Hash size={15} aria-hidden="true" className="mx-px shrink-0 text-muted" />
                    <span className="truncate">{t.name}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="min-h-4 flex-1" />
      <div className="flex flex-col gap-0.5 border-t border-line pt-2.5">
        <NavLink href="/app/settings" active={pathname === '/app/settings'}>
          <Settings size={16} aria-hidden="true" className={`shrink-0 ${pathname === '/app/settings' ? '' : 'opacity-85'}`} />
          Configuración
        </NavLink>
        <div className="flex items-center gap-2.5 px-2.5 pb-0.5 pt-1.5">
          <Avatar person={user} size={22} />
          <span className="truncate text-meta text-muted">{user.email}</span>
        </div>
      </div>

      {dialog && (
        <ListDialog
          list={dialog.list} folders={folders} owner={dialog.list ? owners[dialog.list.id] : undefined}
          currentUserId={user.id} onClose={() => setDialog(null)}
        />
      )}
      {folderToDelete && (
        <ConfirmDialog
          title={`¿Borrar la carpeta «${folderToDelete.name}»?`} body="Sus listas quedan sueltas: no se borran."
          confirmLabel="Borrar carpeta" pending={pending}
          onCancel={() => setFolderToDelete(null)} onConfirm={removeFolder}
        />
      )}
    </nav>
  );
}
