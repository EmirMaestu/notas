'use client';

import { useEffect, useRef, useState } from 'react';
import type { Folder, ListWithRole } from '@/core/lists';
import type { TaskWithDetails } from '@/core/tasks';
import { listDisplayName } from '@/lib/list-groups';
import { createdViaClient, groupTasksByCompletedDay, groupTasksByDate, type TaskGroup } from '@/lib/format';
import { TaskItem, type TaskItemVariant } from './task-item';
import { useToast } from './toast';
import { useWorkspace } from './workspace-context';

export type TaskGrouping = 'date' | 'completed' | 'none';

export function TaskList({
  tasks, selectedId, grouping, today, now, timezone, lists, folders, showListName, variant, empty,
}: {
  tasks: TaskWithDetails[]; selectedId?: string; grouping: TaskGrouping; today: string; now: string; timezone: string;
  lists: ListWithRole[]; folders: Folder[]; showListName: boolean; variant: TaskItemVariant; empty: React.ReactNode;
}) {
  // Ids ya vistos: las tareas que aparecen después (otra pestaña, la IA, «Deshacer») entran con fundido.
  const [initial] = useState(() => new Set(tasks.map((t) => t.id)));
  const seen = useRef(initial);
  const toast = useToast();
  const { openTask } = useWorkspace();
  useEffect(() => {
    const fresh = tasks.filter((t) => !seen.current.has(t.id));
    for (const t of tasks) seen.current.add(t.id);
    // Una IA acaba de crear algo y la pestaña está a la vista: se avisa (lo restaurado o viejo no cuenta).
    const byAi = fresh.filter(
      (t) => createdViaClient(t.createdVia) && Date.now() - new Date(t.createdAt).getTime() < 2 * 60_000,
    );
    if (byAi.length === 0 || document.visibilityState !== 'visible') return;
    const first = byAi[0];
    const client = createdViaClient(first.createdVia)!;
    toast(byAi.length === 1
      ? { tone: 'ai', message: `${client} creó «${first.title}»`, action: { label: 'Ver', onClick: () => openTask(first.id) } }
      : { tone: 'ai', message: `${client} creó ${byAi.length} tareas` });
  }, [tasks, toast, openTask]);

  if (tasks.length === 0) return <>{empty}</>;
  const listInfo = new Map(lists.map((l) => [l.id, l]));
  const foldersById = new Map(folders.map((f) => [f.id, f]));
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
                  list={showListName && info ? { name: listDisplayName(info, foldersById), color: info.color } : undefined}
                />
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
