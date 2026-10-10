import { sql } from 'drizzle-orm';
import { getDb } from '@/db';

// Siempre en vivo: lo consultan el HEALTHCHECK de Docker y deploy/deploy.sh.
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

/** 200 si la app responde y la base contesta `select 1`; 503 si no (el detalle va solo al log). */
export async function GET(): Promise<Response> {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return Response.json({ status: 'ok' }, { headers: NO_STORE });
  } catch (err) {
    console.error('[health] la base no responde:', err);
    return Response.json({ status: 'error' }, { status: 503, headers: NO_STORE });
  }
}
