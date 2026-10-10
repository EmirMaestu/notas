'use client';

import type { List } from '@/core/lists';
import type { ListMember } from '@/core/members';
import type { TaskWithDetails } from '@/core/tasks';
import type { QuickAddContext } from '@/app/app/actions';
import { QuickAdd } from './quick-add';
import { TaskDetail } from './task-detail';
import { TaskList } from './task-list';

export function TaskWorkspace({
  title, tasks, selected, lists, members, context, today, currentUserId,
}: {
  title: string; tasks: TaskWithDetails[]; selected: TaskWithDetails | null;
  lists: List[]; members: ListMember[]; context: QuickAddContext; today: string; currentUserId: string;
}) {
  const inTrash = context.view === 'trash';
  // En "Asignadas a mí" una tarea nueva no quedaría asignada y no se vería: no se ofrece agregar.
  const canAdd = context.view !== 'completed' && context.view !== 'assigned' && !inTrash;
  return (
    <div className="flex h-full">
      <section className={`min-w-0 flex-1 flex-col ${selected ? 'hidden lg:flex' : 'flex'}`}>
        <h1 className="px-4 pb-3 pt-5 text-xl font-semibold md:px-6">{title}</h1>
        {canAdd && <QuickAdd context={context} today={today} />}
        <TaskList
          tasks={tasks} selectedId={selected?.id} today={today} lists={lists} inTrash={inTrash}
          grouped={context.view === 'today' || context.view === 'next7'}
          showListName={!context.listId}
        />
      </section>
      {selected && (
        <aside className="w-full border-line lg:w-[420px] lg:shrink-0 lg:border-l">
          <TaskDetail key={selected.id} task={selected} lists={lists} members={members} currentUserId={currentUserId} />
        </aside>
      )}
    </div>
  );
}
