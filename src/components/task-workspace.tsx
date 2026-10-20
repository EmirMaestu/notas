'use client';

import {
  CalendarDays, CircleCheck, Hash, Inbox, List as ListIcon, Sun, Trash2, UserCheck, Users,
} from 'lucide-react';
import { useCallback, useEffect, useState, useTransition } from 'react';
import type { Folder, ListWithRole } from '@/core/lists';
import type { ListMember } from '@/core/members';
import type { TaskWithDetails } from '@/core/tasks';
import { emptyTrashAction, type QuickAddContext } from '@/app/app/actions';
import { formatLongDate, formatWeekRange, pendingLabel } from '@/lib/format';
import { useShell } from './app-shell';
import { Avatar } from './avatar';
import { ConfirmDialog } from './confirm-dialog';
import { EmptyState, type EmptyStateAction } from './empty-state';
import { ListDialog } from './list-dialog';
import { MobileHeader } from './mobile-header';
import { QuickAdd } from './quick-add';
import { TaskDetail } from './task-detail';
import { TaskList, type TaskGrouping } from './task-list';
import type { TaskItemVariant } from './task-item';
import { useToast } from './toast';
import { ViewHeader } from './view-header';
import { SAVE_ERROR, WorkspaceProvider, isEditableTarget } from './workspace-context';

function subtitleFor(context: QuickAddContext, tasks: TaskWithDetails[], today: string, list?: ListWithRole): string {
  const pending = pendingLabel(tasks.filter((t) => t.status === 'pending').length);
  switch (context.view) {
    case 'today': return `${formatLongDate(today)} · ${pending}`;
    case 'next7': return formatWeekRange(today);
    case 'inbox': return `Tareas sin lista · ${pending}`;
    case 'assigned': return `En listas compartidas · ${pending}`;
    case 'completed': return 'Las más recientes primero';
    case 'trash': return 'Se eliminan solas a los 30 días';
  }
  if (context.tag) return `Etiqueta · ${pending}`;
  return list?.shared ? `Compartida · ${pending}` : pending;
}

function focusQuickAdd() {
  document.getElementById('quick-add-input')?.focus();
}

export function TaskWorkspace({
  title, tasks, selected, lists, members, context, today, now, timezone, currentUserId, list, listMembers, folders,
}: {
  title: string; tasks: TaskWithDetails[]; selected: TaskWithDetails | null;
  lists: ListWithRole[]; members: ListMember[]; context: QuickAddContext; today: string; now: string; timezone: string;
  currentUserId: string; list?: ListWithRole; listMembers: ListMember[]; folders: Folder[];
}) {
  const { openDrawer } = useShell();
  const toast = useToast();
  const [listDialog, setListDialog] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [emptying, startEmptying] = useTransition();
  // Detalle a pantalla completa (escritorio). Al cerrar el detalle vuelve al tamaño normal.
  const [expanded, setExpanded] = useState(false);
  const selectedId = selected?.id;
  useEffect(() => { if (!selectedId) setExpanded(false); }, [selectedId]);
  const toggleExpanded = useCallback(() => setExpanded((v) => !v), []);
  const inTrash = context.view === 'trash';
  // En "Asignadas a mí" una tarea nueva no quedaría asignada y no se vería: no se ofrece agregar.
  const canAdd = context.view !== 'completed' && context.view !== 'assigned' && !inTrash;
  const subtitle = subtitleFor(context, tasks, today, list);
  const maxWidth = selected ? 'md:max-w-[720px]' : 'md:max-w-[760px]';
  const variant: TaskItemVariant = inTrash ? 'trash' : context.view === 'completed' ? 'completed' : 'default';
  const grouping: TaskGrouping =
    context.view === 'today' || context.view === 'next7' ? 'date' : context.view === 'completed' ? 'completed' : 'none';

  // N enfoca el agregado rápido (fuera de campos de texto y sin diálogos abiertos).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'n' && e.key !== 'N') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableTarget(e.target) || document.querySelector('[aria-modal="true"]')) return;
      const input = document.getElementById('quick-add-input');
      if (!input) return;
      e.preventDefault();
      input.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function showSharedLists() {
    const isMobile = window.matchMedia('(max-width: 767px)').matches;
    if (isMobile) openDrawer();
    // En celular, después de que el cajón termine de entrar (280 ms) y de enfocar su primer link.
    setTimeout(() => document.querySelector<HTMLElement>('#sidebar-shared a')?.focus(), isMobile ? 320 : 0);
  }

  function emptyTrashNow() {
    startEmptying(async () => {
      let error: string | null = null;
      let leftover = 0;
      try {
        const result = await emptyTrashAction();
        if (!result.ok) error = result.error;
        else if (result.data.deleted === 0) error = 'Las tareas de listas compartidas con vos solo las puede borrar su dueño.';
        else leftover = result.data.remaining;
      } catch {
        error = SAVE_ERROR;
      }
      setConfirmEmpty(false);
      if (error) toast({ tone: 'error', message: error });
      else if (leftover > 0) {
        toast({
          tone: 'error', duration: 10000,
          message: `Quedaron ${leftover} ${leftover === 1 ? 'tarea' : 'tareas'} de listas compartidas de otras personas; solo su dueño puede eliminarlas`,
        });
      }
    });
  }

  const addAction: EmptyStateAction | undefined = canAdd ? { label: 'Agregar tarea', onClick: focusQuickAdd } : undefined;
  const empty =
    context.view === 'today' ? <EmptyState icon={Sun} title="Nada para hoy" body="Disfrutá el día, o dejá anotado algo para después." action={addAction} />
    : context.view === 'inbox' ? <EmptyState icon={Inbox} title="Bandeja vacía" body="Todo lo que agregues sin lista cae acá hasta que lo ordenes." action={addAction} />
    : context.view === 'next7' ? <EmptyState icon={CalendarDays} title="Semana libre" body="No tenés nada en los próximos 7 días." action={addAction} />
    : context.view === 'assigned' ? (
      <EmptyState
        icon={UserCheck} title="Nadie te asignó nada" body="Cuando te asignen una tarea en una lista compartida la vas a ver acá."
        action={lists.some((l) => l.role === 'member') ? { label: 'Ver listas compartidas', onClick: showSharedLists, variant: 'secondary' } : undefined}
      />
    )
    : context.view === 'completed' ? <EmptyState icon={CircleCheck} title="Todavía nada completado" body="Cuando termines una tarea, la vas a ver acá." />
    : inTrash ? <EmptyState icon={Trash2} title="La papelera está vacía" body="Lo que borres se guarda 30 días por si te arrepentís." />
    : context.tag ? <EmptyState icon={Hash} title={`Nada con #${context.tag}`} body="Las tareas que etiquetes así aparecen acá." action={addAction} />
    : <EmptyState icon={ListIcon} title="Lista vacía" body="Todavía no hay tareas en esta lista." action={addAction} />;

  const destinationList = context.listId ? list : lists.find((l) => l.isInbox);
  const destination = { name: destinationList?.name ?? 'Bandeja', color: destinationList?.color ?? null };
  const placeholder =
    context.listId && list ? `Agregar tarea en ${list.name}…`
    : context.view === 'inbox' ? 'Agregar tarea a la Bandeja…'
    : context.tag ? `Agregar tarea con #${context.tag}…`
    : 'Agregar tarea… «Pagar luz mañana !alta #casa»';

  const titleNode = (
    <>
      {list?.color && <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: list.color }} />}
      <span className="truncate">{title}</span>
    </>
  );

  const trashAction = inTrash && tasks.length > 0 ? (
    <button
      type="button" onClick={() => setConfirmEmpty(true)}
      className="inline-flex h-8 items-center rounded-nav border border-line bg-surface px-3 text-[13px] font-semibold text-danger transition-colors duration-120 hover:bg-danger-bg"
    >
      Vaciar papelera
    </button>
  ) : undefined;

  const shownMembers = listMembers.slice(0, 3);
  const extraMembers = listMembers.length - shownMembers.length;
  const membersAction = list?.shared ? (
    <>
      <div
        role="img" aria-label={`Miembros: ${listMembers.map((m) => m.name || m.email).join(', ')}`}
        className="flex items-center"
      >
        {shownMembers.map((m, i) => (
          <span key={m.id} className={i > 0 ? '-ml-2' : ''}><Avatar person={m} size={28} ring /></span>
        ))}
        {extraMembers > 0 && (
          <span className="-ml-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-bg bg-hover text-[11px] font-bold text-muted">
            +{extraMembers}
          </span>
        )}
      </div>
      <button
        type="button" onClick={() => setListDialog(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-nav border border-line bg-surface px-3 text-[13px] font-semibold transition-colors duration-120 hover:bg-hover"
      >
        <Users size={14} aria-hidden="true" />
        Miembros
      </button>
    </>
  ) : undefined;

  return (
    <WorkspaceProvider tasks={tasks} selectedId={selected?.id}>
      <div className="flex h-full">
        <section
          aria-label={title}
          className={`min-w-0 flex-1 flex-col ${!selected ? 'flex' : expanded ? 'hidden' : 'hidden lg:flex'}`}
        >
          <MobileHeader title={titleNode} subtitle={subtitle} />
          <div className={`mx-auto hidden w-full shrink-0 px-7 pt-[30px] md:block ${maxWidth}`}>
            <ViewHeader title={titleNode} subtitle={subtitle} actions={membersAction ?? trashAction} />
          </div>
          {canAdd && (
            <div
              className={`order-last shrink-0 border-t border-line bg-bg px-3 pb-7 pt-2.5 md:order-none md:mx-auto md:w-full md:border-t-0 md:bg-transparent md:px-7 md:pb-0 md:pt-[18px] ${maxWidth}`}
            >
              <QuickAdd context={context} today={today} placeholder={placeholder} destination={destination} />
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className={`mx-auto w-full px-2 pb-16 md:px-7 md:pt-[18px] ${maxWidth}`}>
              {trashAction && <div className="flex justify-end px-2 pb-1 md:hidden">{trashAction}</div>}
              <TaskList
                tasks={tasks} selectedId={selected?.id} grouping={grouping} today={today} now={now} timezone={timezone}
                lists={lists} folders={folders} showListName={!context.listId && context.view !== 'inbox'} variant={variant} empty={empty}
              />
            </div>
          </div>
        </section>
        {selected && (
          <aside
            className={`flex w-full animate-screen-in flex-col bg-surface lg:shrink-0 lg:animate-panel-in lg:border-l lg:border-line lg:transition-[width] lg:duration-[280ms] lg:ease-[cubic-bezier(.2,.8,.2,1)] ${expanded ? 'lg:w-full' : 'lg:w-[400px]'}`}
          >
            <TaskDetail
              key={selected.id} task={selected} lists={lists} folders={folders} members={members} currentUserId={currentUserId}
              today={today} now={now} timezone={timezone} expanded={expanded} onToggleExpanded={toggleExpanded}
            />
          </aside>
        )}
      </div>
      {listDialog && list && (
        <ListDialog
          list={list} folders={folders} owner={listMembers.find((m) => m.role === 'owner')}
          currentUserId={currentUserId} onClose={() => setListDialog(false)}
        />
      )}
      {confirmEmpty && (
        <ConfirmDialog
          title="¿Vaciar la papelera?" body="Las tareas de tus listas se borran para siempre. No se puede deshacer."
          confirmLabel="Vaciar papelera" pending={emptying} onCancel={() => setConfirmEmpty(false)} onConfirm={emptyTrashNow}
        />
      )}
    </WorkspaceProvider>
  );
}
