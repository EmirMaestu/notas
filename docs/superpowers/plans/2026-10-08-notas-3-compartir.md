# Notas — Plan 3: Listas compartidas y asignación de tareas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el dueño de una lista pueda compartirla con otros usuarios registrados (por email), que los miembros trabajen sobre sus tareas, que las tareas se puedan asignar a una persona con acceso a la lista y que exista la vista "Asignadas a mí", sin romper el aislamiento entre usuarios.

**Architecture:** Nueva tabla `list_members` y columna `tasks.assignee_id`. Un módulo nuevo `src/core/access.ts` concentra la regla de acceso ("un usuario accede a una lista si es su dueño o miembro") como subconsultas SQL reutilizables (`accessibleListIds`, `ownedListIds`, `memberListIds`) y helpers (`getAccessibleList`, `requireListOwner`, `canAccessList`). `src/core/tasks.ts` deja de filtrar por `tasks.user_id` (que pasa a significar "creada por") y filtra siempre por `tasks.list_id IN accessibleListIds`. `src/core/lists.ts` devuelve listas con rol (`ListWithRole`) y restringe modificar/borrar al dueño. `src/core/members.ts` (nuevo) administra miembros. La web suma la sección "Compartidas conmigo", la vista "Asignadas a mí", la sección "Miembros" del diálogo de lista y el selector "Asignada a".

**Tech Stack:** Next.js 15.5 (App Router), React 19, Tailwind CSS 4, lucide-react, Drizzle ORM 0.45 + drizzle-kit 0.31, Vitest + PGlite, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-notas-design.md`, sección "Listas compartidas (agregado 2026-10-08)".

**Decisiones tomadas al planificar (resuelven ambigüedades del spec):**
- **Errores:** un usuario sin acceso a la lista recibe siempre `NotFoundError` (no se distingue "no existe" de "no es tuya"). Un **miembro** que intenta una acción de dueño recibe `ValidationError('Solo el dueño de la lista puede …')`.
- **Etiquetas en tareas compartidas:** `TaskWithDetails.tags` son **las etiquetas del usuario que consulta** (las únicas que edita) y el nuevo `TaskWithDetails.otherTags` son las de los demás usuarios, sin repetir nombres que ya están en `tags`. Motivo: el editor de etiquetas manda la lista completa al guardar; si `tags` incluyera las ajenas, al editar se crearían como etiquetas propias del usuario. En la UI se muestran ambas (spec: "se ven todas sus etiquetas").
- **Carpeta para el miembro:** `listLists`/`getList` devuelven `folderId: null` cuando el rol es `member` (la carpeta es del dueño; además no se filtra el id de su carpeta).
- **`getTaskByExternalId`** (solo para el import) sigue acotada al creador (`tasks.user_id`) **y además** exige que la tarea esté en una lista accesible, para no devolver una tarea a la que el usuario ya no accede.
- **Borrar una lista compartida:** solo el dueño. Todas sus tareas (las creó quien las creó) van a la papelera de la Bandeja del dueño; se limpian las asignaciones a cualquiera que no sea el dueño; las filas de `list_members` se borran en cascada.
- **Mover a la Bandeja:** un miembro puede mover una tarea de la lista compartida a su propia Bandeja/listas (son listas accesibles para él, como dice el spec); a partir de ahí el dueño deja de verla.
- **Vista `assigned`:** tareas pendientes (o todas con `includeCompleted`) asignadas al usuario en cualquier lista accesible, incluidas las propias. En esa vista no se muestra el agregado rápido (una tarea nueva no quedaría asignada y "desaparecería").
- **Avatar:** iniciales del nombre (dos palabras → dos iniciales; una palabra → dos letras) o, sin nombre, de las dos primeras letras del email. Se muestra en la fila cuando la tarea tiene asignado.
- **Nombres:** la función de núcleo que lista miembros se llama `getListMembers` (no `listMembers`, que chocaría con la tabla `listMembers` del schema).
- **MCP:** el servidor MCP todavía no existe en el código, así que las herramientas `share_list`, `unshare_list`, `list_members`, `leave_list`, el campo `assignee` y la vista `assigned` de `list_tasks` **quedan para el plan del MCP**. Este plan deja el núcleo listo para eso: `addListMember` recibe email, `removeListMember`, `getListMembers`, `leaveList`, `assigneeId` en create/update (el MCP resolverá email → id con `getListMembers`) y `view: 'assigned'` en `listTasks`.

**Firmas del núcleo que se agregan o cambian** (verificar contra `src/core/*.ts` al implementar):
- `access.ts` (nuevo): `type ListRole = 'owner' | 'member'`; `accessibleListIds(db,u)`, `ownedListIds(db,u)`, `memberListIds(db,u)` (subconsultas para `inArray`); `getAccessibleList(db,u,listId) → { list: List; role: ListRole }`; `requireListOwner(db,u,listId,action) → List`; `canAccessList(db,u,listId) → boolean`.
- `lists.ts`: `type ListWithRole = List & { role: ListRole; shared: boolean }`; `listLists → ListWithRole[]`; `getList → ListWithRole` (propias **o compartidas**); `updateList`/`deleteList` solo dueño.
- `members.ts` (nuevo): `interface ListMember { id; email; name; role: ListRole }`; `getListMembers(db,u,listId)`, `addListMember(db,ownerId,listId,email)`, `removeListMember(db,ownerId,listId,memberId)`, `leaveList(db,u,listId)`.
- `tasks.ts`: `TaskWithDetails = Task & { subtasks; tags; otherTags: string[]; assignee: TaskAssignee | null }`; `assigneeId?: string | null` en `CreateTaskInput`/`UpdateTaskInput`; `TaskView` suma `'assigned'`.

**Regla para componentes cliente:** importar solo módulos puros (`@/core/quick-add`, `@/core/dates`, `@/core/priority`, `@/core/tag-name`, `@/lib/format`, `@/lib/initials`) y **tipos** (`import type`) del resto. Nunca importar `@/core` (barrel) ni `@/db` desde un archivo `'use client'`.

**Tests existentes:** el único que hay que adaptar es `tests/core/schema.test.ts` (lista exacta de tablas, Task 1). El resto sigue valiendo tal cual con la nueva semántica: los casos "otro usuario → `NotFoundError`" ahora prueban "no miembro → `NotFoundError`"; `listLists` devuelve un supertipo de `List` y los tests solo miran `name`/`length`; `tags` sigue siendo la lista de etiquetas del usuario que consulta.

---

## Estructura de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src/db/schema.ts` | Modificar | + tabla `list_members`, + `tasks.assignee_id` |
| `drizzle/0003_*.sql`, `drizzle/meta/*` | Crear (generado) | Migración nueva |
| `src/core/access.ts` | Crear | Regla de acceso a listas: subconsultas y helpers de rol |
| `src/core/lists.ts` | Modificar | `ListWithRole`, `listLists` con compartidas, `getList` accesible, `updateList`/`deleteList` solo dueño |
| `src/core/members.ts` | Crear | Ver, agregar, quitar miembros y salir de una lista |
| `src/core/tasks.ts` | Modificar | Acceso por lista, etiquetas por usuario, asignación, vista `assigned` |
| `src/core/index.ts` | Modificar | Exportar `access` y `members` |
| `src/lib/initials.ts` | Crear | Iniciales para el avatar (puro) |
| `src/lib/data.ts` | Modificar | Comentario (devuelve listas con rol) |
| `src/app/app/actions.ts` | Modificar | Acciones de miembros y `assigneeId` en `updateTaskAction` |
| `src/app/app/[view]/page.tsx` | Modificar | Vista `assigned` |
| `src/components/avatar.tsx` | Crear | Círculo con iniciales |
| `src/components/list-members.tsx` | Crear | Sección "Miembros" del diálogo de lista |
| `src/components/list-dialog.tsx` | Modificar | Modo dueño (+ miembros) y modo miembro (solo lectura + salir) |
| `src/components/sidebar.tsx` | Modificar | "Asignadas a mí", "Compartidas conmigo", ícono de compartida |
| `src/components/task-page.tsx` | Modificar | Cargar miembros de la lista de la tarea seleccionada |
| `src/components/task-workspace.tsx` | Modificar | Pasar miembros; sin agregado rápido en `assigned` |
| `src/components/task-detail.tsx` | Modificar | Selector "Asignada a" y etiquetas de otros |
| `src/components/task-item.tsx` | Modificar | Avatar del asignado y etiquetas de otros |
| `tests/core/schema.test.ts` | Modificar | Tabla nueva y cascadas |
| `tests/core/access.test.ts` | Crear | Regla de acceso |
| `tests/core/lists-shared.test.ts` | Crear | Listas con rol, solo dueño modifica/borra |
| `tests/core/members.test.ts` | Crear | Miembros |
| `tests/helpers/sharing.ts` | Crear | Fixture: dueño, miembro, ajeno, lista compartida y privada |
| `tests/core/tasks-shared-access.test.ts` | Crear | Tareas en listas compartidas y aislamiento |
| `tests/core/tasks-shared-tags.test.ts` | Crear | Etiquetas por usuario en tareas compartidas |
| `tests/core/tasks-assign.test.ts` | Crear | Asignación |
| `tests/core/tasks-shared-views.test.ts` | Crear | Hoy / 7 días / Asignadas / Bandeja / Completadas / Papelera |
| `tests/lib/initials.test.ts` | Crear | Iniciales |
| `e2e/compartir.spec.ts` | Crear | Dos usuarios: compartir, crear, asignar, salir |

---

### Task 1: Esquema — `list_members` y `tasks.assignee_id`

**Files:**
- Modify: `src/db/schema.ts`, `tests/core/schema.test.ts`
- Create: migración `drizzle/0003_*.sql` (generada)

- [ ] **Step 1: Actualizar el test — reemplazar el contenido completo de `tests/core/schema.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { listMembers, lists, tasks, users } from '@/db/schema';
import { createTestDb, createTestUser } from '../helpers/db';

describe('migraciones', () => {
  it('crean todas las tablas', async () => {
    const db = await createTestDb();
    const result = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const names = (result as unknown as { rows: { table_name: string }[] }).rows.map((r) => r.table_name);
    expect(names).toEqual([
      'folders', 'list_members', 'lists', 'sessions', 'subtasks', 'tags', 'task_tags', 'tasks', 'users',
    ]);
  });

  it('permite una sola bandeja de entrada por usuario', async () => {
    const db = await createTestDb();
    const user = await createTestUser(db);
    // createUser ya crea la bandeja de entrada.
    await expect(
      db.insert(lists).values({ userId: user.id, name: 'Otra', isInbox: true }),
    ).rejects.toThrow();
    await expect(
      db.insert(lists).values({ userId: user.id, name: 'Normal', isInbox: false }),
    ).resolves.toBeDefined();
  });

  it('list_members no repite miembros; al borrar al usuario se va su membresía y su asignación queda en null', async () => {
    const db = await createTestDb();
    const owner = await createTestUser(db);
    const member = await createTestUser(db, 'miembro@example.com');
    const [list] = await db.insert(lists).values({ userId: owner.id, name: 'Compartida' }).returning();
    await db.insert(listMembers).values({ listId: list.id, userId: member.id });
    await expect(db.insert(listMembers).values({ listId: list.id, userId: member.id })).rejects.toThrow();
    const [task] = await db
      .insert(tasks)
      .values({ userId: owner.id, listId: list.id, title: 'A', assigneeId: member.id })
      .returning();
    await db.delete(users).where(eq(users.id, member.id));
    const [row] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(row.assigneeId).toBeNull();
    expect(await db.select().from(listMembers)).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/core/schema.test.ts`
Expected: FAIL — "crean todas las tablas" no encuentra `list_members` y el tercer test falla porque `listMembers` no está exportado por `@/db/schema` (`undefined`).

- [ ] **Step 3: Modificar `src/db/schema.ts`**

3a. Insertar la tabla nueva **inmediatamente después** del bloque `export const lists = pgTable(...)` (y antes de `export const tasks`):

```ts
/** Miembros de una lista compartida (el dueño es `lists.user_id` y no figura acá). */
export const listMembers = pgTable('list_members', {
  listId: uuid('list_id').notNull().references(() => lists.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.listId, t.userId] }),
  index('list_members_user_idx').on(t.userId),
]);
```

3b. Reemplazar el bloque completo `export const tasks = pgTable(...)` por:

```ts
export const tasks = pgTable('tasks', {
  id: id(),
  /** Quién creó la tarea (auditoría e import). El acceso se decide por la lista, no por esta columna. */
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  listId: uuid('list_id').notNull().references(() => lists.id, { onDelete: 'cascade' }),
  assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  dueDate: date('due_date', { mode: 'string' }),
  dueTime: text('due_time'),
  priority: integer('priority').notNull().default(0),
  status: text('status', { enum: ['pending', 'completed'] }).notNull().default('pending'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  sortOrder: integer('sort_order').notNull().default(0),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  externalId: text('external_id'),
}, (t) => [
  index('tasks_user_idx').on(t.userId),
  index('tasks_list_idx').on(t.listId),
  index('tasks_assignee_idx').on(t.assigneeId),
  uniqueIndex('tasks_user_external_idx').on(t.userId, t.externalId),
]);
```

- [ ] **Step 4: Generar la migración (no editar las anteriores)**

Run: `npm run db:generate`
Expected: nuevo `drizzle/0003_<nombre>.sql` (y `drizzle/meta/0003_snapshot.json`, `_journal.json` actualizado) con, entre otras, estas sentencias:
`CREATE TABLE "list_members" (... CONSTRAINT "list_members_list_id_user_id_pk" PRIMARY KEY("list_id","user_id"))`,
`ALTER TABLE "tasks" ADD COLUMN "assignee_id" uuid;`,
`... FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ...`,
`CREATE INDEX "list_members_user_idx" ...`, `CREATE INDEX "tasks_assignee_idx" ...`.
Si drizzle-kit pregunta algo interactivo (renombres), la respuesta es "crear" (no hay renombres).

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npx vitest run`
Expected: PASS (todos los tests).

- [ ] **Step 6: Commit**

```powershell
git add src/db/schema.ts drizzle tests/core/schema.test.ts
git commit -m "feat(db): tabla list_members y tasks.assignee_id"
```

---

### Task 2: Regla de acceso — `src/core/access.ts`

**Files:**
- Create: `src/core/access.ts`, `tests/core/access.test.ts`
- Modify: `src/core/index.ts`

- [ ] **Step 1: Escribir el test que falla — `tests/core/access.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { inArray, type SQLWrapper } from 'drizzle-orm';
import { listMembers, lists } from '@/db/schema';
import type { DB } from '@/db/types';
import {
  accessibleListIds, canAccessList, getAccessibleList, memberListIds, ownedListIds, requireListOwner,
} from '@/core/access';
import { NotFoundError, ValidationError } from '@/core/errors';
import { createList, getInbox, type List } from '@/core/lists';
import type { PublicUser as User } from '@/core/users';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
let owner: User;
let member: User;
let stranger: User;
let shared: List;

beforeEach(async () => {
  db = await createTestDb();
  owner = await createTestUser(db, 'duenio@example.com');
  member = await createTestUser(db, 'miembro@example.com');
  stranger = await createTestUser(db, 'ajeno@example.com');
  shared = await createList(db, owner.id, { name: 'Compartida' });
  await db.insert(listMembers).values({ listId: shared.id, userId: member.id });
});

/** Ids de lista que devuelve una subconsulta, ordenados. */
async function idsOf(sub: SQLWrapper): Promise<string[]> {
  const rows = await db.select({ id: lists.id }).from(lists).where(inArray(lists.id, sub));
  return rows.map((r) => r.id).sort();
}

describe('subconsultas de acceso', () => {
  it('accessibleListIds: listas propias más las compartidas conmigo', async () => {
    const memberInbox = await getInbox(db, member.id);
    const ownerInbox = await getInbox(db, owner.id);
    const strangerInbox = await getInbox(db, stranger.id);
    expect(await idsOf(accessibleListIds(db, member.id))).toEqual([memberInbox.id, shared.id].sort());
    expect(await idsOf(accessibleListIds(db, owner.id))).toEqual([ownerInbox.id, shared.id].sort());
    expect(await idsOf(accessibleListIds(db, stranger.id))).toEqual([strangerInbox.id]);
  });

  it('ownedListIds y memberListIds', async () => {
    expect(await idsOf(ownedListIds(db, member.id))).toEqual([(await getInbox(db, member.id)).id]);
    expect(await idsOf(memberListIds(db, member.id))).toEqual([shared.id]);
    expect(await idsOf(memberListIds(db, owner.id))).toEqual([]);
  });
});

describe('getAccessibleList', () => {
  it('devuelve la lista con el rol de quien consulta', async () => {
    expect(await getAccessibleList(db, owner.id, shared.id)).toMatchObject({ list: { id: shared.id }, role: 'owner' });
    expect(await getAccessibleList(db, member.id, shared.id)).toMatchObject({ list: { id: shared.id }, role: 'member' });
  });

  it('un ajeno, un id inválido o inexistente es NotFoundError', async () => {
    await expect(getAccessibleList(db, stranger.id, shared.id)).rejects.toThrow(NotFoundError);
    await expect(getAccessibleList(db, member.id, 'basura')).rejects.toThrow(NotFoundError);
    await expect(getAccessibleList(db, member.id, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(NotFoundError);
  });
});

describe('requireListOwner y canAccessList', () => {
  it('dueño ok, miembro ValidationError, ajeno NotFoundError', async () => {
    expect((await requireListOwner(db, owner.id, shared.id, 'borrarla')).id).toBe(shared.id);
    const err = await requireListOwner(db, member.id, shared.id, 'borrarla').catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe('Solo el dueño de la lista puede borrarla');
    await expect(requireListOwner(db, stranger.id, shared.id, 'borrarla')).rejects.toThrow(NotFoundError);
  });

  it('canAccessList', async () => {
    expect(await canAccessList(db, owner.id, shared.id)).toBe(true);
    expect(await canAccessList(db, member.id, shared.id)).toBe(true);
    expect(await canAccessList(db, stranger.id, shared.id)).toBe(false);
    expect(await canAccessList(db, 'basura', shared.id)).toBe(false);
    expect(await canAccessList(db, member.id, 'basura')).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/core/access.test.ts`
Expected: FAIL — no se puede resolver `@/core/access`.

- [ ] **Step 3: Implementar `src/core/access.ts`**

```ts
import { and, eq, inArray, or } from 'drizzle-orm';
import { listMembers, lists } from '@/db/schema';
import type { DB } from '@/db/types';
import { NotFoundError, ValidationError, isUuid } from './errors';
import type { List } from './lists';

/**
 * Regla de acceso de Notas: un usuario accede a una lista si es su dueño (`lists.user_id`)
 * o miembro (`list_members`). Las tareas se acceden a través de su lista.
 */
export type ListRole = 'owner' | 'member';

/** Subconsulta: ids de las listas compartidas con el usuario (donde es miembro). */
export function memberListIds(db: DB, userId: string) {
  return db.select({ id: listMembers.listId }).from(listMembers).where(eq(listMembers.userId, userId));
}

/** Subconsulta: ids de las listas propias del usuario. */
export function ownedListIds(db: DB, userId: string) {
  return db.select({ id: lists.id }).from(lists).where(eq(lists.userId, userId));
}

/** Subconsulta: ids de todas las listas a las que accede el usuario (propias + compartidas). Para `inArray`. */
export function accessibleListIds(db: DB, userId: string) {
  return db
    .select({ id: lists.id })
    .from(lists)
    .where(or(eq(lists.userId, userId), inArray(lists.id, memberListIds(db, userId))));
}

/** La lista y el rol del usuario en ella; NotFoundError si no existe o no tiene acceso (no se distingue). */
export async function getAccessibleList(
  db: DB, userId: string, listId: string,
): Promise<{ list: List; role: ListRole }> {
  if (!isUuid(listId)) throw new NotFoundError('La lista');
  const [row] = await db
    .select({ list: lists, memberId: listMembers.userId })
    .from(lists)
    .leftJoin(listMembers, and(eq(listMembers.listId, lists.id), eq(listMembers.userId, userId)))
    .where(eq(lists.id, listId));
  if (!row) throw new NotFoundError('La lista');
  if (row.list.userId === userId) return { list: row.list, role: 'owner' };
  if (row.memberId !== null) return { list: row.list, role: 'member' };
  throw new NotFoundError('La lista');
}

/** La lista si el usuario es su dueño. Un miembro recibe ValidationError; un ajeno, NotFoundError. */
export async function requireListOwner(db: DB, userId: string, listId: string, action: string): Promise<List> {
  const { list, role } = await getAccessibleList(db, userId, listId);
  if (role !== 'owner') throw new ValidationError(`Solo el dueño de la lista puede ${action}`);
  return list;
}

/** ¿El usuario es dueño o miembro de la lista? (ids inválidos → false) */
export async function canAccessList(db: DB, userId: string, listId: string): Promise<boolean> {
  if (!isUuid(userId) || !isUuid(listId)) return false;
  const [row] = await db
    .select({ id: lists.id })
    .from(lists)
    .where(and(eq(lists.id, listId), inArray(lists.id, accessibleListIds(db, userId))));
  return row !== undefined;
}
```

- [ ] **Step 4: Exportar desde el barrel** — en `src/core/index.ts`, agregar como primera línea de exports (antes de `export * from './dates';`):

```ts
export * from './access';
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npx vitest run tests/core/access.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```powershell
git add src/core/access.ts src/core/index.ts tests/core/access.test.ts
git commit -m "feat(core): regla de acceso a listas (dueño o miembro)"
```

---

### Task 3: Listas con rol; solo el dueño modifica y borra

**Files:**
- Modify: `src/core/lists.ts`, `src/lib/data.ts`
- Create: `tests/core/lists-shared.test.ts`

- [ ] **Step 1: Escribir el test que falla — `tests/core/lists-shared.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { listMembers, tasks } from '@/db/schema';
import type { DB } from '@/db/types';
import { NotFoundError, ValidationError } from '@/core/errors';
import { createFolder, createList, deleteList, getInbox, getList, listLists, updateList, type List } from '@/core/lists';
import type { PublicUser as User } from '@/core/users';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
let owner: User;
let member: User;
let stranger: User;
let shared: List;

beforeEach(async () => {
  db = await createTestDb();
  owner = await createTestUser(db, 'duenio@example.com');
  member = await createTestUser(db, 'miembro@example.com');
  stranger = await createTestUser(db, 'ajeno@example.com');
  const folder = await createFolder(db, owner.id, { name: 'Casa' });
  shared = await createList(db, owner.id, { name: 'Súper', folderId: folder.id });
  await createList(db, owner.id, { name: 'Privada' });
  await db.insert(listMembers).values({ listId: shared.id, userId: member.id });
});

describe('listLists con listas compartidas', () => {
  it('el dueño ve sus listas con rol owner y cuáles están compartidas', async () => {
    const rows = await listLists(db, owner.id);
    expect(rows.map((l) => [l.name, l.role, l.shared])).toEqual([
      ['Bandeja', 'owner', false], ['Privada', 'owner', false], ['Súper', 'owner', true],
    ]);
    expect(rows[2].folderId).toBe(shared.folderId);
  });

  it('el miembro ve la compartida después de las suyas, con rol member y sin carpeta', async () => {
    await createList(db, member.id, { name: 'Zeta' });
    const rows = await listLists(db, member.id);
    expect(rows.map((l) => [l.name, l.role, l.shared])).toEqual([
      ['Bandeja', 'owner', false], ['Zeta', 'owner', false], ['Súper', 'member', true],
    ]);
    expect(rows[2].folderId).toBeNull();
  });

  it('un ajeno no ve la lista', async () => {
    expect((await listLists(db, stranger.id)).map((l) => l.name)).toEqual(['Bandeja']);
  });
});

describe('getList', () => {
  it('el miembro accede con rol member; el ajeno no', async () => {
    expect(await getList(db, member.id, shared.id)).toMatchObject({ id: shared.id, role: 'member', shared: true, folderId: null });
    expect(await getList(db, owner.id, shared.id)).toMatchObject({ role: 'owner', shared: true, folderId: shared.folderId });
    await expect(getList(db, stranger.id, shared.id)).rejects.toThrow(NotFoundError);
  });
});

describe('solo el dueño administra la lista', () => {
  it('un miembro no puede modificarla', async () => {
    const err = await updateList(db, member.id, shared.id, { name: 'Hack' }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe('Solo el dueño de la lista puede modificarla');
    expect((await getList(db, owner.id, shared.id)).name).toBe('Súper');
  });

  it('un miembro no puede borrarla', async () => {
    const err = await deleteList(db, member.id, shared.id).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe('Solo el dueño de la lista puede borrarla');
    await expect(getList(db, owner.id, shared.id)).resolves.toBeDefined();
  });

  it('un ajeno recibe NotFoundError', async () => {
    await expect(updateList(db, stranger.id, shared.id, { name: 'Hack' })).rejects.toThrow(NotFoundError);
    await expect(deleteList(db, stranger.id, shared.id)).rejects.toThrow(NotFoundError);
  });

  it('al borrarla, todas sus tareas van a la papelera de la Bandeja del dueño y los miembros pierden acceso', async () => {
    await db.insert(tasks).values([
      { userId: owner.id, listId: shared.id, title: 'del dueño', assigneeId: owner.id },
      { userId: member.id, listId: shared.id, title: 'del miembro', assigneeId: member.id },
    ]);
    expect(await deleteList(db, owner.id, shared.id)).toEqual({ movedToTrash: 2 });
    const inbox = await getInbox(db, owner.id);
    const rows = await db.select().from(tasks);
    expect(rows.every((t) => t.listId === inbox.id && t.deletedAt !== null)).toBe(true);
    expect(rows.find((t) => t.title === 'del dueño')!.assigneeId).toBe(owner.id);
    expect(rows.find((t) => t.title === 'del miembro')!.assigneeId).toBeNull();
    await expect(getList(db, member.id, shared.id)).rejects.toThrow(NotFoundError);
    expect(await db.select().from(listMembers).where(eq(listMembers.listId, shared.id))).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/core/lists-shared.test.ts`
Expected: FAIL — `role`/`shared` son `undefined`, el miembro no ve la lista (NotFoundError en `getList`), `updateList`/`deleteList` de un miembro dan NotFoundError en vez de ValidationError y `deleteList` del dueño mueve solo 1 tarea.

- [ ] **Step 3: Modificar `src/core/lists.ts`**

3a. Reemplazar el bloque de imports y tipos del principio (líneas 1–8, desde `import { and, asc, desc, eq, isNull } ...` hasta `export type Folder = ...`) por:

```ts
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { folders, listMembers, lists, tasks } from '@/db/schema';
import type { DB } from '@/db/types';
import { getAccessibleList, requireListOwner, type ListRole } from './access';
import { NotFoundError, ValidationError, isUniqueViolation, isUuid } from './errors';
import { checkColor } from './validation';

export type List = typeof lists.$inferSelect;
export type Folder = typeof folders.$inferSelect;
/** Lista vista por un usuario: su rol y si está compartida (tiene al menos un miembro). */
export type ListWithRole = List & { role: ListRole; shared: boolean };
```

3b. Reemplazar las funciones `listLists` y `getList` completas por:

```ts
const sharedExpr = sql<boolean>`exists (select 1 from ${listMembers} where ${listMembers.listId} = ${lists.id})`;

async function isShared(db: DB, listId: string): Promise<boolean> {
  const [row] = await db
    .select({ listId: listMembers.listId })
    .from(listMembers)
    .where(eq(listMembers.listId, listId))
    .limit(1);
  return row !== undefined;
}

/** Para un miembro la carpeta es del dueño: la lista se ve suelta. */
function asSeenBy(list: List, role: ListRole, shared: boolean): ListWithRole {
  return { ...list, folderId: role === 'owner' ? list.folderId : null, role, shared };
}

/** Listas propias (Bandeja primero) y, después, las compartidas con el usuario ordenadas por nombre. */
export async function listLists(db: DB, userId: string): Promise<ListWithRole[]> {
  const own = await db
    .select({ list: lists, shared: sharedExpr })
    .from(lists)
    .where(eq(lists.userId, userId))
    .orderBy(desc(lists.isInbox), asc(lists.sortOrder), asc(lists.name));
  const sharedWithMe = await db
    .select({ list: lists })
    .from(lists)
    .innerJoin(listMembers, eq(listMembers.listId, lists.id))
    .where(eq(listMembers.userId, userId))
    .orderBy(asc(lists.name), asc(lists.id));
  return [
    ...own.map((r) => asSeenBy(r.list, 'owner', Boolean(r.shared))),
    ...sharedWithMe.map((r) => asSeenBy(r.list, 'member', true)),
  ];
}

/** Lista a la que el usuario accede (propia o compartida con él); NotFoundError si no. */
export async function getList(db: DB, userId: string, listId: string): Promise<ListWithRole> {
  const { list, role } = await getAccessibleList(db, userId, listId);
  return asSeenBy(list, role, role === 'member' || (await isShared(db, list.id)));
}
```

3c. En `updateList`, reemplazar la primera línea del cuerpo
`const list = await getList(db, userId, listId);`
por
`const list = await requireListOwner(db, userId, listId, 'modificarla');`
(el resto de la función queda igual).

3d. Reemplazar la función `deleteList` completa (incluido su comentario) por:

```ts
/**
 * Borra la lista (solo el dueño). Todas sus tareas, las haya creado quien sea, pasan a la papelera
 * dentro de la Bandeja del dueño para poder restaurarlas; como la Bandeja es privada, se limpian
 * las asignaciones a otras personas. Las membresías se borran en cascada.
 */
export async function deleteList(db: DB, userId: string, listId: string): Promise<{ movedToTrash: number }> {
  if (!isUuid(listId)) throw new NotFoundError('La lista');
  return db.transaction(async (tx) => {
    const list = await requireListOwner(tx, userId, listId, 'borrarla');
    // Bloquea la fila mientras se mueven las tareas.
    await tx.select({ id: lists.id }).from(lists).where(eq(lists.id, list.id)).for('update');
    if (list.isInbox) throw new ValidationError('La Bandeja no se puede borrar');
    const inbox = await getInbox(tx, userId);
    const now = new Date();
    await tx
      .update(tasks)
      .set({ assigneeId: null })
      .where(and(eq(tasks.listId, list.id), ne(tasks.assigneeId, userId)));
    const trashed = await tx
      .update(tasks)
      .set({ deletedAt: now, updatedAt: now, listId: inbox.id })
      .where(and(eq(tasks.listId, list.id), isNull(tasks.deletedAt)))
      .returning({ id: tasks.id });
    await tx.update(tasks).set({ listId: inbox.id }).where(eq(tasks.listId, list.id));
    await tx.delete(lists).where(eq(lists.id, list.id));
    return { movedToTrash: trashed.length };
  });
}
```

- [ ] **Step 4: Actualizar el comentario de `src/lib/data.ts`** — reemplazar la línea
`/** Listas del usuario, memoizadas por request: el layout y la página las piden y solo se consulta una vez. */`
por
`/** Listas del usuario (propias y compartidas con él, con su rol), memoizadas por request: el layout y la página las piden y solo se consulta una vez. */`

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npx vitest run`
Expected: PASS (incluidos `tests/core/lists.test.ts` y `tests/core/lists-shared.test.ts`).

Run: `npx tsc --noEmit`
Expected: sin errores (`ListWithRole` es asignable a `List`, así que los componentes siguen compilando).

- [ ] **Step 6: Commit**

```powershell
git add src/core/lists.ts src/lib/data.ts tests/core/lists-shared.test.ts
git commit -m "feat(core): listas compartidas con rol; solo el dueño modifica o borra"
```

---

### Task 4: Miembros — `src/core/members.ts`

**Files:**
- Create: `src/core/members.ts`, `tests/core/members.test.ts`, `tests/helpers/sharing.ts`
- Modify: `src/core/index.ts`

- [ ] **Step 1: Escribir el test que falla — `tests/core/members.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { tasks } from '@/db/schema';
import type { DB } from '@/db/types';
import { canAccessList } from '@/core/access';
import { NotFoundError, ValidationError } from '@/core/errors';
import { createList, getInbox, type List } from '@/core/lists';
import { addListMember, getListMembers, leaveList, removeListMember } from '@/core/members';
import type { PublicUser as User } from '@/core/users';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
let owner: User;
let member: User;
let stranger: User;
let shared: List;
let other: List;

beforeEach(async () => {
  db = await createTestDb();
  owner = await createTestUser(db, 'duenio@example.com');
  member = await createTestUser(db, 'miembro@example.com');
  stranger = await createTestUser(db, 'ajeno@example.com');
  shared = await createList(db, owner.id, { name: 'Compartida' });
  other = await createList(db, owner.id, { name: 'Otra' });
});

/** El error con que se rechaza la promesa (o null si se resuelve). */
const errorOf = (p: Promise<unknown>) => p.then(() => null, (e) => e);

describe('addListMember', () => {
  it('agrega por email (sin importar mayúsculas ni espacios) y devuelve el miembro', async () => {
    const added = await addListMember(db, owner.id, shared.id, '  MIEMBRO@Example.com ');
    expect(added).toEqual({ id: member.id, email: 'miembro@example.com', name: 'Emir', role: 'member' });
    expect(await canAccessList(db, member.id, shared.id)).toBe(true);
  });

  it('rechaza emails sin cuenta, al propio dueño, duplicados, vacíos y la Bandeja', async () => {
    expect((await errorOf(addListMember(db, owner.id, shared.id, 'nadie@example.com'))).message)
      .toBe('No hay ninguna cuenta con ese email');
    expect((await errorOf(addListMember(db, owner.id, shared.id, 'duenio@example.com'))).message)
      .toBe('Ya sos el dueño de esta lista');
    await addListMember(db, owner.id, shared.id, member.email);
    expect((await errorOf(addListMember(db, owner.id, shared.id, member.email))).message)
      .toBe('Esa persona ya es miembro de la lista');
    const inbox = await getInbox(db, owner.id);
    expect((await errorOf(addListMember(db, owner.id, inbox.id, member.email))).message)
      .toBe('La Bandeja no se puede compartir');
    expect(await errorOf(addListMember(db, owner.id, shared.id, '  '))).toBeInstanceOf(ValidationError);
  });

  it('un miembro no puede agregar (ValidationError) y un ajeno no ve la lista (NotFoundError)', async () => {
    await addListMember(db, owner.id, shared.id, member.email);
    const err = await errorOf(addListMember(db, member.id, shared.id, stranger.email));
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe('Solo el dueño de la lista puede administrar sus miembros');
    expect(await errorOf(addListMember(db, stranger.id, shared.id, stranger.email))).toBeInstanceOf(NotFoundError);
    expect(await canAccessList(db, stranger.id, shared.id)).toBe(false);
  });
});

describe('getListMembers', () => {
  it('dueño primero y después los miembros por orden de alta; lo ven el dueño y los miembros', async () => {
    const third = await createTestUser(db, 'tercero@example.com');
    await addListMember(db, owner.id, shared.id, member.email);
    await addListMember(db, owner.id, shared.id, third.email);
    const expected = [
      { id: owner.id, email: 'duenio@example.com', name: 'Emir', role: 'owner' },
      { id: member.id, email: 'miembro@example.com', name: 'Emir', role: 'member' },
      { id: third.id, email: 'tercero@example.com', name: 'Emir', role: 'member' },
    ];
    expect(await getListMembers(db, owner.id, shared.id)).toEqual(expected);
    expect(await getListMembers(db, member.id, shared.id)).toEqual(expected);
    await expect(getListMembers(db, stranger.id, shared.id)).rejects.toThrow(NotFoundError);
  });

  it('una lista sin miembros devuelve solo al dueño', async () => {
    expect((await getListMembers(db, owner.id, other.id)).map((m) => m.role)).toEqual(['owner']);
  });
});

describe('removeListMember', () => {
  it('quita el acceso y limpia solo sus asignaciones en esa lista', async () => {
    await addListMember(db, owner.id, shared.id, member.email);
    await addListMember(db, owner.id, other.id, member.email);
    const [inShared, inOther, ownerTask] = await db
      .insert(tasks)
      .values([
        { userId: owner.id, listId: shared.id, title: 'a', assigneeId: member.id },
        { userId: owner.id, listId: other.id, title: 'b', assigneeId: member.id },
        { userId: owner.id, listId: shared.id, title: 'c', assigneeId: owner.id },
      ])
      .returning();
    await removeListMember(db, owner.id, shared.id, member.id);
    expect(await canAccessList(db, member.id, shared.id)).toBe(false);
    const assigneeOf = async (id: string) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0].assigneeId;
    expect(await assigneeOf(inShared.id)).toBeNull();
    expect(await assigneeOf(inOther.id)).toBe(member.id);
    expect(await assigneeOf(ownerTask.id)).toBe(owner.id);
  });

  it('solo el dueño quita miembros; quitar a quien no es miembro es NotFoundError', async () => {
    await addListMember(db, owner.id, shared.id, member.email);
    expect(await errorOf(removeListMember(db, member.id, shared.id, member.id))).toBeInstanceOf(ValidationError);
    expect(await errorOf(removeListMember(db, stranger.id, shared.id, member.id))).toBeInstanceOf(NotFoundError);
    expect(await errorOf(removeListMember(db, owner.id, shared.id, stranger.id))).toBeInstanceOf(NotFoundError);
    expect(await errorOf(removeListMember(db, owner.id, shared.id, owner.id))).toBeInstanceOf(NotFoundError);
    expect(await errorOf(removeListMember(db, owner.id, shared.id, 'basura'))).toBeInstanceOf(NotFoundError);
    expect(await canAccessList(db, member.id, shared.id)).toBe(true);
  });
});

describe('leaveList', () => {
  it('el miembro sale, pierde el acceso y se limpian sus asignaciones', async () => {
    await addListMember(db, owner.id, shared.id, member.email);
    const [t] = await db
      .insert(tasks)
      .values({ userId: owner.id, listId: shared.id, title: 'a', assigneeId: member.id })
      .returning();
    await leaveList(db, member.id, shared.id);
    expect(await canAccessList(db, member.id, shared.id)).toBe(false);
    expect((await db.select().from(tasks).where(eq(tasks.id, t.id)))[0].assigneeId).toBeNull();
    expect(await errorOf(leaveList(db, member.id, shared.id))).toBeInstanceOf(NotFoundError);
  });

  it('el dueño no puede salir y un ajeno recibe NotFoundError', async () => {
    const err = await errorOf(leaveList(db, owner.id, shared.id));
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe('El dueño no puede salir de su propia lista');
    expect(await errorOf(leaveList(db, stranger.id, shared.id))).toBeInstanceOf(NotFoundError);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/core/members.test.ts`
Expected: FAIL — no se puede resolver `@/core/members`.

- [ ] **Step 3: Implementar `src/core/members.ts`**

```ts
import { and, asc, eq } from 'drizzle-orm';
import { listMembers, tasks, users } from '@/db/schema';
import type { DB } from '@/db/types';
import { getAccessibleList, requireListOwner, type ListRole } from './access';
import { NotFoundError, ValidationError, isUuid } from './errors';

/** Persona con acceso a una lista (sin datos sensibles). */
export interface ListMember {
  id: string;
  email: string;
  name: string;
  role: ListRole;
}

const MANAGE = 'administrar sus miembros';
const personColumns = { id: users.id, email: users.email, name: users.name };

/** Dueño primero y después los miembros por orden de alta. Lo pueden ver el dueño y los miembros. */
export async function getListMembers(db: DB, userId: string, listId: string): Promise<ListMember[]> {
  const { list } = await getAccessibleList(db, userId, listId);
  const [owner] = await db.select(personColumns).from(users).where(eq(users.id, list.userId));
  const members = await db
    .select(personColumns)
    .from(listMembers)
    .innerJoin(users, eq(users.id, listMembers.userId))
    .where(eq(listMembers.listId, list.id))
    .orderBy(asc(listMembers.addedAt), asc(users.email));
  return [
    { ...owner, role: 'owner' as const },
    ...members.map((m) => ({ ...m, role: 'member' as const })),
  ];
}

/** El dueño agrega a un usuario ya registrado, por email. La Bandeja no se comparte. */
export async function addListMember(db: DB, ownerId: string, listId: string, email: string): Promise<ListMember> {
  // Primero el permiso: así nadie que no sea el dueño puede averiguar qué emails tienen cuenta.
  const list = await requireListOwner(db, ownerId, listId, MANAGE);
  if (list.isInbox) throw new ValidationError('La Bandeja no se puede compartir');
  if (typeof email !== 'string') throw new ValidationError('Email inválido');
  const clean = email.trim().toLowerCase();
  if (!clean) throw new ValidationError('Ingresá el email de la persona');
  const [user] = await db.select(personColumns).from(users).where(eq(users.email, clean));
  if (!user) throw new ValidationError('No hay ninguna cuenta con ese email');
  if (user.id === ownerId) throw new ValidationError('Ya sos el dueño de esta lista');
  const inserted = await db
    .insert(listMembers)
    .values({ listId: list.id, userId: user.id })
    .onConflictDoNothing()
    .returning({ userId: listMembers.userId });
  if (inserted.length === 0) throw new ValidationError('Esa persona ya es miembro de la lista');
  return { ...user, role: 'member' };
}

/** Quita la membresía y las asignaciones de esa persona en la lista. NotFoundError si no era miembro. */
async function dropMembership(db: DB, listId: string, userId: string): Promise<void> {
  const removed = await db
    .delete(listMembers)
    .where(and(eq(listMembers.listId, listId), eq(listMembers.userId, userId)))
    .returning({ userId: listMembers.userId });
  if (removed.length === 0) throw new NotFoundError('El miembro');
  await db
    .update(tasks)
    .set({ assigneeId: null, updatedAt: new Date() })
    .where(and(eq(tasks.listId, listId), eq(tasks.assigneeId, userId)));
}

export async function removeListMember(db: DB, ownerId: string, listId: string, memberId: string): Promise<void> {
  return db.transaction(async (tx) => {
    const list = await requireListOwner(tx, ownerId, listId, MANAGE);
    if (!isUuid(memberId)) throw new NotFoundError('El miembro');
    await dropMembership(tx, list.id, memberId);
  });
}

/** Un miembro deja la lista (el dueño no puede). */
export async function leaveList(db: DB, userId: string, listId: string): Promise<void> {
  return db.transaction(async (tx) => {
    const { list, role } = await getAccessibleList(tx, userId, listId);
    if (role === 'owner') throw new ValidationError('El dueño no puede salir de su propia lista');
    await dropMembership(tx, list.id, userId);
  });
}
```

- [ ] **Step 4: Exportar desde el barrel** — en `src/core/index.ts`, agregar después de `export * from './lists';`:

```ts
export * from './members';
```

- [ ] **Step 5: Crear el fixture para los tests de tareas — `tests/helpers/sharing.ts`**

```ts
import { createList } from '@/core/lists';
import { addListMember } from '@/core/members';
import type { DB } from '@/db/types';
import { createTestUser } from './db';

/**
 * Dueño con una lista "Compartida" (con un miembro) y una "Privada", más un usuario ajeno.
 * Todos se llaman "Emir" (createTestUser); los emails los distinguen.
 */
export async function createSharingFixture(db: DB) {
  const owner = await createTestUser(db, 'duenio@example.com');
  const member = await createTestUser(db, 'miembro@example.com');
  const stranger = await createTestUser(db, 'ajeno@example.com');
  const shared = await createList(db, owner.id, { name: 'Compartida' });
  const ownerPrivate = await createList(db, owner.id, { name: 'Privada' });
  await addListMember(db, owner.id, shared.id, member.email);
  return { owner, member, stranger, shared, ownerPrivate };
}
```

- [ ] **Step 6: Correr y verificar que pasa**

Run: `npx vitest run`
Expected: PASS (incluido `tests/core/members.test.ts`, 9 tests).

- [ ] **Step 7: Commit**

```powershell
git add src/core/members.ts src/core/index.ts tests/core/members.test.ts tests/helpers/sharing.ts
git commit -m "feat(core): agregar, quitar y listar miembros; salir de una lista"
```

---

### Task 5: Tareas — acceso por lista en vez de por `tasks.user_id`

**Files:**
- Modify: `src/core/tasks.ts`
- Create: `tests/core/tasks-shared-access.test.ts`

- [ ] **Step 1: Escribir el test que falla — `tests/core/tasks-shared-access.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '@/db/types';
import { NotFoundError } from '@/core/errors';
import { getInbox, type List } from '@/core/lists';
import { leaveList, removeListMember } from '@/core/members';
import {
  addSubtask, completeTask, createTask, deleteSubtask, deleteTask, getTask, getTaskByExternalId, listTasks, moveTask,
  restoreTask, searchTasks, setSubtaskDone, uncompleteTask, updateSubtask, updateTask,
} from '@/core/tasks';
import type { PublicUser as User } from '@/core/users';
import { createTestDb } from '../helpers/db';
import { createSharingFixture } from '../helpers/sharing';

let db: DB;
let owner: User;
let member: User;
let stranger: User;
let shared: List;
let ownerPrivate: List;

beforeEach(async () => {
  db = await createTestDb();
  ({ owner, member, stranger, shared, ownerPrivate } = await createSharingFixture(db));
});

const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();

describe('el miembro trabaja sobre las tareas de la lista compartida', () => {
  it('ve, crea, edita, completa, borra y restaura', async () => {
    const t = await createTask(db, owner.id, { title: 'Del dueño', listId: shared.id });
    expect((await getTask(db, member.id, t.id)).title).toBe('Del dueño');
    const mine = await createTask(db, member.id, { title: 'Del miembro', listId: shared.id });
    expect(mine.userId).toBe(member.id); // user_id = "creada por"
    expect((await getTask(db, owner.id, mine.id)).title).toBe('Del miembro');
    expect((await updateTask(db, member.id, t.id, { title: 'Editada' })).title).toBe('Editada');
    expect((await completeTask(db, member.id, t.id)).status).toBe('completed');
    expect((await uncompleteTask(db, member.id, t.id)).status).toBe('pending');
    await deleteTask(db, member.id, t.id);
    await expect(getTask(db, owner.id, t.id)).rejects.toThrow(NotFoundError);
    expect((await restoreTask(db, member.id, t.id)).deletedAt).toBeNull();
  });

  it('administra subtareas', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id, subtasks: ['uno'] });
    const sid = t.subtasks[0].id;
    expect((await addSubtask(db, member.id, t.id, 'dos')).subtasks).toHaveLength(2);
    expect((await updateSubtask(db, member.id, sid, { title: 'uno bis' })).subtasks[0].title).toBe('uno bis');
    expect((await setSubtaskDone(db, member.id, sid, true)).subtasks[0].done).toBe(true);
    expect((await deleteSubtask(db, member.id, sid)).subtasks.map((s) => s.title)).toEqual(['dos']);
  });

  it('listTasks y searchTasks incluyen las tareas de la lista compartida', async () => {
    await createTask(db, owner.id, { title: 'Leche', listId: shared.id });
    await createTask(db, member.id, { title: 'Pan' });
    expect(titles(await listTasks(db, member.id, { listId: shared.id }))).toEqual(['Leche']);
    expect(titles(await listTasks(db, member.id))).toEqual(['Leche', 'Pan']);
    expect(titles(await searchTasks(db, member.id, 'leche'))).toEqual(['Leche']);
  });

  it('mueve solo entre listas a las que tiene acceso', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id });
    const memberInbox = await getInbox(db, member.id);
    await expect(moveTask(db, member.id, t.id, ownerPrivate.id)).rejects.toThrow(NotFoundError);
    expect((await moveTask(db, member.id, t.id, memberInbox.id)).listId).toBe(memberInbox.id);
    // Ahora está en la Bandeja (privada) del miembro: el dueño deja de verla.
    await expect(getTask(db, owner.id, t.id)).rejects.toThrow(NotFoundError);
  });
});

describe('aislamiento', () => {
  it('un ajeno no accede a nada de la lista compartida', async () => {
    const t = await createTask(db, owner.id, { title: 'Secreta', listId: shared.id, subtasks: ['s'] });
    const sid = t.subtasks[0].id;
    const strangerInbox = await getInbox(db, stranger.id);
    const attempts = [
      () => getTask(db, stranger.id, t.id),
      () => getTask(db, stranger.id, t.id, { includeDeleted: true }),
      () => updateTask(db, stranger.id, t.id, { title: 'Hack' }),
      () => completeTask(db, stranger.id, t.id),
      () => uncompleteTask(db, stranger.id, t.id),
      () => deleteTask(db, stranger.id, t.id),
      () => restoreTask(db, stranger.id, t.id),
      () => moveTask(db, stranger.id, t.id, shared.id),
      () => moveTask(db, stranger.id, t.id, strangerInbox.id),
      () => addSubtask(db, stranger.id, t.id, 'x'),
      () => updateSubtask(db, stranger.id, sid, { title: 'x' }),
      () => deleteSubtask(db, stranger.id, sid),
      () => createTask(db, stranger.id, { title: 'x', listId: shared.id }),
      () => listTasks(db, stranger.id, { listId: shared.id }),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toThrow(NotFoundError);
    }
    expect(await listTasks(db, stranger.id)).toEqual([]);
    expect(await searchTasks(db, stranger.id, 'Secreta')).toEqual([]);
    expect((await getTask(db, owner.id, t.id)).title).toBe('Secreta');
  });

  it('la Bandeja del dueño sigue siendo privada', async () => {
    const t = await createTask(db, owner.id, { title: 'Privada' });
    await expect(getTask(db, member.id, t.id)).rejects.toThrow(NotFoundError);
    expect(await listTasks(db, member.id)).toEqual([]);
  });

  it('al salir de la lista se pierde el acceso', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id });
    await leaveList(db, member.id, shared.id);
    await expect(getTask(db, member.id, t.id)).rejects.toThrow(NotFoundError);
    expect(await listTasks(db, member.id)).toEqual([]);
  });

  it('al ser quitado de la lista se pierde el acceso', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id });
    await removeListMember(db, owner.id, shared.id, member.id);
    await expect(updateTask(db, member.id, t.id, { title: 'x' })).rejects.toThrow(NotFoundError);
    expect(await searchTasks(db, member.id, 'A')).toEqual([]);
  });

  it('getTaskByExternalId busca solo entre las creadas por el usuario y accesibles', async () => {
    await createTask(db, member.id, { title: 'Importada', listId: shared.id, externalId: 'tt-1' });
    expect((await getTaskByExternalId(db, member.id, 'tt-1'))?.title).toBe('Importada');
    expect(await getTaskByExternalId(db, owner.id, 'tt-1')).toBeNull();
    await leaveList(db, member.id, shared.id);
    expect(await getTaskByExternalId(db, member.id, 'tt-1')).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/core/tasks-shared-access.test.ts`
Expected: FAIL — `getTask(member, …)` de una tarea del dueño da NotFoundError (todavía se filtra por `tasks.user_id`), `listTasks`/`searchTasks` del miembro no traen "Leche", y `getTaskByExternalId` sigue encontrando la tarea después de salir.

- [ ] **Step 3: Modificar `src/core/tasks.ts`**

3a. Agregar el import (como primer import relativo, antes de `import { addDays, ... } from './dates';`):

```ts
import { accessibleListIds } from './access';
```

3b. Reemplazar la función `findTask` completa por:

```ts
async function findTask(
  db: DB, userId: string, taskId: string, opts: { includeDeleted?: boolean; forUpdate?: boolean } = {},
): Promise<Task> {
  if (!isUuid(taskId)) throw new NotFoundError('La tarea');
  // El acceso se decide por la lista (dueño o miembro); `tasks.user_id` es solo "creada por".
  const conditions = [eq(tasks.id, taskId), inArray(tasks.listId, accessibleListIds(db, userId))];
  if (!opts.includeDeleted) conditions.push(isNull(tasks.deletedAt));
  const query = db.select().from(tasks).where(and(...conditions));
  const [task] = await (opts.forUpdate ? query.for('update') : query);
  if (!task) throw new NotFoundError('La tarea');
  return task;
}
```

3c. Reemplazar la función `getTaskByExternalId` completa (incluido su comentario) por:

```ts
/**
 * Busca una tarea (no borrada) por el id que tenía en el sistema de origen (importación idempotente).
 * Solo entre las creadas por el usuario que además sigan en una lista a la que accede.
 */
export async function getTaskByExternalId(db: DB, userId: string, externalId: string): Promise<TaskWithDetails | null> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(
      eq(tasks.userId, userId),
      eq(tasks.externalId, externalId),
      isNull(tasks.deletedAt),
      inArray(tasks.listId, accessibleListIds(db, userId)),
    ));
  if (!row) return null;
  return (await hydrate(db, [row]))[0];
}
```

3d. Reemplazar la función `findSubtask` completa (incluido su comentario) por:

```ts
/** Subtarea de una tarea (no borrada) a la que el usuario accede, o NotFoundError. */
async function findSubtask(db: DB, userId: string, subtaskId: string): Promise<Subtask> {
  if (!isUuid(subtaskId)) throw new NotFoundError('La subtarea');
  const [row] = await db
    .select({ subtask: subtasks })
    .from(subtasks)
    .innerJoin(tasks, eq(tasks.id, subtasks.taskId))
    .where(and(
      eq(subtasks.id, subtaskId),
      inArray(tasks.listId, accessibleListIds(db, userId)),
      isNull(tasks.deletedAt),
    ));
  if (!row) throw new NotFoundError('La subtarea');
  return row.subtask;
}
```

3e. En `listTasks`, reemplazar la línea
`const conditions: SQL[] = [eq(tasks.userId, userId)];`
por
`const conditions: SQL[] = [inArray(tasks.listId, accessibleListIds(db, userId))];`

3f. En `searchTasks`, dentro del array `conditions`, reemplazar la línea
`eq(tasks.userId, userId),`
por
`inArray(tasks.listId, accessibleListIds(db, userId)),`

(`createTask` y `moveTask` ya usan `getList`, que desde la Task 3 acepta listas compartidas.)

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run`
Expected: PASS (todos; los tests viejos de aislamiento entre usuarios siguen dando NotFoundError porque esos usuarios no son miembros).

- [ ] **Step 5: Commit**

```powershell
git add src/core/tasks.ts tests/core/tasks-shared-access.test.ts
git commit -m "feat(core): acceso a tareas por lista accesible (dueño o miembro)"
```

---

### Task 6: Etiquetas por usuario en tareas compartidas

**Files:**
- Modify: `src/core/tasks.ts`
- Create: `tests/core/tasks-shared-tags.test.ts`

- [ ] **Step 1: Escribir el test que falla — `tests/core/tasks-shared-tags.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '@/db/types';
import type { List } from '@/core/lists';
import { listTags } from '@/core/tags';
import { createTask, getTask, listTasks, updateTask } from '@/core/tasks';
import type { PublicUser as User } from '@/core/users';
import { createTestDb } from '../helpers/db';
import { createSharingFixture } from '../helpers/sharing';

let db: DB;
let owner: User;
let member: User;
let stranger: User;
let shared: List;

beforeEach(async () => {
  db = await createTestDb();
  ({ owner, member, stranger, shared } = await createSharingFixture(db));
});

const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();

describe('etiquetas en tareas compartidas', () => {
  it('cada uno ve las suyas en `tags` y las de los demás en `otherTags` (sin repetir)', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id, tags: ['casa', 'urgente'] });
    const seenByMember = await updateTask(db, member.id, t.id, { tags: ['mia', 'casa'] });
    expect(seenByMember.tags).toEqual(['casa', 'mia']);
    expect(seenByMember.otherTags).toEqual(['urgente']); // 'casa' ya es propia: no se repite
    const seenByOwner = await getTask(db, owner.id, t.id);
    expect(seenByOwner.tags).toEqual(['casa', 'urgente']);
    expect(seenByOwner.otherTags).toEqual(['mia']);
  });

  it('una tarea sin etiquetas de otros tiene otherTags vacío', async () => {
    expect((await createTask(db, owner.id, { title: 'A', tags: ['x'] })).otherTags).toEqual([]);
  });

  it('editar etiquetas no borra las de otros usuarios', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id, tags: ['casa'] });
    await updateTask(db, member.id, t.id, { tags: ['mia'] });
    await updateTask(db, member.id, t.id, { tags: [] });
    expect((await getTask(db, owner.id, t.id)).tags).toEqual(['casa']);
    expect((await getTask(db, member.id, t.id)).tags).toEqual([]);
  });

  it('la vista por etiqueta usa solo las etiquetas propias, sobre las tareas accesibles', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id, tags: ['casa'] });
    await createTask(db, stranger.id, { title: 'Ajena', tags: ['casa'] });
    expect(await listTasks(db, member.id, { tag: 'casa' })).toEqual([]);
    await updateTask(db, member.id, t.id, { tags: ['casa'] });
    expect(titles(await listTasks(db, member.id, { tag: 'casa' }))).toEqual(['A']);
    expect(titles(await listTasks(db, owner.id, { tag: 'casa' }))).toEqual(['A']);
  });

  it('las etiquetas de otros no aparecen en la barra lateral (listTags)', async () => {
    await createTask(db, owner.id, { title: 'A', listId: shared.id, tags: ['urgente'] });
    expect(await listTags(db, member.id)).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/core/tasks-shared-tags.test.ts`
Expected: FAIL — `otherTags` es `undefined`, `tags` mezcla las de todos los usuarios, y la edición del miembro borra las etiquetas del dueño.

- [ ] **Step 3: Modificar `src/core/tasks.ts`**

3a. Reemplazar la línea
`export type TaskWithDetails = Task & { subtasks: Subtask[]; tags: string[] };`
por:

```ts
export type TaskWithDetails = Task & {
  subtasks: Subtask[];
  /** Etiquetas del usuario que consulta (las únicas que puede editar). */
  tags: string[];
  /** Etiquetas que pusieron otros usuarios con acceso a la tarea, sin repetir nombres de `tags`. */
  otherTags: string[];
};
```

3b. Reemplazar la función `hydrate` completa por:

```ts
async function hydrate(db: DB, viewerId: string, rows: Task[]): Promise<TaskWithDetails[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const subs = await db.select().from(subtasks).where(inArray(subtasks.taskId, ids)).orderBy(asc(subtasks.sortOrder));
  const tagRows = await db
    .select({ taskId: taskTags.taskId, name: tags.name, ownerId: tags.userId })
    .from(taskTags)
    .innerJoin(tags, eq(tags.id, taskTags.tagId))
    .where(inArray(taskTags.taskId, ids))
    .orderBy(asc(tags.name));
  return rows.map((row) => {
    const onTask = tagRows.filter((t) => t.taskId === row.id);
    const own = onTask.filter((t) => t.ownerId === viewerId).map((t) => t.name);
    const others = onTask.filter((t) => t.ownerId !== viewerId && !own.includes(t.name)).map((t) => t.name);
    return {
      ...row,
      subtasks: subs.filter((s) => s.taskId === row.id),
      tags: own,
      otherTags: [...new Set(others)],
    };
  });
}
```

3c. Reemplazar la función `getTask` completa por:

```ts
export async function getTask(
  db: DB, userId: string, taskId: string, opts: { includeDeleted?: boolean } = {},
): Promise<TaskWithDetails> {
  const [task] = await hydrate(db, userId, [await findTask(db, userId, taskId, opts)]);
  return task;
}
```

3d. En `getTaskByExternalId`, reemplazar la última línea
`return (await hydrate(db, [row]))[0];`
por
`return (await hydrate(db, userId, [row]))[0];`

3e. En `listTasks` y en `searchTasks`, reemplazar la última línea
`return hydrate(db, rows);`
por
`return hydrate(db, userId, rows);`

3f. Reemplazar la función `replaceTags` completa por:

```ts
/** Reemplaza las etiquetas del usuario en la tarea; las que pusieron otros usuarios no se tocan. */
async function replaceTags(db: DB, userId: string, taskId: string, names: string[]): Promise<void> {
  await db.delete(taskTags).where(and(
    eq(taskTags.taskId, taskId),
    inArray(taskTags.tagId, db.select({ id: tags.id }).from(tags).where(eq(tags.userId, userId))),
  ));
  const tagRows = await ensureTags(db, userId, names);
  if (tagRows.length) {
    await db
      .insert(taskTags)
      .values(tagRows.map((t) => ({ taskId, tagId: t.id })))
      .onConflictDoNothing();
  }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```powershell
git add src/core/tasks.ts tests/core/tasks-shared-tags.test.ts
git commit -m "feat(core): etiquetas por usuario en tareas compartidas (tags propias y otherTags)"
```

---

### Task 7: Asignación de tareas

**Files:**
- Modify: `src/core/tasks.ts`
- Create: `tests/core/tasks-assign.test.ts`

- [ ] **Step 1: Escribir el test que falla — `tests/core/tasks-assign.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '@/db/types';
import type { List } from '@/core/lists';
import { addListMember, leaveList, removeListMember } from '@/core/members';
import { createTask, getTask, listTasks, moveTask, updateTask } from '@/core/tasks';
import type { PublicUser as User } from '@/core/users';
import { createTestDb } from '../helpers/db';
import { createSharingFixture } from '../helpers/sharing';

let db: DB;
let owner: User;
let member: User;
let stranger: User;
let shared: List;
let ownerPrivate: List;

beforeEach(async () => {
  db = await createTestDb();
  ({ owner, member, stranger, shared, ownerPrivate } = await createSharingFixture(db));
});

const ASSIGNEE_MSG = 'Solo se puede asignar la tarea al dueño o a un miembro de la lista';

describe('asignación', () => {
  it('se asigna al dueño o a un miembro, y null la quita', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id, assigneeId: member.id });
    expect(t.assigneeId).toBe(member.id);
    expect(t.assignee).toEqual({ id: member.id, email: 'miembro@example.com', name: 'Emir' });
    expect((await updateTask(db, member.id, t.id, { assigneeId: owner.id })).assignee?.id).toBe(owner.id);
    const cleared = await updateTask(db, owner.id, t.id, { assigneeId: null });
    expect(cleared.assigneeId).toBeNull();
    expect(cleared.assignee).toBeNull();
    expect((await createTask(db, owner.id, { title: 'B' })).assignee).toBeNull();
  });

  it('updateTask sin assigneeId conserva la asignación', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id, assigneeId: member.id });
    expect((await updateTask(db, owner.id, t.id, { title: 'B' })).assigneeId).toBe(member.id);
  });

  it('no se puede asignar a alguien sin acceso a la lista', async () => {
    const t = await createTask(db, owner.id, { title: 'A', listId: shared.id });
    for (const bad of [stranger.id, 'basura', 5 as unknown as string]) {
      await expect(updateTask(db, owner.id, t.id, { assigneeId: bad })).rejects.toThrow(ASSIGNEE_MSG);
    }
    await expect(
      createTask(db, owner.id, { title: 'B', listId: ownerPrivate.id, assigneeId: member.id }),
    ).rejects.toThrow(ASSIGNEE_MSG);
    expect(await listTasks(db, owner.id, { listId: ownerPrivate.id })).toEqual([]);
    expect((await getTask(db, owner.id, t.id)).assigneeId).toBeNull();
  });

  it('mover a una lista donde el asignado no tiene acceso limpia la asignación', async () => {
    const toMember = await createTask(db, owner.id, { title: 'A', listId: shared.id, assigneeId: member.id });
    const toOwner = await createTask(db, owner.id, { title: 'B', listId: shared.id, assigneeId: owner.id });
    expect((await moveTask(db, owner.id, toMember.id, ownerPrivate.id)).assignee).toBeNull();
    expect((await moveTask(db, owner.id, toOwner.id, ownerPrivate.id)).assigneeId).toBe(owner.id);
  });

  it('quitar al miembro o que salga limpia sus asignaciones en la lista', async () => {
    const a = await createTask(db, owner.id, { title: 'A', listId: shared.id, assigneeId: member.id });
    await removeListMember(db, owner.id, shared.id, member.id);
    expect((await getTask(db, owner.id, a.id)).assignee).toBeNull();

    const b = await createTask(db, owner.id, { title: 'B', listId: shared.id });
    await addListMember(db, owner.id, shared.id, member.email);
    await updateTask(db, member.id, b.id, { assigneeId: member.id });
    await leaveList(db, member.id, shared.id);
    expect((await getTask(db, owner.id, b.id)).assigneeId).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/core/tasks-assign.test.ts`
Expected: FAIL — `assignee` es `undefined`, `assigneeId` se ignora en create/update y no hay validación.

- [ ] **Step 3: Modificar `src/core/tasks.ts`**

3a. Imports: reemplazar
`import { subtasks, tags, taskTags, tasks } from '@/db/schema';`
por
`import { subtasks, tags, taskTags, tasks, users } from '@/db/schema';`
y reemplazar
`import { accessibleListIds } from './access';`
por
`import { accessibleListIds, canAccessList } from './access';`

3b. Reemplazar el bloque de tipos `TaskWithDetails` (el de la Task 6) por:

```ts
/** Persona asignada (datos mínimos para mostrar). */
export interface TaskAssignee {
  id: string;
  email: string;
  name: string;
}

export type TaskWithDetails = Task & {
  subtasks: Subtask[];
  /** Etiquetas del usuario que consulta (las únicas que puede editar). */
  tags: string[];
  /** Etiquetas que pusieron otros usuarios con acceso a la tarea, sin repetir nombres de `tags`. */
  otherTags: string[];
  assignee: TaskAssignee | null;
};
```

3c. Reemplazar las interfaces `CreateTaskInput` y `UpdateTaskInput` completas por:

```ts
export interface CreateTaskInput {
  title: string;
  description?: string;
  listId?: string;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: number;
  tags?: string[];
  subtasks?: (string | SubtaskInput)[];
  status?: 'pending' | 'completed';
  completedAt?: Date | null;
  externalId?: string;
  /** Id del usuario asignado: el dueño o un miembro de la lista. */
  assigneeId?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: number;
  /** Reemplaza las etiquetas del usuario (las de otros usuarios se conservan). */
  tags?: string[];
  /** Reemplaza todas las subtareas (las que traen `id` de una existente se conservan). */
  subtasks?: (string | SubtaskInput)[];
  /** Id del usuario asignado (dueño o miembro de la lista); null quita la asignación. */
  assigneeId?: string | null;
}
```

3d. Agregar, al final de la sección `// ---------- Validación ----------` (después de `normalizeTags`):

```ts
const ASSIGNEE_MSG = 'Solo se puede asignar la tarea al dueño o a un miembro de la lista';

/** Valida que el asignado tenga acceso a la lista. Depende de la base: llamar dentro de la transacción. */
async function checkAssignee(db: DB, assigneeId: string | null, listId: string): Promise<string | null> {
  if (assigneeId === null) return null;
  if (typeof assigneeId !== 'string' || !(await canAccessList(db, assigneeId, listId))) {
    throw new ValidationError(ASSIGNEE_MSG);
  }
  return assigneeId;
}
```

3e. Reemplazar la función `hydrate` completa por (versión final):

```ts
async function hydrate(db: DB, viewerId: string, rows: Task[]): Promise<TaskWithDetails[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const subs = await db.select().from(subtasks).where(inArray(subtasks.taskId, ids)).orderBy(asc(subtasks.sortOrder));
  const tagRows = await db
    .select({ taskId: taskTags.taskId, name: tags.name, ownerId: tags.userId })
    .from(taskTags)
    .innerJoin(tags, eq(tags.id, taskTags.tagId))
    .where(inArray(taskTags.taskId, ids))
    .orderBy(asc(tags.name));
  const assigneeIds = [...new Set(rows.flatMap((r) => (r.assigneeId ? [r.assigneeId] : [])))];
  const people: TaskAssignee[] = assigneeIds.length
    ? await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(inArray(users.id, assigneeIds))
    : [];
  return rows.map((row) => {
    const onTask = tagRows.filter((t) => t.taskId === row.id);
    const own = onTask.filter((t) => t.ownerId === viewerId).map((t) => t.name);
    const others = onTask.filter((t) => t.ownerId !== viewerId && !own.includes(t.name)).map((t) => t.name);
    return {
      ...row,
      subtasks: subs.filter((s) => s.taskId === row.id),
      tags: own,
      otherTags: [...new Set(others)],
      assignee: people.find((p) => p.id === row.assigneeId) ?? null,
    };
  });
}
```

3f. Reemplazar la función `createTask` completa por:

```ts
export async function createTask(db: DB, userId: string, input: CreateTaskInput): Promise<TaskWithDetails> {
  // Validación pura primero: si algo está mal no se toca la base.
  const title = cleanTitle(input.title);
  const { dueDate, dueTime } = checkDue(input.dueDate ?? null, input.dueTime ?? null);
  const priority = checkPriority(input.priority ?? 0);
  const subtaskItems = normalizeSubtasks(input.subtasks ?? []);
  const tagNames = normalizeTags(input.tags ?? []);
  const status = input.status ?? 'pending';
  const description = checkDescription(input.description ?? '');

  try {
    return await db.transaction(async (tx) => {
      // getList acepta listas propias y compartidas con el usuario; sin lista, va a su Bandeja.
      const listId = input.listId ? (await getList(tx, userId, input.listId)).id : (await getInbox(tx, userId)).id;
      const assigneeId = await checkAssignee(tx, input.assigneeId ?? null, listId);
      const [task] = await tx
        .insert(tasks)
        .values({
          userId, listId, assigneeId, title, dueDate, dueTime, priority, status, description,
          completedAt: status === 'completed' ? (input.completedAt ?? new Date()) : null,
          externalId: input.externalId ?? null,
        })
        .returning();
      if (subtaskItems.length) await replaceSubtasks(tx, task.id, subtaskItems);
      if (tagNames.length) await replaceTags(tx, userId, task.id, tagNames);
      return getTask(tx, userId, task.id);
    });
  } catch (err) {
    if (input.externalId !== undefined && isUniqueViolation(err)) {
      throw new ValidationError(`Ya existe una tarea con el id externo "${input.externalId}"`);
    }
    throw err;
  }
}
```

3g. Reemplazar la función `updateTask` completa por:

```ts
export async function updateTask(
  db: DB, userId: string, taskId: string, input: UpdateTaskInput,
): Promise<TaskWithDetails> {
  // Validación pura primero (lo que depende de la fila actual se valida adentro, con la fila bloqueada).
  const patch: Partial<typeof tasks.$inferInsert> = {};
  if (input.title !== undefined) patch.title = cleanTitle(input.title);
  if (input.description !== undefined) patch.description = checkDescription(input.description);
  if (input.priority !== undefined) patch.priority = checkPriority(input.priority);
  const subtaskItems = input.subtasks !== undefined ? normalizeSubtasks(input.subtasks) : undefined;
  const tagNames = input.tags !== undefined ? normalizeTags(input.tags) : undefined;

  return db.transaction(async (tx) => {
    const current = await findTask(tx, userId, taskId, { forUpdate: true });
    if (input.dueDate !== undefined || input.dueTime !== undefined) {
      const dueDate = input.dueDate !== undefined ? input.dueDate : current.dueDate;
      let dueTime = input.dueTime !== undefined ? input.dueTime : current.dueTime;
      if (dueDate === null && input.dueTime === undefined) dueTime = null;
      Object.assign(patch, checkDue(dueDate, dueTime));
    }
    if (input.assigneeId !== undefined) patch.assigneeId = await checkAssignee(tx, input.assigneeId, current.listId);
    await tx.update(tasks).set({ ...patch, updatedAt: new Date() }).where(eq(tasks.id, current.id));
    if (subtaskItems) await replaceSubtasks(tx, current.id, subtaskItems);
    if (tagNames) await replaceTags(tx, userId, current.id, tagNames);
    return getTask(tx, userId, current.id);
  });
}
```

3h. Reemplazar la función `moveTask` completa por:

```ts
/** Mueve la tarea a otra lista accesible; si el asignado no accede a la lista nueva, se quita la asignación. */
export async function moveTask(db: DB, userId: string, taskId: string, listId: string): Promise<TaskWithDetails> {
  return db.transaction(async (tx) => {
    const list = await getList(tx, userId, listId);
    const task = await findTask(tx, userId, taskId, { forUpdate: true });
    const keepAssignee = task.assigneeId !== null && (await canAccessList(tx, task.assigneeId, list.id));
    return patchTask(tx, userId, task.id, { listId: list.id, assigneeId: keepAssignee ? task.assigneeId : null });
  });
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```powershell
git add src/core/tasks.ts tests/core/tasks-assign.test.ts
git commit -m "feat(core): asignar tareas al dueño o a miembros de la lista"
```

---

### Task 8: Vistas — Hoy / 7 días con compartidas y "Asignadas a mí"

**Files:**
- Modify: `src/core/tasks.ts`, `src/app/app/[view]/page.tsx`
- Create: `tests/core/tasks-shared-views.test.ts`

- [ ] **Step 1: Escribir el test que falla — `tests/core/tasks-shared-views.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '@/db/types';
import type { List } from '@/core/lists';
import { completeTask, createTask, deleteTask, listTasks } from '@/core/tasks';
import type { PublicUser as User } from '@/core/users';
import { createTestDb } from '../helpers/db';
import { createSharingFixture } from '../helpers/sharing';

let db: DB;
let owner: User;
let member: User;
let shared: List;
let ownerPrivate: List;
// 15:00 UTC = 12:00 del 8/10 en Buenos Aires
const NOW = new Date('2026-10-08T15:00:00Z');

beforeEach(async () => {
  db = await createTestDb();
  ({ owner, member, shared, ownerPrivate } = await createSharingFixture(db));
  await createTask(db, owner.id, { title: 'compartida-sin-asignar', listId: shared.id, dueDate: '2026-10-08' });
  await createTask(db, owner.id, { title: 'compartida-para-miembro', listId: shared.id, dueDate: '2026-10-08', assigneeId: member.id });
  await createTask(db, owner.id, { title: 'compartida-para-miembro-sin-fecha', listId: shared.id, assigneeId: member.id });
  await createTask(db, member.id, { title: 'propia-del-miembro', dueDate: '2026-10-10' });
  await createTask(db, owner.id, { title: 'privada-del-duenio', listId: ownerPrivate.id, dueDate: '2026-10-08' });
});

const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();

describe('vistas con listas compartidas', () => {
  it('Hoy y 7 días del miembro: sus listas y, de las compartidas, solo lo asignado a él', async () => {
    expect(titles(await listTasks(db, member.id, { view: 'today', now: NOW }))).toEqual(['compartida-para-miembro']);
    expect(titles(await listTasks(db, member.id, { view: 'next7', now: NOW })))
      .toEqual(['compartida-para-miembro', 'propia-del-miembro']);
  });

  it('Hoy del dueño incluye todas las tareas de sus listas, asignadas o no', async () => {
    expect(titles(await listTasks(db, owner.id, { view: 'today', now: NOW })))
      .toEqual(['compartida-para-miembro', 'compartida-sin-asignar', 'privada-del-duenio']);
  });

  it('Asignadas a mí: pendientes asignadas en cualquier lista accesible', async () => {
    expect(titles(await listTasks(db, member.id, { view: 'assigned' })))
      .toEqual(['compartida-para-miembro', 'compartida-para-miembro-sin-fecha']);
    expect(await listTasks(db, owner.id, { view: 'assigned' })).toEqual([]);
    const [first] = await listTasks(db, member.id, { view: 'assigned' });
    await completeTask(db, member.id, first.id);
    expect(await listTasks(db, member.id, { view: 'assigned' })).toHaveLength(1);
    expect(await listTasks(db, member.id, { view: 'assigned', includeCompleted: true })).toHaveLength(2);
  });

  it('Bandeja: solo la propia', async () => {
    expect(titles(await listTasks(db, member.id, { view: 'inbox' }))).toEqual(['propia-del-miembro']);
  });

  it('Completadas y Papelera incluyen las de listas compartidas', async () => {
    const [a, b] = await listTasks(db, owner.id, { listId: shared.id });
    await completeTask(db, owner.id, a.id);
    await deleteTask(db, owner.id, b.id);
    expect(titles(await listTasks(db, member.id, { view: 'completed' }))).toEqual([a.title]);
    expect(titles(await listTasks(db, member.id, { view: 'trash' }))).toEqual([b.title]);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/core/tasks-shared-views.test.ts`
Expected: FAIL — "Hoy" del miembro incluye `compartida-sin-asignar` y `view: 'assigned'` no filtra (devuelve todas las pendientes accesibles).

- [ ] **Step 3: Modificar `src/core/tasks.ts`**

3a. Reemplazar
`import { accessibleListIds, canAccessList } from './access';`
por
`import { accessibleListIds, canAccessList, ownedListIds } from './access';`

3b. Reemplazar la línea
`export type TaskView = 'inbox' | 'today' | 'next7' | 'completed' | 'trash';`
por
`export type TaskView = 'inbox' | 'today' | 'next7' | 'assigned' | 'completed' | 'trash';`

3c. Reemplazar la función `listTasks` completa (incluido su comentario) por:

```ts
/**
 * Lista tareas de las listas a las que el usuario accede (propias y compartidas con él).
 * "today" y "next7" incluyen vencidas pendientes (como TickTick), se calculan en la zona horaria
 * del usuario y, de las listas compartidas con él, solo traen las asignadas a él.
 * "assigned" trae las asignadas a él en cualquier lista accesible. "inbox" es solo su Bandeja.
 */
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
```

- [ ] **Step 4: Agregar la vista a la página — en `src/app/app/[view]/page.tsx`, reemplazar el bloque `const VIEWS ...` por:**

```ts
const VIEWS: Record<TaskView, string> = {
  inbox: 'Bandeja', today: 'Hoy', next7: 'Próximos 7 días', assigned: 'Asignadas a mí',
  completed: 'Completadas', trash: 'Papelera',
};
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npx vitest run`
Expected: PASS (todos).

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```powershell
git add src/core/tasks.ts "src/app/app/[view]/page.tsx" tests/core/tasks-shared-views.test.ts
git commit -m "feat(core): vistas Hoy/7 días con listas compartidas y vista Asignadas a mí"
```

---

### Task 9: Server Actions de miembros y asignación

**Files:**
- Modify: `src/app/app/actions.ts`

- [ ] **Step 1: Imports** — agregar, después de la línea `import { createFolder, createList, ... } from '@/core/lists';`:

```ts
import { addListMember, getListMembers, leaveList, removeListMember } from '@/core/members';
```

- [ ] **Step 2: Reemplazar la función `updateTaskAction` completa por:**

```ts
export async function updateTaskAction(taskId: string, input: UpdateTaskInput) {
  // Solo los campos editables: el resto (listId, status, externalId...) no se acepta del cliente.
  return act(async (db, user) => {
    const { title, description, dueDate, dueTime, priority, tags, subtasks, assigneeId } = input;
    await updateTask(db, user.id, taskId, { title, description, dueDate, dueTime, priority, tags, subtasks, assigneeId });
  });
}
```

- [ ] **Step 3: Agregar después de `deleteListAction`:**

```ts
/** Solo lectura: no revalida (lo llama el diálogo de lista al abrirse). */
export async function getListMembersAction(listId: string) {
  return runAction(async () => {
    const user = await requireUser();
    return getListMembers(await getDb(), user.id, listId);
  });
}

export async function addListMemberAction(listId: string, email: string) {
  return act((db, user) => addListMember(db, user.id, listId, String(email)));
}

export async function removeListMemberAction(listId: string, memberId: string) {
  return act((db, user) => removeListMember(db, user.id, listId, memberId));
}

export async function leaveListAction(listId: string) {
  return act((db, user) => leaveList(db, user.id, listId));
}
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 5: Commit**

```powershell
git add src/app/app/actions.ts
git commit -m "feat(web): acciones para miembros de listas y asignación de tareas"
```

---

### Task 10: Barra lateral — "Asignadas a mí", "Compartidas conmigo" e ícono de compartida

**Files:**
- Modify: `src/components/sidebar.tsx`, `src/components/task-workspace.tsx`

- [ ] **Step 1: Reemplazar el contenido completo de `src/components/sidebar.tsx` por:**

```tsx
'use client';

import {
  CalendarDays, CheckCircle2, ChevronDown, Folder as FolderIcon, Hash, Inbox, Pencil, Plus, Settings, Sun, Trash2,
  UserCheck, Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { Folder, ListWithRole } from '@/core/lists';
import type { Tag } from '@/core/tags';
import type { PublicUser } from '@/core/users';
import { deleteFolderAction, renameFolderAction } from '@/app/app/actions';
import { ListDialog } from './list-dialog';

const SMART_VIEWS = [
  { href: '/app/inbox', label: 'Bandeja', icon: Inbox },
  { href: '/app/today', label: 'Hoy', icon: Sun },
  { href: '/app/next7', label: 'Próximos 7 días', icon: CalendarDays },
  { href: '/app/assigned', label: 'Asignadas a mí', icon: UserCheck },
  { href: '/app/completed', label: 'Completadas', icon: CheckCircle2 },
  { href: '/app/trash', label: 'Papelera', icon: Trash2 },
];

// Una URL mal formada (p. ej. /app/tag/%ZZ) no debe romper la barra lateral.
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href} aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 ${active ? 'bg-selected font-medium' : 'hover:bg-hover'}`}
    >
      {children}
    </Link>
  );
}

function ListLink({ list, pathname, onEdit }: { list: ListWithRole; pathname: string; onEdit: () => void }) {
  const href = `/app/list/${list.id}`;
  const isOwner = list.role === 'owner';
  return (
    <li className="group relative">
      <NavLink href={href} active={pathname === href}>
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: list.color ?? 'var(--muted)' }} />
        <span className="truncate">{list.name}</span>
        {isOwner && list.shared && (
          <>
            <Users size={13} className="shrink-0 text-muted" aria-hidden="true" />
            <span className="sr-only">(compartida)</span>
          </>
        )}
      </NavLink>
      <button
        onClick={onEdit} aria-label={isOwner ? `Editar ${list.name}` : `Miembros de ${list.name}`}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:bg-hover md:opacity-0 md:focus-visible:opacity-100 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
      >
        {isOwner ? <Pencil size={13} /> : <Users size={13} />}
      </button>
    </li>
  );
}

export function Sidebar({
  user, lists, folders, tags,
}: { user: PublicUser; lists: ListWithRole[]; folders: Folder[]; tags: Tag[] }) {
  const pathname = usePathname();
  const [dialog, setDialog] = useState<{ list?: ListWithRole } | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [, startTransition] = useTransition();
  const ownLists = lists.filter((l) => !l.isInbox && l.role === 'owner');
  const sharedWithMe = lists.filter((l) => l.role === 'member');

  function renameFolder(folder: Folder) {
    const name = prompt('Nuevo nombre de la carpeta', folder.name);
    if (name && name !== folder.name) {
      startTransition(async () => {
        const result = await renameFolderAction(folder.id, name);
        if (!result.ok) alert(result.error);
      });
    }
  }
  function removeFolder(folder: Folder) {
    if (confirm(`¿Borrar la carpeta "${folder.name}"? Sus listas quedan sueltas.`)) {
      startTransition(async () => {
        const result = await deleteFolderAction(folder.id);
        if (!result.ok) alert(result.error);
      });
    }
  }

  return (
    <nav className="flex h-full flex-col overflow-y-auto p-3 text-sm" aria-label="Navegación principal">
      <div className="mb-4 px-2 text-base font-semibold">Notas</div>
      <ul className="space-y-0.5">
        {SMART_VIEWS.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <NavLink href={href} active={pathname === href}><Icon size={16} className="text-muted" />{label}</NavLink>
          </li>
        ))}
      </ul>

      <div className="mb-1 mt-5 flex items-center justify-between px-2 text-xs font-semibold uppercase tracking-wide text-muted">
        Listas
        <button onClick={() => setDialog({})} aria-label="Nueva lista" className="rounded p-1 hover:bg-hover"><Plus size={14} /></button>
      </div>
      {folders.map((folder) => {
        const inFolder = ownLists.filter((l) => l.folderId === folder.id);
        const isCollapsed = collapsed[folder.id];
        return (
          <div key={folder.id} className="mb-1">
            <div className="group flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-hover">
              <button
                onClick={() => setCollapsed((c) => ({ ...c, [folder.id]: !c[folder.id] }))}
                aria-expanded={!isCollapsed} className="flex flex-1 items-center gap-2 text-left"
              >
                <ChevronDown size={14} className={`text-muted transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                <FolderIcon size={15} className="text-muted" />
                <span className="truncate">{folder.name}</span>
              </button>
              <button onClick={() => renameFolder(folder)} aria-label={`Renombrar ${folder.name}`} className="rounded p-1 text-muted md:opacity-0 md:focus-visible:opacity-100 md:group-focus-within:opacity-100 md:group-hover:opacity-100"><Pencil size={13} /></button>
              <button onClick={() => removeFolder(folder)} aria-label={`Borrar ${folder.name}`} className="rounded p-1 text-muted md:opacity-0 md:focus-visible:opacity-100 md:group-focus-within:opacity-100 md:group-hover:opacity-100"><Trash2 size={13} /></button>
            </div>
            {!isCollapsed && (
              <ul className="ml-4 space-y-0.5">
                {inFolder.map((l) => <ListLink key={l.id} list={l} pathname={pathname} onEdit={() => setDialog({ list: l })} />)}
              </ul>
            )}
          </div>
        );
      })}
      <ul className="space-y-0.5">
        {ownLists.filter((l) => !l.folderId).map((l) => (
          <ListLink key={l.id} list={l} pathname={pathname} onEdit={() => setDialog({ list: l })} />
        ))}
      </ul>

      {sharedWithMe.length > 0 && (
        <>
          <div className="mb-1 mt-5 px-2 text-xs font-semibold uppercase tracking-wide text-muted">Compartidas conmigo</div>
          <ul className="space-y-0.5">
            {sharedWithMe.map((l) => (
              <ListLink key={l.id} list={l} pathname={pathname} onEdit={() => setDialog({ list: l })} />
            ))}
          </ul>
        </>
      )}

      {tags.length > 0 && (
        <>
          <div className="mb-1 mt-5 px-2 text-xs font-semibold uppercase tracking-wide text-muted">Etiquetas</div>
          <ul className="space-y-0.5">
            {tags.map((t) => {
              const href = `/app/tag/${encodeURIComponent(t.name)}`;
              return (
                <li key={t.id}>
                  <NavLink href={href} active={pathname === href || safeDecode(pathname) === `/app/tag/${t.name}`}>
                    <Hash size={15} className="text-muted" />{t.name}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="mt-auto space-y-1 border-t border-line pt-3">
        <NavLink href="/app/settings" active={pathname === '/app/settings'}><Settings size={16} className="text-muted" />Configuración</NavLink>
        <p className="truncate px-2 text-xs text-muted">{user.email}</p>
      </div>

      {dialog && <ListDialog list={dialog.list} folders={folders} onClose={() => setDialog(null)} />}
    </nav>
  );
}
```

> `ListDialog` todavía declara `list?: List`; `ListWithRole` es asignable, así que compila. La Task 12 cambia el tipo.

- [ ] **Step 2: En `src/components/task-workspace.tsx`, reemplazar la línea**
`const canAdd = context.view !== 'completed' && !inTrash;`
por
`const canAdd = context.view !== 'completed' && context.view !== 'assigned' && !inTrash;`

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 4: Commit**

```powershell
git add src/components/sidebar.tsx src/components/task-workspace.tsx
git commit -m "feat(web): barra lateral con Asignadas a mí y Compartidas conmigo"
```

---

### Task 11: Iniciales y avatar

**Files:**
- Create: `src/lib/initials.ts`, `tests/lib/initials.test.ts`, `src/components/avatar.tsx`

- [ ] **Step 1: Escribir el test que falla — `tests/lib/initials.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { initials } from '@/lib/initials';

describe('initials', () => {
  it('dos palabras del nombre → sus iniciales', () => {
    expect(initials({ name: 'Emir Maestu', email: 'x@example.com' })).toBe('EM');
    expect(initials({ name: '  ana  maría  lópez ', email: 'x@example.com' })).toBe('AM');
  });

  it('una palabra → sus dos primeras letras', () => {
    expect(initials({ name: 'Ángel', email: 'x@example.com' })).toBe('ÁN');
  });

  it('sin nombre → las dos primeras letras del email', () => {
    expect(initials({ name: '', email: 'juan@example.com' })).toBe('JU');
    expect(initials({ name: '   ', email: 'z@example.com' })).toBe('Z@');
  });

  it('no parte emojis ni caracteres compuestos por dos unidades', () => {
    expect(initials({ name: '😀 Feliz', email: 'x@example.com' })).toBe('😀F');
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/lib/initials.test.ts`
Expected: FAIL — no se puede resolver `@/lib/initials`.

- [ ] **Step 3: Implementar `src/lib/initials.ts`**

```ts
/** Primeros `n` caracteres visibles (por punto de código, para no partir emojis). */
function firstChars(text: string, n: number): string {
  return Array.from(text).slice(0, n).join('');
}

/** Iniciales para el avatar: de las dos primeras palabras del nombre o, sin nombre, del email. */
export function initials(person: { name: string; email: string }): string {
  const words = person.name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (firstChars(words[0], 1) + firstChars(words[1], 1)).toUpperCase();
  if (words.length === 1) return firstChars(words[0], 2).toUpperCase();
  return firstChars(person.email, 2).toUpperCase();
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run tests/lib/initials.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Crear `src/components/avatar.tsx`**

```tsx
import { initials } from '@/lib/initials';

/** Círculo con las iniciales de una persona. Decorativo: quien lo usa agrega el texto accesible. */
export function Avatar({ person, size = 'md' }: { person: { name: string; email: string }; size?: 'sm' | 'md' }) {
  return (
    <span
      title={person.name || person.email} aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-accent-fg ${size === 'sm' ? 'h-5 w-5 text-[10px]' : 'h-6 w-6 text-[11px]'}`}
    >
      {initials(person)}
    </span>
  );
}
```

- [ ] **Step 6: Verificar y commit**

Run: `npx tsc --noEmit`
Expected: sin errores.

```powershell
git add src/lib/initials.ts tests/lib/initials.test.ts src/components/avatar.tsx
git commit -m "feat(web): avatar con iniciales"
```

---

### Task 12: Diálogo de lista — sección "Miembros" y modo miembro

**Files:**
- Create: `src/components/list-members.tsx`
- Modify: `src/components/list-dialog.tsx`

- [ ] **Step 1: Crear `src/components/list-members.tsx`**

```tsx
'use client';

import { X } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import type { ListMember } from '@/core/members';
import { addListMemberAction, getListMembersAction, removeListMemberAction } from '@/app/app/actions';
import { Avatar } from './avatar';

/** Sección "Miembros" del diálogo de lista. El dueño agrega por email y quita; un miembro solo ve. */
export function ListMembers({ listId, isOwner }: { listId: string; isOwner: boolean }) {
  const [members, setMembers] = useState<ListMember[] | null>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    getListMembersAction(listId).then((result) => {
      if (!alive) return;
      if (result.ok) setMembers(result.data);
      else setError(result.error);
    });
    return () => { alive = false; };
  }, [listId]);

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return setError('Ingresá el email de la persona');
    setError(null);
    startTransition(async () => {
      const result = await addListMemberAction(listId, email);
      if (!result.ok) return setError(result.error);
      setMembers((current) => [...(current ?? []), result.data]);
      setEmail('');
    });
  }

  function remove(member: ListMember) {
    if (!confirm(`¿Quitar a ${member.email} de la lista? Sus tareas asignadas quedan sin asignar.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await removeListMemberAction(listId, member.id);
      if (!result.ok) return setError(result.error);
      setMembers((current) => (current ?? []).filter((m) => m.id !== member.id));
    });
  }

  return (
    <section aria-label="Miembros" className="mt-5 border-t border-line pt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Miembros</h3>
      {members === null && !error && <p className="text-sm text-muted">Cargando…</p>}
      {members && (
        <ul className="mb-3 space-y-1.5 text-sm">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-2">
              <Avatar person={m} />
              <span className="min-w-0 flex-1 truncate">
                {m.name || m.email}
                {m.name && <span className="text-muted"> · {m.email}</span>}
              </span>
              {m.role === 'owner' ? (
                <span className="text-xs text-muted">Dueño</span>
              ) : isOwner && (
                <button
                  type="button" onClick={() => remove(m)} disabled={pending} aria-label={`Quitar a ${m.email}`}
                  className="rounded p-1 text-muted hover:bg-hover hover:text-danger"
                >
                  <X size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {isOwner && (
        <form onSubmit={add} className="flex gap-2">
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="Email de la persona" aria-label="Email del nuevo miembro"
            className="min-w-0 flex-1 rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit" disabled={pending}
            className="rounded-md border border-line px-3 py-2 text-sm hover:bg-hover disabled:opacity-60"
          >
            Agregar
          </button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  );
}
```

- [ ] **Step 2: Reemplazar el contenido completo de `src/components/list-dialog.tsx` por:**

```tsx
'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { Folder, ListWithRole } from '@/core/lists';
import {
  createFolderAction, createListAction, deleteListAction, leaveListAction, updateListAction,
} from '@/app/app/actions';
import { ListMembers } from './list-members';
import { Modal } from './modal';

export const LIST_COLORS = ['#5b5bd6', '#3e8ef7', '#12a594', '#30a46c', '#f5a524', '#f76b15', '#e5484d', '#d6409f', '#8e8c99'];
const NEW_FOLDER = '__new';

export function ListDialog({ list, folders, onClose }: { list?: ListWithRole; folders: Folder[]; onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [name, setName] = useState(list?.name ?? '');
  const [color, setColor] = useState<string | null>(list ? list.color : LIST_COLORS[0]);
  const [folderId, setFolderId] = useState(list?.folderId ?? '');
  const [newFolder, setNewFolder] = useState('');
  const [error, setError] = useState<string | null>(null);
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
    if (!list || !confirm(`¿Borrar la lista "${list.name}"? Sus tareas van a la papelera.`)) return;
    startTransition(async () => {
      const result = await deleteListAction(list.id);
      if (!result.ok) return setError(result.error);
      afterLosingList(list.id);
    });
  }

  function leave() {
    if (!list || !confirm(`¿Salir de la lista "${list.name}"? Vas a dejar de ver sus tareas.`)) return;
    startTransition(async () => {
      const result = await leaveListAction(list.id);
      if (!result.ok) return setError(result.error);
      afterLosingList(list.id);
    });
  }

  // Miembro: solo lectura, ver miembros y salir.
  if (list && list.role === 'member') {
    return (
      <Modal title={list.name} onClose={onClose}>
        <p className="text-sm text-muted">
          Esta lista está compartida con vos. Solo su dueño puede cambiarle el nombre, el color o borrarla.
        </p>
        <ListMembers listId={list.id} isOwner={false} />
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex">
          <button
            type="button" onClick={leave} disabled={pending}
            className="ml-auto rounded-md px-3 py-2 text-sm text-danger hover:bg-hover"
          >
            Salir de la lista
          </button>
        </div>
      </Modal>
    );
  }

  const field = 'w-full rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent';
  return (
    <Modal title={list ? 'Editar lista' : 'Nueva lista'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" aria-label="Nombre de la lista" className={field} />
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
          {LIST_COLORS.map((c) => (
            <button
              key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)}
              className={`h-6 w-6 rounded-full ${color === c ? 'ring-2 ring-fg ring-offset-2 ring-offset-bg' : ''}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <select value={folderId} onChange={(e) => setFolderId(e.target.value)} aria-label="Carpeta" className={field}>
          <option value="">Sin carpeta</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          <option value={NEW_FOLDER}>+ Nueva carpeta…</option>
        </select>
        {folderId === NEW_FOLDER && (
          <input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="Nombre de la carpeta" aria-label="Nombre de la carpeta" className={field} />
        )}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex items-center gap-2">
          {list && (
            <button type="button" onClick={remove} disabled={pending} className="rounded-md px-3 py-2 text-sm text-danger hover:bg-hover">
              Borrar lista
            </button>
          )}
          <button type="submit" disabled={pending} className="ml-auto rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-60">
            Guardar
          </button>
        </div>
      </form>
      {/* Fuera del <form>: ListMembers tiene su propio formulario (no se pueden anidar). */}
      {list && <ListMembers listId={list.id} isOwner />}
    </Modal>
  );
}
```

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 4: Commit**

```powershell
git add src/components/list-members.tsx src/components/list-dialog.tsx
git commit -m "feat(web): sección Miembros en el diálogo de lista y salir de una lista compartida"
```

---

### Task 13: Detalle y fila de tarea — "Asignada a", avatar y etiquetas de otros

**Files:**
- Modify: `src/components/task-page.tsx`, `src/components/task-workspace.tsx`, `src/components/task-detail.tsx`, `src/components/task-item.tsx`

- [ ] **Step 1: Reemplazar el contenido completo de `src/components/task-page.tsx` por:**

```tsx
import { todayIn } from '@/core/dates';
import { NotFoundError } from '@/core/errors';
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
  const selectedListId = selected?.listId;
  const selectedList = selectedListId ? lists.find((l) => l.id === selectedListId) : undefined;
  const members: ListMember[] = selectedList?.shared ? await getListMembers(db, user.id, selectedList.id) : [];
  return (
    <TaskWorkspace
      title={title} tasks={tasks} selected={selected} lists={lists} members={members} context={context}
      today={todayIn(user.timezone)}
    />
  );
}
```

- [ ] **Step 2: Reemplazar el contenido completo de `src/components/task-workspace.tsx` por:**

```tsx
'use client';

import type { List } from '@/core/lists';
import type { ListMember } from '@/core/members';
import type { TaskWithDetails } from '@/core/tasks';
import type { QuickAddContext } from '@/app/app/actions';
import { QuickAdd } from './quick-add';
import { TaskDetail } from './task-detail';
import { TaskList } from './task-list';

export function TaskWorkspace({
  title, tasks, selected, lists, members, context, today,
}: {
  title: string; tasks: TaskWithDetails[]; selected: TaskWithDetails | null;
  lists: List[]; members: ListMember[]; context: QuickAddContext; today: string;
}) {
  const inTrash = context.view === 'trash';
  // En "Asignadas a mí" una tarea nueva no quedaría asignada y no se vería: no se ofrece agregar.
  const canAdd = context.view !== 'completed' && context.view !== 'assigned' && !inTrash;
  return (
    <div className="flex h-full">
      <section className={`min-w-0 flex-1 flex-col ${selected ? 'hidden lg:flex' : 'flex'}`}>
        <h1 className="px-4 pb-3 pt-5 text-xl font-semibold md:px-6">{title}</h1>
        {canAdd && <QuickAdd context={context} today={today} />}
        <TaskList
          tasks={tasks} selectedId={selected?.id} today={today} lists={lists} inTrash={inTrash}
          grouped={context.view === 'today' || context.view === 'next7'}
          showListName={!context.listId}
        />
      </section>
      {selected && (
        <aside className="w-full border-line lg:w-[420px] lg:shrink-0 lg:border-l">
          <TaskDetail key={selected.id} task={selected} lists={lists} members={members} />
        </aside>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Reemplazar el contenido completo de `src/components/task-detail.tsx` por:**

```tsx
'use client';

import { ArrowLeft, RotateCcw, Trash2 } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { isValidIsoDate, isValidTime } from '@/core/dates';
import type { List } from '@/core/lists';
import type { ListMember } from '@/core/members';
import type { TaskWithDetails, UpdateTaskInput } from '@/core/tasks';
import type { ActionResult } from '@/lib/action-result';
import {
  deleteTaskAction, moveTaskAction, restoreTaskAction, toggleTaskAction, updateTaskAction,
} from '@/app/app/actions';
import { PriorityCheckbox } from './priority-checkbox';
import { PrioritySelect } from './priority-select';
import { SubtaskList } from './subtask-list';
import { TagEditor } from './tag-editor';

export function TaskDetail({ task, lists, members }: { task: TaskWithDetails; lists: List[]; members: ListMember[] }) {
  const inTrash = task.deletedAt !== null;
  const router = useRouter();
  const pathname = usePathname();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [date, setDate] = useState(task.dueDate ?? '');
  const [time, setTime] = useState(task.dueTime ?? '');
  const [priority, setPriority] = useState(task.priority);
  const [listId, setListId] = useState(task.listId);
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => setDate(task.dueDate ?? ''), [task.dueDate]);
  useEffect(() => setTime(task.dueTime ?? ''), [task.dueTime]);
  useEffect(() => setPriority(task.priority), [task.priority]);
  useEffect(() => setListId(task.listId), [task.listId]);
  useEffect(() => setAssigneeId(task.assigneeId ?? ''), [task.assigneeId]);

  const close = () => router.push(pathname, { scroll: false });
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
    const clean = title.trim();
    if (!clean) { setTitle(task.title); return; }
    setTitle(clean);
    if (clean !== task.title) save({ title: clean });
  }
  function move(newListId: string) {
    setListId(newListId);
    run(
      () => moveTaskAction(task.id, newListId),
      // Si la vista actual es una lista y la tarea se fue a otra, el detalle ya no corresponde.
      () => { if (pathname.startsWith('/app/list/') && !pathname.includes(newListId)) close(); },
      () => setListId(task.listId),
    );
  }
  function assign(next: string) {
    setAssigneeId(next);
    save({ assigneeId: next || null }, () => setAssigneeId(task.assigneeId ?? ''));
  }

  const header = (
    <button onClick={close} aria-label="Cerrar detalle" className="rounded p-1.5 hover:bg-hover"><ArrowLeft size={18} /></button>
  );

  if (inTrash) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">{header}</div>
        <div className="space-y-4 p-4">
          <h2 className="text-lg font-semibold">{task.title}</h2>
          <p className="text-sm text-muted">Esta tarea está en la papelera. Se borra definitivamente a los 30 días.</p>
          <button
            onClick={() => run(() => restoreTaskAction(task.id), close)}
            className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg"
          >
            <RotateCcw size={15} /> Restaurar
          </button>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </div>
      </div>
    );
  }

  const done = task.status === 'completed';
  const control = 'rounded border border-line bg-transparent px-2 py-1 text-sm';
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        {header}
        <PriorityCheckbox
          checked={done} priority={priority} onChange={() => run(() => toggleTaskAction(task.id, !done))}
          label={done ? 'Marcar esta tarea como pendiente' : 'Completar esta tarea'}
        />
        <input
          type="date" value={date} aria-label="Fecha" className={control}
          onChange={(e) => { setDate(e.target.value); commitDate(e.target, false); }}
          onBlur={(e) => commitDate(e.target, true)}
        />
        {task.dueDate && (
          <input
            type="time" value={time} aria-label="Hora" className={control}
            onChange={(e) => { setTime(e.target.value); commitTime(e.target, false); }}
            onBlur={(e) => commitTime(e.target, true)}
          />
        )}
        <PrioritySelect
          value={priority}
          onChange={(p) => { setPriority(p); save({ priority: p }, () => setPriority(task.priority)); }}
        />
        <button
          aria-label="Mandar a la papelera" className="ml-auto rounded p-1.5 text-muted hover:bg-hover hover:text-danger"
          onClick={() => confirm('¿Mandar la tarea a la papelera?') && run(() => deleteTaskAction(task.id), close)}
        >
          <Trash2 size={17} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <input
          value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Título"
          onBlur={saveTitle}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className={`w-full bg-transparent text-lg font-semibold outline-none ${done ? 'text-muted line-through' : ''}`}
        />
        <textarea
          value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Descripción"
          onBlur={() => description !== task.description && save({ description })}
          placeholder="Descripción" rows={4}
          className="w-full resize-y bg-transparent text-sm outline-none placeholder:text-muted"
        />
        <SubtaskList task={task} onError={setError} />
        <div className="space-y-1">
          <TagEditor tags={task.tags} onChange={(tags, onFail) => save({ tags }, onFail)} />
          {task.otherTags.length > 0 && (
            <p className="text-xs text-muted">
              De otros miembros: {task.otherTags.map((t) => `#${t}`).join(' ')}
            </p>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          Lista
          <select
            value={listId} onChange={(e) => move(e.target.value)}
            className={`${control} text-fg`} aria-label="Lista"
          >
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        {members.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted">
            Asignada a
            <select
              value={assigneeId} onChange={(e) => assign(e.target.value)}
              className={`${control} text-fg`} aria-label="Asignada a"
            >
              <option value="">Sin asignar</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name ? `${m.name} (${m.email})` : m.email}</option>
              ))}
            </select>
          </label>
        )}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Reemplazar el contenido completo de `src/components/task-item.tsx` por:**

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useOptimistic, useState, useTransition } from 'react';
import type { TaskWithDetails } from '@/core/tasks';
import { formatDueLabel } from '@/lib/format';
import { toggleTaskAction } from '@/app/app/actions';
import { Avatar } from './avatar';
import { PriorityCheckbox } from './priority-checkbox';

export function TaskItem({
  task, selected, today, listName, inTrash,
}: { task: TaskWithDetails; selected: boolean; today: string; listName?: string; inTrash: boolean }) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useOptimistic(task.status === 'completed');

  function toggle() {
    startTransition(async () => {
      setDone(!done);
      const result = await toggleTaskAction(task.id, !done);
      setError(result.ok ? null : result.error);
    });
  }

  const overdue = !done && task.dueDate !== null && task.dueDate < today;
  const subtasksDone = task.subtasks.filter((s) => s.done).length;
  const allTags = [...task.tags, ...task.otherTags];

  return (
    <li className={`rounded-md px-3 py-2 ${selected ? 'bg-selected' : 'hover:bg-hover'}`}>
      <div className="flex items-center gap-3">
        {!inTrash && (
          <PriorityCheckbox
            checked={done} priority={task.priority} onChange={toggle} disabled={pending}
            label={done ? `Marcar "${task.title}" como pendiente` : `Completar "${task.title}"`}
          />
        )}
        <Link href={`${pathname}?t=${task.id}`} scroll={false} className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <span className={`truncate ${done ? 'text-muted line-through' : ''}`}>{task.title}</span>
          {task.subtasks.length > 0 && <span className="shrink-0 text-xs text-muted">{subtasksDone}/{task.subtasks.length}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-2 text-xs">
            {allTags.map((t) => <span key={t} className="hidden rounded bg-hover px-1.5 py-0.5 text-muted sm:inline">#{t}</span>)}
            {listName && <span className="hidden text-muted lg:inline">{listName}</span>}
            {task.dueDate && (
              <span className={overdue ? 'text-danger' : 'text-accent'}>
                {formatDueLabel(task.dueDate, today)}{task.dueTime ? ` ${task.dueTime}` : ''}
              </span>
            )}
            {task.assignee && (
              <>
                <Avatar person={task.assignee} size="sm" />
                <span className="sr-only">Asignada a {task.assignee.name || task.assignee.email}</span>
              </>
            )}
          </span>
        </Link>
      </div>
      {error && <p role="alert" className="mt-1 pl-[30px] text-xs text-danger">{error}</p>}
    </li>
  );
}
```

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run lint`
Expected: sin errores.

Run: `npx vitest run`
Expected: PASS (todos).

- [ ] **Step 6: Commit**

```powershell
git add src/components/task-page.tsx src/components/task-workspace.tsx src/components/task-detail.tsx src/components/task-item.tsx
git commit -m "feat(web): asignar tareas desde el detalle y mostrar el asignado en la lista"
```

---

### Task 14: Prueba de punta a punta y verificación final

**Files:**
- Create: `e2e/compartir.spec.ts`

- [ ] **Step 1: Crear `e2e/compartir.spec.ts`**

```ts
import { expect, test, type Browser, type Page } from '@playwright/test';

/** Registra un usuario en un contexto de navegador propio (cookies separadas) y devuelve su página. */
async function register(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/registro');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill('contraseña-e2e');
  await page.getByLabel('Código de invitación').fill('e2e-invite');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/app\/today/);
  return page;
}

test('compartir una lista, crear una tarea como miembro, asignarla y salir de la lista', async ({ browser }) => {
  const stamp = Date.now();
  const ownerEmail = `duenio-${stamp}@example.com`;
  const memberEmail = `miembro-${stamp}@example.com`;
  const owner = await register(browser, ownerEmail);
  const member = await register(browser, memberEmail);

  // El dueño crea la lista y agrega al miembro por email.
  await owner.getByRole('button', { name: 'Nueva lista' }).click();
  await owner.getByLabel('Nombre de la lista').fill('Compras');
  await owner.getByRole('button', { name: 'Guardar' }).click();
  await expect(owner).toHaveURL(/\/app\/list\//);
  await owner.getByRole('link', { name: /Compras/ }).hover();
  await owner.getByRole('button', { name: 'Editar Compras' }).click();
  await owner.getByLabel('Email del nuevo miembro').fill(memberEmail);
  await owner.getByRole('button', { name: 'Agregar' }).click();
  await expect(owner.getByRole('dialog').getByText(memberEmail)).toBeVisible();
  await owner.getByRole('button', { name: 'Cerrar', exact: true }).click();

  // El miembro la ve en "Compartidas conmigo" y crea una tarea.
  await member.reload();
  await expect(member.getByText('Compartidas conmigo')).toBeVisible();
  await member.getByRole('link', { name: /Compras/ }).click();
  await expect(member).toHaveURL(/\/app\/list\//);
  await member.getByLabel('Nueva tarea').fill('Comprar leche');
  await member.getByLabel('Nueva tarea').press('Enter');
  await expect(member.getByRole('link', { name: /Comprar leche/ })).toBeVisible();

  // El dueño la ve y se la asigna al miembro.
  await owner.reload();
  await owner.getByRole('link', { name: /Comprar leche/ }).click();
  await owner.getByLabel('Asignada a').selectOption({ label: memberEmail });
  await expect(owner.getByRole('link', { name: /Comprar leche.*Asignada a/ })).toBeVisible();

  // El miembro la encuentra en "Asignadas a mí".
  await member.getByRole('link', { name: 'Asignadas a mí' }).click();
  await expect(member).toHaveURL(/\/app\/assigned/);
  await expect(member.getByRole('link', { name: /Comprar leche/ })).toBeVisible();

  // Sale de la lista: deja de verla y la asignación se limpia.
  await member.getByRole('link', { name: /Compras/ }).hover();
  await member.getByRole('button', { name: 'Miembros de Compras' }).click();
  member.once('dialog', (d) => d.accept());
  await member.getByRole('button', { name: 'Salir de la lista' }).click();
  await expect(member.getByText('Compartidas conmigo')).toHaveCount(0);
  await expect(member.getByRole('link', { name: /Comprar leche/ })).toHaveCount(0);

  await owner.context().close();
  await member.context().close();
});
```

- [ ] **Step 2: Correr las pruebas de punta a punta**

Run: `npm run e2e`
Expected: 2 passed (`flujo.spec.ts` y `compartir.spec.ts`). Si falla por un selector (texto o rol distinto en la UI), corregir la UI o el selector manteniendo la intención del test, y reportarlo.

- [ ] **Step 3: Verificación completa** (PowerShell 5.1 no tiene `&&`: correr de a una)

Run: `npx vitest run`
Expected: PASS (todos).

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run lint`
Expected: sin errores.

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 4: Commit**

```powershell
git add e2e/compartir.spec.ts
git commit -m "test(e2e): compartir lista, asignar tarea y salir de la lista"
```

---

## Autorrevisión

**Cobertura del spec ("Listas compartidas"):**

| Punto del spec | Task(s) |
|---|---|
| Se comparte la lista; la Bandeja nunca | 4 (`addListMember` → "La Bandeja no se puede compartir"), 5 (Bandeja privada) |
| Dueño agrega por email de usuario registrado; `list_members (list_id, user_id, added_at)` PK compuesta | 1, 4, 12 |
| Miembros: ver, crear, editar, completar, mover entre listas accesibles, papelera/restaurar, subtareas | 5 |
| Solo el dueño: renombrar/colorear/borrar lista, agregar/quitar miembros | 3, 4, 12 |
| Un miembro puede salir | 4, 12, 14 |
| La carpeta es del dueño; para el miembro la lista va suelta en "Compartidas conmigo" | 3 (`folderId: null`), 10 |
| Acceso a tareas por lista; `tasks.user_id` = "creada por"; `core` filtra por listas accesibles | 2, 5 (+ `getTaskByExternalId`, decisión documentada) |
| `tasks.assignee_id` nullable, FK `on delete set null`; solo dueño o miembro | 1, 7 |
| Mover a lista sin acceso del asignado / quitar miembro → limpiar asignaciones | 4, 7 (y salir de la lista, y borrar la lista) |
| Hoy / 7 días: propias + compartidas asignadas a mí | 8 |
| Vista "Asignadas a mí" | 8, 10, 14 |
| Vistas de lista muestran todo; Completadas y Papelera: listas accesibles | 5, 8 |
| Etiquetas por usuario; se ven todas; cada uno edita las suyas; vista por etiqueta y barra lateral solo propias | 6, 13 |
| UI: sección "Miembros" (dueño agrega/quita; miembro ve y sale) | 12 |
| UI: selector "Asignada a" en el detalle | 13 |
| UI: avatar con iniciales del asignado en la lista | 11, 13 |
| MCP (`share_list`, `unshare_list`, `list_members`, `leave_list`, `assignee`, vista `assigned`) | Fuera de este plan (no existe aún el servidor MCP); el núcleo queda listo — ver "Decisiones" |

**Búsqueda de placeholders:** sin "TBD", "TODO", "similar a la Task N" ni pasos sin código. Los cambios a archivos existentes muestran la función completa o la línea exacta que se reemplaza.

**Consistencia de nombres y tipos entre tasks:**
- `ListRole` se define solo en `access.ts` (no se re-exporta desde `lists.ts`, para no duplicar el símbolo en el barrel); los clientes lo importan como tipo si lo necesitan.
- `ListWithRole` (`lists.ts`) se usa en `sidebar.tsx` y `list-dialog.tsx`; `task-workspace`/`task-detail`/`task-list` siguen tipando `List[]` (supertipo), y `task-page.tsx` usa `.shared` sobre el resultado de `getLists` (que es `ListWithRole[]`).
- `ListMember` (`members.ts`) se usa en `list-members.tsx`, `task-page.tsx`, `task-workspace.tsx`, `task-detail.tsx`.
- `getListMembers` (núcleo) / `getListMembersAction` (acción); `addListMember`/`addListMemberAction`; `removeListMember`/`removeListMemberAction`; `leaveList`/`leaveListAction`.
- `hydrate(db, viewerId, rows)` — firma cambiada en la Task 6; todas sus llamadas (`getTask`, `getTaskByExternalId`, `listTasks`, `searchTasks`) se actualizan en esa misma task; la Task 7 reemplaza su cuerpo y la Task 8 reescribe `listTasks` ya con `hydrate(db, userId, rows)`.
- Imports de `tasks.ts` evolucionan así: Task 5 `accessibleListIds` → Task 7 `+ canAccessList`, `+ users` → Task 8 `+ ownedListIds`. Ningún import queda sin uso al terminar cada task.
- `TaskView` suma `'assigned'` en la Task 8, junto con el `Record<TaskView, string>` de `[view]/page.tsx` para que `tsc` siga en verde.
- Mensajes de error usados en tests y código coinciden: "Solo el dueño de la lista puede modificarla/borrarla/administrar sus miembros", "La Bandeja no se puede compartir", "No hay ninguna cuenta con ese email", "Ya sos el dueño de esta lista", "Esa persona ya es miembro de la lista", "El dueño no puede salir de su propia lista", "Solo se puede asignar la tarea al dueño o a un miembro de la lista".
