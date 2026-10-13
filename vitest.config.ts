import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Cada worker levanta su propio Postgres en memoria (PGlite, ~500 MB). Sin tope, Vitest usa un worker por
    // núcleo y en la PC de desarrollo llegaba a ~8 GB de RAM.
    maxWorkers: 4,
  },
});
