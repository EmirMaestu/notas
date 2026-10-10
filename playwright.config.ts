import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 90_000,
  // El servidor de desarrollo compila cada ruta la primera vez; con varios workers en paralelo
  // las compilaciones en frío se pisan y los tests fallan de forma intermitente.
  workers: 1,
  expect: { timeout: 45_000 },
  use: { baseURL: 'http://localhost:3100' },
  webServer: {
    command: 'node e2e/reset-db.mjs && npm run dev -- --port 3100',
    url: 'http://localhost:3100/login',
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      INVITE_CODE: 'e2e-invite',
      PGLITE_DIR: '.data/e2e',
      DATABASE_URL: '', // fuerza PGLite aunque el entorno tenga una base real
      NEXT_DIST_DIR: '.next-e2e', // no pisa el .next de un servidor de desarrollo abierto
      APP_URL: 'http://localhost:3100', // issuer OAuth y recurso MCP del servidor de e2e
      NOTAS_DISABLE_MAINTENANCE: '1', // sin limpieza programada durante los e2e
    },
  },
});
