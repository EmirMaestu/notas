import { dayOfWeek } from '@/core/dates';
import type { ListWithRole } from '@/core/lists';
import type { ListMember } from '@/core/members';
import type { Tag } from '@/core/tags';
import type { TaskWithDetails } from '@/core/tasks';

// Salida compacta para la IA: ids, datos útiles y nada interno (user_id, external_id, ids de personas).

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Instante en la zona horaria del usuario como `YYYY-MM-DD HH:mm` (hora local, sin offset ni "Z"). */
export function formatLocalTimestamp(date: Date | null, timezone: string): string | null {
  if (!date) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

export const DESCRIPTION_PREVIEW_CHARS = 200;

export function weekdayName(isoDate: string): string {
  return WEEKDAYS[dayOfWeek(isoDate)];
}

export function formatList(list: ListWithRole) {
  return {
    id: list.id,
    name: list.name,
    color: list.color,
    is_inbox: list.isInbox,
    role: list.role,
    shared: list.shared,
  };
}

export interface FormatTaskOptions {
  /** Zona horaria del usuario, para completed_at / deleted_at. */
  timezone: string;
  /** Recorta la descripción a 200 caracteres (listados); get_task y las mutaciones la devuelven completa. */
  truncateDescription?: boolean;
}

/** `listNames`: id → nombre de las listas a las que accede el usuario. */
export function formatTask(task: TaskWithDetails, listNames: ReadonlyMap<string, string>, opts: FormatTaskOptions) {
  const long = opts.truncateDescription === true && task.description.length > DESCRIPTION_PREVIEW_CHARS;
  return {
    id: task.id,
    title: task.title,
    description: long ? `${task.description.slice(0, DESCRIPTION_PREVIEW_CHARS)}…` : task.description,
    ...(long ? { description_truncated: true } : {}),
    list_id: task.listId,
    list_name: listNames.get(task.listId) ?? null,
    due_date: task.dueDate,
    due_time: task.dueTime,
    priority: task.priority,
    status: task.status,
    completed_at: formatLocalTimestamp(task.completedAt, opts.timezone),
    deleted_at: formatLocalTimestamp(task.deletedAt, opts.timezone),
    tags: task.tags,
    other_tags: task.otherTags,
    assignee: task.assignee?.email ?? null,
    subtasks: task.subtasks.map((s) => ({ id: s.id, title: s.title, done: s.done })),
  };
}

export function formatTag(tag: Tag) {
  return { name: tag.name, color: tag.color };
}

export function formatMember(member: ListMember) {
  return { email: member.email, name: member.name, role: member.role };
}
