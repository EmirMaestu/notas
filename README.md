# Notas

Gestor de tareas autoalojado, al estilo de TickTick, con **servidor MCP propio**: cualquier IA (Claude, ChatGPT,
Claude Code, Cursor, vía token personal) puede crear, completar, mover y buscar tus tareas, y la web muestra esos
cambios. Pensado para una persona y su círculo chico (pareja, socios, equipo de 2 a 5).

## Características

- **Vistas:** Bandeja, Hoy, Próximos 7 días, Asignadas a mí, Completadas y Papelera, además de listas, carpetas y etiquetas.
- **Agregado rápido:** escribí `Llamar al médico mañana !alta #casa` y se crea la tarea con fecha, prioridad (`!alta`, `!media`, `!baja`) y etiqueta (`#etiqueta`). Entiende `hoy`, `mañana`, `pasado mañana`, días de la semana y fechas.
- **Subtareas, prioridades, fechas de vencimiento y etiquetas.**
- **Listas compartidas y asignación:** compartí una lista con otras personas y asigná tareas.
- **Notificaciones push:** recordatorios por tarea (minutos antes, o el mismo día / el día anterior para tareas sin hora), resumen diario opcional y aviso cuando te asignan una tarea. Funcionan en Chrome, Edge, Firefox y Safari, y en iPhone/iPad (iOS 16.4+) con Notas agregada a la pantalla de inicio.
- **Conexión con IA:** servidor MCP en `/mcp` con OAuth 2.1 (registro dinámico de clientes, PKCE) y tokens personales (`ntk_…`).
- **Tema claro y oscuro.** Interfaz en español.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Drizzle ORM · PostgreSQL 16 en producción /
PGlite en desarrollo · SDK oficial de MCP · Vitest y Playwright.

## Desarrollo local

```bash
npm install
cp .env.example .env.local   # y completá INVITE_CODE, p. ej. INVITE_CODE=mi-codigo
npm run dev                  # http://localhost:3000
```

Sin `DATABASE_URL`, `npm run dev` usa una base PGlite local en `.data/pglite`: no hace falta Docker ni Postgres.
Para crear tu usuario, abrí `/registro` e ingresá el código de invitación.

Variables (ver `.env.example`):

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Conexión a Postgres. Vacía = PGlite local. |
| `INVITE_CODE` | Código para registrarse. Vacío = registro deshabilitado. |
| `APP_URL` | URL pública sin barra final; es el issuer de OAuth y la base del MCP. Obligatoria en producción. |
| `TRUSTED_PROXY_HOPS` | Cantidad de proxies delante de la app (para obtener la IP real del cliente). |
| `NOTAS_DISABLE_MAINTENANCE` | `1` = no programar la limpieza diaria. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Claves para las notificaciones push (`node scripts/generate-vapid.mjs --env`) y contacto (`mailto:` o `https:`). Vacías = sin notificaciones. |

## Tests

```bash
npm test          # Vitest (usa PGlite)
npm run e2e       # Playwright (levanta su propio servidor y base)
npm run lint
npm run typecheck
```

## Desplegar tu propia instancia

La carpeta [`deploy/`](deploy) trae lo necesario para un VPS con Docker Compose y un reverse proxy:

- `docker-compose.yml`: la app (build standalone) y PostgreSQL 16. La app escucha en `127.0.0.1:3200`.
- `.env.production.example`: plantilla de `~/notas/.env` en el servidor (`POSTGRES_PASSWORD`, `INVITE_CODE`, `APP_URL`, `TRUSTED_PROXY_HOPS` y opcionalmente `VAPID_*`).
- `notas.caddy`: sitio de Caddy de ejemplo (cambiá `notas.example.com` por tu dominio); HTTPS automático y sin buffer para el SSE del MCP.
- `deploy.sh`: sube el commit actual por SSH, construye en el servidor, verifica `/api/health` y vuelve a la versión anterior si falla.
- `backup.sh` y `restore.md`: backups diarios con retención y cómo restaurar.

Pasos resumidos:

1. En el VPS, crear `~/notas/.env` a partir de `deploy/.env.production.example` y apuntar tu dominio a la IP.
2. Configurar el proxy hacia `127.0.0.1:3200` (por ejemplo, con `deploy/notas.caddy`).
3. En tu máquina, indicar el destino y desplegar desde un `master` limpio:

   ```bash
   export NOTAS_DEPLOY_HOST=usuario@mi-vps     # o guardarlo en deploy/.deploy.env (ignorado por git)
   bash deploy/deploy.sh
   ```

El diseño y cada paso en detalle están en [`docs/superpowers/plans/2026-10-10-notas-5-despliegue.md`](docs/superpowers/plans/2026-10-10-notas-5-despliegue.md);
el estado general, en [`docs/PROGRESO.md`](docs/PROGRESO.md).

## Conectar IAs

La URL del servidor MCP es `https://tu-dominio/mcp` (Streamable HTTP).

- **Claude:** Configuración → Conectores → Agregar conector personalizado → pegá la URL e iniciá sesión (OAuth).
- **ChatGPT:** Configuración → Apps y conectores → Configuración avanzada → activar el modo desarrollador → crear un conector con la URL.
- **Claude Code:**

  ```bash
  claude mcp add --transport http --scope user notas https://tu-dominio/mcp
  ```

- **Cursor y otros clientes (token personal):** creá un token en Configuración → "Conexión con IA" y enviálo en la cabecera `Authorization`:

  ```bash
  claude mcp add --transport http --scope user notas https://tu-dominio/mcp --header "Authorization: Bearer ntk_…"
  ```

Herramientas expuestas: contexto de fecha, listas, etiquetas, búsqueda y listado de tareas, crear/editar/completar/mover/borrar/restaurar tareas, subtareas y miembros de listas compartidas.

## Seguridad

- Registro **solo por invitación** (`INVITE_CODE`); sin código configurado, el registro está cerrado.
- Contraseñas con bcrypt; las sesiones y los tokens (personales y OAuth) se guardan **hasheados**.
- OAuth 2.1 con PKCE S256, validación de `resource` y rotación de refresh tokens.
- Límites de frecuencia en login/registro y OAuth; los puertos de la app y de Postgres se publican solo en `127.0.0.1`.

## Licencia

[MIT](LICENSE) © 2026 Emir Maestu
