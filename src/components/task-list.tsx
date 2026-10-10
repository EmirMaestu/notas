'use client';

import { useEffect, useRef, useState } from 'react';
import type { List } from '@/core/lists';
import type { TaskWithDetails } from '@/core/tasks';
import { groupTasksByCompletedDay, groupTasksByDate, type TaskGroup } from '@/lib/format';
import { TaskItem, type TaskItemVariant } from './task-item';

export type TaskGrouping = 'date' | 'completed' | 'none';

export function TaskList({
  tasks, selectedId, grouping, today, now, timezone, lists, showListName, variant, empty,
}: {
  tasks: TaskWithDetails[]; selectedId?: string; grouping: TaskGrouping; today: string; now: string; timezone: string;
  lists: List[]; showListName: boolean; variant: TaskItemVariant; empty: React.ReactNode;
}) {
  // Ids ya vistos: las tareas que aparecen después (otra pestaña, la IA, «Deshacer») entran con fundido.
  const [initial] = useState(() => new Set(tasks.map((t) => t.id)));
  const seen = useRef(initial);
  useEffect(() => {
    for (const t of tasks) seen.current.add(t.id);
  }, [tasks]);

  if (tasks.length === 0) return <>{empty}</>;
  const listInfo = new Map(lists.map((l) => [l.id, l]));
  const groups: TaskGroup<TaskWithDetails>[] =
    grouping === 'date' ? groupTasksByDate(tasks, today)
    : grouping === 'completed' ? groupTasksByCompletedDay(tasks, today, timezone)
    : [{ key: 'all', label: '', tasks }];
  return (
    <div>
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label || undefined}>
          {group.label && (
            <h2 className="flex items-baseline gap-2 px-3.5 pb-2 pt-5">
              <span className={`text-overline uppercase ${group.key === 'overdue' ? 'text-danger' : 'text-muted'}`}>{group.label}</span>
              <span className="text-meta font-medium tabular-nums text-muted">{group.tasks.length}</span>
            </h2>
          )}
          <ul className="flex flex-col gap-0.5">
            {group.tasks.map((task) => {
              const info = listInfo.get(task.listId);
              return (
                <TaskItem
                  key={task.id} task={task} selected={task.id === selectedId} today={today} now={now} timezone={timezone}
                  variant={variant} isNew={!seen.current.has(task.id)}
                  list={showListName && info ? { name: info.name, color: info.color } : undefined}
                />
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
