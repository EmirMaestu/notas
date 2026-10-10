import { createMcpHandler } from '@modelcontextprotocol/server';
import { authenticateBearer, describeBearerClient } from '@/core/bearer';
import { OAUTH_SCOPE } from '@/core/oauth';
import { getDb } from '@/db';
import { appUrl, mcpResourceUrl, protectedResourceMetadataUrl } from '@/lib/app-url';
import { requestIp } from '@/lib/oauth-http';
import { createRateLimiter } from '@/lib/rate-limit';
import { createNotasMcpServer } from '@/mcp/server';

export const dynamic = 'force-dynamic';

/**
 * Sin estado: el SDK arma un McpServer nuevo por request con la factory (atado al usuario autenticado).
 * Atiende la era 2026-07-28 y, como fallback sin estado, la 2025 (initialize; GET/DELETE → 405).
 */
const mcpHandler = createMcpHandler(async ({ authInfo }) => {
  const userId = authInfo?.extra?.userId;
  if (typeof userId !== 'string') throw new Error('Solicitud MCP sin usuario autenticado');
  const client = authInfo?.extra?.client;
  return createNotasMcpServer(await getDb(), userId, typeof client === 'string' ? client : undefined);
}, {
  onerror: (err) => console.error('[mcp]', err.message),
  // El servidor nunca emite list_changed: no hay nada que escuchar. 0 hace que el SDK rechace todo
  // subscriptions/listen con un error JSON-RPC, en vez de dejar streams SSE abiertos sin sentido.
  maxSubscriptions: 0,
  maxRequestBodySize: 256 * 1024,
});

const perUserLimiter = createRateLimiter({ max: 120, windowMs: 60 * 1000 });
/** Por IP, solo para pedidos que fallan la autenticación (frena el sondeo de tokens). */
const failedAuthLimiter = createRateLimiter({ max: 60, windowMs: 60 * 1000 });

/**
 * 401 con el puntero a la metadata del recurso (RFC 9728 §5.1). Sin credenciales no se manda `error`
 * (RFC 6750 §3.1); con un token inválido, `invalid_token`. Los valores del header son ASCII.
 */
function unauthorized(request: Request, invalidToken: boolean): Response {
  if (!failedAuthLimiter.check(requestIp(request))) {
    return Response.json(
      { error: 'Demasiadas solicitudes: probá en un minuto' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }
  const params = [`resource_metadata="${protectedResourceMetadataUrl()}"`, `scope="${OAUTH_SCOPE}"`];
  if (invalidToken) params.push('error="invalid_token"', 'error_description="The access token is invalid or expired"');
  return Response.json(
    invalidToken
      ? { error: 'invalid_token', error_description: 'El token no es válido o venció' }
      : { error: 'unauthorized', error_description: 'Falta un token Bearer' },
    { status: 401, headers: { 'WWW-Authenticate': `Bearer ${params.join(', ')}` } },
  );
}

function bearerToken(header: string | null): string | null {
  const match = header?.match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}

async function handle(request: Request): Promise<Response> {
  // La spec pide validar Origin (DNS rebinding). Claude/ChatGPT llaman desde sus servidores, sin Origin.
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== new URL(appUrl()).origin) {
    return Response.json({ error: 'Origen no permitido' }, { status: 403 });
  }
  const token = bearerToken(request.headers.get('authorization'));
  if (!token) return unauthorized(request, false);
  const db = await getDb();
  const auth = await authenticateBearer(db, token, { resource: mcpResourceUrl() });
  if (!auth) return unauthorized(request, true);
  if (!perUserLimiter.check(auth.userId)) {
    return Response.json(
      { error: 'Demasiadas solicitudes: probá en un minuto' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }
  return mcpHandler.fetch(request, {
    // El SDK no necesita el token: nunca lo pasamos para que no pueda terminar en un log.
    authInfo: {
      token: 'redacted',
      clientId: auth.via === 'oauth' ? auth.clientId : 'personal',
      scopes: [OAUTH_SCOPE],
      extra: { userId: auth.userId, client: await describeBearerClient(db, auth) },
    },
  });
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
