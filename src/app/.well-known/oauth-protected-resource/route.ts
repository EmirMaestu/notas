import { json, preflight } from '@/lib/oauth-http';
import { protectedResourceMetadata } from '@/lib/oauth-metadata';

// APP_URL se lee en cada request (no en el build).
export const dynamic = 'force-dynamic';

// Respaldo para los clientes MCP que consultan la raíz (/.well-known/oauth-protected-resource) en vez de la
// ruta con sufijo del recurso (/.well-known/oauth-protected-resource/mcp). El recurso siempre es APP_URL/mcp.
export function GET(): Response {
  return json(protectedResourceMetadata());
}

export function OPTIONS(): Response {
  return preflight();
}
