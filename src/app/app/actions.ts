'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { createApiToken, revokeApiToken } from '@/core/api-tokens';
import { todayIn } from '@/core/dates';
import { ValidationError } from '@/core/errors';
import { createFolder, createList, deleteFolder, deleteList, renameFolder, updateList, type UpdateListInput } from '@/core/lists';
import { addListMember, getListMembers, leaveList, removeListMember } from '@/core/members';
import { updateNotificationPrefs, type NotificationPrefs } from '@/core/notification-prefs';
import { sendTestNotification } from '@/core/notifications';
import { revokeOAuthConnection } from '@/core/oauth';
import { countPushSubscriptions, deletePushSubscription, savePushSubscription } from '@/core/push-subscriptions';
import { parseQuickAdd } from '@/core/quick-add';
import {
  addSubtask, completeTask, createTask, deleteSubtask, deleteTask, emptyTrash, getTask, moveTask, restoreTask, uncompleteTask,
  updateSubtask, updateTask, type TaskView, type UpdateTaskInput,
} from '@/core/tasks';
import { updateUserTimezone, type PublicUser } from '@/core/users';
import { getDb } from '@/db';
import type { DB } from '@/db/types';
import { runAction, type ActionResult } from '@/lib/action-result';
import { requireUser } from '@/lib/auth';
import { shareLimiter } from '@/lib/limits';
import { assignmentChanged, notifyAssignmentSafely } from '@/lib/notify';
import { getPushSender } from '@/lib/push';
import { createRateLimiter } from '@/lib/rate-limit';

async function act<T>(fn: (db: DB, user: PublicUser) => Promise<T>): Promise<ActionResult<T>> {
  return runAction(async () => {
    const user = await requireUser();
    const result = await fn(await getDb(), user);
    revalidatePath('/app', 'layout');
    return result;
  });
}

export interface QuickAddContext {
  view?: TaskView;
  listId?: string;
  tag?: string;
}

/** Crea una tarea desde el campo rápido, completando con el contexto de la vista actual. */
export async function quickAddAction(text: string, context: QuickAddContext) {
  return act(async (db, user) => {
    const today = todayIn(user.timezone);
    const parsed = parseQuickAdd(String(text), today);
    const defaultDue = context.view === 'today' || context.view === 'next7' ? today : null;
    const tags = context.tag ? [...new Set([...parsed.tags, context.tag])] : parsed.tags;
    const task = await createTask(db, user.id, {
      title: parsed.title,
      listId: context.listId,
      dueDate: parsed.dueDate ?? defaultDue,
      priority: parsed.priority,
      tags,
      createdVia: 'web',
    });
    return { id: task.id };
  });
}

export async function updateTaskAction(taskId: string, input: UpdateTaskInput) {
  // Solo los campos editables: el resto (listId, status, externalId...) no se acepta del cliente.
  return act(async (db, user) => {
    const { title, description, dueDate, dueTime, priority, tags, subtasks, assigneeId, reminder } = input;
    const before = assigneeId !== undefined ? (await getTask(db, user.id, taskId)).assigneeId : null;
    const task = await updateTask(db, user.id, taskId, {
      title, description, dueDate, dueTime, priority, tags, subtasks, assigneeId, reminder,
    });
    if (assigneeId !== undefined && assignmentChanged(before, task.assigneeId, user.id)) {
      // Después de responder: el push no demora la interfaz.
      after(() => notifyAssignmentSafely(db, user.id, task.id));
    }
  });
}

export async function toggleTaskAction(taskId: string, completed: boolean) {
  return act(async (db, user) => {
    if (typeof completed !== 'boolean') throw new ValidationError('El estado de la tarea debe ser verdadero o falso');
    await (completed ? completeTask(db, user.id, taskId) : uncompleteTask(db, user.id, taskId));
  });
}

export async function moveTaskAction(taskId: string, listId: string) {
  return act(async (db, user) => { await moveTask(db, user.id, taskId, listId); });
}

export async function deleteTaskAction(taskId: string) {
  return act((db, user) => deleteTask(db, user.id, taskId));
}

export async function restoreTaskAction(taskId: string) {
  return act(async (db, user) => { await restoreTask(db, user.id, taskId); });
}

/** Vacía la papelera (solo tareas de listas propias). Devuelve cuántas se borraron. */
export async function emptyTrashAction() {
  return act(async (db, user) => emptyTrash(db, user.id));
}

export async function addSubtaskAction(taskId: string, title: string) {
  return act(async (db, user) => { await addSubtask(db, user.id, taskId, title); });
}

export async function updateSubtaskAction(subtaskId: string, input: { title?: string; done?: boolean }) {
  return act(async (db, user) => { await updateSubtask(db, user.id, subtaskId, input); });
}

export async function deleteSubtaskAction(subtaskId: string) {
  return act(async (db, user) => { await deleteSubtask(db, user.id, subtaskId); });
}

export async function createListAction(input: { name: string; color: string | null; folderId: string | null }) {
  return act(async (db, user) => {
    const list = await createList(db, user.id, { name: input.name, color: input.color, folderId: input.folderId });
    return { id: list.id };
  });
}

export async function updateListAction(listId: string, input: UpdateListInput) {
  return act(async (db, user) => {
    const { name, color, folderId, sortOrder } = input;
    await updateList(db, user.id, listId, { name, color, folderId, sortOrder });
  });
}

export async function deleteListAction(listId: string) {
  return act((db, user) => deleteList(db, user.id, listId));
}

/** Solo lectura: no revalida (lo llama el diálogo de lista al abrirse). */
export async function getListMembersAction(listId: string) {
  return runAction(async () => {
    const user = await requireUser();
    return getListMembers(await getDb(), user.id, String(listId));
  });
}

// Frena el sondeo de qué emails tienen cuenta (limitador compartido con la herramienta share_list de MCP).

export async function addListMemberAction(listId: string, email: string) {
  return act(async (db, user) => {
    if (!shareLimiter.check(user.id)) {
      throw new ValidationError('Agregaste demasiados miembros seguidos. Probá más tarde.');
    }
    return addListMember(db, user.id, String(listId), String(email));
  });
}

export async function removeListMemberAction(listId: string, memberId: string) {
  return act((db, user) => removeListMember(db, user.id, String(listId), String(memberId)));
}

export async function leaveListAction(listId: string) {
  return act((db, user) => leaveList(db, user.id, String(listId)));
}

export async function createFolderAction(name: string) {
  return act(async (db, user) => {
    const folder = await createFolder(db, user.id, { name });
    return { id: folder.id };
  });
}

export async function renameFolderAction(folderId: string, name: string) {
  return act(async (db, user) => { await renameFolder(db, user.id, folderId, name); });
}

export async function deleteFolderAction(folderId: string) {
  return act((db, user) => deleteFolder(db, user.id, folderId));
}

export async function updateTimezoneAction(timezone: string) {
  return act(async (db, user) => { await updateUserTimezone(db, user.id, timezone); });
}

// Crear tokens es raro: 10 por hora y usuario alcanza y frena abusos con una sesión robada.
const createTokenLimiter = createRateLimiter({ max: 10, windowMs: 60 * 60 * 1000 });

/** Crea un token personal; el token en claro se devuelve solo esta vez. */
export async function createApiTokenAction(name: string) {
  return act(async (db, user) => {
    if (!createTokenLimiter.check(user.id)) throw new ValidationError('Creaste demasiados tokens seguidos. Probá más tarde.');
    const { token } = await createApiToken(db, user.id, String(name));
    return { token };
  });
}

export async function revokeApiTokenAction(tokenId: string) {
  return act((db, user) => revokeApiToken(db, user.id, String(tokenId)));
}

export async function revokeOAuthConnectionAction(clientId: string) {
  return act((db, user) => revokeOAuthConnection(db, user.id, String(clientId)));
}

// ---------- Notificaciones ----------

const PUSH_OFF = 'Las notificaciones no están configuradas en este servidor (faltan las claves VAPID).';
const subscribeLimiter = createRateLimiter({ max: 20, windowMs: 60 * 60 * 1000 });
const testPushLimiter = createRateLimiter({ max: 5, windowMs: 60 * 1000 });

/** Datos de `PushSubscription.toJSON()` más el user agent. Se validan en el núcleo. */
export interface PushSubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}

/** Guarda la suscripción de este dispositivo. Devuelve en cuántos dispositivos quedan activadas. */
export async function savePushSubscriptionAction(input: PushSubscriptionPayload) {
  return act(async (db, user) => {
    if (!getPushSender()) throw new ValidationError(PUSH_OFF);
    if (!subscribeLimiter.check(user.id)) throw new ValidationError('Demasiados intentos seguidos. Probá más tarde.');
    await savePushSubscription(db, user.id, input);
    return { devices: await countPushSubscriptions(db, user.id) };
  });
}

export async function deletePushSubscriptionAction(endpoint: string) {
  return act(async (db, user) => {
    await deletePushSubscription(db, user.id, endpoint);
    return { devices: await countPushSubscriptions(db, user.id) };
  });
}

export async function sendTestNotificationAction() {
  return act(async (db, user) => {
    const send = getPushSender();
    if (!send) throw new ValidationError(PUSH_OFF);
    if (!testPushLimiter.check(user.id)) throw new ValidationError('Esperá un momento antes de mandar otra prueba.');
    const report = await sendTestNotification(db, user.id, send, new Date());
    if (report.sent === 0) {
      throw new ValidationError('No llegó a ningún dispositivo. Desactivá y volvé a activar las notificaciones en este dispositivo.');
    }
    return { sent: report.sent };
  });
}

export async function updateNotificationPrefsAction(input: Partial<NotificationPrefs>) {
  return act((db, user) => updateNotificationPrefs(db, user.id, input));
}
