/** El recurso no existe o pertenece a otro usuario (no se distingue a propósito). */
export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} no existe`);
    this.name = 'NotFoundError';
  }
}

/** Datos de entrada inválidos; el mensaje es apto para mostrar al usuario o a la IA. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}

function hasPgCode(err: unknown, code: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; cause?: { code?: unknown } | null };
  return e.code === code || e.cause?.code === code;
}

/** Violación de unicidad de Postgres (23505); drizzle envuelve el error del driver en `cause`. */
export function isUniqueViolation(err: unknown): boolean {
  return hasPgCode(err, '23505');
}

/** Violación de clave foránea de Postgres (23503); también puede venir envuelta en `cause`. */
export function isForeignKeyViolation(err: unknown): boolean {
  return hasPgCode(err, '23503');
}
