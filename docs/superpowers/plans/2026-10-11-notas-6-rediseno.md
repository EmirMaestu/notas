# Notas — Plan 6: Rediseño visual (claro/oscuro, celular, «Creada por IA»)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Llevar toda la interfaz web de Notas al rediseño de Claude Design (acento petróleo sobre base cálida, Manrope + Geist Mono, filas de 48 px de dos líneas, detalle con propiedades en píldoras, tema claro/oscuro con opción manual, celular de 390 px con cajón y detalle a pantalla completa, toasts con «Deshacer», estados vacíos/cargando/error) y agregar el indicador «Creada por IA» (`tasks.created_via`), sin perder ningún comportamiento ni arreglo de accesibilidad existente.

**Architecture:** Los tokens del diseño se definen como variables CSS en `src/app/globals.css` (claro en `:root`, oscuro bajo `prefers-color-scheme` salvo `data-theme="light"`, y bajo `[data-theme="dark"]`) y se exponen a Tailwind 4 con `@theme inline` (colores, sombras, fuentes) y `@theme` (radios, escala tipográfica, animaciones). El tema manual vive en la cookie `notas-theme`, que lee el layout raíz para poner `data-theme` en `<html>` sin parpadeo. Los componentes se **reestilan en el lugar** conservando su lógica (optimismo, focus trap, `inert`, validaciones de fecha, etc.); se agregan primitivas chicas y reutilizables (`ui.ts`, `Avatar`, `Modal` apilable, `ConfirmDialog`, `ToastProvider`, `EmptyState`, esqueletos, `SelectPill`) y un contexto del espacio de trabajo (`WorkspaceContext`) que coordina filas que salen, papelera con «Deshacer», atajos de teclado y foco. El núcleo gana funciones chicas con TDD (`countTasks`, `emptyTrash`, `sharedListOwners`, `quickAddHighlights`, `describeBearerClient`, `connectedAt`, `created_via`) y `src/lib/format.ts` gana formateadores puros con tests.

**Tech Stack:** Next.js 15.5.27 (App Router, `next/font/google`), React 19.1, Tailwind CSS 4.3.3 (`@theme`, `--text-*--font-weight`, variantes `has-[]`), lucide-react 1.53, Drizzle ORM 0.45 + PGlite/Postgres, Vitest 3, Playwright 1.64. Sin dependencias npm nuevas.

**Spec:** el handoff de Claude Design en `docs/diseno/handoff/`: `README.md`, `github.md` (mapa de pantallas → archivos), `Notas - Rediseño.dc.html` (principal: tokens, tipografía, espaciado, radios, sombras, duraciones, notas de interacción), `NotasSidebar.dc.html`, `NotasLista.dc.html`, `NotasDetalle.dc.html`, `NotasPantallas.dc.html` (todas las pantallas y la hoja de componentes). `support.js` es el runtime de la herramienta de diseño (`<dc-import>` inserta un componente pasándole atributos; `{{ }}` son valores de `renderVals()`; `<sc-if>`/`<sc-for>` son condicionales y bucles): **no se porta**. El diseño pide reproducir la salida visual con exactitud en el stack actual, no la estructura del prototipo.

## Investigación (2026-10-11)

- **Diseño leído completo.** Pantallas: 02 Hoy (detalle abierto + agregado rápido escribiendo), 03 Próximos 7 días, 04 Lista compartida (pila de avatares + «Miembros»), 05 Bandeja / Asignadas / Completadas / Papelera, 06 Etiqueta, 09 Configuración + Conexión con IA (token recién creado), 01 Login y Registro (con errores), 10 Consentimiento OAuth y su error, 08 Diálogo de lista (dueño y miembro), 11 Estados vacíos (6) + cargando + 3 toasts, 12 Celular (Hoy, Detalle, Cajón), hoja de componentes (fila en 7 estados, checkbox en 8, agregado rápido en 3, botones, inputs/select/menú, chips, avatares, ítem de navegación). Todo se repite en oscuro con tokens propios.
- **Tailwind 4.3.3**: soporta `--text-<nombre>--font-weight` en `@theme`, `duration-<n>` con cualquier entero, `opacity-<n>`, `has-[…]:` y `rounded-<nombre>` desde `--radius-<nombre>`. Las variables de `@theme` que no usa ninguna utilidad pueden no emitirse: por eso las animaciones llevan las curvas escritas a mano (no `var(--ease-…)`) y los `@keyframes` van fuera de `@theme` (CSS sin capa; así las versiones de `prefers-reduced-motion`, declaradas después, ganan).
- **`next/font/google`**: `Manrope` acepta pesos `400…800` y `Geist_Mono` `400`/`500` (verificado en `node_modules/next/dist/compiled/@next/font/dist/google/index.d.ts`). El build ya descarga Inter hoy, así que hay red en el build.
- **lucide-react 1.53** tiene todos los íconos del diseño: `Inbox Sun CalendarDays Calendar UserCheck CircleCheck Trash2 Settings Hash Folder ChevronDown Users Plus Check Sparkles ArrowLeft Copy X Menu Flag Clock List User RotateCcw LogOut ShieldCheck CircleAlert KeyRound Undo2 CloudOff Globe Monitor Moon` (verificado con `node -e`). El `<symbol id="i-trash">` del diseño es `Trash2` (con las dos líneas) y `i-check-circle` es `CircleCheck`.
- **`TaskWithDetails = Task & {…}`**: una columna nueva en `tasks` aparece sola en el tipo (no hay que tocar `hydrate`). Ningún test compara tareas con `toStrictEqual` ni por claves, salvo `TASK_KEYS` de la salida MCP (que no cambia: `created_via` no se expone por MCP, ver decisiones).
- **MCP**: `src/app/mcp/route.ts` arma `authInfo` con `clientId` (`'personal'` o el `client_id` OAuth) y `extra.userId`; la factory de `createMcpHandler` recibe `authInfo`. El nombre visible del cliente está en `oauth_clients.client_name` (OAuth) o `api_tokens.name` (token personal); `authenticateBearer` devuelve `tokenId`/`clientId`, no el nombre.
- **`listTasks`**: «Hoy» y «Próximos 7 días» traen solo pendientes (más vencidas); ninguna vista salvo «Completadas» muestra completadas, así que una fila completada siempre sale de la vista. `purgeTrash` está documentada como «nunca exponer a usuarios ni por MCP»: vaciar la papelera necesita una función propia y acotada.
- **E2E** (`e2e/*.spec.ts`) depende de: labels `Nueva tarea`, `Nueva subtarea`, `Editar subtarea 1`, `Mandar a la papelera` (hoy `aria-label` de un ícono), `Asignada a` (select nativo con `selectOption({ label })` y `option`), `Nombre de la lista`, `Email del nuevo miembro`, `Nombre del token`, `code[aria-label="URL del servidor MCP"]`, `code[aria-label="Token nuevo"]`; botones `Crear cuenta`, `Guardar`, `Agregar`, `Cerrar` (exacto), `Nueva lista`, `Editar Compras`, `Miembros de Compras`, `Salir de la lista`, `Restaurar`, `Cerrar sesión`, `Crear token`, `Revocar token e2e`, `Permitir`, `Desconectar Cliente e2e`; links `Hoy` (exacto), `Papelera`, `Completadas`, `Bandeja`, `Configuración`, `Asignadas a mí`, `Compras` (exacto), `Registrate`, filas por `/Comprar pan/` y `/Comprar leche.*Asignada a/`; checkboxes `/^Completar "/` y `/^Marcar ".*" como pendiente/`; heading `Cliente e2e quiere acceder a tu cuenta de Notas`; tres `page.once('dialog', …)` (confirmaciones nativas). La Task 14 lista qué cambia y por qué.
- **Windows**: `npx vitest` y `npm run e2e` se corren desde PowerShell (en Git Bash falla esbuild), según `docs/PROGRESO.md`.

## Decisiones tomadas al planificar (resuelven ambigüedades)

1. **Tema manual**: cookie `notas-theme` (`light` | `dark`; sin cookie = `system`), `httpOnly`, `sameSite=lax`, 1 año, `secure` en producción. El layout raíz (async) la lee con `cookies()` y pone `data-theme` en `<html>` → sin parpadeo. Al elegir en Configuración, el cliente cambia `document.documentElement.dataset.theme` al instante y una server action guarda la cookie. Es por dispositivo (no se guarda en la base).
2. **Nombres de tokens**: las variables CSS usan los nombres del diseño (`--bg`, `--surface`, `--border`, …). En Tailwind el color del borde se sigue llamando `line` (`border-line`, `divide-line`) para no chocar con la utilidad `border`; mapea a `var(--border)`.
3. **Avatares**: el diseño pide «color estable por persona (hash del id → 1 de 6 tonos)» pero solo define 3 (`--av-sofia`, `--av-martin`, `--av-emir`). Se usan `--av-1…--av-6`: 1 = petróleo (`#15697B`/`#7CCBDB`), 2 = `--av-sofia`, 3 = `--av-martin`, y tres tonos nuevos de la misma familia con contraste AA contra `--av-fg`: 4 violeta `#6A4FC0`/`#B9A5F2`, 5 ocre `#A65A1B`/`#F0B07A`, 6 azul `#2F6BCB`/`#8FB6F5`. Las iniciales pasan a ser como en el diseño: **una palabra → una letra** («E»), dos o más → dos («SG»), sin nombre → primera letra del email.
4. **`--accent-hover`** (no está en la tabla de tokens): claro `#0E505E` (el `a:hover` del documento de diseño), oscuro `#7CCBDB`.
5. **Selects**: se mantienen **nativos** (Prioridad, Lista, Asignada a, Carpeta, Zona horaria) con aspecto de píldora/campo (`appearance-none`, ícono a la izquierda, chevron). El menú desplegable del diseño (lista con círculos de prioridad y tilde) queda como el nativo del sistema: así siguen funcionando el teclado, los lectores de pantalla y el e2e (`selectOption`, `option`).
6. **Fecha y hora del detalle** se muestran como píldoras («Hoy, 10 oct», «15:00») con un `<input type="date|time">` transparente encima (`showPicker()` al hacer clic); se conserva toda la lógica de `commitDate`/`commitTime`.
7. **Resaltado en el agregado rápido**: las partes detectadas se tiñen de acento con una capa espejo detrás del input transparente; **mismo peso** que el resto del texto (el diseño las pone en 600, pero un peso distinto desalinearía el cursor). Los chips de abajo sí van en 600.
8. **Chip de «lista destino»** del agregado rápido: muestra la lista real donde va a caer la tarea (la de la vista o la Bandeja); el parser no tiene sintaxis de lista.
9. **Completar**: tilde inmediato con la animación del diseño; la fila espera 600 ms (un segundo clic deshace sin tocar el servidor) y recién ahí sale (alto → 0 y fundido en 280 ms) mientras se llama a `toggleTaskAction`. Si el componente se desmonta con un cambio pendiente, se manda igual. Error → la fila vuelve y aparece un toast con «Reintentar». En el detalle el checkbox guarda al instante (como hoy).
10. **Papelera sin confirmación** (como pide el diseño): fila que sale + toast «Tarea enviada a la papelera» con «Deshacer» 6 s (barra que se pausa con el mouse o el foco) → `restoreTaskAction`. Las acciones sin vuelta atrás usan un **`ConfirmDialog`** propio (no `confirm()`): borrar lista, salir de una lista, quitar miembro, borrar carpeta, revocar token, desconectar app y vaciar papelera. Renombrar carpeta sigue con `prompt()` (el diseño no lo dibuja).
11. **`Modal` apilable**: una pila a nivel de módulo hace que solo el diálogo de arriba atienda Escape/Tab (un `ConfirmDialog` puede abrirse sobre el diálogo de lista). Los chequeos de «hay un diálogo abierto» pasan a `[aria-modal="true"]`.
12. **Vaciar papelera**: nueva `emptyTrash(db, userId)` que borra definitivamente solo las tareas en papelera de **listas propias** (un miembro no puede borrar para siempre lo de otro). La purga a 30 días sigue igual.
13. **Contadores de la barra lateral**: solo Bandeja y Hoy (como el diseño; 0 no se muestra), con `countTasks` (mismo filtro que `listTasks`, `count(*)`); el número es `aria-hidden` para no cambiar el nombre accesible de los links (`Hoy` exacto en e2e).
14. **«Más opciones» (⋯)** del encabezado de vista y del detalle **no se implementa**: el diseño no dice qué contiene. Se agrega cuando haya acciones para él.
15. **Copys que el diseño afirma y el sistema no cumple**: «Completadas · Últimos 30 días» y «queda guardada acá 30 días» (no se purgan completadas) → «Las más recientes primero» y «Cuando termines una tarea, la vas a ver acá.»; error de carga «Lo que hayas cambiado sin conexión no se perdió» (no hay modo sin conexión) → «Revisá la conexión y volvé a intentar.»; Próximos 7 días muestra el rango real (`hoy … hoy+6`, p. ej. «Sáb 10 → Vie 16 de octubre»), no «→ Sáb 17».
16. **«Creada por IA»**: `tasks.created_via text NULL`. Valores: `'web'` (agregado rápido), `'mcp:<nombre>'` donde `<nombre>` es el `client_name` OAuth («Claude», «ChatGPT») o el nombre del token personal («Cursor»); `NULL` = tareas anteriores o importadas. Se fija solo al crear (no se edita). `CreateTaskInput.createdVia` es opcional (las firmas no cambian). El MCP recibe el nombre por `authInfo.extra.client` → `ToolContext.client`. **No** se agrega a la salida MCP (`formatTask` es compacta por política y el dato no le sirve a la IA). En la fila: chispa petróleo con `aria-label="Creada por IA"`; en el detalle: chip «Creada por {cliente}» con `title` «… el 10/10 a las 09:41».
17. **Cambios hechos por la IA**: la web hace `router.refresh()` al volver a la pestaña y cada 30 s (salvo con un campo enfocado o un diálogo abierto, para no mover nada bajo el cursor). Las tareas nuevas entran con fundido; si alguna creada por un cliente MCP aparece con la pestaña visible (creada hace < 2 min), toast «Claude creó «…»» con «Ver». **No** se muestra «Claude completó…» porque no se registra quién completa o modifica (haría falta `updated_via`; queda como pendiente).
18. **Atajos de teclado** sobre una fila enfocada: ↑/↓ recorren, Enter abre (link nativo), Espacio completa, Supr/⌫ manda a la papelera, E abre el detalle con el título enfocado, **1 = alta, 2 = media, 3 = baja, 4 = sin prioridad** (convención p1 = la más alta; el diseño no lo define). N enfoca el agregado rápido; Esc lo limpia; Esc en el detalle lo cierra y devuelve el foco a la fila.
19. **Ancho de columna**: 760 px sin detalle y 720 px con detalle abierto (como las pantallas 02 y 03–06); Configuración 720 px. Detalle de 400 px desde `lg` (1024 px); por debajo, pantalla completa con ← (como el celular).
20. **Toasts**: abajo a la izquierda del área de contenido (`md:left-[272px] md:bottom-6`); en celular, encima del agregado rápido (`bottom-[96px]`, 16 px a los costados). Uno a la vez.
21. **«Dueño/Dueña»**: no hay género en los datos → siempre «Dueño». Las etiquetas «De otros miembros» muestran solo el `#nombre` (no se sabe de quién es cada una).
22. **«Conectada el …»** de las apps OAuth: `listOAuthConnections` gana `connectedAt = min(family_created_at)`.
23. **Fechas relativas** de Configuración y del pie del detalle se calculan con un `now` que manda el servidor, para no desajustar la hidratación.
24. **Ningún `<option>` con contenido rico ni `appearance: base-select`**: React avisa por elementos dentro de `<option>` y el soporte es solo de Chromium.

## Estructura de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src/app/globals.css` | Reescribir | Tokens claro/oscuro, `@theme`, keyframes, movimiento reducido, base |
| `src/app/layout.tsx` | Reescribir | Manrope + Geist Mono, `data-theme` desde la cookie, `themeColor` |
| `src/lib/theme.ts` | Crear | `THEME_COOKIE`, `ThemePreference`, `parseTheme` |
| `src/app/theme-actions.ts` | Crear | `setThemeAction` (cookie) |
| `src/components/ui.ts` | Crear | Clases compartidas: botones, campo, rótulos |
| `src/lib/format.ts` | Modificar | Fechas/tiempos relativos, agrupado de completadas, nota de papelera, `createdViaClient` |
| `src/lib/initials.ts` | Modificar | Iniciales del diseño + `avatarTone` |
| `src/lib/use-media-query.ts` | Crear | Hook `useMediaQuery` sin desajuste de hidratación |
| `src/components/avatar.tsx` | Reescribir | Tamaños del diseño, tono por persona |
| `src/components/modal.tsx` | Reescribir | Diálogo del diseño, pie opcional, pila de diálogos |
| `src/components/confirm-dialog.tsx` | Crear | Confirmación chica con botón de peligro |
| `src/components/toast.tsx` | Crear | `ToastProvider`, `useToast`, toasts papelera/IA/error |
| `src/components/empty-state.tsx` | Crear | Estado vacío / error |
| `src/components/skeleton.tsx` | Crear | `TaskListSkeleton`, `WorkspaceSkeleton` |
| `src/components/app-shell.tsx` | Reescribir | Cajón 300 px, contextos del cajón y del usuario, toasts, auto-refresh |
| `src/components/mobile-header.tsx` | Crear | Encabezado de celular (menú, título, avatar) |
| `src/components/sidebar.tsx` | Reescribir | Barra lateral del diseño, contadores, dueños de listas compartidas |
| `src/app/app/layout.tsx` | Modificar | Carga contadores y dueños; pasa `user` al shell |
| `src/components/workspace-context.tsx` | Crear | Filas ocultas, papelera con deshacer, abrir/cerrar detalle, foco |
| `src/components/task-page.tsx` | Modificar | Pasa `now`, `timezone`, lista, miembros del encabezado, carpetas, dueño |
| `src/components/task-workspace.tsx` | Reescribir | Encabezados, layout responsive, estados vacíos, atajos |
| `src/components/view-header.tsx` | Crear | Título/subtítulo de escritorio, pila de miembros, acciones |
| `src/components/task-list.tsx` | Reescribir | Grupos del diseño, filas nuevas con fundido |
| `src/components/task-item.tsx` | Reescribir | Fila de 48 px, estados, salida animada, atajos, restaurar |
| `src/components/priority-checkbox.tsx` | Reescribir | Checkbox redondo con la animación del diseño |
| `src/core/quick-add.ts` | Modificar | `quickAddHighlights` |
| `src/components/quick-add.tsx` | Reescribir | Campo del diseño, resaltado, chips, toast de error |
| `src/components/select-pill.tsx` | Crear | Select nativo con aspecto de píldora |
| `src/components/priority-select.tsx` | Reescribir | Píldora con bandera |
| `src/components/task-detail.tsx` | Reescribir | Detalle del diseño (en el lugar: misma lógica) |
| `src/components/subtask-list.tsx` | Reescribir | Progreso, checkbox redondo, «Agregar subtarea» |
| `src/components/tag-editor.tsx` | Reescribir | Chips, «+ Etiqueta», «De otros miembros» |
| `src/components/list-dialog.tsx` | Reescribir | Diálogo de lista (dueño/miembro/nueva) con confirmaciones |
| `src/components/list-members.tsx` | Reescribir | Miembros del diseño, «Invitar», «Quitar» |
| `src/components/auth-form.tsx` | Reescribir | Login/registro del diseño |
| `src/app/(auth)/layout.tsx` | Sin cambios | Ya usa `bg-sidebar` (fondo del diseño) |
| `src/app/app/settings/page.tsx` | Reescribir | Grilla 180 px + contenido, tema, cuenta |
| `src/components/ai-connection.tsx` | Reescribir | URL MCP, apps conectadas, tokens |
| `src/components/timezone-form.tsx` | Reescribir | Select con globo, guarda al cambiar |
| `src/components/theme-form.tsx` | Crear | Sistema / Claro / Oscuro |
| `src/components/logout-button.tsx` | Modificar | Botón secundario con ícono |
| `src/app/oauth/authorize/page.tsx` | Reescribir | Consentimiento y error del diseño |
| `src/lib/oauth-consent.ts` | Modificar | `errorPageView` devuelve también `code` |
| `src/components/auto-refresh.tsx` | Crear | Refresco al volver a la pestaña y cada 30 s |
| `src/app/app/error.tsx` | Crear | Estado de error de carga |
| `src/app/app/[view]/loading.tsx`, `src/app/app/list/[id]/loading.tsx`, `src/app/app/tag/[name]/loading.tsx` | Crear | Esqueleto de carga |
| `src/core/tasks.ts` | Modificar | `countTasks`, `emptyTrash`, `createdVia` en `createTask` |
| `src/core/lists.ts` | Modificar | `sharedListOwners` |
| `src/core/oauth.ts` | Modificar | `connectedAt` en `listOAuthConnections` |
| `src/core/bearer.ts` | Modificar | `describeBearerClient` |
| `src/db/schema.ts` + `drizzle/0006_*.sql` | Modificar / generar | Columna `tasks.created_via` |
| `src/mcp/tools.ts`, `src/mcp/server.ts`, `src/app/mcp/route.ts` | Modificar | Pasar el cliente y guardar `created_via` |
| `src/app/app/actions.ts` | Modificar | `createdVia: 'web'`, `emptyTrashAction` |
| `tests/lib/theme.test.ts`, `tests/lib/format.test.ts`, `tests/lib/initials.test.ts`, `tests/core/quick-add.test.ts`, `tests/core/tasks-counts.test.ts`, `tests/core/tasks-created-via.test.ts`, `tests/core/lists-shared.test.ts`, `tests/core/oauth-tokens.test.ts`, `tests/core/bearer.test.ts`, `tests/lib/oauth-consent.test.ts`, `tests/mcp/tools-tasks.test.ts`, `tests/routes/mcp.test.ts` | Crear / modificar | TDD de lo nuevo |
| `e2e/flujo.spec.ts`, `e2e/compartir.spec.ts`, `e2e/mcp.spec.ts` | Modificar | Selectores cuyo texto/flujo cambió (misma intención) |

## Cómo verificar cada task (referencia)

- **Tipos y lint** (Git Bash o PowerShell): `npx tsc --noEmit` → sin salida; `npm run lint` → sin errores ni warnings.
- **Tests** (PowerShell): `npx vitest run <archivo>`.
- **Chequeo visual**: en PowerShell, `npm run dev` (PGlite; `.env.local` ya tiene `INVITE_CODE=dev`; usuario existente `prueba@example.com` / `contraseña-segura`). Abrir `http://localhost:3000/login` en el panel del navegador (`mcp__Claude_Browser__preview_start` con `url`, `resize_window` con `width: 1200, height: 820` o `preset: "mobile"` para 390 px, `colorScheme: "light"` / `"dark"`, `computer` → `screenshot`). Comparar contra la pantalla del diseño indicada en cada task (los valores exactos están en el HTML del handoff; no hace falta renderizarlo). Guardar las capturas en el scratchpad de la sesión como `t<n>-<pantalla>-<ancho>-<tema>.png` y anotar diferencias para corregirlas antes del commit. Si la cuenta de prueba no tiene datos, crearlos con el agregado rápido: «Llamar al contador 08/10 !media #llamadas» (vencida), «Pagar la luz hoy !alta #casa», «Turno con el dentista hoy», «Revisar presupuesto Q4 hoy !alta» (+ 3 subtareas), «Comprar yerba y pan mañana», una lista «Trabajo» compartida con otra cuenta registrada con el código `dev`. Al terminar: `resize_window` con `preset: "desktop"`.
- **Commits**: uno por task, mensaje en español con prefijo convencional (`feat(ui): …`, `feat(core): …`, `test(e2e): …`) y la línea `Co-Authored-By` que corresponda a la sesión.
- **Regla para todas las tasks de UI: reestilar en el lugar.** El código nuevo de cada componente parte del actual: se conservan intactos los handlers, los estados optimistas, los `useEffect` de sincronización, los `aria-*`, los `requestId` contra respuestas viejas, el `inert` del cajón, el focus trap, `commitDate`/`commitTime`, `TagEditor` sobre la lista local, etc. Lo que se reescribe es el marcado y las clases. Si al pegar el código de este plan algún comportamiento existente no aparece, es un error del plan: conservar el comportamiento.

---

### Task 1: Tokens, fuentes y tema (claro / oscuro / manual)

**Files:**
- Create: `src/lib/theme.ts`, `src/app/theme-actions.ts`, `src/components/ui.ts`, `tests/lib/theme.test.ts`
- Rewrite: `src/app/globals.css`, `src/app/layout.tsx`

- [ ] **Step 1: Test que falla para `parseTheme`**

`tests/lib/theme.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { THEME_COOKIE, parseTheme } from '@/lib/theme';

describe('parseTheme', () => {
  it('acepta light y dark', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
  });

  it('cualquier otra cosa (o nada) es system', () => {
    expect(parseTheme(undefined)).toBe('system');
    expect(parseTheme('system')).toBe('system');
    expect(parseTheme('DARK')).toBe('system');
    expect(parseTheme(5)).toBe('system');
  });

  it('la cookie tiene nombre fijo', () => {
    expect(THEME_COOKIE).toBe('notas-theme');
  });
});
```

- [ ] **Step 2: Correrlo y verlo fallar**

Run (PowerShell): `npx vitest run tests/lib/theme.test.ts`
Expected: FAIL — `Cannot find module '@/lib/theme'` (o similar).

- [ ] **Step 3: Implementar `src/lib/theme.ts`**

```ts
/** Preferencia de tema: `system` sigue a `prefers-color-scheme`; `light`/`dark` la fijan. */
export const THEME_COOKIE = 'notas-theme';
export const THEMES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEMES)[number];

export function parseTheme(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}
```

- [ ] **Step 4: Correr el test**

Run: `npx vitest run tests/lib/theme.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Server action del tema — `src/app/theme-actions.ts`**

```ts
'use server';

import { cookies } from 'next/headers';
import { THEME_COOKIE, parseTheme, type ThemePreference } from '@/lib/theme';

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Guarda la preferencia en una cookie: la lee el layout raíz para poner `data-theme` sin parpadeo. */
export async function setThemeAction(value: ThemePreference): Promise<void> {
  const theme = parseTheme(value);
  const store = await cookies();
  if (theme === 'system') {
    store.delete(THEME_COOKIE);
    return;
  }
  store.set(THEME_COOKIE, theme, {
    path: '/', maxAge: ONE_YEAR, sameSite: 'lax', httpOnly: true, secure: process.env.NODE_ENV === 'production',
  });
}
```

- [ ] **Step 6: Reescribir `src/app/globals.css` con los tokens del diseño**

Valores copiados tal cual de `Notas - Rediseño.dc.html` (bloques `--bg…--shadow-lg` de las secciones «Tema claro» y «Tema oscuro»), más los agregados de las decisiones 3 y 4.

```css
@import "tailwindcss";

/* ---------- Tokens del diseño (claro por defecto) ---------- */
:root {
  color-scheme: light;
  --bg: #F7F5F1;
  --surface: #FFFFFF;
  --sidebar: #EFECE6;
  --fg: #1B1A17;
  --muted: #6B675F;
  --border: #E3DED5;
  --hover: #ECE8E1;
  --selected: #DDEBEE;
  --accent: #15697B;
  --accent-hover: #0E505E;
  --accent-fg: #FFFFFF;
  --danger: #C23B30;
  --danger-bg: #FBECEA;
  --p-high: #C23B30;
  --p-med: #B86E0E;
  --p-low: #2F6BCB;
  --p-none: #8F8A80;
  --skeleton: #E8E4DD;
  --scrim: rgba(27, 26, 23, .45);
  --av-1: #15697B;
  --av-2: #B04A6E;
  --av-3: #2F7D5B;
  --av-4: #6A4FC0;
  --av-5: #A65A1B;
  --av-6: #2F6BCB;
  --av-fg: #FFFFFF;
  --toast-bg: #2A2926;
  --toast-fg: #F7F5F1;
  --toast-accent: #8FD3E1;
  --toast-danger: #F2958C;
  --shadow: 0 1px 2px rgba(27, 26, 23, .05), 0 10px 30px rgba(27, 26, 23, .07);
  --shadow-lg: 0 2px 6px rgba(27, 26, 23, .08), 0 20px 50px rgba(27, 26, 23, .18);
}

/* Oscuro: tokens propios (no es el claro invertido). Sigue al sistema salvo que se haya elegido "claro". */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #161513;
    --surface: #1D1C19;
    --sidebar: #121110;
    --fg: #ECE8E1;
    --muted: #A19C93;
    --border: #2C2A26;
    --hover: #262420;
    --selected: #1A3139;
    --accent: #5FBBCD;
    --accent-hover: #7CCBDB;
    --accent-fg: #0B1D22;
    --danger: #F07B70;
    --danger-bg: #3A1F1C;
    --p-high: #F07B70;
    --p-med: #E7A23C;
    --p-low: #74A8F3;
    --p-none: #7E796F;
    --skeleton: #26241F;
    --scrim: rgba(0, 0, 0, .6);
    --av-1: #7CCBDB;
    --av-2: #E58AA8;
    --av-3: #7FD1A4;
    --av-4: #B9A5F2;
    --av-5: #F0B07A;
    --av-6: #8FB6F5;
    --av-fg: #141311;
    --toast-bg: #ECE8E1;
    --toast-fg: #1B1A17;
    --toast-accent: #15697B;
    --toast-danger: #C23B30;
    --shadow: 0 1px 2px rgba(0, 0, 0, .4), 0 12px 32px rgba(0, 0, 0, .45);
    --shadow-lg: 0 2px 6px rgba(0, 0, 0, .5), 0 24px 60px rgba(0, 0, 0, .6);
  }
}

/* Oscuro elegido a mano en Configuración (cookie notas-theme → data-theme en <html>). */
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #161513;
  --surface: #1D1C19;
  --sidebar: #121110;
  --fg: #ECE8E1;
  --muted: #A19C93;
  --border: #2C2A26;
  --hover: #262420;
  --selected: #1A3139;
  --accent: #5FBBCD;
  --accent-hover: #7CCBDB;
  --accent-fg: #0B1D22;
  --danger: #F07B70;
  --danger-bg: #3A1F1C;
  --p-high: #F07B70;
  --p-med: #E7A23C;
  --p-low: #74A8F3;
  --p-none: #7E796F;
  --skeleton: #26241F;
  --scrim: rgba(0, 0, 0, .6);
  --av-1: #7CCBDB;
  --av-2: #E58AA8;
  --av-3: #7FD1A4;
  --av-4: #B9A5F2;
  --av-5: #F0B07A;
  --av-6: #8FB6F5;
  --av-fg: #141311;
  --toast-bg: #ECE8E1;
  --toast-fg: #1B1A17;
  --toast-accent: #15697B;
  --toast-danger: #C23B30;
  --shadow: 0 1px 2px rgba(0, 0, 0, .4), 0 12px 32px rgba(0, 0, 0, .45);
  --shadow-lg: 0 2px 6px rgba(0, 0, 0, .5), 0 24px 60px rgba(0, 0, 0, .6);
}

/* ---------- Tokens → utilidades de Tailwind ---------- */
@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-sidebar: var(--sidebar);
  --color-fg: var(--fg);
  --color-muted: var(--muted);
  --color-line: var(--border);
  --color-hover: var(--hover);
  --color-selected: var(--selected);
  --color-accent: var(--accent);
  --color-accent-hover: var(--accent-hover);
  --color-accent-fg: var(--accent-fg);
  --color-danger: var(--danger);
  --color-danger-bg: var(--danger-bg);
  --color-p-high: var(--p-high);
  --color-p-med: var(--p-med);
  --color-p-low: var(--p-low);
  --color-p-none: var(--p-none);
  --color-skeleton: var(--skeleton);
  --color-scrim: var(--scrim);
  --color-av-fg: var(--av-fg);
  --color-toast-bg: var(--toast-bg);
  --color-toast-fg: var(--toast-fg);
  --color-toast-accent: var(--toast-accent);
  --color-toast-danger: var(--toast-danger);
  --shadow-card: var(--shadow);
  --shadow-pop: var(--shadow-lg);
  --font-sans: var(--font-manrope), system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;
}

@theme {
  /* Radios: 5 chip · 6 etiqueta · 7 píldora · 8 nav/botón chico · 9 input/botón · 10 fila · 12 tarjeta · 16 diálogo */
  --radius-chip: 5px;
  --radius-tag: 6px;
  --radius-pill: 7px;
  --radius-nav: 8px;
  --radius-input: 9px;
  --radius-row: 10px;
  --radius-card: 12px;
  --radius-dialog: 16px;

  /* Escala tipográfica del diseño (Manrope). */
  --text-display: 24px;
  --text-display--line-height: 1.2;
  --text-display--letter-spacing: -0.025em;
  --text-display--font-weight: 800;
  --text-title: 20px;
  --text-title--line-height: 1.3;
  --text-title--letter-spacing: -0.015em;
  --text-title--font-weight: 700;
  --text-heading: 18px;
  --text-heading--line-height: 1.3;
  --text-heading--letter-spacing: -0.02em;
  --text-heading--font-weight: 800;
  --text-body: 14px;
  --text-body--line-height: 1.45;
  --text-body-sm: 13.5px;
  --text-body-sm--line-height: 1.55;
  --text-caption: 12.5px;
  --text-caption--line-height: 1.4;
  --text-meta: 12px;
  --text-meta--line-height: 1.4;
  --text-overline: 11.5px;
  --text-overline--line-height: 1.4;
  --text-overline--letter-spacing: .08em;
  --text-overline--font-weight: 700;

  /* Curvas: ease-out para todo, spring solo en el checkbox. */
  --ease-out: cubic-bezier(.2, .8, .2, 1);
  --ease-spring: cubic-bezier(.34, 1.4, .64, 1);

  /* Animaciones (curvas escritas a mano: las variables de @theme sin usar pueden no emitirse). */
  --animate-check: notas-check 200ms cubic-bezier(.34, 1.4, .64, 1) both;
  --animate-check-mark: notas-check-mark 200ms cubic-bezier(.34, 1.4, .64, 1) both;
  --animate-fade-in: notas-fade-in 200ms cubic-bezier(.2, .8, .2, 1) both;
  --animate-panel-in: notas-panel-in 280ms cubic-bezier(.2, .8, .2, 1) both;
  --animate-screen-in: notas-screen-in 280ms cubic-bezier(.2, .8, .2, 1) both;
  --animate-toast-in: notas-toast-in 200ms cubic-bezier(.2, .8, .2, 1) both;
  --animate-skeleton: notas-pulse 1.4s ease-in-out infinite alternate;
}

/* ---------- Keyframes (sin capa: las de movimiento reducido, más abajo, ganan) ---------- */
@keyframes notas-check {
  0%, 15% { box-shadow: inset 0 0 0 2px var(--cb-color, var(--p-none)); background: transparent; transform: scale(1); }
  35% { transform: scale(.86); }
  55% { box-shadow: inset 0 0 0 11px var(--accent); background: var(--accent); transform: scale(1.14); }
  70%, 100% { box-shadow: inset 0 0 0 11px var(--accent); background: var(--accent); transform: scale(1); }
}
@keyframes notas-check-mark {
  0%, 45% { opacity: 0; transform: scale(.3); }
  65%, 100% { opacity: 1; transform: scale(1); }
}
@keyframes notas-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}
@keyframes notas-panel-in {
  from { opacity: 0; transform: translateX(24px); }
  to { opacity: 1; transform: none; }
}
@keyframes notas-screen-in {
  from { transform: translateX(100%); }
  to { transform: none; }
}
@keyframes notas-toast-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}
@keyframes notas-pulse {
  from { opacity: .6; }
  to { opacity: 1; }
}
@keyframes notas-toast-bar {
  from { transform: scaleX(1); }
  to { transform: scaleX(0); }
}

/* Con prefers-reduced-motion: sin escala ni desplazamiento, solo fundidos de 120 ms. */
@media (prefers-reduced-motion: reduce) {
  @keyframes notas-check {
    from { box-shadow: inset 0 0 0 2px var(--cb-color, var(--p-none)); background: transparent; }
    to { box-shadow: inset 0 0 0 11px var(--accent); background: var(--accent); }
  }
  @keyframes notas-check-mark { from { opacity: 0; } to { opacity: 1; } }
  @keyframes notas-fade-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes notas-panel-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes notas-screen-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes notas-toast-in { from { opacity: 0; } to { opacity: 1; } }
  *, *::before, *::after {
    animation-duration: 120ms !important;
    transition-duration: 120ms !important;
  }
  .animate-skeleton { animation: none !important; }
  [data-toast-bar] { display: none; }
}

/* ---------- Base ---------- */
@layer base {
  html {
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  body {
    background: var(--bg);
    color: var(--fg);
    font-size: 14px;
    line-height: 1.45;
  }
  /* Anillo de foco: 2 px de acento con 2 px de separación, en todo lo enfocable. */
  :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  ::placeholder {
    color: var(--muted);
    opacity: 1;
  }
  ::selection {
    background: var(--selected);
  }
}
```

- [ ] **Step 7: Clases compartidas — `src/components/ui.ts`**

Sin alto, padding ni tamaño de letra (cambian según el lugar: 34/38/40/42 px); cada uso los agrega. Así nunca hay dos clases de la misma propiedad en conflicto.

```ts
/** Clases del sistema de diseño. Cada uso agrega alto, padding horizontal y tamaño de letra. */
export const btn = {
  /** Primario: fondo acento, 700. */
  primary:
    'inline-flex items-center justify-center gap-2 rounded-input bg-accent font-bold text-accent-fg transition-colors duration-120 hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50',
  /** Secundario: borde, superficie, 600. */
  secondary:
    'inline-flex items-center justify-center gap-2 rounded-input border border-line bg-surface font-semibold text-fg transition-colors duration-120 hover:bg-hover disabled:pointer-events-none disabled:opacity-50',
  /** Peligro lleno (confirmaciones). */
  danger:
    'inline-flex items-center justify-center gap-2 rounded-input bg-danger font-bold text-white transition-[filter] duration-120 hover:brightness-95 disabled:pointer-events-none disabled:opacity-50',
  /** Peligro fantasma («Mandar a la papelera», «Borrar lista»). */
  ghostDanger:
    'inline-flex items-center gap-[7px] rounded-input font-semibold text-danger transition-colors duration-120 hover:bg-danger-bg disabled:pointer-events-none disabled:opacity-50',
  /** Botón de ícono (X, ←, menú). */
  icon:
    'inline-flex shrink-0 items-center justify-center rounded-nav text-muted transition-colors duration-120 hover:bg-hover hover:text-fg',
};

/**
 * Campo de texto/select: borde, foco con anillo `--selected`, error con borde de peligro. Agregar alto, fondo y
 * `font-normal` (dentro de un <label> en 600 el input heredaría el peso). Sin color de texto: hereda `--fg`
 * y se puede atenuar (p. ej. «Sin carpeta») sin chocar con otra clase de color.
 */
export const field =
  'w-full rounded-input border border-line px-3 text-body outline-none transition-[border-color,box-shadow] duration-120 placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_3px_var(--selected)] focus-visible:outline-none aria-[invalid=true]:border-danger disabled:bg-hover disabled:opacity-55';

/** Rótulo de sección dentro de paneles: 12 / 700 / +6 % / mayúsculas. */
export const sectionLabel = 'text-[12px] font-bold uppercase tracking-[.06em] text-muted';
```

- [ ] **Step 8: Reescribir `src/app/layout.tsx`**

```tsx
import type { Metadata, Viewport } from 'next';
import { Geist_Mono, Manrope } from 'next/font/google';
import { cookies } from 'next/headers';
import { THEME_COOKIE, parseTheme } from '@/lib/theme';
import './globals.css';

const manrope = Manrope({
  variable: '--font-manrope', subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], display: 'swap',
});
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'], weight: ['400', '500'], display: 'swap' });

export const metadata: Metadata = { title: 'Notas', description: 'Tus tareas, tuyas y de la IA' };
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F5F1' },
    { media: '(prefers-color-scheme: dark)', color: '#161513' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // El tema manual llega en la cookie: se resuelve en el servidor para no parpadear al cargar.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="es" data-theme={theme === 'system' ? undefined : theme}
      className={`${manrope.variable} ${geistMono.variable}`}
    >
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 9: Tipos, lint y tests**

Run: `npx tsc --noEmit` → sin errores. `npm run lint` → sin errores. `npx vitest run tests/lib/theme.test.ts` → PASS.

- [ ] **Step 10: Chequeo visual de tokens**

`npm run dev`, ingresar con `prueba@example.com`. Todavía con los componentes viejos, verificar en 1200 px: fondo de la app `#F7F5F1`, barra lateral `#EFECE6`, texto en Manrope (DevTools → «Rendered fonts»: Manrope). Con `resize_window` `colorScheme: "dark"`: fondo `#161513`, barra `#121110`. En la consola del navegador (`javascript_tool`): `document.documentElement.dataset.theme = 'dark'` con el sistema en claro → pasa a oscuro; `'light'` con el sistema en oscuro → claro; `delete document.documentElement.dataset.theme` → vuelve a seguir al sistema. Captura `t1-tokens-1200-claro.png` y `t1-tokens-1200-oscuro.png`.

- [ ] **Step 11: Commit**

```bash
git add src/app/globals.css src/app/layout.tsx src/lib/theme.ts src/app/theme-actions.ts src/components/ui.ts tests/lib/theme.test.ts
git commit -m "feat(ui): tokens del rediseño, Manrope + Geist Mono y tema claro/oscuro con cookie"
```

---

### Task 2: Formateadores, iniciales y `useMediaQuery` (TDD)

Todo lo que las pantallas escriben como texto derivado (fechas de píldora y de chip, subtítulos de vista, «Modificada hace…», «Borrada hace… · se elimina en…», grupos de Completadas, iniciales y color de avatar) se resuelve con funciones puras y testeadas.

**Files:**
- Modify: `src/lib/format.ts`, `src/lib/initials.ts`, `tests/lib/format.test.ts`, `tests/lib/initials.test.ts`
- Create: `src/lib/use-media-query.ts`

- [ ] **Step 1: Tests que fallan para los formateadores nuevos**

Agregar al final de `tests/lib/format.test.ts` (y ampliar el import de la primera línea a
`import { formatAgo, formatChipDate, formatDetailDate, formatDueLabel, formatLongDate, formatShortDate, formatWeekRange, groupTasksByCompletedDay, groupTasksByDate, localDate, localTime, pendingLabel, trashNote } from '@/lib/format';`):

```ts
const SAT = '2026-10-10'; // sábado
const BA = 'America/Argentina/Buenos_Aires'; // UTC-3

describe('formatChipDate (agregado rápido)', () => {
  it('Hoy, Mañana o día corto con dd/mm', () => {
    expect(formatChipDate('2026-10-10', SAT)).toBe('Hoy');
    expect(formatChipDate('2026-10-11', SAT)).toBe('Mañana');
    expect(formatChipDate('2026-10-12', SAT)).toBe('Lun 12/10');
    expect(formatChipDate('2026-10-09', SAT)).toBe('Vie 09/10');
    expect(formatChipDate('2027-01-05', SAT)).toBe('Mar 05/01/2027');
  });
});

describe('formatDetailDate (píldora del detalle)', () => {
  it('palabra relativa o día corto, día y mes abreviado', () => {
    expect(formatDetailDate('2026-10-10', SAT)).toBe('Hoy, 10 oct');
    expect(formatDetailDate('2026-10-11', SAT)).toBe('Mañana, 11 oct');
    expect(formatDetailDate('2026-10-09', SAT)).toBe('Ayer, 9 oct');
    expect(formatDetailDate('2026-10-15', SAT)).toBe('Jue, 15 oct');
    expect(formatDetailDate('2027-01-05', SAT)).toBe('Mar, 5 ene 2027');
  });
});

describe('subtítulos de vista', () => {
  it('fecha larga', () => {
    expect(formatLongDate('2026-10-10')).toBe('Sábado 10 de octubre');
    expect(formatLongDate('2026-01-01')).toBe('Jueves 1 de enero');
  });

  it('rango de 7 días (hoy … hoy+6)', () => {
    expect(formatWeekRange('2026-10-10')).toBe('Sáb 10 → Vie 16 de octubre');
    expect(formatWeekRange('2026-10-28')).toBe('Mié 28 de octubre → Mar 3 de noviembre');
  });

  it('pendientes en singular y plural', () => {
    expect(pendingLabel(0)).toBe('0 pendientes');
    expect(pendingLabel(1)).toBe('1 pendiente');
    expect(pendingLabel(5)).toBe('5 pendientes');
  });
});

describe('fecha y hora en la zona del usuario', () => {
  it('localDate / localTime / formatShortDate', () => {
    expect(localDate(new Date('2026-10-10T12:12:00Z'), BA)).toBe('2026-10-10');
    expect(localTime(new Date('2026-10-10T12:12:00Z'), BA)).toBe('09:12');
    expect(localDate(new Date('2026-10-10T02:00:00Z'), BA)).toBe('2026-10-09');
    expect(localTime(new Date('2026-10-10T02:00:00Z'), BA)).toBe('23:00');
    expect(formatShortDate(new Date('2026-10-02T15:00:00Z'), BA)).toBe('02/10');
  });
});

describe('formatAgo', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const ago = (ms: number) => formatAgo(new Date(now.getTime() - ms), now, BA);
  it('momento, minutos, horas, días y después la fecha', () => {
    expect(ago(30_000)).toBe('hace un momento');
    expect(ago(-5_000)).toBe('hace un momento');
    expect(ago(5 * 60_000)).toBe('hace 5 min');
    expect(ago(2 * 3_600_000)).toBe('hace 2 h');
    expect(ago(26 * 3_600_000)).toBe('hace 1 día');
    expect(ago(3 * 86_400_000)).toBe('hace 3 días');
    expect(ago(40 * 86_400_000)).toBe('el 31/08');
  });
});

describe('trashNote', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const note = (ms: number) => trashNote(new Date(now.getTime() - ms), now);
  it('días desde el borrado y días que faltan para la purga', () => {
    expect(note(2 * 3_600_000)).toBe('Borrada hoy · se elimina en 30');
    expect(note(86_400_000)).toBe('Borrada hace 1 día · se elimina en 29');
    expect(note(3 * 86_400_000)).toBe('Borrada hace 3 días · se elimina en 27');
    expect(note(31 * 86_400_000)).toBe('Borrada hace 31 días · se elimina hoy');
  });
});

describe('groupTasksByCompletedDay', () => {
  it('agrupa por día de completado en la zona del usuario, en el orden recibido', () => {
    const tasks = [
      { id: 'a', completedAt: new Date('2026-10-10T12:12:00Z') },
      { id: 'b', completedAt: new Date('2026-10-10T11:30:00Z') },
      { id: 'c', completedAt: new Date('2026-10-10T02:00:00Z') }, // 09/10 23:00 en Buenos Aires
      { id: 'd', completedAt: new Date('2026-10-08T15:40:00Z') },
    ];
    expect(groupTasksByCompletedDay(tasks, SAT, BA).map((g) => [g.label, g.tasks.map((t) => t.id)])).toEqual([
      ['Hoy', ['a', 'b']], ['Ayer', ['c']], ['Jueves 08/10', ['d']],
    ]);
  });
});
```

Y en `tests/lib/initials.test.ts` reemplazar los casos de una palabra y sin nombre, y agregar `avatarTone` (import: `import { avatarTone, initials } from '@/lib/initials';`):

```ts
  it('una palabra → su primera letra (como el diseño: «E»)', () => {
    expect(initials({ name: 'Ángel', email: 'x@example.com' })).toBe('Á');
  });

  it('sin nombre → la primera letra del email', () => {
    expect(initials({ name: '', email: 'juan@example.com' })).toBe('J');
    expect(initials({ name: '   ', email: 'z@example.com' })).toBe('Z');
  });

  it('avatarTone: estable, entre 1 y 6 y repartido', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const tones = ids.map(avatarTone);
    expect(tones.every((t) => Number.isInteger(t) && t >= 1 && t <= 6)).toBe(true);
    expect(ids.map(avatarTone)).toEqual(tones);
    expect(new Set(tones).size).toBeGreaterThanOrEqual(4);
  });
```

(Los casos «dos palabras» y «emojis» quedan como están: siguen valiendo.)

- [ ] **Step 2: Correrlos y verlos fallar**

Run: `npx vitest run tests/lib/format.test.ts tests/lib/initials.test.ts`
Expected: FAIL — exports inexistentes (`formatChipDate is not a function`, etc.) y `initials` devuelve `'ÁN'`/`'JU'`.

- [ ] **Step 3: Reescribir `src/lib/format.ts` completo**

```ts
import { addDays, dayOfWeek } from '@/core/dates';

const SHORT_DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const LONG_DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const SHORT_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

function dayMonth(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

const dayNumber = (iso: string) => Number(iso.slice(8, 10));
const monthIndex = (iso: string) => Number(iso.slice(5, 7)) - 1;

/** "Hoy", "Mañana", "Ayer" o "Jueves 08/10" (con año si no es el actual). Para encabezados de grupo. */
function relativeDayLabel(day: string, today: string): string {
  const diff = daysBetween(today, day);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  if (diff === -1) return 'Ayer';
  const year = day.slice(0, 4) !== today.slice(0, 4) ? `/${day.slice(0, 4)}` : '';
  return `${LONG_DAYS[dayOfWeek(day)]} ${dayMonth(day)}${year}`;
}

/** "Hoy", "Mañana", "Ayer", día corto si cae en los próximos 6 días, o dd/mm[/aaaa]. Fecha de la fila. */
export function formatDueLabel(dueDate: string, today: string): string {
  const diff = daysBetween(today, dueDate);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  if (diff === -1) return 'Ayer';
  if (diff > 1 && diff < 7) return SHORT_DAYS[dayOfWeek(dueDate)];
  if (dueDate.slice(0, 4) !== today.slice(0, 4)) return `${dayMonth(dueDate)}/${dueDate.slice(0, 4)}`;
  return dayMonth(dueDate);
}

/** Chip del agregado rápido: "Hoy", "Mañana" o "Lun 12/10" (con año si no es el actual). */
export function formatChipDate(dueDate: string, today: string): string {
  const diff = daysBetween(today, dueDate);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  const year = dueDate.slice(0, 4) !== today.slice(0, 4) ? `/${dueDate.slice(0, 4)}` : '';
  return `${SHORT_DAYS[dayOfWeek(dueDate)]} ${dayMonth(dueDate)}${year}`;
}

/** Píldora de fecha del detalle: "Hoy, 10 oct", "Jue, 15 oct", "Mar, 5 ene 2027". */
export function formatDetailDate(dueDate: string, today: string): string {
  const diff = daysBetween(today, dueDate);
  const word = diff === 0 ? 'Hoy' : diff === 1 ? 'Mañana' : diff === -1 ? 'Ayer' : SHORT_DAYS[dayOfWeek(dueDate)];
  const year = dueDate.slice(0, 4) !== today.slice(0, 4) ? ` ${dueDate.slice(0, 4)}` : '';
  return `${word}, ${dayNumber(dueDate)} ${SHORT_MONTHS[monthIndex(dueDate)]}${year}`;
}

/** Subtítulo de Hoy: "Sábado 10 de octubre". */
export function formatLongDate(iso: string): string {
  return `${LONG_DAYS[dayOfWeek(iso)]} ${dayNumber(iso)} de ${MONTHS[monthIndex(iso)]}`;
}

/** Subtítulo de Próximos 7 días (hoy … hoy+6): "Sáb 10 → Vie 16 de octubre". */
export function formatWeekRange(today: string): string {
  const end = addDays(today, 6);
  const short = (iso: string) => `${SHORT_DAYS[dayOfWeek(iso)]} ${dayNumber(iso)}`;
  const month = (iso: string) => MONTHS[monthIndex(iso)];
  return today.slice(5, 7) === end.slice(5, 7)
    ? `${short(today)} → ${short(end)} de ${month(end)}`
    : `${short(today)} de ${month(today)} → ${short(end)} de ${month(end)}`;
}

export function pendingLabel(count: number): string {
  return `${count} ${count === 1 ? 'pendiente' : 'pendientes'}`;
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** Día (YYYY-MM-DD) de un instante en la zona del usuario. */
export function localDate(date: Date, timeZone: string): string {
  return zonedParts(date, timeZone).date;
}

/** Hora (HH:mm, 24 hs) de un instante en la zona del usuario. */
export function localTime(date: Date, timeZone: string): string {
  return zonedParts(date, timeZone).time;
}

/** "02/10" en la zona del usuario. */
export function formatShortDate(date: Date, timeZone: string): string {
  return dayMonth(localDate(date, timeZone));
}

/** "hace un momento", "hace 5 min", "hace 2 h", "hace 3 días" (hasta 29); después "el 31/08". */
export function formatAgo(date: Date, now: Date, timeZone: string): string {
  const ms = Math.max(0, now.getTime() - date.getTime());
  if (ms < MINUTE) return 'hace un momento';
  if (ms < HOUR) return `hace ${Math.floor(ms / MINUTE)} min`;
  if (ms < DAY) return `hace ${Math.floor(ms / HOUR)} h`;
  const days = Math.floor(ms / DAY);
  if (days < 30) return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
  return `el ${formatShortDate(date, timeZone)}`;
}

/** Nota de una fila en la papelera: "Borrada hace 3 días · se elimina en 27" (purga a los 30 días). */
export function trashNote(deletedAt: Date, now: Date, retentionDays = 30): string {
  const days = Math.max(0, Math.floor((now.getTime() - deletedAt.getTime()) / DAY));
  const left = Math.max(retentionDays - days, 0);
  const ago = days === 0 ? 'Borrada hoy' : `Borrada hace ${days} ${days === 1 ? 'día' : 'días'}`;
  return `${ago} · ${left === 0 ? 'se elimina hoy' : `se elimina en ${left}`}`;
}

export interface TaskGroup<T> {
  key: string;
  label: string;
  tasks: T[];
}

/** Agrupa (manteniendo el orden recibido) en Vencidas, un grupo por día y Sin fecha. */
export function groupTasksByDate<T extends { dueDate: string | null }>(tasks: T[], today: string): TaskGroup<T>[] {
  const overdue: T[] = [];
  const byDay = new Map<string, T[]>();
  const undated: T[] = [];
  for (const task of tasks) {
    if (task.dueDate === null) undated.push(task);
    else if (task.dueDate < today) overdue.push(task);
    else {
      const day = byDay.get(task.dueDate);
      if (day) day.push(task);
      else byDay.set(task.dueDate, [task]);
    }
  }
  const groups: TaskGroup<T>[] = [];
  if (overdue.length) groups.push({ key: 'overdue', label: 'Vencidas', tasks: overdue });
  for (const day of [...byDay.keys()].sort()) {
    groups.push({ key: day, label: relativeDayLabel(day, today), tasks: byDay.get(day)! });
  }
  if (undated.length) groups.push({ key: 'undated', label: 'Sin fecha', tasks: undated });
  return groups;
}

/** Completadas agrupadas por el día en que se completaron (zona del usuario), en el orden recibido. */
export function groupTasksByCompletedDay<T extends { completedAt: Date | null }>(
  tasks: T[], today: string, timeZone: string,
): TaskGroup<T>[] {
  const groups: TaskGroup<T>[] = [];
  for (const task of tasks) {
    const key = task.completedAt ? localDate(task.completedAt, timeZone) : 'undated';
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, label: key === 'undated' ? 'Sin fecha' : relativeDayLabel(key, today), tasks: [] };
      groups.push(group);
    }
    group.tasks.push(task);
  }
  return groups;
}
```

- [ ] **Step 4: `src/lib/initials.ts` completo**

```ts
/** Primeros `n` caracteres visibles (por punto de código, para no partir emojis). */
function firstChars(text: string, n: number): string {
  return Array.from(text).slice(0, n).join('');
}

/** Iniciales del avatar (como el diseño): dos palabras → dos letras, una → una, sin nombre → la del email. */
export function initials(person: { name: string; email: string }): string {
  const words = person.name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (firstChars(words[0], 1) + firstChars(words[1], 1)).toUpperCase();
  if (words.length === 1) return firstChars(words[0], 1).toUpperCase();
  return firstChars(person.email, 1).toUpperCase();
}

/** Tono estable (1 a 6) del avatar de una persona: hash simple de su id (o email). */
export function avatarTone(key: string): number {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return (hash % 6) + 1;
}
```

- [ ] **Step 5: `src/lib/use-media-query.ts`**

```ts
'use client';

import { useSyncExternalStore } from 'react';

/**
 * `matchMedia` como estado de React. En el servidor y durante la hidratación devuelve `serverValue`
 * (sin desajustes); después se corrige solo.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}
```

- [ ] **Step 6: Correr los tests**

Run: `npx vitest run tests/lib/format.test.ts tests/lib/initials.test.ts`
Expected: PASS (los casos viejos de `formatDueLabel`/`groupTasksByDate` siguen pasando sin cambios).

- [ ] **Step 7: Tipos y lint**

Run: `npx tsc --noEmit` y `npm run lint` → sin errores. (No hay cambio visual todavía, salvo que los avatares existentes muestran una sola letra para nombres de una palabra.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/format.ts src/lib/initials.ts src/lib/use-media-query.ts tests/lib/format.test.ts tests/lib/initials.test.ts
git commit -m "feat(ui): formateadores de fechas relativas, iniciales y tono de avatar del rediseño"
```

---

### Task 3: Primitivas — Avatar, Modal apilable, ConfirmDialog, toasts, estado vacío y esqueletos

Diseño de referencia: «Chips, avatares e ítem de navegación», «Diálogo de lista», «Toast deshacer / IA / error», «Estados vacíos» y «Cargando» en `NotasPantallas.dc.html`.

**Files:**
- Rewrite: `src/components/avatar.tsx`, `src/components/modal.tsx`
- Create: `src/components/confirm-dialog.tsx`, `src/components/toast.tsx`, `src/components/empty-state.tsx`, `src/components/skeleton.tsx`
- Modify (solo para que compile): `src/components/task-item.tsx`, `src/components/list-members.tsx`

- [ ] **Step 1: `src/components/avatar.tsx`**

Tamaños del diseño: 18 (compartidas en la barra), 20 (píldora «Asignada a»), 22 (pie de la barra), 24 (fila), 26 (miembros), 28 (pila del encabezado), 30 (encabezado de celular), 36 (Configuración).

```tsx
import { avatarTone, initials } from '@/lib/initials';

export type AvatarSize = 18 | 20 | 22 | 24 | 26 | 28 | 30 | 36;

const TEXT: Record<AvatarSize, string> = {
  18: 'text-[9px]', 20: 'text-[9px]', 22: 'text-[10px]', 24: 'text-[10px]',
  26: 'text-[10px]', 28: 'text-[11px]', 30: 'text-[12px]', 36: 'text-[14px]',
};

/**
 * Círculo con las iniciales y un tono estable por persona (hash del id → 1 de 6).
 * Decorativo: quien lo usa agrega el texto accesible. `ring` lo separa del fondo en una pila.
 */
export function Avatar({
  person, size = 24, ring = false,
}: { person: { id?: string; name: string; email: string }; size?: AvatarSize; ring?: boolean }) {
  return (
    <span
      title={person.name || person.email} aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold text-av-fg ${TEXT[size]} ${ring ? 'border-2 border-bg' : ''}`}
      style={{ width: size, height: size, backgroundColor: `var(--av-${avatarTone(person.id ?? person.email)})` }}
    >
      {initials(person)}
    </span>
  );
}
```

Ajustar los dos usos existentes para que compile (se reescriben en las Tasks 5 y 8): en `src/components/task-item.tsx` cambiar `<Avatar person={task.assignee} size="sm" />` por `<Avatar person={task.assignee} size={24} />`; en `src/components/list-members.tsx` cambiar `<Avatar person={m} />` por `<Avatar person={m} size={26} />`.

- [ ] **Step 2: `src/components/modal.tsx` (reestilado en el lugar + pila)**

Se conserva todo: foco inicial (sin pisar un `autoFocus`), Tab atrapado, Escape, vuelta del foco al cerrar, bloqueo del scroll, clic en el fondo solo si el mousedown también fue en el fondo, portal al `body`. Se agrega: pila de diálogos, `titleAdornment` (punto de color), `footer` en franja `--bg`, tamaño `sm` (400 px) para confirmaciones y `role="alertdialog"`.

```tsx
'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { btn } from './ui';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Diálogos abiertos, del más viejo al más nuevo: solo el de arriba atiende Escape y Tab. */
const openDialogs: symbol[] = [];

export function Modal({
  title, titleAdornment, onClose, children, footer, size = 'md', role = 'dialog',
}: {
  title: string;
  /** Algo antes del título (p. ej. el punto de color de la lista). */
  titleAdornment?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** Franja inferior con los botones. */
  footer?: React.ReactNode;
  size?: 'sm' | 'md';
  role?: 'dialog' | 'alertdialog';
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropPressed = useRef(false);
  // Se captura durante el render: un `autoFocus` hijo ya habrá movido el foco cuando corran los efectos.
  const [previous] = useState(() => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)));
  // Siempre la última versión de onClose, sin reinstalar los listeners ni volver a enfocar en cada render.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // Foco: al abrir entra al diálogo, Tab queda atrapado adentro y al cerrar vuelve a donde estaba.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const token = Symbol('dialog');
    openDialogs.push(token);
    const isTop = () => openDialogs[openDialogs.length - 1] === token;
    if (!dialog.contains(document.activeElement)) {
      dialog.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return; // hay otro diálogo encima: que lo atienda él
      if (e.key === 'Escape') {
        e.preventDefault();
        return onCloseRef.current();
      }
      if (e.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return e.preventDefault();
      const first = items[0];
      const last = items[items.length - 1];
      if (!dialog.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      openDialogs.splice(openDialogs.indexOf(token), 1);
      if (previous?.isConnected) previous.focus();
    };
  }, [previous]);

  // Bloquea el scroll del fondo mientras el diálogo está abierto.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Portal al body: dentro de la barra lateral (con transform) un `fixed` se posicionaría respecto de ella.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-scrim p-4"
      onMouseDown={(e) => { backdropPressed.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (backdropPressed.current && e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef} role={role} aria-modal="true" aria-labelledby={titleId}
        className={`flex max-h-[calc(100dvh-32px)] w-full flex-col rounded-dialog border border-line bg-surface text-fg shadow-pop ${size === 'sm' ? 'max-w-[400px]' : 'max-w-[480px]'}`}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-[18px]">
          <h2 id={titleId} className="flex min-w-0 items-center gap-2.5 text-heading">
            {titleAdornment}
            <span className="truncate">{title}</span>
          </h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className={`${btn.icon} h-8 w-8`}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-[18px]">{children}</div>
        {footer && (
          <div className="flex shrink-0 items-center gap-2.5 rounded-b-dialog border-t border-line bg-bg px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 3: `src/components/confirm-dialog.tsx`**

```tsx
'use client';

import { Modal } from './modal';
import { btn } from './ui';

/** Confirmación de una acción sin vuelta atrás: diálogo chico con botón de peligro. */
export function ConfirmDialog({
  title, body, confirmLabel, onConfirm, onCancel, pending = false,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
}) {
  return (
    <Modal
      title={title} onClose={onCancel} size="sm" role="alertdialog"
      footer={(
        <>
          <span className="flex-1" />
          <button type="button" onClick={onCancel} className={`${btn.secondary} h-10 px-3.5 text-[13.5px]`}>Cancelar</button>
          <button type="button" onClick={onConfirm} disabled={pending} className={`${btn.danger} h-10 px-[18px] text-[13.5px]`}>
            {confirmLabel}
          </button>
        </>
      )}
    >
      <p className="text-body-sm text-muted">{body}</p>
    </Modal>
  );
}
```

- [ ] **Step 4: `src/components/toast.tsx`**

Toast del diseño: 48 px, radio 12, `--toast-bg`/`--toast-fg`, `shadow-lg`, 13,5/500, padding `0 8px 0 16px`, gap 12, ícono 16, acción 32 px en `--toast-accent` 700, cerrar 32 px al 70 %. Papelera: 6 s con barra que se detiene con el mouse/foco. Error: rol `alert`, sin X.

```tsx
'use client';

import { CircleAlert, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export type ToastTone = 'trash' | 'ai' | 'error';

export interface ToastInput {
  tone: ToastTone;
  message: string;
  action?: { label: string; onClick: () => void };
  /** ms; por defecto 6 s (papelera, IA) u 8 s (error). */
  duration?: number;
}

interface ToastState extends ToastInput {
  id: number;
}

const DEFAULT_DURATION: Record<ToastTone, number> = { trash: 6000, ai: 6000, error: 8000 };

const ToastContext = createContext<(toast: ToastInput) => void>(() => {});

/** Muestra un toast (reemplaza al que hubiera). */
export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const nextId = useRef(0);
  const show = useCallback((input: ToastInput) => setToast({ ...input, id: ++nextId.current }), []);
  const dismiss = useCallback(() => setToast(null), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* Abajo a la izquierda del contenido; en celular, encima del agregado rápido. */}
      <div className="pointer-events-none fixed inset-x-4 bottom-[96px] z-[60] flex md:bottom-6 md:left-[272px] md:right-auto">
        {toast && <Toast key={toast.id} toast={toast} onDone={dismiss} />}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ toast, onDone }: { toast: ToastState; onDone: () => void }) {
  const duration = toast.duration ?? DEFAULT_DURATION[toast.tone];
  const [paused, setPaused] = useState(false);
  const remaining = useRef(duration);

  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const timer = setTimeout(onDone, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt;
    };
  }, [paused, onDone]);

  const Icon = toast.tone === 'trash' ? Trash2 : toast.tone === 'ai' ? Sparkles : CircleAlert;
  const iconClass = toast.tone === 'ai' ? 'text-toast-accent' : toast.tone === 'error' ? 'text-toast-danger' : 'opacity-80';
  const hover = 'hover:bg-[color-mix(in_oklab,var(--toast-fg)_10%,transparent)]';

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      className="pointer-events-auto relative flex h-12 max-w-full animate-toast-in items-center gap-3 overflow-hidden rounded-card bg-toast-bg pl-4 pr-2 text-[13.5px] font-medium text-toast-fg shadow-pop"
    >
      <Icon size={16} strokeWidth={2.2} aria-hidden="true" className={`shrink-0 ${iconClass}`} />
      <span className="min-w-0 truncate">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => { toast.action!.onClick(); onDone(); }}
          className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-pill px-2.5 font-bold text-toast-accent ${hover} focus-visible:outline-toast-accent`}
        >
          {toast.tone === 'trash' && <Undo2 size={14} strokeWidth={2.4} aria-hidden="true" />}
          {toast.action.label}
        </button>
      )}
      {toast.tone !== 'error' && (
        <button
          type="button" onClick={onDone} aria-label="Cerrar aviso"
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-pill opacity-70 hover:opacity-100 ${hover} focus-visible:outline-toast-accent`}
        >
          <X size={15} strokeWidth={2.2} aria-hidden="true" />
        </button>
      )}
      {toast.tone === 'trash' && (
        <span
          data-toast-bar aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-toast-accent"
          style={{ animation: `notas-toast-bar ${duration}ms linear forwards`, animationPlayState: paused ? 'paused' : 'running' }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: `src/components/empty-state.tsx`**

Diseño: tile 44 px radio 12 `--hover` con ícono 20 `--muted`, título 15/700 (−1 %), cuerpo 13 `--muted` máx. 260 px, acción 36 px radio 9 13/700 (primaria o secundaria).

```tsx
import type { LucideIcon } from 'lucide-react';

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}

export function EmptyState({
  icon: Icon, title, body, action,
}: { icon: LucideIcon; title: string; body: string; action?: EmptyStateAction }) {
  const actionClass = action?.variant === 'secondary'
    ? 'border-line bg-surface text-fg hover:bg-hover'
    : 'border-accent bg-accent text-accent-fg hover:bg-accent-hover';
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-7 py-16 text-center">
      <span className="mb-2 flex h-11 w-11 items-center justify-center rounded-card bg-hover text-muted">
        <Icon size={20} aria-hidden="true" />
      </span>
      <p className="text-[15px] font-bold tracking-[-0.01em]">{title}</p>
      <p className="max-w-[260px] text-[13px] text-pretty text-muted">{body}</p>
      {action && (
        <button
          type="button" onClick={action.onClick}
          className={`mt-3 inline-flex h-9 items-center rounded-input border px-3.5 text-[13px] font-bold transition-colors duration-120 ${actionClass}`}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 6: `src/components/skeleton.tsx`**

Diseño «Cargando»: barra de grupo 90×14 radio 5; filas de 44 px con círculo 20, barra de 12 px (máx. 62 / 45 / 72 %) y barra final de 36 / 50 / 28 px; pulso 1,4 s (opacidad .6 → 1).

```tsx
const ROWS: [string, number][] = [['62%', 36], ['45%', 50], ['72%', 28]];

export function TaskListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando tareas" className="flex flex-col gap-3.5 pt-5">
      <div className="mx-3.5 h-3.5 w-[90px] animate-skeleton rounded-chip bg-skeleton" />
      {ROWS.map(([width, end], i) => (
        <div key={i} className="flex h-11 items-center gap-3.5 px-3.5">
          <span className="h-5 w-5 shrink-0 animate-skeleton rounded-full bg-skeleton" />
          <span className="h-3 flex-1 animate-skeleton rounded-chip bg-skeleton" style={{ maxWidth: width }} />
          <span className="ml-auto h-3 shrink-0 animate-skeleton rounded-chip bg-skeleton" style={{ width: end }} />
        </div>
      ))}
    </div>
  );
}

/** Columna de lista mientras carga una vista (título, agregado rápido y filas). */
export function WorkspaceSkeleton() {
  return (
    <div className="h-full overflow-hidden">
      <div className="mx-auto w-full max-w-[760px] px-2 pt-[30px] md:px-7">
        <div className="mx-2 h-6 w-36 animate-skeleton rounded-chip bg-skeleton md:mx-0" />
        <div className="mx-2 mt-2.5 h-3 w-52 animate-skeleton rounded-chip bg-skeleton md:mx-0" />
        <div className="mx-2 mt-[18px] hidden h-[46px] rounded-row border border-line bg-surface md:mx-0 md:block" />
        <TaskListSkeleton />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Tipos y lint**

Run: `npx tsc --noEmit` y `npm run lint` → sin errores.

- [ ] **Step 8: Chequeo visual del diálogo**

`npm run dev`, en la barra lateral «+» (Nueva lista): el diálogo ya usa el `Modal` nuevo (radio 16, sombra grande, fondo `--scrim`, título 18/800, X de 32 px). Comprobar Escape, Tab atrapado y que el foco vuelve al «+». Captura `t3-modal-1200-claro.png` y `-oscuro`.

- [ ] **Step 9: Commit**

```bash
git add src/components/avatar.tsx src/components/modal.tsx src/components/confirm-dialog.tsx src/components/toast.tsx src/components/empty-state.tsx src/components/skeleton.tsx src/components/task-item.tsx src/components/list-members.tsx
git commit -m "feat(ui): primitivas del rediseño (avatar, diálogo apilable, confirmación, toasts, vacíos, esqueletos)"
```

---

### Task 4: Shell, cajón de celular y barra lateral (con contadores y dueños de listas compartidas)

Diseño de referencia: `NotasSidebar.dc.html` (248 px; activo `today`, `next7`, `list-trabajo`, `settings`), «12 · Celular → Cajón» (300 px, `--scrim`, `shadow-lg`), «Chips, avatares e ítem de navegación» (normal / hover / activa / foco).

**Files:**
- Modify: `src/core/tasks.ts` (`countTasks`), `src/core/lists.ts` (`sharedListOwners`), `src/app/app/layout.tsx`
- Create: `tests/core/tasks-counts.test.ts`, `src/components/mobile-header.tsx`
- Modify: `tests/core/lists-shared.test.ts`
- Rewrite: `src/components/app-shell.tsx`, `src/components/sidebar.tsx`

- [ ] **Step 1: Tests que fallan (núcleo)**

`tests/core/tasks-counts.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, todayIn } from '@/core/dates';
import { createList } from '@/core/lists';
import { completeTask, countTasks, createTask, deleteTask, listTasks, type ListTasksFilter } from '@/core/tasks';
import type { PublicUser as User } from '@/core/users';
import type { DB } from '@/db/types';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
let user: User;

beforeEach(async () => {
  db = await createTestDb();
  user = await createTestUser(db);
});

describe('countTasks', () => {
  it('cuenta lo mismo que listTasks en cada vista', async () => {
    const today = todayIn(user.timezone);
    const list = await createList(db, user.id, { name: 'Casa' });
    await createTask(db, user.id, { title: 'Bandeja sin fecha' });
    await createTask(db, user.id, { title: 'Bandeja hoy', dueDate: today });
    await createTask(db, user.id, { title: 'Vencida', listId: list.id, dueDate: addDays(today, -2) });
    const done = await createTask(db, user.id, { title: 'Hecha hoy', dueDate: today });
    await completeTask(db, user.id, done.id);
    const trashed = await createTask(db, user.id, { title: 'Borrada' });
    await deleteTask(db, user.id, trashed.id);

    const filters: ListTasksFilter[] = [
      { view: 'inbox' }, { view: 'today' }, { view: 'next7' }, { view: 'completed' }, { view: 'trash' }, { listId: list.id },
    ];
    for (const filter of filters) {
      expect(await countTasks(db, user.id, filter)).toBe((await listTasks(db, user.id, filter)).length);
    }
    expect(await countTasks(db, user.id, { view: 'inbox' })).toBe(2);
    expect(await countTasks(db, user.id, { view: 'today' })).toBe(2);
  });

  it('no tiene el límite de 100 de listTasks', async () => {
    for (let i = 0; i < 102; i++) await createTask(db, user.id, { title: `T${i}` });
    expect(await countTasks(db, user.id, { view: 'inbox' })).toBe(102);
  });
});
```

En `tests/core/lists-shared.test.ts`, agregar `sharedListOwners` al import de `@/core/lists` y este bloque al final:

```ts
describe('sharedListOwners', () => {
  it('devuelve el dueño de cada lista compartida conmigo (y nada de las propias)', async () => {
    expect(await sharedListOwners(db, member.id)).toEqual({
      [shared.id]: { id: owner.id, name: 'Emir', email: 'duenio@example.com' },
    });
    expect(await sharedListOwners(db, owner.id)).toEqual({});
    expect(await sharedListOwners(db, stranger.id)).toEqual({});
  });
});
```

- [ ] **Step 2: Verlos fallar**

Run: `npx vitest run tests/core/tasks-counts.test.ts tests/core/lists-shared.test.ts`
Expected: FAIL — `countTasks` y `sharedListOwners` no existen.

- [ ] **Step 3: `countTasks` en `src/core/tasks.ts`**

Extraer las condiciones de `listTasks` a una función (mismo código, sin cambios de comportamiento) y agregar el conteo. Reemplazar **desde** `export async function listTasks(` **hasta** el `return hydrate(db, userId, rows);` final de esa función por:

```ts
/** Condiciones de `listTasks` y `countTasks` para un filtro (sin orden ni paginado). */
async function filterConditions(db: DB, userId: string, filter: ListTasksFilter): Promise<SQL[]> {
  const { view } = filter;
  const conditions: SQL[] = [inArray(tasks.listId, accessibleListIds(db, userId))];

  conditions.push(view === 'trash' ? isNotNull(tasks.deletedAt) : isNull(tasks.deletedAt));
  if (view === 'completed') conditions.push(eq(tasks.status, 'completed'));
  else if (view !== 'trash' && !filter.includeCompleted) conditions.push(eq(tasks.status, 'pending'));

  if (view === 'inbox') conditions.push(eq(tasks.listId, (await getInbox(db, userId)).id));
  if (view === 'assigned') conditions.push(eq(tasks.assigneeId, userId));
  if (view === 'today' || view === 'next7') {
    const user = await getUser(db, userId);
    const today = todayIn(user.timezone, filter.now);
    const until = view === 'today' ? today : addDays(today, 6);
    // Las vencidas solo cuentan si siguen pendientes; las completadas, solo de hoy en adelante.
    conditions.push(
      isNotNull(tasks.dueDate),
      lte(tasks.dueDate, until),
      or(eq(tasks.status, 'pending'), gte(tasks.dueDate, today))!,
      // De las listas compartidas conmigo, solo las asignadas a mí.
      or(inArray(tasks.listId, ownedListIds(db, userId)), eq(tasks.assigneeId, userId))!,
    );
  }
  if (filter.listId) conditions.push(eq(tasks.listId, (await getList(db, userId, filter.listId)).id));
  if (filter.tag) {
    const name = normalizeTagName(filter.tag);
    conditions.push(
      inArray(
        tasks.id,
        db
          .select({ id: taskTags.taskId })
          .from(taskTags)
          .innerJoin(tags, eq(tags.id, taskTags.tagId))
          .where(and(eq(tags.userId, userId), eq(tags.name, name))),
      ),
    );
  }
  return conditions;
}

export async function listTasks(db: DB, userId: string, filter: ListTasksFilter = {}): Promise<TaskWithDetails[]> {
  const { view } = filter;
  const limit = filter.limit ?? DEFAULT_LIMIT;
  const offset = filter.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new ValidationError(`El límite debe ser un entero entre 1 y ${MAX_LIMIT}`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ValidationError('El desplazamiento debe ser un entero mayor o igual a 0');
  }
  const conditions = await filterConditions(db, userId, filter);

  const order =
    view === 'completed' ? [desc(tasks.completedAt), asc(tasks.id)]
    : view === 'trash' ? [desc(tasks.deletedAt), asc(tasks.id)]
    : [
        sql`${tasks.dueDate} asc nulls last`,
        sql`${tasks.dueTime} asc nulls last`,
        desc(tasks.priority),
        asc(tasks.sortOrder),
        asc(tasks.createdAt),
        asc(tasks.id),
      ];

  const rows = await db.select().from(tasks).where(and(...conditions)).orderBy(...order).limit(limit).offset(offset);
  return hydrate(db, userId, rows);
}

/** Cuántas tareas devolvería `listTasks` con este filtro, sin límite. Para los contadores de la barra lateral. */
export async function countTasks(
  db: DB, userId: string, filter: Omit<ListTasksFilter, 'limit' | 'offset'> = {},
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(tasks)
    .where(and(...(await filterConditions(db, userId, filter))));
  return Number(row.n);
}
```

- [ ] **Step 4: `sharedListOwners` en `src/core/lists.ts`**

Agregar `users` al import del esquema (`import { folders, listMembers, lists, tasks, users } from '@/db/schema';`) y, después de `listLists`:

```ts
/** Datos mínimos del dueño de una lista. */
export interface ListOwner {
  id: string;
  name: string;
  email: string;
}

/** Dueño de cada lista compartida con el usuario (id de lista → dueño), para su avatar en la barra lateral. */
export async function sharedListOwners(db: DB, userId: string): Promise<Record<string, ListOwner>> {
  const rows = await db
    .select({ listId: lists.id, id: users.id, name: users.name, email: users.email })
    .from(listMembers)
    .innerJoin(lists, eq(lists.id, listMembers.listId))
    .innerJoin(users, eq(users.id, lists.userId))
    .where(eq(listMembers.userId, userId));
  return Object.fromEntries(rows.map(({ listId, ...owner }) => [listId, owner]));
}
```

- [ ] **Step 5: Correr los tests**

Run: `npx vitest run tests/core/tasks-counts.test.ts tests/core/lists-shared.test.ts tests/core/tasks-query.test.ts tests/core/tasks-shared-views.test.ts`
Expected: PASS (los de `listTasks` siguen verdes: la extracción no cambia el comportamiento).

- [ ] **Step 6: `src/components/app-shell.tsx` (reestilado en el lugar)**

Se conserva: cerrar el cajón al navegar, `inert` en el cajón cerrado de celular, foco al primer link al abrir, Escape (salvo con un diálogo abierto), cerrar al tocar un link o el fondo. Cambia: el encabezado de celular lo pone cada página (`MobileHeader`), así que el shell expone por contexto el usuario y `openDrawer`; el foco vuelve al botón que abrió el cajón; agrega los toasts.

```tsx
'use client';

import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicUser } from '@/core/users';
import { useMediaQuery } from '@/lib/use-media-query';
import { ToastProvider } from './toast';

interface ShellContextValue {
  user: PublicUser;
  drawerOpen: boolean;
  openDrawer: () => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

/** Usuario actual y control del cajón de celular (para los encabezados de cada página). */
export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error('useShell solo funciona dentro de AppShell');
  return value;
}

/** Layout responsive: barra lateral fija en escritorio, cajón deslizable de 300 px en celular. */
export function AppShell({ user, sidebar, children }: { user: PublicUser; sidebar: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // En el servidor y al hidratar se asume escritorio (como antes); después se corrige.
  const isDesktop = useMediaQuery('(min-width: 768px)', true);
  const pathname = usePathname();
  const asideRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => setOpen(false), [pathname]);

  const openDrawer = useCallback(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);
  const closeDrawer = useCallback(() => {
    setOpen(false);
    openerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    asideRef.current?.querySelector('a')?.focus();
    const onKey = (e: KeyboardEvent) => {
      // El diálogo abierto atiende su propio Escape.
      if (e.key !== 'Escape' || document.querySelector('[aria-modal="true"]')) return;
      closeDrawer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeDrawer]);

  const shell = useMemo(() => ({ user, drawerOpen: open, openDrawer }), [user, open, openDrawer]);

  return (
    <ShellContext.Provider value={shell}>
      <ToastProvider>
        <div className="flex h-dvh overflow-hidden bg-bg">
          <aside
            id="app-drawer" ref={asideRef} inert={!open && !isDesktop}
            onClick={(e) => { if ((e.target as Element).closest('a')) setOpen(false); }}
            className={`fixed inset-y-0 left-0 z-40 w-[300px] bg-sidebar transition-transform duration-280 ease-out md:static md:w-[248px] md:shrink-0 md:translate-x-0 md:border-r md:border-line md:shadow-none ${open ? 'translate-x-0 shadow-pop' : '-translate-x-full'}`}
          >
            {sidebar}
          </aside>
          {open && <div className="fixed inset-0 z-30 animate-fade-in bg-scrim md:hidden" onClick={closeDrawer} />}
          <main className="min-h-0 min-w-0 flex-1">{children}</main>
        </div>
      </ToastProvider>
    </ShellContext.Provider>
  );
}
```

- [ ] **Step 7: `src/components/mobile-header.tsx`**

Diseño «Celular Hoy»: botón de menú 44 px (ícono 22), título 22/800 (−2,5 %, alto de línea 1,15), subtítulo 12,5 `--muted`, avatar 30 px en un área de 44 px; padding `4px 10px 10px`.

```tsx
'use client';

import { Menu } from 'lucide-react';
import Link from 'next/link';
import { useShell } from './app-shell';
import { Avatar } from './avatar';

/** Encabezado de celular (oculto desde md): menú, título y subtítulo de la vista, avatar → Configuración. */
export function MobileHeader({ title, subtitle }: { title: React.ReactNode; subtitle?: React.ReactNode }) {
  const { user, drawerOpen, openDrawer } = useShell();
  return (
    <header className="flex shrink-0 items-center gap-1.5 px-2.5 pb-2.5 pt-1 md:hidden">
      <button
        type="button" onClick={openDrawer} aria-label="Abrir menú" aria-expanded={drawerOpen} aria-controls="app-drawer"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-row text-fg transition-colors duration-120 hover:bg-hover"
      >
        <Menu size={22} aria-hidden="true" />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="flex items-center gap-2 truncate text-[22px] font-extrabold leading-[1.15] tracking-[-0.025em]">{title}</h1>
        {subtitle && <p className="truncate text-caption text-muted">{subtitle}</p>}
      </div>
      <Link href="/app/settings" aria-label="Tu cuenta" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
        <Avatar person={user} size={30} />
      </Link>
    </header>
  );
}
```

- [ ] **Step 8: `src/components/sidebar.tsx` (reestilado en el lugar)**

Se conserva: vistas, carpetas plegables con `aria-expanded`, renombrar (prompt), listas propias sueltas y en carpeta, «Compartidas conmigo», etiquetas con `safeDecode`, botón de editar/miembros que aparece al pasar el mouse o con foco (`Editar X` / `Miembros de X`), `aria-current`, «(compartida)» para lector de pantalla y el `ListDialog`. Cambia: estilos del diseño, contadores (aria-hidden), avatar del dueño en compartidas, pie con avatar y email, borrar carpeta con `ConfirmDialog`, errores por toast en lugar de `alert()`.

```tsx
'use client';

import {
  CalendarDays, Check, ChevronDown, CircleCheck, Folder as FolderIcon, Hash, Inbox, Pencil, Plus, Settings, Sun, Trash2,
  UserCheck, Users, type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { Folder, ListOwner, ListWithRole } from '@/core/lists';
import type { Tag } from '@/core/tags';
import type { PublicUser } from '@/core/users';
import { deleteFolderAction, renameFolderAction } from '@/app/app/actions';
import { Avatar } from './avatar';
import { ConfirmDialog } from './confirm-dialog';
import { ListDialog } from './list-dialog';
import { useToast } from './toast';

interface SmartView {
  href: string;
  label: string;
  icon: LucideIcon;
  count?: 'inbox' | 'today';
}

const SMART_VIEWS: SmartView[] = [
  { href: '/app/inbox', label: 'Bandeja', icon: Inbox, count: 'inbox' },
  { href: '/app/today', label: 'Hoy', icon: Sun, count: 'today' },
  { href: '/app/next7', label: 'Próximos 7 días', icon: CalendarDays },
  { href: '/app/assigned', label: 'Asignadas a mí', icon: UserCheck },
  { href: '/app/completed', label: 'Completadas', icon: CircleCheck },
  { href: '/app/trash', label: 'Papelera', icon: Trash2 },
];

const SECTION_TITLE = 'text-[11px] font-bold uppercase tracking-[.08em] text-muted';
const REVEAL = 'md:opacity-0 md:focus-visible:opacity-100 md:group-focus-within:opacity-100 md:group-hover:opacity-100';

// Una URL mal formada (p. ej. /app/tag/%ZZ) no debe romper la barra lateral.
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Ítem de navegación: 32 px por defecto (36 las listas propias, 30 las etiquetas), activo en petróleo claro. */
function NavLink({
  href, active, height = 'h-8', children,
}: { href: string; active: boolean; height?: string; children: React.ReactNode }) {
  return (
    <Link
      href={href} aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2.5 rounded-nav px-2.5 transition-colors duration-120 ${height} ${active ? 'bg-selected font-semibold text-accent' : 'font-medium text-fg hover:bg-hover'}`}
    >
      {children}
    </Link>
  );
}

function ListLink({
  list, pathname, owner, onEdit,
}: { list: ListWithRole; pathname: string; owner?: ListOwner; onEdit: () => void }) {
  const href = `/app/list/${list.id}`;
  const isOwner = list.role === 'owner';
  return (
    <li className="group relative">
      <NavLink href={href} active={pathname === href} height={isOwner ? 'h-9' : 'h-8'}>
        <span className="mx-[3.5px] h-[9px] w-[9px] shrink-0 rounded-full" style={{ backgroundColor: list.color ?? 'var(--muted)' }} />
        <span className="min-w-0 flex-1 truncate">{list.name}</span>
        {isOwner && list.shared && (
          <>
            <Users size={14} className="shrink-0 text-muted" aria-hidden="true" />
            <span className="sr-only">(compartida)</span>
          </>
        )}
        {/* El nombre del dueño no entra al nombre accesible del link (e2e y lectores: "Compras"). */}
        {!isOwner && owner && <Avatar person={owner} size={18} />}
      </NavLink>
      <button
        type="button" onClick={onEdit} aria-label={isOwner ? `Editar ${list.name}` : `Miembros de ${list.name}`}
        className={`absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-chip bg-hover text-muted hover:text-fg ${REVEAL}`}
      >
        {isOwner ? <Pencil size={13} aria-hidden="true" /> : <Users size={13} aria-hidden="true" />}
      </button>
    </li>
  );
}

export function Sidebar({
  user, lists, folders, tags, owners, counts,
}: {
  user: PublicUser; lists: ListWithRole[]; folders: Folder[]; tags: Tag[];
  owners: Record<string, ListOwner>; counts: { inbox: number; today: number };
}) {
  const pathname = usePathname();
  const toast = useToast();
  const [dialog, setDialog] = useState<{ list?: ListWithRole } | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<Folder | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pending, startTransition] = useTransition();
  const ownLists = lists.filter((l) => !l.isInbox && l.role === 'owner');
  const sharedWithMe = lists.filter((l) => l.role === 'member');

  function renameFolder(folder: Folder) {
    const name = prompt('Nuevo nombre de la carpeta', folder.name);
    if (name && name !== folder.name) {
      startTransition(async () => {
        const result = await renameFolderAction(folder.id, name);
        if (!result.ok) toast({ tone: 'error', message: result.error });
      });
    }
  }

  function removeFolder() {
    const folder = folderToDelete;
    if (!folder) return;
    startTransition(async () => {
      const result = await deleteFolderAction(folder.id);
      setFolderToDelete(null);
      if (!result.ok) toast({ tone: 'error', message: result.error });
    });
  }

  return (
    <nav className="flex h-full flex-col overflow-y-auto px-3 pb-3 pt-3.5 text-fg" aria-label="Navegación principal">
      <div className="flex items-center gap-[9px] px-2.5 pb-3 pt-0.5">
        <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] bg-accent text-accent-fg">
          <Check size={13} strokeWidth={3.2} aria-hidden="true" />
        </span>
        <span className="text-[15px] font-extrabold tracking-[-0.02em]">Notas</span>
      </div>

      <ul className="flex flex-col gap-0.5">
        {SMART_VIEWS.map(({ href, label, icon: Icon, count }) => {
          const active = pathname === href;
          const n = count ? counts[count] : 0;
          return (
            <li key={href}>
              <NavLink href={href} active={active}>
                <Icon size={16} aria-hidden="true" className={`shrink-0 ${active ? '' : 'opacity-85'}`} />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {n > 0 && (
                  <span aria-hidden="true" className="text-meta font-medium tabular-nums text-muted">{n > 99 ? '99+' : n}</span>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between px-2.5 pb-1 pt-3.5">
        <h2 className={SECTION_TITLE}>Listas</h2>
        <button
          type="button" onClick={() => setDialog({})} aria-label="Nueva lista"
          className="flex h-6 w-6 items-center justify-center rounded-chip text-muted transition-colors duration-120 hover:bg-hover hover:text-fg"
        >
          <Plus size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-col gap-0.5">
        {folders.map((folder) => {
          const inFolder = ownLists.filter((l) => l.folderId === folder.id);
          const isCollapsed = collapsed[folder.id];
          return (
            <div key={folder.id} className="flex flex-col gap-0.5">
              <div className="group flex h-[30px] items-center gap-1 rounded-nav pl-2.5 pr-1 text-muted transition-colors duration-120 hover:bg-hover">
                <button
                  type="button" onClick={() => setCollapsed((c) => ({ ...c, [folder.id]: !c[folder.id] }))}
                  aria-expanded={!isCollapsed} className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left"
                >
                  <ChevronDown
                    size={13} strokeWidth={2.2} aria-hidden="true"
                    className={`shrink-0 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
                  />
                  <FolderIcon size={15} aria-hidden="true" className="shrink-0" />
                  <span className="truncate font-medium text-fg">{folder.name}</span>
                </button>
                <button
                  type="button" onClick={() => renameFolder(folder)} aria-label={`Renombrar ${folder.name}`}
                  className={`flex h-6 w-6 items-center justify-center rounded-chip hover:text-fg ${REVEAL}`}
                >
                  <Pencil size={13} aria-hidden="true" />
                </button>
                <button
                  type="button" onClick={() => setFolderToDelete(folder)} aria-label={`Borrar ${folder.name}`}
                  className={`flex h-6 w-6 items-center justify-center rounded-chip hover:text-danger ${REVEAL}`}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>
              {!isCollapsed && inFolder.length > 0 && (
                <ul className="ml-[22px] flex flex-col gap-0.5">
                  {inFolder.map((l) => <ListLink key={l.id} list={l} pathname={pathname} onEdit={() => setDialog({ list: l })} />)}
                </ul>
              )}
            </div>
          );
        })}
        <ul className="flex flex-col gap-0.5">
          {ownLists.filter((l) => !l.folderId).map((l) => (
            <ListLink key={l.id} list={l} pathname={pathname} onEdit={() => setDialog({ list: l })} />
          ))}
        </ul>
      </div>

      {sharedWithMe.length > 0 && (
        <div id="sidebar-shared">
          <h2 className={`${SECTION_TITLE} px-2.5 pb-1 pt-3.5`}>Compartidas conmigo</h2>
          <ul className="flex flex-col gap-0.5">
            {sharedWithMe.map((l) => (
              <ListLink key={l.id} list={l} pathname={pathname} owner={owners[l.id]} onEdit={() => setDialog({ list: l })} />
            ))}
          </ul>
        </div>
      )}

      {tags.length > 0 && (
        <>
          <h2 className={`${SECTION_TITLE} px-2.5 pb-1 pt-3.5`}>Etiquetas</h2>
          <ul className="flex flex-col gap-0.5">
            {tags.map((t) => {
              const href = `/app/tag/${encodeURIComponent(t.name)}`;
              return (
                <li key={t.id}>
                  <NavLink href={href} height="h-[30px]" active={pathname === href || safeDecode(pathname) === `/app/tag/${t.name}`}>
                    <Hash size={15} aria-hidden="true" className="mx-px shrink-0 text-muted" />
                    <span className="truncate">{t.name}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="min-h-4 flex-1" />
      <div className="flex flex-col gap-0.5 border-t border-line pt-2.5">
        <NavLink href="/app/settings" active={pathname === '/app/settings'}>
          <Settings size={16} aria-hidden="true" className={`shrink-0 ${pathname === '/app/settings' ? '' : 'opacity-85'}`} />
          Configuración
        </NavLink>
        <div className="flex items-center gap-2.5 px-2.5 pb-0.5 pt-1.5">
          <Avatar person={user} size={22} />
          <span className="truncate text-meta text-muted">{user.email}</span>
        </div>
      </div>

      {dialog && <ListDialog list={dialog.list} folders={folders} onClose={() => setDialog(null)} />}
      {folderToDelete && (
        <ConfirmDialog
          title={`¿Borrar la carpeta «${folderToDelete.name}»?`} body="Sus listas quedan sueltas: no se borran."
          confirmLabel="Borrar carpeta" pending={pending}
          onCancel={() => setFolderToDelete(null)} onConfirm={removeFolder}
        />
      )}
    </nav>
  );
}
```

- [ ] **Step 9: `src/app/app/layout.tsx`**

```tsx
import { listFolders, sharedListOwners } from '@/core/lists';
import { listTags } from '@/core/tags';
import { countTasks } from '@/core/tasks';
import { getDb } from '@/db';
import { AppShell } from '@/components/app-shell';
import { Sidebar } from '@/components/sidebar';
import { requireUser } from '@/lib/auth';
import { getLists } from '@/lib/data';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const db = await getDb();
  const [lists, folders, tags, owners, inbox, today] = await Promise.all([
    getLists(user.id), listFolders(db, user.id), listTags(db, user.id), sharedListOwners(db, user.id),
    countTasks(db, user.id, { view: 'inbox' }), countTasks(db, user.id, { view: 'today' }),
  ]);
  return (
    <AppShell
      user={user}
      sidebar={<Sidebar user={user} lists={lists} folders={folders} tags={tags} owners={owners} counts={{ inbox, today }} />}
    >
      {children}
    </AppShell>
  );
}
```

> Nota: en celular, hasta la Task 5 las vistas no tienen encabezado (el shell ya no lo pone). Es esperado: la Task 5 agrega `MobileHeader` en las vistas de tareas y la Task 10 en Configuración.

- [ ] **Step 10: Tipos, lint y tests**

Run: `npx tsc --noEmit`, `npm run lint`, `npx vitest run tests/core` → todo verde.

- [ ] **Step 11: Chequeo visual**

1200 px, claro y oscuro: comparar la barra con `NotasSidebar.dc.html` — logo 22 px radio 7 + «Notas» 15/800; ítems de 32 px (listas propias 36, etiquetas 30, carpeta 30), radio 8, gap 2; activo `--selected` + `--accent` 600 sin opacidad en el ícono; contadores 12 tabulares `--muted` (Bandeja y Hoy); títulos de sección 11/700/+8 % con padding `14px 10px 4px`; listas dentro de carpeta con sangría de 22 px; pie con borde superior, «Configuración» y avatar 22 + email 12. Navegar con Tab: anillo de 2 px de acento con separación. 390 px (`preset: "mobile"`): abrir el cajón con la consola (`document.querySelector('[aria-controls="app-drawer"]')` todavía no existe hasta la Task 5; para verlo ahora: `javascript_tool` → `document.getElementById('app-drawer').classList.replace('-translate-x-full','translate-x-0')`) y comparar con «Celular Cajón»: 300 px, `shadow-lg`. Capturas `t4-sidebar-1200-{claro,oscuro}.png`, `t4-cajon-390-claro.png`.

- [ ] **Step 12: Commit**

```bash
git add src/core/tasks.ts src/core/lists.ts tests/core/tasks-counts.test.ts tests/core/lists-shared.test.ts src/components/app-shell.tsx src/components/mobile-header.tsx src/components/sidebar.tsx src/app/app/layout.tsx
git commit -m "feat(ui): barra lateral y cajón del rediseño, con contadores y dueños de listas compartidas"
```

---

### Task 5: Columna de tareas — encabezados, lista, fila y checkbox (con salida animada, papelera con deshacer y atajos)

Diseño de referencia: pantallas 02–06 (columna con padding `30px 28px 0`, gap 18, máx. 720/760 px), `NotasLista.dc.html` (grupos y filas), «Fila de tarea» (normal · hover · seleccionada · foco de teclado · completada · vencida · en papelera), «Checkbox de prioridad» (ninguna · baja · media · alta · hover · completada · completando · foco), «12 · Celular → Hoy», notas «Completar una tarea», «Abrir el detalle», «Borrar y deshacer» y «Teclado y accesibilidad».

**Files:**
- Create: `src/components/workspace-context.tsx`, `src/components/view-header.tsx`
- Rewrite: `src/components/task-workspace.tsx`, `src/components/task-list.tsx`, `src/components/task-item.tsx`, `src/components/priority-checkbox.tsx`
- Modify: `src/components/task-page.tsx`

- [ ] **Step 1: `src/components/workspace-context.tsx`**

```tsx
'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { TaskWithDetails } from '@/core/tasks';
import { deleteTaskAction, restoreTaskAction } from '@/app/app/actions';
import { useToast } from './toast';

/** Mensaje cuando una acción ni siquiera llega al servidor (red caída, etc.). */
export const SAVE_ERROR = 'No se pudo guardar. Probá de nuevo.';

export interface WorkspaceActions {
  /** Filas que están saliendo de la vista (completadas, a la papelera o restauradas). */
  hidden: ReadonlySet<string>;
  hide: (taskId: string) => void;
  unhide: (taskId: string) => void;
  /** Manda a la papelera sin confirmar: la fila sale y un toast ofrece «Deshacer» durante 6 s. */
  trash: (task: TaskWithDetails) => void;
  /** Abre el detalle; con `editTitle` el detalle enfoca el título al montarse (atajo E). */
  openTask: (taskId: string, opts?: { editTitle?: boolean }) => void;
  /** Cierra el detalle y devuelve el foco a la fila. */
  closeDetail: () => void;
  /** true una sola vez después de `openTask(…, { editTitle: true })`. */
  consumeEditTitle: () => boolean;
}

const WorkspaceContext = createContext<WorkspaceActions | null>(null);

export function useWorkspace(): WorkspaceActions {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace solo funciona dentro de WorkspaceProvider');
  return value;
}

/** ¿El evento viene de un lugar donde se escribe? (ahí no se disparan los atajos de una letra). */
export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'));
}

export function WorkspaceProvider({
  tasks, selectedId, children,
}: { tasks: TaskWithDetails[]; selectedId?: string; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const editTitle = useRef(false);
  const returnFocusTo = useRef<string | null>(null);

  const hide = useCallback((id: string) => setHidden((prev) => new Set(prev).add(id)), []);
  const unhide = useCallback((id: string) => setHidden((prev) => {
    if (!prev.has(id)) return prev;
    const next = new Set(prev);
    next.delete(id);
    return next;
  }), []);

  // Las que el servidor ya sacó dejan de estar "saliendo": si vuelven (deshacer), entran con fundido.
  useEffect(() => {
    setHidden((prev) => {
      const ids = new Set(tasks.map((t) => t.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [tasks]);

  const closeDetail = useCallback(() => {
    returnFocusTo.current = selectedId ?? null;
    router.push(pathname, { scroll: false });
  }, [router, pathname, selectedId]);

  const openTask = useCallback((id: string, opts?: { editTitle?: boolean }) => {
    editTitle.current = opts?.editTitle ?? false;
    router.push(`${pathname}?t=${id}`, { scroll: false });
  }, [router, pathname]);

  const consumeEditTitle = useCallback(() => {
    const value = editTitle.current;
    editTitle.current = false;
    return value;
  }, []);

  // Al cerrar el detalle (X, ← o Esc), el foco vuelve a la fila de la tarea.
  useEffect(() => {
    if (selectedId || !returnFocusTo.current) return;
    const id = returnFocusTo.current;
    returnFocusTo.current = null;
    document.querySelector<HTMLElement>(`[data-task-link="${id}"]`)?.focus();
  }, [selectedId]);

  const undo = useCallback(async (id: string) => {
    try {
      const result = await restoreTaskAction(id);
      if (result.ok) unhide(id);
      else toast({ tone: 'error', message: result.error });
    } catch {
      toast({ tone: 'error', message: SAVE_ERROR });
    }
  }, [unhide, toast]);

  const trashRef = useRef<(task: TaskWithDetails) => void>(() => {});
  const trash = useCallback((task: TaskWithDetails) => {
    hide(task.id);
    if (selectedId === task.id) router.push(pathname, { scroll: false });
    void (async () => {
      let error: string | null = null;
      try {
        const result = await deleteTaskAction(task.id);
        if (!result.ok) error = result.error;
      } catch {
        error = SAVE_ERROR;
      }
      if (error) {
        unhide(task.id);
        toast({ tone: 'error', message: error, action: { label: 'Reintentar', onClick: () => trashRef.current(task) } });
        return;
      }
      toast({ tone: 'trash', message: 'Tarea enviada a la papelera', action: { label: 'Deshacer', onClick: () => void undo(task.id) } });
    })();
  }, [hide, unhide, undo, toast, router, pathname, selectedId]);
  useEffect(() => { trashRef.current = trash; }, [trash]);

  const value = useMemo<WorkspaceActions>(
    () => ({ hidden, hide, unhide, trash, openTask, closeDetail, consumeEditTitle }),
    [hidden, hide, unhide, trash, openTask, closeDetail, consumeEditTitle],
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
```

- [ ] **Step 2: `src/components/priority-checkbox.tsx`**

Diseño: círculo de 20 px (22 en el detalle) con borde de 2 px del color de prioridad (`--p-none/low/med/high`); hover: fondo del color al 14 % y tilde de 11–12 px del mismo color; completada: relleno `--accent` con tilde `--accent-fg` (trazo 3,5); completando: keyframes `notas-check` (encoge a .86, rebota a 1,14 y se llena) y `notas-check-mark`, 200 ms spring. El borde se dibuja con `box-shadow inset` (como los keyframes) para que la animación sea continua. Se conserva: `role="checkbox"`, `aria-checked`, `aria-label` recibido, `disabled`. El área táctil se agranda a 40 px con un `::before` invisible.

```tsx
'use client';

import { Check } from 'lucide-react';
import { useState } from 'react';

const COLOR: Record<number, string> = { 0: 'var(--p-none)', 1: 'var(--p-low)', 3: 'var(--p-med)', 5: 'var(--p-high)' };

export function PriorityCheckbox({
  checked, priority, onChange, disabled, label, size = 'md',
}: {
  checked: boolean; priority: number; onChange: () => void; disabled?: boolean; label?: string; size?: 'md' | 'lg';
}) {
  const [animating, setAnimating] = useState(false);
  const color = COLOR[priority] ?? COLOR[0];
  return (
    <button
      type="button" role="checkbox" aria-checked={checked} disabled={disabled}
      aria-label={label ?? (checked ? 'Marcar como pendiente' : 'Completar tarea')}
      onClick={() => { setAnimating(!checked); onChange(); }}
      onAnimationEnd={() => setAnimating(false)}
      style={{ '--cb-color': color } as React.CSSProperties}
      className={`group/cb relative flex shrink-0 items-center justify-center rounded-full transition-[background-color,box-shadow] duration-200 before:absolute before:-inset-2.5 before:content-[''] disabled:cursor-default ${size === 'lg' ? 'mt-[3px] h-[22px] w-[22px]' : 'h-5 w-5'} ${checked ? 'bg-accent shadow-[inset_0_0_0_11px_var(--accent)]' : 'shadow-[inset_0_0_0_2px_var(--cb-color)] hover:bg-[color-mix(in_oklab,var(--cb-color)_14%,transparent)]'} ${animating ? 'animate-check' : ''}`}
    >
      <Check
        size={size === 'lg' ? 13 : 12} strokeWidth={3.5} aria-hidden="true"
        className={checked
          ? `text-accent-fg ${animating ? 'animate-check-mark' : ''}`
          : 'text-[var(--cb-color)] opacity-0 transition-opacity duration-120 group-hover/cb:opacity-100'}
      />
    </button>
  );
}
```

- [ ] **Step 3: `src/components/task-item.tsx` (reestilado en el lugar)**

Se conserva: link `?t=` con `scroll={false}`, `aria-label` del checkbox (`Completar "…"` / `Marcar "…" como pendiente`), vencida = pendiente con fecha anterior a hoy, contador de subtareas, etiquetas propias + de otros, nombre de la lista solo en vistas mixtas, avatar + «Asignada a …» para lector **dentro** del link (el e2e busca `/Comprar leche.*Asignada a/`). Cambia: diseño de 48 px en dos líneas, colores de fecha (vencida `--danger` + ícono, hoy `--accent`, resto `--muted`), margen de 600 ms para deshacer, salida animada, toasts de error con «Reintentar», restaurar desde la fila en la papelera, atajos.

```tsx
'use client';

import { CircleAlert, List as ListIcon, RotateCcw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { TaskWithDetails } from '@/core/tasks';
import { formatDueLabel, localTime, trashNote } from '@/lib/format';
import { restoreTaskAction, toggleTaskAction, updateTaskAction } from '@/app/app/actions';
import { Avatar } from './avatar';
import { PriorityCheckbox } from './priority-checkbox';
import { useToast } from './toast';
import { SAVE_ERROR, useWorkspace } from './workspace-context';

export type TaskItemVariant = 'default' | 'completed' | 'trash';

/** Margen para deshacer un clic en el checkbox antes de mandarlo al servidor. */
const UNDO_WINDOW_MS = 600;
/** Atajos 1–4 sobre la fila: 1 = alta, 2 = media, 3 = baja, 4 = sin prioridad. */
const KEY_PRIORITY: Record<string, number> = { 1: 5, 2: 3, 3: 1, 4: 0 };

export function TaskItem({
  task, selected, today, now, timezone, list, variant, isNew,
}: {
  task: TaskWithDetails; selected: boolean; today: string; now: string; timezone: string;
  /** Lista de la tarea (solo en vistas mixtas). */
  list?: { name: string; color: string | null };
  variant: TaskItemVariant; isNew: boolean;
}) {
  const pathname = usePathname();
  const toast = useToast();
  const { hidden, hide, unhide, trash, openTask } = useWorkspace();
  const [localDone, setLocalDone] = useState<boolean | null>(null);
  const [localPriority, setLocalPriority] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDone = useRef<boolean | null>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);

  const done = localDone ?? task.status === 'completed';
  const priority = localPriority ?? task.priority;
  const leaving = hidden.has(task.id);
  const inTrash = variant === 'trash';

  useEffect(() => setLocalPriority(null), [task.priority]);

  // Si la fila se desmonta (p. ej. al navegar) con un clic todavía en su margen, el cambio se manda igual.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (pendingDone.current !== null) void toggleTaskAction(task.id, pendingDone.current);
  }, [task.id]);

  async function commit(next: boolean) {
    timer.current = null;
    pendingDone.current = null;
    hide(task.id);
    setBusy(true);
    let error: string | null = null;
    try {
      const result = await toggleTaskAction(task.id, next);
      if (!result.ok) error = result.error;
    } catch {
      error = SAVE_ERROR;
    }
    setBusy(false);
    if (error) {
      unhide(task.id);
      setLocalDone(null);
      toast({
        tone: 'error', message: error,
        action: { label: 'Reintentar', onClick: () => { setLocalDone(next); void commit(next); } },
      });
    }
  }

  function toggle() {
    if (timer.current) {
      // Segundo clic dentro del margen: se deshace sin tocar el servidor.
      clearTimeout(timer.current);
      timer.current = null;
      pendingDone.current = null;
      setLocalDone(null);
      return;
    }
    const next = !done;
    setLocalDone(next);
    pendingDone.current = next;
    timer.current = setTimeout(() => void commit(next), UNDO_WINDOW_MS);
  }

  async function restore() {
    setBusy(true);
    let error: string | null = null;
    try {
      const result = await restoreTaskAction(task.id);
      if (!result.ok) error = result.error;
    } catch {
      error = SAVE_ERROR;
    }
    setBusy(false);
    if (error) toast({ tone: 'error', message: error });
    else hide(task.id);
  }

  async function changePriority(next: number) {
    if (next === priority) return;
    setLocalPriority(next);
    let error: string | null = null;
    try {
      const result = await updateTaskAction(task.id, { priority: next });
      if (!result.ok) error = result.error;
    } catch {
      error = SAVE_ERROR;
    }
    if (error) {
      setLocalPriority(null);
      toast({ tone: 'error', message: error });
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLLIElement>) {
    if (e.target !== linkRef.current || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const links = [...document.querySelectorAll<HTMLElement>('[data-task-link]')].filter((l) => !l.closest('[inert]'));
      links[links.indexOf(linkRef.current!) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
      return;
    }
    if (inTrash) return;
    if (e.key === ' ') {
      e.preventDefault();
      toggle();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      trash(task);
    } else if (e.key === 'e' || e.key === 'E') {
      e.preventDefault();
      openTask(task.id, { editTitle: true });
    } else if (Object.hasOwn(KEY_PRIORITY, e.key)) {
      e.preventDefault();
      void changePriority(KEY_PRIORITY[e.key]);
    }
  }

  const overdue = !done && task.dueDate !== null && task.dueDate < today;
  const isToday = task.dueDate === today;
  const subtasksDone = task.subtasks.filter((s) => s.done).length;
  const allTags = [...task.tags, ...task.otherTags];
  const note = inTrash && task.deletedAt ? trashNote(task.deletedAt, new Date(now))
    : variant === 'completed' && task.completedAt ? localTime(task.completedAt, timezone)
    : null;
  const hasMeta = Boolean(list || allTags.length > 0 || note);
  const showDate = task.dueDate !== null && variant === 'default';

  return (
    <li
      data-task-row={task.id} onKeyDown={onKeyDown} inert={leaving} aria-hidden={leaving || undefined}
      className={`grid transition-[grid-template-rows,opacity] duration-280 ease-out ${leaving ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'} ${isNew ? 'animate-fade-in' : ''}`}
    >
      {/* overflow-hidden solo mientras sale: si no, recortaría el anillo de foco de la fila. */}
      <div className={`min-h-0 ${leaving ? 'overflow-hidden' : ''}`}>
        <div
          className={`flex min-h-12 items-center gap-3.5 rounded-row px-3.5 py-[9px] transition-colors duration-120 has-[a:focus-visible]:shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--accent)] ${selected ? 'bg-selected' : 'hover:bg-hover'}`}
        >
          {inTrash ? (
            <Trash2 size={18} aria-hidden="true" className="mx-px shrink-0 text-muted" />
          ) : (
            <PriorityCheckbox
              checked={done} priority={priority} onChange={toggle} disabled={busy}
              label={done ? `Marcar "${task.title}" como pendiente` : `Completar "${task.title}"`}
            />
          )}
          <Link
            ref={linkRef} data-task-link={task.id} href={`${pathname}?t=${task.id}`} scroll={false}
            className="flex min-w-0 flex-1 items-center gap-3.5 self-stretch focus-visible:outline-none"
          >
            <span className="flex min-w-0 flex-1 flex-col justify-center gap-[3px]">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={`truncate font-medium transition-colors duration-120 ${done || inTrash ? 'text-muted' : 'text-fg'} ${done ? 'line-through decoration-muted' : ''}`}
                >
                  {task.title}
                </span>
                {task.subtasks.length > 0 && (
                  <span className="inline-flex shrink-0 items-center gap-[3px] text-meta tabular-nums text-muted">
                    <ListIcon size={11} strokeWidth={2.4} aria-hidden="true" />
                    {subtasksDone}/{task.subtasks.length}
                    <span className="sr-only"> subtareas</span>
                  </span>
                )}
              </span>
              {hasMeta && (
                <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted">
                  {list && (
                    <span className="inline-flex shrink-0 items-center gap-[5px]">
                      <span className="h-[7px] w-[7px] rounded-full" style={{ backgroundColor: list.color ?? 'var(--muted)' }} />
                      {list.name}
                    </span>
                  )}
                  {allTags.map((t) => (
                    <span key={t} className="shrink-0 rounded-chip bg-hover px-1.5 py-px font-medium">#{t}</span>
                  ))}
                  {note && <span className="truncate">{note}</span>}
                </span>
              )}
            </span>
            {showDate && (
              <span
                className={`inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap text-caption font-semibold tabular-nums ${overdue ? 'text-danger' : isToday ? 'text-accent' : 'text-muted'}`}
              >
                {overdue && (
                  <>
                    <CircleAlert size={12} strokeWidth={2.4} aria-hidden="true" />
                    <span className="sr-only">Vencida:</span>
                  </>
                )}
                {formatDueLabel(task.dueDate!, today)}{task.dueTime ? ` ${task.dueTime}` : ''}
              </span>
            )}
            {task.assignee && (
              <>
                <Avatar person={task.assignee} size={24} />
                <span className="sr-only">Asignada a {task.assignee.name || task.assignee.email}</span>
              </>
            )}
          </Link>
          {inTrash && (
            <button
              type="button" onClick={() => void restore()} disabled={busy} aria-label={`Restaurar "${task.title}"`}
              className="inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-pill border border-line bg-surface px-2.5 text-caption font-semibold text-fg transition-colors duration-120 hover:bg-hover disabled:opacity-50"
            >
              <RotateCcw size={13} strokeWidth={2.2} aria-hidden="true" />
              Restaurar
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
```

- [ ] **Step 4: `src/components/task-list.tsx`**

Grupo: padding `20px 14px 8px`, rótulo 11,5/700/+8 % mayúsculas (Vencidas en `--danger`), contador 12/500 tabular `--muted`; filas con gap de 2 px.

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import type { List } from '@/core/lists';
import type { TaskWithDetails } from '@/core/tasks';
import { groupTasksByCompletedDay, groupTasksByDate, type TaskGroup } from '@/lib/format';
import { TaskItem, type TaskItemVariant } from './task-item';

export type TaskGrouping = 'date' | 'completed' | 'none';

export function TaskList({
  tasks, selectedId, grouping, today, now, timezone, lists, showListName, variant, empty,
}: {
  tasks: TaskWithDetails[]; selectedId?: string; grouping: TaskGrouping; today: string; now: string; timezone: string;
  lists: List[]; showListName: boolean; variant: TaskItemVariant; empty: React.ReactNode;
}) {
  // Ids ya vistos: las tareas que aparecen después (otra pestaña, la IA, «Deshacer») entran con fundido.
  const [initial] = useState(() => new Set(tasks.map((t) => t.id)));
  const seen = useRef(initial);
  useEffect(() => {
    for (const t of tasks) seen.current.add(t.id);
  }, [tasks]);

  if (tasks.length === 0) return <>{empty}</>;
  const listInfo = new Map(lists.map((l) => [l.id, l]));
  const groups: TaskGroup<TaskWithDetails>[] =
    grouping === 'date' ? groupTasksByDate(tasks, today)
    : grouping === 'completed' ? groupTasksByCompletedDay(tasks, today, timezone)
    : [{ key: 'all', label: '', tasks }];
  return (
    <div>
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label || undefined}>
          {group.label && (
            <h2 className="flex items-baseline gap-2 px-3.5 pb-2 pt-5">
              <span className={`text-overline uppercase ${group.key === 'overdue' ? 'text-danger' : 'text-muted'}`}>{group.label}</span>
              <span className="text-meta font-medium tabular-nums text-muted">{group.tasks.length}</span>
            </h2>
          )}
          <ul className="flex flex-col gap-0.5">
            {group.tasks.map((task) => {
              const info = listInfo.get(task.listId);
              return (
                <TaskItem
                  key={task.id} task={task} selected={task.id === selectedId} today={today} now={now} timezone={timezone}
                  variant={variant} isNew={!seen.current.has(task.id)}
                  list={showListName && info ? { name: info.name, color: info.color } : undefined}
                />
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: `src/components/view-header.tsx`**

Título 24/800 (−2,5 %, 1,2), subtítulo 13 `--muted` a 5 px; acciones alineadas abajo a la derecha.

```tsx
/** Encabezado de una vista en escritorio (en celular lo reemplaza MobileHeader). */
export function ViewHeader({
  title, subtitle, actions,
}: { title: React.ReactNode; subtitle: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="flex min-w-0 items-center gap-2.5 text-display">{title}</h1>
        <p className="mt-[5px] truncate text-[13px] tabular-nums text-muted">{subtitle}</p>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
    </div>
  );
}
```

- [ ] **Step 6: `src/components/task-page.tsx`**

Se conserva todo lo que carga hoy; se agregan `now`, `timezone`, la lista de la vista (con rol), sus miembros si está compartida (pila del encabezado) y las carpetas (para abrir el diálogo de la lista desde «Miembros»).

```tsx
import { todayIn } from '@/core/dates';
import { NotFoundError } from '@/core/errors';
import { listFolders, type Folder } from '@/core/lists';
import { getListMembers, type ListMember } from '@/core/members';
import { getTask, listTasks, type ListTasksFilter, type TaskWithDetails } from '@/core/tasks';
import { getDb } from '@/db';
import type { QuickAddContext } from '@/app/app/actions';
import { requireUser } from '@/lib/auth';
import { getLists } from '@/lib/data';
import { TaskWorkspace } from './task-workspace';

export async function TaskPage({
  title, filter, context, selectedTaskId,
}: { title: string; filter: ListTasksFilter; context: QuickAddContext; selectedTaskId?: string }) {
  const user = await requireUser();
  const db = await getDb();
  const [tasks, lists] = await Promise.all([listTasks(db, user.id, filter), getLists(user.id)]);
  let selected: TaskWithDetails | null = null;
  if (selectedTaskId) {
    selected = await getTask(db, user.id, selectedTaskId, { includeDeleted: filter.view === 'trash' }).catch((err) => {
      if (err instanceof NotFoundError) return null;
      throw err;
    });
  }
  // El selector "Asignada a" solo tiene sentido si la lista de la tarea está compartida.
  const selectedList = selected ? lists.find((l) => l.id === selected.listId) : undefined;
  // También se cargan si quedó una asignación en una lista ya no compartida, para poder limpiarla con "Sin asignar".
  // En la papelera el detalle es de solo lectura: no hace falta.
  const needsMembers = selected && !selected.deletedAt && (selectedList?.shared || selected.assigneeId);
  const members: ListMember[] = selected && needsMembers ? await getListMembers(db, user.id, selected.listId) : [];
  // Vista de una lista: su rol, miembros (pila del encabezado) y carpetas (diálogo de la lista).
  const list = filter.listId ? lists.find((l) => l.id === filter.listId) : undefined;
  const [listMembers, folders]: [ListMember[], Folder[]] = list
    ? await Promise.all([list.shared ? getListMembers(db, user.id, list.id) : Promise.resolve([]), listFolders(db, user.id)])
    : [[], []];
  return (
    <TaskWorkspace
      title={title} tasks={tasks} selected={selected} lists={lists} members={members} context={context}
      today={todayIn(user.timezone)} now={new Date().toISOString()} timezone={user.timezone} currentUserId={user.id}
      list={list} listMembers={listMembers} folders={folders}
    />
  );
}
```

- [ ] **Step 7: `src/components/task-workspace.tsx`**

Se conserva: no ofrecer agregar en Completadas, Asignadas a mí y Papelera; agrupar Hoy y Próximos 7 días; nombre de lista solo en vistas mixtas; detalle con `key={selected.id}`; en pantallas angostas el detalle reemplaza a la lista. Cambia: encabezados del diseño (escritorio y celular), subtítulos, ancho 760/720, agregado rápido abajo en celular, detalle de 400 px con entrada animada, pila de miembros + «Miembros» en listas compartidas, atajo N, contexto del espacio de trabajo. (El estado vacío definitivo llega en la Task 12; acá queda el texto actual con el estilo nuevo. Las props nuevas de `QuickAdd` y `TaskDetail` llegan en las Tasks 6 y 7.)

```tsx
'use client';

import { Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Folder, ListWithRole } from '@/core/lists';
import type { ListMember } from '@/core/members';
import type { TaskWithDetails } from '@/core/tasks';
import type { QuickAddContext } from '@/app/app/actions';
import { formatLongDate, formatWeekRange, pendingLabel } from '@/lib/format';
import { Avatar } from './avatar';
import { ListDialog } from './list-dialog';
import { MobileHeader } from './mobile-header';
import { QuickAdd } from './quick-add';
import { TaskDetail } from './task-detail';
import { TaskList, type TaskGrouping } from './task-list';
import type { TaskItemVariant } from './task-item';
import { ViewHeader } from './view-header';
import { WorkspaceProvider, isEditableTarget } from './workspace-context';

function subtitleFor(context: QuickAddContext, tasks: TaskWithDetails[], today: string, list?: ListWithRole): string {
  const pending = pendingLabel(tasks.filter((t) => t.status === 'pending').length);
  switch (context.view) {
    case 'today': return `${formatLongDate(today)} · ${pending}`;
    case 'next7': return formatWeekRange(today);
    case 'inbox': return `Tareas sin lista · ${pending}`;
    case 'assigned': return `En listas compartidas · ${pending}`;
    case 'completed': return 'Las más recientes primero';
    case 'trash': return 'Se eliminan solas a los 30 días';
  }
  if (context.tag) return `Etiqueta · ${pending}`;
  return list?.shared ? `Compartida · ${pending}` : pending;
}

export function TaskWorkspace({
  title, tasks, selected, lists, members, context, today, now, timezone, currentUserId, list, listMembers, folders,
}: {
  title: string; tasks: TaskWithDetails[]; selected: TaskWithDetails | null;
  lists: ListWithRole[]; members: ListMember[]; context: QuickAddContext; today: string; now: string; timezone: string;
  currentUserId: string; list?: ListWithRole; listMembers: ListMember[]; folders: Folder[];
}) {
  const [listDialog, setListDialog] = useState(false);
  const inTrash = context.view === 'trash';
  // En "Asignadas a mí" una tarea nueva no quedaría asignada y no se vería: no se ofrece agregar.
  const canAdd = context.view !== 'completed' && context.view !== 'assigned' && !inTrash;
  const subtitle = subtitleFor(context, tasks, today, list);
  const maxWidth = selected ? 'md:max-w-[720px]' : 'md:max-w-[760px]';
  const variant: TaskItemVariant = inTrash ? 'trash' : context.view === 'completed' ? 'completed' : 'default';
  const grouping: TaskGrouping =
    context.view === 'today' || context.view === 'next7' ? 'date' : context.view === 'completed' ? 'completed' : 'none';

  // N enfoca el agregado rápido (fuera de campos de texto y sin diálogos abiertos).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'n' && e.key !== 'N') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableTarget(e.target) || document.querySelector('[aria-modal="true"]')) return;
      const input = document.getElementById('quick-add-input');
      if (!input) return;
      e.preventDefault();
      input.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const titleNode = (
    <>
      {list?.color && <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: list.color }} />}
      <span className="truncate">{title}</span>
    </>
  );

  const shownMembers = listMembers.slice(0, 3);
  const extraMembers = listMembers.length - shownMembers.length;
  const headerActions = list?.shared ? (
    <>
      <div
        role="img" aria-label={`Miembros: ${listMembers.map((m) => m.name || m.email).join(', ')}`}
        className="flex items-center"
      >
        {shownMembers.map((m, i) => (
          <span key={m.id} className={i > 0 ? '-ml-2' : ''}><Avatar person={m} size={28} ring /></span>
        ))}
        {extraMembers > 0 && (
          <span className="-ml-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-bg bg-hover text-[11px] font-bold text-muted">
            +{extraMembers}
          </span>
        )}
      </div>
      <button
        type="button" onClick={() => setListDialog(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-nav border border-line bg-surface px-3 text-[13px] font-semibold transition-colors duration-120 hover:bg-hover"
      >
        <Users size={14} aria-hidden="true" />
        Miembros
      </button>
    </>
  ) : undefined;

  return (
    <WorkspaceProvider tasks={tasks} selectedId={selected?.id}>
      <div className="flex h-full">
        <section aria-label={title} className={`min-w-0 flex-1 flex-col ${selected ? 'hidden lg:flex' : 'flex'}`}>
          <MobileHeader title={titleNode} subtitle={subtitle} />
          <div className={`mx-auto hidden w-full shrink-0 px-7 pt-[30px] md:block ${maxWidth}`}>
            <ViewHeader title={titleNode} subtitle={subtitle} actions={headerActions} />
          </div>
          {canAdd && (
            <div
              className={`order-last shrink-0 border-t border-line bg-bg px-3 pb-7 pt-2.5 md:order-none md:mx-auto md:w-full md:border-t-0 md:bg-transparent md:px-7 md:pb-0 md:pt-[18px] ${maxWidth}`}
            >
              <QuickAdd context={context} today={today} />
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className={`mx-auto w-full px-2 pb-16 md:px-7 md:pt-[18px] ${maxWidth}`}>
              <TaskList
                tasks={tasks} selectedId={selected?.id} grouping={grouping} today={today} now={now} timezone={timezone}
                lists={lists} showListName={!context.listId && context.view !== 'inbox'} variant={variant}
                empty={<p className="px-6 py-16 text-center text-[13px] text-muted">No hay tareas acá.</p>}
              />
            </div>
          </div>
        </section>
        {selected && (
          <aside className="flex w-full animate-screen-in flex-col bg-surface lg:w-[400px] lg:shrink-0 lg:animate-panel-in lg:border-l lg:border-line">
            <TaskDetail key={selected.id} task={selected} lists={lists} members={members} currentUserId={currentUserId} />
          </aside>
        )}
      </div>
      {listDialog && list && <ListDialog list={list} folders={folders} onClose={() => setListDialog(false)} />}
    </WorkspaceProvider>
  );
}
```

- [ ] **Step 8: Tipos y lint**

Run: `npx tsc --noEmit` y `npm run lint` → sin errores.

- [ ] **Step 9: Chequeo visual y de comportamiento**

Con datos de prueba (ver «Cómo verificar»), en 1200 px claro y oscuro:
- `/app/today` vs pantalla 02 (sin el detalle todavía): título «Hoy» 24/800, subtítulo «Sábado 10 de octubre · 5 pendientes» (con la fecha real), grupo «VENCIDAS» rojo con contador, fila de 48 px con checkbox de 20 px del color de prioridad, título 14/500, segunda línea con punto de lista de 7 px + `#etiqueta` (chip `--hover` radio 5), fecha 12,5/600 a la derecha (`Ayer` rojo con ícono, `Hoy 15:00` petróleo, otras `--muted`), avatar 24 px.
- `/app/next7` (03), una lista compartida (04: punto de 12 px en el título, pila de avatares de 28 px con borde `--bg`, botón «Miembros» 32 px), Bandeja/Asignadas/Completadas/Papelera/#etiqueta (05/06): Completadas agrupa «Hoy / Ayer / Jueves 08/10» con la hora como nota; Papelera muestra el tacho, «Borrada hace N días · se elimina en M» y «Restaurar» 30 px.
- Hoja «Fila de tarea»: hover `--hover`; seleccionada `--selected`; Tab hasta el link de una fila → anillo de 2 px de acento con separación `--bg` alrededor de **toda** la fila; completada tachada en `--muted`.
- Completar: clic → animación de rebote y tilde; antes de 600 ms otro clic lo deshace; si no, la fila colapsa en 280 ms. En Completadas, destildar hace salir la fila.
- Teclado sobre una fila enfocada: ↑/↓, Espacio, Supr (la fila sale y aparece el toast «Tarea enviada a la papelera» con «Deshacer» y barra; el mouse encima pausa la barra; «Deshacer» la trae con fundido), E (abre el detalle), 1–4 (cambia el color del checkbox). N enfoca el agregado rápido.
- Papelera: «Restaurar» en la fila la saca de la vista.
- 390 px (`preset: "mobile"`) vs «Celular Hoy»: encabezado con menú 44 px, «Hoy» 22/800, subtítulo 12,5 y avatar 30; el agregado rápido abajo con borde superior; el menú abre el cajón y Escape lo cierra devolviendo el foco al botón.
- Movimiento reducido (DevTools → Rendering → `prefers-reduced-motion: reduce`): sin rebote ni desplazamientos, solo fundidos.

Capturas: `t5-hoy-1200-{claro,oscuro}.png`, `t5-next7-1200-claro.png`, `t5-lista-1200-claro.png`, `t5-completadas-1200-claro.png`, `t5-papelera-1200-oscuro.png`, `t5-hoy-390-{claro,oscuro}.png`.

- [ ] **Step 10: Commit**

```bash
git add src/components/workspace-context.tsx src/components/view-header.tsx src/components/task-workspace.tsx src/components/task-list.tsx src/components/task-item.tsx src/components/priority-checkbox.tsx src/components/task-page.tsx
git commit -m "feat(ui): columna de tareas del rediseño con salida animada, papelera con deshacer y atajos"
```

---

### Task 6: Agregado rápido — resaltado de lo detectado, chips y error con toast

Diseño de referencia: «Campo de agregado rápido — reposo · foco · escribiendo con detección» (46 px, radio 10, borde `--border` → `--accent` + anillo 3 px `--selected`, ícono + 17 px `--muted` → `--accent`, tecla «N» / «↵» en chip de 11/600 radio 5), chips de 24 px radio 6 `--selected`/`--accent` 12/600 con íconos de 12 px (bandera rellena del color de prioridad), chip de lista destino `--hover`/`--muted`; celular: 48 px, radio 12, ícono 18 `--accent` trazo 2,4, texto 15 px, «Agregar tarea…». Nota «Agregado rápido»: Enter crea y el campo queda enfocado; Esc limpia; si falla, el texto vuelve con un toast de error.

**Files:**
- Modify: `src/core/quick-add.ts`, `tests/core/quick-add.test.ts`, `src/components/task-workspace.tsx`
- Rewrite: `src/components/quick-add.tsx`

- [ ] **Step 1: Tests que fallan para `quickAddHighlights`**

Agregar al final de `tests/core/quick-add.test.ts` (y `quickAddHighlights` al import):

```ts
describe('quickAddHighlights', () => {
  const SAT = '2026-10-10';

  it('marca fecha, prioridad y etiquetas sobre el texto original', () => {
    expect(quickAddHighlights('Pagar luz mañana !alta #casa', SAT)).toEqual([
      { start: 10, end: 16 }, { start: 17, end: 22 }, { start: 23, end: 28 },
    ]);
    expect(quickAddHighlights('Llamar al contador el lunes !media #llamadas', SAT)).toEqual([
      { start: 19, end: 27 }, { start: 28, end: 34 }, { start: 35, end: 44 },
    ]);
  });

  it('sin nada detectable (o con una fecha imposible) no marca nada', () => {
    expect(quickAddHighlights('Comprar pan', SAT)).toEqual([]);
    expect(quickAddHighlights('Turno 31/02', SAT)).toEqual([]);
    expect(quickAddHighlights('', SAT)).toEqual([]);
  });

  it('sacar lo marcado deja exactamente el título que arma parseQuickAdd', () => {
    const strip = (text: string) => {
      let out = '';
      let pos = 0;
      for (const r of quickAddHighlights(text, SAT)) {
        out += `${text.slice(pos, r.start)} `;
        pos = r.end;
      }
      return `${out}${text.slice(pos)}`.replace(/\s+/g, ' ').replace(/\s+([,.;:!?)])/g, '$1').trim();
    };
    for (const text of [
      'Pagar luz mañana !alta #casa', 'Comprar pan, #super. hoy', 'Reunión el lunes !media',
      'Asado el sábado #finde !baja', 'Llamar pasado mañana', 'Turno 31/02',
    ]) {
      expect(strip(text)).toBe(parseQuickAdd(text, SAT).title);
    }
  });
});
```

- [ ] **Step 2: Verlos fallar**

Run: `npx vitest run tests/core/quick-add.test.ts`
Expected: FAIL — `quickAddHighlights is not a function`.

- [ ] **Step 3: Implementar en `src/core/quick-add.ts`** (después de `parseQuickAdd`)

```ts
export interface TextRange {
  start: number;
  end: number;
}

/**
 * Rangos del texto original que `parseQuickAdd` interpreta (etiquetas, prioridades y la fecha), para resaltarlos
 * mientras se escribe. Repite las mismas reglas, pero tapando con espacios lo ya reconocido para que las
 * posiciones no se corran.
 */
export function quickAddHighlights(text: string, today: string): TextRange[] {
  const padded = ` ${text} `;
  let masked = padded;
  const ranges: TextRange[] = [];
  const take = (start: number, end: number) => {
    masked = masked.slice(0, start) + ' '.repeat(end - start) + masked.slice(end);
    ranges.push({ start: start - 1, end: end - 1 }); // -1: el espacio agregado al principio
  };
  for (const m of padded.matchAll(/(?<=\s)#[\p{L}\p{N}_-]+(?=[,.;:!?)]|\s)/gu)) take(m.index!, m.index! + m[0].length);
  for (const m of masked.matchAll(/(?<=\s)!(?:alta|media|baja)(?=\s)/gi)) take(m.index!, m.index! + m[0].length);
  for (const rule of DATE_RULES) {
    const match = masked.match(rule.re);
    if (!match || !rule.resolve(match, today)) continue;
    take(match.index!, match.index! + match[0].length);
    break;
  }
  return ranges.sort((a, b) => a.start - b.start);
}
```

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run tests/core/quick-add.test.ts`
Expected: PASS (los de `parseQuickAdd` siguen igual).

- [ ] **Step 5: `src/components/quick-add.tsx` (reestilado en el lugar)**

Se conserva: `aria-label="Nueva tarea"`, vista previa con `parseQuickAdd`, envío en transición, no enviar vacío ni dos veces, devolver el texto si falla salvo que ya se esté escribiendo otra cosa. Cambia: diseño, resaltado con capa espejo (decisión 7), chips del diseño + lista destino, toast de error, `id="quick-add-input"` (atajo N), Esc limpia, placeholder por vista (y «Agregar tarea…» en celular).

```tsx
'use client';

import { Calendar, Flag, Hash, Plus } from 'lucide-react';
import { useMemo, useRef, useState, useTransition } from 'react';
import { parseQuickAdd, quickAddHighlights, type TextRange } from '@/core/quick-add';
import { formatChipDate } from '@/lib/format';
import { useMediaQuery } from '@/lib/use-media-query';
import { quickAddAction, type QuickAddContext } from '@/app/app/actions';
import { useToast } from './toast';
import { SAVE_ERROR } from './workspace-context';

const PRIORITY: Record<number, { label: string; color: string }> = {
  1: { label: 'baja', color: 'var(--p-low)' },
  3: { label: 'media', color: 'var(--p-med)' },
  5: { label: 'alta', color: 'var(--p-high)' },
};

const CHIP = 'inline-flex h-6 items-center gap-[5px] rounded-tag px-2 text-meta font-semibold';

/** Parte el texto en tramos normales y resaltados. */
function segments(text: string, ranges: TextRange[]): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.start > pos) out.push({ text: text.slice(pos, r.start), hit: false });
    out.push({ text: text.slice(r.start, r.end), hit: true });
    pos = r.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), hit: false });
  return out;
}

export function QuickAdd({
  context, today, placeholder, destination,
}: {
  context: QuickAddContext; today: string; placeholder: string;
  /** Lista donde va a caer la tarea (la de la vista o la Bandeja). */
  destination: { name: string; color: string | null };
}) {
  const [text, setText] = useState('');
  const [pending, startTransition] = useTransition();
  const mirrorRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const preview = useMemo(() => (text.trim() ? parseQuickAdd(text, today) : null), [text, today]);
  const parts = useMemo(() => segments(text, quickAddHighlights(text, today)), [text, today]);
  const detected = preview !== null && (preview.dueDate !== null || preview.priority > 0 || preview.tags.length > 0);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const submitted = text;
    if (!submitted.trim()) return;
    setText('');
    startTransition(async () => {
      let error: string | null = null;
      try {
        const result = await quickAddAction(submitted, context);
        if (!result.ok) error = result.error;
      } catch {
        error = SAVE_ERROR;
      }
      if (error !== null) {
        // Devuelve el texto para no perderlo, salvo que ya haya empezado a escribir otra cosa.
        setText((current) => current || submitted);
        toast({ tone: 'error', message: error });
      }
    });
  }

  const kbd = 'hidden shrink-0 rounded-chip border border-line px-1.5 py-px font-sans text-[11px] font-semibold text-muted md:inline-block';

  return (
    <form onSubmit={submit} className="flex flex-col-reverse gap-2 md:flex-col">
      <div
        className="group/qa flex h-12 items-center gap-3 rounded-card border border-line bg-surface px-3.5 transition-[border-color,box-shadow] duration-120 focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--selected)] md:h-[46px] md:rounded-row"
      >
        <Plus
          aria-hidden="true"
          className="h-[18px] w-[18px] shrink-0 stroke-[2.4] text-accent md:h-[17px] md:w-[17px] md:stroke-[2.2] md:text-muted md:group-focus-within/qa:text-accent"
        />
        <div className="relative min-w-0 flex-1 self-stretch">
          {/* Capa espejo: el mismo texto con lo detectado en acento, detrás del input transparente. */}
          <div
            ref={mirrorRef} aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre text-[15px] text-fg md:text-body"
          >
            <span>
              {parts.map((p, i) => <span key={i} className={p.hit ? 'text-accent' : undefined}>{p.text}</span>)}
            </span>
          </div>
          <input
            id="quick-add-input" value={text} onChange={(e) => setText(e.target.value)}
            onScroll={(e) => { if (mirrorRef.current) mirrorRef.current.scrollLeft = e.currentTarget.scrollLeft; }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && text) {
                e.preventDefault(); // no cierra el detalle: solo limpia
                setText('');
              }
            }}
            aria-label="Nueva tarea" placeholder={isMobile ? 'Agregar tarea…' : placeholder}
            autoComplete="off" enterKeyHint="done"
            className="relative h-full w-full bg-transparent text-[15px] text-transparent caret-fg outline-none selection:bg-[color-mix(in_oklab,var(--accent)_22%,transparent)] placeholder:text-muted focus-visible:outline-none md:text-body"
          />
        </div>
        {pending ? (
          <span className="shrink-0 text-meta text-muted">Guardando…</span>
        ) : text ? (
          <kbd className={kbd}>↵</kbd>
        ) : (
          <kbd className={`${kbd} md:group-focus-within/qa:hidden`}>N</kbd>
        )}
      </div>
      {detected && preview && (
        <div className="flex flex-wrap gap-1.5 pl-0.5" aria-live="polite">
          {preview.dueDate && (
            <span className={`${CHIP} bg-selected text-accent`}>
              <Calendar size={12} strokeWidth={2.2} aria-hidden="true" />
              {formatChipDate(preview.dueDate, today)}
            </span>
          )}
          {preview.priority > 0 && (
            <span className={`${CHIP} bg-selected text-accent`}>
              <Flag
                size={12} strokeWidth={2} aria-hidden="true"
                color={PRIORITY[preview.priority].color} fill={PRIORITY[preview.priority].color}
              />
              Prioridad {PRIORITY[preview.priority].label}
            </span>
          )}
          {preview.tags.map((t) => (
            <span key={t} className={`${CHIP} bg-selected text-accent`}>
              <Hash size={12} strokeWidth={2.2} aria-hidden="true" />
              {t}
            </span>
          ))}
          <span className={`${CHIP} bg-hover text-muted`}>
            <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full" style={{ backgroundColor: destination.color ?? 'var(--muted)' }} />
            <span className="sr-only">Va a </span>
            {destination.name}
          </span>
        </div>
      )}
    </form>
  );
}
```

> El grosor del trazo del `+` se fija por clase (`stroke-[2.4]` / `md:stroke-[2.2]`) porque cambia entre celular y escritorio; lucide pone `stroke-width` como atributo y la clase lo pisa.

- [ ] **Step 6: Pasar placeholder y destino desde `src/components/task-workspace.tsx`**

Antes del `return`, agregar:

```tsx
  const destinationList = context.listId ? list : lists.find((l) => l.isInbox);
  const destination = { name: destinationList?.name ?? 'Bandeja', color: destinationList?.color ?? null };
  const placeholder =
    context.listId && list ? `Agregar tarea en ${list.name}…`
    : context.view === 'inbox' ? 'Agregar tarea a la Bandeja…'
    : context.tag ? `Agregar tarea con #${context.tag}…`
    : 'Agregar tarea… «Pagar luz mañana !alta #casa»';
```

y reemplazar `<QuickAdd context={context} today={today} />` por:

```tsx
              <QuickAdd context={context} today={today} placeholder={placeholder} destination={destination} />
```

- [ ] **Step 7: Tipos, lint y tests**

Run: `npx tsc --noEmit`, `npm run lint`, `npx vitest run tests/core/quick-add.test.ts` → verde.

- [ ] **Step 8: Chequeo visual y de comportamiento**

1200 px claro y oscuro vs «Campo de agregado rápido» y pantalla 02: reposo (borde `--border`, «+» gris, chip «N»), foco (borde petróleo + anillo `--selected`, «+» petróleo, sin «N»), escribiendo «Pagar luz mañana !alta #casa» → «mañana», «!alta» y «#casa» en petróleo **alineados con el cursor** (escribir, mover el cursor con ←/→ y seleccionar texto: no debe haber desfase), chips «📅 Mañana», «⚑ Prioridad alta» (bandera roja), «# casa» y el de la lista destino. Texto largo: el resaltado acompaña al scroll horizontal. Enter crea la tarea, el campo queda vacío y enfocado. Esc limpia. Con la red cortada (DevTools → Offline) Enter muestra el toast de error y devuelve el texto. 390 px: campo abajo, 48 px, radio 12, placeholder «Agregar tarea…», chips arriba del campo. Capturas `t6-quickadd-1200-{claro,oscuro}.png`, `t6-quickadd-390-claro.png`.

- [ ] **Step 9: Commit**

```bash
git add src/core/quick-add.ts tests/core/quick-add.test.ts src/components/quick-add.tsx src/components/task-workspace.tsx
git commit -m "feat(ui): agregado rápido del rediseño con resaltado de fecha, prioridad y etiquetas"
```

---

### Task 7: Detalle de tarea — propiedades en píldoras, subtareas con progreso, etiquetas y pie

Diseño de referencia: `NotasDetalle.dc.html` (escritorio 400 px y `mobile`), pantalla 02, «Celular Detalle», «Inputs y select» (select de prioridad), «Chips» (`#urgente ×`, `#q4 · de Martín`), botón «Mandar a la papelera» (peligro fantasma), nota «Abrir el detalle».

**Files:**
- Create: `src/components/select-pill.tsx`
- Rewrite: `src/components/priority-select.tsx`, `src/components/task-detail.tsx`, `src/components/subtask-list.tsx`, `src/components/tag-editor.tsx`
- Modify: `src/components/task-workspace.tsx`

- [ ] **Step 1: `src/components/select-pill.tsx`**

Píldora de 30 px, radio 7, borde `--border`, 13,5/600, hover `--hover`; ícono a la izquierda (bandera 13 px con 8 px de margen, punto 8 px con 10, avatar 20 px con 5) y chevron 12 px `--muted` (trazo 2,4). Select nativo (decisión 5).

```tsx
'use client';

import { ChevronDown } from 'lucide-react';

/** Dónde va el ícono y cuánto texto se corre: [izquierda del ícono, padding izquierdo del select]. */
const INSET = {
  none: [0, 10],
  flag: [8, 28],
  dot: [10, 25],
  avatar: [5, 32],
} as const;

/** Select nativo con aspecto de píldora: ícono a la izquierda, chevron a la derecha. */
export function SelectPill({
  label, value, onChange, leading, leadingInset = 'none', disabled, children,
}: {
  /** Nombre accesible del select (los tests y los lectores lo usan). */
  label: string;
  value: string;
  onChange: (value: string) => void;
  leading?: React.ReactNode;
  leadingInset?: keyof typeof INSET;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const [left, padding] = INSET[leading ? leadingInset : 'none'];
  return (
    <span className="relative inline-flex h-[30px] max-w-full items-center">
      {leading && (
        <span aria-hidden="true" className="pointer-events-none absolute flex items-center" style={{ left }}>{leading}</span>
      )}
      <select
        aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
        style={{ paddingLeft: padding }}
        className="h-full max-w-full cursor-pointer appearance-none truncate rounded-pill border border-line bg-surface pr-7 text-[13.5px] font-semibold text-fg transition-[background-color,border-color,box-shadow] duration-120 hover:bg-hover focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--selected)] focus-visible:outline-none disabled:cursor-default disabled:opacity-55"
      >
        {children}
      </select>
      <ChevronDown size={12} strokeWidth={2.4} aria-hidden="true" className="pointer-events-none absolute right-2.5 text-muted" />
    </span>
  );
}
```

- [ ] **Step 2: `src/components/priority-select.tsx`**

Se conserva: `aria-label="Prioridad"`, valores 0/1/3/5, `onChange(number)`. Cambia: píldora con bandera rellena del color de prioridad («Alta» se nombra: la prioridad no depende solo del color); «Sin prioridad» pasa a «Ninguna» como en el menú del diseño.

```tsx
'use client';

import { Flag } from 'lucide-react';
import { SelectPill } from './select-pill';

const OPTIONS = [
  { value: 0, label: 'Ninguna', color: 'var(--p-none)' },
  { value: 1, label: 'Baja', color: 'var(--p-low)' },
  { value: 3, label: 'Media', color: 'var(--p-med)' },
  { value: 5, label: 'Alta', color: 'var(--p-high)' },
];

export function PrioritySelect({ value, onChange }: { value: number; onChange: (p: number) => void }) {
  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];
  return (
    <SelectPill
      label="Prioridad" value={String(value)} onChange={(v) => onChange(Number(v))} leadingInset="flag"
      leading={<Flag size={13} strokeWidth={2} color={current.color} fill={current.value ? current.color : 'none'} />}
    >
      {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </SelectPill>
  );
}
```

- [ ] **Step 3: `src/components/subtask-list.tsx` (reestilado en el lugar)**

Se conserva todo el comportamiento (`run` con `onFail`, revertir título/estado si falla, devolver el texto nuevo si falla, labels `Completar subtarea "…"`, `Editar subtarea N`, `Borrar subtarea "…"`, `Nueva subtarea`). Cambia: rótulo 12/700/+6 % con «1/3» y barra de 4 px (`--hover` / `--accent`, transición de ancho 250 ms), filas de 38 px radio 7 con hover, checkbox redondo de 16 px (vacío: borde 1,5 px `--p-none`; hecho: relleno `--muted` con tilde `--surface`), «+ Agregar subtarea».

```tsx
'use client';

import { Check, Plus, X } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import type { Subtask, TaskWithDetails } from '@/core/tasks';
import type { ActionResult } from '@/lib/action-result';
import { addSubtaskAction, deleteSubtaskAction, updateSubtaskAction } from '@/app/app/actions';
import { sectionLabel } from './ui';

type Run = (fn: () => Promise<ActionResult<unknown>>, onFail?: () => void) => void;

function SubtaskRow({ subtask, index, run }: { subtask: Subtask; index: number; run: Run }) {
  const [title, setTitle] = useState(subtask.title);
  const [done, setDone] = useState(subtask.done);
  useEffect(() => setTitle(subtask.title), [subtask.title]);
  useEffect(() => setDone(subtask.done), [subtask.done]);

  function saveTitle() {
    const clean = title.trim();
    if (!clean) { setTitle(subtask.title); return; }
    setTitle(clean);
    if (clean !== subtask.title) run(() => updateSubtaskAction(subtask.id, { title: clean }), () => setTitle(subtask.title));
  }

  return (
    <li className="group flex min-h-[38px] items-center gap-3 rounded-pill px-1 transition-colors duration-120 focus-within:bg-hover hover:bg-hover">
      <span className="relative flex h-4 w-4 shrink-0">
        <input
          type="checkbox" checked={done} aria-label={`Completar subtarea "${subtask.title}"`}
          onChange={(e) => {
            const next = e.target.checked;
            setDone(next);
            run(() => updateSubtaskAction(subtask.id, { done: next }), () => setDone(subtask.done));
          }}
          className="peer h-4 w-4 cursor-pointer appearance-none rounded-full border-[1.5px] border-p-none transition-colors duration-200 checked:border-muted checked:bg-muted"
        />
        <Check
          size={10} strokeWidth={3.5} aria-hidden="true"
          className="pointer-events-none absolute left-[3px] top-[3px] hidden text-surface peer-checked:block"
        />
      </span>
      <input
        value={title} onChange={(e) => setTitle(e.target.value)} aria-label={`Editar subtarea ${index + 1}`}
        onBlur={saveTitle} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className={`min-w-0 flex-1 bg-transparent text-body-sm outline-none focus-visible:outline-none ${done ? 'text-muted line-through' : 'text-fg'}`}
      />
      <button
        type="button" onClick={() => run(() => deleteSubtaskAction(subtask.id))} aria-label={`Borrar subtarea "${subtask.title}"`}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-chip text-muted hover:text-fg md:opacity-0 md:focus-visible:opacity-100 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </li>
  );
}

export function SubtaskList({ task, onError }: { task: TaskWithDetails; onError: (e: string | null) => void }) {
  const [newTitle, setNewTitle] = useState('');
  const [, startTransition] = useTransition();
  const run: Run = (fn, onFail) =>
    startTransition(async () => {
      const result = await fn();
      onError(result.ok ? null : result.error);
      if (!result.ok) onFail?.();
    });
  const total = task.subtasks.length;
  const doneCount = task.subtasks.filter((s) => s.done).length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <h3 className={sectionLabel}>Subtareas</h3>
        {total > 0 && (
          <>
            <span className="text-meta font-semibold tabular-nums text-muted">{doneCount}/{total}</span>
            <span
              role="progressbar" aria-label="Subtareas completadas" aria-valuemin={0} aria-valuemax={total} aria-valuenow={doneCount}
              className="h-1 flex-1 overflow-hidden rounded-sm bg-hover"
            >
              <span className="block h-full rounded-sm bg-accent transition-[width] duration-250" style={{ width: `${(doneCount / total) * 100}%` }} />
            </span>
          </>
        )}
      </div>
      <div className="flex flex-col">
        <ul className="flex flex-col">
          {task.subtasks.map((s, i) => <SubtaskRow key={s.id} subtask={s} index={i} run={run} />)}
        </ul>
        <form
          className="flex min-h-[38px] items-center gap-3 rounded-pill px-1 text-muted transition-colors duration-120 focus-within:bg-hover"
          onSubmit={(e) => {
            e.preventDefault();
            const title = newTitle.trim();
            if (!title) return;
            setNewTitle('');
            // Si falla, se devuelve el texto salvo que el usuario ya haya empezado a escribir otra cosa.
            run(() => addSubtaskAction(task.id, title), () => setNewTitle((current) => current || title));
          }}
        >
          <Plus size={16} aria-hidden="true" className="shrink-0" />
          <input
            value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Agregar subtarea"
            aria-label="Nueva subtarea"
            className="min-w-0 flex-1 bg-transparent text-body-sm text-fg outline-none placeholder:text-muted focus-visible:outline-none"
          />
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `src/components/tag-editor.tsx` (reestilado en el lugar)**

Se conserva todo (lista optimista sobre la local, `onFail` revierte, normalización con mensaje de error y borrador conservado, Enter/blur agregan, `Quitar etiqueta X`, `Agregar etiqueta`, `aria-invalid`). Cambia: chips de 26 px radio 6 `--hover` 12,5/600 con × de 11 px, campo «+ Etiqueta» con borde punteado, y la línea «De otros miembros» (antes en el detalle) con chips de borde.

```tsx
'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { normalizeTagName } from '@/core/tag-name';
import { sectionLabel } from './ui';

/**
 * Lista optimista: los cambios se arman siempre sobre la lista local (no sobre la prop),
 * así que agregar o quitar varias etiquetas seguidas no pisa los cambios anteriores.
 * `onFail` revierte la lista local al valor del servidor si el guardado falla.
 */
export function TagEditor({
  tags, otherTags, onChange,
}: { tags: string[]; otherTags: string[]; onChange: (tags: string[], onFail: () => void) => void }) {
  const [local, setLocal] = useState(tags);
  const current = useRef(tags);
  const serverTags = useRef(tags);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    serverTags.current = tags;
    current.current = tags;
    setLocal(tags);
  }, [tags]);

  function commit(next: string[]) {
    current.current = next;
    setLocal(next);
    onChange(next, () => {
      current.current = serverTags.current;
      setLocal(serverTags.current);
    });
  }

  function add() {
    if (!draft.trim()) { setError(null); setDraft(''); return; }
    let names: string[];
    try {
      names = draft.split(/[\s,]+/).filter(Boolean).map(normalizeTagName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Etiqueta inválida');
      return; // se conserva el borrador para corregirlo
    }
    setError(null);
    setDraft('');
    const next = [...new Set([...current.current, ...names])];
    if (next.length !== current.current.length) commit(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className={sectionLabel}>Etiquetas</h3>
      <div className="flex flex-wrap items-center gap-1.5">
        {local.map((t) => (
          <span key={t} className="inline-flex h-[26px] items-center gap-1 rounded-tag bg-hover pl-[9px] pr-1.5 text-caption font-semibold">
            #{t}
            <button
              type="button" onClick={() => commit(current.current.filter((x) => x !== t))} aria-label={`Quitar etiqueta ${t}`}
              className="flex h-4 w-4 items-center justify-center rounded-sm text-muted hover:text-fg"
            >
              <X size={11} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          value={draft} onChange={(e) => { setDraft(e.target.value); setError(null); }}
          placeholder="+ Etiqueta" aria-label="Agregar etiqueta" aria-invalid={error !== null}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} onBlur={add}
          className="h-[26px] w-[104px] rounded-tag border border-dashed border-line bg-transparent px-[9px] text-caption text-fg outline-none transition-[border-color,width] duration-120 placeholder:text-muted focus:w-40 focus:border-solid focus:border-accent focus-visible:outline-none aria-[invalid=true]:border-danger"
        />
      </div>
      {otherTags.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-meta text-muted">
          De otros miembros:
          {otherTags.map((t) => <span key={t} className="rounded-chip border border-line px-[7px] py-px">#{t}</span>)}
        </p>
      )}
      {error && <p role="alert" className="text-meta font-medium text-danger">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 5: `src/components/task-detail.tsx` (reestilado en el lugar)**

Se conserva **toda** la lógica actual: estados locales sincronizados con `useEffect`, `run`/`save` con `onFail`, `commitDate`/`commitTime` (valor completo, `badInput`, vacío borra, revertir al salir), `saveTitle`, `move` (cierra si la tarea se va de la lista que se está mirando), `assign` (cierra en «Asignadas a mí» si deja de ser mía), hora solo con fecha, «Asignada a» solo con miembros, labels `Título`, `Descripción`, `Fecha`, `Hora`, `Prioridad`, `Lista`, `Asignada a`, `Cerrar detalle`, papelera de solo lectura con «Restaurar». Cambia: diseño; «Mandar a la papelera» va al pie y **no confirma** (toast con deshacer, vía `trash` del espacio de trabajo); Esc cierra; atajo E enfoca el título; pie «Guardando…» / «Modificada hace …».

```tsx
'use client';

import { ArrowLeft, Calendar, Clock, Flag, List as ListIcon, RotateCcw, Trash2, User, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { isValidIsoDate, isValidTime } from '@/core/dates';
import type { List } from '@/core/lists';
import type { ListMember } from '@/core/members';
import type { TaskWithDetails, UpdateTaskInput } from '@/core/tasks';
import type { ActionResult } from '@/lib/action-result';
import { formatAgo, formatDetailDate, trashNote } from '@/lib/format';
import { moveTaskAction, restoreTaskAction, toggleTaskAction, updateTaskAction } from '@/app/app/actions';
import { Avatar } from './avatar';
import { PriorityCheckbox } from './priority-checkbox';
import { PrioritySelect } from './priority-select';
import { SelectPill } from './select-pill';
import { SubtaskList } from './subtask-list';
import { TagEditor } from './tag-editor';
import { btn } from './ui';
import { useWorkspace } from './workspace-context';

const PILL = 'relative inline-flex h-[30px] items-center gap-[5px] rounded-pill border border-line px-2.5 text-[13.5px] font-semibold tabular-nums transition-[background-color,border-color,box-shadow] duration-120 hover:bg-hover has-[:focus-visible]:border-accent has-[:focus-visible]:shadow-[0_0_0_3px_var(--selected)]';
/** Input nativo transparente encima de la píldora: conserva el selector del sistema y el teclado. */
const OVERLAY = 'absolute inset-0 h-full w-full cursor-pointer opacity-0';
const PROP_LABEL = 'flex h-9 items-center gap-2 text-muted';

function openPicker(e: React.MouseEvent<HTMLInputElement>) {
  try {
    e.currentTarget.showPicker();
  } catch {
    // Ya abierto o navegador sin showPicker: queda el comportamiento nativo.
  }
}

export function TaskDetail({
  task, lists, members, currentUserId, today, now, timezone,
}: {
  task: TaskWithDetails; lists: List[]; members: ListMember[]; currentUserId: string;
  today: string; now: string; timezone: string;
}) {
  const inTrash = task.deletedAt !== null;
  const pathname = usePathname();
  const { closeDetail, trash, hide, consumeEditTitle } = useWorkspace();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [date, setDate] = useState(task.dueDate ?? '');
  const [time, setTime] = useState(task.dueTime ?? '');
  const [priority, setPriority] = useState(task.priority);
  const [listId, setListId] = useState(task.listId);
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setDate(task.dueDate ?? ''), [task.dueDate]);
  useEffect(() => setTime(task.dueTime ?? ''), [task.dueTime]);
  useEffect(() => setPriority(task.priority), [task.priority]);
  useEffect(() => setListId(task.listId), [task.listId]);
  useEffect(() => setAssigneeId(task.assigneeId ?? ''), [task.assigneeId]);

  // Atajo E desde la fila: el detalle abre con el título listo para editar.
  useEffect(() => {
    if (!consumeEditTitle()) return;
    const el = titleRef.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [consumeEditTitle]);

  // Esc cierra el detalle (guardando antes el campo que se estaba editando) y devuelve el foco a la fila.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && rootRef.current?.contains(active) && active.matches('input, textarea, select')) {
        active.blur();
      }
      closeDetail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeDetail]);

  const run = (fn: () => Promise<ActionResult<unknown>>, after?: () => void, onFail?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      setError(result.ok ? null : result.error);
      if (result.ok) after?.();
      else onFail?.();
    });
  const save = (input: UpdateTaskInput, onFail?: () => void) => run(() => updateTaskAction(task.id, input), undefined, onFail);

  // Fecha y hora: se guarda solo con un valor completo (los inputs nativos emiten fechas intermedias
  // mientras se tipea el año) o al salir del campo; vacío borra el valor. Un campo a medio escribir
  // (validity.badInput) no se interpreta como "vacío".
  function commitDate(input: HTMLInputElement, onBlur: boolean) {
    const value = input.value;
    if (value === '') {
      if (input.validity.badInput) { if (onBlur) setDate(task.dueDate ?? ''); return; }
      if (task.dueDate !== null) save({ dueDate: null }, () => setDate(task.dueDate ?? ''));
    } else if (isValidIsoDate(value)) {
      if (value !== task.dueDate) save({ dueDate: value }, () => setDate(task.dueDate ?? ''));
    } else if (onBlur) {
      setDate(task.dueDate ?? '');
    }
  }
  function commitTime(input: HTMLInputElement, onBlur: boolean) {
    const value = input.value;
    if (value === '') {
      if (input.validity.badInput) { if (onBlur) setTime(task.dueTime ?? ''); return; }
      if (task.dueTime !== null) save({ dueTime: null }, () => setTime(task.dueTime ?? ''));
    } else if (isValidTime(value)) {
      if (value !== task.dueTime) save({ dueTime: value }, () => setTime(task.dueTime ?? ''));
    } else if (onBlur) {
      setTime(task.dueTime ?? '');
    }
  }
  function saveTitle() {
    // El título se edita en un textarea (para que pueda ocupar varias líneas), pero no lleva saltos de línea.
    const clean = title.replace(/\s*\n\s*/g, ' ').trim();
    if (!clean) { setTitle(task.title); return; }
    setTitle(clean);
    if (clean !== task.title) save({ title: clean });
  }
  function move(newListId: string) {
    setListId(newListId);
    run(
      () => moveTaskAction(task.id, newListId),
      // Si la vista actual es una lista y la tarea se fue a otra, el detalle ya no corresponde.
      () => { if (pathname.startsWith('/app/list/') && !pathname.includes(newListId)) closeDetail(); },
      () => setListId(task.listId),
    );
  }

  function assign(next: string) {
    setAssigneeId(next);
    run(
      () => updateTaskAction(task.id, { assigneeId: next || null }),
      // En "Asignadas a mí", una tarea reasignada a otra persona (o sin asignar) deja de pertenecer a la vista.
      () => { if (pathname.startsWith('/app/assigned') && next !== currentUserId) closeDetail(); },
      () => setAssigneeId(task.assigneeId ?? ''),
    );
  }

  const currentList = lists.find((l) => l.id === listId);
  const header = (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line pl-2.5 pr-3">
      <button type="button" onClick={closeDetail} aria-label="Cerrar detalle" className={`${btn.icon} h-9 w-9`}>
        <ArrowLeft size={20} aria-hidden="true" className="text-fg lg:hidden" />
        <X size={18} aria-hidden="true" className="hidden lg:block" />
      </button>
      {currentList && (
        <span className="inline-flex min-w-0 items-center gap-[5px] text-meta text-muted">
          <span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: currentList.color ?? 'var(--muted)' }} />
          <span className="truncate">{currentList.name}</span>
        </span>
      )}
      <span className="flex-1" />
    </div>
  );
  const errorBox = error && (
    <p role="alert" className="rounded-input bg-danger-bg px-3 py-2.5 text-[13px] font-semibold text-danger">{error}</p>
  );

  if (inTrash) {
    return (
      <div ref={rootRef} className="flex h-full flex-col">
        {header}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-[22px]">
          <h2 className="text-title text-muted">{task.title}</h2>
          <p className="text-body-sm text-muted">
            Esta tarea está en la papelera. {trashNote(task.deletedAt!, new Date(now))}.
          </p>
          <button
            type="button" onClick={() => run(() => restoreTaskAction(task.id), () => { hide(task.id); closeDetail(); })}
            className={`${btn.primary} h-10 self-start px-4 text-[13.5px]`}
          >
            <RotateCcw size={15} aria-hidden="true" />
            Restaurar
          </button>
          {errorBox}
        </div>
      </div>
    );
  }

  const done = task.status === 'completed';
  const shownDate = isValidIsoDate(date) ? date : task.dueDate;
  const dateTone = !shownDate ? 'font-medium text-muted'
    : shownDate < today && !done ? 'text-danger'
    : shownDate === today ? 'text-accent'
    : 'text-fg';
  const shownTime = isValidTime(time) ? time : task.dueTime;
  const assignee = members.find((m) => m.id === assigneeId) ?? (task.assignee?.id === assigneeId ? task.assignee : null);

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      {header}

      <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto px-[22px] pb-6 pt-[22px]">
        <div className="flex items-start gap-3.5">
          <PriorityCheckbox
            size="lg" checked={done} priority={priority} onChange={() => run(() => toggleTaskAction(task.id, !done))}
            label={done ? 'Marcar esta tarea como pendiente' : 'Completar esta tarea'}
          />
          <textarea
            ref={titleRef} rows={1} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Título"
            onBlur={saveTitle}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
            className={`min-w-0 flex-1 resize-none bg-transparent text-title outline-none [field-sizing:content] focus-visible:outline-none ${done ? 'text-muted line-through' : ''}`}
          />
        </div>

        <dl className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-y-1 text-body-sm">
          <dt className={PROP_LABEL}><Calendar size={15} aria-hidden="true" />Fecha</dt>
          <dd className="flex min-h-9 flex-wrap items-center gap-1.5">
            <label className={`${PILL} ${dateTone}`}>
              <span aria-hidden="true">{shownDate ? formatDetailDate(shownDate, today) : 'Sin fecha'}</span>
              <input
                type="date" value={date} aria-label="Fecha" className={OVERLAY} onClick={openPicker}
                onChange={(e) => { setDate(e.target.value); commitDate(e.target, false); }}
                onBlur={(e) => commitDate(e.target, true)}
              />
            </label>
            {task.dueDate && (
              <label className={`${PILL} text-fg`}>
                <Clock size={13} strokeWidth={2.2} aria-hidden="true" className="text-muted" />
                <span aria-hidden="true" className={shownTime ? '' : 'font-medium text-muted'}>{shownTime ?? 'Agregar hora'}</span>
                <input
                  type="time" value={time} aria-label="Hora" className={OVERLAY} onClick={openPicker}
                  onChange={(e) => { setTime(e.target.value); commitTime(e.target, false); }}
                  onBlur={(e) => commitTime(e.target, true)}
                />
              </label>
            )}
          </dd>

          <dt className={PROP_LABEL}><Flag size={15} aria-hidden="true" />Prioridad</dt>
          <dd className="flex min-h-9 items-center">
            <PrioritySelect
              value={priority}
              onChange={(p) => { setPriority(p); save({ priority: p }, () => setPriority(task.priority)); }}
            />
          </dd>

          <dt className={PROP_LABEL}><ListIcon size={15} aria-hidden="true" />Lista</dt>
          <dd className="flex min-h-9 min-w-0 items-center">
            <SelectPill
              label="Lista" value={listId} onChange={move} leadingInset="dot"
              leading={<span className="h-2 w-2 rounded-full" style={{ backgroundColor: currentList?.color ?? 'var(--muted)' }} />}
            >
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </SelectPill>
          </dd>

          {members.length > 0 && (
            <>
              <dt className={PROP_LABEL}><User size={15} aria-hidden="true" />Asignada a</dt>
              <dd className="flex min-h-9 min-w-0 items-center">
                <SelectPill
                  label="Asignada a" value={assigneeId} onChange={assign}
                  leadingInset={assignee ? 'avatar' : 'flag'}
                  leading={assignee ? <Avatar person={assignee} size={20} /> : <User size={13} className="text-muted" />}
                >
                  <option value="">Sin asignar</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
                </SelectPill>
              </dd>
            </>
          )}
        </dl>

        <textarea
          value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Descripción"
          onBlur={() => description !== task.description && save({ description })}
          placeholder="Agregar una descripción…" rows={2}
          className="min-h-[3.2em] w-full resize-none bg-transparent text-body leading-[1.6] text-fg outline-none [field-sizing:content] placeholder:text-muted focus-visible:outline-none"
        />

        <SubtaskList task={task} onError={setError} />

        <TagEditor tags={task.tags} otherTags={task.otherTags} onChange={(tags, onFail) => save({ tags }, onFail)} />

        {errorBox}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-4 py-3">
        <span className="text-meta text-muted" aria-live="polite">
          {saving ? 'Guardando…' : `Modificada ${formatAgo(task.updatedAt, new Date(now), timezone)}`}
        </span>
        <button type="button" onClick={() => trash(task)} className={`${btn.ghostDanger} h-[34px] px-3 text-[13px]`}>
          <Trash2 size={14} aria-hidden="true" />
          Mandar a la papelera
        </button>
      </div>
    </div>
  );
}
```

> El label «Asignada a» del e2e apunta al `aria-label` del select (el `<dt>` no es un `<label>`), y las opciones siguen mostrando el email cuando la persona no tiene nombre: `selectOption({ label: email })` sigue funcionando.

- [ ] **Step 6: Pasar los datos nuevos desde `src/components/task-workspace.tsx`**

Reemplazar la línea del detalle por:

```tsx
            <TaskDetail
              key={selected.id} task={selected} lists={lists} members={members} currentUserId={currentUserId}
              today={today} now={now} timezone={timezone}
            />
```

- [ ] **Step 7: Tipos y lint**

Run: `npx tsc --noEmit` y `npm run lint` → sin errores.

- [ ] **Step 8: Chequeo visual y de comportamiento**

Abrir «Revisar presupuesto Q4» (con fecha hoy 15:00, prioridad alta, lista compartida «Trabajo», asignada, 3 subtareas con 1 hecha, `#urgente` y una etiqueta de otro miembro) a 1200 px y comparar con pantalla 02 / `NotasDetalle`:
- Encabezado 56 px con borde inferior: X 36 px, punto 7 px + «Trabajo» 12 `--muted`.
- Cuerpo con padding 22 y gap 22: checkbox 22 px de borde rojo + título 20/700 que envuelve en varias líneas.
- Grilla 110 px: rótulos 13,5 `--muted` con íconos 15; píldoras de 30 px radio 7: «Hoy, 10 oct» en petróleo, reloj + «15:00», bandera roja rellena + «Alta» + chevron, punto + «Trabajo», avatar 20 + «Martín».
- Descripción 14/1,6. Subtareas: «SUBTAREAS 1/3» + barra de 4 px al 33 %; filas de 38 px; la hecha con círculo gris relleno y texto tachado; «+ Agregar subtarea».
- Etiquetas: chip `#urgente ×`, «+ Etiqueta» punteado, «De otros miembros: #q4».
- Pie 12/16 px con borde: «Modificada hace …» y «Mandar a la papelera» en rojo con hover `--danger-bg`.
- Comportamiento: clic en la fecha abre el selector nativo; cambiar fecha/hora/prioridad/lista/asignada guarda (el pie muestra «Guardando…» y después «Modificada hace un momento»); Esc con el foco en el título lo guarda y cierra el detalle devolviendo el foco a la fila; desde una fila, E abre el detalle con el título enfocado; «Mandar a la papelera» cierra el detalle, la fila sale y aparece el toast con «Deshacer».
- Papelera: abrir una tarea borrada → título en `--muted`, «Esta tarea está en la papelera. Borrada hace … · se elimina en ….», «Restaurar» primario.
- 1024–1199 px: el detalle sigue a la derecha (400 px). <1024 px y 390 px: pantalla completa con ← (20 px, `--fg`) y entrada desde la derecha, como «Celular Detalle».

Capturas `t7-detalle-1200-{claro,oscuro}.png`, `t7-detalle-390-{claro,oscuro}.png`, `t7-detalle-papelera-1200-claro.png`.

- [ ] **Step 9: Commit**

```bash
git add src/components/select-pill.tsx src/components/priority-select.tsx src/components/task-detail.tsx src/components/subtask-list.tsx src/components/tag-editor.tsx src/components/task-workspace.tsx
git commit -m "feat(ui): detalle de tarea del rediseño con propiedades en píldoras y papelera con deshacer"
```

---

### Task 8: Diálogo de lista (dueño, miembro y nueva) y miembros

Diseño de referencia: «08 · Diálogo de lista (dueño / miembro)»: 480 px, radio 16, `shadow-lg`; encabezado `18px 20px 0` con título 18/800 y X de 32; cuerpo `18px 20px` con gap 18; campo «Nombre» 42 px fondo `--bg` (foco con borde petróleo + anillo 3 px); 9 colores de 26 px con gap 10 y el elegido con anillo `0 0 0 2px --surface, 0 0 0 4px --fg`; «Carpeta» select 42 px con chevron; sección «Miembros» con borde superior, contador, «Agregar por email» + «Invitar» (40 px), filas de 44 px con avatar 26, «Nombre · email» 13,5 y «DUEÑO» 11,5/700/+5 % o «Quitar» 13/600 `--muted`; pie `14px 20px` con borde superior y fondo `--bg`: «Borrar lista» (peligro fantasma) a la izquierda, «Cancelar» (secundario) y «Guardar» (primario 40 px) a la derecha. Miembro: título con punto de color, aviso con ícono de personas en caja `--bg` radio 10, «Emir · vos», pie solo con «Salir de la lista» (secundario con texto rojo). Nota «Borrar y deshacer»: borrar lista confirma con diálogo chico con botón de peligro.

**Files:**
- Rewrite: `src/components/list-dialog.tsx`, `src/components/list-members.tsx`
- Modify: `src/components/sidebar.tsx`, `src/components/task-workspace.tsx`

> E2E afectados (se ajustan en la Task 14): «Agregar» pasa a «Invitar» y «Salir de la lista» ahora pide confirmación en un `alertdialog`.

- [ ] **Step 1: `src/components/list-members.tsx` (reestilado en el lugar)**

Se conserva: carga con `requestId` (descarta respuestas viejas e invalida al desmontar o cambiar de lista), validación de email vacío, recarga después de agregar/quitar, deshabilitar mientras carga, `aria-label` `Email del nuevo miembro` y `Quitar a {email}`, errores de carga y de acción con `role="alert"`. Cambia: diseño, «Invitar», «vos» para el usuario actual cuando no es dueño, confirmación propia para quitar.

```tsx
'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import type { ListMember } from '@/core/members';
import { addListMemberAction, getListMembersAction, removeListMemberAction } from '@/app/app/actions';
import { Avatar } from './avatar';
import { ConfirmDialog } from './confirm-dialog';
import { btn, field } from './ui';

/** Sección "Miembros" del diálogo de lista. El dueño invita por email y quita; un miembro solo ve. */
export function ListMembers({
  listId, isOwner, currentUserId,
}: { listId: string; isOwner: boolean; currentUserId: string }) {
  const headingId = useId();
  const [members, setMembers] = useState<ListMember[] | null>(null);
  const [email, setEmail] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<ListMember | null>(null);
  const [pending, startTransition] = useTransition();
  // Cada carga lleva un número; solo la última puede escribir el estado (descarta respuestas viejas).
  const requestId = useRef(0);

  async function load() {
    const id = ++requestId.current;
    const result = await getListMembersAction(listId);
    if (id !== requestId.current) return;
    if (result.ok) {
      setMembers(result.data);
      setLoadError(null);
    } else {
      setLoadError(result.error);
    }
  }

  useEffect(() => {
    setMembers(null);
    setLoadError(null);
    void load();
    // Invalida cualquier carga en vuelo al desmontar o cambiar de lista.
    const counter = requestId;
    return () => { counter.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId]);

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return setActionError('Ingresá el email de la persona');
    setActionError(null);
    startTransition(async () => {
      const result = await addListMemberAction(listId, email);
      if (!result.ok) return setActionError(result.error);
      setEmail('');
      await load();
    });
  }

  function remove() {
    const member = toRemove;
    if (!member) return;
    setActionError(null);
    startTransition(async () => {
      const result = await removeListMemberAction(listId, member.id);
      setToRemove(null);
      if (!result.ok) return setActionError(result.error);
      await load();
    });
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <h3 id={headingId} className="text-[13px] font-semibold">Miembros</h3>
        {members && <span className="text-meta tabular-nums text-muted">{members.length}</span>}
      </div>
      {isOwner && (
        <form onSubmit={add} className="flex gap-2">
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
            placeholder="Agregar por email" aria-label="Email del nuevo miembro" aria-invalid={actionError !== null}
            className={`${field} h-10 min-w-0 flex-1 bg-bg`}
          />
          <button type="submit" disabled={pending || members === null} className={`${btn.secondary} h-10 px-3.5 text-[13px]`}>
            Invitar
          </button>
        </form>
      )}
      {actionError && <p role="alert" className="text-meta font-medium text-danger">{actionError}</p>}
      {members === null && !loadError && (
        <div aria-busy="true" aria-label="Cargando miembros" className="flex flex-col">
          {[0, 1].map((i) => (
            <div key={i} className="flex h-11 items-center gap-2.5">
              <span className="h-[26px] w-[26px] animate-skeleton rounded-full bg-skeleton" />
              <span className="h-3 w-40 animate-skeleton rounded-chip bg-skeleton" />
            </div>
          ))}
        </div>
      )}
      {loadError && <p role="alert" className="text-[13px] text-danger">{loadError}</p>}
      {members && (
        <ul className="flex flex-col">
          {members.map((m) => {
            const isMe = m.id === currentUserId;
            return (
              <li key={m.id} className="flex h-11 items-center gap-2.5">
                <Avatar person={m} size={26} />
                <span className="min-w-0 flex-1 truncate text-body-sm">
                  {m.name || m.email}
                  {!isOwner && isMe
                    ? <span className="text-muted"> · vos</span>
                    : m.name && <span className="text-muted"> · {m.email}</span>}
                </span>
                {m.role === 'owner' ? (
                  <span className="text-overline uppercase tracking-[.05em] text-muted">Dueño</span>
                ) : isOwner && (
                  <button
                    type="button" onClick={() => setToRemove(m)} disabled={pending} aria-label={`Quitar a ${m.email}`}
                    className="rounded-nav px-2 py-1.5 text-[13px] font-semibold text-muted transition-colors duration-120 hover:bg-danger-bg hover:text-danger disabled:opacity-50"
                  >
                    Quitar
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {toRemove && (
        <ConfirmDialog
          title={`¿Quitar a ${toRemove.name || toRemove.email}?`}
          body="Deja de ver la lista y sus tareas asignadas quedan sin asignar."
          confirmLabel="Quitar" pending={pending} onCancel={() => setToRemove(null)} onConfirm={remove}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 2: `src/components/list-dialog.tsx` (reestilado en el lugar)**

Se conserva: crear/editar con nombre, color y carpeta (con «+ Nueva carpeta…» y reintento que reutiliza la carpeta creada), validaciones de nombre vacío, navegar a la lista nueva, después de borrar/salir ir a la Bandeja si se la estaba mirando, `aria-label="Nombre de la lista"`, radios de color, miembros fuera del `<form>` (no se pueden anidar formularios). Cambia: diseño; paleta de 9 colores del diseño con nombres accesibles; «Guardar» en el pie (asociado al formulario con `form=`); confirmaciones propias para borrar y salir.

```tsx
'use client';

import { ChevronDown, Users } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import type { Folder, ListOwner, ListWithRole } from '@/core/lists';
import {
  createFolderAction, createListAction, deleteListAction, leaveListAction, updateListAction,
} from '@/app/app/actions';
import { ConfirmDialog } from './confirm-dialog';
import { ListMembers } from './list-members';
import { Modal } from './modal';
import { btn, field } from './ui';

/** Los 9 colores de lista del diseño (fijos en los dos temas). */
export const LIST_COLORS = [
  { value: '#15697B', name: 'Petróleo' },
  { value: '#2F6FD6', name: 'Azul' },
  { value: '#12A594', name: 'Turquesa' },
  { value: '#2F8F5B', name: 'Verde' },
  { value: '#D08A1A', name: 'Ámbar' },
  { value: '#E0641C', name: 'Naranja' },
  { value: '#C23B30', name: 'Rojo' },
  { value: '#C2559A', name: 'Rosa' },
  { value: '#7A5AD6', name: 'Violeta' },
];
const NEW_FOLDER = '__new';

const LABEL = 'flex flex-col gap-1.5 text-[13px] font-semibold';

function ColorDot({ color }: { color: string | null }) {
  return <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: color ?? 'var(--muted)' }} />;
}

export function ListDialog({
  list, folders, owner, currentUserId, onClose,
}: {
  list?: ListWithRole; folders: Folder[];
  /** Dueño de la lista (para el aviso que ve un miembro). */
  owner?: ListOwner;
  currentUserId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const formId = useId();
  const colorLabelId = useId();
  const [name, setName] = useState(list?.name ?? '');
  const [color, setColor] = useState<string | null>(list ? list.color : LIST_COLORS[0].value);
  const [folderId, setFolderId] = useState(list?.folderId ?? '');
  const [newFolder, setNewFolder] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'delete' | 'leave' | null>(null);
  const [pending, startTransition] = useTransition();

  /** Tras borrar la lista o salir de ella: si se la estaba mirando, a la Bandeja. */
  function afterLosingList(listId: string) {
    onClose();
    if (pathname === `/app/list/${listId}`) router.push('/app/inbox');
    else router.refresh();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('El nombre de la lista no puede estar vacío');
    if (folderId === NEW_FOLDER && !newFolder.trim()) return setError('El nombre de la carpeta no puede estar vacío');
    setError(null);
    startTransition(async () => {
      let targetFolder: string | null = folderId || null;
      if (folderId === NEW_FOLDER) {
        const created = await createFolderAction(newFolder);
        if (!created.ok) return setError(created.error);
        targetFolder = created.data.id;
        // Si el guardado de la lista falla, un reintento reutiliza la carpeta ya creada.
        setFolderId(created.data.id);
      }
      if (list) {
        const result = await updateListAction(list.id, { name, color, folderId: targetFolder });
        if (!result.ok) return setError(result.error);
        onClose();
      } else {
        const result = await createListAction({ name, color, folderId: targetFolder });
        if (!result.ok) return setError(result.error);
        onClose();
        router.push(`/app/list/${result.data.id}`);
      }
    });
  }

  function remove() {
    if (!list) return;
    startTransition(async () => {
      const result = await deleteListAction(list.id);
      if (!result.ok) {
        setConfirm(null);
        return setError(result.error);
      }
      afterLosingList(list.id);
    });
  }

  function leave() {
    if (!list) return;
    startTransition(async () => {
      const result = await leaveListAction(list.id);
      if (!result.ok) {
        setConfirm(null);
        return setError(result.error);
      }
      afterLosingList(list.id);
    });
  }

  const errorBox = error && <p role="alert" className="text-[13px] font-medium text-danger">{error}</p>;

  // Miembro: solo lectura, ver miembros y salir.
  if (list && list.role === 'member') {
    return (
      <Modal
        title={list.name} titleAdornment={<ColorDot color={list.color} />} onClose={onClose}
        footer={(
          <>
            <span className="flex-1" />
            <button
              type="button" onClick={() => setConfirm('leave')} disabled={pending}
              className="inline-flex h-10 items-center rounded-input border border-line bg-surface px-3.5 text-[13.5px] font-semibold text-danger transition-colors duration-120 hover:bg-danger-bg disabled:opacity-50"
            >
              Salir de la lista
            </button>
          </>
        )}
      >
        <div className="flex flex-col gap-4">
          <div className="flex gap-2.5 rounded-row border border-line bg-bg px-3.5 py-3 text-[13px] leading-normal text-muted">
            <Users size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
            <p className="text-pretty">
              {owner ? `${owner.name || owner.email} compartió esta lista con vos.` : 'Esta lista está compartida con vos.'}{' '}
              Solo quien la creó puede cambiarle el nombre, el color o borrarla.
            </p>
          </div>
          <ListMembers listId={list.id} isOwner={false} currentUserId={currentUserId} />
          {errorBox}
        </div>
        {confirm === 'leave' && (
          <ConfirmDialog
            title={`¿Salir de «${list.name}»?`} body="Vas a dejar de ver sus tareas. Para volver, te tienen que invitar de nuevo."
            confirmLabel="Salir de la lista" pending={pending} onCancel={() => setConfirm(null)} onConfirm={leave}
          />
        )}
      </Modal>
    );
  }

  return (
    <Modal
      title={list ? 'Editar lista' : 'Nueva lista'} onClose={onClose}
      footer={(
        <>
          {list && (
            <button
              type="button" onClick={() => setConfirm('delete')} disabled={pending}
              className={`${btn.ghostDanger} h-10 px-2.5 text-[13px]`}
            >
              Borrar lista
            </button>
          )}
          <span className="flex-1" />
          <button type="button" onClick={onClose} className={`${btn.secondary} h-10 px-3.5 text-[13.5px]`}>Cancelar</button>
          <button type="submit" form={formId} disabled={pending} className={`${btn.primary} h-10 px-[18px] text-[13.5px]`}>
            Guardar
          </button>
        </>
      )}
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-[18px]">
        <label className={LABEL}>
          Nombre
          <input
            autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Por ejemplo, Casa"
            aria-label="Nombre de la lista" className={`${field} h-[42px] bg-bg font-normal`}
          />
        </label>
        <div className="flex flex-col gap-2">
          <span id={colorLabelId} className="text-[13px] font-semibold">Color</span>
          <div role="radiogroup" aria-labelledby={colorLabelId} className="flex flex-wrap gap-2.5">
            {LIST_COLORS.map(({ value, name: colorName }) => {
              const checked = color?.toLowerCase() === value.toLowerCase();
              return (
                <button
                  key={value} type="button" role="radio" aria-checked={checked} aria-label={colorName}
                  onClick={() => setColor(value)} style={{ backgroundColor: value }}
                  className={`h-[26px] w-[26px] rounded-full transition-shadow duration-120 ${checked ? 'shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--fg)]' : 'hover:shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--border)]'}`}
                />
              );
            })}
          </div>
        </div>
        <label className={LABEL}>
          Carpeta
          <span className="relative flex items-center">
            <select
              value={folderId} onChange={(e) => setFolderId(e.target.value)} aria-label="Carpeta"
              className={`${field} h-[42px] cursor-pointer appearance-none bg-bg pr-9 font-normal ${folderId ? '' : 'text-muted'}`}
            >
              <option value="" className="text-fg">Sin carpeta</option>
              {folders.map((f) => <option key={f.id} value={f.id} className="text-fg">{f.name}</option>)}
              <option value={NEW_FOLDER} className="text-fg">+ Nueva carpeta…</option>
            </select>
            <ChevronDown size={14} strokeWidth={2.4} aria-hidden="true" className="pointer-events-none absolute right-2.5 text-muted" />
          </span>
        </label>
        {folderId === NEW_FOLDER && (
          <input
            value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="Nombre de la carpeta"
            aria-label="Nombre de la carpeta" className={`${field} h-[42px] bg-bg`}
          />
        )}
        {errorBox}
      </form>
      {/* Fuera del <form>: ListMembers tiene su propio formulario (no se pueden anidar). */}
      {list && (
        <div className="mt-[18px] border-t border-line pt-4">
          <ListMembers listId={list.id} isOwner currentUserId={currentUserId} />
        </div>
      )}
      {confirm === 'delete' && list && (
        <ConfirmDialog
          title={`¿Borrar «${list.name}»?`} body="Sus tareas van a la papelera: podés restaurarlas durante 30 días."
          confirmLabel="Borrar lista" pending={pending} onCancel={() => setConfirm(null)} onConfirm={remove}
        />
      )}
    </Modal>
  );
}
```

- [ ] **Step 3: Pasar `owner` y `currentUserId`**

En `src/components/sidebar.tsx`, reemplazar la línea del `ListDialog` por:

```tsx
      {dialog && (
        <ListDialog
          list={dialog.list} folders={folders} owner={dialog.list ? owners[dialog.list.id] : undefined}
          currentUserId={user.id} onClose={() => setDialog(null)}
        />
      )}
```

En `src/components/task-workspace.tsx`, reemplazar la del encabezado por:

```tsx
      {listDialog && list && (
        <ListDialog
          list={list} folders={folders} owner={listMembers.find((m) => m.role === 'owner')}
          currentUserId={currentUserId} onClose={() => setListDialog(false)}
        />
      )}
```

- [ ] **Step 4: Tipos y lint**

Run: `npx tsc --noEmit` y `npm run lint` → sin errores. (`grep -rn LIST_COLORS src` → solo `list-dialog.tsx`.)

- [ ] **Step 5: Chequeo visual y de comportamiento**

1200 px claro y oscuro: «Nueva lista» (sin miembros ni «Borrar lista»), «Editar Trabajo» como dueño (comparar con «Diálogo lista (dueño)»: foco inicial en «Nombre» con borde petróleo + anillo, Petróleo/Azul/… con anillo en el elegido, «Sin carpeta» atenuado, miembros con «DUEÑO» y «Quitar», pie `--bg`) y como miembro (iniciar sesión con la otra cuenta; comparar con «Diálogo lista (miembro)»: aviso «X compartió esta lista con vos…», «· vos», solo «Salir de la lista»). «Borrar lista», «Quitar» y «Salir de la lista» abren el `ConfirmDialog` encima (400 px, «Cancelar» + botón rojo); Escape cierra solo el de arriba y el foco vuelve al botón que lo abrió; Tab queda atrapado en el de arriba. Desde el encabezado de una lista compartida, «Miembros» abre el mismo diálogo. 390 px: el diálogo ocupa el ancho con 16 px de margen. Capturas `t8-dialogo-duenio-1200-{claro,oscuro}.png`, `t8-dialogo-miembro-1200-claro.png`, `t8-confirmar-1200-claro.png`.

- [ ] **Step 6: Commit**

```bash
git add src/components/list-dialog.tsx src/components/list-members.tsx src/components/sidebar.tsx src/components/task-workspace.tsx
git commit -m "feat(ui): diálogo de lista del rediseño con confirmaciones propias"
```

---

### Task 9: Login y registro

Diseño de referencia: «01 · Login y registro (con errores)»: fondo `--sidebar`; tarjeta de 400 px, padding 32, radio 16, `--surface` con borde; gap 20 (login) / 16 (registro); logo 26 px radio 8 + «Notas» 17/800; título 22/800 (−2 %) + subtítulo 13,5 `--muted`; alerta `--danger-bg`/`--danger` 13/600 con ícono 15, radio 9; rótulos 13/600; campos de 42 px radio 9 fondo `--bg` (borde `--danger` en error de credenciales); contraseña con puntos espaciados (+20 %) y «mín. 8» a la derecha en registro; código de invitación en Geist Mono (+6 %); botón primario 42 px 14/700 (deshabilitado al 55 %); pie 13 `--muted` con link petróleo 600.

**Files:**
- Rewrite: `src/components/auth-form.tsx`

- [ ] **Step 1: `src/components/auth-form.tsx` (reestilado en el lugar)**

Se conserva: `useActionState`, `next` oculto y propagado al cambiar entre login y registro, valores no sensibles devueltos en error (`defaultValue`), `required`, `minLength` 8 en registro, `autoComplete` correctos, labels `Email`, `Contraseña`, `Código de invitación`, botón deshabilitado mientras envía. Cambia: diseño, títulos «Ingresar» / «Crear cuenta» con subtítulo, error con ícono, campos marcados con `aria-invalid` cuando las credenciales son incorrectas, «Nombre (opcional)».

```tsx
'use client';

import { Check, CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useId } from 'react';
import type { AuthState } from '@/app/(auth)/actions';
import { field } from './ui';

type Action = (prev: AuthState, form: FormData) => Promise<AuthState>;

/** El mensaje que devuelve loginAction con credenciales incorrectas: marca los dos campos. */
const CREDENTIALS_ERROR = 'Email o contraseña incorrectos';
const LABEL = 'flex flex-col gap-1.5 text-[13px] font-semibold';
const INPUT = `${field} h-[42px] bg-bg font-normal`;

export function AuthForm({ mode, action, next }: { mode: 'login' | 'registro'; action: Action; next?: string }) {
  const [state, formAction, pending] = useActionState(action, null);
  const passwordId = useId();
  const passwordHintId = useId();
  const isLogin = mode === 'login';
  // El destino después de entrar (p. ej. el consentimiento OAuth) viaja también al cambiar entre login y registro.
  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : '';
  const badCredentials = isLogin && state?.error === CREDENTIALS_ERROR;

  return (
    <form
      action={formAction}
      className={`flex w-full max-w-[400px] flex-col rounded-dialog border border-line bg-surface p-8 ${isLogin ? 'gap-5' : 'gap-4'}`}
    >
      <div className="flex items-center gap-[9px]">
        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-nav bg-accent text-accent-fg">
          <Check size={15} strokeWidth={3.2} aria-hidden="true" />
        </span>
        <span className="text-[17px] font-extrabold tracking-[-0.02em]">Notas</span>
      </div>
      <div>
        <h1 className="text-[22px] font-extrabold leading-tight tracking-[-0.02em]">{isLogin ? 'Ingresar' : 'Crear cuenta'}</h1>
        <p className="mt-1 text-body-sm text-muted">{isLogin ? 'Tus tareas, tuyas y de la IA.' : 'El registro es solo con invitación.'}</p>
      </div>
      {next && <input type="hidden" name="next" value={next} />}
      {state && (
        <div role="alert" className="flex items-center gap-[9px] rounded-input bg-danger-bg px-3 py-2.5 text-[13px] font-semibold text-danger">
          <CircleAlert size={15} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
          {state.error}
        </div>
      )}
      {!isLogin && (
        <label className={LABEL}>
          <span>Nombre <span className="font-medium text-muted">(opcional)</span></span>
          <input name="name" autoComplete="name" defaultValue={state?.values?.name} className={INPUT} />
        </label>
      )}
      <label className={LABEL}>
        Email
        <input
          name="email" type="email" required autoComplete="email" defaultValue={state?.values?.email}
          aria-invalid={badCredentials || undefined} className={INPUT}
        />
      </label>
      <div className={LABEL}>
        <label htmlFor={passwordId}>Contraseña</label>
        <span className="relative flex items-center">
          <input
            id={passwordId} name="password" type="password" required minLength={isLogin ? undefined : 8}
            autoComplete={isLogin ? 'current-password' : 'new-password'} aria-invalid={badCredentials || undefined}
            aria-describedby={isLogin ? undefined : passwordHintId}
            className={`${INPUT} tracking-[.2em] ${isLogin ? '' : 'pr-16'}`}
          />
          {!isLogin && (
            <span id={passwordHintId} className="pointer-events-none absolute right-3 text-meta font-normal text-muted">mín. 8</span>
          )}
        </span>
      </div>
      {!isLogin && (
        <label className={LABEL}>
          Código de invitación
          <input name="invite" required autoComplete="off" spellCheck={false} className={`${INPUT} font-mono tracking-[.06em]`} />
        </label>
      )}
      <button
        type="submit" disabled={pending} aria-busy={pending}
        className="flex h-[42px] items-center justify-center rounded-input bg-accent text-body font-bold text-accent-fg transition-colors duration-120 hover:bg-accent-hover disabled:opacity-55"
      >
        {isLogin ? 'Ingresar' : 'Crear cuenta'}
      </button>
      <p className="text-center text-[13px] text-muted">
        {isLogin ? (
          <>¿No tenés cuenta? <Link href={`/registro${nextQuery}`} className="font-semibold text-accent hover:text-accent-hover">Registrate</Link></>
        ) : (
          <>¿Ya tenés cuenta? <Link href={`/login${nextQuery}`} className="font-semibold text-accent hover:text-accent-hover">Ingresá</Link></>
        )}
      </p>
    </form>
  );
}
```

`src/app/(auth)/layout.tsx` ya centra la tarjeta sobre `bg-sidebar` con `p-4`: no cambia.

- [ ] **Step 2: Tipos y lint**

Run: `npx tsc --noEmit` y `npm run lint` → sin errores.

- [ ] **Step 3: Chequeo visual**

Cerrar sesión. `/login` a 1200 px claro y oscuro: comparar con «Login»; ingresar `prueba@example.com` con una contraseña mala → alerta roja con ícono y los dos campos con borde rojo; la buena entra a `/app/today`. `/registro`: comparar con «Registro» («Nombre (opcional)», «mín. 8» dentro del campo, código en monoespaciada); mientras envía, el botón queda al 55 %. 390 px: la tarjeta ocupa el ancho con 16 px de margen. Capturas `t9-login-error-1200-{claro,oscuro}.png`, `t9-registro-1200-claro.png`, `t9-login-390-claro.png`.

- [ ] **Step 4: Commit**

```bash
git add src/components/auth-form.tsx
git commit -m "feat(ui): login y registro del rediseño"
```

---

### Task 10: Configuración — cuenta, zona horaria, tema y conexión con IA

Diseño de referencia: «09 · Configuración y conexión con IA»: columna de 720 px; título 24/800; grilla `180px 1fr` con gap 24; rótulo 14/700 + ayuda 12,5 `--muted`; tarjeta de cuenta (avatar 36, nombre 600, email 12,5); zona horaria en campo de 40 px con globo y chevron; «Conexión con IA» con chispa petróleo; rótulos internos 12/700/+6 %; URL MCP en Geist Mono 13 en campo de 40 px + «Copiar» secundario; apps conectadas en tarjeta radio 12 con filas `12px 14px` (cuadrado 32 px radio 8 con la inicial 800, nombre 600, detalle 12, «Desconectar» 13/600 rojo con hover `--danger-bg`); tokens: campo + «Crear token» primario; aviso del token nuevo (borde petróleo, fondo `--selected`, llave, código mono 12,5, «Copiar» primario, «Listo, ya lo guardé» subrayado); filas con «nombre `ntk_a8f2…`» y «Revocar»; «Cerrar sesión» secundario 38 px con ícono. El diseño propone el selector de tema en Configuración: se agrega como fila «Tema» con un control segmentado (Sistema / Claro / Oscuro) con los mismos tokens (radio 9 / 7, `--selected` + `--accent` en el elegido).

**Files:**
- Modify: `src/core/oauth.ts` (`connectedAt`), `tests/core/oauth-tokens.test.ts`, `src/components/logout-button.tsx`
- Rewrite: `src/app/app/settings/page.tsx`, `src/components/ai-connection.tsx`, `src/components/timezone-form.tsx`
- Create: `src/components/theme-form.tsx`

> E2E afectado (se ajusta en la Task 14): «Revocar» pide confirmación en un `alertdialog` en lugar de `confirm()`.

- [ ] **Step 1: Test que falla para `connectedAt`**

En `tests/core/oauth-tokens.test.ts`, en el test «lista las apps conectadas…» cambiar la expectativa por:

```ts
    expect(await listOAuthConnections(db, userId)).toEqual([
      { clientId: client.clientId, clientName: 'Cliente de prueba', connectedAt: expect.any(Date), lastUsedAt: null },
    ]);
```

y agregar después de ese test:

```ts
  it('connectedAt es cuándo se canjeó el código de la conexión vigente', async () => {
    const t0 = new Date('2026-10-02T15:00:00Z');
    const { client } = await issueTestTokens(db, userId, t0);
    const [connection] = await listOAuthConnections(db, userId, t0);
    expect(connection.clientId).toBe(client.clientId);
    expect(connection.connectedAt?.toISOString()).toBe(t0.toISOString());
  });
```

- [ ] **Step 2: Verlo fallar**

Run: `npx vitest run tests/core/oauth-tokens.test.ts`
Expected: FAIL — falta `connectedAt`.

- [ ] **Step 3: Implementar en `src/core/oauth.ts`**

Agregar `min` al import de `drizzle-orm` (`import { type SQL, and, asc, eq, gt, isNull, lt, max, min, notExists, or, sql } from 'drizzle-orm';`), agregar el campo a la interfaz y a la consulta:

```ts
/** App conectada por OAuth (tiene al menos un par de tokens vigente). */
export interface OAuthConnection {
  clientId: string;
  clientName: string;
  /** Cuándo se canjeó el código que originó la conexión vigente más vieja. */
  connectedAt: Date | null;
  lastUsedAt: Date | null;
}

export async function listOAuthConnections(db: DB, userId: string, now: Date = new Date()): Promise<OAuthConnection[]> {
  return db
    .select({
      clientId: oauthClients.clientId,
      clientName: oauthClients.clientName,
      connectedAt: min(oauthTokens.familyCreatedAt),
      lastUsedAt: max(oauthTokens.lastUsedAt),
    })
    .from(oauthTokens)
    .innerJoin(oauthClients, eq(oauthClients.clientId, oauthTokens.clientId))
    .where(and(eq(oauthTokens.userId, userId), isNull(oauthTokens.revokedAt), gt(oauthTokens.refreshExpiresAt, now)))
    .groupBy(oauthClients.clientId, oauthClients.clientName)
    .orderBy(asc(oauthClients.clientName), asc(oauthClients.clientId));
}
```

(Se reemplaza la interfaz y la función existentes; el resto del archivo no cambia.)

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run tests/core/oauth-tokens.test.ts`
Expected: PASS.

- [ ] **Step 5: `src/components/timezone-form.tsx` (reestilado en el lugar)**

Se conserva: `zones` calculadas en el servidor, `aria-label="Zona horaria"`, mensaje `role="status"` con «Guardado» o el error. Cambia: el diseño no tiene botón «Guardar»: se guarda al elegir (y vuelve al valor anterior si falla).

```tsx
'use client';

import { ChevronDown, Globe } from 'lucide-react';
import { useState, useTransition } from 'react';
import { updateTimezoneAction } from '@/app/app/actions';
import { field } from './ui';

/** `zones` se calcula en el servidor para evitar diferencias de hidratación entre ICU del servidor y del navegador. */
export function TimezoneForm({ current, zones }: { current: string; zones: string[] }) {
  const [value, setValue] = useState(current);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    const previous = value;
    setValue(next);
    setMessage(null);
    startTransition(async () => {
      const result = await updateTimezoneAction(next);
      if (result.ok) {
        setMessage({ ok: true, text: 'Guardado' });
      } else {
        setValue(previous);
        setMessage({ ok: false, text: result.error });
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="relative flex items-center">
        <Globe size={15} aria-hidden="true" className="pointer-events-none absolute left-3 text-muted" />
        <select
          value={value} onChange={(e) => change(e.target.value)} aria-label="Zona horaria"
          className={`${field} h-10 cursor-pointer appearance-none bg-surface pl-[35px] pr-9`}
        >
          {zones.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        <ChevronDown size={14} strokeWidth={2.4} aria-hidden="true" className="pointer-events-none absolute right-2.5 text-muted" />
      </span>
      <span role="status" className={`min-h-[17px] text-meta ${message?.ok === false ? 'text-danger' : 'text-muted'}`}>
        {pending ? 'Guardando…' : message?.text}
      </span>
    </div>
  );
}
```

- [ ] **Step 6: `src/components/theme-form.tsx`**

```tsx
'use client';

import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';
import { setThemeAction } from '@/app/theme-actions';
import type { ThemePreference } from '@/lib/theme';

const OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: 'Sistema', icon: Monitor },
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Oscuro', icon: Moon },
];

/** Sistema / Claro / Oscuro. Se aplica al instante y se guarda en una cookie para el próximo render del servidor. */
export function ThemeForm({ current }: { current: ThemePreference }) {
  const [value, setValue] = useState(current);
  const [, startTransition] = useTransition();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function choose(next: ThemePreference) {
    setValue(next);
    const root = document.documentElement;
    if (next === 'system') delete root.dataset.theme;
    else root.dataset.theme = next;
    startTransition(async () => { await setThemeAction(next); });
  }

  // Radiogroup: las flechas mueven la selección (y el foco) entre las opciones.
  function onKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (index + (e.key === 'ArrowRight' ? 1 : OPTIONS.length - 1)) % OPTIONS.length;
    choose(OPTIONS[next].value);
    buttons.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup" aria-label="Tema"
      className="inline-flex h-10 items-center gap-1 justify-self-start rounded-input border border-line bg-surface p-1"
    >
      {OPTIONS.map(({ value: option, label, icon: Icon }, i) => {
        const checked = value === option;
        return (
          <button
            key={option} ref={(el) => { buttons.current[i] = el; }} type="button" role="radio" aria-checked={checked}
            tabIndex={checked ? 0 : -1} onClick={() => choose(option)} onKeyDown={(e) => onKeyDown(e, i)}
            className={`inline-flex h-[30px] items-center gap-1.5 rounded-pill px-3 text-[13px] font-semibold transition-colors duration-120 ${checked ? 'bg-selected text-accent' : 'text-muted hover:bg-hover hover:text-fg'}`}
          >
            <Icon size={14} aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 7: `src/components/ai-connection.tsx` (reestilado en el lugar)**

Se conserva: crear token (nombre requerido, `maxLength` 100, token en claro mostrado una sola vez con `role="status"`), copiar al portapapeles, revocar token y desconectar app, errores con `role="alert"`, `aria-label`s `URL del servidor MCP`, `Copiar URL del servidor MCP`, `Nombre del token`, `Token nuevo`, `Copiar token`, `Revocar token {nombre}`, `Desconectar {app}`. Cambia: diseño; textos de fecha armados por el servidor (`detail`); confirmación propia.

```tsx
'use client';

import { Check, Copy, KeyRound } from 'lucide-react';
import { useState, useTransition } from 'react';
import { createApiTokenAction, revokeApiTokenAction, revokeOAuthConnectionAction } from '@/app/app/actions';
import { ConfirmDialog } from './confirm-dialog';
import { btn, field, sectionLabel } from './ui';

/** El servidor arma `detail` en la zona del usuario: así no hay diferencias de fechas al hidratar. */
export interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  detail: string;
}

export interface ConnectionRow {
  clientId: string;
  clientName: string;
  detail: string;
}

type Pending = { kind: 'token'; row: TokenRow } | { kind: 'connection'; row: ConnectionRow };

const CARD = 'overflow-hidden rounded-card border border-line bg-surface';
const ROW = 'flex items-center gap-3 border-b border-line px-3.5 py-3 last:border-b-0';
const DANGER_LINK = 'shrink-0 rounded-pill px-2 py-1.5 text-[13px] font-semibold text-danger transition-colors duration-120 hover:bg-danger-bg disabled:opacity-50';
const CODE = 'flex h-10 min-w-0 flex-1 items-center truncate rounded-input border border-line bg-surface px-3 font-mono';

function CopyButton({ text, label, primary = false }: { text: string; label: string; primary?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button" aria-label={label} title={label}
      className={`${primary ? btn.primary : btn.secondary} h-10 shrink-0 px-3 text-[13px]`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check size={14} strokeWidth={2.2} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      {copied ? 'Copiado' : 'Copiar'}
    </button>
  );
}

/** Sección "Conexión con IA" de Configuración: URL del MCP, apps conectadas por OAuth y tokens personales. */
export function AiConnection({ mcpUrl, tokens, connections }: {
  mcpUrl: string;
  tokens: TokenRow[];
  connections: ConnectionRow[];
}) {
  const [name, setName] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [pending, startTransition] = useTransition();

  function create(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createApiTokenAction(name);
      if (result.ok) {
        setNewToken(result.data.token);
        setName('');
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }

  function revoke() {
    const target = confirm;
    if (!target) return;
    startTransition(async () => {
      const result = target.kind === 'token'
        ? await revokeApiTokenAction(target.row.id)
        : await revokeOAuthConnectionAction(target.row.clientId);
      setConfirm(null);
      setError(result.ok ? null : result.error);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h3 className={sectionLabel}>URL del servidor MCP</h3>
        <p className="text-caption text-pretty text-muted">
          Pegala en tu IA: te va a pedir que inicies sesión y autorices el acceso.
        </p>
        <div className="flex gap-2">
          <code aria-label="URL del servidor MCP" className={`${CODE} text-[13px]`}>{mcpUrl}</code>
          <CopyButton text={mcpUrl} label="Copiar URL del servidor MCP" />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className={sectionLabel}>Apps conectadas</h3>
        {connections.length === 0 ? (
          <p className="text-caption text-muted">Ninguna app conectada con OAuth.</p>
        ) : (
          <ul className={CARD}>
            {connections.map((c) => (
              <li key={c.clientId} className={ROW}>
                <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-nav bg-hover text-[13px] font-extrabold">
                  {c.clientName.trim().charAt(0).toUpperCase() || '?'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{c.clientName}</p>
                  <p className="truncate text-meta text-muted">{c.detail}</p>
                </div>
                <button
                  type="button" disabled={pending} onClick={() => setConfirm({ kind: 'connection', row: c })}
                  aria-label={`Desconectar ${c.clientName}`} className={DANGER_LINK}
                >
                  Desconectar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className={sectionLabel}>Tokens personales</h3>
        <p className="text-caption text-pretty text-muted">
          Para apps sin OAuth (Cursor, n8n, scripts). Se mandan como{' '}
          <code className="font-mono text-[12px]">Authorization: Bearer …</code>
        </p>
        <form onSubmit={create} className="flex gap-2">
          <input
            value={name} onChange={(e) => setName(e.target.value)} aria-label="Nombre del token"
            placeholder="Nombre del token, p. ej. Cursor" maxLength={100}
            className={`${field} h-10 min-w-0 flex-1 bg-surface`}
          />
          <button type="submit" disabled={pending || !name.trim()} className={`${btn.primary} h-10 shrink-0 px-3.5 text-[13px]`}>
            Crear token
          </button>
        </form>
        {newToken && (
          <div role="status" className="flex flex-col gap-2.5 rounded-card border border-accent bg-selected p-3.5">
            <p className="flex items-center gap-2 font-bold text-accent">
              <KeyRound size={15} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
              Copiá el token ahora: no se va a volver a mostrar.
            </p>
            <div className="flex gap-2">
              <code aria-label="Token nuevo" className={`${CODE} text-[12.5px]`}>{newToken}</code>
              <CopyButton text={newToken} label="Copiar token" primary />
            </div>
            <button
              type="button" onClick={() => setNewToken(null)}
              className="self-start text-[13px] font-semibold text-accent underline underline-offset-[3px] hover:text-accent-hover"
            >
              Listo, ya lo guardé
            </button>
          </div>
        )}
        {tokens.length === 0 ? (
          <p className="text-caption text-muted">No tenés tokens activos.</p>
        ) : (
          <ul className={CARD}>
            {tokens.map((t) => (
              <li key={t.id} className={ROW}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {t.name}
                    <code className="ml-1.5 font-mono text-[12px] font-normal text-muted">{t.prefix}…</code>
                  </p>
                  <p className="truncate text-meta text-muted">{t.detail}</p>
                </div>
                <button
                  type="button" disabled={pending} onClick={() => setConfirm({ kind: 'token', row: t })}
                  aria-label={`Revocar token ${t.name}`} className={DANGER_LINK}
                >
                  Revocar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p role="alert" className="text-[13px] font-medium text-danger">{error}</p>}

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'token' ? `¿Revocar «${confirm.row.name}»?` : `¿Desconectar ${confirm.row.clientName}?`}
          body={confirm.kind === 'token'
            ? 'Lo que use este token deja de tener acceso al instante.'
            : 'La app va a tener que pedir acceso de nuevo.'}
          confirmLabel={confirm.kind === 'token' ? 'Revocar' : 'Desconectar'}
          pending={pending} onCancel={() => setConfirm(null)} onConfirm={revoke}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 8: `src/components/logout-button.tsx`**

```tsx
'use client';

import { LogOut } from 'lucide-react';
import { useFormStatus } from 'react-dom';
import { btn } from './ui';

export function LogoutButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${btn.secondary} h-[38px] px-3.5 text-[13px]`}>
      <LogOut size={14} aria-hidden="true" />
      {pending ? 'Cerrando sesión…' : 'Cerrar sesión'}
    </button>
  );
}
```

- [ ] **Step 9: `src/app/app/settings/page.tsx`**

```tsx
import { Sparkles } from 'lucide-react';
import { cookies } from 'next/headers';
import { logoutAction } from '@/app/(auth)/actions';
import { listApiTokens } from '@/core/api-tokens';
import { DEFAULT_TIMEZONE } from '@/core/dates';
import { listOAuthConnections } from '@/core/oauth';
import { getDb } from '@/db';
import { AiConnection } from '@/components/ai-connection';
import { Avatar } from '@/components/avatar';
import { LogoutButton } from '@/components/logout-button';
import { MobileHeader } from '@/components/mobile-header';
import { ThemeForm } from '@/components/theme-form';
import { TimezoneForm } from '@/components/timezone-form';
import { mcpResourceUrl } from '@/lib/app-url';
import { requireUser } from '@/lib/auth';
import { formatAgo, formatShortDate } from '@/lib/format';
import { THEME_COOKIE, parseTheme } from '@/lib/theme';

function SectionLabel({ title, help, ai = false }: { title: string; help?: string; ai?: boolean }) {
  return (
    <div className="mt-5 first:mt-0 md:mt-0">
      <h2 className="flex items-center gap-[7px] font-bold">
        {ai && <Sparkles size={15} strokeWidth={2.2} aria-hidden="true" className="text-accent" />}
        {title}
      </h2>
      {help && <p className="mt-1 text-caption text-pretty text-muted">{help}</p>}
    </div>
  );
}

export default async function SettingsPage() {
  const user = await requireUser();
  const db = await getDb();
  const [tokens, connections] = await Promise.all([listApiTokens(db, user.id), listOAuthConnections(db, user.id)]);
  // ICU no siempre lista el nombre actual de Buenos Aires; se agregan el default y el valor actual.
  const zones = [...new Set([...Intl.supportedValuesOf('timeZone'), DEFAULT_TIMEZONE, user.timezone])].sort();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  // Fechas armadas acá, en la zona del usuario: el cliente las recibe como texto.
  const now = new Date();
  const day = (d: Date) => formatShortDate(d, user.timezone);
  const lastUse = (d: Date | null) => (d ? formatAgo(d, now, user.timezone) : 'nunca');

  return (
    <div className="h-full overflow-y-auto">
      <MobileHeader title="Configuración" />
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-7 px-4 pb-10 md:px-7 md:pt-[30px]">
        <h1 className="hidden text-display md:block">Configuración</h1>
        <div className="grid grid-cols-1 items-start gap-x-6 gap-y-3 md:grid-cols-[180px_minmax(0,1fr)] md:gap-y-6">
          <SectionLabel title="Cuenta" />
          <div className="flex items-center gap-3 rounded-card border border-line bg-surface p-4">
            <Avatar person={user} size={36} />
            <div className="min-w-0">
              <p className="truncate font-semibold">{user.name || user.email}</p>
              {user.name && <p className="truncate text-caption text-muted">{user.email}</p>}
            </div>
          </div>

          <SectionLabel title="Zona horaria" help="Define qué es «hoy» para tus vistas y para la IA." />
          <TimezoneForm current={user.timezone} zones={zones} />

          <SectionLabel title="Tema" help="Por defecto sigue la configuración del sistema." />
          <ThemeForm current={theme} />

          <SectionLabel
            ai title="Conexión con IA"
            help="Claude, ChatGPT u otra IA compatible con MCP pueden crear, completar y mover tus tareas."
          />
          <AiConnection
            mcpUrl={mcpResourceUrl()}
            tokens={tokens.map((t) => ({
              id: t.id, name: t.name, prefix: t.prefix,
              detail: `Creado el ${day(t.createdAt)} · último uso ${lastUse(t.lastUsedAt)}`,
            }))}
            connections={connections.map((c) => ({
              clientId: c.clientId, clientName: c.clientName,
              detail: `${c.connectedAt ? `Conectada el ${day(c.connectedAt)} · último uso` : 'Último uso'} ${lastUse(c.lastUsedAt)}`,
            }))}
          />

          <div className="hidden md:block" />
          <form action={logoutAction} className="mt-5 md:mt-0">
            <LogoutButton />
          </form>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 10: Tipos, lint y tests**

Run: `npx tsc --noEmit`, `npm run lint`, `npx vitest run tests/core/oauth-tokens.test.ts` → verde.

- [ ] **Step 11: Chequeo visual y de comportamiento**

`/app/settings` a 1200 px claro y oscuro vs «Configuración»: grilla de 180 px, tarjeta de cuenta, zona horaria (cambiarla guarda y muestra «Guardado»), **Tema**: elegir «Oscuro» cambia la app al instante; recargar → sigue oscuro sin parpadeo (el HTML del servidor ya trae `data-theme="dark"`); «Sistema» vuelve a seguir al sistema (probar con `resize_window` `colorScheme`); flechas ←/→ mueven la selección. Crear un token «Cursor» → aviso con borde petróleo y token en mono; «Copiar» pasa a «Copiado» 2 s; «Listo, ya lo guardé» lo oculta; la fila muestra «Cursor ntk_…» y «Creado el dd/mm · último uso nunca»; «Revocar» abre el `ConfirmDialog`. 390 px: una sola columna con los rótulos arriba de cada bloque y el encabezado de celular «Configuración». Capturas `t10-config-1200-{claro,oscuro}.png`, `t10-config-390-claro.png`.

- [ ] **Step 12: Commit**

```bash
git add src/core/oauth.ts tests/core/oauth-tokens.test.ts src/app/app/settings/page.tsx src/components/ai-connection.tsx src/components/timezone-form.tsx src/components/theme-form.tsx src/components/logout-button.tsx
git commit -m "feat(ui): configuración del rediseño con selector de tema y conexión con IA"
```

---

### Task 11: Consentimiento OAuth y su error

Diseño de referencia: «10 · Consentimiento OAuth» y «OAuth error»: fondo `--sidebar`; tarjeta de 440 px, padding 32, radio 16; dos cuadrados de 44 px radio 12 (inicial del cliente sobre `--hover` en 18/800; logo de Notas sobre `--accent` con tilde 22) separados por «⇄» `--muted`; título 21/800 (−2 %, 1,25); caja «VA A PODER» (`--bg`, borde, radio 12, padding 14) con tildes petróleo de 15 px y texto 13,5; grilla «Cuenta» / «Al terminar vuelve a» (escudo petróleo + host) en 13; «Cancelar» secundario y «Permitir» primario de 42 px; nota final 12 `--muted` centrada. Error: cuadrado 44 `--danger-bg` con alerta, «Esta solicitud no es válida», párrafo 14/1,55 `--muted`, código en Geist Mono 12 sobre `--bg`, «← Volver a {host}» secundario de 40 px.

**Files:**
- Modify: `src/lib/oauth-consent.ts`, `tests/lib/oauth-consent.test.ts`
- Rewrite: `src/app/oauth/authorize/page.tsx`

> E2E afectado (se ajusta en la Task 14): el título pasa de «… quiere acceder a tu cuenta de Notas» a «… quiere acceder a tus tareas de Notas».

- [ ] **Step 1: Test que falla — `errorPageView` devuelve el código OAuth**

En `tests/lib/oauth-consent.test.ts`, en el test «response_type inválido…», después de `expect(view.message).toBeTruthy();` agregar:

```ts
    expect(view.code).toBe('unsupported_response_type');
```

- [ ] **Step 2: Verlo fallar**

Run: `npx vitest run tests/lib/oauth-consent.test.ts`
Expected: FAIL — `view.code` es `undefined`.

- [ ] **Step 3: Implementar en `src/lib/oauth-consent.ts`**

Reemplazar `errorPageView` por:

```ts
/**
 * Datos para mostrar un error redirigible SIN redirigir: la página de autorización nunca manda al usuario
 * a otro sitio antes de que haga clic (evita que /oauth/authorize sirva de redirector abierto).
 */
export function errorPageView(
  check: RedirectableError, issuer: string,
): { code: string; message: string; host: string; href: string } {
  return {
    code: check.error, message: check.description, host: new URL(check.redirectUri).host,
    href: errorRedirectUrl(check, issuer),
  };
}
```

- [ ] **Step 4: Correr el test**

Run: `npx vitest run tests/lib/oauth-consent.test.ts` → PASS.

- [ ] **Step 5: `src/app/oauth/authorize/page.tsx` (reestilado en el lugar)**

Se conserva **toda** la lógica de seguridad: validar antes de pedir login, nunca redirigir sin clic (error redirigible = link), login con `next` reconstruido con campos validados, formulario con los campos ocultos validados y `formAction` separados para permitir/cancelar, aviso de redirect a la propia computadora (loopback), host de vuelta visible. Cambia: diseño. La lista «Va a poder» sigue al diseño pero **sin subestimar el alcance real** del scope (las herramientas MCP también crean/borran/comparten listas): en una pantalla de consentimiento el texto tiene que ser exacto.

```tsx
import { ArrowLeft, Check, CircleAlert, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authorizationParamsFrom, isLoopbackRedirect, validateAuthorizationRequest } from '@/core/oauth';
import { getDb } from '@/db';
import { btn, sectionLabel } from '@/components/ui';
import { appUrl, mcpResourceUrl } from '@/lib/app-url';
import { getCurrentUser } from '@/lib/auth';
import { errorPageView, loginUrlFor } from '@/lib/oauth-consent';
import { approveAuthorizationAction, denyAuthorizationAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Autorizar acceso · Notas' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const PERMISSIONS = [
  'Ver tus listas y tareas, incluidas las compartidas con vos',
  'Crear, modificar y completar listas y tareas, y compartir tus listas',
  'Borrar listas y mandar tareas a la papelera (podés restaurarlas durante 30 días)',
];

function Shell({ children, gap = 'gap-5' }: { children: React.ReactNode; gap?: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-sidebar p-4">
      <div className={`flex w-full max-w-[440px] flex-col rounded-dialog border border-line bg-surface p-8 ${gap}`}>{children}</div>
    </main>
  );
}

function InvalidRequest({ detail, back }: { detail: string; back?: { href: string; host: string } }) {
  return (
    <Shell gap="gap-[18px]">
      <span className="flex h-11 w-11 items-center justify-center rounded-card bg-danger-bg text-danger">
        <CircleAlert size={22} strokeWidth={2.2} aria-hidden="true" />
      </span>
      <h1 className="text-[21px] font-extrabold leading-[1.25] tracking-[-0.02em]">Esta solicitud no es válida</h1>
      <p className="text-[14px] leading-[1.55] text-pretty text-muted">
        La aplicación mandó una solicitud que no podemos verificar. No se concedió ningún acceso a tu cuenta.
        {!back && ' Volvé a la aplicación que te trajo hasta acá y probá conectar de nuevo.'}
      </p>
      <p role="alert" className="rounded-input border border-line bg-bg px-3 py-2.5 font-mono text-[12px] break-words text-muted">
        {detail}
      </p>
      {back && (
        <a href={back.href} className={`${btn.secondary} h-10 self-start px-3.5 text-[14px]`}>
          <ArrowLeft size={14} strokeWidth={2.2} aria-hidden="true" />
          Volver a {back.host}
        </a>
      )}
    </Shell>
  );
}

export default async function AuthorizePage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  // Un parámetro repetido llega como array: el core lo rechaza (RFC 6749 §3.1).
  const params = authorizationParamsFrom((name) => raw[name]);

  // Primero se valida la solicitud: un pedido inválido no obliga a iniciar sesión.
  const check = await validateAuthorizationRequest(await getDb(), params, { resource: mcpResourceUrl() });
  if (!check.ok && !check.redirect) {
    return <InvalidRequest detail={check.error} />;
  }
  if (!check.ok) {
    // Nunca se redirige sin que el usuario haga clic: si no, esta ruta sería un redirector abierto hacia
    // cualquier redirect_uri registrado (el registro es público).
    const view = errorPageView(check, appUrl());
    return <InvalidRequest detail={`${view.code} · ${view.message}`} back={{ href: view.href, host: view.host }} />;
  }

  const user = await getCurrentUser();
  if (!user) {
    redirect(loginUrlFor({
      responseType: 'code', clientId: check.client.clientId, redirectUri: check.redirectUri,
      codeChallenge: check.codeChallenge, codeChallengeMethod: 'S256', state: check.state, resource: params.resource,
    }));
  }

  const host = new URL(check.redirectUri).host;
  const clientName = check.client.clientName;
  return (
    <Shell>
      <div className="flex items-center gap-2.5" aria-hidden="true">
        <span className="flex h-11 w-11 items-center justify-center rounded-card bg-hover text-[18px] font-extrabold">
          {clientName.trim().charAt(0).toUpperCase() || '?'}
        </span>
        <span className="text-muted">⇄</span>
        <span className="flex h-11 w-11 items-center justify-center rounded-card bg-accent text-accent-fg">
          <Check size={22} strokeWidth={3} />
        </span>
      </div>
      <h1 className="text-[21px] font-extrabold leading-[1.25] tracking-[-0.02em] text-pretty">
        {clientName} quiere acceder a tus tareas de Notas
      </h1>
      <div className="flex flex-col gap-2.5 rounded-card border border-line bg-bg p-3.5">
        <h2 className={sectionLabel}>Va a poder</h2>
        <ul className="flex flex-col gap-2.5 text-body-sm">
          {PERMISSIONS.map((p) => (
            <li key={p} className="flex items-start gap-2.5">
              <Check size={15} strokeWidth={2.4} aria-hidden="true" className="mt-[3px] shrink-0 text-accent" />
              {p}
            </li>
          ))}
        </ul>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 gap-y-1.5 text-[13px]">
        <dt className="text-muted">Cuenta</dt>
        <dd className="truncate font-semibold">{user.email}</dd>
        <dt className="text-muted">Al terminar vuelve a</dt>
        <dd className="flex min-w-0 items-center gap-1.5 font-semibold">
          <ShieldCheck size={13} strokeWidth={2.2} aria-hidden="true" className="shrink-0 text-accent" />
          <span className="truncate">{host}</span>
        </dd>
      </dl>
      {isLoopbackRedirect(check.redirectUri) && (
        <p role="alert" className="flex gap-[9px] rounded-input bg-danger-bg px-3 py-2.5 text-[13px] font-semibold text-danger">
          <CircleAlert size={15} strokeWidth={2.2} aria-hidden="true" className="mt-0.5 shrink-0" />
          Esta aplicación vuelve a un programa de tu propia computadora ({host}). Permití solo si la abriste vos recién.
        </p>
      )}
      <form className="flex justify-end gap-2.5">
        <input type="hidden" name="response_type" value="code" />
        <input type="hidden" name="client_id" value={check.client.clientId} />
        <input type="hidden" name="redirect_uri" value={check.redirectUri} />
        <input type="hidden" name="code_challenge" value={check.codeChallenge} />
        <input type="hidden" name="code_challenge_method" value="S256" />
        {check.state !== undefined && <input type="hidden" name="state" value={check.state} />}
        {params.resource !== undefined && <input type="hidden" name="resource" value={params.resource} />}
        <button type="submit" formAction={denyAuthorizationAction} className={`${btn.secondary} h-[42px] px-4 text-[14px]`}>
          Cancelar
        </button>
        <button type="submit" formAction={approveAuthorizationAction} className={`${btn.primary} h-[42px] px-5 text-[14px]`}>
          Permitir
        </button>
      </form>
      <p className="text-center text-meta text-pretty text-muted">
        Podés desconectar {clientName} cuando quieras desde Configuración.
      </p>
    </Shell>
  );
}
```

- [ ] **Step 6: Tipos, lint y tests**

Run: `npx tsc --noEmit`, `npm run lint`, `npx vitest run tests/lib/oauth-consent.test.ts tests/core/oauth-authorize.test.ts` → verde.

- [ ] **Step 7: Chequeo visual**

Registrar un cliente de prueba (PowerShell): `Invoke-RestMethod -Method Post -Uri http://localhost:3000/oauth/register -ContentType 'application/json' -Body '{"client_name":"Claude","redirect_uris":["https://claude.ai/api/mcp/auth_callback"]}'` y abrir `http://localhost:3000/oauth/authorize?response_type=code&client_id=<id>&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&state=x&resource=http%3A%2F%2Flocalhost%3A3000%2Fmcp` (con sesión iniciada) → comparar con «OAuth consentimiento» en 1200 px claro y oscuro (no hacer clic en «Permitir»). Cambiar `response_type=token` → «OAuth error» con `unsupported_response_type · …` y «Volver a claude.ai». Quitar `client_id` → error sin botón de vuelta. Capturas `t11-oauth-1200-{claro,oscuro}.png`, `t11-oauth-error-1200-claro.png`, `t11-oauth-390-claro.png`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/oauth-consent.ts tests/lib/oauth-consent.test.ts src/app/oauth/authorize/page.tsx
git commit -m "feat(ui): consentimiento OAuth del rediseño"
```

---

### Task 12: Estados vacíos, cargando y error; vaciar papelera; refresco automático

Diseño de referencia: «11 · Estados vacíos, cargando y error» (Hoy vacío, Bandeja vacía, Asignadas vacío, Completadas vacío, Papelera vacía, Error, Cargando), «Papelera» (acción «Vaciar papelera» en el encabezado), notas «Borrar y deshacer» (vaciar confirma) y «Cambios hechos por la IA» (revalidar al volver a la pestaña y cada 30 s).

**Files:**
- Modify: `src/core/tasks.ts` (`emptyTrash`), `src/app/app/actions.ts` (`emptyTrashAction`), `src/components/app-shell.tsx`
- Create: `tests/core/tasks-trash.test.ts`, `src/components/auto-refresh.tsx`, `src/app/app/error.tsx`, `src/app/app/[view]/loading.tsx`, `src/app/app/list/[id]/loading.tsx`, `src/app/app/tag/[name]/loading.tsx`
- Rewrite: `src/components/task-workspace.tsx` (versión final, incluye lo de las Tasks 5–8)

- [ ] **Step 1: Test que falla para `emptyTrash`**

`tests/core/tasks-trash.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTask, deleteTask, emptyTrash, listTasks } from '@/core/tasks';
import { createTestDb } from '../helpers/db';
import { createSharingFixture } from '../helpers/sharing';

describe('emptyTrash', () => {
  it('borra para siempre solo lo que está en la papelera de listas propias', async () => {
    const db = await createTestDb();
    const { owner, member, shared, ownerPrivate } = await createSharingFixture(db);
    const pending = await createTask(db, owner.id, { title: 'Pendiente', listId: ownerPrivate.id });
    const mine = await createTask(db, owner.id, { title: 'Borrada mía', listId: ownerPrivate.id });
    const inShared = await createTask(db, member.id, { title: 'Borrada en compartida', listId: shared.id });
    const memberOwn = await createTask(db, member.id, { title: 'Borrada del miembro' });
    await deleteTask(db, owner.id, mine.id);
    await deleteTask(db, member.id, inShared.id);
    await deleteTask(db, member.id, memberOwn.id);

    // El miembro vacía: se va lo de su Bandeja, no lo de la lista compartida (es del dueño).
    expect(await emptyTrash(db, member.id)).toBe(1);
    expect((await listTasks(db, member.id, { view: 'trash' })).map((t) => t.title)).toEqual(['Borrada en compartida']);

    // El dueño vacía: se van la suya y la de su lista compartida; la pendiente queda.
    expect(await emptyTrash(db, owner.id)).toBe(2);
    expect(await listTasks(db, owner.id, { view: 'trash' })).toEqual([]);
    expect((await listTasks(db, owner.id, { listId: ownerPrivate.id })).map((t) => t.id)).toEqual([pending.id]);
  });
});
```

- [ ] **Step 2: Verlo fallar**

Run: `npx vitest run tests/core/tasks-trash.test.ts`
Expected: FAIL — `emptyTrash is not a function`.

- [ ] **Step 3: Implementar en `src/core/tasks.ts`** (antes de `purgeTrash`)

```ts
/**
 * Vacía la papelera del usuario: borra para siempre las tareas borradas de sus listas. Las de listas
 * compartidas con él no se tocan (son del dueño; se purgan solas a los 30 días).
 */
export async function emptyTrash(db: DB, userId: string): Promise<number> {
  const deleted = await db
    .delete(tasks)
    .where(and(isNotNull(tasks.deletedAt), inArray(tasks.listId, ownedListIds(db, userId))))
    .returning({ id: tasks.id });
  return deleted.length;
}
```

- [ ] **Step 4: Correr el test**

Run: `npx vitest run tests/core/tasks-trash.test.ts` → PASS.

- [ ] **Step 5: `emptyTrashAction` en `src/app/app/actions.ts`**

Agregar `emptyTrash` al import de `@/core/tasks` y, después de `restoreTaskAction`:

```ts
/** Vacía la papelera (solo tareas de listas propias). Devuelve cuántas se borraron. */
export async function emptyTrashAction() {
  return act(async (db, user) => ({ deleted: await emptyTrash(db, user.id) }));
}
```

- [ ] **Step 6: `src/components/auto-refresh.tsx`**

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const INTERVAL_MS = 30_000;

/** Nada se mueve bajo el cursor: con un campo enfocado o un diálogo abierto se espera al próximo turno. */
function busy(): boolean {
  const active = document.activeElement;
  return Boolean(document.querySelector('[aria-modal="true"]'))
    || (active instanceof HTMLElement && (active.isContentEditable || active.matches('input, textarea, select')));
}

/** Trae cambios hechos en otro lado (otra pestaña, la IA por MCP): al volver a la pestaña y cada 30 s. */
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && !busy()) router.refresh();
    };
    const timer = setInterval(refresh, INTERVAL_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router]);
  return null;
}
```

En `src/components/app-shell.tsx`: agregar `import { AutoRefresh } from './auto-refresh';` y, dentro de `<ToastProvider>`, después del `<div className="flex h-dvh …">…</div>`, la línea `<AutoRefresh />`.

- [ ] **Step 7: Error y carga**

`src/app/app/error.tsx`:

```tsx
'use client';

import { CloudOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { EmptyState } from '@/components/empty-state';

/** Error al cargar una vista (la barra lateral queda): «Probá de nuevo» vuelve a pedir los datos. */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return (
    <div className="flex h-full items-center justify-center p-4">
      <EmptyState
        icon={CloudOff} title="No pudimos cargar tus tareas" body="Revisá la conexión y volvé a intentar."
        action={{
          label: 'Probá de nuevo', variant: 'secondary',
          onClick: () => startTransition(() => { router.refresh(); reset(); }),
        }}
      />
    </div>
  );
}
```

`src/app/app/[view]/loading.tsx`, `src/app/app/list/[id]/loading.tsx` y `src/app/app/tag/[name]/loading.tsx` (los tres iguales):

```tsx
import { WorkspaceSkeleton } from '@/components/skeleton';

export default function Loading() {
  return <WorkspaceSkeleton />;
}
```

- [ ] **Step 8: `src/components/task-workspace.tsx` — versión final**

Reemplaza el archivo entero. Es lo de las Tasks 5–8 (encabezados, layout, atajo N, placeholder/destino del agregado rápido, detalle, diálogo de miembros) más: estados vacíos del diseño por vista (con «Agregar tarea» que enfoca el campo y «Ver listas compartidas» que abre el cajón en celular y enfoca la primera compartida) y «Vaciar papelera» con confirmación.

```tsx
'use client';

import {
  CalendarDays, CircleCheck, Hash, Inbox, List as ListIcon, Sun, Trash2, UserCheck, Users,
} from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import type { Folder, ListWithRole } from '@/core/lists';
import type { ListMember } from '@/core/members';
import type { TaskWithDetails } from '@/core/tasks';
import { emptyTrashAction, type QuickAddContext } from '@/app/app/actions';
import { formatLongDate, formatWeekRange, pendingLabel } from '@/lib/format';
import { useShell } from './app-shell';
import { Avatar } from './avatar';
import { ConfirmDialog } from './confirm-dialog';
import { EmptyState, type EmptyStateAction } from './empty-state';
import { ListDialog } from './list-dialog';
import { MobileHeader } from './mobile-header';
import { QuickAdd } from './quick-add';
import { TaskDetail } from './task-detail';
import { TaskList, type TaskGrouping } from './task-list';
import type { TaskItemVariant } from './task-item';
import { useToast } from './toast';
import { ViewHeader } from './view-header';
import { SAVE_ERROR, WorkspaceProvider, isEditableTarget } from './workspace-context';

function subtitleFor(context: QuickAddContext, tasks: TaskWithDetails[], today: string, list?: ListWithRole): string {
  const pending = pendingLabel(tasks.filter((t) => t.status === 'pending').length);
  switch (context.view) {
    case 'today': return `${formatLongDate(today)} · ${pending}`;
    case 'next7': return formatWeekRange(today);
    case 'inbox': return `Tareas sin lista · ${pending}`;
    case 'assigned': return `En listas compartidas · ${pending}`;
    case 'completed': return 'Las más recientes primero';
    case 'trash': return 'Se eliminan solas a los 30 días';
  }
  if (context.tag) return `Etiqueta · ${pending}`;
  return list?.shared ? `Compartida · ${pending}` : pending;
}

function focusQuickAdd() {
  document.getElementById('quick-add-input')?.focus();
}

export function TaskWorkspace({
  title, tasks, selected, lists, members, context, today, now, timezone, currentUserId, list, listMembers, folders,
}: {
  title: string; tasks: TaskWithDetails[]; selected: TaskWithDetails | null;
  lists: ListWithRole[]; members: ListMember[]; context: QuickAddContext; today: string; now: string; timezone: string;
  currentUserId: string; list?: ListWithRole; listMembers: ListMember[]; folders: Folder[];
}) {
  const { openDrawer } = useShell();
  const toast = useToast();
  const [listDialog, setListDialog] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [emptying, startEmptying] = useTransition();
  const inTrash = context.view === 'trash';
  // En "Asignadas a mí" una tarea nueva no quedaría asignada y no se vería: no se ofrece agregar.
  const canAdd = context.view !== 'completed' && context.view !== 'assigned' && !inTrash;
  const subtitle = subtitleFor(context, tasks, today, list);
  const maxWidth = selected ? 'md:max-w-[720px]' : 'md:max-w-[760px]';
  const variant: TaskItemVariant = inTrash ? 'trash' : context.view === 'completed' ? 'completed' : 'default';
  const grouping: TaskGrouping =
    context.view === 'today' || context.view === 'next7' ? 'date' : context.view === 'completed' ? 'completed' : 'none';

  // N enfoca el agregado rápido (fuera de campos de texto y sin diálogos abiertos).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'n' && e.key !== 'N') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableTarget(e.target) || document.querySelector('[aria-modal="true"]')) return;
      const input = document.getElementById('quick-add-input');
      if (!input) return;
      e.preventDefault();
      input.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function showSharedLists() {
    const isMobile = window.matchMedia('(max-width: 767px)').matches;
    if (isMobile) openDrawer();
    // En celular, después de que el cajón termine de entrar (280 ms) y de enfocar su primer link.
    setTimeout(() => document.querySelector<HTMLElement>('#sidebar-shared a')?.focus(), isMobile ? 320 : 0);
  }

  function emptyTrashNow() {
    startEmptying(async () => {
      let error: string | null = null;
      try {
        const result = await emptyTrashAction();
        if (!result.ok) error = result.error;
        else if (result.data.deleted === 0) error = 'Las tareas de listas compartidas con vos solo las puede borrar su dueño.';
      } catch {
        error = SAVE_ERROR;
      }
      setConfirmEmpty(false);
      if (error) toast({ tone: 'error', message: error });
    });
  }

  const addAction: EmptyStateAction | undefined = canAdd ? { label: 'Agregar tarea', onClick: focusQuickAdd } : undefined;
  const empty =
    context.view === 'today' ? <EmptyState icon={Sun} title="Nada para hoy" body="Disfrutá el día, o dejá anotado algo para después." action={addAction} />
    : context.view === 'inbox' ? <EmptyState icon={Inbox} title="Bandeja vacía" body="Todo lo que agregues sin lista cae acá hasta que lo ordenes." action={addAction} />
    : context.view === 'next7' ? <EmptyState icon={CalendarDays} title="Semana libre" body="No tenés nada en los próximos 7 días." action={addAction} />
    : context.view === 'assigned' ? (
      <EmptyState
        icon={UserCheck} title="Nadie te asignó nada" body="Cuando te asignen una tarea en una lista compartida la vas a ver acá."
        action={lists.some((l) => l.role === 'member') ? { label: 'Ver listas compartidas', onClick: showSharedLists, variant: 'secondary' } : undefined}
      />
    )
    : context.view === 'completed' ? <EmptyState icon={CircleCheck} title="Todavía nada completado" body="Cuando termines una tarea, la vas a ver acá." />
    : inTrash ? <EmptyState icon={Trash2} title="La papelera está vacía" body="Lo que borres se guarda 30 días por si te arrepentís." />
    : context.tag ? <EmptyState icon={Hash} title={`Nada con #${context.tag}`} body="Las tareas que etiquetes así aparecen acá." action={addAction} />
    : <EmptyState icon={ListIcon} title="Lista vacía" body="Todavía no hay tareas en esta lista." action={addAction} />;

  const destinationList = context.listId ? list : lists.find((l) => l.isInbox);
  const destination = { name: destinationList?.name ?? 'Bandeja', color: destinationList?.color ?? null };
  const placeholder =
    context.listId && list ? `Agregar tarea en ${list.name}…`
    : context.view === 'inbox' ? 'Agregar tarea a la Bandeja…'
    : context.tag ? `Agregar tarea con #${context.tag}…`
    : 'Agregar tarea… «Pagar luz mañana !alta #casa»';

  const titleNode = (
    <>
      {list?.color && <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: list.color }} />}
      <span className="truncate">{title}</span>
    </>
  );

  const trashAction = inTrash && tasks.length > 0 ? (
    <button
      type="button" onClick={() => setConfirmEmpty(true)}
      className="inline-flex h-8 items-center rounded-nav border border-line bg-surface px-3 text-[13px] font-semibold text-danger transition-colors duration-120 hover:bg-danger-bg"
    >
      Vaciar papelera
    </button>
  ) : undefined;

  const shownMembers = listMembers.slice(0, 3);
  const extraMembers = listMembers.length - shownMembers.length;
  const membersAction = list?.shared ? (
    <>
      <div
        role="img" aria-label={`Miembros: ${listMembers.map((m) => m.name || m.email).join(', ')}`}
        className="flex items-center"
      >
        {shownMembers.map((m, i) => (
          <span key={m.id} className={i > 0 ? '-ml-2' : ''}><Avatar person={m} size={28} ring /></span>
        ))}
        {extraMembers > 0 && (
          <span className="-ml-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-bg bg-hover text-[11px] font-bold text-muted">
            +{extraMembers}
          </span>
        )}
      </div>
      <button
        type="button" onClick={() => setListDialog(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-nav border border-line bg-surface px-3 text-[13px] font-semibold transition-colors duration-120 hover:bg-hover"
      >
        <Users size={14} aria-hidden="true" />
        Miembros
      </button>
    </>
  ) : undefined;

  return (
    <WorkspaceProvider tasks={tasks} selectedId={selected?.id}>
      <div className="flex h-full">
        <section aria-label={title} className={`min-w-0 flex-1 flex-col ${selected ? 'hidden lg:flex' : 'flex'}`}>
          <MobileHeader title={titleNode} subtitle={subtitle} />
          <div className={`mx-auto hidden w-full shrink-0 px-7 pt-[30px] md:block ${maxWidth}`}>
            <ViewHeader title={titleNode} subtitle={subtitle} actions={membersAction ?? trashAction} />
          </div>
          {canAdd && (
            <div
              className={`order-last shrink-0 border-t border-line bg-bg px-3 pb-7 pt-2.5 md:order-none md:mx-auto md:w-full md:border-t-0 md:bg-transparent md:px-7 md:pb-0 md:pt-[18px] ${maxWidth}`}
            >
              <QuickAdd context={context} today={today} placeholder={placeholder} destination={destination} />
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className={`mx-auto w-full px-2 pb-16 md:px-7 md:pt-[18px] ${maxWidth}`}>
              {trashAction && <div className="flex justify-end px-2 pb-1 md:hidden">{trashAction}</div>}
              <TaskList
                tasks={tasks} selectedId={selected?.id} grouping={grouping} today={today} now={now} timezone={timezone}
                lists={lists} showListName={!context.listId && context.view !== 'inbox'} variant={variant} empty={empty}
              />
            </div>
          </div>
        </section>
        {selected && (
          <aside className="flex w-full animate-screen-in flex-col bg-surface lg:w-[400px] lg:shrink-0 lg:animate-panel-in lg:border-l lg:border-line">
            <TaskDetail
              key={selected.id} task={selected} lists={lists} members={members} currentUserId={currentUserId}
              today={today} now={now} timezone={timezone}
            />
          </aside>
        )}
      </div>
      {listDialog && list && (
        <ListDialog
          list={list} folders={folders} owner={listMembers.find((m) => m.role === 'owner')}
          currentUserId={currentUserId} onClose={() => setListDialog(false)}
        />
      )}
      {confirmEmpty && (
        <ConfirmDialog
          title="¿Vaciar la papelera?" body="Las tareas de tus listas se borran para siempre. No se puede deshacer."
          confirmLabel="Vaciar papelera" pending={emptying} onCancel={() => setConfirmEmpty(false)} onConfirm={emptyTrashNow}
        />
      )}
    </WorkspaceProvider>
  );
}
```

- [ ] **Step 9: Tipos, lint y tests**

Run: `npx tsc --noEmit`, `npm run lint`, `npx vitest run tests/core` → verde.

- [ ] **Step 10: Chequeo visual y de comportamiento**

1200 px claro y oscuro, con una cuenta nueva (registrarse con el código `dev`) para ver los vacíos: Hoy, Bandeja, Asignadas a mí (sin compartidas: sin botón; con una compartida: «Ver listas compartidas» secundario que enfoca la primera de la barra), Completadas, Papelera, Próximos 7 días, lista y etiqueta vacías — comparar con «Hoy vacío», «Bandeja vacía», «Asignadas vacío», «Completadas vacío», «Papelera vacía» (tile 44 px `--hover` radio 12, título 15/700, cuerpo 13 máx. 260 px, botón 36 px). «Agregar tarea» enfoca el campo. Cargando: con la red en «Slow 3G» (DevTools), navegar entre vistas muestra el esqueleto con pulso de 1,4 s (con movimiento reducido, sin pulso). Error: detener el servidor de desarrollo y navegar → «No pudimos cargar tus tareas» con «Probá de nuevo»; arrancarlo de nuevo y reintentar. Papelera con tareas: «Vaciar papelera» rojo en el encabezado → confirmación → la lista queda vacía. Refresco: con la app abierta, crear una tarea desde otra pestaña; al volver a la primera aparece con fundido (o a los 30 s sin cambiar de pestaña, con el foco fuera de los campos). 390 px: vacíos centrados; «Vaciar papelera» arriba de la lista. Capturas `t12-vacios-1200-{claro,oscuro}.png` (una por vista), `t12-cargando-1200-claro.png`, `t12-error-1200-claro.png`.

- [ ] **Step 11: Commit**

```bash
git add src/core/tasks.ts tests/core/tasks-trash.test.ts src/app/app/actions.ts src/components/auto-refresh.tsx src/components/app-shell.tsx src/app/app/error.tsx "src/app/app/[view]/loading.tsx" "src/app/app/list/[id]/loading.tsx" "src/app/app/tag/[name]/loading.tsx" src/components/task-workspace.tsx
git commit -m "feat(ui): estados vacíos, cargando y error del rediseño; vaciar papelera y refresco automático"
```

---

### Task 13: «Creada por IA» — `tasks.created_via` del núcleo al MCP y a la interfaz (TDD)

Diseño de referencia: supuesto «Indicador "creada por IA": chispa petróleo junto al título en la fila; en el detalle, una etiqueta "Creada por Claude" con fecha. Pide guardar `createdVia` (web / mcp:cliente)»; fila (`NotasLista`: chispa 13 px `--accent` trazo 2 al 90 %, `aria-label="Creada por IA"`), detalle (`NotasDetalle`: chip 24 px radio 6 `--selected`/`--accent` 11,5/600 con chispa 12 y `title="Creada por Claude el 10/10 a las 09:41"`), «Toast IA» (chispa `--toast-accent`, «Ver»). Formato decidido en la decisión 16.

**Files:**
- Create: `tests/core/tasks-created-via.test.ts`, `drizzle/0006_<nombre>.sql` (+ `drizzle/meta/0006_snapshot.json`, `_journal.json`) generados
- Modify: `src/db/schema.ts`, `src/core/tasks.ts`, `src/core/bearer.ts`, `src/mcp/tools.ts`, `src/mcp/server.ts`, `src/app/mcp/route.ts`, `src/app/app/actions.ts`, `src/lib/format.ts`, `src/components/task-item.tsx`, `src/components/task-detail.tsx`, `src/components/task-list.tsx`, `tests/core/bearer.test.ts`, `tests/mcp/tools-tasks.test.ts`, `tests/routes/mcp.test.ts`, `tests/lib/format.test.ts`

- [ ] **Step 1: Tests que fallan (núcleo)**

`tests/core/tasks-created-via.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { ValidationError } from '@/core/errors';
import { createTask, getTask, listTasks, updateTask } from '@/core/tasks';
import type { PublicUser as User } from '@/core/users';
import type { DB } from '@/db/types';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
let user: User;

beforeEach(async () => {
  db = await createTestDb();
  user = await createTestUser(db);
});

describe('createdVia', () => {
  it('por defecto queda en null (tareas viejas o importadas)', async () => {
    expect((await createTask(db, user.id, { title: 'A' })).createdVia).toBeNull();
  });

  it('guarda "web" o "mcp:<cliente>" y lo devuelve en las lecturas', async () => {
    const web = await createTask(db, user.id, { title: 'Web', createdVia: 'web' });
    const ai = await createTask(db, user.id, { title: 'IA', createdVia: 'mcp:Claude' });
    expect(web.createdVia).toBe('web');
    expect((await getTask(db, user.id, ai.id)).createdVia).toBe('mcp:Claude');
    expect((await listTasks(db, user.id, { view: 'inbox' })).map((t) => [t.title, t.createdVia])).toEqual([
      ['Web', 'web'], ['IA', 'mcp:Claude'],
    ]);
  });

  it('rechaza cualquier otro valor', async () => {
    for (const createdVia of ['otro', 'mcp:', 'MCP:Claude', `mcp:${'x'.repeat(200)}`, 5 as never]) {
      await expect(createTask(db, user.id, { title: 'A', createdVia })).rejects.toThrow(ValidationError);
    }
  });

  it('no cambia al editar la tarea', async () => {
    const task = await createTask(db, user.id, { title: 'A', createdVia: 'mcp:Claude' });
    expect((await updateTask(db, user.id, task.id, { title: 'B' })).createdVia).toBe('mcp:Claude');
  });
});
```

- [ ] **Step 2: Verlos fallar**

Run: `npx vitest run tests/core/tasks-created-via.test.ts`
Expected: FAIL — error de tipos/valor (`createdVia` no existe: `undefined` en vez de `null`, y los valores inválidos no lanzan).

- [ ] **Step 3: Columna y migración**

En `src/db/schema.ts`, dentro de `tasks`, después de `externalId: text('external_id'),`:

```ts
  /** Origen: 'web' (agregado rápido) o 'mcp:<cliente>' (client_name OAuth o nombre del token). NULL = anterior o importada. */
  createdVia: text('created_via'),
```

Generar la migración (no se conecta a ninguna base):

Run: `npm run db:generate`
Expected: crea `drizzle/0006_<nombre>.sql` con exactamente

```sql
ALTER TABLE "tasks" ADD COLUMN "created_via" text;
```

y actualiza `drizzle/meta/_journal.json` + `drizzle/meta/0006_snapshot.json`. Revisar el SQL: si trae cualquier otra sentencia, el esquema tenía cambios sin migrar — frenar y avisar.

- [ ] **Step 4: `createTask` en `src/core/tasks.ts`**

En `CreateTaskInput`, después de `assigneeId`:

```ts
  /** Origen de la tarea: 'web' o 'mcp:<cliente>'. Solo al crear; no se edita. */
  createdVia?: string | null;
```

En la sección «Validación», después de `checkDescription`:

```ts
const MAX_CREATED_VIA = 120;

function checkCreatedVia(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > MAX_CREATED_VIA || (value !== 'web' && !/^mcp:\S/.test(value))) {
    throw new ValidationError("Origen de la tarea inválido: usá 'web' o 'mcp:<cliente>'");
  }
  return value;
}
```

En `createTask`, junto a las otras validaciones puras (después de `const description = …`):

```ts
  const createdVia = checkCreatedVia(input.createdVia);
```

y en el `.values({ … })` del insert, agregar `createdVia,` (por ejemplo, en la línea de `externalId: input.externalId ?? null,` → `externalId: input.externalId ?? null, createdVia,`).

- [ ] **Step 5: Correr los tests del núcleo**

Run: `npx vitest run tests/core/tasks-created-via.test.ts tests/core/tasks-crud.test.ts`
Expected: PASS.

- [ ] **Step 6: Tests que fallan (MCP y ruta)**

En `tests/core/bearer.test.ts`, agregar `describeBearerClient` al import de `@/core/bearer` y:

```ts
describe('describeBearerClient', () => {
  it('token personal → su nombre; OAuth → el client_name', async () => {
    const { token } = await createApiToken(db, userId, 'Cursor');
    expect(await describeBearerClient(db, (await bearer(token))!)).toBe('Cursor');
    const { tokens } = await issueTestTokens(db, userId);
    expect(await describeBearerClient(db, (await bearer(tokens.access_token))!)).toBe('Cliente de prueba');
  });
});
```

En `tests/mcp/tools-tasks.test.ts`, agregar `import { getTask } from '@/core/tasks';` y:

```ts
describe('origen de las tareas creadas por MCP', () => {
  it('create_task guarda el cliente en created_via (sin exponerlo en la salida)', async () => {
    const task = await callOk({ ...ctx, client: 'Claude' }, 'create_task', { title: 'Desde Claude' });
    expect(Object.keys(task).sort()).toEqual(TASK_KEYS);
    expect((await getTask(db, ctx.userId, task.id)).createdVia).toBe('mcp:Claude');
  });

  it('sin nombre de cliente queda como mcp:IA', async () => {
    const task = await callOk(ctx, 'create_task', { title: 'Sin cliente' });
    expect((await getTask(db, ctx.userId, task.id)).createdVia).toBe('mcp:IA');
  });
});
```

En `tests/routes/mcp.test.ts`, dentro de `describe('/mcp: era 2025 …')`:

```ts
  it('las tareas creadas por MCP guardan el nombre del token o de la app', async () => {
    const call = await readRpc(await POST(rpcRequest(token, 1, 'tools/call', {
      name: 'create_task', arguments: { title: 'Con origen' },
    })));
    expect(call.result.isError).toBeFalsy();
    const [task] = await listTasks(db, userId, { view: 'inbox' });
    expect(task.createdVia).toBe('mcp:tests');
  });
```

(El token del `beforeEach` se llama `tests`.)

Run: `npx vitest run tests/core/bearer.test.ts tests/mcp/tools-tasks.test.ts tests/routes/mcp.test.ts`
Expected: FAIL — `describeBearerClient` no existe; `createdVia` queda `null`; `client` no es parte de `ToolContext`.

- [ ] **Step 7: `describeBearerClient` en `src/core/bearer.ts`**

Agregar los imports `import { eq } from 'drizzle-orm';`, `import { apiTokens } from '@/db/schema';` y cambiar el de oauth a `import { ACCESS_TOKEN_PREFIX, authenticateAccessToken, getClient } from './oauth';`. Al final del archivo:

```ts
/** Nombre visible de quien llama (para "Creada por …"): el client_name OAuth o el nombre del token personal. */
export async function describeBearerClient(db: DB, auth: BearerAuth): Promise<string> {
  if (auth.via === 'oauth') return (await getClient(db, auth.clientId))?.clientName ?? 'IA';
  const [row] = await db.select({ name: apiTokens.name }).from(apiTokens).where(eq(apiTokens.id, auth.tokenId));
  return row?.name ?? 'IA';
}
```

- [ ] **Step 8: Pasar el cliente al MCP**

`src/mcp/tools.ts` — `ToolContext`:

```ts
/** Con qué base y en nombre de qué usuario corre una herramienta. */
export interface ToolContext {
  db: DB;
  userId: string;
  /** Nombre visible del cliente MCP ("Claude", el nombre del token…), para `created_via`. */
  client?: string;
}

/** Valor de `created_via` para lo que crea este cliente: 'mcp:<nombre>' (o 'mcp:IA' si no se sabe). */
function createdViaFor(ctx: ToolContext): string {
  return `mcp:${(ctx.client ?? '').trim().slice(0, 100) || 'IA'}`;
}
```

y en `create_task`, agregar `createdVia: createdViaFor(ctx),` al objeto que se pasa a `createTask` (después de `assigneeId,`).

`src/mcp/server.ts` — firma y llamada:

```ts
/** Servidor MCP de un request: cada herramienta corre en nombre de `userId`; `client` es el nombre de la app. */
export function createNotasMcpServer(db: DB, userId: string, client?: string): McpServer {
```

y `(args) => callTool({ db, userId, client }, tool.name, args)`.

`src/app/mcp/route.ts` — agregar `describeBearerClient` al import de `@/core/bearer`; la factory:

```ts
const mcpHandler = createMcpHandler(async ({ authInfo }) => {
  const userId = authInfo?.extra?.userId;
  if (typeof userId !== 'string') throw new Error('Solicitud MCP sin usuario autenticado');
  const client = authInfo?.extra?.client;
  return createNotasMcpServer(await getDb(), userId, typeof client === 'string' ? client : undefined);
}, {
```

y en `handle`, reutilizar la base y agregar el nombre al `extra`:

```ts
  const db = await getDb();
  const auth = await authenticateBearer(db, token, { resource: mcpResourceUrl() });
  if (!auth) return unauthorized(request, true);
  if (!perUserLimiter.check(auth.userId)) {
    return Response.json(
      { error: 'Demasiadas solicitudes: probá en un minuto' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }
  return mcpHandler.fetch(request, {
    // El SDK no necesita el token: nunca lo pasamos para que no pueda terminar en un log.
    authInfo: {
      token: 'redacted',
      clientId: auth.via === 'oauth' ? auth.clientId : 'personal',
      scopes: [OAUTH_SCOPE],
      extra: { userId: auth.userId, client: await describeBearerClient(db, auth) },
    },
  });
```

- [ ] **Step 9: La web marca lo suyo — `src/app/app/actions.ts`**

En `quickAddAction`, agregar `createdVia: 'web',` al objeto de `createTask` (después de `tags,`).

- [ ] **Step 10: Correr los tests**

Run: `npx vitest run tests/core/bearer.test.ts tests/mcp tests/routes/mcp.test.ts tests/core/tasks-created-via.test.ts`
Expected: PASS.

- [ ] **Step 11: `createdViaClient` en `src/lib/format.ts` (TDD)**

Test (en `tests/lib/format.test.ts`, agregando `createdViaClient` al import):

```ts
describe('createdViaClient', () => {
  it('nombre del cliente MCP, o null si la creó la web o no se sabe', () => {
    expect(createdViaClient('mcp:Claude')).toBe('Claude');
    expect(createdViaClient('mcp:Script de backup')).toBe('Script de backup');
    expect(createdViaClient('web')).toBeNull();
    expect(createdViaClient(null)).toBeNull();
  });
});
```

Run: `npx vitest run tests/lib/format.test.ts` → FAIL. Implementar al final de `src/lib/format.ts`:

```ts
/** Nombre del cliente MCP que creó la tarea ("Claude"), o null si la creó la web o no se sabe. */
export function createdViaClient(createdVia: string | null): string | null {
  return createdVia?.startsWith('mcp:') ? createdVia.slice(4) : null;
}
```

Run: `npx vitest run tests/lib/format.test.ts` → PASS.

- [ ] **Step 12: Chispa en la fila — `src/components/task-item.tsx`**

Agregar `Sparkles` al import de `lucide-react` y `createdViaClient` al de `@/lib/format`. Inmediatamente después del `<span className={`truncate font-medium …`}>{task.title}</span>`:

```tsx
                {createdViaClient(task.createdVia) && (
                  <span role="img" aria-label="Creada por IA" className="inline-flex shrink-0 text-accent opacity-90">
                    <Sparkles size={13} strokeWidth={2} aria-hidden="true" />
                  </span>
                )}
```

- [ ] **Step 13: Chip en el detalle — `src/components/task-detail.tsx`**

Agregar `Sparkles` al import de `lucide-react` y `createdViaClient, formatShortDate, localTime` al de `@/lib/format`. Antes de `const header = (`:

```tsx
  const aiClient = createdViaClient(task.createdVia);
  const createdWhen = `el ${formatShortDate(task.createdAt, timezone)} a las ${localTime(task.createdAt, timezone)}`;
```

y en `header`, después de `<span className="flex-1" />`:

```tsx
      {aiClient && (
        <span
          title={`Creada por ${aiClient} ${createdWhen}`}
          className="inline-flex h-6 min-w-0 items-center gap-[5px] rounded-tag bg-selected px-2 text-[11.5px] font-semibold text-accent"
        >
          <Sparkles size={12} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
          <span className="max-w-[160px] truncate">Creada por {aiClient}</span>
          <span className="sr-only">, {createdWhen}</span>
        </span>
      )}
```

- [ ] **Step 14: Toast cuando aparece una tarea creada por la IA — `src/components/task-list.tsx`**

Agregar los imports `import { createdViaClient } from '@/lib/format';` (sumándolo al import existente de `@/lib/format`), `import { useToast } from './toast';` y `import { useWorkspace } from './workspace-context';`. Reemplazar el `useEffect` que marca los ids vistos por:

```tsx
  const toast = useToast();
  const { openTask } = useWorkspace();
  useEffect(() => {
    const fresh = tasks.filter((t) => !seen.current.has(t.id));
    for (const t of tasks) seen.current.add(t.id);
    // Una IA acaba de crear algo y la pestaña está a la vista: se avisa (lo restaurado o viejo no cuenta).
    const byAi = fresh.filter(
      (t) => createdViaClient(t.createdVia) && Date.now() - new Date(t.createdAt).getTime() < 2 * 60_000,
    );
    if (byAi.length === 0 || document.visibilityState !== 'visible') return;
    const first = byAi[0];
    const client = createdViaClient(first.createdVia)!;
    toast(byAi.length === 1
      ? { tone: 'ai', message: `${client} creó «${first.title}»`, action: { label: 'Ver', onClick: () => openTask(first.id) } }
      : { tone: 'ai', message: `${client} creó ${byAi.length} tareas` });
  }, [tasks, toast, openTask]);
```

- [ ] **Step 15: Tipos, lint y tests**

Run: `npx tsc --noEmit`, `npm run lint`, `npx vitest run` → todo verde.

- [ ] **Step 16: Chequeo visual y de comportamiento**

Con `npm run dev`: en Configuración crear un token «Claude» y, desde PowerShell, crear una tarea por MCP:

```powershell
$h = @{ Authorization = "Bearer <token>"; Accept = "application/json, text/event-stream"; "mcp-protocol-version" = "2025-06-18" }
Invoke-RestMethod -Method Post -Uri http://localhost:3000/mcp -Headers $h -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_task","arguments":{"title":"Leer artículo sobre MCP y agentes","tags":["finde"]}}}'
```

Con la Bandeja abierta en el navegador: a lo sumo en 30 s (o al volver a la pestaña) la fila entra con fundido, aparece el toast «Claude creó «Leer artículo…»» con «Ver» (abre el detalle) y la fila tiene la chispa petróleo junto al título (comparar con «Bandeja» de la pantalla 05). En el detalle: chip «Creada por Claude» (24 px, `--selected`/`--accent`) y, al pasar el mouse, «Creada por Claude el dd/mm a las HH:mm». Una tarea creada con el agregado rápido no tiene chispa. Claro y oscuro, 1200 y 390 px. Capturas `t13-fila-ia-1200-{claro,oscuro}.png`, `t13-detalle-ia-1200-claro.png`, `t13-toast-ia-1200-claro.png`.

- [ ] **Step 17: Commit**

```bash
git add src/db/schema.ts drizzle src/core/tasks.ts src/core/bearer.ts src/mcp/tools.ts src/mcp/server.ts src/app/mcp/route.ts src/app/app/actions.ts src/lib/format.ts src/components/task-item.tsx src/components/task-detail.tsx src/components/task-list.tsx tests/core/tasks-created-via.test.ts tests/core/bearer.test.ts tests/mcp/tools-tasks.test.ts tests/routes/mcp.test.ts tests/lib/format.test.ts
git commit -m "feat: indicador «Creada por IA» (tasks.created_via) en la fila, el detalle y un toast"
```

---

### Task 14: E2E, verificación final y estado del proyecto

**Files:**
- Modify: `e2e/flujo.spec.ts`, `e2e/compartir.spec.ts`, `e2e/mcp.spec.ts`, `docs/PROGRESO.md`

Solo se tocan los selectores cuyo texto o flujo cambió por el diseño; la intención de cada paso es la misma.

| Spec | Antes | Después | Por qué |
|---|---|---|---|
| `flujo` | `page.once('dialog', …)` + `getByLabel('Mandar a la papelera')` | `getByRole('button', { name: 'Mandar a la papelera' })` + toast visible | sin confirmación; el botón tiene texto (sin `aria-label`) |
| `flujo` | `getByRole('button', { name: 'Restaurar' })` | `{ name: 'Restaurar', exact: true }` | la fila de la papelera tiene «Restaurar "…"» |
| `flujo` | tras completar, navega enseguida | espera que la fila salga de Hoy | margen de 600 ms para deshacer |
| `compartir` | botón `Agregar` | `Invitar` | copy del diseño |
| `compartir` | `member.once('dialog', …)` | clic en «Salir de la lista» dentro del `alertdialog` | confirmación propia |
| `mcp` | `page.once('dialog', …)` al revocar | clic en «Revocar» dentro del `alertdialog` | confirmación propia |
| `mcp` | heading `… a tu cuenta de Notas` | `… a tus tareas de Notas` | copy del diseño |

- [ ] **Step 1: `e2e/flujo.spec.ts`**

Reemplazar:

```ts
  page.once('dialog', (d) => d.accept());
  await page.getByLabel('Mandar a la papelera').click();
  await expect(page.getByRole('link', { name: /Comprar pan/ })).toHaveCount(0);
```

por:

```ts
  // Sin confirmación: la fila sale y un toast ofrece «Deshacer».
  await page.getByRole('button', { name: 'Mandar a la papelera' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Tarea enviada a la papelera' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Comprar pan/ })).toHaveCount(0);
```

Reemplazar `await page.getByRole('button', { name: 'Restaurar' }).click();` por:

```ts
  await page.getByRole('button', { name: 'Restaurar', exact: true }).click();
```

Y reemplazar:

```ts
  // esperar a que la tarea figure completada antes de navegar (evita cortar la acción en vuelo)
  await expect(page.getByRole('checkbox', { name: /^Marcar ".*" como pendiente/ })).toBeVisible();
```

por:

```ts
  await expect(page.getByRole('checkbox', { name: /^Marcar ".*" como pendiente/ })).toBeVisible();
  // Pasado el margen de 600 ms para deshacer se guarda y la fila sale de Hoy: recién ahí se navega.
  await expect(page.getByRole('link', { name: /Comprar pan/ })).toHaveCount(0);
```

- [ ] **Step 2: `e2e/compartir.spec.ts`**

`await owner.getByRole('button', { name: 'Agregar' }).click();` → `await owner.getByRole('button', { name: 'Invitar' }).click();`

Reemplazar:

```ts
  member.once('dialog', (d) => d.accept());
  await member.getByRole('button', { name: 'Salir de la lista' }).click();
```

por:

```ts
  await member.getByRole('button', { name: 'Salir de la lista' }).click();
  await member.getByRole('alertdialog').getByRole('button', { name: 'Salir de la lista' }).click();
```

- [ ] **Step 3: `e2e/mcp.spec.ts`**

Reemplazar:

```ts
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Revocar token e2e' }).click();
```

por:

```ts
  await page.getByRole('button', { name: 'Revocar token e2e' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revocar', exact: true }).click();
```

y `'Cliente e2e quiere acceder a tu cuenta de Notas'` → `'Cliente e2e quiere acceder a tus tareas de Notas'`.

- [ ] **Step 4: Suite completa**

Run (PowerShell, en este orden):
- `npx tsc --noEmit` → sin errores
- `npm run lint` → sin errores
- `npx vitest run` → todos los tests en verde (incluidos los nuevos: theme, format, initials, quick-add, tasks-counts, tasks-trash, tasks-created-via, lists-shared, oauth-tokens, oauth-consent, bearer, tools-tasks, routes/mcp)
- `npm run build` → build OK (descarga Manrope y Geist Mono; sin warnings de tipos)
- `npm run e2e` → 4 tests en verde (flujo, compartir, 2 de mcp)

Si algo falla, usar superpowers:systematic-debugging antes de tocar código.

- [ ] **Step 5: Pasada visual final**

Con `npm run dev`, recorrer cada pantalla del diseño en 1200 px y 390 px, en claro y oscuro, y también con el tema forzado desde Configuración (Claro con el sistema en oscuro y al revés): 02 Hoy con detalle, 03 Próximos 7 días, 04 Lista compartida, 05 Bandeja / Asignadas / Completadas / Papelera, 06 Etiqueta, 08 Diálogos, 09 Configuración, 01 Login/Registro, 10 OAuth (consentimiento y error), 11 Vacíos/cargando/error/toasts, 12 Celular (Hoy, Detalle, Cajón). Revisar con teclado: Tab muestra el anillo de 2 px en todo; atajos de fila; Esc en detalle, diálogo y cajón. Con `prefers-reduced-motion: reduce`: solo fundidos. Guardar `final-<pantalla>-<ancho>-<tema>.png` en el scratchpad y anotar cualquier diferencia que quede para el usuario.

- [ ] **Step 6: `docs/PROGRESO.md`**

En la tabla «Hecho», agregar la fila:

```markdown
| 6 — Rediseño | Interfaz del rediseño de Claude Design (petróleo, Manrope + Geist Mono), tema claro/oscuro con opción manual, celular con cajón y detalle a pantalla completa, toasts con deshacer, estados vacíos/cargando/error, atajos de teclado, «Creada por IA» (`tasks.created_via`) | Hecho |
```

y en «Ideas para después» agregar: `- Registrar quién completa o modifica una tarea (\`updated_via\`) para los toasts «Claude completó…».`

- [ ] **Step 7: Commit**

```bash
git add e2e/flujo.spec.ts e2e/compartir.spec.ts e2e/mcp.spec.ts docs/PROGRESO.md
git commit -m "test(e2e): selectores del rediseño y estado del proyecto"
```

---

## Autorrevisión

### Cobertura del diseño (pantalla / componente → task)

| Elemento del handoff | Dónde | Task |
|---|---|---|
| Tokens de color claro/oscuro (tabla de 18 + scrim, avatares, toast, sombras) | `globals.css` | 1 |
| Tipografía Manrope + Geist Mono, escala display…mono, cifras tabulares | `layout.tsx`, `@theme` (`text-*`), `tabular-nums` en fechas/contadores | 1 (+ uso en 4–13) |
| Espaciado base 4, fila 48 px, gap 2, padding de columna 28, ancho 720–760 | fila, lista, columna | 5 |
| Radios 5/8/9/10/12/16/redondo (+ 6 y 7 usados en chips y píldoras) | `@theme` `--radius-*` | 1 |
| Sombras `shadow` / `shadow-lg` | `shadow-card` / `shadow-pop` | 1, 3, 4 |
| Duraciones 120/200/280, ease-out, spring, movimiento reducido | `@theme`, keyframes, `@media (prefers-reduced-motion)` | 1 |
| Keyframes `notasCheck` / `notasCheckMark` | `notas-check` / `notas-check-mark` | 1, 5 |
| Tema según sistema + opción manual en Configuración | cookie + `data-theme` + `ThemeForm` | 1, 10 |
| Barra lateral (smart views con contadores, listas, carpeta, compartidas con avatar del dueño, etiquetas, pie) | `sidebar.tsx` | 4 |
| Ítem de navegación normal/hover/activa/foco | `NavLink` + anillo global | 1, 4 |
| 02 Hoy (grupos Vencidas/Hoy, fila seleccionada, detalle abierto, agregado rápido escribiendo) | workspace, lista, fila, detalle, quick add | 5, 6, 7 |
| 03 Próximos 7 días (grupos por día, subtítulo de rango) | `groupTasksByDate`, `formatWeekRange` | 2, 5 |
| 04 Lista compartida (punto en el título, pila de avatares, «Miembros», sin nombre de lista en filas) | `task-workspace.tsx` | 5, 8, 12 |
| 05 Bandeja / Asignadas / Completadas (por día + hora) / Papelera (nota, Restaurar, Vaciar) | variantes de fila, `groupTasksByCompletedDay`, `trashNote`, `emptyTrash` | 2, 5, 12 |
| 06 Etiqueta #casa | subtítulo + placeholder | 5, 6 |
| Fila: normal · hover · seleccionada · foco · completada · vencida · en papelera | `task-item.tsx` | 5 |
| Checkbox: ninguna/baja/media/alta · hover · completada · completando · foco | `priority-checkbox.tsx` | 5 |
| Agregado rápido: reposo · foco · escribiendo con detección + chips + lista destino | `quick-add.tsx`, `quickAddHighlights` | 6 |
| Detalle (escritorio X / celular ←, lista, chip IA, título, grilla de píldoras, descripción, subtareas con barra, etiquetas, otros miembros, pie) | `task-detail.tsx`, `select-pill.tsx`, `subtask-list.tsx`, `tag-editor.tsx` | 7, 13 |
| Select de prioridad con bandera | `priority-select.tsx` (nativo, decisión 5) | 7 |
| 08 Diálogo de lista dueño / miembro (+ nueva) | `list-dialog.tsx`, `list-members.tsx`, `modal.tsx` | 3, 8 |
| Confirmación chica con botón de peligro | `confirm-dialog.tsx` | 3, 4, 8, 10, 12 |
| Botones primario / secundario / peligro / fantasma (normal y deshabilitado), foco visible | `ui.ts` + anillo global | 1 |
| Inputs reposo / foco / error / deshabilitado | `field` en `ui.ts` | 1 |
| Chips (`#casa`, `#urgente ×`, `#q4 · de…`, detección, «Creada por Claude», fechas Ayer/Hoy/Lun/20-10) | fila, detalle, quick add | 5, 6, 7, 13 |
| Avatares 20–36, iniciales, color estable, pila con «+N» | `avatar.tsx`, `initials.ts` | 2, 3, 5 |
| 09 Configuración + Conexión con IA (URL, apps, tokens, token nuevo, cerrar sesión) | `settings/page.tsx`, `ai-connection.tsx`, `timezone-form.tsx`, `logout-button.tsx` | 10 |
| 01 Login y Registro con errores | `auth-form.tsx` | 9 |
| 10 Consentimiento OAuth y error | `oauth/authorize/page.tsx`, `errorPageView` | 11 |
| 11 Estados vacíos (6), cargando, error | `empty-state.tsx`, `skeleton.tsx`, `loading.tsx`, `error.tsx` | 3, 12 |
| Toast deshacer / IA / error | `toast.tsx`, `WorkspaceProvider.trash`, `TaskList` | 3, 5, 13 |
| 12 Celular: Hoy (encabezado, agregado abajo), Detalle (pantalla completa), Cajón (300 px + scrim) | `mobile-header.tsx`, `app-shell.tsx`, workspace | 4, 5, 7 |
| Notas de interacción: completar (600 ms + salida 280 ms), abrir detalle (entrada 280 ms, Esc → foco a la fila), borrar y deshacer (6 s, pausa), agregado rápido (Enter/Esc/error), cambios de la IA (refresco 30 s y al volver, fundido, toast), teclado (↑↓ Enter Espacio Supr E 1–4 N) | workspace-context, task-item, task-detail, quick-add, auto-refresh, task-list | 5, 6, 7, 12, 13 |
| «Creada por IA» (`createdVia` web / mcp:cliente) | núcleo, MCP, ruta, fila, detalle | 13 |
| Más opciones (⋯) | no se implementa (decisión 14) | — |

### Búsqueda de placeholders

Revisado: no quedan «TBD», «TODO», «implementar después», «similar a la Task N» ni pasos sin código. Los únicos valores que el ejecutor no conoce de antemano son el sufijo aleatorio del archivo de migración de drizzle-kit (`drizzle/0006_<nombre>.sql`, con su contenido exacto indicado) y los ids/tokens que se generan durante los chequeos visuales.

### Consistencia

- **Firmas que cambian y sus llamadas:** `Avatar` (`size` numérico: Task 3 ajusta `task-item` y `list-members`); `Modal` (props nuevas opcionales); `ListDialog` (`owner`, `currentUserId`: Task 8 actualiza `sidebar` y `task-workspace`); `QuickAdd` (`placeholder`, `destination`: Task 6); `TaskDetail` (`today`, `now`, `timezone`: Task 7); `TagEditor` (`otherTags`: Task 7); `ListMembers` (`currentUserId`: Task 8); `TaskList`/`TaskItem` (Task 5, final en 13); `AiConnection` (`detail` en vez de fechas ISO: Task 10 cambia el componente y la página juntos); `createNotasMcpServer(db, userId, client?)` y `ToolContext.client?` (opcionales: los tests existentes no cambian); `CreateTaskInput.createdVia?` (opcional); `errorPageView` agrega `code`; `OAuthConnection` agrega `connectedAt` (test actualizado en la Task 10).
- **`task-workspace.tsx`** se toca en las Tasks 5, 6, 7 y 8 con cambios puntuales y la Task 12 lo reemplaza por la versión final completa (incluye todo lo anterior).
- **Nombres usados en varias tasks:** `useWorkspace` → `{ hidden, hide, unhide, trash, openTask, closeDetail, consumeEditTitle }`; `useShell` → `{ user, drawerOpen, openDrawer }`; `useToast()` → `(toast: { tone: 'trash' | 'ai' | 'error'; message; action?; duration? })`; `SAVE_ERROR`; `isEditableTarget`; `data-task-link` (foco y ↑↓); `quick-add-input` (atajo N y «Agregar tarea»); `#sidebar-shared` («Ver listas compartidas»); `[aria-modal="true"]` (Escape del cajón, del detalle y refresco).
- **Clases sin conflicto:** `btn.*` y `field` no fijan alto, padding horizontal, tamaño de letra ni (en `field`) color/peso; cada uso los agrega. Donde un botón necesita otro color de texto que su variante (p. ej. «Salir de la lista»), se escriben las clases completas.
- **E2E:** los selectores que se mantienen (labels, `aria-label`s, nombres de links con contadores `aria-hidden`, avatar del dueño sin texto accesible, `Asignada a` nativo con opciones = email cuando no hay nombre, `code[aria-label=…]`) están anotados en cada task; los que cambian están en la tabla de la Task 14.

## Riesgos y pendientes

1. **Ambigüedades que conviene confirmar con el usuario** (el plan ya decidió, pero son elecciones de producto): (a) la lista «Va a poder» del consentimiento OAuth se amplió respecto del diseño para no subestimar el alcance del scope; (b) copys del diseño que el sistema no cumplía («Últimos 30 días» en Completadas, «lo cambiado sin conexión no se perdió», «Sáb 10 → Sáb 17») se ajustaron; (c) tres tonos de avatar y `--accent-hover` oscuro inventados en la misma familia; (d) atajos 1–4 = alta…ninguna; (e) «Más opciones (⋯)» no se implementa; (f) el tema se guarda por dispositivo (cookie), no por cuenta; (g) el toast «Claude completó…» no se hace (solo «creó»), porque no se registra quién modifica.
2. **Fidelidad visual con controles nativos:** los menús de los selects son los del sistema (no el menú del diseño) y el resaltado del agregado rápido va con el mismo peso que el texto. Las píldoras de fecha/hora usan inputs nativos transparentes: escribir la fecha con el teclado no se ve mientras se tipea (el valor aparece al confirmarse).
3. **`field-sizing: content`** (título y descripción que crecen) no existe en Firefox ni en Safari viejos: ahí quedan de 1–2 líneas con scroll. `showPicker()` también es reciente; sin él queda el comportamiento nativo.
4. **Carga extra por navegación:** el layout hace dos `count(*)` más (Bandeja y Hoy) y el refresco automático re-renderiza la página cada 30 s con la pestaña visible; cada request MCP hace una consulta más (`describeBearerClient`). Para un uso personal es despreciable; si molesta, subir el intervalo o cachear el nombre del cliente.
5. **Margen de 600 ms al completar:** si se cierra la pestaña dentro de ese margen, el cambio puede no llegar (el desmontaje sí lo envía; el cierre de pestaña no está garantizado).
6. **Colores de listas existentes:** las listas creadas con la paleta vieja conservan su color y en el diálogo no aparece ninguno marcado hasta que se elija uno nuevo.
7. **Dos `h1` por vista** (celular y escritorio, uno siempre con `display: none`): correcto para lectores de pantalla, pero un test que busque «el» heading tiene que acotar al visible.
8. **Migración aditiva** (`created_via` nullable): compatible con la vuelta atrás automática de `deploy.sh`.
9. **Capturas manuales:** la comparación visual es a ojo contra los valores del HTML; conviene que el usuario mire las capturas `final-*` antes de mergear.
