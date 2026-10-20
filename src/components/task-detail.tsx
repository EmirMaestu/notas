'use client';

import {
  ArrowLeft, Bell, Calendar, Clock, Flag, List as ListIcon, Maximize2, Minimize2, RotateCcw, Sparkles, Trash2, User, X,
} from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState, useTransition } from 'react';
import { isValidIsoDate, isValidTime } from '@/core/dates';
import type { Folder, ListWithRole } from '@/core/lists';
import type { ListMember } from '@/core/members';
import { reminderLabel, reminderOptionsFor, type ReminderOption } from '@/core/reminder-options';
import type { TaskWithDetails, UpdateTaskInput } from '@/core/tasks';
import type { ActionResult } from '@/lib/action-result';
import { groupListsByFolder, listDisplayName } from '@/lib/list-groups';
import { createdViaClient, formatAgo, formatDetailDate, formatShortDate, localTime, trashNote } from '@/lib/format';
import { useSyncedField } from '@/lib/synced-field';
import { moveTaskAction, restoreTaskAction, toggleTaskAction, updateTaskAction } from '@/app/app/actions';
import { Avatar } from './avatar';
import { MarkdownEditor } from './markdown-editor';
import { useShell } from './app-shell';
import { PriorityCheckbox } from './priority-checkbox';
import { PrioritySelect } from './priority-select';
import { SelectPill } from './select-pill';
import { SubtaskList } from './subtask-list';
import { TagEditor } from './tag-editor';
import { btn } from './ui';
import { useWorkspace } from './workspace-context';

const PILL = 'relative inline-flex h-[30px] items-center gap-[5px] rounded-pill border border-line px-2.5 text-[13.5px] font-semibold tabular-nums transition-[background-color,border-color,box-shadow] duration-120 hover:bg-hover has-[:focus-visible]:border-accent has-[:focus-visible]:shadow-[0_0_0_3px_var(--selected)]';
/** Input nativo transparente encima de la píldora: conserva el selector del sistema y el teclado. */
const OVERLAY = 'absolute inset-0 h-full w-full cursor-pointer opacity-0';
const PROP_LABEL = 'flex h-9 items-center gap-2 text-muted';

function openPicker(e: React.MouseEvent<HTMLInputElement>) {
  try {
    e.currentTarget.showPicker();
  } catch {
    // Ya abierto o navegador sin showPicker: queda el comportamiento nativo.
  }
}

/**
 * Un textarea que crece con su contenido. `field-sizing: content` (que evita el salto antes de hidratar) no existe en
 * todos los navegadores (Firefox, Safari): sin esto el campo se queda en `rows` líneas y el resto del texto queda cortado. Se recalcula al
 * cambiar el texto y al cambiar el ancho (el texto se reacomoda).
 */
function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    const observer = new ResizeObserver(() => {
      // Solo si cambió el ancho: cambiar el alto desde acá no debe volver a dispararlo.
      if (el.dataset.w !== String(el.clientWidth)) {
        el.dataset.w = String(el.clientWidth);
        fit();
      }
    });
    el.dataset.w = String(el.clientWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, value]);
}

export function TaskDetail({
  task, lists, folders, members, currentUserId, today, now, timezone, expanded = false, onToggleExpanded,
}: {
  task: TaskWithDetails; lists: ListWithRole[]; folders: Folder[]; members: ListMember[]; currentUserId: string;
  today: string; now: string; timezone: string;
  /** Panel a pantalla completa (solo en escritorio): ocupa el lugar de la lista de tareas. */
  expanded?: boolean; onToggleExpanded?: () => void;
}) {
  const inTrash = task.deletedAt !== null;
  const pathname = usePathname();
  const { closeDetail, trash, hide, consumeEditTitle } = useWorkspace();
  const { user } = useShell();
  const { value: title, setValue: setTitle, baseline: titleBase } = useSyncedField(task.title);
  const { value: description, setValue: setDescription, baseline: descriptionBase } = useSyncedField(task.description);
  const [date, setDate] = useState(task.dueDate ?? '');
  const [time, setTime] = useState(task.dueTime ?? '');
  const [priority, setPriority] = useState(task.priority);
  const [listId, setListId] = useState(task.listId);
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? '');
  const [reminder, setReminder] = useState<ReminderOption | ''>(task.reminder ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(titleRef, title);

  useEffect(() => setDate(task.dueDate ?? ''), [task.dueDate]);
  useEffect(() => setTime(task.dueTime ?? ''), [task.dueTime]);
  useEffect(() => setPriority(task.priority), [task.priority]);
  useEffect(() => setListId(task.listId), [task.listId]);
  useEffect(() => setAssigneeId(task.assigneeId ?? ''), [task.assigneeId]);
  useEffect(() => setReminder(task.reminder ?? ''), [task.reminder]);

  // Atajo E desde la fila: el detalle abre con el título listo para editar.
  useEffect(() => {
    if (!consumeEditTitle()) return;
    const el = titleRef.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [consumeEditTitle]);

  // Esc cierra el detalle (guardando antes el campo que se estaba editando) y devuelve el foco a la fila.
  // A pantalla completa, el primer Esc solo vuelve al tamaño normal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && rootRef.current?.contains(active) && (active.isContentEditable || active.matches('input, textarea, select'))) {
        active.blur();
      }
      if (expanded && onToggleExpanded) onToggleExpanded();
      else closeDetail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeDetail, expanded, onToggleExpanded]);

  const run = (fn: () => Promise<ActionResult<unknown>>, after?: () => void, onFail?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      setError(result.ok ? null : result.error);
      if (result.ok) after?.();
      else onFail?.();
    });
  const save = (input: UpdateTaskInput, onFail?: () => void) => run(() => updateTaskAction(task.id, input), undefined, onFail);

  // Fecha y hora: se guarda solo con un valor completo (los inputs nativos emiten fechas intermedias
  // mientras se tipea el año) o al salir del campo; vacío borra el valor. Un campo a medio escribir
  // (validity.badInput) no se interpreta como "vacío".
  function commitDate(input: HTMLInputElement, onBlur: boolean) {
    const value = input.value;
    if (value === '') {
      if (input.validity.badInput) { if (onBlur) setDate(task.dueDate ?? ''); return; }
      if (task.dueDate !== null) save({ dueDate: null }, () => setDate(task.dueDate ?? ''));
    } else if (isValidIsoDate(value)) {
      if (value !== task.dueDate) save({ dueDate: value }, () => setDate(task.dueDate ?? ''));
    } else if (onBlur) {
      setDate(task.dueDate ?? '');
    }
  }
  function commitTime(input: HTMLInputElement, onBlur: boolean) {
    const value = input.value;
    if (value === '') {
      if (input.validity.badInput) { if (onBlur) setTime(task.dueTime ?? ''); return; }
      if (task.dueTime !== null) save({ dueTime: null }, () => setTime(task.dueTime ?? ''));
    } else if (isValidTime(value)) {
      if (value !== task.dueTime) save({ dueTime: value }, () => setTime(task.dueTime ?? ''));
    } else if (onBlur) {
      setTime(task.dueTime ?? '');
    }
  }
  function saveTitle() {
    // El título se edita en un textarea (para que pueda ocupar varias líneas), pero no lleva saltos de línea.
    const clean = title.replace(/\s*\n\s*/g, ' ').trim();
    if (!clean) { setTitle(titleBase.current); return; }
    setTitle(clean);
    if (clean === titleBase.current) return;
    const previous = titleBase.current;
    titleBase.current = clean;
    save({ title: clean }, () => { titleBase.current = previous; setTitle(previous); });
  }
  function saveDescription(next: string = description) {
    if (next === descriptionBase.current) return;
    const previous = descriptionBase.current;
    descriptionBase.current = next;
    save({ description: next }, () => { descriptionBase.current = previous; setDescription(previous); });
  }
  function move(newListId: string) {
    setListId(newListId);
    run(
      () => moveTaskAction(task.id, newListId),
      // Si la vista actual es una lista y la tarea se fue a otra, el detalle ya no corresponde.
      () => { if (pathname.startsWith('/app/list/') && !pathname.includes(newListId)) closeDetail(); },
      () => setListId(task.listId),
    );
  }

  function changeReminder(next: string) {
    setReminder(next as ReminderOption | '');
    save({ reminder: next === '' ? null : (next as ReminderOption) }, () => setReminder(task.reminder ?? ''));
  }

  function assign(next: string) {
    setAssigneeId(next);
    run(
      () => updateTaskAction(task.id, { assigneeId: next || null }),
      // En "Asignadas a mí", una tarea reasignada a otra persona (o sin asignar) deja de pertenecer a la vista.
      () => { if (pathname.startsWith('/app/assigned') && next !== currentUserId) closeDetail(); },
      () => setAssigneeId(task.assigneeId ?? ''),
    );
  }

  const currentList = lists.find((l) => l.id === listId);
  const foldersById = new Map(folders.map((f) => [f.id, f]));
  const currentListName = currentList ? listDisplayName(currentList, foldersById) : '';
  const aiClient = createdViaClient(task.createdVia);
  const createdWhen = `el ${formatShortDate(task.createdAt, timezone)} a las ${localTime(task.createdAt, timezone)}`;
  const header = (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line pl-2.5 pr-3">
      <button type="button" onClick={closeDetail} aria-label="Cerrar detalle" className={`${btn.icon} h-9 w-9`}>
        <ArrowLeft size={20} aria-hidden="true" className="text-fg lg:hidden" />
        <X size={18} aria-hidden="true" className="hidden lg:block" />
      </button>
      {currentList && (
        <span className="inline-flex min-w-0 items-center gap-[5px] text-meta text-muted">
          <span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: currentList.color ?? 'var(--muted)' }} />
          <span className="truncate">{currentListName}</span>
        </span>
      )}
      <span className="flex-1" />
      {aiClient && (
        <span
          title={`Creada por ${aiClient} ${createdWhen}`}
          className="inline-flex h-6 min-w-0 items-center gap-[5px] rounded-tag bg-selected px-2 text-[11.5px] font-semibold text-accent"
        >
          <Sparkles size={12} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
          <span className="max-w-[160px] truncate">Creada por {aiClient}</span>
          <span className="sr-only">, {createdWhen}</span>
        </span>
      )}
      {onToggleExpanded && (
        // Solo en escritorio: en pantallas chicas el detalle ya ocupa todo el ancho.
        <span className="hidden lg:flex">
          <button
            type="button" onClick={onToggleExpanded} aria-pressed={expanded}
            aria-label={expanded ? 'Volver al tamaño normal' : 'Pantalla completa'}
            title={expanded ? 'Volver al tamaño normal (Esc)' : 'Pantalla completa'}
            className={`${btn.icon} h-9 w-9`}
          >
            {expanded ? <Minimize2 size={17} aria-hidden="true" /> : <Maximize2 size={17} aria-hidden="true" />}
          </button>
        </span>
      )}
    </div>
  );
  const errorBox = error && (
    <p role="alert" className="rounded-input bg-danger-bg px-3 py-2.5 text-[13px] font-semibold text-danger">{error}</p>
  );

  if (inTrash) {
    return (
      <div ref={rootRef} className="flex h-full flex-col">
        {header}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-[22px]">
          <h2 className="text-title text-muted">{task.title}</h2>
          <p className="text-body-sm text-muted">
            Esta tarea está en la papelera. {trashNote(task.deletedAt!, new Date(now))}.
          </p>
          <button
            type="button" onClick={() => run(() => restoreTaskAction(task.id), () => { hide(task.id); closeDetail(); })}
            className={`${btn.primary} h-10 self-start px-4 text-[13.5px]`}
          >
            <RotateCcw size={15} aria-hidden="true" />
            Restaurar
          </button>
          {errorBox}
        </div>
      </div>
    );
  }

  // Las opciones dependen de si la tarea tiene hora; si quedó guardada una que ya no corresponde
  // (p. ej. se le sacó la hora), se sigue mostrando para no perderla en silencio.
  const baseChoices = reminderOptionsFor(task.dueTime !== null);
  const reminderChoices: readonly ReminderOption[] = reminder && !baseChoices.includes(reminder)
    ? [...baseChoices, reminder] : baseChoices;
  const done = task.status === 'completed';
  const shownDate = isValidIsoDate(date) ? date : task.dueDate;
  const dateTone = !shownDate ? 'font-medium text-muted'
    : shownDate < today && !done ? 'text-danger'
    : shownDate === today ? 'text-accent'
    : 'text-fg';
  const shownTime = isValidTime(time) ? time : task.dueTime;
  const assignee = members.find((m) => m.id === assigneeId) ?? (task.assignee?.id === assigneeId ? task.assignee : null);

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      {header}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={`mx-auto flex w-full flex-col gap-[22px] px-[22px] pb-6 pt-[22px] ${expanded ? 'max-w-[820px] lg:px-10 lg:pt-10' : ''}`}
        >
          <div className="flex items-start gap-3.5">
            <PriorityCheckbox
              size="lg" checked={done} priority={priority} onChange={() => run(() => toggleTaskAction(task.id, !done))}
              label={done ? 'Marcar esta tarea como pendiente' : 'Completar esta tarea'}
            />
            <textarea
              ref={titleRef} rows={1} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Título"
              onBlur={saveTitle}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
              className={`min-w-0 flex-1 resize-none bg-transparent text-title outline-none [field-sizing:content] focus-visible:outline-none ${done ? 'text-muted line-through' : ''}`}
            />
          </div>

          <dl className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-y-1 text-body-sm">
            <dt className={PROP_LABEL}><Calendar size={15} aria-hidden="true" />Fecha</dt>
            <dd className="flex min-h-9 flex-wrap items-center gap-1.5">
              <label className={`${PILL} ${dateTone}`}>
                <span aria-hidden="true">{shownDate ? formatDetailDate(shownDate, today) : 'Sin fecha'}</span>
                <input
                  type="date" value={date} aria-label="Fecha" className={OVERLAY} onClick={openPicker}
                  onChange={(e) => { setDate(e.target.value); commitDate(e.target, false); }}
                  onBlur={(e) => commitDate(e.target, true)}
                />
              </label>
              {task.dueDate && (
                <label className={`${PILL} text-fg`}>
                  <Clock size={13} strokeWidth={2.2} aria-hidden="true" className="text-muted" />
                  <span aria-hidden="true" className={shownTime ? '' : 'font-medium text-muted'}>{shownTime ?? 'Agregar hora'}</span>
                  <input
                    type="time" value={time} aria-label="Hora" className={OVERLAY} onClick={openPicker}
                    onChange={(e) => { setTime(e.target.value); commitTime(e.target, false); }}
                    onBlur={(e) => commitTime(e.target, true)}
                  />
                </label>
              )}
            </dd>

            <dt className={PROP_LABEL}><Bell size={15} aria-hidden="true" />Recordatorio</dt>
            <dd className="flex min-h-9 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <SelectPill
                label="Recordatorio" value={reminder} onChange={changeReminder} disabled={!task.dueDate}
                leadingInset="flag" leading={<Bell size={13} className={reminder ? 'text-accent' : 'text-muted'} />}
              >
                <option value="">Sin recordatorio</option>
                {reminderChoices.map((o) => <option key={o} value={o}>{reminderLabel(o, user.allDayReminderTime)}</option>)}
              </SelectPill>
              {!task.dueDate && <span className="text-meta text-muted">Poné una fecha para usar recordatorios</span>}
            </dd>

            <dt className={PROP_LABEL}><Flag size={15} aria-hidden="true" />Prioridad</dt>
            <dd className="flex min-h-9 items-center">
              <PrioritySelect
                value={priority}
                onChange={(p) => { setPriority(p); save({ priority: p }, () => setPriority(task.priority)); }}
              />
            </dd>

            <dt className={PROP_LABEL}><ListIcon size={15} aria-hidden="true" />Lista</dt>
            <dd className="flex min-h-9 min-w-0 items-center">
              <SelectPill
                label="Lista" value={listId} onChange={move} leadingInset="dot"
                leading={<span className="h-2 w-2 rounded-full" style={{ backgroundColor: currentList?.color ?? 'var(--muted)' }} />}
              >
                {groupListsByFolder(lists, folders).map((g) => {
                  // El select cerrado muestra la opción elegida: con `label` se lee «Carpeta › Lista» en la píldora, y abierto cada lista sigue bajo el título de su carpeta.
                  const options = g.lists.map((l) => (
                    <option key={l.id} value={l.id} label={l.id === listId ? currentListName : undefined}>{l.name}</option>
                  ));
                  return g.label === null ? options : <optgroup key={g.label} label={g.label}>{options}</optgroup>;
                })}
              </SelectPill>
            </dd>

            {members.length > 0 && (
              <>
                <dt className={PROP_LABEL}><User size={15} aria-hidden="true" />Asignada a</dt>
                <dd className="flex min-h-9 min-w-0 items-center">
                  <SelectPill
                    label="Asignada a" value={assigneeId} onChange={assign}
                    leadingInset={assignee ? 'avatar' : 'flag'}
                    leading={assignee ? <Avatar person={assignee} size={20} /> : <User size={13} className="text-muted" />}
                  >
                    <option value="">Sin asignar</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
                  </SelectPill>
                </dd>
              </>
            )}
          </dl>

          <MarkdownEditor
            value={description} onChange={setDescription} onBlur={saveDescription} label="Descripción"
            placeholder="Agregar una descripción… (admite Markdown)" minHeight={expanded ? '40vh' : undefined}
          />

          <SubtaskList task={task} onError={setError} />

          <TagEditor tags={task.tags} otherTags={task.otherTags} onChange={(tags, onFail) => save({ tags }, onFail)} />

          {errorBox}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-4 py-3">
        <span className="text-meta text-muted" aria-live="polite">
          {saving ? 'Guardando…' : `Modificada ${formatAgo(task.updatedAt, new Date(now), timezone)}`}
        </span>
        <button type="button" onClick={() => trash(task)} className={`${btn.ghostDanger} h-[34px] px-3 text-[13px]`}>
          <Trash2 size={14} aria-hidden="true" />
          Mandar a la papelera
        </button>
      </div>
    </div>
  );
}
