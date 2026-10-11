/**
 * Importa una exportación de TickTick (formato TickTickExport de src/lib/ticktick-import.ts) a Notas.
 *
 *   DATABASE_URL=postgres://… npx tsx scripts/import-ticktick.ts --user <email> --file <export.json>
 *
 * Contra producción: abrir antes un túnel SSH al Postgres de la VPS y hacer un backup.
 * Es idempotente por external_id: se puede volver a correr sin duplicar.
 */
import { readFileSync } from 'node:fs';
import { getDb } from '@/db';
import { importTickTick, type TickTickExport } from '@/lib/ticktick-import';

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (!value) {
    console.error(`Falta --${name}. Uso: npx tsx scripts/import-ticktick.ts --user <email> --file <export.json>`);
    process.exit(2);
  }
  return value;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('Falta DATABASE_URL (sin ella se importaría a la base local de desarrollo).');
    process.exit(2);
  }
  const data = JSON.parse(readFileSync(arg('file'), 'utf8')) as TickTickExport;
  const summary = await importTickTick(await getDb(), arg('user'), data);
  console.log(JSON.stringify(summary, null, 2));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
