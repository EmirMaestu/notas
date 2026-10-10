import { unstable_rethrow } from 'next/navigation';
import { NotFoundError, ValidationError } from '@/core/errors';

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

const GENERIC_ERROR = 'Ocurrió un error inesperado. Probá de nuevo.';

/** Ejecuta una acción y convierte errores de dominio en mensajes para el usuario. */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    // redirect(), notFound() y similares de Next.js lanzan errores de control de flujo: hay que dejarlos pasar.
    unstable_rethrow(err);
    if (err instanceof ValidationError || err instanceof NotFoundError) return { ok: false, error: err.message };
    console.error(err);
    return { ok: false, error: GENERIC_ERROR };
  }
}
