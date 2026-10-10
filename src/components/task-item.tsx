'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useOptimistic, useState, useTransition } from 'react';
import type { TaskWithDetails } from '@/core/tasks';
import { formatDueLabel } from '@/lib/format';
import { toggleTaskAction } from '@/app/app/actions';
import { Avatar } from './avatar';
import { PriorityCheckbox } from './priority-checkbox';

export function TaskItem({
  task, selected, today, listName, inTrash,
}: { task: TaskWithDetails; selected: boolean; today: string; listName?: string; inTrash: boolean }) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useOptimistic(task.status === 'completed');

  function toggle() {
    startTransition(async () => {
      setDone(!done);
      const result = await toggleTaskAction(task.id, !done);
      setError(result.ok ? null : result.error);
    });
  }

  const overdue = !done && task.dueDate !== null && task.dueDate < today;
  const subtasksDone = task.subtasks.filter((s) => s.done).length;
  const allTags = [...task.tags, ...task.otherTags];

  return (
    <li className={`rounded-md px-3 py-2 ${selected ? 'bg-selected' : 'hover:bg-hover'}`}>
      <div className="flex items-center gap-3">
        {!inTrash && (
          <PriorityCheckbox
            checked={done} priority={task.priority} onChange={toggle} disabled={pending}
            label={done ? `Marcar "${task.title}" como pendiente` : `Completar "${task.title}"`}
          />
        )}
        <Link href={`${pathname}?t=${task.id}`} scroll={false} className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <span className={`truncate ${done ? 'text-muted line-through' : ''}`}>{task.title}</span>
          {task.subtasks.length > 0 && <span className="shrink-0 text-xs text-muted">{subtasksDone}/{task.subtasks.length}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-2 text-xs">
            {allTags.map((t) => <span key={t} className="hidden rounded bg-hover px-1.5 py-0.5 text-muted sm:inline">#{t}</span>)}
            {listName && <span className="hidden text-muted lg:inline">{listName}</span>}
            {task.dueDate && (
              <span className={overdue ? 'text-danger' : 'text-accent'}>
                {formatDueLabel(task.dueDate, today)}{task.dueTime ? ` ${task.dueTime}` : ''}
              </span>
            )}
            {task.assignee && (
              <>
                <Avatar person={task.assignee} size="sm" />
                <span className="sr-only">Asignada a {task.assignee.name || task.assignee.email}</span>
              </>
            )}
          </span>
        </Link>
      </div>
      {error && <p role="alert" className="mt-1 pl-[30px] text-xs text-danger">{error}</p>}
    </li>
  );
}
