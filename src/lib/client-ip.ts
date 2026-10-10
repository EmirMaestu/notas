/**
 * IP del cliente a partir de X-Forwarded-For. Cada proxy de confianza AGREGA al final la IP de quien le
 * habló, así que se toma la entrada que está `hops` posiciones desde la derecha (lo de la izquierda lo
 * controla el cliente y no sirve).
 */
export function clientIpFrom(xff: string | null, hops: number): string {
  if (hops <= 0 || !xff) return 'local';
  const entries = xff.split(',').map((e) => e.trim()).filter(Boolean);
  if (entries.length === 0) return 'local';
  return entries[Math.max(entries.length - hops, 0)];
}

/**
 * Clave para limitar frecuencia: una IPv4 se usa tal cual; una IPv6 se reduce a su prefijo /64 (un
 * atacante o un hogar suele controlar un /64 entero, así que rotar dentro de él no debe evadir el límite).
 * Lo que no parece IP (p. ej. 'local') queda igual.
 */
export function rateLimitKey(ip: string): string {
  let addr = ip.trim().toLowerCase();
  const zone = addr.indexOf('%');
  if (zone !== -1) addr = addr.slice(0, zone);
  if (addr.startsWith('[') && addr.endsWith(']')) addr = addr.slice(1, -1);
  if (!addr.includes(':')) return ip;
  // IPv4 mapeada (::ffff:1.2.3.4): es la IPv4.
  const mapped = /^(?:0{0,4}:){0,5}ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (mapped) return mapped[1];
  const groups = expandIpv6(addr);
  if (!groups) return ip;
  return `${groups.slice(0, 4).join(':')}::/64`;
}

/** Expande una IPv6 a 8 grupos hexadecimales de 4 dígitos, o null si no es válida. */
function expandIpv6(addr: string): string[] | null {
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === '' ? [] : part.split(':'));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.padStart(4, '0'));
}

/** Lee TRUSTED_PROXY_HOPS: entero >= 0; por defecto 1 (un proxy: Caddy). */
export function trustedProxyHops(raw: string | undefined = process.env.TRUSTED_PROXY_HOPS): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return 1;
  return Number.parseInt(raw.trim(), 10);
}
