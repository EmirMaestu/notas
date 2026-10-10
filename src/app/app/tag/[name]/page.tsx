import { notFound } from 'next/navigation';
import { ValidationError } from '@/core/errors';
import { normalizeTagName } from '@/core/tags';
import { TaskPage } from '@/components/task-page';

/** En Next 15 los params dinámicos llegan sin decodificar (p. ej. `a%25b`), así que se decodifican una vez. */
function decodeParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default async function TagPage({
  params, searchParams,
}: { params: Promise<{ name: string }>; searchParams: Promise<{ t?: string }> }) {
  const name = decodeParam((await params).name);
  try {
    normalizeTagName(name);
  } catch (err) {
    if (err instanceof ValidationError) notFound();
    throw err;
  }
  const { t } = await searchParams;
  return <TaskPage title={`#${name}`} filter={{ tag: name }} context={{ tag: name }} selectedTaskId={t} />;
}
