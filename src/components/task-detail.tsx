'use client';

import { ArrowLeft, RotateCcw, Trash2 } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { isValidIsoDate, isValidTime } from '@/core/dates';
import type { List } from '@/core/lists';
import type { ListMember } from '@/core/members';
import type { TaskWithDetails, UpdateTaskInput } from '@/core/tasks';
import type { ActionResult } from '@/lib/action-result';
import {
  deleteTaskAction, moveTaskAction, restoreTaskAction, toggleTaskAction, updateTaskAction,
} from '@/app/app/actions';
import { PriorityCheckbox } from './priority-checkbox';
import { PrioritySelect } from './priority-select';
import { SubtaskList } from './subtask-list';
import { TagEditor } from './tag-editor';

export function TaskDetail({
  task, lists, members, currentUserId,
}: { task: TaskWithDetails; lists: List[]; members: ListMember[]; currentUserId: string }) {
  const inTrash = task.deletedAt !== null;
  const router = useRouter();
  const pathname = usePathname();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [date, setDate] = useState(task.dueDate ?? '');
  const [time, setTime] = useState(task.dueTime ?? '');
  const [priority, setPriority] = useState(task.priority);
  const [listId, setListId] = useState(task.listId);
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => setDate(task.dueDate ?? ''), [task.dueDate]);
  useEffect(() => setTime(task.dueTime ?? ''), [task.dueTime]);
  useEffect(() => setPriority(task.priority), [task.priority]);
  useEffect(() => setListId(task.listId), [task.listId]);
  useEffect(() => setAssigneeId(task.assigneeId ?? ''), [task.assigneeId]);

  const close = () => router.push(pathname, { scroll: false });
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
    const clean = title.trim();
    if (!clean) { setTitle(task.title); return; }
    setTitle(clean);
    if (clean !== task.title) save({ title: clean });
  }
  function move(newListId: string) {
    setListId(newListId);
    run(
      () => moveTaskAction(task.id, newListId),
      // Si la vista actual es una lista y la tarea se fue a otra, el detalle ya no corresponde.
      () => { if (pathname.startsWith('/app/list/') && !pathname.includes(newListId)) close(); },
      () => setListId(task.listId),
    );
  }

  function assign(next: string) {
    setAssigneeId(next);
    run(
      () => updateTaskAction(task.id, { assigneeId: next || null }),
      // En "Asignadas a mí", una tarea reasignada a otra persona (o sin asignar) deja de pertenecer a la vista.
      () => { if (pathname.startsWith('/app/assigned') && next !== currentUserId) close(); },
      () => setAssigneeId(task.assigneeId ?? ''),
    );
  }

  const header = (
    <button onClick={close} aria-label="Cerrar detalle" className="rounded p-1.5 hover:bg-hover"><ArrowLeft size={18} /></button>
  );

  if (inTrash) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">{header}</div>
        <div className="space-y-4 p-4">
          <h2 className="text-lg font-semibold">{task.title}</h2>
          <p className="text-sm text-muted">Esta tarea está en la papelera. Se borra definitivamente a los 30 días.</p>
          <button
            onClick={() => run(() => restoreTaskAction(task.id), close)}
            className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg"
          >
            <RotateCcw size={15} /> Restaurar
          </button>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </div>
      </div>
    );
  }

  const done = task.status === 'completed';
  const control = 'rounded border border-line bg-transparent px-2 py-1 text-sm';
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        {header}
        <PriorityCheckbox
          checked={done} priority={priority} onChange={() => run(() => toggleTaskAction(task.id, !done))}
          label={done ? 'Marcar esta tarea como pendiente' : 'Completar esta tarea'}
        />
        <input
          type="date" value={date} aria-label="Fecha" className={control}
          onChange={(e) => { setDate(e.target.value); commitDate(e.target, false); }}
          onBlur={(e) => commitDate(e.target, true)}
        />
        {task.dueDate && (
          <input
            type="time" value={time} aria-label="Hora" className={control}
            onChange={(e) => { setTime(e.target.value); commitTime(e.target, false); }}
            onBlur={(e) => commitTime(e.target, true)}
          />
        )}
        <PrioritySelect
          value={priority}
          onChange={(p) => { setPriority(p); save({ priority: p }, () => setPriority(task.priority)); }}
        />
        <button
          aria-label="Mandar a la papelera" className="ml-auto rounded p-1.5 text-muted hover:bg-hover hover:text-danger"
          onClick={() => confirm('¿Mandar la tarea a la papelera?') && run(() => deleteTaskAction(task.id), close)}
        >
          <Trash2 size={17} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <input
          value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Título"
          onBlur={saveTitle}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className={`w-full bg-transparent text-lg font-semibold outline-none ${done ? 'text-muted line-through' : ''}`}
        />
        <textarea
          value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Descripción"
          onBlur={() => description !== task.description && save({ description })}
          placeholder="Descripción" rows={4}
          className="w-full resize-y bg-transparent text-sm outline-none placeholder:text-muted"
        />
        <SubtaskList task={task} onError={setError} />
        <div className="space-y-1">
          <TagEditor tags={task.tags} onChange={(tags, onFail) => save({ tags }, onFail)} />
          {task.otherTags.length > 0 && (
            <p className="text-xs text-muted">
              De otros miembros: {task.otherTags.map((t) => `#${t}`).join(' ')}
            </p>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          Lista
          <select
            value={listId} onChange={(e) => move(e.target.value)}
            className={`${control} text-fg`} aria-label="Lista"
          >
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        {members.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted">
            Asignada a
            <select
              value={assigneeId} onChange={(e) => assign(e.target.value)}
              className={`${control} text-fg`} aria-label="Asignada a"
            >
              <option value="">Sin asignar</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name ? `${m.name} (${m.email})` : m.email}</option>
              ))}
            </select>
          </label>
        )}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </div>
  );
}
