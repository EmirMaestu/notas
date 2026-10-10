/** Limitador de ventana fija en memoria. Suficiente para una sola instancia del servidor. */
export function createRateLimiter(
  { max, windowMs, maxEntries = 10_000 }: { max: number; windowMs: number; maxEntries?: number },
) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  // Evita crecimiento sin límite: primero descarta las vencidas y, si aún sobran, las más viejas.
  function prune(now: number): void {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
    for (const key of hits.keys()) {
      if (hits.size <= maxEntries) break;
      hits.delete(key);
    }
  }

  return {
    /** Registra un intento; devuelve false si se superó el límite. */
    check(key: string, now: number = Date.now()): boolean {
      if (hits.size > maxEntries) prune(now);
      const entry = hits.get(key);
      if (!entry || now >= entry.resetAt) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      entry.count += 1;
      return entry.count <= max;
    },
    reset(key: string): void {
      hits.delete(key);
    },
    /** Cantidad de claves en memoria (para tests). */
    size(): number {
      return hits.size;
    },
  };
}
