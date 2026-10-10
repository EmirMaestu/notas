import type { OAuthError } from '@/core/oauth';
import { clientIpFrom, rateLimitKey, trustedProxyHops } from './client-ip';

/** CORS de los endpoints OAuth públicos: cualquier origen y sin credenciales (no se usan cookies). */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};

const NO_STORE: Record<string, string> = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
const MAX_BODY_BYTES = 10_000;

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** JSON con CORS y sin caché (las respuestas de token nunca deben cachearse, RFC 6749 §5.1). */
export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { ...CORS_HEADERS, ...NO_STORE } });
}

export function oauthError(error: string, description: string, status = 400): Response {
  return json({ error, error_description: description }, status);
}

export function oauthErrorResponse(err: OAuthError): Response {
  return oauthError(err.code, err.message, err.code === 'invalid_client' ? 401 : 400);
}

/** 429 con `Retry-After` (segundos) y un error OAuth con descripción. */
export function tooManyRequests(description: string, retryAfterSeconds: number): Response {
  return Response.json(
    { error: 'invalid_request', error_description: description },
    { status: 429, headers: { ...CORS_HEADERS, ...NO_STORE, 'Retry-After': String(Math.ceil(retryAfterSeconds)) } },
  );
}

/** Clave de límite de frecuencia del cliente detrás de los proxies de confianza (IPv6 agrupada por /64). */
export function requestIp(request: Request): string {
  return rateLimitKey(clientIpFrom(request.headers.get('x-forwarded-for'), trustedProxyHops()));
}

/**
 * Cuerpo como texto, o null si supera los 10 KB (los cuerpos OAuth legítimos son chicos). Se lee como stream y
 * se aborta al pasar el límite: ni Content-Length (puede mentir o faltar con chunked) ni el tamaño final se creen.
 */
export async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** Formulario application/x-www-form-urlencoded (así llegan /token y /revoke), o null si el tipo o el tamaño no corresponden. */
export async function readForm(request: Request): Promise<URLSearchParams | null> {
  const type = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!type.startsWith('application/x-www-form-urlencoded')) return null;
  const text = await readBody(request);
  return text === null ? null : new URLSearchParams(text);
}

/** Valor de un parámetro; repetido o vacío cuenta como ausente (RFC 6749 §3.1). */
export function formParam(form: URLSearchParams, name: string): string | undefined {
  const values = form.getAll(name);
  return values.length === 1 && values[0] !== '' ? values[0] : undefined;
}
