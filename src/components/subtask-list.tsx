'use client';

import { Check, Plus, X } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import type { Subtask, TaskWithDetails } from '@/core/tasks';
import type { ActionResult } from '@/lib/action-result';
import { addSubtaskAction, deleteSubtaskAction, updateSubtaskAction } from '@/app/app/actions';
import { sectionLabel } from './ui';

type Run = (fn: () => Promise<ActionResult<unknown>>, onFail?: () => void) => void;

function SubtaskRow({ subtask, index, run }: { subtask: Subtask; index: number; run: Run }) {
  const [title, setTitle] = useState(subtask.title);
  const [done, setDone] = useState(subtask.done);
  useEffect(() => setTitle(subtask.title), [subtask.title]);
  useEffect(() => setDone(subtask.done), [subtask.done]);

  function saveTitle() {
    const clean = title.trim();
    if (!clean) { setTitle(subtask.title); return; }
    setTitle(clean);
    if (clean !== subtask.title) run(() => updateSubtaskAction(subtask.id, { title: clean }), () => setTitle(subtask.title));
  }

  return (
    <li className="group flex min-h-[38px] items-center gap-3 rounded-pill px-1 transition-colors duration-120 focus-within:bg-hover hover:bg-hover">
      <span className="relative flex h-4 w-4 shrink-0">
        <input
          type="checkbox" checked={done} aria-label={`Completar subtarea "${subtask.title}"`}
          onChange={(e) => {
            const next = e.target.checked;
            setDone(next);
            run(() => updateSubtaskAction(subtask.id, { done: next }), () => setDone(subtask.done));
          }}
          className="peer h-4 w-4 cursor-pointer appearance-none rounded-full border-[1.5px] border-p-none transition-colors duration-200 checked:border-muted checked:bg-muted"
        />
        <Check
          size={10} strokeWidth={3.5} aria-hidden="true"
          className="pointer-events-none absolute left-[3px] top-[3px] hidden text-surface peer-checked:block"
        />
      </span>
      <input
        value={title} onChange={(e) => setTitle(e.target.value)} aria-label={`Editar subtarea ${index + 1}`}
        onBlur={saveTitle} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className={`min-w-0 flex-1 bg-transparent text-body-sm outline-none focus-visible:outline-none ${done ? 'text-muted line-through' : 'text-fg'}`}
      />
      <button
        type="button" onClick={() => run(() => deleteSubtaskAction(subtask.id))} aria-label={`Borrar subtarea "${subtask.title}"`}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-chip text-muted hover:text-fg md:opacity-0 md:focus-visible:opacity-100 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </li>
  );
}

export function SubtaskList({ task, onError }: { task: TaskWithDetails; onError: (e: string | null) => void }) {
  const [newTitle, setNewTitle] = useState('');
  const [, startTransition] = useTransition();
  const run: Run = (fn, onFail) =>
    startTransition(async () => {
      const result = await fn();
      onError(result.ok ? null : result.error);
      if (!result.ok) onFail?.();
    });
  const total = task.subtasks.length;
  const doneCount = task.subtasks.filter((s) => s.done).length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <h3 className={sectionLabel}>Subtareas</h3>
        {total > 0 && (
          <>
            <span className="text-meta font-semibold tabular-nums text-muted">{doneCount}/{total}</span>
            <span
              role="progressbar" aria-label="Subtareas completadas" aria-valuemin={0} aria-valuemax={total} aria-valuenow={doneCount}
              className="h-1 flex-1 overflow-hidden rounded-sm bg-hover"
            >
              <span className="block h-full rounded-sm bg-accent transition-[width] duration-250" style={{ width: `${(doneCount / total) * 100}%` }} />
            </span>
          </>
        )}
      </div>
      <div className="flex flex-col">
        <ul className="flex flex-col">
          {task.subtasks.map((s, i) => <SubtaskRow key={s.id} subtask={s} index={i} run={run} />)}
        </ul>
        <form
          className="flex min-h-[38px] items-center gap-3 rounded-pill px-1 text-muted transition-colors duration-120 focus-within:bg-hover"
          onSubmit={(e) => {
            e.preventDefault();
            const title = newTitle.trim();
            if (!title) return;
            setNewTitle('');
            // Si falla, se devuelve el texto salvo que el usuario ya haya empezado a escribir otra cosa.
            run(() => addSubtaskAction(task.id, title), () => setNewTitle((current) => current || title));
          }}
        >
          <Plus size={16} aria-hidden="true" className="shrink-0" />
          <input
            value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Agregar subtarea"
            aria-label="Nueva subtarea"
            className="min-w-0 flex-1 bg-transparent text-body-sm text-fg outline-none placeholder:text-muted focus-visible:outline-none"
          />
        </form>
      </div>
    </div>
  );
}
