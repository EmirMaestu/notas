export default function globalSetup() {
  if (process.env.DATABASE_URL) {
    throw new Error('Los e2e no deben correr contra una base real: vaciá DATABASE_URL antes de ejecutarlos.');
  }
  // La base PGLite se limpia en e2e/reset-db.mjs, antes de arrancar el servidor (ver webServer.command).
}
