import { createRateLimiter } from '@/lib/rate-limit';

/**
 * Altas de miembros en listas por usuario: 20 por hora. Frena el sondeo de qué emails tienen cuenta.
 * Un único limitador para la web (addListMemberAction) y para MCP (share_list), así no se suman cupos.
 */
export const shareLimiter = createRateLimiter({ max: 20, windowMs: 60 * 60 * 1000 });
