# Notas — estado del proyecto

## Hecho

| Plan | Contenido | Estado |
|---|---|---|
| 1 — Núcleo | Next.js + Drizzle + lógica de tareas/listas/etiquetas/papelera/vistas, parser de agregado rápido | Hecho |
| 2 — Web | Login/registro con `INVITE_CODE`, sesiones propias, UI de 3 columnas, detalle, configuración | Hecho |
| 3 — Compartir | Listas compartidas (`list_members`), asignación (`assignee_id`), vista "Asignadas a mí" | Hecho |
| 4 — MCP | `/mcp` sin estado (SDK `@modelcontextprotocol/server` 2.3.1), OAuth 2.1 (DCR + PKCE S256 + `resource` + `iss`, rotación de refresh), tokens personales `ntk_`, Configuración → "Conexión con IA" | Hecho |
| 5 — Despliegue | Docker Compose (app standalone + Postgres 16) detrás de un reverse proxy, migraciones al arrancar, limpieza diaria en el proceso, `/api/health`, backups diarios (14 días), `deploy/deploy.sh` con releases y vuelta atrás automática | Hecho |
| 6 — Rediseño | Interfaz del rediseño de Claude Design (petróleo, Manrope + Geist Mono), tema claro/oscuro con opción manual, celular con cajón y detalle a pantalla completa, toasts con deshacer, estados vacíos/cargando/error, atajos de teclado, «Creada por IA» (`tasks.created_via`) | Hecho |

## Cómo desplegar tu propia instancia

Resumen; el detalle está en el [README](../README.md) y, para el diseño completo, en
[`superpowers/plans/2026-10-10-notas-5-despliegue.md`](superpowers/plans/2026-10-10-notas-5-despliegue.md).

1. En tu VPS (con Docker y Compose) crear `~/notas/.env` a partir de `deploy/.env.production.example`
   (`chmod 600`): `POSTGRES_PASSWORD`, `INVITE_CODE`, `APP_URL=https://notas.example.com`, `TRUSTED_PROXY_HOPS`.
2. Configurar el reverse proxy hacia `127.0.0.1:3200`. Con el Caddy del sistema: copiar `deploy/notas.caddy`
   (con tu dominio) a `/etc/caddy/notas.caddy` e importarlo al final del `Caddyfile` con `import notas.caddy`;
   luego `caddy validate` y `systemctl reload caddy`.
3. En tu máquina, definir el destino: `NOTAS_DEPLOY_HOST=usuario@mi-vps` en el entorno o en `deploy/.deploy.env`
   (archivo no versionado), y correr `bash deploy/deploy.sh` desde un `master` limpio.
4. Programar los backups: `bash ~/notas/current/deploy/backup.sh` por cron (retención configurable con
   `NOTAS_BACKUP_DAYS`, 14 por defecto). Restaurar o volver a una versión anterior: `deploy/restore.md`.

Estructura en la VPS: `~/notas/{current → releases/<fecha>-<sha>, backups/, .env, deployed.log}`.
Logs: `docker logs --tail 100 notas-app-1`.

## Ideas para después

- Importador desde TickTick (`scripts/import-ticktick.ts`, idempotente por `external_id`), pensado para correr contra la base de producción por un túnel SSH.
- Client ID Metadata Documents (CIMD) y scopes de solo lectura en OAuth.
- Copia automática de los backups fuera de la VPS y monitoreo externo de `/api/health`.
- Registrar quién completa o modifica una tarea (`updated_via`) para los toasts «Claude completó…».

## Notas de desarrollo

- En Windows: correr `npx vitest` / `npm run e2e` desde PowerShell (en Git Bash falla esbuild); `deploy/deploy.sh` desde Git Bash.
- El lockfile debe poder instalarse en Linux (`npm ci` en Docker). Si se agregan dependencias desde Windows, verificarlo antes de desplegar.

## Flujo de cambios (PRs obligatorios)

`master` está protegida en GitHub: no acepta push directo ni force push, ni siquiera del administrador. Todo cambio entra por Pull Request (0 aprobaciones requeridas, las conversaciones deben quedar resueltas) y la rama se borra sola al mergear.

1. `git checkout -b <tipo>/<tema>` (p. ej. `feat/recordatorios`, `fix/fecha-detalle`, `docs/…`).
2. Commits, tests verdes (`npx vitest run`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run e2e`).
3. `git push -u origin <rama>` y `gh pr create --fill` (o con título y cuerpo).
4. Revisar el PR y mergearlo: `gh pr merge --merge --delete-branch`.
5. **El deploy es automático:** al mergear, el CI corre sobre `master` y, si pasa, el workflow **Deploy**
   (`.github/workflows/deploy.yml`) hace un backup de la base y corre `deploy/deploy.sh` contra la VPS con una clave
   SSH exclusiva de Actions (entorno `production`, solo desde `master`). Se sigue en GitHub → Actions → Deploy.
6. Para desplegar a mano (p. ej. si Actions no está disponible): `git checkout master && git pull` y
   `bash deploy/deploy.sh` desde Git Bash. También se puede relanzar desde Actions → Deploy → Run workflow.

Los checks obligatorios para mergear a `master` son **Verificación** (tipos, lint, tests, build) y **E2E (Playwright)**
(`.github/workflows/ci.yml`). Los archivos de `.github/workflows/` solo se pueden subir con un token que tenga el
permiso `workflow` (o editándolos desde la web de GitHub).
