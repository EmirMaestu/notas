'use client';

import { Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Folder, ListWithRole } from '@/core/lists';
import type { ListMember } from '@/core/members';
import type { TaskWithDetails } from '@/core/tasks';
import type { QuickAddContext } from '@/app/app/actions';
import { formatLongDate, formatWeekRange, pendingLabel } from '@/lib/format';
import { Avatar } from './avatar';
import { ListDialog } from './list-dialog';
import { MobileHeader } from './mobile-header';
import { QuickAdd } from './quick-add';
import { TaskDetail } from './task-detail';
import { TaskList, type TaskGrouping } from './task-list';
import type { TaskItemVariant } from './task-item';
import { ViewHeader } from './view-header';
import { WorkspaceProvider, isEditableTarget } from './workspace-context';

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

export function TaskWorkspace({
  title, tasks, selected, lists, members, context, today, now, timezone, currentUserId, list, listMembers, folders,
}: {
  title: string; tasks: TaskWithDetails[]; selected: TaskWithDetails | null;
  lists: ListWithRole[]; members: ListMember[]; context: QuickAddContext; today: string; now: string; timezone: string;
  currentUserId: string; list?: ListWithRole; listMembers: ListMember[]; folders: Folder[];
}) {
  const [listDialog, setListDialog] = useState(false);
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

  const titleNode = (
    <>
      {list?.color && <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: list.color }} />}
      <span className="truncate">{title}</span>
    </>
  );

  const shownMembers = listMembers.slice(0, 3);
  const extraMembers = listMembers.length - shownMembers.length;
  const headerActions = list?.shared ? (
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

  const destinationList = context.listId ? list : lists.find((l) => l.isInbox);
  const destination = { name: destinationList?.name ?? 'Bandeja', color: destinationList?.color ?? null };
  const placeholder =
    context.listId && list ? `Agregar tarea en ${list.name}…`
    : context.view === 'inbox' ? 'Agregar tarea a la Bandeja…'
    : context.tag ? `Agregar tarea con #${context.tag}…`
    : 'Agregar tarea… «Pagar luz mañana !alta #casa»';

  return (
    <WorkspaceProvider tasks={tasks} selectedId={selected?.id}>
      <div className="flex h-full">
        <section aria-label={title} className={`min-w-0 flex-1 flex-col ${selected ? 'hidden lg:flex' : 'flex'}`}>
          <MobileHeader title={titleNode} subtitle={subtitle} />
          <div className={`mx-auto hidden w-full shrink-0 px-7 pt-[30px] md:block ${maxWidth}`}>
            <ViewHeader title={titleNode} subtitle={subtitle} actions={headerActions} />
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
              <TaskList
                tasks={tasks} selectedId={selected?.id} grouping={grouping} today={today} now={now} timezone={timezone}
                lists={lists} showListName={!context.listId && context.view !== 'inbox'} variant={variant}
                empty={<p className="px-6 py-16 text-center text-[13px] text-muted">No hay tareas acá.</p>}
              />
            </div>
          </div>
        </section>
        {selected && (
          <aside className="flex w-full animate-screen-in flex-col bg-surface lg:w-[400px] lg:shrink-0 lg:animate-panel-in lg:border-l lg:border-line">
            <TaskDetail
              key={selected.id} task={selected} lists={lists} members={members} currentUserId={currentUserId}
              today={today} now={now} timezone={timezone}
            />
          </aside>
        )}
      </div>
      {listDialog && list && <ListDialog list={list} folders={folders} onClose={() => setListDialog(false)} />}
    </WorkspaceProvider>
  );
}
