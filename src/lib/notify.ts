import { notifyAssignment } from '@/core/notifications';
import type { SendPush } from '@/core/push-subscriptions';
import type { DB } from '@/db/types';
import { assignmentNotifyLimiter } from './limits';
import { getPushSender } from './push';

/** ¿Hay que avisar? La tarea quedó asignada a alguien distinto de antes y que no es quien la asignó. */
export function assignmentChanged(before: string | null, after: string | null, actorId: string): boolean {
  return after !== null && after !== before && after !== actorId;
}

/**
 * Aviso de asignación para la web y el MCP. Un fallo del push (o de la base) no debe romper la acción que asignó:
 * solo se loguea. `send` null = notificaciones apagadas.
 */
export async function notifyAssignmentSafely(
  db: DB, actorId: string, taskId: string, send: SendPush | null = getPushSender(), now: Date = new Date(),
): Promise<void> {
  if (!send) return;
  try {
    await notifyAssignment(db, { actorId, taskId }, send, now, (actor, assignee) => assignmentNotifyLimiter.check(`${actor}:${assignee}`));
  } catch (err) {
    console.error('[notificaciones] falló el aviso de asignación:', err);
  }
}
