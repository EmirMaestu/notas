/**
 * URL pública de la app (p. ej. https://notas.example.com): es el issuer de OAuth y la base del recurso MCP.
 * Se lee en cada llamada (nunca en el build) para que la imagen de producción tome la variable del entorno.
 */
export function appUrl(): string {
  const raw = process.env.APP_URL?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('APP_URL no está configurada (p. ej. https://notas.example.com)');
    }
    return 'http://localhost:3000';
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`APP_URL inválida: ${raw}`);
  }
  const hasPath = url.pathname.replace(/\/+$/, '') !== '';
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || hasPath || url.search || url.hash) {
    throw new Error(`APP_URL inválida: ${raw} (usá solo esquema y host, sin ruta)`);
  }
  return url.origin;
}

/** Identificador canónico del recurso MCP (RFC 8707 / RFC 9728). */
export function mcpResourceUrl(): string {
  return `${appUrl()}/mcp`;
}

/** URL de la metadata del recurso que se anuncia en el `WWW-Authenticate` del 401. */
export function protectedResourceMetadataUrl(): string {
  return `${appUrl()}/.well-known/oauth-protected-resource/mcp`;
}
