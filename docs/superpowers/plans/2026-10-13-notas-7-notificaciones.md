# Notas — Plan 7: Notificaciones push (recordatorios, resumen diario y asignaciones)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Notas avise en el celular y en la compu con notificaciones Web Push: un recordatorio por persona y por tarea (minutos antes de la hora, o el mismo día / el día anterior a una hora fija para tareas sin hora), un resumen diario opcional («3 para hoy · 2 vencidas») y un aviso cuando alguien te asigna una tarea; todo configurable desde Configuración → «Notificaciones», desde el detalle de la tarea («Recordatorio») y por MCP (`reminder` en `create_task` / `update_task`).

**Architecture:** Cuatro piezas nuevas en la base (columnas de preferencias en `users`, `task_reminders`, `push_subscriptions`, `notification_deliveries`). Un módulo **puro** (`src/core/reminder-options.ts`) define las opciones de recordatorio, sus etiquetas y el cálculo del instante en que suenan en la zona horaria del usuario (con DST, sin librerías). El núcleo guarda el recordatorio **del usuario que consulta** junto con la tarea (`TaskWithDetails.reminder`, como las etiquetas propias) y aplica el recordatorio por defecto al crear una tarea con hora. Un motor (`src/core/notifications.ts`) arma y manda los avisos con una función `send` **inyectable** y un `now` explícito: recordatorios con instante en `(now − 10 min, now]`, resumen diario a la hora local del usuario y avisos de asignación; antes de mandar «reclama» la entrega con un `INSERT … ON CONFLICT DO NOTHING` sobre `(user_id, kind, fire_key)`, así que reiniciar el proceso o correr dos ticks nunca duplica. El envío real vive en `src/lib/push.ts` (envoltorio de `web-push` configurado con `VAPID_*`; sin claves devuelve `null` y todo queda apagado sin errores). Un programador en el proceso (`src/lib/notification-scheduler.ts`, cada 60 s, `unref`, sin solapamiento) se arranca desde `startServer` igual que el mantenimiento. En el navegador, `public/sw.js` muestra la notificación y al tocarla enfoca/abre la tarea; el service worker se registra **solo** cuando el usuario activa las notificaciones con un clic.

**Tech Stack:** Next.js 15.5.27 (App Router, server actions, `after()` de `next/server`), React 19.1, Tailwind 4, Drizzle ORM 0.45.4 + Postgres/PGlite, Vitest 3, Playwright 1.64, **`web-push` 3.6.7** (nueva dependencia) + **`@types/web-push` 3.6.4** (dev), lucide-react (`Bell`, `BellOff`, `BellRing`, `Send`).

**Spec:** `docs/superpowers/specs/2026-10-08-notas-design.md` + la sección «Notificaciones (agregado 2026-10-13)» que agrega la Task 14 (texto completo en ese paso).

## Investigación (2026-10-13)

- **`web-push` 3.6.7** (última en npm; MPL-2.0; Node ≥ 16; deps `http_ece`, `jws`, `asn1.js`, `https-proxy-agent`, `minimist`) — <https://registry.npmjs.org/web-push/latest>, README en <https://github.com/web-push-libs/web-push>.
  - `webpush.setVapidDetails(subject, publicKey, privateKey)` fija las claves de forma **global**; `subject` tiene que ser `mailto:` o `https:` (el README desaconseja `mailto:…@localhost`). Alternativa sin estado global: pasar `vapidDetails: { subject, publicKey, privateKey }` en las opciones de cada envío (la usamos: la configuración se lee del entorno en cada proceso y los tests no comparten estado).
  - `webpush.sendNotification(subscription, payload?, options?)` → `Promise<SendResult>` (`statusCode`, `body`, `headers`). `payload` string o Buffer (requiere `keys.p256dh` y `keys.auth`). Opciones: `TTL` (segundos; **por defecto 4 semanas**, por eso lo bajamos), `urgency` (`very-low` | `low` | `normal` | `high`), `topic` (≤ 32 caracteres base64url; no lo usamos), `timeout` (ms del socket), `headers`, `vapidDetails`, `proxy`, `agent`.
  - Si el servicio de push responde algo que no es 2xx, la promesa se rechaza con **`WebPushError`** (`statusCode`, `headers`, `body`, `endpoint`). **404/410 = suscripción muerta** → se borra. Tipos en `@types/web-push` 3.6.4 (<https://unpkg.com/@types/web-push@3.6.4/index.d.ts>: `WebPushError`, `PushSubscription { endpoint, expirationTime?, keys: { p256dh, auth } }`, `RequestOptions`, `SendResult`, `VapidKeys`, `generateVAPIDKeys(): VapidKeys`).
  - `webpush.generateVAPIDKeys()` → `{ publicKey, privateKey }` (base64url). CLI: `web-push generate-vapid-keys [--json]` imprime `{"publicKey":…,"privateKey":…}`. Generarlas **una sola vez** y reutilizarlas (si cambian, todas las suscripciones existentes dejan de servir).
- **Web Push en iPhone/iPad** — WebKit, «Web Push for Web Apps on iOS and iPadOS» (<https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/>): desde **iOS/iPadOS 16.4**, solo para apps **agregadas a la pantalla de inicio** con manifest `display: standalone` o `fullscreen` (el nuestro ya es `standalone`); el pedido de permiso tiene que ser **respuesta a una interacción directa** (un botón «Activar»); hay que permitir `*.push.apple.com` si se filtran endpoints (no filtramos por host, solo exigimos `https:`). No hace falta cuenta de Apple Developer. Por eso: `Notification.requestPermission()` se llama **primero** dentro del `onClick`, antes de cualquier `await`, y la UI muestra una pista en iPhone cuando la app no está instalada (`display-mode: standalone` / `navigator.standalone`). Reportes de la comunidad (no oficiales) mencionan suscripciones de iOS que dejan de funcionar con el tiempo: el borrado por 404/410 y el botón «Enviar prueba» cubren ese caso.
- **Next.js App Router y PWA** — guía oficial «Progressive Web Apps» (<https://nextjs.org/docs/app/guides/progressive-web-apps>, actualizada 2026-07-30): registra el service worker con `navigator.serviceWorker.register(url, { scope: '/', updateViaCache: 'none' })`, se suscribe con `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })`, guarda la suscripción con una server action y manda con `web-push`. Recomienda para `/sw.js` los headers `Content-Type: application/javascript; charset=utf-8` y `Cache-Control: no-cache, no-store, must-revalidate` vía `headers()` de `next.config` (los `headers()` también se aplican a archivos de `public/`). Un archivo en `public/sw.js` se sirve en `/sw.js`, en la raíz, así que el scope `/` es el máximo permitido por defecto: **no hace falta `Service-Worker-Allowed`** (solo se necesita para un scope más amplio que la carpeta del script). Con `updateViaCache: 'none'` + `no-cache` el navegador siempre revalida `sw.js` (Next 15 no le pone caché larga a `public/`, pero lo dejamos explícito). La guía usa `NEXT_PUBLIC_VAPID_PUBLIC_KEY`; acá **no**: la imagen Docker se construye sin secretos, así que la clave pública se lee en el servidor en cada request y la página de Configuración se la pasa al componente cliente como prop.
- **Clic en la notificación** — MDN `notificationclick` / `Clients.matchAll` / `WindowClient.focus()` / `WindowClient.navigate()` / `Clients.openWindow()` (<https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/notificationclick_event>, <https://developer.mozilla.org/en-US/docs/Web/API/Clients/openWindow>): se cierra la notificación, se busca una ventana del mismo origen (`matchAll({ type: 'window', includeUncontrolled: true })`), se enfoca y se navega a la URL de la tarea; `navigate()` lanza si la ventana no está controlada por el SW, y en ese caso se abre una ventana nueva con `openWindow(url)`. Todo dentro de `event.waitUntil(...)`.
- **Código actual relevante** (rama `feat/listas-por-carpeta`, que se mergea antes de empezar):
  - Acceso: una persona accede a una tarea si es dueña o miembro de su lista (`accessibleListIds`, `canAccessList` en `src/core/access.ts`); quitar un miembro (`dropMembership`) limpia sus asignaciones pero no toca nada más.
  - `hydrate()` en `src/core/tasks.ts` ya arma datos por persona (`tags` propias vs `otherTags`): el recordatorio del que consulta entra igual. `TaskWithDetails` se usa en la web y en `formatTask` del MCP; `tests/mcp/tools-tasks.test.ts` fija las claves en `TASK_KEYS` (hay que sumar `reminder`).
  - `tests/core/schema.test.ts` fija la lista de tablas (hay que sumar las 3 nuevas). `tests/lib/maintenance.test.ts` fija el `MaintenanceReport` (se suma `deliveries`).
  - Fechas: `todayIn`, `addDays`, `isValidTime` en `src/core/dates.ts` (puro). Zona por defecto `America/Argentina/Buenos_Aires` (UTC−3, sin DST).
  - Mantenimiento: `scheduleMaintenance` (`unref`, sin solapamiento) y `startServer` con marca en `globalThis` (`MAINTENANCE_FLAG`) y `maintenanceEnabled(env)` (apagado con `NODE_ENV=test` o `NOTAS_DISABLE_MAINTENANCE=1`, que los e2e ya ponen).
  - Server actions con `act()` (`requireUser` + `revalidatePath('/app', 'layout')`); límites de frecuencia en memoria (`createRateLimiter`, una sola instancia).
  - `next.config.ts` pone `X-Frame-Options: DENY` y `Content-Security-Policy: frame-ancestors 'none'` a todo; no hay middleware. El `Dockerfile` copia `public/` a la imagen. `deploy/deploy.sh` corre `docker compose --env-file ~/notas/.env … up -d` en cada despliegue: **una variable nueva en `~/notas/.env` entra en el próximo deploy** (o con un `up -d` a mano).
  - `sharp` está disponible en `node_modules` (dependencia opcional de Next) y `scripts/generate-icons.mjs` ya lo usa: sirve para generar el ícono monocromo de la notificación (`badge`).
- **Windows**: `npx vitest` y `npm run e2e` desde PowerShell (en Git Bash falla esbuild), según `docs/PROGRESO.md`.

## Decisiones tomadas al planificar (resuelven ambigüedades)

1. **Opciones de recordatorio** (las mismas en la web, el núcleo y el MCP): `at_time` (a la hora), `5m`, `15m`, `30m`, `1h`, `1d` (minutos antes de la fecha+hora; para tareas **con hora**) y `same_day` / `day_before` (a la «hora de los recordatorios sin hora» del usuario, por defecto 09:00, el mismo día o el anterior; pensadas para tareas **sin hora**). En la base: `task_reminders.kind` (`'before' | 'same_day' | 'day_before'`) + `offset_minutes` (solo con `before`, ∈ {0, 5, 15, 30, 60, 1440}; `NULL` en los otros), con un `CHECK`.
2. **Una fila por persona y tarea** (PK `(task_id, user_id)`): cada miembro de una lista compartida pone su propio recordatorio; nadie ve ni toca el de otro. Se guarda con la tarea (`createTask`/`updateTask` aceptan `reminder`), así la web y el MCP usan el mismo camino y la misma validación de acceso (la de la tarea).
3. **Validación**: `reminder` sin fecha en la tarea → error «Para poner un recordatorio la tarea necesita fecha»; una opción «antes» sin hora → error que sugiere `same_day`/`day_before`. `same_day`/`day_before` se aceptan también en tareas con hora (el aviso sale a la hora fija de la mañana).
4. **Si la tarea cambia después** (se le saca la hora, se le cambia la fecha): el recordatorio se conserva y el instante se recalcula. Una opción «antes» en una tarea sin hora suena **el mismo día a la hora de los recordatorios sin hora**; sin fecha, no suena. La web muestra igual la opción guardada aunque no corresponda al tipo de tarea (no se pierde en silencio).
5. **Recordatorio por defecto** (preferencia `reminder_default_minutes`: ninguno, a la hora, 15 min o 1 h antes): se **materializa** como fila cuando quien crea la tarea le pone hora (al crearla con hora, o al pasar de «sin hora» a «con hora» en `updateTask`) y no mandó un `reminder` explícito; nunca pisa uno existente (`ON CONFLICT DO NOTHING`). Así se ve y se puede cambiar en el detalle, como en TickTick. No hay recordatorio por defecto para tareas sin hora (no se pidió).
6. **Ventana del programador**: cada 60 s se mandan los recordatorios con instante en `(now − 10 min, now]`. Si el proceso estuvo caído más de 10 min, los vencidos se **saltean** (mejor que una ráfaga de avisos viejos). Además se ignora un recordatorio cuyo instante es **anterior a cuando se guardó** (`task_reminders.updated_at`): poner «15 min antes» a una tarea que vence en 5 min no dispara un aviso atrasado.
7. **Idempotencia «a lo sumo una vez»**: antes de mandar se inserta la entrega en `notification_deliveries` con `UNIQUE (user_id, kind, fire_key)` (`ON CONFLICT DO NOTHING RETURNING`); solo quien la inserta manda. `fire_key`: recordatorio = `<task_id>:<instante ISO>` (si cambia la fecha/hora suena de nuevo para el nuevo instante), resumen = fecha local `YYYY-MM-DD`, asignación y prueba = `<task_id|test>:<now ISO>`. Si el proceso muere entre el insert y el envío, ese aviso se pierde (preferible a duplicar). Las entregas de más de 30 días se borran en el mantenimiento diario.
8. **Acceso al momento de mandar**: el programador revalida que la persona **todavía** accede a la lista de la tarea (`canAccessList`); si la sacaron de la lista compartida, su recordatorio no suena (la fila queda inerte y se borra en cascada con la tarea). Solo tareas **pendientes** y **no borradas**.
9. **Resumen diario** (`digest_enabled`, `digest_time`, por defecto apagado / 08:00): se manda una vez por día local cuando la hora local está en `[digest_time, digest_time + 10 min)`; cuenta lo mismo que la vista «Hoy» (`listTasks` con `view: 'today'`: propias + asignadas a mí de listas compartidas) separando vencidas. Solo si hay algo (> 0). Cerca de medianoche la ventana no da la vuelta (un resumen a las 23:55 tiene 5 min de ventana).
10. **Aviso de asignación** (`notify_assigned`, por defecto prendido): cuando `assignee_id` pasa a ser **otra** persona (web: `updateTaskAction`; MCP: `create_task` con `assignee_email` y `update_task` con `assignee_email`), si esa persona tiene la preferencia prendida y acceso a la lista. Texto: «Emir te asignó «Comprar pan»». En la web se manda después de responder (`after()` de `next/server`); en el MCP se espera (es raro y deja los tests deterministas). Errores de envío: solo log.
11. **Suscripciones**: `endpoint` único (si el mismo navegador se suscribe con otra cuenta, pasa a la cuenta nueva), `https:` obligatorio, ≤ 2048 caracteres, claves base64url acotadas (`p256dh` ≤ 200, `auth` ≤ 100), `user_agent` recortado a 300. **Máximo 10 por usuario**: al pasarse se borra la más vieja. 404/410 → se borra; otro error → `failure_count + 1` y se borra al llegar a 10 fallos seguidos; éxito → `last_success_at` y `failure_count = 0`.
12. **Contenido del aviso**: `{ title, body, url, tag }` en JSON; título = título de la tarea (recortado a 120), cuerpo corto («Hoy a las 15:00», «Vence mañana»…), `url` relativa (`/app/list/<lista>?t=<tarea>` para recordatorios —funciona para dueño y miembro—, `/app/today` para el resumen, `/app/assigned?t=<tarea>` para asignaciones, `/app/settings` para la prueba), `tag` para que un aviso nuevo de la misma tarea reemplace al anterior. `TTL` 1 h (un recordatorio de hace horas ya no sirve), `urgency: 'high'`, `timeout` 10 s.
13. **Sin VAPID configurado** (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; las tres, `subject` `mailto:` o `https:`): `getPushSender()` devuelve `null`, el programador no se arranca (log una vez), «Enviar prueba» explica que no está configurado, y la tarjeta de Configuración muestra el botón deshabilitado con la explicación. **Recordatorios y preferencias igual se guardan** (web y MCP), así quedan listos cuando se configure.
14. **Clave pública**: se lee en el servidor (`vapidPublicKey()`) y se pasa como prop; nunca `NEXT_PUBLIC_*` (se hornearía en el build). `VAPID_SUBJECT` en producción = `https://notas.emir-maestu.com` (válido según el README y no publica un email).
15. **Service worker mínimo**: sin caché offline ni `fetch` handler (no se pidió y no queremos servir HTML viejo). `install` → `skipWaiting()`, `activate` → `clients.claim()`, `push`, `notificationclick`. Se registra solo al activar; si ya estaba registrado, la tarjeta lo detecta con `getRegistration('/')`.
16. **Ícono**: `icon` = `/icons/icon-192.png`; `badge` = nuevo `/icons/badge-96.png` (tilde blanco sobre transparente, generado con `sharp` desde el mismo trazo de `icon-simple.svg`): Android pinta el badge como silueta monocroma, el ícono a color se vería como un cuadrado blanco.
17. **MCP**: `reminder` en `create_task` y `update_task` (enum de las 8 opciones o `null` para quitarlo) **para quien llama**; la salida de las tareas suma `reminder` (el de quien llama, o `null`). No se agregan herramientas de suscripción ni de preferencias (eso es por dispositivo, desde la web).
18. **Rutas URL relativas en el payload**: el SW las resuelve contra su propio origen (`new URL(url, self.location.origin)`), así una URL ajena nunca se abre.
19. **Dónde vive cada cosa**: lo que toca la base y no depende de `web-push` va en `src/core/` (testeable con PGlite y un `send` falso); lo que habla con `web-push`, el entorno y los timers va en `src/lib/`. `src/core/reminder-options.ts` es puro y lo importa también el cliente (el detalle de tarea).

## Estructura de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `package.json`, `package-lock.json` | Modificar | `web-push` 3.6.7, `@types/web-push` 3.6.4 |
| `src/core/reminder-options.ts` | Crear | Opciones, etiquetas, parseo/validación, `zonedTimeToUtc`, `reminderFireAt` (puro) |
| `src/db/schema.ts` | Modificar | Preferencias en `users`; tablas `task_reminders`, `push_subscriptions`, `notification_deliveries` |
| `drizzle/0007_<nombre>.sql` (+ `meta/`) | Generar | Migración aditiva |
| `src/core/reminders.ts` | Crear | Leer/escribir recordatorios por persona, aplicar el por defecto |
| `src/core/tasks.ts` | Modificar | `reminder` en `TaskWithDetails`, `CreateTaskInput`, `UpdateTaskInput` |
| `src/core/notification-prefs.ts` | Crear | Preferencias: lectura, validación, guardado |
| `src/core/push-subscriptions.ts` | Crear | Alta/baja/listado de suscripciones, validación, tope, éxito/fallo |
| `src/core/notifications.ts` | Crear | Motor: entregas, envío a todos los dispositivos, recordatorios, resumen, asignación, prueba, purga |
| `src/core/index.ts` | Modificar | Exporta los módulos nuevos |
| `src/lib/push.ts` | Crear | Configuración VAPID y envío con `web-push` (`SendPush`) |
| `src/lib/notification-scheduler.ts` | Crear | Tick cada 60 s (`unref`, sin solapamiento) |
| `src/lib/notify.ts` | Crear | `notifyAssignmentSafely` (para acciones y MCP) |
| `src/lib/maintenance.ts` | Modificar | Purga de entregas viejas en la limpieza diaria |
| `src/lib/startup.ts` | Modificar | Arranca el programador de notificaciones si hay VAPID |
| `src/app/app/actions.ts` | Modificar | `reminder` en `updateTaskAction`, aviso de asignación, acciones de suscripción/preferencias/prueba |
| `src/mcp/tools.ts`, `src/mcp/format.ts` | Modificar | `reminder` en entrada y salida; aviso de asignación |
| `public/sw.js` | Crear | Service worker: `push` y `notificationclick` |
| `public/icons/badge-96.png`, `scripts/generate-icons.mjs` | Crear / modificar | Ícono monocromo de la notificación |
| `next.config.ts` | Modificar | Headers de `/sw.js`; `web-push` como paquete externo del servidor |
| `src/components/push-device.tsx` | Crear | Activar/desactivar en este dispositivo, prueba, pista de iPhone |
| `src/components/notification-prefs-form.tsx` | Crear | Formulario de preferencias (guarda al cambiar) |
| `src/app/app/settings/page.tsx` | Modificar | Sección «Notificaciones» |
| `src/components/task-detail.tsx` | Modificar | Píldora «Recordatorio» |
| `deploy/docker-compose.yml`, `deploy/.env.production.example`, `.env.example` | Modificar | `VAPID_*` opcionales |
| `scripts/generate-vapid.mjs` | Crear | Imprime un par de claves VAPID |
| `tests/core/reminder-options.test.ts`, `tests/core/schema.test.ts`, `tests/core/reminders.test.ts`, `tests/core/notification-prefs.test.ts`, `tests/core/push-subscriptions.test.ts`, `tests/core/notifications.test.ts`, `tests/lib/push.test.ts`, `tests/lib/notification-scheduler.test.ts`, `tests/lib/startup.test.ts`, `tests/lib/maintenance.test.ts`, `tests/mcp/tools-tasks.test.ts`, `tests/mcp/tools-reminders.test.ts`, `tests/helpers/push.ts` | Crear / modificar | TDD |
| `e2e/notificaciones.spec.ts` | Crear | Configuración muestra «Notificaciones», preferencias y recordatorio persisten, `/sw.js` sin caché |
| `docs/superpowers/specs/2026-10-08-notas-design.md`, `docs/PROGRESO.md`, `README.md` | Modificar | Spec, estado y variables nuevas |

## Cómo verificar cada task (referencia)

- **Tipos y lint** (PowerShell o Git Bash): `npx tsc --noEmit` → sin salida; `npm run lint` → sin errores ni warnings.
- **Tests** (PowerShell): `npx vitest run <archivo>`; la suite completa con `npx vitest run`.
- **Chequeo visual** (Tasks 11 y 12): en PowerShell `npm run dev` (PGlite; `.env.local` ya tiene `INVITE_CODE=dev`; usuario `prueba@example.com` / `contraseña-segura`). Abrir `http://localhost:3000/app/settings` en el panel del navegador (`mcp__Claude_Browser__preview_start` con `url`; `resize_window` `width: 1200, height: 820` y `preset: "mobile"`; `colorScheme` `light`/`dark`; `computer` → `screenshot`). Guardar capturas en el scratchpad como `t<n>-<pantalla>-<ancho>-<tema>.png`. Al terminar, `resize_window` con `preset: "desktop"`. Para probar el push de verdad en local hacen falta claves: `node scripts/generate-vapid.mjs --env` y pegar las tres líneas (más `VAPID_SUBJECT=mailto:dev@example.com`) en `.env.local`; Chrome acepta push en `http://localhost`.
- **Commits**: uno por task, en español con prefijo convencional, terminando con la línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. En PowerShell usar here-string de comillas simples (`git commit -m @'` … `'@`, con `'@` en la columna 0).
- **Rama**: todo en `feat/notificaciones`. Nunca push a `master`; el plan termina abriendo el PR (el controlador mergea).
- **Regla para las tasks de UI**: se agregan piezas sin tocar la lógica existente del detalle (`commitDate`, `commitTime`, `useSyncedField`, etc.). Si al pegar el código algún comportamiento existente desaparece, es un error del plan: conservarlo.

---

### Task 0: Rama y dependencia `web-push`

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Partir de `master` actualizado**

Run (PowerShell):

```powershell
git checkout master
git pull --ff-only
git log --oneline -3   # tiene que aparecer «feat: listas con el mismo nombre se distinguen por carpeta» (o su merge)
git checkout -b feat/notificaciones
```

Expected: `Switched to a new branch 'feat/notificaciones'`. Si `master` todavía no tiene el commit de listas por carpeta, parar y avisar al controlador (este plan se escribió sobre ese código).

- [ ] **Step 2: Instalar**

```powershell
npm install --save-exact web-push@3.6.7
npm install --save-dev --save-exact @types/web-push@3.6.4
```

Expected: `package.json` gana `"web-push": "3.6.7"` en `dependencies` y `"@types/web-push": "3.6.4"` en `devDependencies`. `web-push` no tiene dependencias nativas, así que el lockfile instala igual en Linux (el CI lo confirma con `npm ci`).

- [ ] **Step 3: Comprobar que carga**

Run: `node -e "const w=require('web-push'); const k=w.generateVAPIDKeys(); console.log(typeof w.sendNotification, k.publicKey.length > 80, k.privateKey.length > 40)"`
Expected: `function true true`

- [ ] **Step 4: Commit**

```powershell
git add package.json package-lock.json
git commit -m @'
chore: dependencia web-push para notificaciones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 1: Opciones de recordatorio e instante en que suenan (puro, TDD)

**Files:**
- Create: `src/core/reminder-options.ts`, `tests/core/reminder-options.test.ts`

- [ ] **Step 1: Tests que fallan**

`tests/core/reminder-options.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/core/errors';
import {
  ALL_DAY_OPTIONS, BEFORE_OPTIONS, REMINDER_OPTIONS, checkReminderFits, fromStored, optionForMinutes,
  parseReminderOption, reminderFireAt, reminderLabel, reminderOptionsFor, toStored, zonedTimeToUtc,
} from '@/core/reminder-options';

const BA = 'America/Argentina/Buenos_Aires';
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe('zonedTimeToUtc', () => {
  it('Buenos Aires es UTC−3 todo el año (sin horario de verano)', () => {
    expect(iso(zonedTimeToUtc('2026-10-20', '09:30', BA))).toBe('2026-10-20T12:30:00.000Z');
    expect(iso(zonedTimeToUtc('2026-01-15', '23:45', BA))).toBe('2026-01-16T02:45:00.000Z');
  });

  it('respeta el horario de verano de Madrid (CET/CEST)', () => {
    expect(iso(zonedTimeToUtc('2026-01-15', '10:00', 'Europe/Madrid'))).toBe('2026-01-15T09:00:00.000Z');
    expect(iso(zonedTimeToUtc('2026-07-01', '10:00', 'Europe/Madrid'))).toBe('2026-07-01T08:00:00.000Z');
    // 29/03/2026: a las 02:00 se pasa a las 03:00.
    expect(iso(zonedTimeToUtc('2026-03-29', '03:30', 'Europe/Madrid'))).toBe('2026-03-29T01:30:00.000Z');
  });

  it('respeta el fin del horario de verano de Nueva York', () => {
    expect(iso(zonedTimeToUtc('2026-10-31', '12:00', 'America/New_York'))).toBe('2026-10-31T16:00:00.000Z');
    expect(iso(zonedTimeToUtc('2026-11-01', '12:00', 'America/New_York'))).toBe('2026-11-01T17:00:00.000Z');
  });

  it('UTC no se corre', () => {
    expect(iso(zonedTimeToUtc('2026-05-05', '00:00', 'UTC'))).toBe('2026-05-05T00:00:00.000Z');
  });
});

describe('reminderFireAt', () => {
  const timed = { dueDate: '2026-10-20', dueTime: '15:00' };
  const allDay = { dueDate: '2026-10-20', dueTime: null };

  it('tareas con hora: minutos antes de la fecha y hora', () => {
    expect(iso(reminderFireAt(timed, 'at_time', BA))).toBe('2026-10-20T18:00:00.000Z');
    expect(iso(reminderFireAt(timed, '5m', BA))).toBe('2026-10-20T17:55:00.000Z');
    expect(iso(reminderFireAt(timed, '15m', BA))).toBe('2026-10-20T17:45:00.000Z');
    expect(iso(reminderFireAt(timed, '30m', BA))).toBe('2026-10-20T17:30:00.000Z');
    expect(iso(reminderFireAt(timed, '1h', BA))).toBe('2026-10-20T17:00:00.000Z');
    expect(iso(reminderFireAt(timed, '1d', BA))).toBe('2026-10-19T18:00:00.000Z');
  });

  it('tareas sin hora: el mismo día o el anterior a la hora elegida (09:00 por defecto)', () => {
    expect(iso(reminderFireAt(allDay, 'same_day', BA))).toBe('2026-10-20T12:00:00.000Z');
    expect(iso(reminderFireAt(allDay, 'day_before', BA))).toBe('2026-10-19T12:00:00.000Z');
    expect(iso(reminderFireAt(allDay, 'same_day', BA, '07:30'))).toBe('2026-10-20T10:30:00.000Z');
    // El día anterior cruza el cambio de hora de Madrid: cada día con su propio offset.
    const madrid = { dueDate: '2026-03-29', dueTime: null };
    expect(iso(reminderFireAt(madrid, 'same_day', 'Europe/Madrid', '10:00'))).toBe('2026-03-29T08:00:00.000Z');
    expect(iso(reminderFireAt(madrid, 'day_before', 'Europe/Madrid', '10:00'))).toBe('2026-03-28T09:00:00.000Z');
    // El día anterior al 1 de enero es el 31 de diciembre.
    expect(iso(reminderFireAt({ dueDate: '2027-01-01', dueTime: null }, 'day_before', BA))).toBe('2026-12-31T12:00:00.000Z');
  });

  it('una opción «antes» en una tarea a la que le sacaron la hora suena el mismo día a la hora fija', () => {
    expect(iso(reminderFireAt(allDay, '15m', BA, '08:00'))).toBe('2026-10-20T11:00:00.000Z');
  });

  it('same_day / day_before en una tarea con hora usan la hora fija, no la de la tarea', () => {
    expect(iso(reminderFireAt(timed, 'same_day', BA))).toBe('2026-10-20T12:00:00.000Z');
  });

  it('sin fecha no suena', () => {
    expect(reminderFireAt({ dueDate: null, dueTime: null }, 'same_day', BA)).toBeNull();
  });
});

describe('opciones', () => {
  it('ida y vuelta con lo guardado en la base', () => {
    for (const option of REMINDER_OPTIONS) expect(fromStored(toStored(option))).toBe(option);
    expect(toStored('1h')).toEqual({ kind: 'before', offsetMinutes: 60 });
    expect(toStored('day_before')).toEqual({ kind: 'day_before', offsetMinutes: null });
    expect(fromStored({ kind: 'before', offsetMinutes: 7 })).toBeNull();
  });

  it('optionForMinutes traduce el recordatorio por defecto', () => {
    expect(optionForMinutes(0)).toBe('at_time');
    expect(optionForMinutes(15)).toBe('15m');
    expect(optionForMinutes(60)).toBe('1h');
    expect(optionForMinutes(null)).toBeNull();
    expect(optionForMinutes(7)).toBeNull();
  });

  it('parseReminderOption acepta las 8 opciones y null; el resto es ValidationError', () => {
    expect(parseReminderOption('15m')).toBe('15m');
    expect(parseReminderOption(null)).toBeNull();
    expect(() => parseReminderOption('2h')).toThrow(ValidationError);
    expect(() => parseReminderOption(15)).toThrow(/Recordatorio inválido/);
  });

  it('checkReminderFits pide fecha, y hora para las opciones «antes»', () => {
    expect(() => checkReminderFits('same_day', null, null)).toThrow('Para poner un recordatorio la tarea necesita fecha');
    expect(() => checkReminderFits('15m', '2026-10-20', null)).toThrow(/necesita que la tarea tenga hora/);
    expect(() => checkReminderFits('15m', '2026-10-20', '10:00')).not.toThrow();
    expect(() => checkReminderFits('day_before', '2026-10-20', '10:00')).not.toThrow();
    expect(() => checkReminderFits(null, null, null)).not.toThrow();
  });

  it('etiquetas en castellano y opciones según la tarea tenga hora', () => {
    expect(reminderLabel('at_time', '09:00')).toBe('A la hora');
    expect(reminderLabel('1h', '09:00')).toBe('1 hora antes');
    expect(reminderLabel('1d', '09:00')).toBe('1 día antes');
    expect(reminderLabel('same_day', '08:30')).toBe('El mismo día a las 08:30');
    expect(reminderLabel('day_before', '09:00')).toBe('El día anterior a las 09:00');
    expect(reminderOptionsFor(true)).toEqual(BEFORE_OPTIONS);
    expect(reminderOptionsFor(false)).toEqual(ALL_DAY_OPTIONS);
  });
});
```

- [ ] **Step 2: Correrlo y verlo fallar**

Run (PowerShell): `npx vitest run tests/core/reminder-options.test.ts`
Expected: FAIL — `Cannot find module '@/core/reminder-options'` (o similar).

- [ ] **Step 3: Implementar `src/core/reminder-options.ts`**

```ts
/**
 * Recordatorios: opciones, etiquetas, validación y cálculo del instante en que suenan, en la zona horaria del
 * usuario. Módulo puro (sin base): lo usan el núcleo, el programador de notificaciones y la interfaz.
 */
import { addDays } from './dates';
import { ValidationError } from './errors';

/** Minutos antes de la fecha y hora de la tarea (para tareas con hora). */
export const BEFORE_OPTIONS = ['at_time', '5m', '15m', '30m', '1h', '1d'] as const;
/** A la «hora de los recordatorios sin hora» del usuario: el mismo día o el anterior. */
export const ALL_DAY_OPTIONS = ['same_day', 'day_before'] as const;
export const REMINDER_OPTIONS = [...BEFORE_OPTIONS, ...ALL_DAY_OPTIONS] as const;

export type BeforeOption = (typeof BEFORE_OPTIONS)[number];
export type ReminderOption = (typeof REMINDER_OPTIONS)[number];
export type ReminderKind = 'before' | 'same_day' | 'day_before';

export const BEFORE_MINUTES: Record<BeforeOption, number> = {
  at_time: 0, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '1d': 1440,
};

/** Hora por defecto de los recordatorios de tareas sin hora. */
export const DEFAULT_ALL_DAY_TIME = '09:00';

/** Cómo se guarda en `task_reminders`. */
export interface StoredReminder {
  kind: ReminderKind;
  offsetMinutes: number | null;
}

export function isBeforeOption(option: string): option is BeforeOption {
  return (BEFORE_OPTIONS as readonly string[]).includes(option);
}

export function toStored(option: ReminderOption): StoredReminder {
  if (isBeforeOption(option)) return { kind: 'before', offsetMinutes: BEFORE_MINUTES[option] };
  return { kind: option, offsetMinutes: null };
}

/** null si la fila no corresponde a ninguna opción conocida (no debería pasar: hay un CHECK en la base). */
export function fromStored(stored: StoredReminder): ReminderOption | null {
  if (stored.kind === 'before') return optionForMinutes(stored.offsetMinutes);
  return stored.kind === 'same_day' || stored.kind === 'day_before' ? stored.kind : null;
}

/** La opción «antes» con esos minutos (para el recordatorio por defecto), o null. */
export function optionForMinutes(minutes: number | null): BeforeOption | null {
  if (minutes === null) return null;
  return BEFORE_OPTIONS.find((o) => BEFORE_MINUTES[o] === minutes) ?? null;
}

const INVALID = `Recordatorio inválido: usá ${REMINDER_OPTIONS.join(', ')} o null para quitarlo`;

/** Valida un valor que viene de afuera (web o MCP). null = sin recordatorio. */
export function parseReminderOption(value: unknown): ReminderOption | null {
  if (value === null) return null;
  if (typeof value === 'string' && (REMINDER_OPTIONS as readonly string[]).includes(value)) {
    return value as ReminderOption;
  }
  throw new ValidationError(INVALID);
}

/** El recordatorio tiene sentido para la fecha/hora que va a quedar en la tarea. */
export function checkReminderFits(option: ReminderOption | null, dueDate: string | null, dueTime: string | null): void {
  if (option === null) return;
  if (dueDate === null) throw new ValidationError('Para poner un recordatorio la tarea necesita fecha');
  if (isBeforeOption(option) && dueTime === null) {
    throw new ValidationError(
      'Ese recordatorio necesita que la tarea tenga hora; para tareas sin hora usá same_day (el mismo día) o day_before (el día anterior)',
    );
  }
}

const LABELS: Record<BeforeOption, string> = {
  at_time: 'A la hora',
  '5m': '5 minutos antes',
  '15m': '15 minutos antes',
  '30m': '30 minutos antes',
  '1h': '1 hora antes',
  '1d': '1 día antes',
};

export function reminderLabel(option: ReminderOption, allDayTime: string): string {
  if (isBeforeOption(option)) return LABELS[option];
  return option === 'same_day' ? `El mismo día a las ${allDayTime}` : `El día anterior a las ${allDayTime}`;
}

/** Las opciones que ofrece la interfaz según la tarea tenga hora o no. */
export function reminderOptionsFor(hasTime: boolean): readonly ReminderOption[] {
  return hasTime ? BEFORE_OPTIONS : ALL_DAY_OPTIONS;
}

/** Minutos que la zona horaria está adelantada respecto de UTC en ese instante (Buenos Aires: −180). */
function offsetMinutesAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/**
 * Instante (UTC) de una fecha y hora locales en `timeZone`. Dos pasadas: la segunda corrige cuando el offset
 * del primer intento cae del otro lado de un cambio de horario. Una hora que no existe (el salto de primavera)
 * queda corrida al otro lado del salto.
 */
export function zonedTimeToUtc(isoDate: string, time: string, timeZone: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const first = naive - offsetMinutesAt(new Date(naive), timeZone) * 60_000;
  return new Date(naive - offsetMinutesAt(new Date(first), timeZone) * 60_000);
}

/**
 * Cuándo suena el recordatorio, o null si la tarea no tiene fecha.
 * - Opciones «antes» con hora: fecha+hora − minutos. Sin hora (se la sacaron después): el mismo día a `allDayTime`.
 * - `same_day` / `day_before`: ese día (o el anterior) a `allDayTime`, tenga o no hora la tarea.
 */
export function reminderFireAt(
  task: { dueDate: string | null; dueTime: string | null },
  option: ReminderOption,
  timeZone: string,
  allDayTime: string = DEFAULT_ALL_DAY_TIME,
): Date | null {
  if (!task.dueDate) return null;
  if (isBeforeOption(option)) {
    if (!task.dueTime) return zonedTimeToUtc(task.dueDate, allDayTime, timeZone);
    return new Date(zonedTimeToUtc(task.dueDate, task.dueTime, timeZone).getTime() - BEFORE_MINUTES[option] * 60_000);
  }
  const day = option === 'day_before' ? addDays(task.dueDate, -1) : task.dueDate;
  return zonedTimeToUtc(day, allDayTime, timeZone);
}
```

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run tests/core/reminder-options.test.ts`
Expected: PASS (todos). Si falla algún caso de DST, revisar `offsetMinutesAt` (no cambiar los valores esperados: están calculados contra los cambios de horario reales de 2026: Madrid 29/03, Nueva York 01/11).

- [ ] **Step 5: Tipos, lint y commit**

```powershell
npx tsc --noEmit
npm run lint
git add src/core/reminder-options.ts tests/core/reminder-options.test.ts
git commit -m @'
feat(core): opciones de recordatorio y cálculo del instante en la zona del usuario

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 2: Esquema — preferencias, recordatorios, suscripciones y entregas

**Files:**
- Modify: `src/db/schema.ts`, `tests/core/schema.test.ts`
- Generate: `drizzle/0007_<nombre>.sql`, `drizzle/meta/0007_snapshot.json`, `drizzle/meta/_journal.json`

- [ ] **Step 1: Tests que fallan (`tests/core/schema.test.ts`)**

En el primer test (`'crean todas las tablas'`) reemplazar la lista esperada por:

```ts
    expect(names).toEqual([
      'api_tokens', 'folders', 'list_members', 'lists', 'notification_deliveries', 'oauth_clients', 'oauth_codes',
      'oauth_tokens', 'push_subscriptions', 'sessions', 'subtasks', 'tags', 'task_reminders', 'task_tags', 'tasks', 'users',
    ]);
```

Cambiar el import de la línea 3 por:

```ts
import { listMembers, lists, notificationDeliveries, pushSubscriptions, taskReminders, tasks, users } from '@/db/schema';
```

Y agregar al final del `describe('migraciones', …)`:

```ts
  it('preferencias de notificación con valores por defecto', async () => {
    const db = await createTestDb();
    const user = await createTestUser(db);
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row).toMatchObject({
      reminderDefaultMinutes: null, allDayReminderTime: '09:00', digestEnabled: false, digestTime: '08:00', notifyAssigned: true,
    });
  });

  it('task_reminders: una fila por persona y tarea, CHECK de kind/offset y borrado en cascada', async () => {
    const db = await createTestDb();
    const user = await createTestUser(db);
    const [list] = await db.insert(lists).values({ userId: user.id, name: 'L' }).returning();
    const [task] = await db.insert(tasks).values({ userId: user.id, listId: list.id, title: 'A' }).returning();
    await db.insert(taskReminders).values({ taskId: task.id, userId: user.id, kind: 'before', offsetMinutes: 15 });
    await expect(
      db.insert(taskReminders).values({ taskId: task.id, userId: user.id, kind: 'same_day', offsetMinutes: null }),
    ).rejects.toThrow();
    const other = await createTestUser(db, 'otra@example.com');
    // offset fuera de la lista, offset en un kind que no lo usa y kind desconocido: el CHECK los rechaza.
    await expect(db.insert(taskReminders).values({ taskId: task.id, userId: other.id, kind: 'before', offsetMinutes: 7 })).rejects.toThrow();
    await expect(db.insert(taskReminders).values({ taskId: task.id, userId: other.id, kind: 'same_day', offsetMinutes: 5 })).rejects.toThrow();
    await expect(db.insert(taskReminders).values({ taskId: task.id, userId: other.id, kind: 'before', offsetMinutes: null })).rejects.toThrow();
    await db.delete(tasks).where(eq(tasks.id, task.id));
    expect(await db.select().from(taskReminders)).toEqual([]);
  });

  it('push_subscriptions: endpoint único; notification_deliveries: única por (usuario, tipo, clave)', async () => {
    const db = await createTestDb();
    const user = await createTestUser(db);
    const sub = { userId: user.id, endpoint: 'https://push.example.com/a', p256dh: 'p', auth: 'a' };
    await db.insert(pushSubscriptions).values(sub);
    await expect(db.insert(pushSubscriptions).values(sub)).rejects.toThrow();
    const delivery = { userId: user.id, kind: 'digest' as const, fireKey: '2030-01-01' };
    await db.insert(notificationDeliveries).values(delivery);
    await expect(db.insert(notificationDeliveries).values(delivery)).rejects.toThrow();
    await db.insert(notificationDeliveries).values({ ...delivery, kind: 'test' });
    await db.delete(users).where(eq(users.id, user.id));
    expect(await db.select().from(pushSubscriptions)).toEqual([]);
    expect(await db.select().from(notificationDeliveries)).toEqual([]);
  });
```

(`eq` ya está importado en ese archivo; si no, agregarlo a `import { eq, sql } from 'drizzle-orm';`.)

- [ ] **Step 2: Verlos fallar**

Run: `npx vitest run tests/core/schema.test.ts`
Expected: FAIL — errores de tipos/imports (`taskReminders` no existe) o la lista de tablas no coincide.

- [ ] **Step 3: Esquema (`src/db/schema.ts`)**

Cambiar el import de `drizzle-orm/pg-core` por:

```ts
import {
  boolean, check, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
```

En `users`, después de `timezone`, agregar:

```ts
  /** Recordatorio por defecto para tareas con hora (minutos antes: 0, 15 o 60). NULL = ninguno. */
  reminderDefaultMinutes: integer('reminder_default_minutes'),
  /** Hora local (HH:mm) de los recordatorios «el mismo día» / «el día anterior». */
  allDayReminderTime: text('all_day_reminder_time').notNull().default('09:00'),
  /** Resumen diario de Hoy y vencidas, a `digest_time` (hora local). */
  digestEnabled: boolean('digest_enabled').notNull().default(false),
  digestTime: text('digest_time').notNull().default('08:00'),
  /** Avisar cuando otra persona me asigna una tarea. */
  notifyAssigned: boolean('notify_assigned').notNull().default(true),
```

Al final del archivo agregar:

```ts
/**
 * Recordatorio de una persona en una tarea (cada miembro de una lista compartida tiene el suyo).
 * kind 'before' = `offset_minutes` antes de la fecha+hora; 'same_day' / 'day_before' = a `users.all_day_reminder_time`.
 */
export const taskReminders = pgTable('task_reminders', {
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['before', 'same_day', 'day_before'] }).notNull(),
  offsetMinutes: integer('offset_minutes'),
  /** Cuándo se puso o cambió: un instante anterior a esto no se avisa (sería un aviso atrasado). */
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.taskId, t.userId] }),
  index('task_reminders_user_idx').on(t.userId),
  check(
    'task_reminders_kind_offset_check',
    sql`("kind" = 'before' AND "offset_minutes" IN (0, 5, 15, 30, 60, 1440)) OR ("kind" IN ('same_day', 'day_before') AND "offset_minutes" IS NULL)`,
  ),
]);

/** Suscripciones Web Push (una por navegador/dispositivo). El endpoint identifica al dispositivo. */
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  failureCount: integer('failure_count').notNull().default(0),
}, (t) => [index('push_subscriptions_user_idx').on(t.userId)]);

/**
 * Avisos ya mandados (o reclamados para mandar). La unicidad de (usuario, tipo, clave) hace que un aviso salga
 * a lo sumo una vez aunque el proceso se reinicie. Se purgan a los 30 días.
 */
export const notificationDeliveries = pgTable('notification_deliveries', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['reminder', 'digest', 'assigned', 'test'] }).notNull(),
  fireKey: text('fire_key').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('notification_deliveries_key_idx').on(t.userId, t.kind, t.fireKey),
  index('notification_deliveries_sent_idx').on(t.sentAt),
]);
```

- [ ] **Step 4: Generar la migración**

Run: `npm run db:generate`
Expected: `drizzle/0007_<nombre_al_azar>.sql` y el snapshot. Revisar que el SQL tenga **exactamente** esto (el orden puede variar):
- `CREATE TABLE "notification_deliveries"` (id, user_id, task_id, kind, fire_key, sent_at), `CREATE TABLE "push_subscriptions"` (con `CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")`), `CREATE TABLE "task_reminders"` (con `CONSTRAINT "task_reminders_task_id_user_id_pk" PRIMARY KEY("task_id","user_id")` y `CONSTRAINT "task_reminders_kind_offset_check" CHECK (…)`);
- 5 `ALTER TABLE "users" ADD COLUMN …` (`reminder_default_minutes integer`, `all_day_reminder_time text DEFAULT '09:00' NOT NULL`, `digest_enabled boolean DEFAULT false NOT NULL`, `digest_time text DEFAULT '08:00' NOT NULL`, `notify_assigned boolean DEFAULT true NOT NULL`);
- 5 FKs con `ON DELETE cascade` (deliveries→users, deliveries→tasks, subscriptions→users, reminders→tasks, reminders→users);
- índices `notification_deliveries_key_idx` (UNIQUE), `notification_deliveries_sent_idx`, `push_subscriptions_user_idx`, `task_reminders_user_idx`.

Nada de `DROP` ni cambios a otras tablas: la migración es aditiva (compatible con la vuelta atrás automática de `deploy.sh`).

- [ ] **Step 5: Tests**

Run: `npx vitest run tests/core/schema.test.ts tests/core/users.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
npx tsc --noEmit
git add src/db/schema.ts drizzle tests/core/schema.test.ts
git commit -m @'
feat(db): preferencias de notificación, recordatorios, suscripciones push y entregas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 3: Recordatorios en el núcleo de tareas (TDD)

**Files:**
- Create: `src/core/reminders.ts`, `tests/core/reminders.test.ts`
- Modify: `src/core/tasks.ts`, `src/core/index.ts`

- [ ] **Step 1: Tests que fallan**

`tests/core/reminders.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError } from '@/core/errors';
import { createTask, getTask, listTasks, updateTask } from '@/core/tasks';
import { taskReminders, users } from '@/db/schema';
import type { DB } from '@/db/types';
import { createTestDb, createTestUser } from '../helpers/db';
import { createSharingFixture } from '../helpers/sharing';

let db: DB;

beforeEach(async () => {
  db = await createTestDb();
});

describe('recordatorio al crear y modificar', () => {
  it('createTask guarda el recordatorio de quien crea y getTask lo devuelve', async () => {
    const user = await createTestUser(db);
    const task = await createTask(db, user.id, { title: 'Dentista', dueDate: '2030-06-10', dueTime: '15:00', reminder: '30m' });
    expect(task.reminder).toBe('30m');
    expect((await getTask(db, user.id, task.id)).reminder).toBe('30m');
    expect((await listTasks(db, user.id))[0].reminder).toBe('30m');
  });

  it('sin recordatorio, reminder es null', async () => {
    const user = await createTestUser(db);
    const task = await createTask(db, user.id, { title: 'Algo' });
    expect(task.reminder).toBeNull();
  });

  it('updateTask pone, cambia y quita (null) el recordatorio', async () => {
    const user = await createTestUser(db);
    const task = await createTask(db, user.id, { title: 'Pagar luz', dueDate: '2030-06-10' });
    expect((await updateTask(db, user.id, task.id, { reminder: 'day_before' })).reminder).toBe('day_before');
    expect((await updateTask(db, user.id, task.id, { reminder: 'same_day' })).reminder).toBe('same_day');
    expect((await updateTask(db, user.id, task.id, { reminder: null })).reminder).toBeNull();
    expect(await db.select().from(taskReminders)).toEqual([]);
  });

  it('valida: sin fecha, opción «antes» sin hora y valores desconocidos', async () => {
    const user = await createTestUser(db);
    await expect(createTask(db, user.id, { title: 'X', reminder: 'same_day' })).rejects.toThrow('Para poner un recordatorio la tarea necesita fecha');
    await expect(createTask(db, user.id, { title: 'X', dueDate: '2030-06-10', reminder: '15m' })).rejects.toThrow(ValidationError);
    const task = await createTask(db, user.id, { title: 'Y', dueDate: '2030-06-10' });
    // @ts-expect-error valor inválido a propósito
    await expect(updateTask(db, user.id, task.id, { reminder: '2h' })).rejects.toThrow(/Recordatorio inválido/);
    // Se valida contra la fecha/hora que queda: sacar la fecha y poner recordatorio a la vez no se puede.
    await expect(updateTask(db, user.id, task.id, { dueDate: null, reminder: 'same_day' })).rejects.toThrow(/necesita fecha/);
    // Poner hora y una opción «antes» en el mismo cambio sí.
    expect((await updateTask(db, user.id, task.id, { dueTime: '10:00', reminder: '5m' })).reminder).toBe('5m');
  });

  it('cada persona tiene su propio recordatorio en una tarea compartida', async () => {
    const { owner, member, stranger, shared } = await createSharingFixture(db);
    const task = await createTask(db, owner.id, { title: 'Compartida', listId: shared.id, dueDate: '2030-06-10', reminder: 'same_day' });
    expect((await getTask(db, member.id, task.id)).reminder).toBeNull();
    await updateTask(db, member.id, task.id, { reminder: 'day_before' });
    expect((await getTask(db, member.id, task.id)).reminder).toBe('day_before');
    expect((await getTask(db, owner.id, task.id)).reminder).toBe('same_day');
    // Un ajeno no puede poner recordatorios (no ve la tarea).
    await expect(updateTask(db, stranger.id, task.id, { reminder: 'same_day' })).rejects.toThrow(NotFoundError);
  });
});

describe('recordatorio por defecto', () => {
  async function userWithDefault(minutes: number | null) {
    const user = await createTestUser(db);
    await db.update(users).set({ reminderDefaultMinutes: minutes }).where(eq(users.id, user.id));
    return user;
  }

  it('se aplica al crear una tarea con hora', async () => {
    const user = await userWithDefault(15);
    expect((await createTask(db, user.id, { title: 'A', dueDate: '2030-06-10', dueTime: '09:00' })).reminder).toBe('15m');
    // Sin hora no hay recordatorio por defecto.
    expect((await createTask(db, user.id, { title: 'B', dueDate: '2030-06-10' })).reminder).toBeNull();
  });

  it('uno explícito (incluso null) gana sobre el por defecto', async () => {
    const user = await userWithDefault(60);
    expect((await createTask(db, user.id, { title: 'A', dueDate: '2030-06-10', dueTime: '09:00', reminder: 'at_time' })).reminder).toBe('at_time');
    expect((await createTask(db, user.id, { title: 'B', dueDate: '2030-06-10', dueTime: '09:00', reminder: null })).reminder).toBeNull();
  });

  it('se aplica al ponerle hora a una tarea que no tenía, sin pisar uno existente', async () => {
    const user = await userWithDefault(0);
    const task = await createTask(db, user.id, { title: 'A', dueDate: '2030-06-10' });
    expect((await updateTask(db, user.id, task.id, { dueTime: '18:00' })).reminder).toBe('at_time');
    await updateTask(db, user.id, task.id, { reminder: '1h' });
    await updateTask(db, user.id, task.id, { dueTime: null });
    expect((await updateTask(db, user.id, task.id, { dueTime: '19:00' })).reminder).toBe('1h');
  });

  it('sin preferencia no se agrega nada', async () => {
    const user = await userWithDefault(null);
    expect((await createTask(db, user.id, { title: 'A', dueDate: '2030-06-10', dueTime: '09:00' })).reminder).toBeNull();
  });
});
```

- [ ] **Step 2: Verlos fallar**

Run: `npx vitest run tests/core/reminders.test.ts`
Expected: FAIL — errores de tipos (`reminder` no existe en `CreateTaskInput`) o `task.reminder` es `undefined`.

- [ ] **Step 3: `src/core/reminders.ts`**

```ts
import { and, eq, inArray } from 'drizzle-orm';
import { taskReminders, users } from '@/db/schema';
import type { DB } from '@/db/types';
import { fromStored, optionForMinutes, toStored, type ReminderOption } from './reminder-options';

/**
 * Recordatorios por persona. Estas funciones NO chequean acceso: las llaman createTask/updateTask dentro de su
 * transacción, después de haber validado que el usuario accede a la tarea.
 */

/** taskId → opción del recordatorio de `userId` en esas tareas. */
export async function remindersFor(db: DB, userId: string, taskIds: string[]): Promise<Map<string, ReminderOption>> {
  if (taskIds.length === 0) return new Map();
  const rows = await db
    .select({ taskId: taskReminders.taskId, kind: taskReminders.kind, offsetMinutes: taskReminders.offsetMinutes })
    .from(taskReminders)
    .where(and(eq(taskReminders.userId, userId), inArray(taskReminders.taskId, taskIds)));
  const map = new Map<string, ReminderOption>();
  for (const row of rows) {
    const option = fromStored(row);
    if (option) map.set(row.taskId, option);
  }
  return map;
}

/** Pone, cambia o (con null) quita el recordatorio de `userId` en la tarea. */
export async function writeReminder(
  db: DB, userId: string, taskId: string, option: ReminderOption | null, now: Date = new Date(),
): Promise<void> {
  if (option === null) {
    await db.delete(taskReminders).where(and(eq(taskReminders.taskId, taskId), eq(taskReminders.userId, userId)));
    return;
  }
  const { kind, offsetMinutes } = toStored(option);
  await db
    .insert(taskReminders)
    .values({ taskId, userId, kind, offsetMinutes, updatedAt: now })
    .onConflictDoUpdate({ target: [taskReminders.taskId, taskReminders.userId], set: { kind, offsetMinutes, updatedAt: now } });
}

/** Si el usuario tiene recordatorio por defecto y todavía no puso uno en esta tarea, lo agrega. */
export async function applyDefaultReminder(db: DB, userId: string, taskId: string, now: Date = new Date()): Promise<void> {
  const [user] = await db.select({ minutes: users.reminderDefaultMinutes }).from(users).where(eq(users.id, userId));
  const option = optionForMinutes(user?.minutes ?? null);
  if (!option) return;
  const { kind, offsetMinutes } = toStored(option);
  await db.insert(taskReminders).values({ taskId, userId, kind, offsetMinutes, updatedAt: now }).onConflictDoNothing();
}
```

- [ ] **Step 4: `src/core/tasks.ts`**

Imports (agregar):

```ts
import { checkReminderFits, parseReminderOption, type ReminderOption } from './reminder-options';
import { applyDefaultReminder, remindersFor, writeReminder } from './reminders';
```

En `TaskWithDetails`, agregar el campo:

```ts
  /** Recordatorio del usuario que consulta (cada persona tiene el suyo), o null. */
  reminder: ReminderOption | null;
```

En `CreateTaskInput` y en `UpdateTaskInput`, agregar:

```ts
  /** Recordatorio de quien crea/modifica: una opción de REMINDER_OPTIONS, null = ninguno. Sin el campo: no se toca
   *  (al crear con hora, o al ponerle hora a una tarea que no tenía, se aplica el recordatorio por defecto). */
  reminder?: ReminderOption | null;
```

En `hydrate`, antes del `return rows.map(...)`:

```ts
  const reminders = await remindersFor(db, viewerId, ids);
```

y en el objeto que devuelve cada fila, después de `assignee: …`:

```ts
      reminder: reminders.get(row.id) ?? null,
```

En `createTask`, después de `const createdVia = checkCreatedVia(input.createdVia);`:

```ts
  const reminder = input.reminder !== undefined ? parseReminderOption(input.reminder) : undefined;
  if (reminder !== undefined) checkReminderFits(reminder, dueDate, dueTime);
```

y dentro de la transacción, después de `if (tagNames.length) await replaceTags(tx, userId, task.id, tagNames);`:

```ts
      if (reminder !== undefined) await writeReminder(tx, userId, task.id, reminder);
      else if (dueTime !== null) await applyDefaultReminder(tx, userId, task.id);
```

En `updateTask`, después de `const tagNames = …;`:

```ts
  const reminder = input.reminder !== undefined ? parseReminderOption(input.reminder) : undefined;
```

y dentro de la transacción, reemplazar la línea `await tx.update(tasks).set({ ...patch, updatedAt: new Date() }).where(eq(tasks.id, current.id));` por:

```ts
    // Fecha y hora con las que queda la tarea (para validar y para el recordatorio por defecto).
    const finalDate = patch.dueDate !== undefined ? patch.dueDate : current.dueDate;
    const finalTime = patch.dueTime !== undefined ? patch.dueTime : current.dueTime;
    if (reminder !== undefined) checkReminderFits(reminder, finalDate, finalTime);
    await tx.update(tasks).set({ ...patch, updatedAt: new Date() }).where(eq(tasks.id, current.id));
    if (reminder !== undefined) await writeReminder(tx, userId, current.id, reminder);
    else if (current.dueTime === null && finalTime !== null) await applyDefaultReminder(tx, userId, current.id);
```

(`patch.dueDate`/`patch.dueTime` solo se definen si llegó fecha u hora: `Object.assign(patch, checkDue(...))` ya está arriba; `finalDate ?? null` no hace falta porque ambos son `string | null`.)

- [ ] **Step 5: `src/core/index.ts`**

Agregar (en orden alfabético con el resto):

```ts
export * from './reminder-options';
export * from './reminders';
```

- [ ] **Step 6: Tests**

Run: `npx vitest run tests/core/reminders.test.ts tests/core`
Expected: PASS todo `tests/core` (los tests existentes no comparan tareas con `toStrictEqual`; si alguno compara un objeto de tarea completo con `toEqual`, sumarle `reminder: null`).

- [ ] **Step 7: Commit**

```powershell
npx tsc --noEmit
npm run lint
git add src/core/reminders.ts src/core/tasks.ts src/core/index.ts tests/core/reminders.test.ts
git commit -m @'
feat(core): recordatorio por persona en las tareas y recordatorio por defecto

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 4: Preferencias y suscripciones push en el núcleo (TDD)

**Files:**
- Create: `src/core/notification-prefs.ts`, `src/core/push-subscriptions.ts`, `tests/core/notification-prefs.test.ts`, `tests/core/push-subscriptions.test.ts`, `tests/helpers/push.ts`
- Modify: `src/core/index.ts`

- [ ] **Step 1: Helper de tests `tests/helpers/push.ts`**

```ts
import type { PushPayload, PushResult, SendPush } from '@/core/push-subscriptions';

/** Datos de una suscripción como los manda el navegador (`PushSubscription.toJSON()` + user agent). */
export function subscriptionInput(n = 1, overrides: Record<string, unknown> = {}) {
  return {
    endpoint: `https://push.example.com/send/${n}`,
    keys: { p256dh: `BClavePublica${n}_-`, auth: `auth${n}` },
    userAgent: 'Vitest',
    ...overrides,
  };
}

/** `send` falso: registra cada envío y responde según el endpoint ('ok' si no se indica). */
export function fakeSender(results: Record<string, PushResult> = {}) {
  const calls: { endpoint: string; payload: PushPayload }[] = [];
  const send: SendPush = async (target, payload) => {
    calls.push({ endpoint: target.endpoint, payload });
    return results[target.endpoint] ?? 'ok';
  };
  return { send, calls };
}
```

- [ ] **Step 2: Tests que fallan — preferencias**

`tests/core/notification-prefs.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { ValidationError } from '@/core/errors';
import { checkNotificationPrefs, getNotificationPrefs, updateNotificationPrefs } from '@/core/notification-prefs';
import type { DB } from '@/db/types';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
beforeEach(async () => {
  db = await createTestDb();
});

describe('preferencias de notificación', () => {
  it('valores por defecto', async () => {
    const user = await createTestUser(db);
    expect(await getNotificationPrefs(db, user.id)).toEqual({
      reminderDefaultMinutes: null, allDayReminderTime: '09:00', digestEnabled: false, digestTime: '08:00', notifyAssigned: true,
    });
  });

  it('guarda solo los campos enviados', async () => {
    const user = await createTestUser(db);
    await updateNotificationPrefs(db, user.id, { reminderDefaultMinutes: 15, digestEnabled: true });
    expect(await updateNotificationPrefs(db, user.id, { digestTime: '07:30', notifyAssigned: false })).toEqual({
      reminderDefaultMinutes: 15, allDayReminderTime: '09:00', digestEnabled: true, digestTime: '07:30', notifyAssigned: false,
    });
    expect((await updateNotificationPrefs(db, user.id, { reminderDefaultMinutes: null })).reminderDefaultMinutes).toBeNull();
  });

  it('valida cada campo', () => {
    expect(() => checkNotificationPrefs(null)).toThrow(ValidationError);
    expect(() => checkNotificationPrefs({ reminderDefaultMinutes: 30 })).toThrow(/Recordatorio por defecto inválido/);
    expect(() => checkNotificationPrefs({ reminderDefaultMinutes: '15' })).toThrow(ValidationError);
    expect(() => checkNotificationPrefs({ allDayReminderTime: '9:00' })).toThrow(/Hora inválida/);
    expect(() => checkNotificationPrefs({ digestTime: '24:00' })).toThrow(/Hora inválida/);
    expect(() => checkNotificationPrefs({ digestEnabled: 'sí' })).toThrow(/verdadero o falso/);
    expect(() => checkNotificationPrefs({ notifyAssigned: 1 })).toThrow(/verdadero o falso/);
    expect(checkNotificationPrefs({ reminderDefaultMinutes: 0, otra: 'cosa' })).toEqual({ reminderDefaultMinutes: 0 });
  });

  it('usuario inexistente → NotFoundError', async () => {
    await expect(updateNotificationPrefs(db, '00000000-0000-4000-8000-000000000000', { digestEnabled: true }))
      .rejects.toThrow('El usuario no existe');
  });
});
```

- [ ] **Step 3: Tests que fallan — suscripciones**

`tests/core/push-subscriptions.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { ValidationError } from '@/core/errors';
import {
  MAX_PUSH_FAILURES, MAX_SUBSCRIPTIONS_PER_USER, checkPushSubscription, countPushSubscriptions, deletePushSubscription,
  listPushSubscriptions, recordPushResult, savePushSubscription,
} from '@/core/push-subscriptions';
import type { DB } from '@/db/types';
import { createTestDb, createTestUser } from '../helpers/db';
import { subscriptionInput } from '../helpers/push';

let db: DB;
beforeEach(async () => {
  db = await createTestDb();
});

describe('validación', () => {
  it('acepta lo que manda el navegador', () => {
    expect(checkPushSubscription(subscriptionInput(1))).toEqual({
      endpoint: 'https://push.example.com/send/1', p256dh: 'BClavePublica1_-', auth: 'auth1', userAgent: 'Vitest',
    });
  });

  it('rechaza endpoints que no son https, largos o inválidos', () => {
    expect(() => checkPushSubscription(subscriptionInput(1, { endpoint: 'http://push.example.com/x' }))).toThrow(/https/);
    expect(() => checkPushSubscription(subscriptionInput(1, { endpoint: `https://x.example.com/${'a'.repeat(2100)}` }))).toThrow(ValidationError);
    expect(() => checkPushSubscription(subscriptionInput(1, { endpoint: 'no es una url' }))).toThrow(ValidationError);
    expect(() => checkPushSubscription(subscriptionInput(1, { endpoint: 5 }))).toThrow(ValidationError);
    expect(() => checkPushSubscription('nada')).toThrow(ValidationError);
  });

  it('rechaza claves faltantes, largas o con caracteres raros', () => {
    expect(() => checkPushSubscription(subscriptionInput(1, { keys: undefined }))).toThrow(/Claves/);
    expect(() => checkPushSubscription(subscriptionInput(1, { keys: { p256dh: 'a b', auth: 'x' } }))).toThrow(/Claves/);
    expect(() => checkPushSubscription(subscriptionInput(1, { keys: { p256dh: 'a'.repeat(201), auth: 'x' } }))).toThrow(/Claves/);
    expect(() => checkPushSubscription(subscriptionInput(1, { keys: { p256dh: 'abc', auth: '' } }))).toThrow(/Claves/);
  });

  it('recorta el user agent y lo deja en null si no es texto', () => {
    expect(checkPushSubscription(subscriptionInput(1, { userAgent: 'x'.repeat(400) })).userAgent).toHaveLength(300);
    expect(checkPushSubscription(subscriptionInput(1, { userAgent: 42 })).userAgent).toBeNull();
  });
});

describe('alta, baja y tope', () => {
  it('guarda, lista y cuenta; el mismo endpoint no se duplica', async () => {
    const user = await createTestUser(db);
    await savePushSubscription(db, user.id, subscriptionInput(1));
    await savePushSubscription(db, user.id, subscriptionInput(1, { keys: { p256dh: 'Otra', auth: 'otra' } }));
    const subs = await listPushSubscriptions(db, user.id);
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ p256dh: 'Otra', auth: 'otra', failureCount: 0 });
    expect(await countPushSubscriptions(db, user.id)).toBe(1);
  });

  it('el mismo navegador con otra cuenta pasa a la cuenta nueva', async () => {
    const a = await createTestUser(db, 'a@example.com');
    const b = await createTestUser(db, 'b@example.com');
    await savePushSubscription(db, a.id, subscriptionInput(1));
    await savePushSubscription(db, b.id, subscriptionInput(1));
    expect(await countPushSubscriptions(db, a.id)).toBe(0);
    expect(await countPushSubscriptions(db, b.id)).toBe(1);
  });

  it(`como mucho ${MAX_SUBSCRIPTIONS_PER_USER} por usuario: se borra la más vieja`, async () => {
    const user = await createTestUser(db);
    for (let i = 0; i <= MAX_SUBSCRIPTIONS_PER_USER; i++) {
      await savePushSubscription(db, user.id, subscriptionInput(i), new Date(Date.UTC(2030, 0, 1, 0, i)));
    }
    const endpoints = (await listPushSubscriptions(db, user.id)).map((s) => s.endpoint);
    expect(endpoints).toHaveLength(MAX_SUBSCRIPTIONS_PER_USER);
    expect(endpoints).not.toContain('https://push.example.com/send/0');
    expect(endpoints[0]).toBe(`https://push.example.com/send/${MAX_SUBSCRIPTIONS_PER_USER}`);
  });

  it('cada uno borra solo sus suscripciones', async () => {
    const a = await createTestUser(db, 'a@example.com');
    const b = await createTestUser(db, 'b@example.com');
    await savePushSubscription(db, a.id, subscriptionInput(1));
    expect(await deletePushSubscription(db, b.id, 'https://push.example.com/send/1')).toBe(false);
    expect(await deletePushSubscription(db, a.id, 'https://push.example.com/send/1')).toBe(true);
    expect(await deletePushSubscription(db, a.id, 5)).toBe(false);
  });
});

describe('resultado de un envío', () => {
  it('ok marca el éxito y reinicia los fallos; gone borra; failed suma y borra al llegar al tope', async () => {
    const user = await createTestUser(db);
    const sub = await savePushSubscription(db, user.id, subscriptionInput(1));
    const now = new Date('2030-01-01T10:00:00Z');
    await recordPushResult(db, sub.id, 'failed', now);
    await recordPushResult(db, sub.id, 'ok', now);
    expect((await listPushSubscriptions(db, user.id))[0]).toMatchObject({ failureCount: 0, lastSuccessAt: now });
    for (let i = 0; i < MAX_PUSH_FAILURES - 1; i++) await recordPushResult(db, sub.id, 'failed', now);
    expect((await listPushSubscriptions(db, user.id))[0].failureCount).toBe(MAX_PUSH_FAILURES - 1);
    await recordPushResult(db, sub.id, 'failed', now);
    expect(await countPushSubscriptions(db, user.id)).toBe(0);

    const other = await savePushSubscription(db, user.id, subscriptionInput(2));
    await recordPushResult(db, other.id, 'gone', now);
    expect(await countPushSubscriptions(db, user.id)).toBe(0);
  });
});
```

- [ ] **Step 4: Verlos fallar**

Run: `npx vitest run tests/core/notification-prefs.test.ts tests/core/push-subscriptions.test.ts`
Expected: FAIL — no existen los módulos.

- [ ] **Step 5: `src/core/notification-prefs.ts`**

```ts
import { eq } from 'drizzle-orm';
import { users } from '@/db/schema';
import type { DB } from '@/db/types';
import { isValidTime } from './dates';
import { ValidationError } from './errors';
import { getUser, type PublicUser } from './users';

/** Opciones del recordatorio por defecto (minutos antes; null = ninguno). */
export const DEFAULT_REMINDER_CHOICES = [null, 0, 15, 60] as const;
export type DefaultReminderMinutes = (typeof DEFAULT_REMINDER_CHOICES)[number];

export interface NotificationPrefs {
  reminderDefaultMinutes: DefaultReminderMinutes;
  allDayReminderTime: string;
  digestEnabled: boolean;
  digestTime: string;
  notifyAssigned: boolean;
}

export function notificationPrefsOf(user: Pick<PublicUser, keyof NotificationPrefs>): NotificationPrefs {
  return {
    reminderDefaultMinutes: (DEFAULT_REMINDER_CHOICES as readonly (number | null)[]).includes(user.reminderDefaultMinutes)
      ? (user.reminderDefaultMinutes as DefaultReminderMinutes) : null,
    allDayReminderTime: user.allDayReminderTime,
    digestEnabled: user.digestEnabled,
    digestTime: user.digestTime,
    notifyAssigned: user.notifyAssigned,
  };
}

function checkTime(value: unknown): string {
  if (typeof value !== 'string' || !isValidTime(value)) throw new ValidationError('Hora inválida (formato HH:mm, 24 hs)');
  return value;
}

function checkBool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new ValidationError('Valor inválido: tiene que ser verdadero o falso');
  return value;
}

/** Valida un cambio parcial de preferencias. Los campos que no son de preferencias se ignoran. */
export function checkNotificationPrefs(input: unknown): Partial<NotificationPrefs> {
  if (typeof input !== 'object' || input === null) throw new ValidationError('Preferencias inválidas');
  const i = input as Record<string, unknown>;
  const out: Partial<NotificationPrefs> = {};
  if (i.reminderDefaultMinutes !== undefined) {
    if (!(DEFAULT_REMINDER_CHOICES as readonly unknown[]).includes(i.reminderDefaultMinutes)) {
      throw new ValidationError('Recordatorio por defecto inválido: ninguno, a la hora, 15 o 60 minutos antes');
    }
    out.reminderDefaultMinutes = i.reminderDefaultMinutes as DefaultReminderMinutes;
  }
  if (i.allDayReminderTime !== undefined) out.allDayReminderTime = checkTime(i.allDayReminderTime);
  if (i.digestEnabled !== undefined) out.digestEnabled = checkBool(i.digestEnabled);
  if (i.digestTime !== undefined) out.digestTime = checkTime(i.digestTime);
  if (i.notifyAssigned !== undefined) out.notifyAssigned = checkBool(i.notifyAssigned);
  return out;
}

export async function getNotificationPrefs(db: DB, userId: string): Promise<NotificationPrefs> {
  return notificationPrefsOf(await getUser(db, userId));
}

export async function updateNotificationPrefs(db: DB, userId: string, input: unknown): Promise<NotificationPrefs> {
  const patch = checkNotificationPrefs(input);
  await getUser(db, userId);
  if (Object.keys(patch).length > 0) await db.update(users).set(patch).where(eq(users.id, userId));
  return getNotificationPrefs(db, userId);
}
```

- [ ] **Step 6: `src/core/push-subscriptions.ts`**

```ts
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { pushSubscriptions } from '@/db/schema';
import type { DB } from '@/db/types';
import { ValidationError } from './errors';

export const MAX_SUBSCRIPTIONS_PER_USER = 10;
/** Fallos seguidos (que no son 404/410) después de los cuales se da por muerta la suscripción. */
export const MAX_PUSH_FAILURES = 10;
const MAX_ENDPOINT = 2048;
const MAX_P256DH = 200;
const MAX_AUTH = 100;
const MAX_USER_AGENT = 300;
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

/** A dónde se manda (lo mínimo que necesita `web-push`). */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Contenido del aviso (lo lee `public/sw.js`). `url` es relativa al sitio. */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** 'gone' = el servicio respondió 404/410: la suscripción ya no existe. */
export type PushResult = 'ok' | 'gone' | 'failed';
export type SendPush = (target: PushTarget, payload: PushPayload) => Promise<PushResult>;

const KEYS_MSG = 'Claves de la suscripción inválidas';

function checkKey(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || !B64URL.test(value)) {
    throw new ValidationError(KEYS_MSG);
  }
  return value;
}

/** Valida lo que manda el navegador (`PushSubscription.toJSON()` más el user agent). */
export function checkPushSubscription(input: unknown): PushTarget & { userAgent: string | null } {
  if (typeof input !== 'object' || input === null) throw new ValidationError('Suscripción inválida');
  const i = input as { endpoint?: unknown; keys?: unknown; userAgent?: unknown };
  if (typeof i.endpoint !== 'string' || i.endpoint.length > MAX_ENDPOINT) throw new ValidationError('Suscripción inválida');
  let url: URL;
  try {
    url = new URL(i.endpoint);
  } catch {
    throw new ValidationError('Suscripción inválida');
  }
  if (url.protocol !== 'https:') throw new ValidationError('La suscripción tiene que usar https');
  if (typeof i.keys !== 'object' || i.keys === null) throw new ValidationError(KEYS_MSG);
  const keys = i.keys as { p256dh?: unknown; auth?: unknown };
  return {
    endpoint: i.endpoint,
    p256dh: checkKey(keys.p256dh, MAX_P256DH),
    auth: checkKey(keys.auth, MAX_AUTH),
    userAgent: typeof i.userAgent === 'string' ? i.userAgent.slice(0, MAX_USER_AGENT) : null,
  };
}

/**
 * Guarda la suscripción de este dispositivo. Si el endpoint ya existía (aunque fuera de otra cuenta: mismo
 * navegador, otra sesión), se actualiza y pasa a este usuario. Con más de MAX_SUBSCRIPTIONS_PER_USER se borran
 * las más viejas.
 */
export async function savePushSubscription(
  db: DB, userId: string, input: unknown, now: Date = new Date(),
): Promise<PushSubscriptionRow> {
  const sub = checkPushSubscription(input);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(pushSubscriptions)
      .values({ userId, ...sub, createdAt: now })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId, p256dh: sub.p256dh, auth: sub.auth, userAgent: sub.userAgent, failureCount: 0, createdAt: now },
      })
      .returning();
    const all = await tx
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .orderBy(desc(pushSubscriptions.createdAt), desc(pushSubscriptions.id));
    const extra = all.slice(MAX_SUBSCRIPTIONS_PER_USER).map((s) => s.id);
    if (extra.length > 0) await tx.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, extra));
    return row;
  });
}

/** Borra la suscripción de este dispositivo; solo si es del usuario. */
export async function deletePushSubscription(db: DB, userId: string, endpoint: unknown): Promise<boolean> {
  if (typeof endpoint !== 'string') return false;
  const deleted = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
    .returning({ id: pushSubscriptions.id });
  return deleted.length > 0;
}

/** Las más nuevas primero. */
export function listPushSubscriptions(db: DB, userId: string): Promise<PushSubscriptionRow[]> {
  return db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(desc(pushSubscriptions.createdAt), desc(pushSubscriptions.id));
}

export async function countPushSubscriptions(db: DB, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  return Number(row.n);
}

/** Registra cómo salió un envío: éxito, suscripción muerta (se borra) o fallo (se cuenta). */
export async function recordPushResult(db: DB, subscriptionId: string, result: PushResult, now: Date = new Date()): Promise<void> {
  if (result === 'gone') {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscriptionId));
    return;
  }
  if (result === 'ok') {
    await db.update(pushSubscriptions).set({ lastSuccessAt: now, failureCount: 0 }).where(eq(pushSubscriptions.id, subscriptionId));
    return;
  }
  const [row] = await db
    .update(pushSubscriptions)
    .set({ failureCount: sql`${pushSubscriptions.failureCount} + 1` })
    .where(eq(pushSubscriptions.id, subscriptionId))
    .returning({ failures: pushSubscriptions.failureCount });
  if (row && row.failures >= MAX_PUSH_FAILURES) {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscriptionId));
  }
}
```

- [ ] **Step 7: `src/core/index.ts`**

Agregar:

```ts
export * from './notification-prefs';
export * from './push-subscriptions';
```

- [ ] **Step 8: Tests y commit**

Run: `npx vitest run tests/core/notification-prefs.test.ts tests/core/push-subscriptions.test.ts`
Expected: PASS.

```powershell
npx tsc --noEmit
npm run lint
git add src/core/notification-prefs.ts src/core/push-subscriptions.ts src/core/index.ts tests/core/notification-prefs.test.ts tests/core/push-subscriptions.test.ts tests/helpers/push.ts
git commit -m @'
feat(core): preferencias de notificación y suscripciones push

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 5: Envío con `web-push` — `src/lib/push.ts` (TDD)

**Files:**
- Create: `src/lib/push.ts`, `tests/lib/push.test.ts`

- [ ] **Step 1: Tests que fallan**

`tests/lib/push.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock se eleva al principio del archivo: el mock tiene que crearse con vi.hoisted para poder usarlo adentro.
const { sendNotification } = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock('web-push', () => {
  class WebPushError extends Error {
    constructor(message: string, public statusCode: number) {
      super(message);
    }
  }
  return { default: { sendNotification, WebPushError }, sendNotification, WebPushError };
});

const { createWebPushSender, vapidConfig, vapidPublicKey } = await import('@/lib/push');
const { WebPushError } = (await import('web-push')) as unknown as {
  WebPushError: new (message: string, statusCode: number) => Error;
};

const ENV = { VAPID_PUBLIC_KEY: 'BPub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:yo@example.com' };
const target = { endpoint: 'https://push.example.com/1', p256dh: 'BKey', auth: 'auth' };
const payload = { title: 'Pagar luz', body: 'Hoy a las 15:00', url: '/app/today', tag: 'r-1' };

describe('vapidConfig', () => {
  it('necesita las tres variables y un subject mailto: o https:', () => {
    expect(vapidConfig(ENV)).toEqual({ publicKey: 'BPub', privateKey: 'priv', subject: 'mailto:yo@example.com' });
    expect(vapidConfig({ ...ENV, VAPID_SUBJECT: 'https://notas.example.com' })?.subject).toBe('https://notas.example.com');
    expect(vapidConfig({})).toBeNull();
    expect(vapidConfig({ ...ENV, VAPID_PRIVATE_KEY: ' ' })).toBeNull();
    expect(vapidConfig({ ...ENV, VAPID_SUBJECT: 'yo@example.com' })).toBeNull();
    expect(vapidPublicKey(ENV)).toBe('BPub');
    expect(vapidPublicKey({})).toBeNull();
  });
});

describe('createWebPushSender', () => {
  beforeEach(() => {
    sendNotification.mockReset();
  });

  it('manda el JSON con las claves VAPID por envío, TTL corto y urgencia alta', async () => {
    sendNotification.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    const send = createWebPushSender(vapidConfig(ENV)!);
    expect(await send(target, payload)).toBe('ok');
    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: target.endpoint, keys: { p256dh: 'BKey', auth: 'auth' } },
      JSON.stringify(payload),
      {
        vapidDetails: { subject: 'mailto:yo@example.com', publicKey: 'BPub', privateKey: 'priv' },
        TTL: 3600, urgency: 'high', timeout: 10_000,
      },
    );
  });

  it('404 y 410 son suscripciones muertas; otros errores, fallos', async () => {
    const send = createWebPushSender(vapidConfig(ENV)!, { error: vi.fn() });
    sendNotification.mockRejectedValueOnce(new WebPushError('Gone', 410));
    expect(await send(target, payload)).toBe('gone');
    sendNotification.mockRejectedValueOnce(new WebPushError('Not Found', 404));
    expect(await send(target, payload)).toBe('gone');
    sendNotification.mockRejectedValueOnce(new WebPushError('Too many', 429));
    expect(await send(target, payload)).toBe('failed');
    sendNotification.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await send(target, payload)).toBe('failed');
  });
});
```

- [ ] **Step 2: Verlo fallar**

Run: `npx vitest run tests/lib/push.test.ts`
Expected: FAIL — no existe `@/lib/push`.

- [ ] **Step 3: `src/lib/push.ts`**

```ts
import webpush from 'web-push';
import type { PushPayload, PushResult, PushTarget, SendPush } from '@/core/push-subscriptions';

export type Env = Readonly<Record<string, string | undefined>>;

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** Claves VAPID del entorno, o null si falta alguna (las notificaciones quedan apagadas). */
export function vapidConfig(env: Env = process.env): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (!subject.startsWith('mailto:') && !subject.startsWith('https:')) return null;
  return { publicKey, privateKey, subject };
}

/** Clave pública para el navegador (`applicationServerKey`), o null si no hay notificaciones. */
export function vapidPublicKey(env: Env = process.env): string | null {
  return vapidConfig(env)?.publicKey ?? null;
}

/** Un aviso viejo no sirve: el servicio de push lo descarta si no lo pudo entregar en 1 hora. */
const TTL_SECONDS = 3600;

/** `SendPush` real. Las claves van en cada envío (sin estado global de `web-push`). Nunca lanza. */
export function createWebPushSender(config: VapidConfig, logger: Pick<Console, 'error'> = console): SendPush {
  return async (target: PushTarget, payload: PushPayload): Promise<PushResult> => {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        {
          vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
          TTL: TTL_SECONDS, urgency: 'high', timeout: 10_000,
        },
      );
      return 'ok';
    } catch (err) {
      const status = typeof err === 'object' && err !== null ? (err as { statusCode?: unknown }).statusCode : undefined;
      if (status === 404 || status === 410) return 'gone';
      // Sin el endpoint en el log: identifica al dispositivo.
      logger.error(`[push] falló un envío (${typeof status === 'number' ? status : 'sin respuesta'})`);
      return 'failed';
    }
  };
}

const globalForPush = globalThis as unknown as { __notasPushSender?: { key: string; send: SendPush | null } };

/** El `SendPush` configurado con el entorno, o null si no hay claves VAPID. Se cachea por proceso. */
export function getPushSender(env: Env = process.env): SendPush | null {
  const config = vapidConfig(env);
  const key = config ? `${config.publicKey}|${config.subject}` : '';
  if (globalForPush.__notasPushSender?.key !== key) {
    globalForPush.__notasPushSender = { key, send: config ? createWebPushSender(config) : null };
  }
  return globalForPush.__notasPushSender.send;
}
```

Nota: `web-push` es CommonJS; con `esModuleInterop` (activo en el `tsconfig` de Next) `import webpush from 'web-push'` funciona en Next y en Vitest. El mock del test expone `default` y los nombres sueltos por las dos formas de importarlo.

- [ ] **Step 4: Tests y commit**

Run: `npx vitest run tests/lib/push.test.ts`
Expected: PASS.

```powershell
npx tsc --noEmit
npm run lint
git add src/lib/push.ts tests/lib/push.test.ts
git commit -m @'
feat(push): envío con web-push configurado por VAPID_* (apagado si faltan)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 6: Motor de notificaciones — recordatorios, resumen, asignación, prueba y purga (TDD)

**Files:**
- Create: `src/core/notifications.ts`, `tests/core/notifications.test.ts`
- Modify: `src/core/index.ts`, `src/lib/maintenance.ts`, `tests/lib/maintenance.test.ts`

- [ ] **Step 1: Tests que fallan**

`tests/core/notifications.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { removeListMember } from '@/core/members';
import { updateNotificationPrefs } from '@/core/notification-prefs';
import {
  claimDelivery, digestBody, notifyAssignment, purgeOldDeliveries, reminderBody, runDigests, runNotifications,
  runReminders, sendTestNotification,
} from '@/core/notifications';
import { countPushSubscriptions, savePushSubscription } from '@/core/push-subscriptions';
import { completeTask, createTask, deleteTask, updateTask } from '@/core/tasks';
import { notificationDeliveries, taskReminders } from '@/db/schema';
import type { DB } from '@/db/types';
import { createTestDb, createTestUser } from '../helpers/db';
import { fakeSender, subscriptionInput } from '../helpers/push';
import { createSharingFixture } from '../helpers/sharing';

// Fechas en 2030 a propósito: un recordatorio no avisa instantes anteriores a cuando se guardó (updated_at = ahora real).
const MIN = 60_000;
/** 10/06/2030 15:00 en Buenos Aires (UTC−3) menos 15 minutos. */
const FIRE = new Date('2030-06-10T17:45:00Z');
const at = (ms: number) => new Date(FIRE.getTime() + ms);
const DUE = { dueDate: '2030-06-10', dueTime: '15:00' };

let db: DB;
beforeEach(async () => {
  db = await createTestDb();
});

async function userWithDevice(email = 'emir@example.com', n = 1) {
  const user = await createTestUser(db, email);
  await savePushSubscription(db, user.id, subscriptionInput(n));
  return user;
}

describe('textos', () => {
  it('reminderBody según el día y la hora', () => {
    expect(reminderBody({ dueDate: '2030-06-10', dueTime: '15:00' }, '2030-06-10')).toBe('Hoy a las 15:00');
    expect(reminderBody({ dueDate: '2030-06-11', dueTime: '09:30' }, '2030-06-10')).toBe('Mañana a las 09:30');
    expect(reminderBody({ dueDate: '2030-06-20', dueTime: '09:30' }, '2030-06-10')).toBe('El 20/06 a las 09:30');
    expect(reminderBody({ dueDate: '2030-06-10', dueTime: null }, '2030-06-10')).toBe('Vence hoy');
    expect(reminderBody({ dueDate: '2030-06-11', dueTime: null }, '2030-06-10')).toBe('Vence mañana');
    expect(reminderBody({ dueDate: '2030-06-20', dueTime: null }, '2030-06-10')).toBe('Vence el 20/06');
  });

  it('digestBody', () => {
    expect(digestBody(1, 0)).toBe('1 para hoy');
    expect(digestBody(0, 1)).toBe('1 vencida');
    expect(digestBody(3, 2)).toBe('3 para hoy · 2 vencidas');
  });
});

describe('recordatorios', () => {
  it('manda el recordatorio a su hora y una sola vez', async () => {
    const user = await userWithDevice();
    const task = await createTask(db, user.id, { title: 'Dentista', ...DUE, reminder: '15m' });
    const { send, calls } = fakeSender();
    expect(await runReminders(db, FIRE, send)).toBe(1);
    expect(calls).toEqual([{
      endpoint: 'https://push.example.com/send/1',
      payload: { title: 'Dentista', body: 'Hoy a las 15:00', url: `/app/list/${task.listId}?t=${task.id}`, tag: `reminder-${task.id}` },
    }]);
    // Ni el mismo tick repetido (otro proceso, reinicio) ni el siguiente lo vuelven a mandar.
    expect(await runReminders(db, FIRE, send)).toBe(0);
    expect(await runReminders(db, at(MIN), send)).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('solo dentro de la ventana (now − 10 min, now]', async () => {
    const user = await userWithDevice();
    await createTask(db, user.id, { title: 'Dentista', ...DUE, reminder: '15m' });
    const { send, calls } = fakeSender();
    expect(await runReminders(db, at(-MIN), send)).toBe(0); // todavía no
    expect(await runReminders(db, at(10 * MIN), send)).toBe(0); // ya pasaron 10 min: se saltea
    expect(calls).toHaveLength(0);
    expect(await runReminders(db, at(9 * MIN), send)).toBe(1); // atrasado pero dentro de la ventana
  });

  it('no avisa tareas completadas ni en la papelera', async () => {
    const user = await userWithDevice();
    const done = await createTask(db, user.id, { title: 'Hecha', ...DUE, reminder: '15m' });
    const trashed = await createTask(db, user.id, { title: 'Borrada', ...DUE, reminder: '15m' });
    await completeTask(db, user.id, done.id);
    await deleteTask(db, user.id, trashed.id);
    const { send, calls } = fakeSender();
    expect(await runReminders(db, FIRE, send)).toBe(0);
    expect(calls).toEqual([]);
  });

  it('quien ya no es miembro de la lista no recibe su recordatorio; el dueño sí', async () => {
    const { owner, member, shared } = await createSharingFixture(db);
    await savePushSubscription(db, owner.id, subscriptionInput(1));
    await savePushSubscription(db, member.id, subscriptionInput(2));
    const task = await createTask(db, owner.id, { title: 'Compartida', listId: shared.id, ...DUE, reminder: '15m' });
    await updateTask(db, member.id, task.id, { reminder: '15m' });
    await removeListMember(db, owner.id, shared.id, member.id);
    const { send, calls } = fakeSender();
    expect(await runReminders(db, FIRE, send)).toBe(1);
    expect(calls.map((c) => c.endpoint)).toEqual(['https://push.example.com/send/1']);
  });

  it('sin dispositivos no hace nada (ni registra la entrega)', async () => {
    const user = await createTestUser(db);
    await createTask(db, user.id, { title: 'Dentista', ...DUE, reminder: '15m' });
    expect(await runReminders(db, FIRE, fakeSender().send)).toBe(0);
    expect(await db.select().from(notificationDeliveries)).toEqual([]);
  });

  it('no manda avisos atrasados de recordatorios puestos después de su hora', async () => {
    const user = await userWithDevice();
    const task = await createTask(db, user.id, { title: 'Dentista', ...DUE, reminder: '15m' });
    await db.update(taskReminders).set({ updatedAt: at(MIN) }).where(eq(taskReminders.taskId, task.id));
    expect(await runReminders(db, at(2 * MIN), fakeSender().send)).toBe(0);
  });

  it('si cambia la hora de la tarea, suena otra vez para el instante nuevo', async () => {
    const user = await userWithDevice();
    const task = await createTask(db, user.id, { title: 'Dentista', ...DUE, reminder: '15m' });
    const { send } = fakeSender();
    expect(await runReminders(db, FIRE, send)).toBe(1);
    await updateTask(db, user.id, task.id, { dueTime: '16:00' });
    expect(await runReminders(db, at(60 * MIN), send)).toBe(1);
  });

  it('tareas sin hora: el día anterior a la hora elegida por el usuario', async () => {
    const user = await userWithDevice();
    await updateNotificationPrefs(db, user.id, { allDayReminderTime: '20:00' });
    await createTask(db, user.id, { title: 'Pagar luz', dueDate: '2030-06-10', reminder: 'day_before' });
    const { send, calls } = fakeSender();
    expect(await runReminders(db, new Date('2030-06-09T23:00:00Z'), send)).toBe(1); // 09/06 20:00 en Buenos Aires
    expect(calls[0].payload).toMatchObject({ title: 'Pagar luz', body: 'Vence mañana' });
  });

  it('borra la suscripción que respondió 410 y sigue con las demás', async () => {
    const user = await userWithDevice('emir@example.com', 1);
    await savePushSubscription(db, user.id, subscriptionInput(2));
    await createTask(db, user.id, { title: 'Dentista', ...DUE, reminder: '15m' });
    const { send, calls } = fakeSender({ 'https://push.example.com/send/1': 'gone' });
    expect(await runReminders(db, FIRE, send)).toBe(1);
    expect(calls).toHaveLength(2);
    expect(await countPushSubscriptions(db, user.id)).toBe(1);
  });

  it('un send que lanza cuenta como fallo y no corta el resto', async () => {
    const a = await userWithDevice('a@example.com', 1);
    const b = await userWithDevice('b@example.com', 2);
    await createTask(db, a.id, { title: 'A', ...DUE, reminder: '15m' });
    await createTask(db, b.id, { title: 'B', ...DUE, reminder: '15m' });
    const sent: string[] = [];
    const send = async (target: { endpoint: string }) => {
      if (target.endpoint.endsWith('/1')) throw new Error('boom');
      sent.push(target.endpoint);
      return 'ok' as const;
    };
    expect(await runReminders(db, FIRE, send)).toBe(1);
    expect(sent).toEqual(['https://push.example.com/send/2']);
  });
});

describe('resumen diario', () => {
  /** 10/06/2030 08:00 en Buenos Aires. */
  const EIGHT = new Date('2030-06-10T11:00:00Z');
  const after = (ms: number) => new Date(EIGHT.getTime() + ms);

  async function digestUser(email = 'emir@example.com', n = 1) {
    const user = await userWithDevice(email, n);
    await updateNotificationPrefs(db, user.id, { digestEnabled: true });
    return user;
  }

  it('a la hora local cuenta hoy y vencidas, una vez por día', async () => {
    const user = await digestUser();
    await createTask(db, user.id, { title: 'Hoy', dueDate: '2030-06-10' });
    await createTask(db, user.id, { title: 'Vencida 1', dueDate: '2030-06-08' });
    await createTask(db, user.id, { title: 'Vencida 2', dueDate: '2030-06-09' });
    await createTask(db, user.id, { title: 'Mañana', dueDate: '2030-06-11' });
    const { send, calls } = fakeSender();
    expect(await runDigests(db, after(-MIN), send)).toBe(0);
    expect(await runDigests(db, after(5 * MIN), send)).toBe(1);
    expect(calls[0].payload).toEqual({ title: 'Tu día en Notas', body: '1 para hoy · 2 vencidas', url: '/app/today', tag: 'digest' });
    expect(await runDigests(db, after(6 * MIN), send)).toBe(0);
    expect(await runDigests(db, after(24 * 60 * MIN), send)).toBe(1); // al día siguiente, otra vez
  });

  it('fuera de la ventana de 10 minutos no se manda', async () => {
    const user = await digestUser();
    await createTask(db, user.id, { title: 'Hoy', dueDate: '2030-06-10' });
    expect(await runDigests(db, after(10 * MIN), fakeSender().send)).toBe(0);
  });

  it('respeta la hora elegida', async () => {
    const user = await digestUser();
    await updateNotificationPrefs(db, user.id, { digestTime: '21:30' });
    await createTask(db, user.id, { title: 'Hoy', dueDate: '2030-06-10' });
    expect(await runDigests(db, EIGHT, fakeSender().send)).toBe(0);
    expect(await runDigests(db, new Date('2030-06-11T00:31:00Z'), fakeSender().send)).toBe(1); // 10/06 21:31
  });

  it('apagado o sin nada para hoy no manda', async () => {
    const off = await userWithDevice('off@example.com', 1);
    await createTask(db, off.id, { title: 'Hoy', dueDate: '2030-06-10' });
    await digestUser('vacio@example.com', 2);
    const { send, calls } = fakeSender();
    expect(await runDigests(db, EIGHT, send)).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe('aviso de asignación', () => {
  it('avisa a la persona asignada, no a quien asigna', async () => {
    const { owner, member, shared } = await createSharingFixture(db);
    await savePushSubscription(db, owner.id, subscriptionInput(1));
    await savePushSubscription(db, member.id, subscriptionInput(2));
    const task = await createTask(db, owner.id, { title: 'Comprar pan', listId: shared.id, assigneeId: member.id });
    const { send, calls } = fakeSender();
    expect(await notifyAssignment(db, { actorId: owner.id, taskId: task.id }, send, FIRE)).toBe(true);
    expect(calls).toEqual([{
      endpoint: 'https://push.example.com/send/2',
      payload: { title: 'Te asignaron una tarea', body: 'Emir te asignó «Comprar pan»', url: `/app/assigned?t=${task.id}`, tag: `assigned-${task.id}` },
    }]);
    // Asignarse uno mismo no avisa.
    expect(await notifyAssignment(db, { actorId: member.id, taskId: task.id }, send, FIRE)).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('respeta la preferencia, el acceso y que la tarea exista y esté asignada', async () => {
    const { owner, member, shared } = await createSharingFixture(db);
    await savePushSubscription(db, member.id, subscriptionInput(2));
    const task = await createTask(db, owner.id, { title: 'Comprar pan', listId: shared.id, assigneeId: member.id });
    const { send } = fakeSender();
    await updateNotificationPrefs(db, member.id, { notifyAssigned: false });
    expect(await notifyAssignment(db, { actorId: owner.id, taskId: task.id }, send, FIRE)).toBe(false);
    await updateNotificationPrefs(db, member.id, { notifyAssigned: true });
    await removeListMember(db, owner.id, shared.id, member.id); // también le quita la asignación
    expect(await notifyAssignment(db, { actorId: owner.id, taskId: task.id }, send, FIRE)).toBe(false);
    expect(await notifyAssignment(db, { actorId: owner.id, taskId: 'no-es-un-id' }, send, FIRE)).toBe(false);
  });
});

describe('entregas, prueba y corrida completa', () => {
  it('claimDelivery es idempotente y purgeOldDeliveries borra lo de más de 30 días', async () => {
    const user = await createTestUser(db);
    const old = new Date('2030-01-01T00:00:00Z');
    expect(await claimDelivery(db, { userId: user.id, kind: 'digest', fireKey: '2030-01-01', now: old })).toBe(true);
    expect(await claimDelivery(db, { userId: user.id, kind: 'digest', fireKey: '2030-01-01', now: old })).toBe(false);
    await claimDelivery(db, { userId: user.id, kind: 'digest', fireKey: '2030-02-05', now: new Date('2030-02-05T00:00:00Z') });
    expect(await purgeOldDeliveries(db, new Date('2030-02-10T00:00:00Z'))).toBe(1);
    expect(await db.select().from(notificationDeliveries)).toHaveLength(1);
  });

  it('sendTestNotification manda a todos los dispositivos del usuario', async () => {
    const user = await userWithDevice('emir@example.com', 1);
    await savePushSubscription(db, user.id, subscriptionInput(2));
    const { send, calls } = fakeSender();
    expect(await sendTestNotification(db, user.id, send, FIRE)).toEqual({ sent: 2, failed: 0, removed: 0 });
    expect(calls[0].payload).toEqual({
      title: 'Notas', body: 'Las notificaciones de Notas funcionan en este dispositivo.', url: '/app/settings', tag: 'test',
    });
  });

  it('runNotifications junta recordatorios y resúmenes', async () => {
    const user = await userWithDevice();
    await createTask(db, user.id, { title: 'Dentista', ...DUE, reminder: '15m' });
    expect(await runNotifications(db, FIRE, fakeSender().send)).toEqual({ reminders: 1, digests: 0 });
  });
});
```

- [ ] **Step 2: Verlos fallar**

Run: `npx vitest run tests/core/notifications.test.ts`
Expected: FAIL — no existe `@/core/notifications`.

- [ ] **Step 3: `src/core/notifications.ts`**

```ts
import { and, eq, gte, inArray, isNotNull, isNull, lt, lte } from 'drizzle-orm';
import { notificationDeliveries, pushSubscriptions, taskReminders, tasks, users } from '@/db/schema';
import type { DB } from '@/db/types';
import { canAccessList } from './access';
import { addDays, todayIn } from './dates';
import { isUuid } from './errors';
import { listPushSubscriptions, recordPushResult, type PushPayload, type PushResult, type SendPush } from './push-subscriptions';
import { fromStored, reminderFireAt } from './reminder-options';
import { listTasks } from './tasks';

/**
 * Motor de notificaciones. No sabe de `web-push` ni de timers: recibe `send` y `now`. Opera sobre TODOS los
 * usuarios (lo llama el programador del proceso): nunca exponer `runNotifications` a usuarios ni por MCP.
 */

export type NotificationKind = 'reminder' | 'digest' | 'assigned' | 'test';

/** Un recordatorio se manda si su instante cayó en (now − 10 min, now]. Más atrasado se saltea. */
export const REMINDER_WINDOW_MS = 10 * 60_000;
/** El resumen diario sale si la hora local está en [hora elegida, hora elegida + 10 min). */
export const DIGEST_WINDOW_MINUTES = 10;
export const DELIVERY_RETENTION_DAYS = 30;
const MAX_TITLE = 120;

/**
 * Reclama una entrega: true si es la primera vez para (usuario, tipo, clave). Se llama ANTES de mandar, así un
 * aviso sale a lo sumo una vez aunque haya reinicios o dos corridas a la vez.
 */
export async function claimDelivery(
  db: DB,
  d: { userId: string; kind: NotificationKind; fireKey: string; taskId?: string | null; now: Date },
): Promise<boolean> {
  const rows = await db
    .insert(notificationDeliveries)
    .values({ userId: d.userId, kind: d.kind, fireKey: d.fireKey, taskId: d.taskId ?? null, sentAt: d.now })
    .onConflictDoNothing()
    .returning({ id: notificationDeliveries.id });
  return rows.length > 0;
}

export interface SendReport {
  sent: number;
  failed: number;
  removed: number;
}

/** Manda el aviso a todos los dispositivos del usuario y registra cada resultado (borra los muertos). */
export async function sendToUser(db: DB, userId: string, payload: PushPayload, send: SendPush, now: Date): Promise<SendReport> {
  const report: SendReport = { sent: 0, failed: 0, removed: 0 };
  for (const sub of await listPushSubscriptions(db, userId)) {
    let result: PushResult;
    try {
      result = await send({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, payload);
    } catch {
      result = 'failed';
    }
    await recordPushResult(db, sub.id, result, now);
    if (result === 'ok') report.sent += 1;
    else if (result === 'gone') report.removed += 1;
    else report.failed += 1;
  }
  return report;
}

function clip(text: string): string {
  return text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE - 1)}…` : text;
}

/** 2030-06-20 → 20/06 */
function dayMonth(isoDate: string): string {
  return `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}`;
}

/** Cuerpo del recordatorio: «Hoy a las 15:00», «Mañana a las 09:30», «Vence hoy», «Vence el 20/06»… */
export function reminderBody(task: { dueDate: string; dueTime: string | null }, today: string): string {
  const tomorrow = addDays(today, 1);
  if (task.dueTime) {
    const day = task.dueDate === today ? 'Hoy' : task.dueDate === tomorrow ? 'Mañana' : `El ${dayMonth(task.dueDate)}`;
    return `${day} a las ${task.dueTime}`;
  }
  if (task.dueDate === today) return 'Vence hoy';
  if (task.dueDate === tomorrow) return 'Vence mañana';
  return `Vence el ${dayMonth(task.dueDate)}`;
}

/** «3 para hoy · 2 vencidas» (se omite la parte en 0). */
export function digestBody(today: number, overdue: number): string {
  const parts: string[] = [];
  if (today > 0) parts.push(`${today} para hoy`);
  if (overdue > 0) parts.push(`${overdue} ${overdue === 1 ? 'vencida' : 'vencidas'}`);
  return parts.join(' · ');
}

/** Subconsulta: usuarios con al menos un dispositivo suscripto. */
function usersWithDevices(db: DB) {
  return db.selectDistinct({ id: pushSubscriptions.userId }).from(pushSubscriptions);
}

/** Manda los recordatorios cuyo instante cayó en la ventana. Devuelve cuántos llegaron a algún dispositivo. */
export async function runReminders(db: DB, now: Date, send: SendPush): Promise<number> {
  // Un recordatorio suena entre el día anterior y el mismo día de la tarea, en la zona del usuario (UTC±14):
  // alcanza con mirar tareas que vencen entre 2 días antes y 2 días después de hoy en UTC.
  const utcToday = todayIn('UTC', now);
  const rows = await db
    .select({
      taskId: tasks.id, listId: tasks.listId, title: tasks.title, dueDate: tasks.dueDate, dueTime: tasks.dueTime,
      userId: taskReminders.userId, kind: taskReminders.kind, offsetMinutes: taskReminders.offsetMinutes,
      setAt: taskReminders.updatedAt, timezone: users.timezone, allDayTime: users.allDayReminderTime,
    })
    .from(taskReminders)
    .innerJoin(tasks, eq(tasks.id, taskReminders.taskId))
    .innerJoin(users, eq(users.id, taskReminders.userId))
    .where(and(
      eq(tasks.status, 'pending'),
      isNull(tasks.deletedAt),
      isNotNull(tasks.dueDate),
      gte(tasks.dueDate, addDays(utcToday, -2)),
      lte(tasks.dueDate, addDays(utcToday, 2)),
      inArray(taskReminders.userId, usersWithDevices(db)),
    ));

  let delivered = 0;
  for (const r of rows) {
    const option = fromStored(r);
    const fireAt = option ? reminderFireAt(r, option, r.timezone, r.allDayTime) : null;
    if (!fireAt) continue;
    const t = fireAt.getTime();
    if (t > now.getTime() || t <= now.getTime() - REMINDER_WINDOW_MS || t < r.setAt.getTime()) continue;
    // La persona puede haber dejado de tener acceso (la sacaron de la lista compartida).
    if (!(await canAccessList(db, r.userId, r.listId))) continue;
    const fireKey = `${r.taskId}:${fireAt.toISOString()}`;
    if (!(await claimDelivery(db, { userId: r.userId, kind: 'reminder', fireKey, taskId: r.taskId, now }))) continue;
    const report = await sendToUser(db, r.userId, {
      title: clip(r.title),
      body: reminderBody({ dueDate: r.dueDate!, dueTime: r.dueTime }, todayIn(r.timezone, now)),
      url: `/app/list/${r.listId}?t=${r.taskId}`,
      tag: `reminder-${r.taskId}`,
    }, send, now);
    if (report.sent > 0) delivered += 1;
  }
  return delivered;
}

/** Fecha y minutos del día locales. */
function localClock(now: Date, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { date: todayIn(timeZone, now), minutes: get('hour') * 60 + get('minute') };
}

function toMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** Resumen diario de Hoy (lo mismo que la vista «Hoy»). Devuelve cuántos llegaron a algún dispositivo. */
export async function runDigests(db: DB, now: Date, send: SendPush): Promise<number> {
  const rows = await db
    .select({ id: users.id, timezone: users.timezone, digestTime: users.digestTime })
    .from(users)
    .where(and(eq(users.digestEnabled, true), inArray(users.id, usersWithDevices(db))));
  let delivered = 0;
  for (const user of rows) {
    const clock = localClock(now, user.timezone);
    const start = toMinutes(user.digestTime);
    if (clock.minutes < start || clock.minutes >= start + DIGEST_WINDOW_MINUTES) continue;
    if (!(await claimDelivery(db, { userId: user.id, kind: 'digest', fireKey: clock.date, now }))) continue;
    const pending = await listTasks(db, user.id, { view: 'today', now, limit: 500 });
    if (pending.length === 0) continue;
    const overdue = pending.filter((t) => t.dueDate !== null && t.dueDate < clock.date).length;
    const report = await sendToUser(db, user.id, {
      title: 'Tu día en Notas', body: digestBody(pending.length - overdue, overdue), url: '/app/today', tag: 'digest',
    }, send, now);
    if (report.sent > 0) delivered += 1;
  }
  return delivered;
}

export interface NotificationsReport {
  reminders: number;
  digests: number;
}

/** Una pasada del programador. */
export async function runNotifications(db: DB, now: Date, send: SendPush): Promise<NotificationsReport> {
  const reminders = await runReminders(db, now, send);
  const digests = await runDigests(db, now, send);
  return { reminders, digests };
}

/**
 * Avisa a la persona asignada a la tarea, si no es quien asignó, tiene el aviso prendido y accede a la lista.
 * El llamador decide si la asignación cambió. Devuelve true si llegó a algún dispositivo.
 */
export async function notifyAssignment(
  db: DB, { actorId, taskId }: { actorId: string; taskId: string }, send: SendPush, now: Date,
): Promise<boolean> {
  if (!isUuid(taskId)) return false;
  const [task] = await db
    .select({ id: tasks.id, title: tasks.title, listId: tasks.listId, assigneeId: tasks.assigneeId, deletedAt: tasks.deletedAt })
    .from(tasks)
    .where(eq(tasks.id, taskId));
  if (!task || !task.assigneeId || task.assigneeId === actorId || task.deletedAt) return false;
  const [assignee] = await db.select({ notifyAssigned: users.notifyAssigned }).from(users).where(eq(users.id, task.assigneeId));
  if (!assignee?.notifyAssigned) return false;
  if (!(await canAccessList(db, task.assigneeId, task.listId))) return false;
  const [actor] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, actorId));
  const who = actor ? actor.name.trim() || actor.email : 'Alguien';
  const fireKey = `${task.id}:${now.toISOString()}`;
  if (!(await claimDelivery(db, { userId: task.assigneeId, kind: 'assigned', fireKey, taskId: task.id, now }))) return false;
  const report = await sendToUser(db, task.assigneeId, {
    title: 'Te asignaron una tarea',
    body: `${who} te asignó «${clip(task.title)}»`,
    url: `/app/assigned?t=${task.id}`,
    tag: `assigned-${task.id}`,
  }, send, now);
  return report.sent > 0;
}

/** «Enviar prueba» de Configuración: a todos los dispositivos del usuario. */
export async function sendTestNotification(db: DB, userId: string, send: SendPush, now: Date): Promise<SendReport> {
  await claimDelivery(db, { userId, kind: 'test', fireKey: `test:${now.toISOString()}`, now });
  return sendToUser(db, userId, {
    title: 'Notas', body: 'Las notificaciones de Notas funcionan en este dispositivo.', url: '/app/settings', tag: 'test',
  }, send, now);
}

/** Borra el registro de entregas viejas (mantenimiento diario). Devuelve cuántas. */
export async function purgeOldDeliveries(db: DB, now: Date = new Date(), days = DELIVERY_RETENTION_DAYS): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(notificationDeliveries)
    .where(lt(notificationDeliveries.sentAt, cutoff))
    .returning({ id: notificationDeliveries.id });
  return deleted.length;
}
```

- [ ] **Step 4: `src/core/index.ts`**

Agregar `export * from './notifications';`.

- [ ] **Step 5: Tests del motor**

Run: `npx vitest run tests/core/notifications.test.ts`
Expected: PASS.

- [ ] **Step 6: Purga en el mantenimiento diario (`src/lib/maintenance.ts`)**

Import: `import { purgeOldDeliveries } from '@/core/notifications';`

`MaintenanceReport` suma `deliveries: number;`. En `runMaintenance`, antes del `return`:

```ts
  const deliveries = await purgeOldDeliveries(db, now);
```

y el `return` pasa a ser:

```ts
  return {
    sessions, trash, oauthCodes: oauth.codes, oauthTokens: oauth.tokens, oauthClients: oauth.clients, deliveries,
  };
```

`formatMaintenanceReport` agrega al final `, avisos: ${r.deliveries}`:

```ts
export function formatMaintenanceReport(r: MaintenanceReport): string {
  return `[mantenimiento] sesiones vencidas: ${r.sessions}, papelera: ${r.trash}, `
    + `OAuth: ${r.oauthCodes} códigos, ${r.oauthTokens} tokens, ${r.oauthClients} clientes, avisos: ${r.deliveries}`;
}
```

Actualizar el comentario de `runMaintenance`: «… y datos OAuth vencidos (…) y el registro de avisos de más de 30 días. Idempotente.»

- [ ] **Step 7: `tests/lib/maintenance.test.ts`**

- `const EMPTY: MaintenanceReport = { sessions: 0, trash: 0, oauthCodes: 0, oauthTokens: 0, oauthClients: 0, deliveries: 0 };`
- En `runMaintenance`: `expect(await runMaintenance(db, now)).toEqual({ sessions: 1, trash: 1, oauthCodes: 0, oauthTokens: 0, oauthClients: 1, deliveries: 0 });`
- En `formatMaintenanceReport`:

```ts
    expect(formatMaintenanceReport({ sessions: 1, trash: 2, oauthCodes: 3, oauthTokens: 4, oauthClients: 5, deliveries: 6 }))
      .toBe('[mantenimiento] sesiones vencidas: 1, papelera: 2, OAuth: 3 códigos, 4 tokens, 5 clientes, avisos: 6');
```

- Buscar en el archivo cualquier otro objeto `MaintenanceReport` literal (`grep -n "oauthClients" tests/lib/maintenance.test.ts`) y sumarle `deliveries`.

- [ ] **Step 8: Tests y commit**

Run: `npx vitest run tests/core/notifications.test.ts tests/lib/maintenance.test.ts`
Expected: PASS.

```powershell
npx tsc --noEmit
npm run lint
git add src/core/notifications.ts src/core/index.ts src/lib/maintenance.ts tests/core/notifications.test.ts tests/lib/maintenance.test.ts
git commit -m @'
feat(core): motor de notificaciones (recordatorios, resumen diario, asignación) idempotente

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 7: Programador cada 60 s y arranque (TDD)

**Files:**
- Create: `src/lib/notification-scheduler.ts`, `tests/lib/notification-scheduler.test.ts`
- Modify: `src/lib/startup.ts`, `tests/lib/startup.test.ts`

- [ ] **Step 1: Tests que fallan — programador**

`tests/lib/notification-scheduler.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationsReport } from '@/core/notifications';
import type { SendPush } from '@/core/push-subscriptions';
import type { DB } from '@/db/types';
import { NOTIFICATIONS_INTERVAL_MS, scheduleNotifications, type NotificationsRun } from '@/lib/notification-scheduler';

const T0 = new Date('2030-01-01T00:00:00Z');
const NONE: NotificationsReport = { reminders: 0, digests: 0 };

describe('scheduleNotifications', () => {
  const fakeDb = {} as DB;
  const send: SendPush = async () => 'ok';

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(run = vi.fn<NotificationsRun>(async () => NONE)) {
    const logger = { log: vi.fn(), error: vi.fn() };
    const getDb = vi.fn(async () => fakeDb);
    const stop = scheduleNotifications({ getDb, send, run, logger, now: () => T0 });
    return { run, logger, stop };
  }

  it('corre cada minuto con la base, el reloj y el send', async () => {
    const { run, stop } = setup();
    await vi.advanceTimersByTimeAsync(NOTIFICATIONS_INTERVAL_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledWith(fakeDb, T0, send);
    await vi.advanceTimersByTimeAsync(2 * NOTIFICATIONS_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(5 * NOTIFICATIONS_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('loguea solo cuando mandó algo', async () => {
    const run = vi.fn<NotificationsRun>()
      .mockResolvedValueOnce(NONE)
      .mockResolvedValueOnce({ reminders: 2, digests: 1 });
    const { logger, stop } = setup(run);
    await vi.advanceTimersByTimeAsync(2 * NOTIFICATIONS_INTERVAL_MS);
    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith('[notificaciones] recordatorios: 2, resúmenes: 1');
    stop();
  });

  it('no se solapa con una corrida lenta y un error solo se loguea', async () => {
    let finish: () => void = () => {};
    const run = vi.fn<NotificationsRun>()
      .mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve(NONE); }))
      .mockRejectedValueOnce(new Error('boom'));
    const { logger, stop } = setup(run);
    await vi.advanceTimersByTimeAsync(3 * NOTIFICATIONS_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(1); // la primera sigue corriendo
    finish();
    await vi.advanceTimersByTimeAsync(NOTIFICATIONS_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith('[notificaciones] falló:', expect.any(Error));
    stop();
  });
});
```

- [ ] **Step 2: Tests que fallan — arranque (`tests/lib/startup.test.ts`)**

Cambiar el import de startup por:

```ts
import { MAINTENANCE_FLAG, NOTIFICATIONS_FLAG, startServer } from '@/lib/startup';
import type { SendPush } from '@/core/push-subscriptions';
```

Agregar al final del archivo:

```ts
describe('notificaciones al arrancar', () => {
  const g = globalThis as Record<string, unknown>;
  beforeEach(() => {
    delete g[MAINTENANCE_FLAG];
    delete g[NOTIFICATIONS_FLAG];
  });

  function withPush(env: Env, pushSender: SendPush | null) {
    return { ...deps(env), pushSender, scheduleNotifications: vi.fn(() => () => {}) };
  }

  it('con claves VAPID programa el envío una sola vez por proceso', async () => {
    const send = vi.fn<SendPush>();
    const a = withPush({ NODE_ENV: 'production' }, send);
    await startServer(a);
    expect(a.scheduleNotifications).toHaveBeenCalledWith({ getDb: a.getDb, send, logger: a.logger });
    expect(a.logger.log).toHaveBeenCalledWith('[notas] notificaciones push activas');
    const b = withPush({ NODE_ENV: 'production' }, send);
    await startServer(b);
    expect(b.scheduleNotifications).not.toHaveBeenCalled();
  });

  it('sin claves no programa nada y lo dice en el log', async () => {
    const d = withPush({ NODE_ENV: 'production' }, null);
    await startServer(d);
    expect(d.scheduleNotifications).not.toHaveBeenCalled();
    expect(d.logger.log).toHaveBeenCalledWith(
      '[notas] notificaciones push desactivadas (faltan VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY o VAPID_SUBJECT)',
    );
  });

  it('en tests o con NOTAS_DISABLE_MAINTENANCE=1 tampoco', async () => {
    const send = vi.fn<SendPush>();
    const enTests = withPush({ NODE_ENV: 'test' }, send);
    await startServer(enTests);
    const desactivado = withPush({ NODE_ENV: 'production', NOTAS_DISABLE_MAINTENANCE: '1' }, send);
    await startServer(desactivado);
    expect(enTests.scheduleNotifications).not.toHaveBeenCalled();
    expect(desactivado.scheduleNotifications).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Verlos fallar**

Run: `npx vitest run tests/lib/notification-scheduler.test.ts tests/lib/startup.test.ts`
Expected: FAIL — no existe `@/lib/notification-scheduler` / `NOTIFICATIONS_FLAG`.

- [ ] **Step 4: `src/lib/notification-scheduler.ts`**

```ts
import { runNotifications, type NotificationsReport } from '@/core/notifications';
import type { SendPush } from '@/core/push-subscriptions';
import type { DB } from '@/db/types';
import type { Logger } from './maintenance';

/** Cada minuto: los recordatorios tienen una ventana de 10 min, así que un tick perdido no pierde avisos. */
export const NOTIFICATIONS_INTERVAL_MS = 60_000;

export type NotificationsRun = (db: DB, now: Date, send: SendPush) => Promise<NotificationsReport>;

export interface NotificationScheduleOptions {
  getDb: () => Promise<DB>;
  send: SendPush;
  run?: NotificationsRun;
  logger?: Logger;
  intervalMs?: number;
  now?: () => Date;
}

/**
 * Programa el envío de notificaciones cada `intervalMs`. El timer no mantiene vivo el proceso (`unref`), una
 * corrida nunca se solapa con la anterior y un error solo se loguea. Devuelve una función que lo cancela.
 */
export function scheduleNotifications({
  getDb,
  send,
  run = runNotifications,
  logger = console,
  intervalMs = NOTIFICATIONS_INTERVAL_MS,
  now = () => new Date(),
}: NotificationScheduleOptions): () => void {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const report = await run(await getDb(), now(), send);
      if (report.reminders > 0 || report.digests > 0) {
        logger.log(`[notificaciones] recordatorios: ${report.reminders}, resúmenes: ${report.digests}`);
      }
    } catch (err) {
      logger.error('[notificaciones] falló:', err);
    } finally {
      running = false;
    }
  };

  const interval = setInterval(() => void tick(), intervalMs);
  interval.unref?.();
  return () => clearInterval(interval);
}
```

- [ ] **Step 5: `src/lib/startup.ts`**

Imports nuevos:

```ts
import type { SendPush } from '@/core/push-subscriptions';
import { scheduleNotifications as defaultScheduleNotifications, type NotificationScheduleOptions } from './notification-scheduler';
import { getPushSender } from './push';
```

Debajo de `MAINTENANCE_FLAG`:

```ts
/** Igual que MAINTENANCE_FLAG, para el programador de notificaciones. */
export const NOTIFICATIONS_FLAG = '__notasNotificationsScheduled';
```

`StartupDeps` suma:

```ts
  /** Cómo mandar push; por defecto, el configurado con VAPID_* (null = notificaciones apagadas). */
  pushSender?: SendPush | null;
  scheduleNotifications?: (options: NotificationScheduleOptions) => () => void;
```

Firma de `startServer` (los defaults de la desestructuración pueden usar `env`, que se declara antes):

```ts
export async function startServer({
  getDb,
  env = process.env,
  exit = (code) => process.exit(code),
  logger = console,
  schedule = scheduleMaintenance,
  pushSender = getPushSender(env),
  scheduleNotifications = defaultScheduleNotifications,
}: StartupDeps): Promise<void> {
```

Y al final de la función, después del bloque del mantenimiento:

```ts
  // Mismo interruptor que la limpieza: nada en tests ni con NOTAS_DISABLE_MAINTENANCE=1 (los e2e).
  if (maintenanceEnabled(env) && !g[NOTIFICATIONS_FLAG]) {
    if (pushSender) {
      g[NOTIFICATIONS_FLAG] = true;
      scheduleNotifications({ getDb, send: pushSender, logger });
      logger.log('[notas] notificaciones push activas');
    } else {
      logger.log('[notas] notificaciones push desactivadas (faltan VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY o VAPID_SUBJECT)');
    }
  }
```

Actualizar el comentario de `startServer`: «… Después programa la limpieza diaria y, si hay claves VAPID, el envío de notificaciones cada minuto.»

- [ ] **Step 6: Tests y commit**

Run: `npx vitest run tests/lib/notification-scheduler.test.ts tests/lib/startup.test.ts tests/lib/maintenance.test.ts`
Expected: PASS (los tests viejos de `startServer` siguen pasando: sin `VAPID_*` en su `env`, `getPushSender` devuelve null y no se programa nada).

```powershell
npx tsc --noEmit
npm run lint
git add src/lib/notification-scheduler.ts src/lib/startup.ts tests/lib/notification-scheduler.test.ts tests/lib/startup.test.ts
git commit -m @'
feat(notificaciones): programador cada minuto, arrancado solo si hay claves VAPID

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 8: Acciones del servidor — recordatorio, asignación, suscripción, preferencias y prueba

**Files:**
- Create: `src/lib/notify.ts`, `tests/lib/notify.test.ts`
- Modify: `src/app/app/actions.ts`

- [ ] **Step 1: Tests que fallan (`tests/lib/notify.test.ts`)**

```ts
import { describe, expect, it, vi } from 'vitest';
import { savePushSubscription } from '@/core/push-subscriptions';
import { createTask } from '@/core/tasks';
import { assignmentChanged, notifyAssignmentSafely } from '@/lib/notify';
import { createTestDb } from '../helpers/db';
import { fakeSender, subscriptionInput } from '../helpers/push';
import { createSharingFixture } from '../helpers/sharing';

describe('assignmentChanged', () => {
  it('solo cuando queda asignada a otra persona distinta de antes', () => {
    expect(assignmentChanged(null, 'b', 'a')).toBe(true);
    expect(assignmentChanged('c', 'b', 'a')).toBe(true);
    expect(assignmentChanged('b', 'b', 'a')).toBe(false); // no cambió
    expect(assignmentChanged(null, 'a', 'a')).toBe(false); // me la asigné yo
    expect(assignmentChanged('b', null, 'a')).toBe(false); // se quitó
  });
});

describe('notifyAssignmentSafely', () => {
  it('avisa; sin sender no hace nada; un error no se propaga', async () => {
    const db = await createTestDb();
    const { owner, member, shared } = await createSharingFixture(db);
    await savePushSubscription(db, member.id, subscriptionInput(2));
    const task = await createTask(db, owner.id, { title: 'Comprar pan', listId: shared.id, assigneeId: member.id });
    const { send, calls } = fakeSender();
    await notifyAssignmentSafely(db, owner.id, task.id, send);
    expect(calls).toHaveLength(1);
    await expect(notifyAssignmentSafely(db, owner.id, task.id, null)).resolves.toBeUndefined();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { ...db, select: () => { throw new Error('base caída'); } } as unknown as typeof db;
    await expect(notifyAssignmentSafely(broken, owner.id, task.id, send)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Verlo fallar**

Run: `npx vitest run tests/lib/notify.test.ts`
Expected: FAIL — no existe `@/lib/notify`.

- [ ] **Step 3: `src/lib/notify.ts`**

```ts
import { notifyAssignment } from '@/core/notifications';
import type { SendPush } from '@/core/push-subscriptions';
import type { DB } from '@/db/types';
import { getPushSender } from './push';

/** ¿Hay que avisar? La tarea quedó asignada a alguien distinto de antes y que no es quien la asignó. */
export function assignmentChanged(before: string | null, after: string | null, actorId: string): boolean {
  return after !== null && after !== before && after !== actorId;
}

/**
 * Aviso de asignación para la web y el MCP. Un fallo del push (o de la base) no debe romper la acción que asignó:
 * solo se loguea. `send` null = notificaciones apagadas.
 */
export async function notifyAssignmentSafely(
  db: DB, actorId: string, taskId: string, send: SendPush | null = getPushSender(), now: Date = new Date(),
): Promise<void> {
  if (!send) return;
  try {
    await notifyAssignment(db, { actorId, taskId }, send, now);
  } catch (err) {
    console.error('[notificaciones] falló el aviso de asignación:', err);
  }
}
```

- [ ] **Step 4: Correr el test**

Run: `npx vitest run tests/lib/notify.test.ts`
Expected: PASS.

- [ ] **Step 5: `src/app/app/actions.ts`**

Imports nuevos (junto a los existentes):

```ts
import { after } from 'next/server';
import { updateNotificationPrefs, type NotificationPrefs } from '@/core/notification-prefs';
import { sendTestNotification } from '@/core/notifications';
import { countPushSubscriptions, deletePushSubscription, savePushSubscription } from '@/core/push-subscriptions';
import { assignmentChanged, notifyAssignmentSafely } from '@/lib/notify';
import { getPushSender } from '@/lib/push';
```

y sumar `getTask` al import de `@/core/tasks`.

Reemplazar `updateTaskAction` por:

```ts
export async function updateTaskAction(taskId: string, input: UpdateTaskInput) {
  // Solo los campos editables: el resto (listId, status, externalId...) no se acepta del cliente.
  return act(async (db, user) => {
    const { title, description, dueDate, dueTime, priority, tags, subtasks, assigneeId, reminder } = input;
    const before = assigneeId !== undefined ? (await getTask(db, user.id, taskId)).assigneeId : null;
    const task = await updateTask(db, user.id, taskId, {
      title, description, dueDate, dueTime, priority, tags, subtasks, assigneeId, reminder,
    });
    if (assigneeId !== undefined && assignmentChanged(before, task.assigneeId, user.id)) {
      // Después de responder: el push no demora la interfaz.
      after(() => notifyAssignmentSafely(db, user.id, task.id));
    }
  });
}
```

Agregar al final del archivo:

```ts
// ---------- Notificaciones ----------

const PUSH_OFF = 'Las notificaciones no están configuradas en este servidor (faltan las claves VAPID).';
const subscribeLimiter = createRateLimiter({ max: 20, windowMs: 60 * 60 * 1000 });
const testPushLimiter = createRateLimiter({ max: 5, windowMs: 60 * 1000 });

/** Datos de `PushSubscription.toJSON()` más el user agent. Se validan en el núcleo. */
export interface PushSubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}

/** Guarda la suscripción de este dispositivo. Devuelve en cuántos dispositivos quedan activadas. */
export async function savePushSubscriptionAction(input: PushSubscriptionPayload) {
  return act(async (db, user) => {
    if (!getPushSender()) throw new ValidationError(PUSH_OFF);
    if (!subscribeLimiter.check(user.id)) throw new ValidationError('Demasiados intentos seguidos. Probá más tarde.');
    await savePushSubscription(db, user.id, input);
    return { devices: await countPushSubscriptions(db, user.id) };
  });
}

export async function deletePushSubscriptionAction(endpoint: string) {
  return act(async (db, user) => {
    await deletePushSubscription(db, user.id, endpoint);
    return { devices: await countPushSubscriptions(db, user.id) };
  });
}

export async function sendTestNotificationAction() {
  return act(async (db, user) => {
    const send = getPushSender();
    if (!send) throw new ValidationError(PUSH_OFF);
    if (!testPushLimiter.check(user.id)) throw new ValidationError('Esperá un momento antes de mandar otra prueba.');
    const report = await sendTestNotification(db, user.id, send, new Date());
    if (report.sent === 0) {
      throw new ValidationError('No llegó a ningún dispositivo. Desactivá y volvé a activar las notificaciones en este dispositivo.');
    }
    return { sent: report.sent };
  });
}

export async function updateNotificationPrefsAction(input: Partial<NotificationPrefs>) {
  return act((db, user) => updateNotificationPrefs(db, user.id, input));
}
```

(`createRateLimiter` y `ValidationError` ya están importados en este archivo.)

- [ ] **Step 6: Tipos, lint, tests y commit**

```powershell
npx tsc --noEmit
npm run lint
npx vitest run tests/lib tests/core
git add src/lib/notify.ts tests/lib/notify.test.ts src/app/app/actions.ts
git commit -m @'
feat(web): acciones de recordatorio, suscripción push, preferencias, prueba y aviso de asignación

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 9: MCP — `reminder` en `create_task` / `update_task` y aviso de asignación (TDD)

**Files:**
- Create: `tests/mcp/tools-reminders.test.ts`
- Modify: `src/mcp/tools.ts`, `src/mcp/format.ts`, `tests/mcp/tools-tasks.test.ts`

- [ ] **Step 1: Tests que fallan**

`tests/mcp/tools-tasks.test.ts`: en `TASK_KEYS` agregar `'reminder'` en orden alfabético:

```ts
const TASK_KEYS = [
  'assignee', 'completed_at', 'deleted_at', 'description', 'due_date', 'due_time', 'id', 'list_folder', 'list_id', 'list_name',
  'other_tags', 'priority', 'reminder', 'status', 'subtasks', 'tags', 'title',
];
```

y en el `toMatchObject` del primer test (`create_task con todos los campos…`) sumar `reminder: null`.

`tests/mcp/tools-reminders.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { savePushSubscription } from '@/core/push-subscriptions';
import type { DB } from '@/db/types';
import type { ToolContext } from '@/mcp/tools';
import { createTestDb } from '../helpers/db';
import { callError, callOk } from '../helpers/mcp';
import { fakeSender, subscriptionInput } from '../helpers/push';
import { createSharingFixture } from '../helpers/sharing';

let db: DB;
let fixture: Awaited<ReturnType<typeof createSharingFixture>>;
let sender: ReturnType<typeof fakeSender>;
let owner: ToolContext;
let member: ToolContext;

beforeEach(async () => {
  db = await createTestDb();
  fixture = await createSharingFixture(db);
  sender = fakeSender();
  owner = { db, userId: fixture.owner.id, sendPush: sender.send };
  member = { db, userId: fixture.member.id, sendPush: sender.send };
  await savePushSubscription(db, fixture.member.id, subscriptionInput(2));
});

describe('reminder', () => {
  it('create_task y update_task ponen, cambian y quitan el recordatorio de quien llama', async () => {
    const task = await callOk(owner, 'create_task', { title: 'Dentista', due_date: '2030-06-10', due_time: '15:00', reminder: '30m' });
    expect(task.reminder).toBe('30m');
    expect((await callOk(owner, 'get_task', { task_id: task.id })).reminder).toBe('30m');
    expect((await callOk(owner, 'update_task', { task_id: task.id, reminder: 'at_time' })).reminder).toBe('at_time');
    expect((await callOk(owner, 'update_task', { task_id: task.id, reminder: null })).reminder).toBeNull();
  });

  it('valida la opción y que la tarea tenga fecha (y hora para las opciones «antes»)', async () => {
    expect(await callError(owner, 'create_task', { title: 'X', due_date: '2030-06-10', reminder: '2h' })).toContain('Argumentos inválidos');
    expect(await callError(owner, 'create_task', { title: 'X', reminder: 'same_day' })).toContain('necesita fecha');
    expect(await callError(owner, 'create_task', { title: 'X', due_date: '2030-06-10', reminder: '15m' })).toContain('same_day');
    const ok = await callOk(owner, 'create_task', { title: 'Luz', due_date: '2030-06-10', reminder: 'day_before' });
    expect(ok.reminder).toBe('day_before');
  });

  it('cada persona ve y pone solo el suyo', async () => {
    const task = await callOk(owner, 'create_task', {
      title: 'Compartida', list_id: fixture.shared.id, due_date: '2030-06-10', reminder: 'same_day',
    });
    expect((await callOk(member, 'get_task', { task_id: task.id })).reminder).toBeNull();
    await callOk(member, 'update_task', { task_id: task.id, reminder: 'day_before' });
    expect((await callOk(owner, 'get_task', { task_id: task.id })).reminder).toBe('same_day');
    expect((await callOk(member, 'list_tasks', { list_id: fixture.shared.id })).tasks[0].reminder).toBe('day_before');
  });
});

describe('aviso de asignación por MCP', () => {
  it('create_task con assignee_email avisa a la persona asignada', async () => {
    const task = await callOk(owner, 'create_task', {
      title: 'Comprar pan', list_id: fixture.shared.id, assignee_email: fixture.member.email,
    });
    expect(sender.calls).toEqual([{
      endpoint: 'https://push.example.com/send/2',
      payload: { title: 'Te asignaron una tarea', body: 'Emir te asignó «Comprar pan»', url: `/app/assigned?t=${task.id}`, tag: `assigned-${task.id}` },
    }]);
  });

  it('update_task avisa solo si la asignación cambia a otra persona', async () => {
    const task = await callOk(owner, 'create_task', { title: 'Comprar pan', list_id: fixture.shared.id });
    expect(sender.calls).toHaveLength(0);
    await callOk(owner, 'update_task', { task_id: task.id, assignee_email: fixture.member.email });
    expect(sender.calls).toHaveLength(1);
    await callOk(owner, 'update_task', { task_id: task.id, assignee_email: fixture.member.email }); // igual que antes
    await callOk(owner, 'update_task', { task_id: task.id, title: 'Comprar pan integral' }); // sin tocar la asignación
    await callOk(member, 'update_task', { task_id: task.id, assignee_email: fixture.owner.email }); // se la pasa al dueño (sin dispositivos)
    expect(sender.calls).toHaveLength(1);
  });

  it('sin sender (notificaciones apagadas) asigna igual', async () => {
    const off: ToolContext = { db, userId: fixture.owner.id, sendPush: null };
    const task = await callOk(off, 'create_task', { title: 'Sin push', list_id: fixture.shared.id, assignee_email: fixture.member.email });
    expect(task.assignee).toBe(fixture.member.email);
    expect(sender.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Verlos fallar**

Run: `npx vitest run tests/mcp/tools-reminders.test.ts tests/mcp/tools-tasks.test.ts`
Expected: FAIL — `reminder` no está en el esquema (`Argumentos inválidos` por `.strict()`), falta la clave en la salida y `sendPush` no existe en `ToolContext`.

- [ ] **Step 3: `src/mcp/format.ts`**

En `formatTask`, después de `assignee: task.assignee?.email ?? null,`:

```ts
    reminder: task.reminder,
```

- [ ] **Step 4: `src/mcp/tools.ts`**

Imports nuevos:

```ts
import type { SendPush } from '@/core/push-subscriptions';
import { REMINDER_OPTIONS } from '@/core/reminder-options';
import { assignmentChanged, notifyAssignmentSafely } from '@/lib/notify';
import { getPushSender } from '@/lib/push';
```

`ToolContext` suma:

```ts
  /** Cómo mandar push (para tests). Sin el campo: el configurado con VAPID_*; null = sin avisos. */
  sendPush?: SendPush | null;
```

Debajo de `createdViaFor`:

```ts
function senderOf(ctx: ToolContext): SendPush | null {
  return ctx.sendPush !== undefined ? ctx.sendPush : getPushSender();
}
```

En la sección de esquemas de tareas (debajo de `tagNames`):

```ts
const reminder = z.enum(REMINDER_OPTIONS).nullable().describe(
  'Recordatorio para vos (quien llama; cada persona tiene el suyo): at_time, 5m, 15m, 30m, 1h o 1d antes de la '
  + 'fecha y hora (requieren due_time); same_day o day_before a la hora de recordatorios sin hora del usuario '
  + '(09:00 por defecto) el mismo día o el anterior (para tareas sin hora). null lo quita. Llega como notificación '
  + 'push a los dispositivos donde el usuario activó las notificaciones en Notas.',
);
```

En la descripción de `list_tasks`, agregar al final: `+ ' reminder es tu recordatorio en la tarea (o null).'`

`create_task`:
- descripción: agregar al final `+ ' reminder: recordatorio para vos (si no lo mandás y la tarea tiene hora, se aplica tu recordatorio por defecto).'`
- input: agregar `reminder: reminder.optional(),`
- `run`:

```ts
    run: async (ctx, args) => {
      const listId = args.list_id ?? (await getInbox(ctx.db, ctx.userId)).id;
      const assigneeId = args.assignee_email !== undefined
        ? await resolveAssignee(ctx, listId, args.assignee_email)
        : undefined;
      const task = await createTask(ctx.db, ctx.userId, {
        title: args.title, description: args.description, listId, dueDate: args.due_date, dueTime: args.due_time,
        priority: args.priority, tags: args.tags, subtasks: args.subtasks, assigneeId, reminder: args.reminder,
        createdVia: createdViaFor(ctx),
      });
      if (task.assigneeId && assignmentChanged(null, task.assigneeId, ctx.userId)) {
        await notifyAssignmentSafely(ctx.db, ctx.userId, task.id, senderOf(ctx));
      }
      return taskOut(ctx, task);
    },
```

`update_task`:
- descripción: agregar `+ ' reminder: tu recordatorio (null lo quita).'`
- input: agregar `reminder: reminder.optional(),`
- `run`:

```ts
    run: async (ctx, args) => {
      const input: UpdateTaskInput = {
        title: args.title, description: args.description, dueDate: args.due_date, dueTime: args.due_time,
        priority: args.priority, tags: args.tags, subtasks: args.subtasks, reminder: args.reminder,
      };
      let before: string | null = null;
      if (args.assignee_email !== undefined) {
        const current = await getTask(ctx.db, ctx.userId, args.task_id);
        before = current.assigneeId;
        input.assigneeId = await resolveAssignee(ctx, current.listId, args.assignee_email);
      }
      const task = await updateTask(ctx.db, ctx.userId, args.task_id, input);
      if (args.assignee_email !== undefined && assignmentChanged(before, task.assigneeId, ctx.userId)) {
        await notifyAssignmentSafely(ctx.db, ctx.userId, task.id, senderOf(ctx));
      }
      return taskOut(ctx, task);
    },
```

- [ ] **Step 5: Tests**

Run: `npx vitest run tests/mcp tests/routes/mcp.test.ts`
Expected: PASS. (El test de ruta usa el sender por defecto: sin `VAPID_*` en el entorno de Vitest es `null` y no se manda nada.)

- [ ] **Step 6: Commit**

```powershell
npx tsc --noEmit
npm run lint
git add src/mcp/tools.ts src/mcp/format.ts tests/mcp/tools-tasks.test.ts tests/mcp/tools-reminders.test.ts
git commit -m @'
feat(mcp): recordatorio en create_task/update_task y aviso de asignación

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 10: Service worker, headers de `/sw.js` e ícono monocromo

**Files:**
- Create: `public/sw.js`, `public/icons/badge-96.png`
- Modify: `next.config.ts`, `scripts/generate-icons.mjs`, `eslint.config.mjs`

- [ ] **Step 1: `public/sw.js`**

```js
/*
 * Service worker de Notas: solo notificaciones push (sin caché offline ni manejo de fetch).
 * Se registra desde Configuración → Notificaciones cuando el usuario las activa (scope "/").
 * El servidor manda JSON { title, body, url, tag } (src/core/notifications.ts).
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const FALLBACK_PATH = '/app/today';

/** Solo URLs del propio sitio: un payload con otra URL abre Hoy. */
function sameOriginUrl(raw) {
  try {
    const url = new URL(typeof raw === 'string' ? raw : FALLBACK_PATH, self.location.origin);
    return url.origin === self.location.origin ? url.href : new URL(FALLBACK_PATH, self.location.origin).href;
  } catch {
    return new URL(FALLBACK_PATH, self.location.origin).href;
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Notas';
  const tag = typeof data.tag === 'string' && data.tag ? data.tag : undefined;
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      lang: 'es',
      tag,
      // Con el mismo tag (misma tarea) reemplaza al aviso anterior y vuelve a sonar.
      renotify: Boolean(tag),
      data: { url: sameOriginUrl(data.url) },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = sameOriginUrl(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      try {
        await client.focus();
        await client.navigate(url);
        return;
      } catch {
        // La ventana no está controlada por este service worker (navigate lanza): se abre una nueva.
      }
    }
    await self.clients.openWindow(url);
  })());
});
```

- [ ] **Step 2: Headers y paquete externo (`next.config.ts`)**

`serverExternalPackages: ['@electric-sql/pglite', 'web-push'],`

y en `headers()`, después del bloque de `/registro`:

```ts
      // Service worker: siempre fresco (con updateViaCache: 'none' el navegador revalida sw.js en cada chequeo).
      // Scope "/": sw.js está en la raíz, así que no hace falta Service-Worker-Allowed.
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
```

- [ ] **Step 3: ESLint no revisa `public/`**

En `eslint.config.mjs`, agregar `"public/**",` a `ignores` (el service worker usa los globales `self`/`clients` del entorno de service worker, que la configuración de Next no conoce; es el único JS de `public/`).

- [ ] **Step 4: Ícono monocromo (`badge`)**

En `scripts/generate-icons.mjs`, antes de `console.log('íconos generados');`:

```js
// Badge de las notificaciones (Android lo pinta como silueta): solo el tilde blanco sobre transparente.
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <path d="M128 268 L216 356 L384 184" fill="none" stroke="#FFFFFF" stroke-width="76" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
writeFileSync('public/icons/badge-96.png', await png(badge, 96));
```

Generar **solo** el badge (sin tocar los demás íconos) con el mismo código:

```powershell
node --input-type=module -e "import sharp from 'sharp'; import { writeFileSync } from 'node:fs'; const svg = '<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\"><path d=\"M128 268 L216 356 L384 184\" fill=\"none\" stroke=\"#FFFFFF\" stroke-width=\"76\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>'; writeFileSync('public/icons/badge-96.png', await sharp(Buffer.from(svg), { density: 384 }).resize(96, 96).png().toBuffer()); console.log('ok');"
git status --short public src/app
```

Expected: `ok` y solo `?? public/icons/badge-96.png` como nuevo (si PowerShell rompe las comillas, correr la línea desde Git Bash con comillas simples externas). Abrir el PNG con la herramienta Read para ver el tilde blanco.

- [ ] **Step 5: Verificar `/sw.js` en el servidor de desarrollo**

En PowerShell, `npm run dev` (dejarlo corriendo) y en otra terminal:

```powershell
curl.exe -sI http://localhost:3000/sw.js
```

Expected: `200`, `Content-Type: application/javascript; charset=utf-8`, `Cache-Control` con `no-cache` o `no-store` (en desarrollo Next puede agregar los suyos). Cortar el servidor.

- [ ] **Step 6: Commit**

```powershell
npx tsc --noEmit
npm run lint
git add public/sw.js public/icons/badge-96.png next.config.ts scripts/generate-icons.mjs eslint.config.mjs
git commit -m @'
feat(pwa): service worker de notificaciones y headers sin caché para /sw.js

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 11: Configuración → «Notificaciones»

**Files:**
- Create: `src/components/push-device.tsx`, `src/components/notification-prefs-form.tsx`
- Modify: `src/app/app/settings/page.tsx`

- [ ] **Step 1: `src/components/push-device.tsx`**

```tsx
'use client';

import { Bell, BellOff, BellRing, Send } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { deletePushSubscriptionAction, savePushSubscriptionAction, sendTestNotificationAction } from '@/app/app/actions';
import { btn } from './ui';

type Support = 'checking' | 'unsupported' | 'ios-install' | 'denied' | 'ready';

/** Clave VAPID pública (base64url) → bytes para `applicationServerKey`. */
function base64UrlToBuffer(base64: string): ArrayBuffer {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

function sameKey(a: ArrayBuffer | null, b: ArrayBuffer): boolean {
  if (!a || a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  return x.every((v, i) => v === y[i]);
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Activar/desactivar las notificaciones en ESTE dispositivo. El service worker se registra recién al activar.
 * `publicKey` null = el servidor no tiene claves VAPID (todo deshabilitado, con la explicación).
 */
export function PushDevice({ publicKey, devices: initialDevices }: { publicKey: string | null; devices: number }) {
  const [support, setSupport] = useState<Support>('checking');
  const [subscribed, setSubscribed] = useState(false);
  const [devices, setDevices] = useState(initialDevices);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => setDevices(initialDevices), [initialDevices]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        if (!cancelled) setSupport(isIos() && !isStandalone() ? 'ios-install' : 'unsupported');
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (cancelled) return;
      setSubscribed(subscription !== null);
      setSupport(Notification.permission === 'denied' ? 'denied' : 'ready');
    })().catch(() => {
      if (!cancelled) setSupport('unsupported');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function enable() {
    if (!publicKey) return;
    setMessage(null);
    // iPhone/iPad: el pedido de permiso tiene que salir directo del clic, antes de cualquier await.
    const permission = Notification.requestPermission();
    startTransition(async () => {
      try {
        if ((await permission) !== 'granted') {
          if (Notification.permission === 'denied') setSupport('denied');
          setMessage({ ok: false, text: 'No diste permiso para mostrar notificaciones.' });
          return;
        }
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
        await navigator.serviceWorker.ready;
        const key = base64UrlToBuffer(publicKey);
        let subscription = await registration.pushManager.getSubscription();
        // Una suscripción hecha con otras claves (si se regeneraron en el servidor) no sirve: se rehace.
        if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
          await subscription.unsubscribe();
          subscription = null;
        }
        subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        const json = subscription.toJSON();
        const result = await savePushSubscriptionAction({
          endpoint: json.endpoint ?? subscription.endpoint,
          keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
          userAgent: navigator.userAgent,
        });
        if (!result.ok) {
          await subscription.unsubscribe();
          setMessage({ ok: false, text: result.error });
          return;
        }
        setSubscribed(true);
        setDevices(result.data.devices);
        setMessage({ ok: true, text: 'Listo: este dispositivo va a recibir tus avisos.' });
      } catch {
        setMessage({ ok: false, text: 'No se pudieron activar las notificaciones en este navegador.' });
      }
    });
  }

  function disable() {
    setMessage(null);
    startTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration('/');
        const subscription = registration ? await registration.pushManager.getSubscription() : null;
        if (subscription) {
          const result = await deletePushSubscriptionAction(subscription.endpoint);
          if (result.ok) setDevices(result.data.devices);
          await subscription.unsubscribe();
        }
        setSubscribed(false);
        setMessage({ ok: true, text: 'Este dispositivo ya no va a recibir avisos.' });
      } catch {
        setMessage({ ok: false, text: 'No se pudieron desactivar. Probá de nuevo.' });
      }
    });
  }

  function sendTest() {
    setMessage(null);
    startTransition(async () => {
      const result = await sendTestNotificationAction();
      setMessage(result.ok
        ? { ok: true, text: result.data.sent === 1 ? 'Prueba enviada a 1 dispositivo.' : `Prueba enviada a ${result.data.sent} dispositivos.` }
        : { ok: false, text: result.error });
    });
  }

  const status = !publicKey
    ? 'Las notificaciones no están configuradas en este servidor: faltan las claves VAPID.'
    : support === 'checking' ? 'Revisando este navegador…'
    : support === 'ios-install' ? 'En iPhone y iPad, primero agregá Notas a la pantalla de inicio (Compartir → «Agregar a inicio») y abrila desde ese ícono.'
    : support === 'unsupported' ? 'Este navegador no admite notificaciones push.'
    : support === 'denied' ? 'Bloqueaste las notificaciones de Notas en este navegador: habilitalas en la configuración del sitio y volvé a intentar.'
    : subscribed ? 'Activadas en este dispositivo.'
    : 'Desactivadas en este dispositivo.';

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-selected text-accent">
          {subscribed ? <BellRing size={17} /> : <Bell size={17} />}
        </span>
        <div className="min-w-0">
          <p className="font-semibold">Este dispositivo</p>
          <p className="text-caption text-pretty text-muted">{status}</p>
          {devices > 0 && (
            <p className="mt-1 text-meta text-muted">
              Activadas en {devices === 1 ? '1 dispositivo' : `${devices} dispositivos`} en total.
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {subscribed ? (
          <button type="button" onClick={disable} disabled={pending} className={`${btn.secondary} h-9 px-3 text-[13px]`}>
            <BellOff size={14} aria-hidden="true" />
            Desactivar en este dispositivo
          </button>
        ) : (
          <button
            type="button" onClick={enable} disabled={!publicKey || support !== 'ready' || pending}
            className={`${btn.primary} h-9 px-3.5 text-[13px]`}
          >
            <Bell size={14} aria-hidden="true" />
            Activar en este dispositivo
          </button>
        )}
        <button
          type="button" onClick={sendTest} disabled={!publicKey || devices === 0 || pending}
          className={`${btn.secondary} h-9 px-3 text-[13px]`}
        >
          <Send size={14} aria-hidden="true" />
          Enviar prueba
        </button>
      </div>
      <span role="status" className={`min-h-[17px] text-meta ${message?.ok === false ? 'text-danger' : 'text-muted'}`}>
        {pending ? 'Un momento…' : message?.text}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: `src/components/notification-prefs-form.tsx`**

```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import { updateNotificationPrefsAction } from '@/app/app/actions';
import { isValidTime } from '@/core/dates';
import type { NotificationPrefs } from '@/core/notification-prefs';
import { field } from './ui';

const DEFAULT_CHOICES = [
  { value: '', label: 'Ninguno' },
  { value: '0', label: 'A la hora' },
  { value: '15', label: '15 minutos antes' },
  { value: '60', label: '1 hora antes' },
];

const ROW = 'flex flex-col gap-1.5 border-b border-line pb-3 last:border-b-0 last:pb-0';
const HELP = 'text-caption text-pretty text-muted';
const TIME = `${field} h-10 w-[120px] bg-surface font-normal tabular-nums`;

/** Hora que se edita en un input nativo: se guarda solo con un valor completo y distinto; al salir, si quedó a medias, vuelve. */
function useTimeDraft(saved: string) {
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);
  return [draft, setDraft] as const;
}

/** Preferencias de notificación. Cada cambio se guarda al instante (como la zona horaria). */
export function NotificationPrefsForm({ initial }: { initial: NotificationPrefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [allDay, setAllDay] = useTimeDraft(prefs.allDayReminderTime);
  const [digest, setDigest] = useTimeDraft(prefs.digestTime);

  function save(patch: Partial<NotificationPrefs>) {
    const previous = prefs;
    setPrefs({ ...prefs, ...patch });
    setMessage(null);
    startTransition(async () => {
      const result = await updateNotificationPrefsAction(patch);
      if (result.ok) {
        setPrefs(result.data);
        setMessage({ ok: true, text: 'Guardado' });
      } else {
        setPrefs(previous);
        setMessage({ ok: false, text: result.error });
      }
    });
  }

  function commitTime(key: 'allDayReminderTime' | 'digestTime', value: string, onBlur: boolean) {
    if (isValidTime(value)) {
      if (value !== prefs[key]) save(key === 'allDayReminderTime' ? { allDayReminderTime: value } : { digestTime: value });
    } else if (onBlur) {
      (key === 'allDayReminderTime' ? setAllDay : setDigest)(prefs[key]);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <div className={ROW}>
        <span className="text-[13px] font-semibold">Recordatorio por defecto</span>
        <span className={HELP}>Se agrega a las tareas nuevas con hora; en cada tarea lo podés cambiar.</span>
        <select
          aria-label="Recordatorio por defecto"
          value={prefs.reminderDefaultMinutes === null ? '' : String(prefs.reminderDefaultMinutes)}
          onChange={(e) => save({
            reminderDefaultMinutes: e.target.value === '' ? null : (Number(e.target.value) as 0 | 15 | 60),
          })}
          className={`${field} h-10 max-w-[240px] cursor-pointer bg-surface font-normal`}
        >
          {DEFAULT_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      <div className={ROW}>
        <span className="text-[13px] font-semibold">Hora de los recordatorios sin hora</span>
        <span className={HELP}>«El mismo día» y «El día anterior» suenan a esta hora.</span>
        <input
          type="time" aria-label="Hora de los recordatorios sin hora" value={allDay} className={TIME}
          onChange={(e) => { setAllDay(e.target.value); commitTime('allDayReminderTime', e.target.value, false); }}
          onBlur={(e) => commitTime('allDayReminderTime', e.target.value, true)}
        />
      </div>

      <div className={ROW}>
        <label className="flex items-center gap-2.5 text-[13px] font-semibold">
          <input
            type="checkbox" checked={prefs.digestEnabled} onChange={(e) => save({ digestEnabled: e.target.checked })}
            className="h-4 w-4 cursor-pointer accent-accent"
          />
          Resumen diario
        </label>
        <span className={HELP}>Un aviso por día con cuántas tareas tenés para hoy y cuántas vencidas (solo si hay).</span>
        <input
          type="time" aria-label="Hora del resumen diario" value={digest} disabled={!prefs.digestEnabled} className={TIME}
          onChange={(e) => { setDigest(e.target.value); commitTime('digestTime', e.target.value, false); }}
          onBlur={(e) => commitTime('digestTime', e.target.value, true)}
        />
      </div>

      <div className={ROW}>
        <label className="flex items-center gap-2.5 text-[13px] font-semibold">
          <input
            type="checkbox" checked={prefs.notifyAssigned} onChange={(e) => save({ notifyAssigned: e.target.checked })}
            className="h-4 w-4 cursor-pointer accent-accent"
          />
          Avisarme cuando me asignan una tarea
        </label>
      </div>

      <span role="status" className={`min-h-[17px] text-meta ${message?.ok === false ? 'text-danger' : 'text-muted'}`}>
        {pending ? 'Guardando…' : message?.text}
      </span>
    </div>
  );
}
```

- [ ] **Step 3: `src/app/app/settings/page.tsx`**

Imports nuevos:

```tsx
import { notificationPrefsOf } from '@/core/notification-prefs';
import { countPushSubscriptions } from '@/core/push-subscriptions';
import { NotificationPrefsForm } from '@/components/notification-prefs-form';
import { PushDevice } from '@/components/push-device';
import { vapidPublicKey } from '@/lib/push';
```

Cargar la cantidad de dispositivos junto con lo demás:

```tsx
  const [tokens, connections, devices] = await Promise.all([
    listApiTokens(db, user.id), listOAuthConnections(db, user.id), countPushSubscriptions(db, user.id),
  ]);
```

Y entre la sección «Tema» y la de «Conexión con IA», agregar:

```tsx
          <SectionLabel
            title="Notificaciones"
            help="Recordatorios de tus tareas, resumen del día y avisos cuando te asignan algo."
          />
          <div className="flex min-w-0 flex-col gap-3">
            <PushDevice publicKey={vapidPublicKey()} devices={devices} />
            <NotificationPrefsForm initial={notificationPrefsOf(user)} />
          </div>
```

- [ ] **Step 4: Chequeo visual**

`npm run dev`; entrar con `prueba@example.com`; `/app/settings` a 1200 px y 390 px, claro y oscuro. Sin claves: tarjeta «Este dispositivo» con la explicación y los dos botones deshabilitados; las preferencias se guardan (aparece «Guardado»). Con claves de prueba en `.env.local` (ver «Cómo verificar») y reiniciando `npm run dev`: «Activar en este dispositivo» pide permiso, queda «Activadas en este dispositivo», «Enviar prueba» muestra una notificación del sistema y al tocarla enfoca la pestaña en Configuración; «Desactivar…» vuelve al estado inicial. Capturas `t11-ajustes-1200-claro.png`, `t11-ajustes-390-oscuro.png`, `t11-ajustes-activado-1200-claro.png`.

- [ ] **Step 5: Commit**

```powershell
npx tsc --noEmit
npm run lint
git add src/components/push-device.tsx src/components/notification-prefs-form.tsx src/app/app/settings/page.tsx
git commit -m @'
feat(ui): sección Notificaciones en Configuración (dispositivo, prueba y preferencias)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 12: Detalle de tarea → píldora «Recordatorio»

**Files:**
- Modify: `src/components/task-detail.tsx`

- [ ] **Step 1: Imports y estado**

Sumar `Bell` al import de `lucide-react` y:

```tsx
import { reminderLabel, reminderOptionsFor, type ReminderOption } from '@/core/reminder-options';
import { useShell } from './app-shell';
```

Dentro de `TaskDetail`, junto a los demás `useState`:

```tsx
  const { user } = useShell();
  const [reminder, setReminder] = useState<ReminderOption | ''>(task.reminder ?? '');
```

y junto a los demás `useEffect` de sincronización:

```tsx
  useEffect(() => setReminder(task.reminder ?? ''), [task.reminder]);
```

Junto a `move`/`assign`:

```tsx
  function changeReminder(next: string) {
    setReminder(next as ReminderOption | '');
    save({ reminder: next === '' ? null : (next as ReminderOption) }, () => setReminder(task.reminder ?? ''));
  }
```

- [ ] **Step 2: Fila en la grilla de propiedades**

Justo después del `</dd>` de la fila «Fecha» (antes de `<dt …>Prioridad</dt>`):

```tsx
          <dt className={PROP_LABEL}><Bell size={15} aria-hidden="true" />Recordatorio</dt>
          <dd className="flex min-h-9 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <SelectPill
              label="Recordatorio" value={reminder} onChange={changeReminder} disabled={!task.dueDate}
              leadingInset="flag" leading={<Bell size={13} className={reminder ? 'text-accent' : 'text-muted'} />}
            >
              <option value="">Sin recordatorio</option>
              {reminderChoices.map((o) => <option key={o} value={o}>{reminderLabel(o, user.allDayReminderTime)}</option>)}
            </SelectPill>
            {!task.dueDate && <span className="text-meta text-muted">Poné una fecha para usar recordatorios</span>}
          </dd>
```

y antes del `return (` principal (donde se calculan `done`, `shownDate`, etc.):

```tsx
  // Las opciones dependen de si la tarea tiene hora; si quedó guardada una que ya no corresponde
  // (p. ej. se le sacó la hora), se sigue mostrando para no perderla en silencio.
  const baseChoices = reminderOptionsFor(task.dueTime !== null);
  const reminderChoices: readonly ReminderOption[] = reminder && !baseChoices.includes(reminder)
    ? [...baseChoices, reminder] : baseChoices;
```

- [ ] **Step 3: Chequeo visual y de comportamiento**

`npm run dev`: abrir una tarea sin fecha (píldora deshabilitada + «Poné una fecha para usar recordatorios»), ponerle fecha (opciones «El mismo día a las 09:00» / «El día anterior a las 09:00»), elegir una, recargar (persiste), ponerle hora (opciones «A la hora» … «1 día antes»; si en Configuración hay recordatorio por defecto y no había uno, aparece solo), sacarle la hora (la opción «antes» sigue visible como elegida). En celular (390 px) la fila no desborda. Capturas `t12-detalle-1200-claro.png`, `t12-detalle-390-oscuro.png`.

- [ ] **Step 4: Commit**

```powershell
npx tsc --noEmit
npm run lint
git add src/components/task-detail.tsx
git commit -m @'
feat(ui): recordatorio en el detalle de la tarea

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 13: Variables `VAPID_*`, script de claves y documentación de despliegue

**Files:**
- Create: `scripts/generate-vapid.mjs`
- Modify: `deploy/docker-compose.yml`, `deploy/.env.production.example`, `.env.example`, `README.md`

- [ ] **Step 1: `scripts/generate-vapid.mjs`**

```js
// Genera un par de claves VAPID para las notificaciones push. Se corre UNA sola vez por instalación:
//   node scripts/generate-vapid.mjs        → JSON { publicKey, privateKey }
//   node scripts/generate-vapid.mjs --env  → líneas VAPID_PUBLIC_KEY=… y VAPID_PRIVATE_KEY=… para el .env
// Si se cambian, las suscripciones existentes dejan de funcionar: hay que volver a activar en cada dispositivo.
// La clave privada es un secreto: no la pegues en chats, issues ni commits.
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
if (process.argv.includes('--env')) {
  console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
} else {
  console.log(JSON.stringify({ publicKey, privateKey }, null, 2));
}
```

Probarlo: `node scripts/generate-vapid.mjs --env` → dos líneas `VAPID_…=` con valores base64url (no commitear la salida).

- [ ] **Step 2: `deploy/docker-compose.yml`**

En `services.app.environment`, después de `NOTAS_DISABLE_MAINTENANCE`:

```yaml
      # Notificaciones push (opcionales: sin las tres quedan apagadas). Ver deploy/.env.production.example.
      VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY:-}
      VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY:-}
      VAPID_SUBJECT: ${VAPID_SUBJECT:-}
```

- [ ] **Step 3: `deploy/.env.production.example`** (al final)

```bash

# Notificaciones push (opcional). Sin estas tres variables la app funciona igual, sin notificaciones.
# Generar las claves UNA vez, en la VPS, sin que la privada pase por la terminal (ver Plan 7, Task B1):
#   docker run --rm node:24-bookworm-slim sh -c 'npx -y web-push@3.6.7 generate-vapid-keys --json'
# Cambiarlas invalida las suscripciones existentes (cada dispositivo tiene que volver a activar).
# VAPID_SUBJECT: contacto para los servicios de push, "https://<tu dominio>" o "mailto:<email>".
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
```

- [ ] **Step 4: `.env.example`** (al final)

```bash

# Notificaciones push (opcional; vacías = apagadas). Generar con: node scripts/generate-vapid.mjs --env
# VAPID_SUBJECT: "mailto:<email>" o "https://<dominio>". Chrome acepta push en http://localhost.
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
```

- [ ] **Step 5: `README.md`**

En «Características», después de la línea de listas compartidas:

```markdown
- **Notificaciones push:** recordatorios por tarea (minutos antes, o el mismo día / el día anterior para tareas sin hora), resumen diario opcional y aviso cuando te asignan una tarea. Funcionan en Chrome, Edge, Firefox y Safari, y en iPhone/iPad (iOS 16.4+) con Notas agregada a la pantalla de inicio.
```

En la tabla de variables, al final:

```markdown
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Claves para las notificaciones push (`node scripts/generate-vapid.mjs --env`) y contacto (`mailto:` o `https:`). Vacías = sin notificaciones. |
```

Y en «Desplegar tu propia instancia», en la línea de `.env.production.example`, sumar `y opcionalmente VAPID_*` a la lista de variables.

- [ ] **Step 6: Verificar el compose y commitear**

Run (Git Bash; no hace falta Docker local si no está: saltear y dejarlo para la Task B2):

```bash
POSTGRES_PASSWORD=x APP_URL=https://n.example.com docker compose -p notas -f deploy/docker-compose.yml config --quiet && echo compose-ok
```

Expected: `compose-ok`.

```powershell
git add scripts/generate-vapid.mjs deploy/docker-compose.yml deploy/.env.production.example .env.example README.md
git commit -m @'
chore(deploy): variables VAPID opcionales y script para generar las claves

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 14: E2E, suite completa, spec, estado del proyecto y PR

**Files:**
- Create: `e2e/notificaciones.spec.ts`
- Modify: `docs/superpowers/specs/2026-10-08-notas-design.md`, `docs/PROGRESO.md`

- [ ] **Step 1: `e2e/notificaciones.spec.ts`**

Los e2e corren sin `VAPID_*` (el push real no se puede probar en CI): se prueba que la interfaz explica que están apagadas, que las preferencias y el recordatorio persisten y que `/sw.js` se sirve sin caché.

```ts
import { expect, test } from '@playwright/test';

test('notificaciones: /sw.js, recordatorio en el detalle y preferencias en Configuración', async ({ page, request }) => {
  const sw = await request.get('/sw.js');
  expect(sw.ok()).toBe(true);
  expect(sw.headers()['cache-control']).toMatch(/no-cache|no-store/);
  expect(await sw.text()).toContain('notificationclick');

  const email = `e2e-avisos-${Date.now()}@example.com`;
  await page.goto('/registro');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill('contraseña-e2e');
  await page.getByLabel('Código de invitación').fill('e2e-invite');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/app\/today/);

  // En «Hoy» el agregado rápido pone la fecha de hoy (sin hora): opciones «el mismo día» / «el día anterior».
  await page.getByLabel('Nueva tarea').fill('Pagar la luz');
  await page.getByLabel('Nueva tarea').press('Enter');
  await page.getByRole('link', { name: /Pagar la luz/ }).click();
  const reminder = page.getByLabel('Recordatorio', { exact: true });
  await expect(reminder).toBeEnabled();
  await reminder.selectOption({ label: 'El día anterior a las 09:00' });
  await expect(async () => {
    await page.reload();
    await expect(page.getByLabel('Recordatorio', { exact: true })).toHaveValue('day_before', { timeout: 3_000 });
  }).toPass();

  await page.getByRole('link', { name: 'Configuración' }).click();
  await expect(page.getByRole('heading', { name: 'Notificaciones' })).toBeVisible();
  await expect(page.getByText(/no están configuradas en este servidor/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activar en este dispositivo' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Enviar prueba' })).toBeDisabled();

  await page.getByLabel('Recordatorio por defecto').selectOption({ label: '15 minutos antes' });
  await expect(page.getByRole('status').filter({ hasText: 'Guardado' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Resumen diario' }).check();
  await expect(page.getByLabel('Hora del resumen diario')).toBeEnabled();
  await expect(async () => {
    await page.reload();
    await expect(page.getByLabel('Recordatorio por defecto')).toHaveValue('15', { timeout: 3_000 });
    await expect(page.getByRole('checkbox', { name: 'Resumen diario' })).toBeChecked({ timeout: 3_000 });
  }).toPass();
});
```

- [ ] **Step 2: Correr el e2e nuevo**

Run (PowerShell): `npx playwright test e2e/notificaciones.spec.ts`
Expected: 1 passed. Si falla el header de `/sw.js` en desarrollo, mirar `curl.exe -sI http://localhost:3100/sw.js` con el servidor de e2e y ajustar **la regex del test** solo si el valor real igual impide el caché (`no-store`/`no-cache`); el header de `next.config.ts` no se toca.

- [ ] **Step 3: Suite completa**

Run (PowerShell, en este orden):
- `npx tsc --noEmit` → sin errores
- `npm run lint` → sin errores ni warnings
- `npx vitest run` → todo en verde (nuevos: reminder-options, reminders, notification-prefs, push-subscriptions, notifications, push, notification-scheduler, notify, tools-reminders; modificados: schema, maintenance, startup, tools-tasks)
- `npm run build` → OK (sin warnings de `web-push`; si el build se queja de módulos de Node en `web-push`, confirmar que está en `serverExternalPackages`)
- `npm run e2e` → 5 tests en verde (flujo, compartir, 2 de mcp, notificaciones)

Si algo falla, usar superpowers:systematic-debugging antes de tocar código.

- [ ] **Step 4: Prueba real en local (opcional pero recomendada)**

Con claves de prueba en `.env.local` (`node scripts/generate-vapid.mjs --env` + `VAPID_SUBJECT=mailto:dev@example.com`), `npm run dev`, en Chrome de escritorio: Configuración → «Activar en este dispositivo» → permitir → «Enviar prueba» → aparece la notificación; tocarla enfoca la pestaña. Crear una tarea para dentro de 3 minutos con hora y recordatorio «A la hora»: en el log aparece `[notificaciones] recordatorios: 1, resúmenes: 0` y llega el aviso; al tocarlo abre la lista con el detalle de la tarea. **Borrar las claves de `.env.local` después** si no se quieren dejar.

- [ ] **Step 5: Sección de la spec**

Agregar al final de `docs/superpowers/specs/2026-10-08-notas-design.md`, antes de `## Pruebas`:

```markdown
## Notificaciones (agregado 2026-10-13)

Pedido por el usuario después del Plan 6. Web Push estándar (VAPID), sin servicios de terceros más allá de los
servicios de push de cada navegador (FCM, Mozilla, Apple).

- **Recordatorios por persona y por tarea** (`task_reminders`, PK `(task_id, user_id)`): en tareas con hora,
  `at_time`, `5m`, `15m`, `30m`, `1h` o `1d` antes; en tareas sin hora, `same_day` o `day_before` a la «hora de
  los recordatorios sin hora» del usuario (09:00 por defecto). Se calculan en la zona horaria del usuario. En una
  lista compartida cada miembro pone el suyo; solo se puede en tareas a las que se tiene acceso, y si alguien
  pierde el acceso su recordatorio deja de sonar.
- **Recordatorio por defecto** (ninguno / a la hora / 15 min / 1 h antes): se agrega al crear una tarea con hora
  o al ponerle hora, sin pisar uno elegido.
- **Resumen diario** opcional (apagado por defecto, 08:00): «N para hoy · M vencidas», solo si hay algo.
- **Aviso de asignación** (prendido por defecto) cuando otra persona te asigna una tarea, desde la web o el MCP.
- **Dispositivos**: cada navegador se activa desde Configuración → Notificaciones con un clic (en iPhone/iPad,
  iOS 16.4+ y con Notas agregada a la pantalla de inicio). Hasta 10 por persona; las suscripciones que el
  servicio de push da por muertas (404/410) se borran solas. Botón «Enviar prueba».
- **Entrega**: un programador dentro del proceso revisa cada minuto; un aviso sale a lo sumo una vez
  (`notification_deliveries` con clave única) y uno atrasado más de 10 minutos se descarta. Contenido mínimo:
  título de la tarea y fecha/hora; al tocarlo abre la tarea.
- **MCP**: `create_task` y `update_task` aceptan `reminder` (las mismas opciones, o `null`) para quien llama, y
  las tareas devuelven el `reminder` de quien llama.
- **Configuración del servidor**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Sin ellas la app
  funciona igual y las notificaciones quedan apagadas (los recordatorios se guardan igual).
```

- [ ] **Step 6: `docs/PROGRESO.md`**

En la tabla «Hecho», agregar la fila:

```markdown
| 7 — Notificaciones | Web Push (VAPID, `web-push`): recordatorios por persona y tarea, recordatorio por defecto, resumen diario, aviso de asignación, Configuración → Notificaciones, `reminder` en el MCP, service worker `public/sw.js` | Hecho |
```

En «Cómo desplegar tu propia instancia», punto 1, agregar al final: «Opcional: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` para las notificaciones push (ver Plan 7, Task B1).»

En «Ideas para después» agregar:

```markdown
- Notificaciones: varios recordatorios por tarea, recordatorios de tareas repetitivas (cuando existan) y aviso cuando alguien completa una tarea compartida.
```

- [ ] **Step 7: Commit**

```powershell
git add e2e/notificaciones.spec.ts docs/superpowers/specs/2026-10-08-notas-design.md docs/PROGRESO.md
git commit -m @'
test(e2e): notificaciones; spec y estado del proyecto

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

- [ ] **Step 8: Abrir el PR (sin mergear)**

```powershell
git push -u origin feat/notificaciones
$body = @'
## Qué hace

- Notificaciones Web Push (VAPID, `web-push` 3.6.7): recordatorios por persona y por tarea, recordatorio por defecto, resumen diario opcional y aviso de asignación (web y MCP).
- Configuración → «Notificaciones»: activar/desactivar en este dispositivo, enviar prueba, preferencias; pista para iPhone (requiere app instalada en la pantalla de inicio).
- Detalle de tarea: píldora «Recordatorio» (opciones según la tarea tenga hora).
- MCP: `reminder` en `create_task` / `update_task` y en la salida de las tareas.
- Programador cada 60 s en el proceso (idempotente con `notification_deliveries`), apagado sin `VAPID_*`, en tests y con `NOTAS_DISABLE_MAINTENANCE=1`.
- `public/sw.js` con `Cache-Control: no-cache`; migración aditiva `0007`.

## Antes de mergear

Cargar `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` en `~/notas/.env` de la VPS (Plan 7, Task B1): así el deploy automático ya levanta la app con notificaciones. Si se mergea antes, relanzar Actions → Deploy después de cargarlas.

## Pruebas

`npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build`, `npm run e2e` en verde. El push real se verifica en un teléfono después del deploy (Plan 7, Task B3).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
'@
gh pr create --base master --head feat/notificaciones --title "feat: notificaciones push (recordatorios, resumen diario y asignaciones)" --body $body
```

Expected: la URL del PR. Esperar los checks **Verificación** y **E2E (Playwright)** en verde (`gh pr checks --watch`). **No mergear**: el controlador mergea después de la Task B1.

---

## Parte B — VPS y verificación en un teléfono real

> Las corre el controlador (con SSH a la VPS desde Git Bash, `NOTAS_DEPLOY_HOST` en `deploy/.deploy.env`) salvo la B3, que hace el usuario con su teléfono. Nunca se imprime ni se copia la clave privada.

### Task B1: Claves VAPID en `~/notas/.env` (ANTES de mergear el PR)

- [ ] **Step 1: Cargar el destino**

Run (Git Bash, en la raíz del repo): `. deploy/.deploy.env && echo "$NOTAS_DEPLOY_HOST"`
Expected: `usuario@host` de la VPS.

- [ ] **Step 2: Generar y agregar las claves en la VPS**

La generación corre en un contenedor descartable (`node:24-bookworm-slim`, la misma base que la imagen de la app; descarga `web-push@3.6.7` de npm), la salida va directo al archivo y lo único que se muestra es la clave **pública**. Si ya hay una clave privada cargada, no se toca nada (cambiarla invalidaría las suscripciones).

```bash
ssh -o BatchMode=yes "$NOTAS_DEPLOY_HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
ENV_FILE="$HOME/notas/.env"
if grep -q '^VAPID_PRIVATE_KEY=.' "$ENV_FILE"; then
  echo "Ya hay claves VAPID en $ENV_FILE: no se tocan."
  grep '^VAPID_PUBLIC_KEY=' "$ENV_FILE"
  exit 0
fi
cp -p "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d%H%M%S)"
# Sacar líneas vacías de una plantilla anterior (VAPID_…= sin valor).
sed -i '/^VAPID_\(PUBLIC_KEY\|PRIVATE_KEY\|SUBJECT\)=$/d' "$ENV_FILE"
docker run --rm node:24-bookworm-slim sh -c 'npx -y web-push@3.6.7 generate-vapid-keys --json 2>/dev/null' \
  | docker run --rm -i node:24-bookworm-slim node -e '
      let s = "";
      process.stdin.on("data", (d) => { s += d; }).on("end", () => {
        const k = JSON.parse(s);
        if (!k.publicKey || !k.privateKey) process.exit(1);
        process.stdout.write("VAPID_PUBLIC_KEY=" + k.publicKey + "\nVAPID_PRIVATE_KEY=" + k.privateKey + "\n");
      });' >> "$ENV_FILE"
echo 'VAPID_SUBJECT=https://notas.emir-maestu.com' >> "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "Variables VAPID en el archivo: $(grep -c '^VAPID_' "$ENV_FILE") (tienen que ser 3)"
grep '^VAPID_PUBLIC_KEY=' "$ENV_FILE"
grep -q '^VAPID_PRIVATE_KEY=.\{40,\}' "$ENV_FILE" && echo "Clave privada cargada (no se muestra)"
REMOTE
```

Expected: `Variables VAPID en el archivo: 3 (tienen que ser 3)`, la línea `VAPID_PUBLIC_KEY=B…` (87 caracteres de clave) y `Clave privada cargada (no se muestra)`. Si el `docker run` falla (sin red hacia npm), no queda nada escrito a medias salvo el backup: revisar con `ssh … 'grep -c ^VAPID_ ~/notas/.env'` y reintentar. El backup `~/notas/.env.bak-*` tiene los mismos permisos (600); se puede borrar después de la B2.

- [ ] **Step 3: Avisar al controlador que ya se puede mergear**

El merge dispara el CI sobre `master` y, en verde, el workflow **Deploy**, que corre `docker compose --env-file ~/notas/.env … up -d`: la app nueva arranca con las tres variables. **Si el PR ya se había mergeado antes de este paso**: relanzar el deploy con `gh workflow run deploy.yml --ref master` (o, en la VPS, `REL=$(basename "$(readlink -f ~/notas/current)"); NOTAS_TAG=$REL docker compose -p notas --env-file ~/notas/.env -f ~/notas/current/deploy/docker-compose.yml up -d app`).

### Task B2: Verificación en producción (después del deploy)

- [ ] **Step 1: Deploy en verde**

Run: `gh run list --workflow deploy.yml --limit 1`
Expected: el último run `completed success` con el commit del merge.

- [ ] **Step 2: La app ve las claves y el programador arrancó**

```bash
ssh -o BatchMode=yes "$NOTAS_DEPLOY_HOST" 'docker logs --tail 200 notas-app-1 2>&1 | grep -E "\[notas\]|\[notificaciones\]" | tail -5; docker exec notas-app-1 node -e "console.log(\"VAPID:\", Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT))"'
```

Expected: `[notas] base de datos lista (migraciones aplicadas)`, `[notas] notificaciones push activas` y `VAPID: true`. Si dice «desactivadas», revisar la B1 y relanzar el deploy.

- [ ] **Step 3: `/sw.js` y la migración**

```bash
curl -sI https://notas.emir-maestu.com/sw.js | grep -iE '^(HTTP|content-type|cache-control)'
ssh -o BatchMode=yes "$NOTAS_DEPLOY_HOST" "docker exec notas-db-1 psql -U notas -d notas -tAc \"select count(*) from information_schema.tables where table_name in ('task_reminders','push_subscriptions','notification_deliveries')\""
```

Expected: `HTTP/2 200`, `content-type: application/javascript; charset=utf-8`, `cache-control: no-cache, no-store, must-revalidate` y `3`. (Si el contenedor de Postgres tiene otro nombre, verlo con `docker ps --format '{{.Names}}'`.)

### Task B3: Prueba en el teléfono del usuario

El controlador le pasa al usuario estos pasos (no se pueden automatizar: el permiso lo da una persona en su dispositivo).

- [ ] **Step 1: Android (Chrome)**

1. Abrir `https://notas.emir-maestu.com/app/settings` (sirve tanto en el navegador como con la app instalada).
2. Notificaciones → «Activar en este dispositivo» → «Permitir».
3. «Enviar prueba» → llega «Las notificaciones de Notas funcionan en este dispositivo.»; al tocarla se abre Configuración.

- [ ] **Step 2: iPhone (iOS 16.4 o más nuevo)**

1. En Safari abrir `https://notas.emir-maestu.com`, Compartir → «Agregar a inicio», y abrir Notas **desde ese ícono** (en Safari común la tarjeta muestra la pista y el botón queda deshabilitado).
2. Configuración → Notificaciones → «Activar en este dispositivo» → «Permitir».
3. «Enviar prueba» → llega la notificación (con la pantalla bloqueada también).

- [ ] **Step 3: Recordatorio de verdad**

1. Crear «Prueba de recordatorio» para hoy con hora dentro de 5 minutos (agregado rápido + hora en el detalle) y elegir Recordatorio «A la hora».
2. Bloquear el teléfono y esperar: a esa hora (± 1 minuto) llega «Prueba de recordatorio — Hoy a las HH:mm».
3. Tocarla: abre la lista con el detalle de la tarea.
4. Opcional: en Configuración, prender «Resumen diario» con la hora dentro de 3 minutos: llega «Tu día en Notas».

- [ ] **Step 4: Asignación (si hay una lista compartida con otra persona que activó notificaciones)**

Asignarle una tarea desde la web o pedirle a Claude por MCP que la asigne: le llega «Te asignaron una tarea — Emir te asignó «…»».

- [ ] **Step 5: Si algo no llega**

Pedirle al usuario el texto de la tarjeta «Este dispositivo» y mirar `docker logs --tail 200 notas-app-1 | grep -E "\[push\]|\[notificaciones\]"`: `[push] falló un envío (403)` suele ser una suscripción hecha con otras claves (desactivar y volver a activar); `(410)` la borra sola; sin líneas `[notificaciones] recordatorios: …` a la hora esperada, revisar zona horaria del usuario en Configuración y que la tarea tenga recordatorio.

### Task B4: Estado del proyecto

- [ ] **Step 1:** Si la B3 salió bien, actualizar la memoria del proyecto (estado: notificaciones en producción y verificadas en Android/iPhone, con lo que haya probado el usuario) y anotar en TickTick lo que quede pendiente con la skill `pendientes-ticktick` (p. ej. «probar resumen diario una semana», si el usuario no lo probó).

---

## Autorrevisión

### Cobertura del pedido (decisión → task)

| Pedido | Dónde | Task |
|---|---|---|
| 1. `task_reminders` (task/user cascade, `kind` + `offset_minutes`, PK compuesta), solo con acceso, instante en la zona del usuario | `schema.ts`, `reminder-options.ts`, `reminders.ts`, `tasks.ts` (acceso vía `findTask`) | 1, 2, 3 |
| 2. `notification_deliveries` idempotente, clave única (user, kind, fire_key) | `schema.ts`, `claimDelivery` | 2, 6 |
| 3. `push_subscriptions` (https, largo acotado, tope 10, borrar en 404/410) | `schema.ts`, `push-subscriptions.ts`, `push.ts` | 2, 4, 5 |
| 4. Preferencias (por defecto con hora, hora sin hora 09:00, resumen 08:00 apagado, asignación prendida) | columnas en `users`, `notification-prefs.ts`, formulario | 2, 4, 11 |
| 5. Programador 60 s, `unref`, sin solapamiento, apagado en tests / `NOTAS_DISABLE_MAINTENANCE`; ventana (now − 10 min, now]; pendientes y no borradas; acceso vigente; resumen; asignación inmediata web + MCP; `send` y `now` inyectables | `notifications.ts`, `notification-scheduler.ts`, `startup.ts`, `notify.ts`, acciones, MCP | 6, 7, 8, 9 |
| 6. `src/lib/push.ts` con `VAPID_*`; sin configurar → apagado con explicación; payload `{ title, body, url, tag }` | `push.ts`, `PushDevice`, acciones | 5, 8, 11 |
| 7. `public/sw.js` (`push`, `notificationclick` focus/open), registro solo al activar | `sw.js`, `PushDevice` | 10, 11 |
| 8. Configuración → Notificaciones (activar desde clic, desactivar, prueba, preferencias, pista iOS); detalle «Recordatorio» según hora/fecha, deshabilitado sin fecha | `push-device.tsx`, `notification-prefs-form.tsx`, `settings/page.tsx`, `task-detail.tsx` | 11, 12 |
| 9. MCP `reminder` en `create_task`/`update_task` y en la salida, descripciones en castellano | `tools.ts`, `format.ts` | 9 |
| 10. Compose, `.env.production.example`, `.env.example`, `scripts/generate-vapid.mjs`, Parte B en la VPS sin imprimir la privada, orden env → merge, headers de `/sw.js` | Task 13, `next.config.ts`, B1–B2 | 10, 13, B1, B2 |
| 11. Tests: zonas horarias / DST / sin hora; idempotencia y ventana; acceso revocado; 410; validación de preferencias; asignación; MCP; e2e de Configuración y del detalle | `reminder-options`, `notifications`, `push-subscriptions`, `notification-prefs`, `notify`, `tools-reminders`, `notificaciones.spec.ts` | 1, 4, 6, 8, 9, 14 |
| Sección de spec | Task 14, Step 5 | 14 |

### Búsqueda de placeholders

Revisado: no hay «TBD», «TODO», «similar a la Task N» ni pasos sin código. Lo único que el ejecutor no conoce de antemano es el sufijo aleatorio de la migración (`drizzle/0007_<nombre>.sql`, con su contenido esperado listado) y los valores de las claves VAPID (que nunca se escriben en el repo).

### Consistencia

- **Tipos compartidos**: `ReminderOption` (de `reminder-options.ts`) en `TaskWithDetails.reminder`, `CreateTaskInput.reminder`, `UpdateTaskInput.reminder`, `writeReminder`, el detalle y el enum del MCP (`REMINDER_OPTIONS`). `PushTarget`, `PushPayload`, `PushResult`, `SendPush` viven en `src/core/push-subscriptions.ts` y los usan `notifications.ts`, `push.ts`, `notify.ts`, `notification-scheduler.ts`, `startup.ts`, `tools.ts` y `tests/helpers/push.ts`. `NotificationPrefs` la usan el núcleo, la acción y el formulario.
- **Nombres**: `getPushSender` / `vapidPublicKey` / `vapidConfig` / `createWebPushSender` (push.ts); `runNotifications` / `runReminders` / `runDigests` / `notifyAssignment` / `sendTestNotification` / `claimDelivery` / `purgeOldDeliveries` (notifications.ts); `notifyAssignmentSafely` / `assignmentChanged` (notify.ts); `NOTIFICATIONS_FLAG`, `NOTIFICATIONS_INTERVAL_MS`; acciones `savePushSubscriptionAction`, `deletePushSubscriptionAction`, `sendTestNotificationAction`, `updateNotificationPrefsAction`.
- **Firmas que cambian**: `TaskWithDetails` suma `reminder` (lo arma `hydrate`; nadie más construye ese tipo); `MaintenanceReport` suma `deliveries` (test actualizado en la Task 6); `StartupDeps` suma dos campos opcionales; `ToolContext` suma `sendPush?` opcional; `formatTask` suma `reminder` (`TASK_KEYS` actualizado en la Task 9). Las demás firmas existentes no cambian.
- **Selectores e2e nuevos**: `getByLabel('Recordatorio', { exact: true })` (nombre de la `SelectPill`), `getByLabel('Recordatorio por defecto')`, `getByRole('checkbox', { name: 'Resumen diario' })`, `getByLabel('Hora del resumen diario')`, botones `Activar en este dispositivo` / `Enviar prueba`, heading `Notificaciones`. Los e2e existentes no tocan nada de esto.
- **Orden de las tasks**: 3 depende de 1–2; 6 de 3–4; 7 de 5–6; 8 de 5–6; 9 de 3 y 8 (`notify.ts`); 11 de 8 y 10; 12 de 3; 14 de todo. No hay ciclos de imports: `reminder-options` (puro) ← `reminders` ← `tasks` ← `notifications`; `push-subscriptions` no importa nada de tareas.

## Riesgos y pendientes

1. **iOS**: requiere iOS/iPadOS 16.4+, Notas agregada a la pantalla de inicio y el permiso pedido desde el botón. Hay reportes de la comunidad (no oficiales) de suscripciones de iOS que dejan de funcionar con el tiempo; el borrado por 404/410 y «Enviar prueba» lo hacen visible, y la solución es volver a activar. No hay forma de probar iOS en CI.
2. **A lo sumo una vez**: si el proceso muere entre reclamar la entrega y mandarla, ese aviso se pierde. Con una sola instancia y reinicios raros es aceptable; si se agregan réplicas, la clave única ya evita duplicados entre procesos.
3. **Ventana de 10 minutos**: un deploy o una caída de más de 10 minutos saltea los recordatorios de ese lapso (decisión 6). El deploy normal tarda menos (build + health check).
4. **Precisión**: tick cada 60 s → un aviso puede llegar hasta ~1 minuto tarde, más la demora del servicio de push.
5. **Cambiar las claves VAPID** invalida todas las suscripciones (cada dispositivo tiene que volver a activar). La B1 no las pisa si ya existen.
6. **Privacidad**: el título de la tarea viaja cifrado de punta a punta (Web Push con `aes128gcm`); el servicio de push (Google/Apple/Mozilla) ve solo el endpoint y el tamaño. El `user_agent` se guarda recortado y solo para referencia.
7. **Carga**: cada minuto, una consulta acotada por fecha (±2 días) sobre recordatorios de usuarios con dispositivos y otra sobre usuarios con resumen; para el tamaño de esta instancia es despreciable.
8. **Recordatorio por defecto** solo se materializa cuando **quien crea o edita** le pone hora a la tarea; los demás miembros de una lista compartida no reciben el suyo automáticamente (cada uno lo pone en el detalle). Es una elección de producto que conviene confirmar con el usuario.
9. **Ambigüedades decididas** que conviene confirmar: resumen diario cuenta lo mismo que «Hoy» (propias + asignadas a mí en listas compartidas); `same_day`/`day_before` permitidos en tareas con hora; los avisos de asignación no se mandan cuando la asignación cambia por mover la tarea o quitar a un miembro (solo cuando alguien asigna).
10. **`after()` en la acción web**: el aviso de asignación se manda después de responder; si el proceso se reinicia justo en ese instante, se pierde (igual que el punto 2).
