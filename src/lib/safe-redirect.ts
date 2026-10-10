export const DEFAULT_AFTER_LOGIN = '/app/today';

const INTERNAL_ORIGIN = 'http://internal.invalid';

/**
 * Devuelve la ruta solo si es interna. Rechaza caracteres de control (los navegadores
 * ignoran tabs y saltos de línea, así que "/\t/evil.com" terminaría siendo "//evil.com")
 * y barras invertidas, y verifica que al resolverla siga en nuestro origen.
 */
export function safeRedirect(value: unknown, fallback: string = DEFAULT_AFTER_LOGIN): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return fallback;
  if (/[\x00-\x1f\x7f]/.test(value) || value.includes('\\')) return fallback;
  let url: URL;
  try {
    url = new URL(value, INTERNAL_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== INTERNAL_ORIGIN) return fallback;
  // Resolver "." y ".." puede dejar "//evil.com" (p. ej. "/.//evil.com"), que el navegador
  // interpretaría como otro host.
  const path = url.pathname + url.search + url.hash;
  return path.startsWith('//') ? fallback : path;
}
