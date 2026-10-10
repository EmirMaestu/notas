import { notFound } from 'next/navigation';
import type { TaskView } from '@/core/tasks';
import { TaskPage } from '@/components/task-page';

const VIEWS: Record<TaskView, string> = {
  inbox: 'Bandeja', today: 'Hoy', next7: 'Próximos 7 días', assigned: 'Asignadas a mí',
  completed: 'Completadas', trash: 'Papelera',
};

export default async function ViewPage({
  params, searchParams,
}: { params: Promise<{ view: string }>; searchParams: Promise<{ t?: string }> }) {
  const { view } = await params;
  const { t } = await searchParams;
  if (!Object.hasOwn(VIEWS, view)) notFound();
  const v = view as TaskView;
  return <TaskPage title={VIEWS[v]} filter={{ view: v }} context={{ view: v }} selectedTaskId={t} />;
}
