# Notas — Plan 5: Despliegue en la VPS

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **La Parte A** (Tasks 1–9) la ejecuta un subagente en la máquina de desarrollo (Windows; comandos en PowerShell salvo donde se indica Git Bash). **La Parte B** (Tasks B0–B7) la ejecuta la sesión principal **con supervisión del usuario**, paso a paso, porque toca un servidor en producción compartido con otras apps.

**Goal:** Publicar Notas en `https://notas.example.com` en la VPS (`<usuario>@<ip-de-tu-vps>`): app Next.js standalone + PostgreSQL 16 en Docker Compose (proyecto `notas`), detrás del Caddy del sistema que ya sirve otras apps, con migraciones al arrancar, limpieza diaria, backups diarios con retención de 14 días, despliegues reproducibles desde la máquina de desarrollo y validación final conectando Claude/ChatGPT al MCP.

**Architecture:** Dos cambios de código testeables: `src/lib/maintenance.ts` (`runMaintenance` + `scheduleMaintenance`, limpieza de sesiones, papelera y datos OAuth) y `src/lib/startup.ts` (`startServer`: abre la base —lo que aplica las migraciones— y programa el mantenimiento), invocados desde `src/instrumentation.ts` solo en el runtime Node. Un route handler `/api/health` (consulta `select 1`) sirve al `HEALTHCHECK` de Docker y al script de despliegue. La imagen se construye en la VPS desde un `Dockerfile` multi-etapa (`node:24-bookworm-slim`, usuario no root). `deploy/docker-compose.yml` levanta `db` (`postgres:16-alpine`, volumen `notas_pgdata`) y `app` (publicada solo en `127.0.0.1:3200`). El Caddy del sistema incorpora `deploy/notas.caddy` (convención de la VPS: un archivo por app importado al final de `/etc/caddy/Caddyfile`). `deploy/deploy.sh` (Git Bash en Windows) empaqueta `HEAD` con `git archive`, lo extrae en `~/notas/releases/<fecha>-<sha>`, construye, levanta, espera `/api/health`, mueve el symlink `~/notas/current` y, si la versión nueva no responde, vuelve sola a la anterior. Secretos en `~/notas/.env` (fuera de las releases); backups en `~/notas/backups` por cron (`deploy/backup.sh`).

**Tech Stack:** Next.js 15.5.27 (`output: 'standalone'`, `instrumentation.ts`), Drizzle ORM 0.45 + postgres.js, Vitest 3, Docker 29 / Docker Compose 2.40 (VPS), `node:24-bookworm-slim`, `postgres:16-alpine`, Caddy 2.11 (servicio systemd existente), cron, Bash. Sin dependencias npm nuevas.

**Spec:** `docs/superpowers/specs/2026-10-08-notas-design.md`, sección "Despliegue"; `docs/PROGRESO.md` ("Próximo paso"). La **migración desde TickTick** queda para el Plan 6 (este plan deja preparado el túnel a Postgres que va a usar el importador).

## Investigación (2026-10-10)

- **VPS** (inspeccionada en solo lectura): Ubuntu 24.04, 4 CPU, 7,8 GB RAM, 116 GB libres, Docker 29.1.3, Compose 2.40, un usuario con sudo sin contraseña. **Caddy v2.11.4 es un servicio del sistema** (`/etc/caddy/Caddyfile`, puertos 80/443, admin en `127.0.0.1:2019`) que ya sirve otras apps en producción; cada sitio tiene su propio archivo `/etc/caddy/<sitio>.caddy`, importado al final del `Caddyfile`, y antes de editar se guarda una copia del `Caddyfile`. Los archivos de las otras apps usan `encode zstd gzip`, `reverse_proxy 127.0.0.1:<puerto> { flush_interval -1 }` y un bloque `header` con HSTS, `nosniff` y `-Server`. Hay otros puertos ocupados por otras apps del servidor (se verifica que `3200` y `5434` estén libres). Contenedores ajenos a Notas: no se tocan. El crontab del usuario ya tiene tareas de backup de otras apps. DNS de `notas.example.com` apuntando a la IP de la VPS. No hay remoto git: el código viaja desde la máquina de desarrollo.
- **Conclusión sobre el spec:** el spec preveía un contenedor `caddy` propio "salvo que ya haya un proxy"; como lo hay, se integra con el Caddy del sistema y el compose no trae proxy. La actualización `git pull && docker compose up -d --build` del spec se reemplaza por `deploy/deploy.sh` (no hay remoto). `AUTH_SECRET` del spec no existe en el código (las sesiones son tokens aleatorios hasheados en la base): los secretos son `POSTGRES_PASSWORD` e `INVITE_CODE`.
- **Next.js 15.5.27 — `instrumentation.ts`** (verificado en `node_modules/next/dist`): con carpeta `src/`, el archivo va en `src/instrumentation.ts` y exporta `async function register()`. Es estable en 15 (sin flag experimental). `ensureInstrumentationRegistered` lo ejecuta una vez al preparar el servidor (`next-server.js` → `runInstrumentationHookIfAvailable`) y **no durante `next build`** (`instrumentation-globals.external.js` sale si `process.env.NEXT_PHASE === 'phase-production-build'`). Si `register()` lanza, Next solo envuelve el error; para "fallar rápido" hay que llamar `process.exit(1)` explícitamente. El código Node-only se importa dinámicamente dentro de `if (process.env.NEXT_RUNTIME === 'nodejs')` (patrón de la documentación; el bundle edge lo elimina). No hay `middleware.ts`, así que no hay compilación edge relevante.
- **Standalone** (`build/utils.js` de Next): el `server.js` generado fuerza `process.env.NODE_ENV = 'production'`, escucha en `process.env.HOSTNAME || '0.0.0.0'` y `PORT`, y `start-server.js` maneja `SIGTERM`. `outputFileTracingIncludes` ya mete `drizzle/**` en el standalone; igual se copia `drizzle/` en la imagen (barato y explícito, porque `getDb()` lee `path.join(process.cwd(), 'drizzle')`).
- **`getDb()` cachea la conexión en `globalThis`**, así que la instancia que abre `instrumentation` (y que ya aplicó las migraciones) es la misma que usan después los route handlers y server components del mismo proceso.
- **`package-lock.json`** (lockfile v3, generado en Windows) incluye los binarios opcionales `linux-x64-gnu` y `-musl` de `@next/swc`, `@tailwindcss/oxide` y `lightningcss`, y `@img/sharp-linux-x64` solo para glibc. Se elige una imagen **Debian (glibc) `node:24-bookworm-slim`** en vez de Alpine para que `npm ci` en Linux encuentre todos sus binarios sin sorpresas. Node 24 es la LTS activa (el proyecto no declara `engines`; desarrollo usa Node 25).
- **Máquina de desarrollo:** Git Bash con `ssh`, `tar`, `gzip` (sin `rsync`); Docker CLI 29.8 instalado pero **el daemon no está corriendo** → `docker build` local solo si `docker info` responde; `docker compose config` (validación del YAML) funciona sin daemon. `core.autocrlf=true` y `core.filemode=false`: sin `.gitattributes`, `git archive` exportaría los `.sh` con CRLF (rompen en Linux) y sin bit de ejecución.
- **Caddy:** `reverse_proxy` reemplaza el `X-Forwarded-For` entrante con la IP real del cliente (sin `trusted_proxies` configurados), así que con `TRUSTED_PROXY_HOPS=1` `clientIpFrom` toma esa IP. Las operaciones `header -X` se difieren automáticamente a la respuesta, así que `-Server`/`-X-Powered-By` también borran lo que manda la app. `encode` comprime `text/*` por defecto (incluye `text/event-stream`).
- **Claude Code** (documentación de `claude mcp add`): `claude mcp add --transport http <nombre> <url> [--header "Authorization: Bearer …"] [--scope user]`; sin `--header`, la autenticación OAuth se dispara desde `/mcp` dentro de Claude Code. Verificar con `claude mcp add --help` al momento de usarlo (Task B6).

## Decisiones tomadas al planificar (resuelven ambigüedades)

- **Proxy:** se usa el Caddy del sistema con `/etc/caddy/notas.caddy` + `import notas.caddy` (convención existente), backup `Caddyfile.bak-notas-<timestamp>`, `caddy validate` antes de `systemctl reload caddy` (reload, nunca restart: no corta las otras apps).
- **Puertos:** app en `127.0.0.1:3200` (libre). Postgres publicado **solo** en `127.0.0.1:5434` para el importador de TickTick del Plan 6 vía túnel SSH (`ssh -L 5434:127.0.0.1:5434 <usuario>@<ip-de-tu-vps>`); nunca en `0.0.0.0`. Docker se salta UFW con los puertos publicados, por eso los dos se atan a `127.0.0.1`.
- **Una sola réplica** de `app` (los limitadores de frecuencia están en memoria). Downtime de unos segundos en cada despliegue (se recrea el contenedor): aceptado.
- **Migraciones al arrancar** en `instrumentation` → `startServer` → `getDb()`. En producción, si la base no conecta o una migración falla: log + `process.exit(1)`; Docker reinicia el contenedor (`restart: unless-stopped`) y `deploy.sh` detecta que no responde y vuelve a la versión anterior. En desarrollo solo se loguea (getDb reintenta en la próxima request).
- **Mantenimiento en el proceso** (no cron del sistema): `scheduleMaintenance` corre `purgeExpiredSessions`, `purgeTrash` (30 días) y `purgeExpiredOAuthData` 1 minuto después de arrancar y luego cada 24 h, con timers `unref()`, sin solaparse, logueando los conteos; un error se loguea y no tumba el proceso. Se desactiva con `NODE_ENV=test` o `NOTAS_DISABLE_MAINTENANCE=1` (los e2e lo desactivan). Como cada despliegue reinicia el proceso, en la práctica corre también tras cada deploy; es idempotente.
- **`/api/health`:** `GET` público, `select 1` contra la base → `200 {"status":"ok"}` o `503 {"status":"error"}` (sin detalles; el error va al log). `Cache-Control: no-store`. Lo usan el `HEALTHCHECK` de la imagen (con `node -e fetch(…)`, la imagen slim no trae curl) y `deploy.sh`.
- **Imagen:** `node:24-bookworm-slim` en las tres etapas (`deps` con `npm ci`, `build` con `npm run build`, `runner` con el standalone), usuario `node` (uid 1000, ya existe en la imagen oficial), `NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1`. El build necesita red (Inter vía `next/font/google`, `npm ci`): la VPS la tiene. `next build` corre lint y typecheck (usa las devDependencies de la etapa `deps`).
- **`.env` de producción:** `~/notas/.env` (chmod 600) con `POSTGRES_PASSWORD`, `INVITE_CODE`, `APP_URL`, `TRUSTED_PROXY_HOPS`. Compose lo usa **solo para interpolar** (`--env-file`); cada servicio recibe únicamente lo suyo vía `environment:` (la app no ve `POSTGRES_PASSWORD` suelto). `DATABASE_URL` la arma el compose: `postgres://notas:${POSTGRES_PASSWORD}@db:5432/notas`; por eso la contraseña se genera con `openssl rand -hex 24` (sin caracteres que haya que escapar en una URL). Los secretos nunca se imprimen, salvo `INVITE_CODE` una vez para dárselo al usuario.
- **Releases:** `~/notas/releases/<AAAAMMDD-HHMMSS>-<sha corto>` (UTC) extraídas de `git archive HEAD` en un directorio **nuevo** (así un archivo borrado en el repo no sobrevive); `~/notas/current` es un symlink que se mueve atómicamente (`ln -sfn` + `mv -T`) **solo después** de que la versión nueva responde `/api/health`. Se conservan las 3 últimas (nunca se borra la apuntada por `current`). `deploy.sh` exige árbol limpio y rama `master` (se puede forzar otra rama con `NOTAS_ALLOW_BRANCH=1`).
- **Rollback automático:** si la versión nueva no responde en 120 s, `deploy.sh` muestra los logs, vuelve a levantar la release anterior (`up -d --build`, rápido por la caché de capas), borra la release fallida y termina con error. Las migraciones son solo hacia adelante: una versión vieja corre sobre el esquema nuevo (los cambios de este proyecto son aditivos); si algún día no lo fueran, restaurar el backup (ver `deploy/restore.md`).
- **Compresión:** `encode zstd gzip` para todo **menos `/mcp`** (respuestas SSE de la era 2025: se envían sin compresión ni buffer, con `flush_interval -1`; son JSON chicos, la compresión no aporta).
- **Límites de cuerpo en Caddy:** `request_body` de 1 MB en `/oauth/*` y `/mcp` (las server actions de Next ya limitan a 1 MB por defecto).
- **Cabeceras:** Caddy agrega `Strict-Transport-Security: max-age=31536000`, `X-Content-Type-Options: nosniff` y quita `Server` y `X-Powered-By`. **No** repite `X-Frame-Options`, `Content-Security-Policy: frame-ancestors 'none'` ni `Referrer-Policy`, que ya pone `next.config.ts`.
- **Backups:** `deploy/backup.sh` con `pg_dump --clean --if-exists --no-owner` (SQL plano, restaurable con `psql`) comprimido con gzip a `~/notas/backups/notas-AAAAMMDD-HHMMSS.sql.gz` (escrito a `.part`, verificado con `gzip -t` y que contenga `CREATE TABLE`, recién ahí renombrado), permisos 600, retención 14 días. Cron `45 4 * * *` (después de los backups existentes de 03:00 y 04:30), invocado con `bash` explícito.
- **Fin de línea y permisos:** `.gitattributes` fuerza LF en `*.sh`, `Dockerfile`, `.dockerignore` y `deploy/**`; los `.sh` se marcan ejecutables con `git update-index --chmod=+x` (y `deploy.sh` igual hace `chmod +x` en la VPS por las dudas).
- **Logs:** driver `json-file` con rotación (10 MB × 3) en los dos servicios.
- **Memoria:** `mem_limit` 768 MB para `app` y 512 MB para `db` (la VPS tiene 7,8 GB compartidos con otras apps).
- **Ejecución:** la Parte A se hace en la rama `feat/despliegue` y se mergea a `master` al final (Task 9); `deploy.sh` despliega `master`. Ningún paso de la Parte A toca la VPS.

## Estructura de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src/lib/maintenance.ts` | Crear | `runMaintenance`, `formatMaintenanceReport`, `maintenanceEnabled`, `scheduleMaintenance` |
| `src/lib/startup.ts` | Crear | `startServer`: migraciones al arrancar (falla rápido en producción) + programar mantenimiento |
| `src/instrumentation.ts` | Crear | `register()` de Next: llama a `startServer` solo en el runtime Node |
| `src/app/api/health/route.ts` | Crear | `GET /api/health` (`select 1`) |
| `tests/lib/maintenance.test.ts` | Crear | Limpieza real sobre PGlite y programación con timers falsos |
| `tests/lib/startup.test.ts` | Crear | Falla rápido en producción, sigue en desarrollo, respeta los flags |
| `tests/routes/health.test.ts` | Crear | 200 con base sana, 503 si la base falla |
| `.env.example` | Modificar | Documentar `NOTAS_DISABLE_MAINTENANCE` |
| `playwright.config.ts` | Modificar | `NOTAS_DISABLE_MAINTENANCE: '1'` en el servidor de e2e |
| `.gitattributes` | Crear | LF en scripts, Dockerfile y `deploy/` |
| `Dockerfile` | Crear | Imagen multi-etapa del standalone |
| `.dockerignore` | Crear | Contexto de build mínimo y sin secretos |
| `deploy/docker-compose.yml` | Crear | Servicios `db` y `app` (proyecto `notas`) |
| `deploy/.env.production.example` | Crear | Variables de `~/notas/.env` documentadas |
| `deploy/notas.caddy` | Crear | Sitio `notas.example.com` para el Caddy del sistema |
| `deploy/backup.sh` | Crear | `pg_dump` diario comprimido con retención |
| `deploy/restore.md` | Crear | Restaurar un backup, probar un backup, volver a una release anterior |
| `deploy/deploy.sh` | Crear | Despliegue desde la máquina de desarrollo (Git Bash) |
| `docs/PROGRESO.md` | Modificar | Estado al terminar (Task B7) |

Estructura en la VPS al terminar:

```
~/notas/
├── .env                      # secretos (600), fuera de las releases
├── current -> releases/20261010-153000-6add364
├── releases/                 # 3 últimas releases (git archive de HEAD)
│   └── 20261010-153000-6add364/   (Dockerfile, deploy/, src/, drizzle/, … + REVISION)
├── backups/                  # notas-AAAAMMDD-HHMMSS.sql.gz (14 días) + backup.log
└── crontab.pre-notas-*       # copia del crontab antes de editarlo
/etc/caddy/notas.caddy        # copia de deploy/notas.caddy
/etc/caddy/Caddyfile.bak-notas-AAAAMMDD-HHMMSS
```

---

# PARTE A — Cambios en el repositorio (subagente, máquina de desarrollo)

Antes de la Task 1, crear la rama desde `master` limpio:

```powershell
git status --short
git switch -c feat/despliegue
```

Expected: `git status --short` sin salida; `Switched to a new branch 'feat/despliegue'`.

### Task 1: Mantenimiento programable — `src/lib/maintenance.ts`

**Files:**
- Create: `src/lib/maintenance.ts`, `tests/lib/maintenance.test.ts`

- [ ] **Step 1: Escribir el test que falla — `tests/lib/maintenance.test.ts`**

```ts
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient } from '@/core/oauth';
import { createSession, getSessionUser } from '@/core/sessions';
import { createTask, listTasks } from '@/core/tasks';
import { tasks } from '@/db/schema';
import type { DB } from '@/db/types';
import {
  MAINTENANCE_INITIAL_DELAY_MS, MAINTENANCE_INTERVAL_MS, formatMaintenanceReport, maintenanceEnabled,
  runMaintenance, scheduleMaintenance, type MaintenanceReport, type MaintenanceRun,
} from '@/lib/maintenance';
import { createTestDb, createTestUser } from '../helpers/db';
import { createTestClient } from '../helpers/oauth';

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-01-01T00:00:00Z');
const EMPTY: MaintenanceReport = { sessions: 0, trash: 0, oauthCodes: 0, oauthTokens: 0, oauthClients: 0 };

describe('runMaintenance', () => {
  it('borra sesiones vencidas, papelera vieja y clientes OAuth huérfanos; lo vigente queda', async () => {
    const db = await createTestDb();
    const user = await createTestUser(db);
    const now = new Date(T0.getTime() + 40 * DAY);
    await createSession(db, user.id, T0); // vence a los 30 días
    const live = await createSession(db, user.id, now);
    const old = await createTask(db, user.id, { title: 'vieja' });
    const recent = await createTask(db, user.id, { title: 'reciente' });
    await db.update(tasks).set({ deletedAt: T0 }).where(eq(tasks.id, old.id));
    await db.update(tasks).set({ deletedAt: new Date(now.getTime() - DAY) }).where(eq(tasks.id, recent.id));
    const orphan = await createTestClient(db, undefined, T0);

    expect(await runMaintenance(db, now)).toEqual({
      sessions: 1, trash: 1, oauthCodes: 0, oauthTokens: 0, oauthClients: 1,
    });
    expect(await getSessionUser(db, live.token, now)).not.toBeNull();
    expect((await listTasks(db, user.id, { view: 'trash' })).map((t) => t.title)).toEqual(['reciente']);
    expect(await getClient(db, orphan.clientId)).toBeNull();
    // Idempotente: una segunda pasada no encuentra nada.
    expect(await runMaintenance(db, now)).toEqual(EMPTY);
  });
});

describe('formatMaintenanceReport', () => {
  it('resume los conteos en una línea de log', () => {
    expect(formatMaintenanceReport({ sessions: 1, trash: 2, oauthCodes: 3, oauthTokens: 4, oauthClients: 5 }))
      .toBe('[mantenimiento] sesiones vencidas: 1, papelera: 2, OAuth: 3 códigos, 4 tokens, 5 clientes');
  });
});

describe('maintenanceEnabled', () => {
  it('corre en producción y desarrollo; no en tests ni con NOTAS_DISABLE_MAINTENANCE=1', () => {
    expect(maintenanceEnabled({ NODE_ENV: 'production' })).toBe(true);
    expect(maintenanceEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(maintenanceEnabled({ NODE_ENV: 'production', NOTAS_DISABLE_MAINTENANCE: '0' })).toBe(true);
    expect(maintenanceEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(maintenanceEnabled({ NODE_ENV: 'production', NOTAS_DISABLE_MAINTENANCE: '1' })).toBe(false);
  });
});

describe('scheduleMaintenance', () => {
  const fakeDb = {} as DB;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(run = vi.fn<MaintenanceRun>(async () => EMPTY)) {
    const logger = { log: vi.fn(), error: vi.fn() };
    const getDb = vi.fn(async () => fakeDb);
    const stop = scheduleMaintenance({ getDb, run, logger, now: () => T0 });
    return { run, logger, getDb, stop };
  }

  it('corre 1 minuto después de arrancar y luego cada 24 h, y loguea el resultado', async () => {
    const { run, logger, stop } = setup();
    await vi.advanceTimersByTimeAsync(MAINTENANCE_INITIAL_DELAY_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(fakeDb, T0);
    expect(logger.log).toHaveBeenCalledWith(formatMaintenanceReport(EMPTY));
    await vi.advanceTimersByTimeAsync(MAINTENANCE_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it('un error se loguea y no corta las corridas siguientes', async () => {
    const run = vi.fn<MaintenanceRun>().mockRejectedValueOnce(new Error('base caída')).mockResolvedValue(EMPTY);
    const { logger, stop } = setup(run);
    await vi.advanceTimersByTimeAsync(MAINTENANCE_INITIAL_DELAY_MS);
    expect(logger.error).toHaveBeenCalledWith('[mantenimiento] falló:', expect.any(Error));
    await vi.advanceTimersByTimeAsync(MAINTENANCE_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    expect(logger.log).toHaveBeenCalledTimes(1);
    stop();
  });

  it('no se solapa si una corrida tarda más que el intervalo', async () => {
    const run = vi.fn<MaintenanceRun>(() => new Promise<MaintenanceReport>(() => {}));
    const logger = { log: vi.fn(), error: vi.fn() };
    const stop = scheduleMaintenance({ getDb: async () => fakeDb, run, logger, initialDelayMs: 0, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stop() cancela lo programado', async () => {
    const { run, stop } = setup();
    stop();
    await vi.advanceTimersByTimeAsync(MAINTENANCE_INITIAL_DELAY_MS + MAINTENANCE_INTERVAL_MS);
    expect(run).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/lib/maintenance.test.ts`
Expected: FAIL — no se puede resolver `@/lib/maintenance`.

- [ ] **Step 3: Crear `src/lib/maintenance.ts`**

```ts
import { purgeExpiredOAuthData } from '@/core/oauth';
import { purgeExpiredSessions } from '@/core/sessions';
import { purgeTrash } from '@/core/tasks';
import type { DB } from '@/db/types';

/** Primera limpieza: 1 minuto después de arrancar (no compite con el arranque ni con el primer tráfico). */
export const MAINTENANCE_INITIAL_DELAY_MS = 60_000;
/** Después, una vez por día. */
export const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface MaintenanceReport {
  sessions: number;
  trash: number;
  oauthCodes: number;
  oauthTokens: number;
  oauthClients: number;
}

export type MaintenanceRun = (db: DB, now: Date) => Promise<MaintenanceReport>;
export type Env = Readonly<Record<string, string | undefined>>;
export type Logger = Pick<Console, 'log' | 'error'>;

/**
 * Limpieza de TODOS los usuarios: sesiones vencidas, tareas con más de 30 días en la papelera y datos OAuth
 * vencidos (códigos, tokens y clientes de registro dinámico huérfanos). Idempotente.
 */
export async function runMaintenance(db: DB, now: Date = new Date()): Promise<MaintenanceReport> {
  const sessions = await purgeExpiredSessions(db, now);
  const trash = await purgeTrash(db, now);
  const oauth = await purgeExpiredOAuthData(db, now);
  return { sessions, trash, oauthCodes: oauth.codes, oauthTokens: oauth.tokens, oauthClients: oauth.clients };
}

export function formatMaintenanceReport(r: MaintenanceReport): string {
  return `[mantenimiento] sesiones vencidas: ${r.sessions}, papelera: ${r.trash}, `
    + `OAuth: ${r.oauthCodes} códigos, ${r.oauthTokens} tokens, ${r.oauthClients} clientes`;
}

/** La limpieza programada no corre en tests ni si se desactiva con NOTAS_DISABLE_MAINTENANCE=1. */
export function maintenanceEnabled(env: Env = process.env): boolean {
  return env.NODE_ENV !== 'test' && env.NOTAS_DISABLE_MAINTENANCE !== '1';
}

export interface ScheduleOptions {
  getDb: () => Promise<DB>;
  run?: MaintenanceRun;
  logger?: Logger;
  initialDelayMs?: number;
  intervalMs?: number;
  now?: () => Date;
}

/**
 * Programa la limpieza: una vez a los `initialDelayMs` y después cada `intervalMs`. Los timers no mantienen vivo
 * el proceso (`unref`), una corrida nunca se solapa con la anterior y un error solo se loguea.
 * Devuelve una función que cancela lo programado.
 */
export function scheduleMaintenance({
  getDb,
  run = runMaintenance,
  logger = console,
  initialDelayMs = MAINTENANCE_INITIAL_DELAY_MS,
  intervalMs = MAINTENANCE_INTERVAL_MS,
  now = () => new Date(),
}: ScheduleOptions): () => void {
  let running = false;
  let interval: ReturnType<typeof setInterval> | undefined;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const report = await run(await getDb(), now());
      logger.log(formatMaintenanceReport(report));
    } catch (err) {
      logger.error('[mantenimiento] falló:', err);
    } finally {
      running = false;
    }
  };

  const first = setTimeout(() => {
    void tick();
    interval = setInterval(() => void tick(), intervalMs);
    interval.unref?.();
  }, initialDelayMs);
  first.unref?.();

  return () => {
    clearTimeout(first);
    if (interval) clearInterval(interval);
  };
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run tests/lib/maintenance.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Tipos y lint**

Run: `npx tsc --noEmit`
Expected: sin errores.
Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/maintenance.ts tests/lib/maintenance.test.ts
git commit -m "feat(despliegue): limpieza diaria programable (sesiones, papelera y datos OAuth)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Arranque — migraciones al iniciar y `instrumentation.ts`

**Files:**
- Create: `src/lib/startup.ts`, `src/instrumentation.ts`, `tests/lib/startup.test.ts`
- Modify: `.env.example`, `playwright.config.ts`

- [ ] **Step 1: Escribir el test que falla — `tests/lib/startup.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import type { DB } from '@/db/types';
import type { Env } from '@/lib/maintenance';
import { startServer } from '@/lib/startup';

function deps(env: Env, getDb: () => Promise<DB> = vi.fn(async () => ({}) as DB)) {
  return {
    getDb,
    env,
    exit: vi.fn(),
    logger: { log: vi.fn(), error: vi.fn() },
    schedule: vi.fn(() => () => {}),
  };
}

const failingDb = () => vi.fn(async (): Promise<DB> => {
  throw new Error('DATABASE_URL no está configurada');
});

describe('startServer', () => {
  it('abre la base (aplica las migraciones) y programa el mantenimiento', async () => {
    const d = deps({ NODE_ENV: 'production' });
    await startServer(d);
    expect(d.getDb).toHaveBeenCalledTimes(1);
    expect(d.logger.log).toHaveBeenCalledWith('[notas] base de datos lista (migraciones aplicadas)');
    expect(d.schedule).toHaveBeenCalledWith({ getDb: d.getDb, logger: d.logger });
    expect(d.exit).not.toHaveBeenCalled();
  });

  it('en producción, si la base falla, sale con código 1 y no programa nada', async () => {
    const d = deps({ NODE_ENV: 'production' }, failingDb());
    await startServer(d);
    expect(d.logger.error).toHaveBeenCalledWith(
      '[notas] no se pudo abrir la base o aplicar las migraciones:', expect.any(Error),
    );
    expect(d.exit).toHaveBeenCalledWith(1);
    expect(d.schedule).not.toHaveBeenCalled();
  });

  it('en desarrollo, si la base falla, lo loguea y sigue (getDb reintenta en la próxima request)', async () => {
    const d = deps({ NODE_ENV: 'development' }, failingDb());
    await startServer(d);
    expect(d.logger.error).toHaveBeenCalled();
    expect(d.exit).not.toHaveBeenCalled();
    expect(d.schedule).toHaveBeenCalledTimes(1);
  });

  it('no programa el mantenimiento en tests ni con NOTAS_DISABLE_MAINTENANCE=1', async () => {
    const enTests = deps({ NODE_ENV: 'test' });
    await startServer(enTests);
    expect(enTests.schedule).not.toHaveBeenCalled();
    const desactivado = deps({ NODE_ENV: 'production', NOTAS_DISABLE_MAINTENANCE: '1' });
    await startServer(desactivado);
    expect(desactivado.getDb).toHaveBeenCalledTimes(1);
    expect(desactivado.schedule).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/lib/startup.test.ts`
Expected: FAIL — no se puede resolver `@/lib/startup`.

- [ ] **Step 3: Crear `src/lib/startup.ts`**

```ts
import type { DB } from '@/db/types';
import { maintenanceEnabled, scheduleMaintenance, type Env, type Logger, type ScheduleOptions } from './maintenance';

export interface StartupDeps {
  getDb: () => Promise<DB>;
  env?: Env;
  exit?: (code: number) => void;
  logger?: Logger;
  schedule?: (options: ScheduleOptions) => () => void;
}

/**
 * Se llama una vez al arrancar el servidor (desde src/instrumentation.ts). Abre la base, lo que aplica las
 * migraciones pendientes; en producción, si falla, termina el proceso para que Docker lo reinicie y el
 * despliegue lo detecte (mejor que servir errores 500). Después programa la limpieza diaria.
 */
export async function startServer({
  getDb,
  env = process.env,
  exit = (code) => process.exit(code),
  logger = console,
  schedule = scheduleMaintenance,
}: StartupDeps): Promise<void> {
  try {
    await getDb();
    logger.log('[notas] base de datos lista (migraciones aplicadas)');
  } catch (err) {
    logger.error('[notas] no se pudo abrir la base o aplicar las migraciones:', err);
    if (env.NODE_ENV === 'production') {
      exit(1);
      return;
    }
  }
  if (maintenanceEnabled(env)) schedule({ getDb, logger });
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run tests/lib/startup.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Crear `src/instrumentation.ts`**

```ts
/**
 * Next.js llama a register() una vez al arrancar el servidor (nunca durante `next build`).
 * Solo en el runtime Node: abre la base (aplica las migraciones) y programa la limpieza diaria.
 * Los imports son dinámicos para que nada de esto entre en un bundle edge.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { getDb } = await import('@/db');
  const { startServer } = await import('@/lib/startup');
  await startServer({ getDb });
}
```

- [ ] **Step 6: Documentar la variable — agregar al final de `.env.example`**

```
# 1 = no programar la limpieza diaria (sesiones vencidas, papelera de más de 30 días, datos OAuth vencidos).
# Con NODE_ENV=test nunca corre.
NOTAS_DISABLE_MAINTENANCE=
```

- [ ] **Step 7: `playwright.config.ts` — en `webServer.env`, agregar la última línea (queda así)**

```ts
    env: {
      INVITE_CODE: 'e2e-invite',
      PGLITE_DIR: '.data/e2e',
      DATABASE_URL: '', // fuerza PGLite aunque el entorno tenga una base real
      NEXT_DIST_DIR: '.next-e2e', // no pisa el .next de un servidor de desarrollo abierto
      APP_URL: 'http://localhost:3100', // issuer OAuth y recurso MCP del servidor de e2e
      NOTAS_DISABLE_MAINTENANCE: '1', // sin limpieza programada durante los e2e
    },
```

- [ ] **Step 8: Tipos, lint y suite completa**

Run: `npx tsc --noEmit`
Expected: sin errores.
Run: `npm run lint`
Expected: sin errores.
Run: `npx vitest run`
Expected: todos los tests en verde (los existentes + 11 nuevos de las Tasks 1 y 2).

- [ ] **Step 9: Commit**

```powershell
git add src/lib/startup.ts src/instrumentation.ts tests/lib/startup.test.ts .env.example playwright.config.ts
git commit -m "feat(despliegue): migraciones al arrancar y limpieza programada vía instrumentation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `GET /api/health`

**Files:**
- Create: `src/app/api/health/route.ts`, `tests/routes/health.test.ts`

- [ ] **Step 1: Escribir el test que falla — `tests/routes/health.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/health/route';
import { setDbForTests } from '@/db';
import type { DB } from '@/db/types';
import { createTestDb } from '../helpers/db';

afterEach(() => {
  setDbForTests(undefined);
  vi.restoreAllMocks();
});

describe('/api/health', () => {
  it('200 con la base sana', async () => {
    setDbForTests(await createTestDb());
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('503 sin detalles si la base no responde', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setDbForTests({
      execute: async () => {
        throw new Error('conexión rechazada');
      },
    } as unknown as DB);
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'error' });
    expect(consoleError).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/routes/health.test.ts`
Expected: FAIL — no se puede resolver `@/app/api/health/route`.

- [ ] **Step 3: Crear `src/app/api/health/route.ts`**

```ts
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
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run tests/routes/health.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Tipos y lint**

Run: `npx tsc --noEmit`
Expected: sin errores.
Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 6: Commit**

```powershell
git add src/app/api/health/route.ts tests/routes/health.test.ts
git commit -m "feat(despliegue): endpoint /api/health con chequeo de la base" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Imagen Docker — `.gitattributes`, `Dockerfile`, `.dockerignore`

**Files:**
- Create: `.gitattributes`, `Dockerfile`, `.dockerignore`

- [ ] **Step 1: Crear `.gitattributes`**

```
# Lo que corre en Linux (VPS / contenedor) va siempre con LF, aunque core.autocrlf=true en Windows:
# git archive aplica la conversión de fin de línea al exportar.
*.sh text eol=lf
Dockerfile text eol=lf
.dockerignore text eol=lf
deploy/** text eol=lf
```

- [ ] **Step 2: Crear `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1
# Imagen de producción de Notas (Next.js standalone). Se construye en la VPS vía deploy/docker-compose.yml.
# Debian (glibc) y no Alpine: package-lock.json trae los binarios nativos linux-x64-gnu de swc, tailwind
# (oxide, lightningcss) y sharp, así que npm ci no depende de variantes musl.
ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Necesita red: next/font/google descarga Inter durante el build.
RUN npm run build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# getDb() aplica las migraciones desde ./drizzle al arrancar (el standalone ya las trae; esto lo hace explícito).
COPY --from=build --chown=node:node /app/drizzle ./drizzle
USER node
EXPOSE 3000
# La imagen slim no trae curl: el chequeo usa el fetch de Node.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.js"]
```

- [ ] **Step 3: Crear `.dockerignore`**

```
# Contexto del build: solo lo necesario para `npm ci` + `next build`. Nunca secretos ni bases locales.
.git
.gitattributes
.gitignore
.dockerignore
Dockerfile
node_modules
.next
.next-e2e
.data
coverage
test-results
playwright-report
*.tsbuildinfo
next-env.d.ts
.env
.env.*
.claude
.vscode
docs
deploy
e2e
tests
README.md
```

- [ ] **Step 4: Verificar que los archivos quedan con LF en el índice**

Run: `git add .gitattributes Dockerfile .dockerignore; git ls-files --eol Dockerfile .dockerignore .gitattributes`
Expected: los tres con `i/lf`; `Dockerfile` y `.dockerignore` con `attr/text eol=lf` (un aviso "CRLF will be replaced by LF" es normal).

- [ ] **Step 5: Build de producción y "falla rápido" del standalone**

Run: `npm run build`
Expected: build exitoso; en la tabla de rutas aparece `ƒ /api/health`.

Run: `Test-Path .next/standalone/server.js; Test-Path .next/standalone/drizzle/0000_first_mongoose.sql; Test-Path .next/server/instrumentation.js`
Expected: `True` tres veces.

Arrancar el standalone **sin** `DATABASE_URL` (en producción debe terminar solo con código 1; `server.js` fuerza `NODE_ENV=production`):

```powershell
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
$env:APP_URL = 'http://localhost:3999'; $env:PORT = '3999'
$p = Start-Process -FilePath node -ArgumentList '.next/standalone/server.js' -NoNewWindow -PassThru -RedirectStandardOutput "$env:TEMP\notas-out.txt" -RedirectStandardError "$env:TEMP\notas-err.txt"
$null = $p.Handle
if (-not $p.WaitForExit(60000)) { 'NO TERMINÓ'; Stop-Process -Id $p.Id -Force }
"exit=$($p.ExitCode)"
Get-Content "$env:TEMP\notas-out.txt", "$env:TEMP\notas-err.txt"
```

Expected: `exit=1` y en la salida `[notas] no se pudo abrir la base o aplicar las migraciones: Error: DATABASE_URL no está configurada` (antes puede aparecer `✓ Ready`: Next empieza a escuchar mientras corre `register()`; las requests que lleguen en ese lapso esperan la misma promesa de `getDb()`). Si aparece `NO TERMINÓ`, `register()` no se está ejecutando: revisar que el archivo esté en `src/instrumentation.ts` y que el build lo haya compilado (`.next/server/instrumentation.js`).

- [ ] **Step 6: Build de la imagen (solo si Docker está corriendo en esta máquina)**

Run: `docker info --format '{{.ServerVersion}}'`
Si falla con `failed to connect to the docker API` (Docker Desktop apagado): **saltar este step**; la imagen se construye y verifica en la VPS (Task B2). Si responde una versión:

Run: `docker build -t notas-app:local .`
Expected: build exitoso (las tres etapas).
Run: `docker run --rm -e APP_URL=https://notas.test notas-app:local; "exit=$LASTEXITCODE"`
Expected: el log `[notas] no se pudo abrir la base o aplicar las migraciones: Error: DATABASE_URL no está configurada` y `exit=1`.
Run: `docker image rm notas-app:local`

- [ ] **Step 7: Commit**

```powershell
git commit -m "build(despliegue): imagen Docker multi-etapa del standalone con healthcheck" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Docker Compose y variables de producción

**Files:**
- Create: `deploy/docker-compose.yml`, `deploy/.env.production.example`

- [ ] **Step 1: Crear `deploy/docker-compose.yml`**

```yaml
# Notas en la VPS. Siempre se usa así (deploy.sh y backup.sh lo hacen):
#   docker compose -p notas --env-file ~/notas/.env -f ~/notas/current/deploy/docker-compose.yml <comando>
# ~/notas/.env solo sirve para interpolar ${...}: cada servicio recibe únicamente sus variables.
name: notas

services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: notas
      POSTGRES_USER: notas
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?falta POSTGRES_PASSWORD en ~/notas/.env}
    volumes:
      - pgdata:/var/lib/postgresql/data
    # Solo loopback: lo usa el importador de TickTick por túnel SSH (ssh -L 5434:127.0.0.1:5434 ...).
    ports:
      - "127.0.0.1:5434:5432"
    shm_size: 128mb
    mem_limit: 512m
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U notas -d notas"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s
    logging: &logging
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  app:
    build:
      context: ..
      dockerfile: Dockerfile
      labels:
        notas.component: app
    image: notas-app:latest
    restart: unless-stopped
    init: true
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://notas:${POSTGRES_PASSWORD:?falta POSTGRES_PASSWORD en ~/notas/.env}@db:5432/notas
      APP_URL: ${APP_URL:?falta APP_URL en ~/notas/.env}
      INVITE_CODE: ${INVITE_CODE:-}
      TRUSTED_PROXY_HOPS: ${TRUSTED_PROXY_HOPS:-1}
      NOTAS_DISABLE_MAINTENANCE: ${NOTAS_DISABLE_MAINTENANCE:-}
    # Solo el Caddy del host habla con la app. Una sola réplica: los límites de frecuencia están en memoria.
    ports:
      - "127.0.0.1:3200:3000"
    mem_limit: 768m
    logging: *logging

volumes:
  pgdata:
```

- [ ] **Step 2: Crear `deploy/.env.production.example`**

```
# Plantilla de ~/notas/.env en la VPS (chmod 600, fuera de las releases). Lo lee docker compose con
# --env-file solo para interpolar deploy/docker-compose.yml: ningún contenedor recibe este archivo entero.

# Contraseña del usuario "notas" de Postgres. Solo hexadecimal porque va dentro de DATABASE_URL.
# Generar con: openssl rand -hex 24
POSTGRES_PASSWORD=

# DATABASE_URL NO va acá: el compose la arma para la app como
#   postgres://notas:${POSTGRES_PASSWORD}@db:5432/notas
# ("db" es el nombre del servicio de Postgres en la red interna del proyecto).

# Código para registrarse en /registro. Vacío = registro deshabilitado. Generar con: openssl rand -hex 8
INVITE_CODE=

# URL pública, sin barra final: issuer de OAuth y base del MCP (<APP_URL>/mcp). Obligatoria.
APP_URL=https://notas.example.com

# Proxies delante de la app: solo Caddy.
TRUSTED_PROXY_HOPS=1

# Opcional: 1 = no programar la limpieza diaria.
NOTAS_DISABLE_MAINTENANCE=
```

- [ ] **Step 3: Validar el compose (no necesita el daemon de Docker)**

```powershell
$envFile = Join-Path $env:TEMP 'notas-compose-test.env'
Set-Content -Encoding ascii -Path $envFile -Value @('POSTGRES_PASSWORD=abc123', 'INVITE_CODE=xyz', 'APP_URL=https://notas.example.com', 'TRUSTED_PROXY_HOPS=1')
docker compose -p notas --env-file $envFile -f deploy/docker-compose.yml config
```

Expected: imprime la configuración resuelta con `name: notas`; en `app.environment`, `DATABASE_URL: postgres://notas:abc123@db:5432/notas`, `APP_URL: https://notas.example.com`, `INVITE_CODE: xyz`, `TRUSTED_PROXY_HOPS: "1"`; `build.context` = la raíz del repo; puertos con `host_ip: 127.0.0.1` (`published: "3200"` → `target: 3000`, y `published: "5434"` → `target: 5432`).

```powershell
Set-Content -Encoding ascii -Path $envFile -Value @('APP_URL=https://notas.example.com')
docker compose -p notas --env-file $envFile -f deploy/docker-compose.yml config; "exit=$LASTEXITCODE"
Remove-Item $envFile
```

Expected: error que menciona `falta POSTGRES_PASSWORD en ~/notas/.env` y `exit=1`.
Si `docker compose` no está disponible en esta máquina, anotarlo en el reporte: la validación se repite en la VPS (Task B2, `config --quiet`).

- [ ] **Step 4: Commit**

```powershell
git add deploy/docker-compose.yml deploy/.env.production.example
git commit -m "build(despliegue): docker compose (app + Postgres 16) y plantilla del .env de producción" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Sitio de Caddy — `deploy/notas.caddy`

**Files:**
- Create: `deploy/notas.caddy`

- [ ] **Step 1: Crear `deploy/notas.caddy`**

```caddyfile
# Notas — app Next.js en 127.0.0.1:3200 (docker compose, proyecto "notas").
# Se copia a /etc/caddy/notas.caddy y se importa al final de /etc/caddy/Caddyfile con `import notas.caddy`.
notas.example.com {
	# /mcp responde SSE (clientes de la era 2025 del protocolo): sin compresión para que cada evento salga
	# apenas la app lo escribe. Son JSON chicos; comprimirlos no aporta.
	@comprimible not path /mcp /mcp/*
	encode @comprimible zstd gzip

	# Formularios OAuth y JSON-RPC del MCP: cuerpos chicos.
	request_body /oauth/* {
		max_size 1MB
	}
	request_body /mcp {
		max_size 1MB
	}

	# X-Frame-Options, CSP frame-ancestors y Referrer-Policy los pone la app (next.config.ts): no se repiten.
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		-Server
		-X-Powered-By
	}

	# flush_interval -1: sin buffer, las respuestas SSE pasan al cliente en el acto.
	# Caddy reemplaza X-Forwarded-For con la IP real del cliente: la app usa TRUSTED_PROXY_HOPS=1.
	reverse_proxy 127.0.0.1:3200 {
		flush_interval -1
	}
}
```

- [ ] **Step 2: Validar la sintaxis (solo si Docker está corriendo en esta máquina)**

Run: `docker info --format '{{.ServerVersion}}'`
Si falla: saltar este step (se valida en la VPS, Task B3, con `caddy validate` sobre el `Caddyfile` completo). Si responde:

Run: `docker run --rm -v "${PWD}/deploy/notas.caddy:/etc/caddy/Caddyfile:ro" caddy:2.11 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`
Expected: termina con `Valid configuration`.

- [ ] **Step 3: Commit**

```powershell
git add deploy/notas.caddy
git commit -m "build(despliegue): sitio de Caddy para notas.example.com" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Backups — `deploy/backup.sh` y `deploy/restore.md`

**Files:**
- Create: `deploy/backup.sh`, `deploy/restore.md`

- [ ] **Step 1: Crear `deploy/backup.sh`**

```bash
#!/usr/bin/env bash
# Backup de la base de Notas: pg_dump comprimido en ~/notas/backups; se conservan 14 días.
# Cron (usuario de la VPS):  45 4 * * * bash ~/notas/current/deploy/backup.sh >> ~/notas/backups/backup.log 2>&1
set -euo pipefail
umask 077

BASE="${NOTAS_BASE:-$HOME/notas}"
DEST="$BASE/backups"
KEEP_DAYS="${NOTAS_BACKUP_DAYS:-14}"
FILE="$DEST/notas-$(date +%Y%m%d-%H%M%S).sql.gz"
TMP="$FILE.part"

log() { echo "$(date '+%F %T') [backup] $*"; }
trap 'rm -f "$TMP"' EXIT

mkdir -p "$DEST"
log "inicio: $FILE"

# --clean --if-exists: el SQL borra y recrea cada objeto, así se restaura sobre la base existente con psql.
docker compose -p notas --env-file "$BASE/.env" -f "$BASE/current/deploy/docker-compose.yml" \
  exec -T db pg_dump -U notas -d notas --clean --if-exists --no-owner \
  | gzip -9 > "$TMP"

gzip -t "$TMP"
TABLES="$(gzip -dc "$TMP" | grep -c '^CREATE TABLE' || true)"
if [ "${TABLES:-0}" -eq 0 ]; then
  log "ERROR: el dump no contiene tablas; no se guarda"
  exit 1
fi
mv "$TMP" "$FILE"
log "ok: $TABLES tablas, $(du -h "$FILE" | cut -f1)"

# -mtime +13 = modificados hace 14 días o más.
DELETED="$(find "$DEST" -maxdepth 1 -name 'notas-*.sql.gz' -mtime +"$((KEEP_DAYS - 1))" -print -delete | wc -l)"
log "borrados por antigüedad (>= $KEEP_DAYS días): $DELETED"
```

- [ ] **Step 2: Crear `deploy/restore.md`**

````markdown
# Notas — restaurar backups y volver a una versión anterior

Todo se corre en tu VPS (`ssh <usuario>@<ip-de-tu-vps>`). Atajo usado abajo:

```bash
C="docker compose -p notas --env-file $HOME/notas/.env -f $HOME/notas/current/deploy/docker-compose.yml"
```

## Ver los backups

```bash
ls -lh ~/notas/backups/
tail -n 20 ~/notas/backups/backup.log
```

Cada archivo `notas-AAAAMMDD-HHMMSS.sql.gz` es un `pg_dump` en SQL plano con `--clean --if-exists`
(borra y recrea cada tabla al restaurarlo). Se guardan 14 días.

## Probar un backup sin tocar producción

Restaura el último backup en un Postgres temporal y descartable:

```bash
ARCHIVO="$(ls -1t ~/notas/backups/notas-*.sql.gz | head -n 1)"
docker run -d --rm --name notas-restore-test -e POSTGRES_PASSWORD=prueba postgres:16-alpine
until docker exec notas-restore-test pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 2
gzip -dc "$ARCHIVO" | docker exec -i notas-restore-test psql -q -U postgres -d postgres -v ON_ERROR_STOP=1
docker exec notas-restore-test psql -U postgres -d postgres -c '\dt public.*' \
  -c 'select count(*) as usuarios from users' -c 'select count(*) as tareas from tasks'
docker rm -f notas-restore-test
```

Debe listar las 13 tablas de `public` y los conteos esperados.

## Restaurar en producción

1. Backup de lo que hay ahora (por si hay que deshacer la restauración):
   `bash ~/notas/current/deploy/backup.sh`
2. Elegir el archivo (para otro que no sea el más reciente, poné su ruta en `ARCHIVO`):
   `ARCHIVO="$(ls -1t ~/notas/backups/notas-*.sql.gz | sed -n 2p)"` (el 2.º más nuevo: el 1.º es el del paso 1)
3. Frenar la app, restaurar en una sola transacción y volver a levantarla:

```bash
$C stop app
gzip -dc "$ARCHIVO" | $C exec -T db psql -q -U notas -d notas -v ON_ERROR_STOP=1 --single-transaction
$C start app
until curl -fsS http://127.0.0.1:3200/api/health; do sleep 2; done; echo
```

Si `psql` falla, la transacción se deshace entera y la base queda como estaba: volver a levantar la app con
`$C start app` y revisar el error.

## Volver a la versión anterior del código

`deploy.sh` ya vuelve solo a la release anterior si la nueva no responde. Para hacerlo a mano:

```bash
ls -1 ~/notas/releases                       # las 3 últimas, la más nueva al final
readlink -f ~/notas/current                  # la actual
ANTERIOR="$(ls -1 ~/notas/releases | sort | tail -n 2 | head -n 1)"
docker compose -p notas --env-file ~/notas/.env -f ~/notas/releases/$ANTERIOR/deploy/docker-compose.yml \
  up -d --build --remove-orphans
until curl -fsS http://127.0.0.1:3200/api/health; do sleep 2; done; echo
ln -sfn ~/notas/releases/$ANTERIOR ~/notas/current.new && mv -Tf ~/notas/current.new ~/notas/current
```

Las migraciones solo van hacia adelante: la versión anterior corre sobre el esquema nuevo (mientras los
cambios sean aditivos). Si no lo fueran, restaurar además el backup previo al despliegue.

## Copia fuera de la VPS

Los backups viven en el mismo disco que la base. Desde la máquina de desarrollo (Git Bash), de vez en cuando:

```bash
mkdir -p ~/notas-backups && scp '<usuario>@<ip-de-tu-vps>:notas/backups/notas-*.sql.gz' ~/notas-backups/
```
````

- [ ] **Step 3: Verificar sintaxis y fin de línea (Git Bash)**

Run (Git Bash): `bash -n deploy/backup.sh && echo sintaxis-ok`
Expected: `sintaxis-ok`.

- [ ] **Step 4: Marcar ejecutable y commit**

```powershell
git add deploy/backup.sh deploy/restore.md
git update-index --chmod=+x deploy/backup.sh
git ls-files -s deploy/backup.sh
git commit -m "build(despliegue): backup diario con pg_dump y guía de restauración" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: `git ls-files -s` muestra `100755` para `deploy/backup.sh`.

---

### Task 8: Despliegue — `deploy/deploy.sh`

**Files:**
- Create: `deploy/deploy.sh`

- [ ] **Step 1: Crear `deploy/deploy.sh`**

```bash
#!/usr/bin/env bash
# Despliega el HEAD de este repositorio en la VPS. Desde la raíz del repo, en Git Bash:
#   bash deploy/deploy.sh
# Obligatoria: NOTAS_DEPLOY_HOST (usuario@mi-vps, o en deploy/.deploy.env). Opcional: NOTAS_ALLOW_BRANCH=1 para desplegar otra rama.
#
# En la VPS: ~/notas/releases/<fecha UTC>-<sha> (código), ~/notas/current (symlink a la release activa),
# ~/notas/.env (secretos) y ~/notas/backups (fuera de las releases).
set -euo pipefail

VPS="${NOTAS_DEPLOY_HOST:?Falta NOTAS_DEPLOY_HOST (usuario@mi-vps)}"  # el script real también lee deploy/.deploy.env
cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain)" ]; then
  echo "El árbol de trabajo no está limpio: commiteá o descartá los cambios antes de desplegar." >&2
  git status --short >&2
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "master" ] && [ "${NOTAS_ALLOW_BRANCH:-}" != "1" ]; then
  echo "Estás en la rama '$BRANCH': se despliega master (o usá NOTAS_ALLOW_BRANCH=1)." >&2
  exit 1
fi

SHA="$(git rev-parse HEAD)"
REL="$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short=7 HEAD)"
echo "==> Desplegando $REL ($BRANCH) en $VPS"

if ! ssh -o BatchMode=yes "$VPS" 'test -f ~/notas/.env'; then
  echo "No se pudo entrar a $VPS o falta ~/notas/.env (ver Task B1 del Plan 5)." >&2
  exit 1
fi

echo "==> Subiendo el código (git archive de HEAD a una release nueva)"
git archive --format=tar HEAD | gzip -c | ssh -o BatchMode=yes "$VPS" \
  "set -e; mkdir -p ~/notas/releases/$REL; tar -xzf - -C ~/notas/releases/$REL; echo $SHA > ~/notas/releases/$REL/REVISION"

echo "==> Construyendo y levantando en la VPS"
ssh -o BatchMode=yes "$VPS" bash -s -- "$REL" <<'REMOTE'
set -euo pipefail
REL="$1"
BASE="$HOME/notas"
RELEASE="$BASE/releases/$REL"
ENV_FILE="$BASE/.env"
HEALTH_URL="http://127.0.0.1:3200/api/health"

compose() {
  local dir="$1"
  shift
  docker compose -p notas --env-file "$ENV_FILE" -f "$dir/deploy/docker-compose.yml" "$@"
}

healthy() {
  local i
  for i in $(seq 1 60); do
    if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

chmod +x "$RELEASE"/deploy/*.sh
PREV=""
if [ -L "$BASE/current" ]; then PREV="$(readlink -f "$BASE/current")"; fi

compose "$RELEASE" config --quiet
compose "$RELEASE" build app
compose "$RELEASE" up -d --remove-orphans

if ! healthy; then
  echo "!! La versión $REL no respondió en $HEALTH_URL" >&2
  compose "$RELEASE" ps >&2 || true
  compose "$RELEASE" logs --tail 80 app >&2 || true
  if [ -n "$PREV" ] && [ -d "$PREV" ] && [ "$PREV" != "$RELEASE" ]; then
    echo "==> Volviendo a $(basename "$PREV")" >&2
    compose "$PREV" up -d --build --remove-orphans
    if healthy; then
      echo "==> Versión anterior restaurada; se borra la release fallida" >&2
      rm -rf -- "$RELEASE"
    else
      echo "!! ATENCIÓN: la versión anterior tampoco responde" >&2
    fi
  else
    echo "!! No hay versión anterior: la release queda en $RELEASE para revisarla" >&2
  fi
  exit 1
fi

ln -sfn "$RELEASE" "$BASE/current.new"
mv -Tf "$BASE/current.new" "$BASE/current"
echo "==> current -> releases/$REL"

# Conserva las 3 releases más nuevas (el nombre empieza con la fecha UTC) y nunca borra la actual.
CURRENT="$(readlink -f "$BASE/current")"
ls -1 "$BASE/releases" | sort | head -n -3 | while read -r old; do
  [ "$BASE/releases/$old" = "$CURRENT" ] && continue
  rm -rf -- "${BASE:?}/releases/$old"
  echo "    release vieja borrada: $old"
done

# Imágenes de la app que quedaron sin etiqueta tras el build (solo las de Notas, por la etiqueta del compose).
docker image prune -f --filter label=notas.component=app >/dev/null

compose "$BASE/current" ps
echo "==> Listo: $(cat "$BASE/current/REVISION")"
REMOTE
```

- [ ] **Step 2: Verificar sintaxis (Git Bash)**

Run (Git Bash): `bash -n deploy/deploy.sh && echo sintaxis-ok`
Expected: `sintaxis-ok`.

- [ ] **Step 3: Verificar que se niega a desplegar con el árbol sucio (no toca la VPS)**

Con `deploy/deploy.sh` todavía sin commitear, el árbol no está limpio:

Run (Git Bash): `bash deploy/deploy.sh; echo "exit=$?"`
Expected: `El árbol de trabajo no está limpio: commiteá o descartá los cambios antes de desplegar.`, el listado de `git status --short` (incluye `?? deploy/deploy.sh`) y `exit=1`. No se ejecuta ningún `ssh`.

- [ ] **Step 4: Marcar ejecutable, verificar fin de línea del paquete y commit**

```powershell
git add deploy/deploy.sh
git update-index --chmod=+x deploy/deploy.sh
git commit -m "build(despliegue): script de despliegue con releases, healthcheck y vuelta atrás automática" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git ls-files -s deploy/deploy.sh deploy/backup.sh
git ls-files --eol deploy/ Dockerfile .dockerignore
```

Expected: `100755` en los dos scripts; todas las líneas de `--eol` con `i/lf` y `attr/text eol=lf`.

Run (Git Bash): `git archive --format=tar HEAD deploy/deploy.sh deploy/backup.sh deploy/notas.caddy Dockerfile | tar -xOf - | grep -c $'\r'`
Expected: `0` (el paquete que viaja a la VPS no tiene CRLF).

---

### Task 9: Verificación final de la Parte A y merge

**Files:** ninguno nuevo.

- [ ] **Step 1: Suite completa**

Run: `npx vitest run`
Expected: todos los tests en verde (los existentes + 13 nuevos).
Run: `npx tsc --noEmit`
Expected: sin errores.
Run: `npm run lint`
Expected: sin errores.
Run: `npm run build`
Expected: build exitoso.
Run: `npm run e2e`
Expected: todos los e2e pasan (el servidor de desarrollo arranca con `instrumentation` activo y `NOTAS_DISABLE_MAINTENANCE=1`).

- [ ] **Step 2: Revisar el log de la rama**

Run: `git log --oneline master..feat/despliegue`
Expected: los 8 commits de las Tasks 1–8.

- [ ] **Step 3: Merge a `master` (lo hace la sesión principal después de la revisión)**

```powershell
git switch master
git merge --no-ff feat/despliegue -m "Merge feat/despliegue: imagen Docker, compose, Caddy, backups y despliegue (plan 5, parte A)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git status --short
```

Expected: merge sin conflictos; `git status --short` sin salida (requisito de `deploy.sh`).

---

# PARTE B — Operaciones en la VPS (sesión principal, con supervisión del usuario)

Reglas para toda la Parte B:

- Cada task se anuncia al usuario antes de ejecutarla; los pasos marcados **(confirmar)** esperan un "sí" explícito.
- Los comandos se corren **desde la máquina de desarrollo en Git Bash** (herramienta Bash), por `ssh <usuario>@<ip-de-tu-vps>`. Los bloques `bash -s <<'EOF'` se ejecutan en la VPS.
- **No se toca nada ajeno a Notas**: contenedores de otras apps, otros `.caddy`, otras líneas del crontab. Nada de `docker system prune`, `docker builder prune` ni `systemctl restart caddy`.
- **Secretos:** nunca imprimir `~/notas/.env` ni `POSTGRES_PASSWORD`. `INVITE_CODE` se muestra una sola vez (Task B6) para dárselo al usuario. Los tokens `ntk_` del usuario no pasan por la sesión: los comandos que los usan los corre el usuario en su terminal.
- Si un paso no da lo esperado: frenar, mostrar la salida al usuario y aplicar el **rollback** de esa task antes de seguir.

### Task B0: Chequeo previo (solo lectura)

- [ ] **Step 1: Acceso y estado de la VPS**

```bash
ssh -o BatchMode=yes <usuario>@<ip-de-tu-vps> 'bash -s' <<'EOF'
uname -m
docker --version; docker compose version; curl --version | head -n 1; openssl version; caddy version
ss -ltn | grep -E ':(3200|5434)\b' || echo "3200 y 5434 libres"
docker compose ls
docker volume ls --format '{{.Name}}' | grep '^notas_' || echo "sin volúmenes notas_"
ls -la ~/notas 2>/dev/null || echo "sin ~/notas"
ls -l /etc/caddy
tail -n 5 /etc/caddy/Caddyfile
crontab -l
docker ps --format '{{.Names}}: {{.Status}}'
df -h / | tail -n 1; free -h | head -n 2
EOF
```

Expected: `x86_64`; Docker 29.x, Compose 2.40.x, curl, OpenSSL y Caddy v2.11.x presentes; `3200 y 5434 libres`; `docker compose ls` sin proyecto `notas`; `sin volúmenes notas_`; `sin ~/notas`; en `/etc/caddy` el `Caddyfile` y los `.caddy` de las otras apps (anotar dueño y permisos para replicarlos); el `Caddyfile` termina con los `import …caddy`; el crontab conserva sus líneas previas; los contenedores de otras apps `Up`. **Guardar esta salida** como línea de base.

Si `uname -m` no es `x86_64` (p. ej. `aarch64`), frenar: la imagen sigue funcionando (Node y Postgres son multi-arquitectura) pero hay que confirmar que `package-lock.json` trae los binarios `linux-arm64-gnu`.

- [ ] **Step 2: Línea de base de los otros sitios (desde la máquina de desarrollo)**

```bash
for u in https://otra-app.example.com https://otro-sitio.example.com; do  # otros sitios que sirve el mismo Caddy
  curl -sS -o /dev/null --max-time 15 -w "%{http_code} $u\n" "$u"
done
```

Expected: un código HTTP por sitio (200, 30x o el que sea); **anotarlos** para comparar después de recargar Caddy (Task B3).

- [ ] **Step 3: DNS**

Run: `nslookup notas.example.com`
Expected: `Address:` con la IP de tu VPS.

### Task B1: Carpetas y `~/notas/.env`

- [ ] **Step 1: Crear la estructura y los secretos (confirmar)**

```bash
ssh <usuario>@<ip-de-tu-vps> 'bash -s' <<'EOF'
set -euo pipefail
umask 077
mkdir -p ~/notas/releases ~/notas/backups
if [ -e ~/notas/.env ]; then
  echo "~/notas/.env ya existe: no se toca"
else
  cat > ~/notas/.env <<ENV
POSTGRES_PASSWORD=$(openssl rand -hex 24)
INVITE_CODE=$(openssl rand -hex 8)
APP_URL=https://notas.example.com
TRUSTED_PROXY_HOPS=1
ENV
  echo "~/notas/.env creado"
fi
chmod 600 ~/notas/.env
ls -la ~/notas
awk -F= '{ printf "%s (%d caracteres)\n", $1, length(substr($0, length($1) + 2)) }' ~/notas/.env
EOF
```

Expected: `~/notas/.env creado`; `ls` muestra `-rw------- … .env`, `backups/` y `releases/`; el `awk` lista **solo nombres y largos**: `POSTGRES_PASSWORD (48 caracteres)`, `INVITE_CODE (16 caracteres)`, `APP_URL (29 caracteres)`, `TRUSTED_PROXY_HOPS (1 caracteres)`.

**Rollback:** `ssh <usuario>@<ip-de-tu-vps> 'rm -rf ~/notas'` (solo mientras no haya nada desplegado).

### Task B2: Primer despliegue

Requisito: Parte A mergeada en `master` y árbol limpio.

- [ ] **Step 1: Desplegar (confirmar)**

Run (Git Bash, raíz del repo, en `master`): `bash deploy/deploy.sh`
Expected (la primera vez tarda varios minutos: descarga `node:24-bookworm-slim` y `postgres:16-alpine`, `npm ci` y `next build`):
- `==> Desplegando 2026…-<sha> (master) en <usuario>@<ip-de-tu-vps>`
- salida del build terminando sin errores, `Container notas-db-1 Healthy`, `Container notas-app-1 Started`
- `==> current -> releases/2026…-<sha>`
- `ps` con `notas-app-1` (`Up …`, `health: starting` o `healthy`, `127.0.0.1:3200->3000/tcp`) y `notas-db-1` (`Up … (healthy)`, `127.0.0.1:5434->5432/tcp`)
- `==> Listo: <sha completo de master>`

Si termina con `!! La versión … no respondió`: es la primera release, no hay vuelta atrás automática; mostrar los logs impresos al usuario, corregir en el repo (nuevo commit en `master`) y volver a correr `deploy.sh`.

- [ ] **Step 2: Verificar contenedores, logs, migraciones y puertos**

```bash
ssh <usuario>@<ip-de-tu-vps> 'bash -s' <<'EOF'
C="docker compose -p notas --env-file $HOME/notas/.env -f $HOME/notas/current/deploy/docker-compose.yml"
$C ps
docker logs notas-app-1 2>&1 | tail -n 20
curl -fsS http://127.0.0.1:3200/api/health; echo
$C exec -T db psql -U notas -d notas -c '\dt public.*' -c 'select count(*) as migraciones from drizzle.__drizzle_migrations'
ss -ltn | grep -E ':(3200|5434)\b'
docker ps --format '{{.Names}}: {{.Status}}'
EOF
```

Expected: los dos servicios `Up`; en el log de la app `✓ Ready` y `[notas] base de datos lista (migraciones aplicadas)`, sin errores; `{"status":"ok"}`; 13 tablas en `public` (`api_tokens`, `folders`, `list_members`, `lists`, `oauth_clients`, `oauth_codes`, `oauth_tokens`, `sessions`, `subtasks`, `tags`, `task_tags`, `tasks`, `users`) y `migraciones = 6`; `ss` muestra **solo** `127.0.0.1:3200` y `127.0.0.1:5434`; los contenedores de otras apps siguen como en la línea de base.

- [ ] **Step 3: Mantenimiento (un minuto después del arranque)**

Run: `ssh <usuario>@<ip-de-tu-vps> "docker logs notas-app-1 2>&1 | grep mantenimiento"`
Expected: `[mantenimiento] sesiones vencidas: 0, papelera: 0, OAuth: 0 códigos, 0 tokens, 0 clientes`.

**Rollback de B2:** `ssh <usuario>@<ip-de-tu-vps> 'docker compose -p notas --env-file ~/notas/.env -f ~/notas/current/deploy/docker-compose.yml down'` (conserva el volumen `notas_pgdata`; con `down -v` se borra la base: solo si todavía no hay datos reales y el usuario lo confirma).

### Task B3: Caddy

- [ ] **Step 1: Backup del `Caddyfile`, copiar el sitio y validar (confirmar)**

```bash
ssh <usuario>@<ip-de-tu-vps> 'bash -s' <<'EOF'
set -euo pipefail
TS="$(date +%Y%m%d-%H%M%S)"
sudo cp -a /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-notas-$TS"
echo "backup: /etc/caddy/Caddyfile.bak-notas-$TS"
sudo install -m 644 -o root -g root ~/notas/current/deploy/notas.caddy /etc/caddy/notas.caddy
if ! sudo grep -qxF 'import notas.caddy' /etc/caddy/Caddyfile; then
  printf '\nimport notas.caddy\n' | sudo tee -a /etc/caddy/Caddyfile >/dev/null
fi
tail -n 5 /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
EOF
```

Expected: `backup: /etc/caddy/Caddyfile.bak-notas-…` (**anotar el nombre**); el `tail` termina en `import notas.caddy` (una sola vez) después de los otros `import`; `caddy validate` termina con `Valid configuration` (un aviso de formato es inofensivo). Si en B0 los otros `.caddy` tenían otro dueño o permisos, ajustar `install -o/-g/-m` para que coincidan antes de correrlo.

Si `validate` falla: **no recargar**; rollback (abajo) y revisar `deploy/notas.caddy`.

- [ ] **Step 2: Recargar Caddy (confirmar)**

```bash
ssh <usuario>@<ip-de-tu-vps> 'bash -s' <<'EOF'
sudo systemctl reload caddy
systemctl is-active caddy
sleep 15
sudo journalctl -u caddy --since "3 min ago" --no-pager | grep -iE 'notas|error' | tail -n 20
EOF
```

Expected: `active`; en el journal, para `notas.example.com`, `obtaining certificate` y luego `certificate obtained successfully`, sin `error` (si el certificado tarda, repetir el `journalctl` un minuto después). `reload` es atómico: si la config nueva fallara, Caddy sigue con la anterior.

- [ ] **Step 3: Los otros sitios siguen igual y Notas tiene certificado válido (máquina de desarrollo)**

```bash
for u in https://otra-app.example.com https://otro-sitio.example.com; do  # otros sitios que sirve el mismo Caddy
  curl -sS -o /dev/null --max-time 15 -w "%{http_code} $u\n" "$u"
done
curl -sS -o /dev/null -w "%{http_code} ssl_verify=%{ssl_verify_result}\n" https://notas.example.com/login
echo | openssl s_client -connect notas.example.com:443 -servername notas.example.com 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
```

Expected: los otros sitios con **los mismos códigos** que en B0; `200 ssl_verify=0`; `subject=CN = notas.example.com`, `issuer` de Let's Encrypt (o ZeroSSL) y `notAfter` dentro de ~90 días.

**Rollback de B3** (si algo de lo anterior falla o otro sitio cambió de código):

```bash
ssh <usuario>@<ip-de-tu-vps> 'bash -s' <<'EOF'
set -euo pipefail
B="$(ls -1t /etc/caddy/Caddyfile.bak-notas-* | head -n 1)"
sudo cp -a "$B" /etc/caddy/Caddyfile
sudo rm -f /etc/caddy/notas.caddy
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
systemctl is-active caddy
EOF
```

### Task B4: Pruebas de humo por HTTPS (máquina de desarrollo)

- [ ] **Step 1: Páginas, cabeceras y redirección a HTTPS**

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://notas.example.com/login
curl -sS -D - -o /dev/null -H 'Accept-Encoding: gzip' https://notas.example.com/login \
  | grep -iE '^(strict-transport-security|x-content-type-options|x-frame-options|content-security-policy|referrer-policy|content-encoding|server|x-powered-by):'
curl -sS -o /dev/null -w "%{http_code} %{redirect_url}\n" http://notas.example.com/login
curl -sS https://notas.example.com/api/health; echo
```

Expected:
- `200`
- cabeceras: `strict-transport-security: max-age=31536000`, `x-content-type-options: nosniff`, `x-frame-options: DENY`, `content-security-policy: frame-ancestors 'none'`, `referrer-policy: no-referrer`, `content-encoding: gzip`; **ninguna** línea `server:` ni `x-powered-by:` (cada cabecera una sola vez)
- `308 https://notas.example.com/login`
- `{"status":"ok"}`

- [ ] **Step 2: Metadata OAuth**

```bash
curl -sS https://notas.example.com/.well-known/oauth-protected-resource/mcp; echo
curl -sS https://notas.example.com/.well-known/oauth-authorization-server; echo
```

Expected: el primero exactamente
`{"resource":"https://notas.example.com/mcp","authorization_servers":["https://notas.example.com"],"scopes_supported":["tasks"],"bearer_methods_supported":["header"],"resource_name":"Notas"}`;
el segundo con `"issuer":"https://notas.example.com"` y `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `revocation_endpoint` en `https://notas.example.com/oauth/…`.

- [ ] **Step 3: `/mcp` sin token**

```bash
curl -sS -i -X POST https://notas.example.com/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | head -n 15
```

Expected: `HTTP/2 401` (o `HTTP/1.1 401`) y
`www-authenticate: Bearer resource_metadata="https://notas.example.com/.well-known/oauth-protected-resource/mcp", scope="tasks"`.

- [ ] **Step 4: La app y Postgres no son alcanzables desde afuera**

```bash
curl -sS -o /dev/null --max-time 5 -w "%{http_code}
" http://<ip-de-tu-vps>:3200/api/health || echo "3200 cerrado"
timeout 5 bash -c 'exec 3<>/dev/tcp/<ip-de-tu-vps>/5434' 2>/dev/null && echo "5434 ABIERTO" || echo "5434 cerrado"
```

Expected: `3200 cerrado` y `5434 cerrado`. Si alguno responde: frenar y revisar los `ports:` del compose (deben empezar con `127.0.0.1:`).

### Task B5: Backups

- [ ] **Step 1: Correr un backup a mano**

Run: `ssh <usuario>@<ip-de-tu-vps> 'bash ~/notas/current/deploy/backup.sh; ls -l ~/notas/backups'`
Expected: `[backup] inicio: …/notas-AAAAMMDD-HHMMSS.sql.gz`, `[backup] ok: 14 tablas, …` (13 de `public` + `drizzle.__drizzle_migrations`), `borrados por antigüedad (>= 14 días): 0`; el archivo con permisos `-rw-------`.

- [ ] **Step 2: Probar que el backup se restaura (Postgres descartable)**

Correr en la VPS el bloque "Probar un backup sin tocar producción" de `~/notas/current/deploy/restore.md`:

```bash
ssh <usuario>@<ip-de-tu-vps> 'bash -s' <<'EOF'
set -euo pipefail
ARCHIVO="$(ls -1t ~/notas/backups/notas-*.sql.gz | head -n 1)"
docker run -d --rm --name notas-restore-test -e POSTGRES_PASSWORD=prueba postgres:16-alpine >/dev/null
until docker exec notas-restore-test pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 2
gzip -dc "$ARCHIVO" | docker exec -i notas-restore-test psql -q -U postgres -d postgres -v ON_ERROR_STOP=1
docker exec notas-restore-test psql -U postgres -d postgres -At -c "select count(*) from information_schema.tables where table_schema = 'public'"
docker rm -f notas-restore-test >/dev/null
echo restauracion-ok
EOF
```

Expected: `13` y `restauracion-ok`; el contenedor temporal ya no existe (`docker ps -a | grep notas-restore-test` vacío).

- [ ] **Step 3: Agregar el cron sin pisar las entradas existentes (confirmar)**

```bash
ssh <usuario>@<ip-de-tu-vps> 'bash -s' <<'EOF'
set -euo pipefail
LINE='45 4 * * * bash $HOME/notas/current/deploy/backup.sh >> $HOME/notas/backups/backup.log 2>&1'
crontab -l > ~/notas/crontab.pre-notas-$(date +%Y%m%d-%H%M%S)
if crontab -l | grep -qF 'notas/current/deploy/backup.sh'; then
  echo "la línea ya estaba"
else
  (crontab -l; echo "$LINE") | crontab -
fi
crontab -l
EOF
```

Expected: el crontab muestra las líneas previas **intactas** (03:00 y 04:30) y al final
`45 4 * * * bash $HOME/notas/current/deploy/backup.sh >> $HOME/notas/backups/backup.log 2>&1`.

**Rollback:** `ssh <usuario>@<ip-de-tu-vps> 'crontab "$(ls -1t ~/notas/crontab.pre-notas-* | head -n 1)" && crontab -l'`.

- [ ] **Step 4: Al día siguiente (o en la próxima sesión)**

Run: `ssh <usuario>@<ip-de-tu-vps> 'tail -n 5 ~/notas/backups/backup.log; ls -l ~/notas/backups'`
Expected: una corrida de las 04:45 con `ok: 14 tablas`.

### Task B6: Entrega al usuario y validación con clientes reales

- [ ] **Step 1: Código de invitación (se muestra una sola vez)**

Run: `ssh <usuario>@<ip-de-tu-vps> "grep '^INVITE_CODE=' ~/notas/.env | cut -d= -f2"`
Pasárselo al usuario y pedirle que se registre en `https://notas.example.com/registro` con su email, contraseña y ese código. Expected: entra a `/app/today`. Pedirle que cree una tarea de prueba desde la web.

- [ ] **Step 2: Claude (web / Desktop)**

Indicarle al usuario: en claude.ai → **Configuración → Conectores → Agregar conector personalizado**, nombre `Notas`, URL `https://notas.example.com/mcp` → **Conectar** → se abre Notas (login si hace falta) → pantalla de consentimiento → **Permitir**. Después, en un chat con el conector activo: "¿Qué tareas tengo hoy en Notas?" y "Creá en Notas la tarea 'Probar conector' para mañana con prioridad alta".
Expected: Claude lista la tarea de prueba, crea la nueva y esta aparece en la web; en Notas → Configuración → "Conexión con IA" figura la conexión de Claude. (Los nombres exactos de los menús pueden variar; lo que importa es la URL.)

Si falla: `ssh <usuario>@<ip-de-tu-vps> 'docker logs --since 10m notas-app-1 2>&1 | tail -n 50'` y `sudo journalctl -u caddy --since "10 min ago" --no-pager | grep notas`.

- [ ] **Step 3: ChatGPT**

Indicarle al usuario: en ChatGPT → **Configuración → Apps y conectores → Configuración avanzada → Modo desarrollador** (activar) → **Crear**: nombre `Notas`, URL `https://notas.example.com/mcp`, autenticación **OAuth** → Crear → completar el login y el consentimiento en Notas. En un chat nuevo, elegir el conector y pedir "listá mis tareas de hoy en Notas".
Expected: lista las tareas; la conexión aparece en "Conexión con IA". (Requiere un plan con modo desarrollador; si la opción no aparece, anotarlo como pendiente: no es un problema del servidor.)

- [ ] **Step 4: Claude Code**

Verificar la sintaxis vigente: `claude mcp add --help` (debe listar `--transport`, `--scope` y `--header`). Opción A (OAuth, recomendada):

```bash
claude mcp add --transport http --scope user notas https://notas.example.com/mcp
```

y dentro de Claude Code, `/mcp` → `notas` → **Authenticate** (abre el navegador; redirect loopback). Opción B (token personal): el usuario crea un token en Configuración → "Conexión con IA" y corre **él mismo** (el token no pasa por esta sesión):

```bash
claude mcp add --transport http --scope user notas https://notas.example.com/mcp --header "Authorization: Bearer ntk_…"
```

Expected: `claude mcp list` muestra `notas: https://notas.example.com/mcp (HTTP) - ✓ Connected`.

- [ ] **Step 5: SSE sin buffer a través de Caddy (lo corre el usuario con su token)**

```bash
read -rs NTK   # pegar el token ntk_ y Enter
curl -sS -N -D - -X POST https://notas.example.com/mcp \
  -H "authorization: Bearer $NTK" -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' -H 'mcp-protocol-version: 2025-06-18' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | head -c 600; echo
unset NTK
```

Expected: `HTTP/2 200` (o `HTTP/1.1 200`), `content-type: text/event-stream`, **sin** `content-encoding`, y el cuerpo `event: message` / `data: {"jsonrpc":"2.0","id":1,"result":{"tools":[…`. Si el token era solo para esta prueba, revocarlo en Configuración.

### Task B7: Estado del proyecto

- [ ] **Step 1: Reemplazar `docs/PROGRESO.md` por**

````markdown
# Notas — estado del proyecto

Última actualización: al terminar el Plan 5.

## Hecho (todo mergeado en `master`)

| Plan | Contenido | Estado |
|---|---|---|
| 1 — Núcleo | Next.js + Drizzle + lógica de tareas/listas/etiquetas/papelera/vistas, parser de agregado rápido | ✅ |
| 2 — Web | Login/registro con `INVITE_CODE`, sesiones propias, UI de 3 columnas, detalle, configuración | ✅ |
| 3 — Compartir | Listas compartidas (`list_members`), asignación (`assignee_id`), vista "Asignadas a mí" | ✅ |
| 4 — MCP | `/mcp` sin estado (SDK `@modelcontextprotocol/server` 2.3.1, eras 2025 y 2026-07-28), OAuth 2.1 (DCR + PKCE S256 + `resource` + `iss`, rotación de refresh), tokens personales `ntk_`, Configuración → "Conexión con IA" | ✅ |
| 5 — Despliegue | Docker Compose (app standalone + Postgres 16) en la VPS detrás del Caddy del sistema, migraciones al arrancar (`instrumentation.ts`), limpieza diaria en el proceso, `/api/health`, backups diarios con retención de 14 días, `deploy/deploy.sh` con releases y vuelta atrás automática; validado con Claude, ChatGPT y Claude Code | ✅ |

## En producción

- **URL:** https://notas.example.com — MCP: `https://notas.example.com/mcp`.
- **VPS:** `ssh <usuario>@<ip-de-tu-vps>`, carpeta `~/notas` (`current` → `releases/<fecha>-<sha>`, `backups/`, `.env` con los secretos).
- **Desplegar:** en `master` limpio, desde Git Bash: `bash deploy/deploy.sh`.
- **Logs:** `ssh <usuario>@<ip-de-tu-vps> 'docker logs --tail 100 notas-app-1'`.
- **Backups:** 04:45 diario en `~/notas/backups` (14 días); restaurar o volver a una versión anterior: `deploy/restore.md`.
- **Caddy:** `/etc/caddy/notas.caddy` (copia de `deploy/notas.caddy`), importado al final de `/etc/caddy/Caddyfile`. Si cambia `deploy/notas.caddy`, recopiarlo, `sudo caddy validate --config /etc/caddy/Caddyfile` y `sudo systemctl reload caddy`.

## Próximo paso

**Plan 6 — Migración desde TickTick** (ver spec, "Migración desde TickTick"):

- Exportar vía el MCP de TickTick a `ticktick-export.json`; script `scripts/import-ticktick.ts --user <email> --file …`, idempotente por `external_id` (ojo: tareas en papelera ocupan su `external_id`).
- Conexión a la base de producción por túnel: `ssh -N -L 5434:127.0.0.1:5434 <usuario>@<ip-de-tu-vps>` y `DATABASE_URL=postgres://notas:<POSTGRES_PASSWORD de ~/notas/.env>@127.0.0.1:5434/notas`. Hacer un backup (`bash ~/notas/current/deploy/backup.sh`) antes de importar.
- Verificación: totales por lista entre origen y destino.

Ideas para después: Client ID Metadata Documents (CIMD) cuando haga falta, scopes de solo lectura, copia automática de backups fuera de la VPS, monitoreo externo de `/api/health`.

## Cómo retomar

Ejecución con subagentes (superpowers:subagent-driven-development): escribir el plan → implementar por bloques →
revisión de spec y de calidad por bloque → arreglos → merge a `master` → `bash deploy/deploy.sh`.
En Windows: correr `npx vitest` / `npm run e2e` desde PowerShell (en Git Bash falla esbuild); `deploy/deploy.sh` desde Git Bash.
````

Si en la Task B6 algún cliente no se pudo validar, cambiar el final de la fila del Plan 5 por lo que efectivamente se validó y agregar el pendiente en "Próximo paso".

- [ ] **Step 2: Commit y desplegar el cambio de documentación**

```powershell
git add docs/PROGRESO.md
git commit -m "docs: estado del proyecto al terminar el plan 5 (despliegue)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: commit en `master`, árbol limpio. (No hace falta redesplegar por un cambio solo de `docs/`; el próximo `deploy.sh` lo lleva.)

---

## Operación habitual (referencia)

| Qué | Cómo |
|---|---|
| Desplegar | Git Bash, `master` limpio: `bash deploy/deploy.sh` |
| Estado | `ssh <usuario>@<ip-de-tu-vps> 'docker compose -p notas --env-file ~/notas/.env -f ~/notas/current/deploy/docker-compose.yml ps'` |
| Logs | `ssh <usuario>@<ip-de-tu-vps> 'docker logs --tail 100 -f notas-app-1'` |
| Versión desplegada | `ssh <usuario>@<ip-de-tu-vps> 'cat ~/notas/current/REVISION'` |
| Volver a la versión anterior | `deploy/restore.md` → "Volver a la versión anterior del código" |
| Restaurar un backup | `deploy/restore.md` → "Restaurar en producción" |
| Cambiar `INVITE_CODE` / `.env` | editar `~/notas/.env` en la VPS y `docker compose … up -d` (recrea solo la app) |
| Túnel a Postgres | `ssh -N -L 5434:127.0.0.1:5434 <usuario>@<ip-de-tu-vps>` |

## Autorrevisión

**Verificación del plan:** antes de entregarlo, el código de las Tasks 1–8 se aplicó en una copia aislada del repositorio (`git archive` de `master` en `6add364` + `node_modules` del proyecto):
- `vitest run` de los 3 archivos nuevos → 13 tests en verde; `tsc --noEmit` y `eslint` sobre los archivos nuevos sin errores.
- `next build` exitoso, con `ƒ /api/health` en la tabla de rutas y `instrumentation.js` compilado.
- Arranque en modo producción sin `DATABASE_URL`: imprime `[notas] no se pudo abrir la base o aplicar las migraciones: Error: DATABASE_URL no está configurada` y el proceso termina solo (se observó además que `✓ Ready` sale antes que el log de `register()`; documentado en la Task 4).
- `docker compose config` (CLI 29.8, sin daemon) resuelve el compose con los valores esperados y falla con `falta POSTGRES_PASSWORD en ~/notas/.env` cuando falta la contraseña.
- `bash -n` de `deploy/backup.sh` y `deploy/deploy.sh` sin errores.
- **No verificado en la máquina de desarrollo** (el daemon de Docker está apagado y no hay Caddy local): `docker build`, `caddy validate`, la ejecución real de `deploy.sh` y `backup.sh`. Todo eso se verifica en la Parte B con salida esperada y rollback por paso; las Tasks 4 y 6 lo hacen localmente si Docker está corriendo.

**Cobertura** (spec "Despliegue" + pendientes de `docs/PROGRESO.md`):

| Pedido | Task(s) |
|---|---|
| Migraciones al arrancar (`instrumentation.ts`), fallar rápido | 2 (+ verificación en 4 y B2) |
| Cron diario `purgeExpiredSessions`, `purgeTrash`, `purgeExpiredOAuthData` | 1, 2 (en el proceso, cada 24 h) |
| Una sola réplica | 5 (un servicio `app`, sin `replicas`) |
| No exponer el puerto de la app; Postgres sin puerto externo | 5 (`127.0.0.1:3200`, `127.0.0.1:5434`), B4 Step 4 |
| `TRUSTED_PROXY_HOPS=1`, `APP_URL=https://notas.example.com` | 5, B1 |
| `.dockerignore` | 4 |
| Imagen Next.js standalone, `postgres:16`, volumen persistente | 4, 5 |
| Integrarse con el proxy existente en vez de un Caddy propio | 6, B3 |
| Caddy deja pasar `/.well-known/*`, `/oauth/*`, `/mcp` sin buffering (SSE) | 6 (`flush_interval -1`, sin `encode` en `/mcp`), B4, B6 Step 5 |
| Healthcheck | 3, 4 (`HEALTHCHECK`), 8 (`deploy.sh`) |
| Backups `pg_dump` diarios, 14 días, en `~/notas/backups/` | 7, B5 |
| Restauración documentada y probada | 7 (`restore.md`), B5 Step 2 |
| Actualizaciones reproducibles (no hay remoto git) | 8, B2 |
| Secretos en `.env` fuera del repo | 5 (plantilla), B1 |
| Validación final con Claude y ChatGPT operando sobre una tarea real | B6 |
| Estado del proyecto | B7 |
| Importador de TickTick | Fuera de alcance → Plan 6 (túnel a Postgres preparado en 5) |

**Búsqueda de placeholders:** sin "TBD", "TODO" ni pasos sin código. Los valores que solo existen al ejecutar (nombre de la release `2026…-<sha>`, timestamp del backup del `Caddyfile`, código de invitación) se obtienen con un comando del mismo paso. En `restore.md` y `PROGRESO.md`, `AAAAMMDD-HHMMSS` describe el formato del nombre y `<POSTGRES_PASSWORD de ~/notas/.env>` indica de dónde sale el secreto (no se escribe en el repo a propósito).

**Consistencia de nombres:**
- Proyecto compose `notas` (`name:` + `-p notas` en todos los comandos) → contenedores `notas-app-1`/`notas-db-1`, volumen `notas_pgdata`, red `notas_default`; imagen `notas-app:latest` con etiqueta `notas.component=app` (la usa el `image prune` de `deploy.sh`).
- Puertos: app `127.0.0.1:3200→3000`, Postgres `127.0.0.1:5434→5432`; `HEALTH_URL` de `deploy.sh` y `restore.md` = `http://127.0.0.1:3200/api/health`; el `HEALTHCHECK` de la imagen usa el puerto interno 3000.
- Usuario/base de Postgres `notas`/`notas` en el compose, `backup.sh`, `restore.md` y la Task B2.
- Mensajes de log que comparan tests y pasos: `[notas] base de datos lista (migraciones aplicadas)`, `[notas] no se pudo abrir la base o aplicar las migraciones:`, `[mantenimiento] sesiones vencidas: …, papelera: …, OAuth: … códigos, … tokens, … clientes`, `[mantenimiento] falló:`.
- Tipos: `MaintenanceRun`, `Env`, `Logger`, `ScheduleOptions` (exportados por `maintenance.ts`) los usan `startup.ts` y los tests; `StartupDeps.schedule` tiene la firma de `scheduleMaintenance`.
- Rutas en la VPS: `~/notas/{.env,current,releases,backups}` idénticas en `deploy.sh`, `backup.sh`, `restore.md`, cron y Parte B.

## Riesgos y pendientes

1. **Downtime de segundos en cada despliegue** (se recrea el único contenedor de la app). Aceptado: una sola réplica por los límites en memoria.
2. **El build corre en la VPS**, que comparte CPU/RAM con otras apps en producción (`next build` usa ~1–2 GB durante un par de minutos). Si molesta, construir la imagen en la máquina de desarrollo y enviarla con `docker save | ssh … docker load`.
3. **Caché de build de Docker** crece con cada despliegue; `deploy.sh` solo borra imágenes sin etiqueta de Notas. `docker builder prune` afecta a todas las apps: hacerlo a mano y con acuerdo del usuario si el disco lo pide.
4. **`✓ Ready` antes de terminar las migraciones:** las requests de ese lapso esperan la misma promesa de `getDb()`; si las migraciones fallan, alguna puede recibir 500 antes del `exit(1)`. `deploy.sh` igual detecta la falla por `/api/health`.
5. **Migraciones solo hacia adelante:** la vuelta atrás automática corre la versión anterior sobre el esquema nuevo; vale mientras los cambios sean aditivos. Si no, restaurar el backup previo.
6. **Backups en el mismo disco** que la base: copiar a otro lado periódicamente (`restore.md` → "Copia fuera de la VPS"); automatizarlo queda como idea.
7. **`INVITE_CODE` sigue activo** después del registro del usuario (hace falta para sumar personas a listas compartidas). Quien lo tenga puede registrarse: rotarlo o vaciarlo en `~/notas/.env` si no se usa.
8. **HSTS de 1 año** en `notas.example.com`: los navegadores no aceptarán HTTP para ese host durante ese tiempo (deseado; no afecta a otros subdominios porque no lleva `includeSubDomains`).
9. **ChatGPT** exige el modo desarrollador para conectores MCP propios; si la cuenta no lo tiene, la validación con ChatGPT queda pendiente (no es un problema del servidor).
10. **Postgres en `127.0.0.1:5434`:** cualquier proceso local de la VPS puede intentar conectarse (con contraseña). Si el Plan 6 no lo necesita más, quitar el `ports:` de `db` y redesplegar.
11. **Zonas horarias:** el contenedor corre en UTC (la app usa la zona de cada usuario); el cron de backups usa la hora del sistema de la VPS.
12. **Arquitectura:** el plan asume `x86_64` (B0 lo verifica); en ARM habría que revisar los binarios del lockfile.
