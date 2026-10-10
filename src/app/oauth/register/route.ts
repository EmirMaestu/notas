import { OAUTH_SCOPE, OAuthError, registerClient } from '@/core/oauth';
import { getDb } from '@/db';
import { json, oauthError, oauthErrorResponse, preflight, readBody, requestIp, tooManyRequests } from '@/lib/oauth-http';
import { createRateLimiter } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// El registro no tiene autenticación (RFC 7591): se limita por IP. Cada conexión nueva de Claude registra un cliente.
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const registerLimiter = createRateLimiter({ max: 20, windowMs: REGISTER_WINDOW_MS });

export function OPTIONS(): Response {
  return preflight();
}

export async function POST(request: Request): Promise<Response> {
  if (!registerLimiter.check(requestIp(request))) {
    return tooManyRequests('Demasiados registros desde esta IP: probá más tarde', REGISTER_WINDOW_MS / 1000);
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return oauthError('invalid_client_metadata', 'Content-Type debe ser application/json');
  }
  const text = await readBody(request);
  if (text === null) return oauthError('invalid_client_metadata', 'El cuerpo es demasiado grande', 413);
  let metadata: unknown;
  try {
    metadata = JSON.parse(text);
  } catch {
    return oauthError('invalid_client_metadata', 'El cuerpo debe ser JSON');
  }
  try {
    const client = await registerClient(await getDb(), metadata);
    return json({
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: OAUTH_SCOPE,
    }, 201);
  } catch (err) {
    if (err instanceof OAuthError) return oauthErrorResponse(err);
    console.error('[oauth/register] error inesperado', err);
    return oauthError('server_error', 'Error interno', 500);
  }
}
