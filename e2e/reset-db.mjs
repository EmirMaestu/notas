// Base PGLite limpia en cada corrida. Va ANTES de arrancar el servidor (webServer.command): Playwright inicia el
// servidor antes que globalSetup, y desde que src/instrumentation.ts abre la base al arrancar, borrarla después
// (como hacía globalSetup) rompería la base ya abierta.
import { rmSync } from 'node:fs';
import path from 'node:path';

rmSync(path.join(process.cwd(), '.data', 'e2e'), { recursive: true, force: true });
