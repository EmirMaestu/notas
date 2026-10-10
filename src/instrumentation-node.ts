/** Arranque del servidor solo para el runtime Node (lo importa src/instrumentation.ts). */
import { getDb } from '@/db';
import { startServer } from '@/lib/startup';

export async function registerNode(): Promise<void> {
  await startServer({ getDb });
}
