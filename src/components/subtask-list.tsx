'use client';

import { X } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import type { Subtask, TaskWithDetails } from '@/core/tasks';
import type { ActionResult } from '@/lib/action-result';
import { addSubtaskAction, deleteSubtaskAction, updateSubtaskAction } from '@/app/app/actions';

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
    <li className="group flex items-center gap-2">
      <input
        type="checkbox" checked={done} aria-label={`Completar subtarea "${subtask.title}"`} className="accent-[var(--accent)]"
        onChange={(e) => {
          const next = e.target.checked;
          setDone(next);
          run(() => updateSubtaskAction(subtask.id, { done: next }), () => setDone(subtask.done));
        }}
      />
      <input
        value={title} onChange={(e) => setTitle(e.target.value)} aria-label={`Editar subtarea ${index + 1}`}
        onBlur={saveTitle} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className={`min-w-0 flex-1 bg-transparent text-sm outline-none ${done ? 'text-muted line-through' : ''}`}
      />
      <button
        onClick={() => run(() => deleteSubtaskAction(subtask.id))} aria-label={`Borrar subtarea "${subtask.title}"`}
        className="rounded p-0.5 text-muted hover:bg-hover md:opacity-0 md:focus-visible:opacity-100 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
      >
        <X size={14} />
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

  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Subtareas</h3>
      <ul className="space-y-1">
        {task.subtasks.map((s, i) => <SubtaskRow key={s.id} subtask={s} index={i} run={run} />)}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const title = newTitle.trim();
          if (!title) return;
          setNewTitle('');
          // Si falla, se devuelve el texto salvo que el usuario ya haya empezado a escribir otra cosa.
          run(() => addSubtaskAction(task.id, title), () => setNewTitle((current) => current || title));
        }}
      >
        <input
          value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="+ Agregar subtarea"
          aria-label="Nueva subtarea" className="mt-1 w-full bg-transparent text-sm outline-none placeholder:text-muted"
        />
      </form>
    </div>
  );
}
