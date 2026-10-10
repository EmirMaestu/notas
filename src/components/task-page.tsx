import { todayIn } from '@/core/dates';
import { NotFoundError } from '@/core/errors';
import { getListMembers, type ListMember } from '@/core/members';
import { getTask, listTasks, type ListTasksFilter, type TaskWithDetails } from '@/core/tasks';
import { getDb } from '@/db';
import type { QuickAddContext } from '@/app/app/actions';
import { requireUser } from '@/lib/auth';
import { getLists } from '@/lib/data';
import { TaskWorkspace } from './task-workspace';

export async function TaskPage({
  title, filter, context, selectedTaskId,
}: { title: string; filter: ListTasksFilter; context: QuickAddContext; selectedTaskId?: string }) {
  const user = await requireUser();
  const db = await getDb();
  const [tasks, lists] = await Promise.all([listTasks(db, user.id, filter), getLists(user.id)]);
  let selected: TaskWithDetails | null = null;
  if (selectedTaskId) {
    selected = await getTask(db, user.id, selectedTaskId, { includeDeleted: filter.view === 'trash' }).catch((err) => {
      if (err instanceof NotFoundError) return null;
      throw err;
    });
  }
  // El selector "Asignada a" solo tiene sentido si la lista de la tarea está compartida.
  const selectedList = selected ? lists.find((l) => l.id === selected.listId) : undefined;
  // También se cargan si quedó una asignación en una lista ya no compartida, para poder limpiarla con "Sin asignar".
  // En la papelera el detalle es de solo lectura: no hace falta.
  const needsMembers = selected && !selected.deletedAt && (selectedList?.shared || selected.assigneeId);
  const members: ListMember[] = selected && needsMembers ? await getListMembers(db, user.id, selected.listId) : [];
  return (
    <TaskWorkspace
      title={title} tasks={tasks} selected={selected} lists={lists} members={members} context={context}
      today={todayIn(user.timezone)} currentUserId={user.id}
    />
  );
}
