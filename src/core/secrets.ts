import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Secreto aleatorio en base64url con un prefijo legible que indica su tipo (p. ej. "ntk_…"). */
export function generateSecret(prefix: string, bytes = 32): string {
  return `${prefix}${randomBytes(bytes).toString('base64url')}`;
}

/** Hash con el que se guardan los secretos en la base: nunca se guardan en claro. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** SHA-256 en base64url sin relleno (PKCE S256, RFC 7636). */
export function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

/** Comparación en tiempo constante; se comparan hashes para no filtrar el largo. */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
