import { OAuthError, formValue, revokeToken } from '@/core/oauth';
import { getDb } from '@/db';
import {
  CORS_HEADERS, oauthError, oauthErrorResponse, preflight, readForm, requestIp, tooManyRequests,
} from '@/lib/oauth-http';
import { createRateLimiter } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const revokeLimiter = createRateLimiter({ max: 60, windowMs: 60 * 1000 });

export function OPTIONS(): Response {
  return preflight();
}

/** RFC 7009: responde 200 aunque el token no exista (no revela si era válido). */
export async function POST(request: Request): Promise<Response> {
  if (!revokeLimiter.check(requestIp(request))) {
    return tooManyRequests('Demasiadas solicitudes: probá en un minuto', 60);
  }
  const form = await readForm(request);
  if (!form) return oauthError('invalid_request', 'El cuerpo debe ser application/x-www-form-urlencoded (máx. 10 KB)');
  try {
    await revokeToken(await getDb(), { token: formValue(form, 'token'), clientId: formValue(form, 'client_id') });
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    if (err instanceof OAuthError) return oauthErrorResponse(err);
    console.error('[oauth/revoke] error inesperado', err);
    return oauthError('server_error', 'Error interno', 500);
  }
}
