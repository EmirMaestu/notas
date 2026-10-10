'use client';

import { CircleAlert, List as ListIcon, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { TaskWithDetails } from '@/core/tasks';
import { createdViaClient, formatDueLabel, localTime, trashNote } from '@/lib/format';
import { restoreTaskAction, toggleTaskAction, updateTaskAction } from '@/app/app/actions';
import { Avatar } from './avatar';
import { PriorityCheckbox } from './priority-checkbox';
import { useToast } from './toast';
import { SAVE_ERROR, useWorkspace } from './workspace-context';

export type TaskItemVariant = 'default' | 'completed' | 'trash';

/** Margen para deshacer un clic en el checkbox antes de mandarlo al servidor. */
const UNDO_WINDOW_MS = 600;
/** Atajos 1–4 sobre la fila: 1 = alta, 2 = media, 3 = baja, 4 = sin prioridad. */
const KEY_PRIORITY: Record<string, number> = { 1: 5, 2: 3, 3: 1, 4: 0 };

export function TaskItem({
  task, selected, today, now, timezone, list, variant, isNew,
}: {
  task: TaskWithDetails; selected: boolean; today: string; now: string; timezone: string;
  /** Lista de la tarea (solo en vistas mixtas). */
  list?: { name: string; color: string | null };
  variant: TaskItemVariant; isNew: boolean;
}) {
  const pathname = usePathname();
  const toast = useToast();
  const { hidden, hide, unhide, trash, openTask } = useWorkspace();
  const [localDone, setLocalDone] = useState<boolean | null>(null);
  const [localPriority, setLocalPriority] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDone = useRef<boolean | null>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);

  const done = localDone ?? task.status === 'completed';
  const priority = localPriority ?? task.priority;
  const leaving = hidden.has(task.id);
  const inTrash = variant === 'trash';

  useEffect(() => setLocalPriority(null), [task.priority]);

  // Si la fila se desmonta (p. ej. al navegar) con un clic todavía en su margen, el cambio se manda igual.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (pendingDone.current !== null) void toggleTaskAction(task.id, pendingDone.current);
  }, [task.id]);

  async function commit(next: boolean) {
    timer.current = null;
    pendingDone.current = null;
    hide(task.id);
    setBusy(true);
    let error: string | null = null;
    try {
      const result = await toggleTaskAction(task.id, next);
      if (!result.ok) error = result.error;
    } catch {
      error = SAVE_ERROR;
    }
    setBusy(false);
    if (error) {
      unhide(task.id);
      setLocalDone(null);
      toast({
        tone: 'error', message: error,
        action: { label: 'Reintentar', onClick: () => { setLocalDone(next); void commit(next); } },
      });
    }
  }

  function toggle() {
    if (timer.current) {
      // Segundo clic dentro del margen: se deshace sin tocar el servidor.
      clearTimeout(timer.current);
      timer.current = null;
      pendingDone.current = null;
      setLocalDone(null);
      return;
    }
    const next = !done;
    setLocalDone(next);
    pendingDone.current = next;
    timer.current = setTimeout(() => void commit(next), UNDO_WINDOW_MS);
  }

  async function restore() {
    setBusy(true);
    let error: string | null = null;
    try {
      const result = await restoreTaskAction(task.id);
      if (!result.ok) error = result.error;
    } catch {
      error = SAVE_ERROR;
    }
    setBusy(false);
    if (error) toast({ tone: 'error', message: error });
    else hide(task.id);
  }

  async function changePriority(next: number) {
    if (next === priority) return;
    setLocalPriority(next);
    let error: string | null = null;
    try {
      const result = await updateTaskAction(task.id, { priority: next });
      if (!result.ok) error = result.error;
    } catch {
      error = SAVE_ERROR;
    }
    if (error) {
      setLocalPriority(null);
      toast({ tone: 'error', message: error });
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLLIElement>) {
    if (e.target !== linkRef.current || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const links = [...document.querySelectorAll<HTMLElement>('[data-task-link]')].filter((l) => !l.closest('[inert]'));
      links[links.indexOf(linkRef.current!) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
      return;
    }
    if (inTrash) return;
    if (e.key === ' ') {
      e.preventDefault();
      toggle();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      trash(task);
    } else if (e.key === 'e' || e.key === 'E') {
      e.preventDefault();
      openTask(task.id, { editTitle: true });
    } else if (Object.hasOwn(KEY_PRIORITY, e.key)) {
      e.preventDefault();
      void changePriority(KEY_PRIORITY[e.key]);
    }
  }

  const overdue = !done && task.dueDate !== null && task.dueDate < today;
  const isToday = task.dueDate === today;
  const subtasksDone = task.subtasks.filter((s) => s.done).length;
  const allTags = [...task.tags, ...task.otherTags];
  const note = inTrash && task.deletedAt ? trashNote(task.deletedAt, new Date(now))
    : variant === 'completed' && task.completedAt ? localTime(task.completedAt, timezone)
    : null;
  const hasMeta = Boolean(list || allTags.length > 0 || note);
  const showDate = task.dueDate !== null && variant === 'default';

  return (
    <li
      data-task-row={task.id} onKeyDown={onKeyDown} inert={leaving} aria-hidden={leaving || undefined}
      className={`grid transition-[grid-template-rows,opacity] duration-280 ease-out ${leaving ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'} ${isNew ? 'animate-fade-in' : ''}`}
    >
      {/* overflow-hidden solo mientras sale: si no, recortaría el anillo de foco de la fila. */}
      <div className={`min-h-0 ${leaving ? 'overflow-hidden' : ''}`}>
        <div
          className={`flex min-h-12 items-center gap-3.5 rounded-row px-3.5 py-[9px] transition-colors duration-120 has-[a:focus-visible]:shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--accent)] ${selected ? 'bg-selected' : 'hover:bg-hover'}`}
        >
          {inTrash ? (
            <Trash2 size={18} aria-hidden="true" className="mx-px shrink-0 text-muted" />
          ) : (
            <PriorityCheckbox
              checked={done} priority={priority} onChange={toggle} disabled={busy}
              label={done ? `Marcar "${task.title}" como pendiente` : `Completar "${task.title}"`}
            />
          )}
          <Link
            ref={linkRef} data-task-link={task.id} href={`${pathname}?t=${task.id}`} scroll={false}
            className="flex min-w-0 flex-1 items-center gap-3.5 self-stretch focus-visible:outline-none"
          >
            <span className="flex min-w-0 flex-1 flex-col justify-center gap-[3px]">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={`truncate font-medium transition-colors duration-120 ${done || inTrash ? 'text-muted' : 'text-fg'} ${done ? 'line-through decoration-muted' : ''}`}
                >
                  {task.title}
                </span>
                {createdViaClient(task.createdVia) && (
                  <span role="img" aria-label="Creada por IA" className="inline-flex shrink-0 text-accent opacity-90">
                    <Sparkles size={13} strokeWidth={2} aria-hidden="true" />
                  </span>
                )}
                {task.subtasks.length > 0 && (
                  <span className="inline-flex shrink-0 items-center gap-[3px] text-meta tabular-nums text-muted">
                    <ListIcon size={11} strokeWidth={2.4} aria-hidden="true" />
                    {subtasksDone}/{task.subtasks.length}
                    <span className="sr-only"> subtareas</span>
                  </span>
                )}
              </span>
              {hasMeta && (
                <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted">
                  {list && (
                    <span className="inline-flex shrink-0 items-center gap-[5px]">
                      <span className="h-[7px] w-[7px] rounded-full" style={{ backgroundColor: list.color ?? 'var(--muted)' }} />
                      {list.name}
                    </span>
                  )}
                  {allTags.map((t) => (
                    <span key={t} className="shrink-0 rounded-chip bg-hover px-1.5 py-px font-medium">#{t}</span>
                  ))}
                  {note && <span className="truncate">{note}</span>}
                </span>
              )}
            </span>
            {showDate && (
              <span
                className={`inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap text-caption font-semibold tabular-nums ${overdue ? 'text-danger' : isToday ? 'text-accent' : 'text-muted'}`}
              >
                {overdue && (
                  <>
                    <CircleAlert size={12} strokeWidth={2.4} aria-hidden="true" />
                    <span className="sr-only">Vencida:</span>
                  </>
                )}
                {formatDueLabel(task.dueDate!, today)}{task.dueTime ? ` ${task.dueTime}` : ''}
              </span>
            )}
            {task.assignee && (
              <>
                <Avatar person={task.assignee} size={24} />
                <span className="sr-only">Asignada a {task.assignee.name || task.assignee.email}</span>
              </>
            )}
          </Link>
          {inTrash && (
            <button
              type="button" onClick={() => void restore()} disabled={busy} aria-label={`Restaurar "${task.title}"`}
              className="inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-pill border border-line bg-surface px-2.5 text-caption font-semibold text-fg transition-colors duration-120 hover:bg-hover disabled:opacity-50"
            >
              <RotateCcw size={13} strokeWidth={2.2} aria-hidden="true" />
              Restaurar
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
