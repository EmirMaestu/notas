# Notas — Plan 1: Núcleo (proyecto, base de datos y lógica de dominio)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Proyecto Next.js con esquema PostgreSQL y una capa de dominio (`src/core/`) completa y testeada para usuarios, carpetas, listas, etiquetas y tareas.

**Architecture:** Next.js (App Router, TypeScript) + Drizzle ORM. Toda la lógica vive en funciones de `src/core/` que reciben `(db, userId, ...)` y filtran por usuario; la web (Plan 2) y el MCP (Plan 3) solo llaman a esta capa. Los tests corren contra PGlite (Postgres en memoria, sin Docker) aplicando las mismas migraciones que producción.

**Tech Stack:** Next.js 15, TypeScript, Drizzle ORM 0.44 + drizzle-kit 0.31, postgres.js, PGlite (tests), Vitest 3, bcryptjs.

**Spec:** `docs/superpowers/specs/2026-10-08-notas-design.md`

**Roadmap de planes:**
1. **Núcleo** (este plan)
2. Web: login/registro + interfaz de 3 columnas + configuración
3. MCP: endpoint `/mcp`, tokens personales y OAuth 2.1
4. Despliegue en VPS (Docker Compose + Caddy + backups) y migración desde TickTick

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/db/schema.ts` | Tablas Drizzle |
| `src/db/types.ts` | Tipo `DB` compartido (prod y tests) |
| `src/db/index.ts` | Cliente de producción (postgres.js) |
| `drizzle/` | Migraciones SQL generadas |
| `src/core/errors.ts` | `NotFoundError`, `ValidationError`, `isUuid` |
| `src/core/dates.ts` | Fechas ISO y zona horaria |
| `src/core/quick-add.ts` | Parser de agregado rápido en español |
| `src/core/users.ts` | Alta de usuario (+ Bandeja), credenciales |
| `src/core/lists.ts` | Carpetas y listas |
| `src/core/tags.ts` | Etiquetas |
| `src/core/tasks.ts` | Tareas: CRUD, vistas, búsqueda, papelera |
| `src/core/index.ts` | Re-exporta la API pública del núcleo |
| `tests/helpers/db.ts` | PGlite en memoria + usuario de prueba |
| `tests/core/*.test.ts` | Tests de cada módulo |

---

### Task 1: Scaffold del proyecto y herramientas

**Files:**
- Create: proyecto Next.js en la raíz del repo, `vitest.config.ts`, `drizzle.config.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Generar Next.js en una carpeta temporal y moverlo a la raíz**

```bash
npx create-next-app@15 .scaffold --ts --app --src-dir --tailwind --eslint --import-alias "@/*" --use-npm --no-turbopack --skip-install --yes
cp -r .scaffold/. .
rm -rf .scaffold
```

Expected: existen `package.json`, `src/app/page.tsx`, `tsconfig.json` en la raíz; `docs/` intacto.

- [ ] **Step 2: Instalar dependencias**

```bash
npm install
npm install drizzle-orm@0.44 postgres@3 bcryptjs@2.4.3
npm install -D drizzle-kit@0.31 vitest@3 @electric-sql/pglite@0.3 @types/bcryptjs@2
```

- [ ] **Step 3: Crear `vitest.config.ts`**

```ts
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
  },
});
```

- [ ] **Step 4: Crear `drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/notas' },
});
```

- [ ] **Step 5: Agregar scripts a `package.json`** (dentro de `"scripts"`, sin borrar los existentes)

```json
"test": "vitest run",
"test:watch": "vitest",
"typecheck": "tsc --noEmit",
"db:generate": "drizzle-kit generate"
```

- [ ] **Step 6: Verificar**

Run: `npx vitest run --passWithNoTests && npm run build`
Expected: vitest sin errores ("No test files found" aceptado), build de Next.js exitoso.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js con Drizzle y Vitest"
```

---

### Task 2: Utilidades de fechas

**Files:**
- Create: `src/core/dates.ts`
- Test: `tests/core/dates.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, expect, it } from 'vitest';
import { addDays, dayOfWeek, isValidIsoDate, isValidTime, isValidTimezone, todayIn } from '@/core/dates';

describe('todayIn', () => {
  it('devuelve la fecha local de la zona horaria', () => {
    // 02:00 UTC del 9/10 = 23:00 del 8/10 en Buenos Aires
    expect(todayIn('America/Argentina/Buenos_Aires', new Date('2026-10-09T02:00:00Z'))).toBe('2026-10-08');
    expect(todayIn('UTC', new Date('2026-10-09T02:00:00Z'))).toBe('2026-10-09');
  });
});

describe('addDays', () => {
  it('suma días cruzando meses y años', () => {
    expect(addDays('2026-10-08', 1)).toBe('2026-10-09');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-10-08', -8)).toBe('2026-09-30');
  });
});

describe('dayOfWeek', () => {
  it('0 = domingo ... 4 = jueves', () => {
    expect(dayOfWeek('2026-10-08')).toBe(4);
    expect(dayOfWeek('2026-10-11')).toBe(0);
  });
});

describe('validaciones', () => {
  it('isValidIsoDate', () => {
    expect(isValidIsoDate('2026-10-08')).toBe(true);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('08/10/2026')).toBe(false);
  });
  it('isValidTime', () => {
    expect(isValidTime('09:30')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('9:30')).toBe(false);
  });
  it('isValidTimezone', () => {
    expect(isValidTimezone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(isValidTimezone('Marte/Olympus')).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/core/dates.test.ts`
Expected: FAIL — no se puede resolver `@/core/dates`.

- [ ] **Step 3: Implementar `src/core/dates.ts`**

```ts
/** Fecha de hoy (YYYY-MM-DD) en la zona horaria indicada. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function parseIso(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

export function addDays(isoDate: string, days: number): string {
  const d = parseIso(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = domingo, 6 = sábado. */
export function dayOfWeek(isoDate: string): number {
  return parseIso(isoDate).getUTCDay();
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = parseIso(value);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run tests/core/dates.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/dates.ts tests/core/dates.test.ts
git commit -m "feat(core): utilidades de fechas y zona horaria"
```

---

### Task 3: Parser de agregado rápido

**Files:**
- Create: `src/core/quick-add.ts`
- Test: `tests/core/quick-add.test.ts`

Reglas: `#etiqueta` (varias), `!alta` / `!media` / `!baja`, y una fecha: `hoy`, `mañana`, `pasado mañana`, día de la semana (opcionalmente con "el"; siempre la próxima ocurrencia estrictamente posterior a hoy), o `dd/mm[/aaaa]` (sin año: este año, o el siguiente si ya pasó). Se toma la primera fecha que aparezca según ese orden de prioridad; el resto del texto es el título.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '@/core/quick-add';

const TODAY = '2026-10-08'; // jueves

describe('parseQuickAdd', () => {
  it('texto simple queda como título', () => {
    expect(parseQuickAdd('Comprar pan', TODAY)).toEqual({ title: 'Comprar pan', dueDate: null, priority: 0, tags: [] });
  });

  it('extrae etiquetas, prioridad y fecha', () => {
    expect(parseQuickAdd('Comprar pan mañana !alta #casa #super', TODAY)).toEqual({
      title: 'Comprar pan',
      dueDate: '2026-10-09',
      priority: 5,
      tags: ['casa', 'super'],
    });
  });

  it('hoy / pasado mañana', () => {
    expect(parseQuickAdd('Llamar hoy', TODAY).dueDate).toBe('2026-10-08');
    expect(parseQuickAdd('Llamar pasado mañana', TODAY)).toMatchObject({ title: 'Llamar', dueDate: '2026-10-10' });
  });

  it('días de la semana: próxima ocurrencia', () => {
    expect(parseQuickAdd('Reunión el lunes', TODAY)).toMatchObject({ title: 'Reunión', dueDate: '2026-10-12' });
    expect(parseQuickAdd('Reunión viernes', TODAY).dueDate).toBe('2026-10-09');
    expect(parseQuickAdd('Reunión jueves', TODAY).dueDate).toBe('2026-10-15');
    expect(parseQuickAdd('Asado el sábado', TODAY).dueDate).toBe('2026-10-10');
    expect(parseQuickAdd('Asado el sabado', TODAY).dueDate).toBe('2026-10-10');
  });

  it('fechas dd/mm', () => {
    expect(parseQuickAdd('Pagar luz 15/10', TODAY)).toMatchObject({ title: 'Pagar luz', dueDate: '2026-10-15' });
    expect(parseQuickAdd('Pagar 1/1', TODAY).dueDate).toBe('2027-01-01');
    expect(parseQuickAdd('Pagar 3/2/2028', TODAY).dueDate).toBe('2028-02-03');
    expect(parseQuickAdd('Pagar 31/2', TODAY)).toMatchObject({ title: 'Pagar 31/2', dueDate: null });
  });

  it('prioridades media y baja, en mayúsculas también', () => {
    expect(parseQuickAdd('Algo !Media', TODAY)).toMatchObject({ title: 'Algo', priority: 3 });
    expect(parseQuickAdd('Algo !baja', TODAY).priority).toBe(1);
  });

  it('no confunde palabras que contienen la fecha', () => {
    expect(parseQuickAdd('Mañanas de yoga', TODAY)).toMatchObject({ title: 'Mañanas de yoga', dueDate: null });
  });

  it('etiquetas en minúscula y sin duplicar', () => {
    expect(parseQuickAdd('X #Casa #casa', TODAY).tags).toEqual(['casa']);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/core/quick-add.test.ts`
Expected: FAIL — no se puede resolver `@/core/quick-add`.

- [ ] **Step 3: Implementar `src/core/quick-add.ts`**

```ts
import { addDays, dayOfWeek, isValidIsoDate } from './dates';

export interface QuickAddResult {
  title: string;
  dueDate: string | null;
  priority: 0 | 1 | 3 | 5;
  tags: string[];
}

const PRIORITY_WORDS: Record<string, 1 | 3 | 5> = { baja: 1, media: 3, alta: 5 };

const WEEKDAYS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, 'miércoles': 3,
  jueves: 4, viernes: 5, sabado: 6, 'sábado': 6,
};

// Límites de palabra que funcionan con ñ y acentos.
const START = '(?<=^|\\s)';
const END = '(?=\\s|$)';

type DateRule = { re: RegExp; resolve: (m: RegExpMatchArray, today: string) => string | null };

const DATE_RULES: DateRule[] = [
  { re: new RegExp(`${START}pasado mañana${END}`, 'i'), resolve: (_m, t) => addDays(t, 2) },
  { re: new RegExp(`${START}hoy${END}`, 'i'), resolve: (_m, t) => t },
  { re: new RegExp(`${START}mañana${END}`, 'i'), resolve: (_m, t) => addDays(t, 1) },
  {
    re: new RegExp(`${START}(?:el\\s+)?(${Object.keys(WEEKDAYS).join('|')})${END}`, 'i'),
    resolve: (m, t) => {
      const target = WEEKDAYS[m[1].toLowerCase()];
      const diff = (target - dayOfWeek(t) + 7) % 7 || 7;
      return addDays(t, diff);
    },
  },
  {
    re: new RegExp(`${START}(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}))?${END}`),
    resolve: (m, t) => {
      const day = m[1].padStart(2, '0');
      const month = m[2].padStart(2, '0');
      if (m[3]) {
        const iso = `${m[3]}-${month}-${day}`;
        return isValidIsoDate(iso) ? iso : null;
      }
      const year = Number(t.slice(0, 4));
      const iso = `${year}-${month}-${day}`;
      if (!isValidIsoDate(iso)) return null;
      return iso < t ? `${year + 1}-${month}-${day}` : iso;
    },
  },
];

export function parseQuickAdd(text: string, today: string): QuickAddResult {
  let rest = ` ${text} `;

  const tags: string[] = [];
  rest = rest.replace(/(?<=\s)#([\p{L}\p{N}_-]+)(?=\s)/gu, (_all, name: string) => {
    const tag = name.toLowerCase();
    if (!tags.includes(tag)) tags.push(tag);
    return ' ';
  });

  let priority: QuickAddResult['priority'] = 0;
  rest = rest.replace(/(?<=\s)!(alta|media|baja)(?=\s)/i, (_all, word: string) => {
    priority = PRIORITY_WORDS[word.toLowerCase()];
    return ' ';
  });

  let dueDate: string | null = null;
  for (const rule of DATE_RULES) {
    const match = rest.match(rule.re);
    if (!match) continue;
    const resolved = rule.resolve(match, today);
    if (!resolved) continue;
    dueDate = resolved;
    rest = rest.replace(match[0], ' ');
    break;
  }

  return { title: rest.replace(/\s+/g, ' ').trim(), dueDate, priority, tags };
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run tests/core/quick-add.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/quick-add.ts tests/core/quick-add.test.ts
git commit -m "feat(core): parser de agregado rápido en español"
```

---

### Task 4: Esquema de base de datos, migración y helper de tests

**Files:**
- Create: `src/db/schema.ts`, `src/db/types.ts`, `src/db/index.ts`, `src/core/errors.ts`, `tests/helpers/db.ts`, `drizzle/*` (generado)
- Test: `tests/core/schema.test.ts`

- [ ] **Step 1: Crear `src/db/schema.ts`**

```ts
import {
  boolean, date, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull().default(''),
  timezone: text('timezone').notNull().default('America/Argentina/Buenos_Aires'),
  createdAt: createdAt(),
});

export const folders = pgTable('folders', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  externalId: text('external_id'),
}, (t) => [
  index('folders_user_idx').on(t.userId),
  uniqueIndex('folders_user_external_idx').on(t.userId, t.externalId),
]);

export const lists = pgTable('lists', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  color: text('color'),
  sortOrder: integer('sort_order').notNull().default(0),
  isInbox: boolean('is_inbox').notNull().default(false),
  externalId: text('external_id'),
}, (t) => [
  index('lists_user_idx').on(t.userId),
  uniqueIndex('lists_user_external_idx').on(t.userId, t.externalId),
]);

export const tasks = pgTable('tasks', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  listId: uuid('list_id').notNull().references(() => lists.id, { onDelete: 'cascade' }),
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
  uniqueIndex('tasks_user_external_idx').on(t.userId, t.externalId),
]);

export const subtasks = pgTable('subtasks', {
  id: id(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  done: boolean('done').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [index('subtasks_task_idx').on(t.taskId)]);

export const tags = pgTable('tags', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color'),
}, (t) => [uniqueIndex('tags_user_name_idx').on(t.userId, t.name)]);

export const taskTags = pgTable('task_tags', {
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.taskId, t.tagId] })]);
```

- [ ] **Step 2: Crear `src/db/types.ts`**

```ts
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

// `any` en el HKT permite pasar tanto la base de producción (postgres.js) como la de tests (PGlite).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DB = PgDatabase<any, typeof schema>;
```

- [ ] **Step 3: Crear `src/db/index.ts`**

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import type { DB } from './types';

const client = postgres(process.env.DATABASE_URL ?? 'postgres://localhost:5432/notas');

export const db: DB = drizzle(client, { schema });
```

- [ ] **Step 4: Crear `src/core/errors.ts`**

```ts
/** El recurso no existe o pertenece a otro usuario (no se distingue a propósito). */
export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} no existe`);
    this.name = 'NotFoundError';
  }
}

/** Datos de entrada inválidos; el mensaje es apto para mostrar al usuario o a la IA. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
```

- [ ] **Step 5: Generar la migración inicial**

Run: `npm run db:generate`
Expected: se crea `drizzle/0000_*.sql` con `CREATE TABLE` para las 7 tablas y `drizzle/meta/`.

- [ ] **Step 6: Crear `tests/helpers/db.ts`**

```ts
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '@/db/schema';
import type { DB } from '@/db/types';

/** Base Postgres en memoria con las migraciones reales aplicadas. */
export async function createTestDb(): Promise<DB> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: './drizzle' });
  return db as unknown as DB;
}
```

- [ ] **Step 7: Escribir `tests/core/schema.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb } from '../helpers/db';

describe('migraciones', () => {
  it('crean todas las tablas', async () => {
    const db = await createTestDb();
    const result = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const names = (result as unknown as { rows: { table_name: string }[] }).rows.map((r) => r.table_name);
    expect(names).toEqual(['folders', 'lists', 'subtasks', 'tags', 'task_tags', 'tasks', 'users']);
  });
});
```

- [ ] **Step 8: Correr y verificar que pasa**

Run: `npx vitest run tests/core/schema.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/db src/core/errors.ts drizzle tests/helpers tests/core/schema.test.ts
git commit -m "feat(db): esquema inicial, migración y base de tests en memoria"
```

---

### Task 5: Usuarios

**Files:**
- Create: `src/core/users.ts`
- Modify: `tests/helpers/db.ts` (agregar `createTestUser`)
- Test: `tests/core/users.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { lists } from '@/db/schema';
import type { DB } from '@/db/types';
import { NotFoundError, ValidationError } from '@/core/errors';
import { createUser, getUser, updateUserTimezone, verifyCredentials } from '@/core/users';
import { createTestDb } from '../helpers/db';

let db: DB;
beforeEach(async () => {
  db = await createTestDb();
});

describe('createUser', () => {
  it('crea el usuario con su Bandeja y zona horaria por defecto', async () => {
    const user = await createUser(db, { email: '  Emir@Example.com ', password: 'contraseña-segura', name: 'Emir' });
    expect(user.email).toBe('emir@example.com');
    expect(user.timezone).toBe('America/Argentina/Buenos_Aires');
    expect(user.passwordHash).not.toBe('contraseña-segura');
    const userLists = await db.select().from(lists).where(eq(lists.userId, user.id));
    expect(userLists).toHaveLength(1);
    expect(userLists[0]).toMatchObject({ name: 'Bandeja', isInbox: true });
  });

  it('rechaza email duplicado, inválido, contraseña corta y zona inválida', async () => {
    await createUser(db, { email: 'a@b.com', password: '12345678' });
    await expect(createUser(db, { email: 'A@B.com', password: '12345678' })).rejects.toThrow(ValidationError);
    await expect(createUser(db, { email: 'no-es-email', password: '12345678' })).rejects.toThrow('Email inválido');
    await expect(createUser(db, { email: 'c@d.com', password: '1234' })).rejects.toThrow(ValidationError);
    await expect(createUser(db, { email: 'e@f.com', password: '12345678', timezone: 'Marte/X' })).rejects.toThrow(ValidationError);
  });
});

describe('verifyCredentials', () => {
  it('valida email y contraseña', async () => {
    const user = await createUser(db, { email: 'a@b.com', password: 'contraseña-segura' });
    expect((await verifyCredentials(db, 'A@b.com', 'contraseña-segura'))?.id).toBe(user.id);
    expect(await verifyCredentials(db, 'a@b.com', 'otra-cosa')).toBeNull();
    expect(await verifyCredentials(db, 'nadie@b.com', 'contraseña-segura')).toBeNull();
  });
});

describe('getUser / updateUserTimezone', () => {
  it('obtiene y actualiza la zona horaria', async () => {
    const user = await createUser(db, { email: 'a@b.com', password: '12345678' });
    expect((await getUser(db, user.id)).email).toBe('a@b.com');
    expect((await updateUserTimezone(db, user.id, 'Europe/Madrid')).timezone).toBe('Europe/Madrid');
    await expect(updateUserTimezone(db, user.id, 'Marte/X')).rejects.toThrow(ValidationError);
  });

  it('lanza NotFoundError con id inexistente o mal formado', async () => {
    await expect(getUser(db, 'no-es-uuid')).rejects.toThrow(NotFoundError);
    await expect(getUser(db, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(NotFoundError);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/core/users.test.ts`
Expected: FAIL — no se puede resolver `@/core/users`.

- [ ] **Step 3: Implementar `src/core/users.ts`**

```ts
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { lists, users } from '@/db/schema';
import type { DB } from '@/db/types';
import { isValidTimezone } from './dates';
import { NotFoundError, ValidationError, isUuid } from './errors';

export type User = typeof users.$inferSelect;

export const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CreateUserInput {
  email: string;
  password: string;
  name?: string;
  timezone?: string;
}

function checkTimezone(timezone: string): string {
  if (!isValidTimezone(timezone)) throw new ValidationError(`Zona horaria inválida: ${timezone}`);
  return timezone;
}

/** Crea el usuario y su lista Bandeja. */
export async function createUser(db: DB, input: CreateUserInput): Promise<User> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new ValidationError('Email inválido');
  if (input.password.length < 8) throw new ValidationError('La contraseña debe tener al menos 8 caracteres');
  const timezone = checkTimezone(input.timezone ?? DEFAULT_TIMEZONE);

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) throw new ValidationError('Ya existe un usuario con ese email');

  const passwordHash = await bcrypt.hash(input.password, 10);
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ email, passwordHash, name: input.name?.trim() ?? '', timezone })
      .returning();
    await tx.insert(lists).values({ userId: user.id, name: 'Bandeja', isInbox: true });
    return user;
  });
}

export async function verifyCredentials(db: DB, email: string, password: string): Promise<User | null> {
  const user = await db.query.users.findFirst({ where: eq(users.email, email.trim().toLowerCase()) });
  if (!user) return null;
  return (await bcrypt.compare(password, user.passwordHash)) ? user : null;
}

export async function getUser(db: DB, userId: string): Promise<User> {
  if (!isUuid(userId)) throw new NotFoundError('El usuario');
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new NotFoundError('El usuario');
  return user;
}

export async function updateUserTimezone(db: DB, userId: string, timezone: string): Promise<User> {
  checkTimezone(timezone);
  await getUser(db, userId);
  const [user] = await db.update(users).set({ timezone }).where(eq(users.id, userId)).returning();
  return user;
}
```

- [ ] **Step 4: Agregar `createTestUser` al final de `tests/helpers/db.ts`**

```ts
import { createUser } from '@/core/users';

export async function createTestUser(db: DB, email = 'emir@example.com') {
  return createUser(db, { email, password: 'contraseña-segura', name: 'Emir' });
}
```

(Mover el `import` junto a los demás imports del archivo.)

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npx vitest run tests/core/users.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/users.ts tests/helpers/db.ts tests/core/users.test.ts
git commit -m "feat(core): alta de usuarios con Bandeja y credenciales"
```

---

### Task 6: Carpetas y listas

**Files:**
- Create: `src/core/lists.ts`
- Test: `tests/core/lists.test.ts`

Nota: `deleteList` envía las tareas de la lista a la papelera y las reasigna a la Bandeja (así se pueden restaurar).

- [ ] **Step 1: Escribir el test que falla**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { tasks } from '@/db/schema';
import type { DB } from '@/db/types';
import { NotFoundError, ValidationError } from '@/core/errors';
import {
  createFolder, createList, deleteFolder, deleteList, getInbox, getList, listFolders, listLists, renameFolder, updateList,
} from '@/core/lists';
import type { User } from '@/core/users';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
let user: User;
let other: User;
beforeEach(async () => {
  db = await createTestDb();
  user = await createTestUser(db);
  other = await createTestUser(db, 'otro@example.com');
});

describe('listas', () => {
  it('crea y lista con la Bandeja primero', async () => {
    await createList(db, user.id, { name: 'Trabajo', color: '#3366ff' });
    await createList(db, user.id, { name: '  Casa ' });
    const names = (await listLists(db, user.id)).map((l) => l.name);
    expect(names).toEqual(['Bandeja', 'Casa', 'Trabajo']);
    expect(await listLists(db, other.id)).toHaveLength(1);
  });

  it('valida nombre y color', async () => {
    await expect(createList(db, user.id, { name: '   ' })).rejects.toThrow(ValidationError);
    await expect(createList(db, user.id, { name: 'X', color: 'rojo' })).rejects.toThrow(ValidationError);
  });

  it('no permite acceder a listas de otro usuario', async () => {
    const list = await createList(db, other.id, { name: 'Privada' });
    await expect(getList(db, user.id, list.id)).rejects.toThrow(NotFoundError);
    await expect(updateList(db, user.id, list.id, { name: 'Hack' })).rejects.toThrow(NotFoundError);
    await expect(getList(db, user.id, 'basura')).rejects.toThrow(NotFoundError);
  });

  it('actualiza nombre, color y carpeta', async () => {
    const folder = await createFolder(db, user.id, { name: 'Personal' });
    const list = await createList(db, user.id, { name: 'Casa' });
    const updated = await updateList(db, user.id, list.id, { name: 'Hogar', color: '#00aa00', folderId: folder.id });
    expect(updated).toMatchObject({ name: 'Hogar', color: '#00aa00', folderId: folder.id });
    expect((await updateList(db, user.id, list.id, { folderId: null })).folderId).toBeNull();
  });

  it('la Bandeja no se puede renombrar ni borrar', async () => {
    const inbox = await getInbox(db, user.id);
    await expect(updateList(db, user.id, inbox.id, { name: 'Otra' })).rejects.toThrow(ValidationError);
    await expect(deleteList(db, user.id, inbox.id)).rejects.toThrow(ValidationError);
  });

  it('borrar una lista manda sus tareas a la papelera dentro de la Bandeja', async () => {
    const list = await createList(db, user.id, { name: 'Temporal' });
    await db.insert(tasks).values([
      { userId: user.id, listId: list.id, title: 'a' },
      { userId: user.id, listId: list.id, title: 'b' },
    ]);
    expect(await deleteList(db, user.id, list.id)).toEqual({ movedToTrash: 2 });
    const inbox = await getInbox(db, user.id);
    const rows = await db.select().from(tasks).where(eq(tasks.userId, user.id));
    expect(rows.every((t) => t.listId === inbox.id && t.deletedAt !== null)).toBe(true);
    await expect(getList(db, user.id, list.id)).rejects.toThrow(NotFoundError);
  });
});

describe('carpetas', () => {
  it('crea, renombra, lista y borra (las listas quedan sin carpeta)', async () => {
    const folder = await createFolder(db, user.id, { name: 'Trabajo' });
    const list = await createList(db, user.id, { name: 'Clientes', folderId: folder.id });
    expect((await renameFolder(db, user.id, folder.id, 'Laburo')).name).toBe('Laburo');
    expect((await listFolders(db, user.id)).map((f) => f.name)).toEqual(['Laburo']);
    await deleteFolder(db, user.id, folder.id);
    expect(await listFolders(db, user.id)).toEqual([]);
    expect((await getList(db, user.id, list.id)).folderId).toBeNull();
  });

  it('no permite usar carpetas de otro usuario', async () => {
    const folder = await createFolder(db, other.id, { name: 'Ajena' });
    await expect(createList(db, user.id, { name: 'X', folderId: folder.id })).rejects.toThrow(NotFoundError);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/core/lists.test.ts`
Expected: FAIL — no se puede resolver `@/core/lists`.

- [ ] **Step 3: Implementar `src/core/lists.ts`**

```ts
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { folders, lists, tasks } from '@/db/schema';
import type { DB } from '@/db/types';
import { NotFoundError, ValidationError, isUuid } from './errors';

export type List = typeof lists.$inferSelect;
export type Folder = typeof folders.$inferSelect;

function cleanName(name: string): string {
  const clean = name.trim();
  if (!clean) throw new ValidationError('El nombre no puede estar vacío');
  if (clean.length > 100) throw new ValidationError('El nombre no puede superar los 100 caracteres');
  return clean;
}

function checkColor(color: string | null | undefined): string | null | undefined {
  if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new ValidationError(`Color inválido: ${color} (usá formato #rrggbb)`);
  return color;
}

// ---------- Carpetas ----------

export async function listFolders(db: DB, userId: string): Promise<Folder[]> {
  return db.select().from(folders).where(eq(folders.userId, userId)).orderBy(asc(folders.sortOrder), asc(folders.name));
}

export async function getFolder(db: DB, userId: string, folderId: string): Promise<Folder> {
  if (!isUuid(folderId)) throw new NotFoundError('La carpeta');
  const [folder] = await db.select().from(folders).where(and(eq(folders.id, folderId), eq(folders.userId, userId)));
  if (!folder) throw new NotFoundError('La carpeta');
  return folder;
}

export async function createFolder(db: DB, userId: string, input: { name: string; externalId?: string }): Promise<Folder> {
  const [folder] = await db
    .insert(folders)
    .values({ userId, name: cleanName(input.name), externalId: input.externalId ?? null })
    .returning();
  return folder;
}

export async function renameFolder(db: DB, userId: string, folderId: string, name: string): Promise<Folder> {
  const folder = await getFolder(db, userId, folderId);
  const [updated] = await db.update(folders).set({ name: cleanName(name) }).where(eq(folders.id, folder.id)).returning();
  return updated;
}

/** Borra la carpeta; sus listas quedan sueltas (no se borran). */
export async function deleteFolder(db: DB, userId: string, folderId: string): Promise<void> {
  const folder = await getFolder(db, userId, folderId);
  await db.delete(folders).where(eq(folders.id, folder.id));
}

// ---------- Listas ----------

export async function getInbox(db: DB, userId: string): Promise<List> {
  const [inbox] = await db.select().from(lists).where(and(eq(lists.userId, userId), eq(lists.isInbox, true)));
  if (!inbox) throw new NotFoundError('La Bandeja');
  return inbox;
}

export async function listLists(db: DB, userId: string): Promise<List[]> {
  return db
    .select()
    .from(lists)
    .where(eq(lists.userId, userId))
    .orderBy(desc(lists.isInbox), asc(lists.sortOrder), asc(lists.name));
}

export async function getList(db: DB, userId: string, listId: string): Promise<List> {
  if (!isUuid(listId)) throw new NotFoundError('La lista');
  const [list] = await db.select().from(lists).where(and(eq(lists.id, listId), eq(lists.userId, userId)));
  if (!list) throw new NotFoundError('La lista');
  return list;
}

export interface CreateListInput {
  name: string;
  color?: string | null;
  folderId?: string | null;
  externalId?: string;
}

export async function createList(db: DB, userId: string, input: CreateListInput): Promise<List> {
  const name = cleanName(input.name);
  const color = checkColor(input.color) ?? null;
  const folderId = input.folderId ? (await getFolder(db, userId, input.folderId)).id : null;
  const [list] = await db
    .insert(lists)
    .values({ userId, name, color, folderId, externalId: input.externalId ?? null })
    .returning();
  return list;
}

export interface UpdateListInput {
  name?: string;
  color?: string | null;
  folderId?: string | null;
  sortOrder?: number;
}

export async function updateList(db: DB, userId: string, listId: string, input: UpdateListInput): Promise<List> {
  const list = await getList(db, userId, listId);
  const patch: Partial<typeof lists.$inferInsert> = {};
  if (input.name !== undefined) {
    if (list.isInbox) throw new ValidationError('La Bandeja no se puede renombrar');
    patch.name = cleanName(input.name);
  }
  if (input.color !== undefined) patch.color = checkColor(input.color);
  if (input.folderId !== undefined) {
    patch.folderId = input.folderId === null ? null : (await getFolder(db, userId, input.folderId)).id;
  }
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
  if (Object.keys(patch).length === 0) return list;
  const [updated] = await db.update(lists).set(patch).where(eq(lists.id, list.id)).returning();
  return updated;
}

/** Borra la lista. Sus tareas pasan a la papelera, asignadas a la Bandeja para poder restaurarlas. */
export async function deleteList(db: DB, userId: string, listId: string): Promise<{ movedToTrash: number }> {
  const list = await getList(db, userId, listId);
  if (list.isInbox) throw new ValidationError('La Bandeja no se puede borrar');
  const inbox = await getInbox(db, userId);
  return db.transaction(async (tx) => {
    const now = new Date();
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

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run tests/core/lists.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/lists.ts tests/core/lists.test.ts
git commit -m "feat(core): carpetas y listas con Bandeja protegida"
```

---

### Task 7: Etiquetas

**Files:**
- Create: `src/core/tags.ts`
- Test: `tests/core/tags.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '@/db/types';
import { ValidationError } from '@/core/errors';
import { createTag, ensureTags, listTags, normalizeTagName } from '@/core/tags';
import type { User } from '@/core/users';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
let user: User;
beforeEach(async () => {
  db = await createTestDb();
  user = await createTestUser(db);
});

describe('etiquetas', () => {
  it('normaliza nombres', () => {
    expect(normalizeTagName('  #Casa ')).toBe('casa');
    expect(() => normalizeTagName('#')).toThrow(ValidationError);
    expect(() => normalizeTagName('dos palabras')).toThrow(ValidationError);
  });

  it('createTag es idempotente y guarda color', async () => {
    const a = await createTag(db, user.id, { name: 'Casa', color: '#ff0000' });
    const b = await createTag(db, user.id, { name: '#casa' });
    expect(b.id).toBe(a.id);
    expect(b.color).toBe('#ff0000');
    expect((await listTags(db, user.id)).map((t) => t.name)).toEqual(['casa']);
  });

  it('ensureTags crea solo las que faltan', async () => {
    await createTag(db, user.id, { name: 'casa' });
    const tags = await ensureTags(db, user.id, ['Casa', 'super', 'super']);
    expect(tags.map((t) => t.name).sort()).toEqual(['casa', 'super']);
    expect(await listTags(db, user.id)).toHaveLength(2);
    expect(await ensureTags(db, user.id, [])).toEqual([]);
  });

  it('las etiquetas son por usuario', async () => {
    const other = await createTestUser(db, 'otro@example.com');
    await createTag(db, other.id, { name: 'secreta' });
    expect(await listTags(db, user.id)).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/core/tags.test.ts`
Expected: FAIL — no se puede resolver `@/core/tags`.

- [ ] **Step 3: Implementar `src/core/tags.ts`**

```ts
import { and, asc, eq, inArray } from 'drizzle-orm';
import { tags } from '@/db/schema';
import type { DB } from '@/db/types';
import { ValidationError } from './errors';

export type Tag = typeof tags.$inferSelect;

export function normalizeTagName(name: string): string {
  const clean = name.trim().replace(/^#+/, '').toLowerCase();
  if (!clean) throw new ValidationError('El nombre de la etiqueta no puede estar vacío');
  if (/\s/.test(clean)) throw new ValidationError(`La etiqueta "${clean}" no puede tener espacios`);
  return clean;
}

export async function listTags(db: DB, userId: string): Promise<Tag[]> {
  return db.select().from(tags).where(eq(tags.userId, userId)).orderBy(asc(tags.name));
}

/** Devuelve las etiquetas pedidas, creando las que no existen. */
export async function ensureTags(db: DB, userId: string, names: string[]): Promise<Tag[]> {
  const normalized = [...new Set(names.map(normalizeTagName))];
  if (normalized.length === 0) return [];
  await db
    .insert(tags)
    .values(normalized.map((name) => ({ userId, name })))
    .onConflictDoNothing({ target: [tags.userId, tags.name] });
  return db.select().from(tags).where(and(eq(tags.userId, userId), inArray(tags.name, normalized)));
}

/** Crea la etiqueta o devuelve la existente; si se pasa color, lo actualiza. */
export async function createTag(db: DB, userId: string, input: { name: string; color?: string | null }): Promise<Tag> {
  const [tag] = await ensureTags(db, userId, [input.name]);
  if (input.color === undefined) return tag;
  const [updated] = await db.update(tags).set({ color: input.color }).where(eq(tags.id, tag.id)).returning();
  return updated;
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run tests/core/tags.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/tags.ts tests/core/tags.test.ts
git commit -m "feat(core): etiquetas por usuario"
```

---

### Task 8: Tareas — alta, edición y acciones

**Files:**
- Create: `src/core/tasks.ts`
- Test: `tests/core/tasks-crud.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '@/db/types';
import { NotFoundError, ValidationError } from '@/core/errors';
import { createList, getInbox } from '@/core/lists';
import {
  completeTask, createTask, deleteTask, getTask, moveTask, restoreTask, setSubtaskDone, uncompleteTask, updateTask,
} from '@/core/tasks';
import type { User } from '@/core/users';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
let user: User;
let other: User;
beforeEach(async () => {
  db = await createTestDb();
  user = await createTestUser(db);
  other = await createTestUser(db, 'otro@example.com');
});

describe('createTask', () => {
  it('por defecto va a la Bandeja, pendiente y sin prioridad', async () => {
    const task = await createTask(db, user.id, { title: '  Comprar pan ' });
    expect(task).toMatchObject({
      title: 'Comprar pan', listId: (await getInbox(db, user.id)).id, status: 'pending', priority: 0,
      dueDate: null, dueTime: null, description: '', tags: [], subtasks: [],
    });
  });

  it('acepta todos los campos', async () => {
    const list = await createList(db, user.id, { name: 'Casa' });
    const task = await createTask(db, user.id, {
      title: 'Limpiar', description: 'Toda la casa', listId: list.id, dueDate: '2026-10-10', dueTime: '09:30',
      priority: 5, tags: ['#Casa', 'finde'], subtasks: ['Cocina', { title: 'Baño', done: true }],
    });
    expect(task).toMatchObject({ listId: list.id, dueDate: '2026-10-10', dueTime: '09:30', priority: 5, tags: ['casa', 'finde'] });
    expect(task.subtasks.map((s) => [s.title, s.done])).toEqual([['Cocina', false], ['Baño', true]]);
  });

  it('valida los datos', async () => {
    await expect(createTask(db, user.id, { title: '  ' })).rejects.toThrow(ValidationError);
    await expect(createTask(db, user.id, { title: 'x', dueDate: '10/10/2026' })).rejects.toThrow('Fecha inválida');
    await expect(createTask(db, user.id, { title: 'x', dueTime: '09:00' })).rejects.toThrow('hora sin fecha');
    await expect(createTask(db, user.id, { title: 'x', dueDate: '2026-10-10', dueTime: '9am' })).rejects.toThrow(ValidationError);
    await expect(createTask(db, user.id, { title: 'x', priority: 2 })).rejects.toThrow('Prioridad inválida');
  });

  it('no permite usar listas de otro usuario', async () => {
    const foreign = await createList(db, other.id, { name: 'Ajena' });
    await expect(createTask(db, user.id, { title: 'x', listId: foreign.id })).rejects.toThrow(NotFoundError);
  });

  it('puede crearse completada (para migraciones)', async () => {
    const at = new Date('2026-01-01T10:00:00Z');
    const task = await createTask(db, user.id, { title: 'Vieja', status: 'completed', completedAt: at, externalId: 'tt-1' });
    expect(task).toMatchObject({ status: 'completed', completedAt: at, externalId: 'tt-1' });
  });
});

describe('getTask', () => {
  it('no devuelve tareas de otro usuario', async () => {
    const task = await createTask(db, other.id, { title: 'Secreta' });
    await expect(getTask(db, user.id, task.id)).rejects.toThrow(NotFoundError);
    await expect(getTask(db, user.id, 'no-es-uuid')).rejects.toThrow(NotFoundError);
  });
});

describe('updateTask', () => {
  it('actualiza solo lo indicado', async () => {
    const task = await createTask(db, user.id, { title: 'A', priority: 3, dueDate: '2026-10-10' });
    const updated = await updateTask(db, user.id, task.id, { title: 'B' });
    expect(updated).toMatchObject({ title: 'B', priority: 3, dueDate: '2026-10-10' });
  });

  it('quitar la fecha quita también la hora', async () => {
    const task = await createTask(db, user.id, { title: 'A', dueDate: '2026-10-10', dueTime: '10:00' });
    expect(await updateTask(db, user.id, task.id, { dueDate: null })).toMatchObject({ dueDate: null, dueTime: null });
  });

  it('agregar hora a una tarea con fecha existente', async () => {
    const task = await createTask(db, user.id, { title: 'A', dueDate: '2026-10-10' });
    expect((await updateTask(db, user.id, task.id, { dueTime: '18:00' })).dueTime).toBe('18:00');
  });

  it('reemplaza etiquetas y subtareas', async () => {
    const task = await createTask(db, user.id, { title: 'A', tags: ['x'], subtasks: ['uno'] });
    const updated = await updateTask(db, user.id, task.id, { tags: ['y', 'z'], subtasks: [{ title: 'dos', done: true }] });
    expect(updated.tags).toEqual(['y', 'z']);
    expect(updated.subtasks.map((s) => s.title)).toEqual(['dos']);
  });

  it('no modifica tareas de otro usuario', async () => {
    const task = await createTask(db, other.id, { title: 'Secreta' });
    await expect(updateTask(db, user.id, task.id, { title: 'Hack' })).rejects.toThrow(NotFoundError);
  });
});

describe('acciones', () => {
  it('completar y descompletar', async () => {
    const task = await createTask(db, user.id, { title: 'A' });
    const done = await completeTask(db, user.id, task.id);
    expect(done.status).toBe('completed');
    expect(done.completedAt).toBeInstanceOf(Date);
    expect(await uncompleteTask(db, user.id, task.id)).toMatchObject({ status: 'pending', completedAt: null });
  });

  it('mover de lista', async () => {
    const list = await createList(db, user.id, { name: 'Trabajo' });
    const task = await createTask(db, user.id, { title: 'A' });
    expect((await moveTask(db, user.id, task.id, list.id)).listId).toBe(list.id);
    const foreign = await createList(db, other.id, { name: 'Ajena' });
    await expect(moveTask(db, user.id, task.id, foreign.id)).rejects.toThrow(NotFoundError);
  });

  it('borrar manda a la papelera y restaurar la recupera', async () => {
    const task = await createTask(db, user.id, { title: 'A' });
    await deleteTask(db, user.id, task.id);
    await expect(getTask(db, user.id, task.id)).rejects.toThrow(NotFoundError);
    expect((await getTask(db, user.id, task.id, { includeDeleted: true })).deletedAt).toBeInstanceOf(Date);
    expect((await restoreTask(db, user.id, task.id)).deletedAt).toBeNull();
  });

  it('marcar subtarea', async () => {
    const task = await createTask(db, user.id, { title: 'A', subtasks: ['uno'] });
    const updated = await setSubtaskDone(db, user.id, task.subtasks[0].id, true);
    expect(updated.subtasks[0].done).toBe(true);
    await expect(setSubtaskDone(db, other.id, task.subtasks[0].id, false)).rejects.toThrow(NotFoundError);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/core/tasks-crud.test.ts`
Expected: FAIL — no se puede resolver `@/core/tasks`.

- [ ] **Step 3: Implementar `src/core/tasks.ts`** (las funciones de consulta se agregan en la Task 9)

```ts
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { subtasks, tags, taskTags, tasks } from '@/db/schema';
import type { DB } from '@/db/types';
import { isValidIsoDate, isValidTime } from './dates';
import { NotFoundError, ValidationError, isUuid } from './errors';
import { getInbox, getList } from './lists';
import { ensureTags, normalizeTagName } from './tags';

export type Task = typeof tasks.$inferSelect;
export type Subtask = typeof subtasks.$inferSelect;
export type Priority = 0 | 1 | 3 | 5;
export const PRIORITIES: readonly Priority[] = [0, 1, 3, 5];
export type TaskWithDetails = Task & { subtasks: Subtask[]; tags: string[] };

export interface SubtaskInput {
  title: string;
  done?: boolean;
}

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
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  dueDate?: string | null;
  dueTime?: string | null;
  priority?: number;
  /** Reemplaza todas las etiquetas. */
  tags?: string[];
  /** Reemplaza todas las subtareas. */
  subtasks?: (string | SubtaskInput)[];
}

// ---------- Validación ----------

function cleanTitle(title: string): string {
  const clean = title.trim();
  if (!clean) throw new ValidationError('El título no puede estar vacío');
  if (clean.length > 500) throw new ValidationError('El título no puede superar los 500 caracteres');
  return clean;
}

function checkPriority(priority: number): Priority {
  if (!PRIORITIES.includes(priority as Priority)) {
    throw new ValidationError('Prioridad inválida: usá 0 (ninguna), 1 (baja), 3 (media) o 5 (alta)');
  }
  return priority as Priority;
}

function checkDue(dueDate: string | null, dueTime: string | null) {
  if (dueDate !== null && !isValidIsoDate(dueDate)) {
    throw new ValidationError(`Fecha inválida: ${dueDate} (formato YYYY-MM-DD)`);
  }
  if (dueTime !== null) {
    if (!isValidTime(dueTime)) throw new ValidationError(`Hora inválida: ${dueTime} (formato HH:mm, 24 hs)`);
    if (dueDate === null) throw new ValidationError('No se puede poner hora sin fecha');
  }
  return { dueDate, dueTime };
}

function normalizeSubtasks(items: (string | SubtaskInput)[]): { title: string; done: boolean }[] {
  return items.map((item) =>
    typeof item === 'string'
      ? { title: cleanTitle(item), done: false }
      : { title: cleanTitle(item.title), done: item.done ?? false },
  );
}

// ---------- Lectura ----------

async function hydrate(db: DB, rows: Task[]): Promise<TaskWithDetails[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const subs = await db.select().from(subtasks).where(inArray(subtasks.taskId, ids)).orderBy(asc(subtasks.sortOrder));
  const tagRows = await db
    .select({ taskId: taskTags.taskId, name: tags.name })
    .from(taskTags)
    .innerJoin(tags, eq(tags.id, taskTags.tagId))
    .where(inArray(taskTags.taskId, ids))
    .orderBy(asc(tags.name));
  return rows.map((row) => ({
    ...row,
    subtasks: subs.filter((s) => s.taskId === row.id),
    tags: tagRows.filter((t) => t.taskId === row.id).map((t) => t.name),
  }));
}

async function findTask(db: DB, userId: string, taskId: string, opts: { includeDeleted?: boolean } = {}): Promise<Task> {
  if (!isUuid(taskId)) throw new NotFoundError('La tarea');
  const conditions = [eq(tasks.id, taskId), eq(tasks.userId, userId)];
  if (!opts.includeDeleted) conditions.push(isNull(tasks.deletedAt));
  const [task] = await db.select().from(tasks).where(and(...conditions));
  if (!task) throw new NotFoundError('La tarea');
  return task;
}

export async function getTask(
  db: DB, userId: string, taskId: string, opts: { includeDeleted?: boolean } = {},
): Promise<TaskWithDetails> {
  const [task] = await hydrate(db, [await findTask(db, userId, taskId, opts)]);
  return task;
}

// ---------- Escritura ----------

async function replaceTags(db: DB, userId: string, taskId: string, names: string[]): Promise<void> {
  await db.delete(taskTags).where(eq(taskTags.taskId, taskId));
  const tagRows = await ensureTags(db, userId, names);
  if (tagRows.length) await db.insert(taskTags).values(tagRows.map((t) => ({ taskId, tagId: t.id })));
}

async function replaceSubtasks(db: DB, taskId: string, items: { title: string; done: boolean }[]): Promise<void> {
  await db.delete(subtasks).where(eq(subtasks.taskId, taskId));
  if (items.length) {
    await db.insert(subtasks).values(items.map((s, i) => ({ taskId, title: s.title, done: s.done, sortOrder: i })));
  }
}

export async function createTask(db: DB, userId: string, input: CreateTaskInput): Promise<TaskWithDetails> {
  const title = cleanTitle(input.title);
  const { dueDate, dueTime } = checkDue(input.dueDate ?? null, input.dueTime ?? null);
  const priority = checkPriority(input.priority ?? 0);
  const subtaskItems = normalizeSubtasks(input.subtasks ?? []);
  const tagNames = (input.tags ?? []).map(normalizeTagName);
  const listId = input.listId ? (await getList(db, userId, input.listId)).id : (await getInbox(db, userId)).id;
  const status = input.status ?? 'pending';

  const [task] = await db
    .insert(tasks)
    .values({
      userId, listId, title, dueDate, dueTime, priority, status,
      description: input.description ?? '',
      completedAt: status === 'completed' ? (input.completedAt ?? new Date()) : null,
      externalId: input.externalId ?? null,
    })
    .returning();

  if (subtaskItems.length) await replaceSubtasks(db, task.id, subtaskItems);
  if (tagNames.length) await replaceTags(db, userId, task.id, tagNames);
  return getTask(db, userId, task.id);
}

export async function updateTask(
  db: DB, userId: string, taskId: string, input: UpdateTaskInput,
): Promise<TaskWithDetails> {
  const current = await findTask(db, userId, taskId);
  const patch: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };

  if (input.title !== undefined) patch.title = cleanTitle(input.title);
  if (input.description !== undefined) patch.description = input.description;
  if (input.priority !== undefined) patch.priority = checkPriority(input.priority);
  if (input.dueDate !== undefined || input.dueTime !== undefined) {
    const dueDate = input.dueDate !== undefined ? input.dueDate : current.dueDate;
    let dueTime = input.dueTime !== undefined ? input.dueTime : current.dueTime;
    if (dueDate === null && input.dueTime === undefined) dueTime = null;
    Object.assign(patch, checkDue(dueDate, dueTime));
  }
  const subtaskItems = input.subtasks ? normalizeSubtasks(input.subtasks) : undefined;
  const tagNames = input.tags ? input.tags.map(normalizeTagName) : undefined;

  await db.update(tasks).set(patch).where(eq(tasks.id, current.id));
  if (subtaskItems) await replaceSubtasks(db, current.id, subtaskItems);
  if (tagNames) await replaceTags(db, userId, current.id, tagNames);
  return getTask(db, userId, current.id);
}

async function patchTask(
  db: DB, userId: string, taskId: string, patch: Partial<typeof tasks.$inferInsert>,
  opts: { includeDeleted?: boolean } = {},
): Promise<TaskWithDetails> {
  const task = await findTask(db, userId, taskId, opts);
  await db.update(tasks).set({ ...patch, updatedAt: new Date() }).where(eq(tasks.id, task.id));
  return getTask(db, userId, task.id, opts);
}

export function completeTask(db: DB, userId: string, taskId: string) {
  return patchTask(db, userId, taskId, { status: 'completed', completedAt: new Date() });
}

export function uncompleteTask(db: DB, userId: string, taskId: string) {
  return patchTask(db, userId, taskId, { status: 'pending', completedAt: null });
}

export async function moveTask(db: DB, userId: string, taskId: string, listId: string) {
  const list = await getList(db, userId, listId);
  return patchTask(db, userId, taskId, { listId: list.id });
}

/** Envía la tarea a la papelera (se purga a los 30 días). */
export async function deleteTask(db: DB, userId: string, taskId: string): Promise<void> {
  await patchTask(db, userId, taskId, { deletedAt: new Date() });
}

export function restoreTask(db: DB, userId: string, taskId: string) {
  return patchTask(db, userId, taskId, { deletedAt: null }, { includeDeleted: true });
}

export async function setSubtaskDone(db: DB, userId: string, subtaskId: string, done: boolean) {
  if (!isUuid(subtaskId)) throw new NotFoundError('La subtarea');
  const [row] = await db
    .select({ taskId: subtasks.taskId })
    .from(subtasks)
    .innerJoin(tasks, eq(tasks.id, subtasks.taskId))
    .where(and(eq(subtasks.id, subtaskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)));
  if (!row) throw new NotFoundError('La subtarea');
  await db.update(subtasks).set({ done }).where(eq(subtasks.id, subtaskId));
  return getTask(db, userId, row.taskId);
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run tests/core/tasks-crud.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/tasks.ts tests/core/tasks-crud.test.ts
git commit -m "feat(core): alta, edición, completado, papelera y subtareas"
```

---

### Task 9: Tareas — vistas, búsqueda y purga de papelera

**Files:**
- Modify: `src/core/tasks.ts` (agregar imports y funciones al final)
- Test: `tests/core/tasks-query.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { tasks } from '@/db/schema';
import type { DB } from '@/db/types';
import { createList } from '@/core/lists';
import { completeTask, createTask, deleteTask, listTasks, purgeTrash, searchTasks } from '@/core/tasks';
import type { User } from '@/core/users';
import { createTestDb, createTestUser } from '../helpers/db';

let db: DB;
let user: User;
// 15:00 UTC = 12:00 en Buenos Aires del 8/10
const NOW = new Date('2026-10-08T15:00:00Z');

beforeEach(async () => {
  db = await createTestDb();
  user = await createTestUser(db);
});

const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

describe('vistas', () => {
  beforeEach(async () => {
    await createTask(db, user.id, { title: 'vencida', dueDate: '2026-10-01' });
    await createTask(db, user.id, { title: 'hoy-baja', dueDate: '2026-10-08', priority: 1 });
    await createTask(db, user.id, { title: 'hoy-alta', dueDate: '2026-10-08', priority: 5 });
    await createTask(db, user.id, { title: 'en-6-dias', dueDate: '2026-10-14' });
    await createTask(db, user.id, { title: 'en-7-dias', dueDate: '2026-10-15' });
    await createTask(db, user.id, { title: 'sin-fecha' });
  });

  it('hoy incluye vencidas, ordenadas por fecha y prioridad', async () => {
    expect(titles(await listTasks(db, user.id, { view: 'today', now: NOW }))).toEqual(['vencida', 'hoy-alta', 'hoy-baja']);
  });

  it('próximos 7 días incluye hasta hoy+6', async () => {
    expect(titles(await listTasks(db, user.id, { view: 'next7', now: NOW }))).toEqual(['vencida', 'hoy-alta', 'hoy-baja', 'en-6-dias']);
  });

  it('respeta la zona horaria del usuario', async () => {
    // 02:00 UTC del 9/10 sigue siendo 8/10 en Buenos Aires
    await createTask(db, user.id, { title: 'mañana', dueDate: '2026-10-09' });
    const lateNight = new Date('2026-10-09T02:00:00Z');
    expect(titles(await listTasks(db, user.id, { view: 'today', now: lateNight }))).not.toContain('mañana');
    // 04:00 UTC del 9/10 = 01:00 del 9/10 en Buenos Aires
    const afterMidnight = new Date('2026-10-09T04:00:00Z');
    expect(titles(await listTasks(db, user.id, { view: 'today', now: afterMidnight }))).toContain('mañana');
  });

  it('bandeja muestra pendientes sin fecha al final', async () => {
    const result = titles(await listTasks(db, user.id, { view: 'inbox' }));
    expect(result).toHaveLength(6);
    expect(result.at(-1)).toBe('sin-fecha');
  });
});

describe('filtros', () => {
  it('por lista, por etiqueta, completadas e includeCompleted', async () => {
    const list = await createList(db, user.id, { name: 'Trabajo' });
    await createTask(db, user.id, { title: 'en-lista', listId: list.id, tags: ['urgente'] });
    const done = await createTask(db, user.id, { title: 'hecha', tags: ['urgente'] });
    await completeTask(db, user.id, done.id);
    await createTask(db, user.id, { title: 'suelta' });

    expect(titles(await listTasks(db, user.id, { listId: list.id }))).toEqual(['en-lista']);
    expect(titles(await listTasks(db, user.id, { tag: '#Urgente' }))).toEqual(['en-lista']);
    expect(titles(await listTasks(db, user.id, { tag: 'urgente', includeCompleted: true })).sort()).toEqual(['en-lista', 'hecha']);
    expect(titles(await listTasks(db, user.id, { view: 'completed' }))).toEqual(['hecha']);
  });

  it('papelera', async () => {
    const task = await createTask(db, user.id, { title: 'borrada' });
    await createTask(db, user.id, { title: 'viva' });
    await deleteTask(db, user.id, task.id);
    expect(titles(await listTasks(db, user.id, { view: 'trash' }))).toEqual(['borrada']);
    expect(titles(await listTasks(db, user.id))).toEqual(['viva']);
  });

  it('nunca devuelve tareas de otro usuario', async () => {
    const other = await createTestUser(db, 'otro@example.com');
    await createTask(db, other.id, { title: 'ajena', dueDate: '2026-10-08' });
    expect(await listTasks(db, user.id, { view: 'today', now: NOW })).toEqual([]);
    expect(await searchTasks(db, user.id, 'ajena')).toEqual([]);
  });
});

describe('searchTasks', () => {
  it('busca en título y descripción, sin distinguir mayúsculas', async () => {
    await createTask(db, user.id, { title: 'Llamar al Banco' });
    await createTask(db, user.id, { title: 'Otra', description: 'hablar con el banco' });
    await createTask(db, user.id, { title: 'Nada que ver' });
    expect(titles(await searchTasks(db, user.id, 'BANCO')).sort()).toEqual(['Llamar al Banco', 'Otra']);
  });

  it('trata % y _ como texto literal', async () => {
    await createTask(db, user.id, { title: 'Descuento 50%' });
    await createTask(db, user.id, { title: 'Descuento 500' });
    expect(titles(await searchTasks(db, user.id, '50%'))).toEqual(['Descuento 50%']);
  });
});

describe('purgeTrash', () => {
  it('borra definitivamente solo lo que lleva más de 30 días en la papelera', async () => {
    const old = await createTask(db, user.id, { title: 'vieja' });
    const recent = await createTask(db, user.id, { title: 'reciente' });
    await db.update(tasks).set({ deletedAt: new Date('2026-09-01T00:00:00Z') }).where(eq(tasks.id, old.id));
    await db.update(tasks).set({ deletedAt: new Date('2026-10-01T00:00:00Z') }).where(eq(tasks.id, recent.id));
    expect(await purgeTrash(db, NOW)).toBe(1);
    expect(titles(await listTasks(db, user.id, { view: 'trash' }))).toEqual(['reciente']);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/core/tasks-query.test.ts`
Expected: FAIL — `listTasks` / `searchTasks` / `purgeTrash` no exportados.

- [ ] **Step 3: Ampliar `src/core/tasks.ts`**

Reemplazar las primeras líneas de imports por:

```ts
import { type SQL, and, asc, desc, eq, ilike, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { subtasks, tags, taskTags, tasks } from '@/db/schema';
import type { DB } from '@/db/types';
import { addDays, isValidIsoDate, isValidTime, todayIn } from './dates';
import { NotFoundError, ValidationError, isUuid } from './errors';
import { getInbox, getList } from './lists';
import { ensureTags, normalizeTagName } from './tags';
import { getUser } from './users';
```

Y agregar al final del archivo:

```ts
// ---------- Consultas ----------

export type TaskView = 'inbox' | 'today' | 'next7' | 'completed' | 'trash';

export interface ListTasksFilter {
  view?: TaskView;
  listId?: string;
  tag?: string;
  includeCompleted?: boolean;
  /** Para tests: momento que se toma como "ahora". */
  now?: Date;
}

/**
 * Lista tareas del usuario. "today" y "next7" incluyen vencidas (como TickTick)
 * y se calculan en la zona horaria del usuario.
 */
export async function listTasks(db: DB, userId: string, filter: ListTasksFilter = {}): Promise<TaskWithDetails[]> {
  const { view } = filter;
  const conditions: SQL[] = [eq(tasks.userId, userId)];

  conditions.push(view === 'trash' ? isNotNull(tasks.deletedAt) : isNull(tasks.deletedAt));
  if (view === 'completed') conditions.push(eq(tasks.status, 'completed'));
  else if (view !== 'trash' && !filter.includeCompleted) conditions.push(eq(tasks.status, 'pending'));

  if (view === 'inbox') conditions.push(eq(tasks.listId, (await getInbox(db, userId)).id));
  if (view === 'today' || view === 'next7') {
    const user = await getUser(db, userId);
    const today = todayIn(user.timezone, filter.now);
    const until = view === 'today' ? today : addDays(today, 6);
    conditions.push(isNotNull(tasks.dueDate), lte(tasks.dueDate, until));
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
    view === 'completed' ? [desc(tasks.completedAt)]
    : view === 'trash' ? [desc(tasks.deletedAt)]
    : [sql`${tasks.dueDate} asc nulls last`, desc(tasks.priority), asc(tasks.sortOrder), asc(tasks.createdAt)];

  const rows = await db.select().from(tasks).where(and(...conditions)).orderBy(...order).limit(500);
  return hydrate(db, rows);
}

export async function searchTasks(
  db: DB, userId: string, query: string, opts: { includeCompleted?: boolean } = {},
): Promise<TaskWithDetails[]> {
  const q = query.trim();
  if (!q) throw new ValidationError('La búsqueda no puede estar vacía');
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const conditions: SQL[] = [
    eq(tasks.userId, userId),
    isNull(tasks.deletedAt),
    or(ilike(tasks.title, pattern), ilike(tasks.description, pattern))!,
  ];
  if (!opts.includeCompleted) conditions.push(eq(tasks.status, 'pending'));
  const rows = await db.select().from(tasks).where(and(...conditions)).orderBy(desc(tasks.updatedAt)).limit(50);
  return hydrate(db, rows);
}

/** Borra definitivamente las tareas que llevan más de `days` días en la papelera. Devuelve cuántas. */
export async function purgeTrash(db: DB, now: Date = new Date(), days = 30): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(tasks)
    .where(and(isNotNull(tasks.deletedAt), lt(tasks.deletedAt, cutoff)))
    .returning({ id: tasks.id });
  return deleted.length;
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run tests/core/tasks-query.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/tasks.ts tests/core/tasks-query.test.ts
git commit -m "feat(core): vistas Hoy/7 días/Bandeja, búsqueda y purga de papelera"
```

---

### Task 10: API pública del núcleo y verificación final

**Files:**
- Create: `src/core/index.ts`

- [ ] **Step 1: Crear `src/core/index.ts`**

```ts
export * from './dates';
export * from './errors';
export * from './lists';
export * from './quick-add';
export * from './tags';
export * from './tasks';
export * from './users';
```

- [ ] **Step 2: Verificación completa**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: todos los tests en verde (57), sin errores de tipos ni de lint, build exitoso.

- [ ] **Step 3: Commit**

```bash
git add src/core/index.ts
git commit -m "feat(core): exportar API pública del núcleo"
```
