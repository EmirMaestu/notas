# Notas — Clon de TickTick con servidor MCP (v1)

Fecha: 2026-10-08
Dominio: `notas.example.com` (VPS Ubuntu/Debian con Docker)

## Objetivo

Gestor de tareas web, auto-hospedado, con la experiencia de TickTick y un servidor MCP
propio para que cualquier IA (Claude, ChatGPT, Cursor, Claude Code, n8n…) lea y modifique
las tareas sin depender de un plan pago de TickTick.

## Alcance v1

Incluye:
- Multiusuario: cada usuario con su cuenta y datos aislados.
- Listas (con Bandeja fija por usuario) agrupables en carpetas.
- Tareas: título, descripción, fecha (con hora opcional), prioridad, etiquetas, subtareas (checklist).
- Vistas: Bandeja, Hoy, Próximos 7 días, Completadas, por lista, por etiqueta.
- Agregado rápido con parsing en lenguaje natural (español): `Comprar pan mañana !alta #casa`.
- Papelera de 30 días para tareas borradas.
- Servidor MCP (Streamable HTTP) con OAuth 2.1 y tokens personales.
- Migración única desde TickTick.
- Tema claro/oscuro, responsive (móvil en una columna).

Fuera de v1 (el modelo de datos no debe impedirlos): recurrencia, recordatorios/notificaciones,
calendario, kanban, hábitos, pomodoro, listas compartidas, apps nativas.

## Arquitectura

Una única app **Next.js (App Router, TypeScript)** que contiene la UI, la API interna
(server actions / route handlers) y el endpoint MCP en `/mcp`.

- Base de datos: **PostgreSQL 16** vía **Drizzle ORM** (migraciones versionadas).
- Autenticación web: **sesiones propias** en la tabla `sessions` (cookie httpOnly con token
  aleatorio, guardado hasheado) y contraseñas con bcrypt. Registro solo con código de invitación
  (`INVITE_CODE`). Se descartó Auth.js al planificar la web (ver Plan 2).
- Capa de dominio: módulo `src/core/` con funciones puras de negocio
  (`createTask(userId, input)`, `listTasks(userId, filter)`, …). La UI y el MCP llaman a esta
  misma capa; ninguna accede a la base directamente. Toda función recibe `userId` y filtra por él.
- Zona horaria por usuario (default `America/Argentina/Buenos_Aires`); "Hoy" y "7 días" se
  calculan en esa zona.

### Modelo de datos

- `users` (id, email, password_hash, name, timezone, created_at)
- `folders` (id, user_id, name, sort_order)
- `lists` (id, user_id, folder_id?, name, color, sort_order, is_inbox)
- `tasks` (id, user_id, list_id, title, description, due_date, due_time?, priority
  [0 ninguna, 1 baja, 3 media, 5 alta], status [pending|completed], completed_at,
  sort_order, deleted_at, created_at, updated_at, external_id?)
- `subtasks` (id, task_id, title, done, sort_order)
- `tags` (id, user_id, name, color) · `task_tags` (task_id, tag_id)
- `api_tokens` (id, user_id, name, token_hash, last_used_at, created_at, revoked_at)
- Tablas OAuth: `oauth_clients`, `oauth_codes`, `oauth_tokens` (tokens guardados hasheados)

`external_id` guarda el id de TickTick para que la migración sea idempotente.
Las tareas con `deleted_at` > 30 días se purgan con un job diario.

## Interfaz

Layout de 3 columnas como TickTick:
1. Barra lateral: vistas inteligentes, carpetas/listas, etiquetas, configuración.
2. Lista de tareas de la vista activa, con input de agregado rápido arriba; check para completar.
3. Panel de detalle de la tarea seleccionada (edición en línea, subtareas).

En móvil: una columna, barra lateral como drawer, detalle como pantalla completa.
Configuración: perfil, zona horaria, tokens de API (crear/revocar), conexiones OAuth activas.

## Servidor MCP

- Endpoint: `https://notas.example.com/mcp`, transporte Streamable HTTP, SDK oficial
  `@modelcontextprotocol/sdk`.
- Autenticación (Bearer):
  - **OAuth 2.1** según la spec de autorización de MCP: PKCE obligatorio, Dynamic Client
    Registration, `/.well-known/oauth-protected-resource` y
    `/.well-known/oauth-authorization-server`, pantalla de consentimiento tras login.
  - **Tokens personales** generados desde Configuración (prefijo `ntk_`, se muestran una sola vez).
- Herramientas:
  - `list_lists`, `create_list`, `update_list`, `delete_list`
  - `list_tasks` (filtros: list_id, view = inbox|today|next7|completed, tag, include_completed)
  - `search_tasks`, `get_task`
  - `create_task`, `update_task` (incluye subtareas y etiquetas por nombre)
  - `complete_task`, `uncomplete_task`, `move_task`
  - `delete_task` (a papelera)
  - `list_tags`, `create_tag`
- Fechas en ISO (`YYYY-MM-DD` y `HH:mm`) interpretadas en la zona del usuario; las
  descripciones de las herramientas lo indican explícitamente.
- Errores: mensajes claros devueltos como error de herramienta (`isError: true`) para que el
  modelo pueda corregir; token inválido/expirado → HTTP 401 con `WWW-Authenticate` apuntando
  a los metadatos del recurso.

## Despliegue

En la VPS, carpeta `~/notas/` con `docker-compose.yml`:
- `app`: imagen Next.js standalone; al arrancar corre migraciones de Drizzle.
- `db`: `postgres:16`, volumen persistente, sin puerto expuesto al exterior.
- `caddy`: reverse proxy con HTTPS automático (Let's Encrypt) para `notas.example.com`.

Antes de desplegar se inspecciona la VPS (servicios y puertos 80/443 en uso); si ya hay un
proxy, se integra con él en lugar de agregar Caddy.

Backups: cron diario con `pg_dump` comprimido, retención 14 días en `~/notas/backups/`.
Actualización: `git pull && docker compose up -d --build`.
Secretos (`AUTH_SECRET`, credenciales de Postgres) en `.env` fuera del repo.

## Migración desde TickTick

1. Leer vía el MCP de TickTick conectado: carpetas, listas, etiquetas, tareas pendientes,
   completadas recientes y subtareas.
2. Guardar a `ticktick-export.json` (sirve también de respaldo).
3. Script `scripts/import-ticktick.ts --user <email> --file ticktick-export.json`, idempotente
   por `external_id`.
4. Verificación: comparar totales por lista entre origen y destino.

Mapeo de prioridad: TickTick usa 0/1/3/5, igual que este modelo.

## Listas compartidas (agregado 2026-10-08)

Pedido por el usuario después del Plan 2. Modelo inspirado en TickTick:

- La unidad que se comparte es la **lista**. La Bandeja nunca se comparte.
- El **dueño** agrega miembros por email de un usuario ya registrado (sin invitaciones pendientes
  ni emails). Tabla `list_members (list_id, user_id, added_at)`, PK compuesta.
- **Miembros**: ven, crean, editan, completan, mueven (entre listas a las que tienen acceso),
  mandan a la papelera y restauran tareas de la lista; administran subtareas.
  **Solo el dueño**: renombrar/colorear/borrar la lista, agregar/quitar miembros. Un miembro puede
  **salir** de la lista. La carpeta (`folder_id`) es del dueño; para el miembro la lista aparece
  suelta en una sección "Compartidas conmigo".
- **Acceso a tareas**: un usuario accede a una tarea si es dueño de su lista o miembro de ella.
  `tasks.user_id` pasa a significar "creada por" (se mantiene para auditoría y para el import).
  Toda la capa `core` deja de filtrar tareas por `tasks.user_id` y filtra por listas accesibles.
- **Asignación**: `tasks.assignee_id` (nullable, FK users, `on delete set null`). Solo se puede
  asignar al dueño o a un miembro de la lista. Al mover la tarea a otra lista donde el asignado no
  tiene acceso, o al quitar a un miembro, sus asignaciones en esa lista se limpian.
- **Vistas**: Hoy / 7 días incluyen todas las tareas de listas propias y, de listas compartidas
  conmigo, solo las asignadas a mí. Nueva vista **"Asignadas a mí"**. Las vistas de lista
  muestran todo. Completadas y Papelera: tareas de listas accesibles.
- **Etiquetas**: siguen siendo por usuario. En una tarea compartida se ven todas sus etiquetas;
  al editar etiquetas, un usuario solo agrega/quita las suyas (no borra las de otros). La vista
  por etiqueta y la barra lateral muestran solo las etiquetas propias.
- **UI**: en el diálogo de lista, sección "Miembros" (dueño: agregar por email / quitar;
  miembro: ver y "Salir de la lista"). En el detalle de tarea, selector "Asignada a". En la lista,
  avatar con iniciales del asignado.
- **MCP**: herramientas `share_list`, `unshare_list`, `list_members`, `leave_list` y el campo
  `assignee` (email) en `create_task`/`update_task`, y vista `assigned` en `list_tasks`.

## Pruebas

- Unitarias (Vitest): capa `core` (aislamiento por usuario, vistas Hoy/7 días con zona
  horaria, papelera, parser de agregado rápido).
- Integración: herramientas MCP contra una base Postgres de prueba, incluido que un token no
  acceda a datos de otro usuario; flujo OAuth (registro → autorización → token → llamada).
- E2E (Playwright): login, crear/completar/borrar tarea, crear token.
- Validación final: conectar Claude al MCP desplegado y operar sobre una tarea real.
