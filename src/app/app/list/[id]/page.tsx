import { notFound } from 'next/navigation';
import { getList } from '@/core/lists';
import { getDb } from '@/db';
import { TaskPage } from '@/components/task-page';
import { requireUser } from '@/lib/auth';

export default async function ListPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const { id } = await params;
  const { t } = await searchParams;
  const user = await requireUser();
  const list = await getList(await getDb(), user.id, id).catch(() => null);
  if (!list) notFound();
  return <TaskPage title={list.name} filter={{ listId: list.id }} context={{ listId: list.id }} selectedTaskId={t} />;
}
