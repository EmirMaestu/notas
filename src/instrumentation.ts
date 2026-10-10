/**
 * Next.js llama a register() una vez al arrancar el servidor (nunca durante `next build`).
 * Solo en el runtime Node: abre la base (aplica las migraciones) y programa la limpieza diaria.
 * Todo el código Node vive en instrumentation-node.ts, importado dinámicamente, para que nada de esto
 * entre en la compilación edge (en desarrollo, webpack no puede resolver `node:crypto` ahí).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNode } = await import('./instrumentation-node');
    await registerNode();
  }
}
