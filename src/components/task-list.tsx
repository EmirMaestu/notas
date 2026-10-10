'use client';

import type { List } from '@/core/lists';
import type { TaskWithDetails } from '@/core/tasks';
import { groupTasksByDate } from '@/lib/format';
import { TaskItem } from './task-item';

export function TaskList({
  tasks, selectedId, grouped, today, lists, showListName, inTrash,
}: {
  tasks: TaskWithDetails[]; selectedId?: string; grouped: boolean; today: string;
  lists: List[]; showListName: boolean; inTrash: boolean;
}) {
  if (tasks.length === 0) {
    return <p className="px-6 py-16 text-center text-sm text-muted">No hay tareas acá.</p>;
  }
  const listNames = new Map(lists.map((l) => [l.id, l.name]));
  const groups = grouped ? groupTasksByDate(tasks, today) : [{ key: 'all', label: '', tasks }];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-16 md:px-4">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label || undefined}>
          {group.label && (
            <h2 className={`px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide ${group.key === 'overdue' ? 'text-danger' : 'text-muted'}`}>
              {group.label} <span className="font-normal">{group.tasks.length}</span>
            </h2>
          )}
          <ul>
            {group.tasks.map((task) => (
              <TaskItem
                key={task.id} task={task} selected={task.id === selectedId} today={today} inTrash={inTrash}
                listName={showListName ? listNames.get(task.listId) : undefined}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
