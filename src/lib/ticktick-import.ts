import { eq } from 'drizzle-orm';
import { createFolder, createList, getFolderByExternalId, getInbox, getListByExternalId } from '@/core/lists';
import { createTag } from '@/core/tags';
import { createTask, getTaskByExternalId } from '@/core/tasks';
import { users } from '@/db/schema';
import type { DB } from '@/db/types';

/**
 * Exportación normalizada de TickTick (la arma quien lee TickTick, p. ej. con su MCP).
 * Los ids son los de TickTick y quedan como `external_id`, así que importar dos veces no duplica nada.
 */
export interface TickTickExport {
  folders: { id: string; name: string }[];
  lists: { id: string; name: string; color: string | null; folderId: string | null }[];
  tags: { name: string; color: string | null }[];
  tasks: TickTickExportTask[];
}

export interface TickTickExportTask {
  id: string;
  /** null = Bandeja. */
  listId: string | null;
  title: string;
  content: string;
  /** YYYY-MM-DD en la zona del usuario. */
  dueDate: string | null;
  /** HH:mm, solo si la tarea tenía hora. */
  dueTime: string | null;
  priority: number;
  tags: string[];
  status: 'pending' | 'completed';
  /** ISO 8601. */
  completedAt: string | null;
  subtasks: { title: string; done: boolean }[];
}

interface Counter {
  created: number;
  existing: number;
}

export interface ImportSummary {
  folders: Counter;
  lists: Counter;
  tags: number;
  tasks: Counter;
  /** Por nombre de lista en Notas: tareas de la exportación. */
  perList: Record<string, { pending: number; completed: number }>;
}

export async function importTickTick(db: DB, email: string, data: TickTickExport): Promise<ImportSummary> {
  const user = await db.query.users.findFirst({ where: eq(users.email, email.trim().toLowerCase()) });
  if (!user) throw new Error(`No hay ningún usuario con el email ${email}`);

  const summary: ImportSummary = {
    folders: { created: 0, existing: 0 },
    lists: { created: 0, existing: 0 },
    tags: 0,
    tasks: { created: 0, existing: 0 },
    perList: {},
  };

  const folderIds = new Map<string, string>();
  for (const folder of data.folders) {
    const existing = await getFolderByExternalId(db, user.id, folder.id);
    if (existing) {
      summary.folders.existing += 1;
      folderIds.set(folder.id, existing.id);
    } else {
      const created = await createFolder(db, user.id, { name: folder.name, externalId: folder.id });
      summary.folders.created += 1;
      folderIds.set(folder.id, created.id);
    }
  }

  const inbox = await getInbox(db, user.id);
  const lists = new Map<string, { id: string; name: string }>();
  for (const list of data.lists) {
    const existing = await getListByExternalId(db, user.id, list.id);
    if (existing) {
      summary.lists.existing += 1;
      lists.set(list.id, { id: existing.id, name: existing.name });
      continue;
    }
    const folderId = list.folderId ? folderIds.get(list.folderId) : null;
    if (list.folderId && !folderId) throw new Error(`La lista "${list.name}" apunta a una carpeta desconocida`);
    const created = await createList(db, user.id, {
      name: list.name,
      color: list.color,
      folderId: folderId ?? null,
      externalId: list.id,
    });
    summary.lists.created += 1;
    lists.set(list.id, { id: created.id, name: created.name });
  }

  for (const tag of data.tags) {
    await createTag(db, user.id, { name: tag.name, color: tag.color });
    summary.tags += 1;
  }

  for (const task of data.tasks) {
    const target = task.listId === null ? { id: inbox.id, name: inbox.name } : lists.get(task.listId);
    if (!target) throw new Error(`La tarea "${task.title}" apunta a una lista desconocida (${task.listId})`);

    const counts = (summary.perList[target.name] ??= { pending: 0, completed: 0 });
    counts[task.status] += 1;

    if (await getTaskByExternalId(db, user.id, task.id)) {
      summary.tasks.existing += 1;
      continue;
    }
    await createTask(db, user.id, {
      title: task.title,
      description: task.content,
      listId: target.id,
      dueDate: task.dueDate,
      dueTime: task.dueTime,
      priority: task.priority,
      tags: task.tags,
      subtasks: task.subtasks,
      status: task.status,
      completedAt: task.completedAt ? new Date(task.completedAt) : null,
      externalId: task.id,
    });
    summary.tasks.created += 1;
  }

  return summary;
}
