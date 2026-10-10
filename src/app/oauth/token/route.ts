import { OAuthError, exchangeAuthorizationCode, formValue, refreshAccessToken } from '@/core/oauth';
import { getDb } from '@/db';
import { mcpResourceUrl } from '@/lib/app-url';
import {
  formParam, json, oauthError, oauthErrorResponse, preflight, readForm, requestIp, tooManyRequests,
} from '@/lib/oauth-http';
import { createRateLimiter } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const tokenLimiter = createRateLimiter({ max: 60, windowMs: 60 * 1000 });

export function OPTIONS(): Response {
  return preflight();
}

export async function POST(request: Request): Promise<Response> {
  if (!tokenLimiter.check(requestIp(request))) {
    return tooManyRequests('Demasiadas solicitudes: probá en un minuto', 60);
  }
  const form = await readForm(request);
  if (!form) return oauthError('invalid_request', 'El cuerpo debe ser application/x-www-form-urlencoded (máx. 10 KB)');
  const opts = { resource: mcpResourceUrl() };
  try {
    const grantType = formParam(form, 'grant_type');
    // Ausente, vacío o repetido es una solicitud mal formada; "unsupported" es solo para valores desconocidos.
    if (grantType === undefined) return oauthError('invalid_request', 'grant_type es obligatorio y no puede repetirse');
    if (grantType === 'authorization_code') {
      return json(await exchangeAuthorizationCode(await getDb(), {
        code: formValue(form, 'code'),
        clientId: formValue(form, 'client_id'),
        redirectUri: formValue(form, 'redirect_uri'),
        codeVerifier: formValue(form, 'code_verifier'),
        resource: formValue(form, 'resource'),
      }, opts));
    }
    if (grantType === 'refresh_token') {
      return json(await refreshAccessToken(await getDb(), {
        refreshToken: formValue(form, 'refresh_token'),
        clientId: formValue(form, 'client_id'),
        resource: formValue(form, 'resource'),
      }, opts));
    }
    return oauthError('unsupported_grant_type', 'grant_type debe ser authorization_code o refresh_token');
  } catch (err) {
    if (err instanceof OAuthError) return oauthErrorResponse(err);
    // Los secretos se hashean antes de tocar la base: el error nunca incluye un token en claro.
    console.error('[oauth/token] error inesperado', err);
    return oauthError('server_error', 'Error interno', 500);
  }
}
