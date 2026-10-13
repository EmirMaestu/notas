import { createRateLimiter } from '@/lib/rate-limit';

/**
 * Altas de miembros en listas por usuario: 20 por hora. Frena el sondeo de qué emails tienen cuenta.
 * Un único limitador para la web (addListMemberAction) y para MCP (share_list), así no se suman cupos.
 */
export const shareLimiter = createRateLimiter({ max: 20, windowMs: 60 * 60 * 1000 });

/**
 * Avisos de asignación por pareja (quien asigna, a quién): 10 por hora. Frena el spam de notificaciones a una
 * persona. Un único limitador para la web (updateTaskAction) y para MCP (create_task / update_task).
 */
export const assignmentNotifyLimiter = createRateLimiter({ max: 10, windowMs: 60 * 60 * 1000 });
