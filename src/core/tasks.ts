import { type SQL, and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { subtasks, tags, taskTags, tasks, users } from '@/db/schema';
import type { DB } from '@/db/types';
import { accessibleListIds, canAccessList, getAccessibleList, lockList, ownedListIds } from './access';
import { addDays, isValidIsoDate, isValidTime, todayIn } from './dates';
import { NotFoundError, ValidationError, isForeignKeyViolation, isUniqueViolation, isUuid } from './errors';
import { getInbox, getList } from './lists';
import { PRIORITIES, type Priority } from './priority';
import { ensureTags, normalizeTagName } from './tags';
import { getUser } from './users';

export type Task = typeof tasks.$inferSelect;
export type Subtask = typeof subtasks.$inferSelect;
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

export interface SubtaskInput {
  /** En updateTask: id de una subtarea existente de la misma tarea, para conservarla en vez de recrearla. */
  id?: string;
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

// ---------- Validación ----------

const MAX_SUBTASKS = 100;
const MAX_TAGS = 30;
const SUBTASKS_LIMIT_MSG = `Una tarea no puede tener más de ${MAX_SUBTASKS} subtareas`;

function cleanTitle(title: string): string {
  if (typeof title !== 'string') throw new ValidationError('El título debe ser texto');
  const clean = title.trim();
  if (!clean) throw new ValidationError('El título no puede estar vacío');
  if (clean.length > 500) throw new ValidationError('El título no puede superar los 500 caracteres');
  return clean;
}

function checkDescription(description: string): string {
  if (typeof description !== 'string') throw new ValidationError('La descripción debe ser texto');
  if (description.length > 10000) throw new ValidationError('La descripción no puede superar los 10000 caracteres');
  return description;
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

interface NormalizedSubtask {
  id?: string;
  title: string;
  /** undefined = conservar el valor existente (o false si es nueva). */
  done?: boolean;
}

function checkDone(done: unknown): boolean | undefined {
  if (done !== undefined && typeof done !== 'boolean') {
    throw new ValidationError('El estado de la subtarea debe ser verdadero o falso');
  }
  return done;
}

function normalizeSubtasks(items: (string | SubtaskInput)[]): NormalizedSubtask[] {
  if (!Array.isArray(items)) throw new ValidationError('Las subtareas deben ser una lista');
  if (items.length > MAX_SUBTASKS) throw new ValidationError(SUBTASKS_LIMIT_MSG);
  return items.map((item) => {
    if (typeof item === 'string') return { title: cleanTitle(item) };
    if (typeof item !== 'object' || item === null) throw new ValidationError('Subtarea inválida');
    return { id: item.id, title: cleanTitle(item.title), done: checkDone(item.done) };
  });
}

function normalizeTags(names: string[]): string[] {
  if (!Array.isArray(names)) throw new ValidationError('Las etiquetas deben ser una lista');
  if (names.length > MAX_TAGS) throw new ValidationError(`Una tarea no puede tener más de ${MAX_TAGS} etiquetas`);
  return names.map((name) => {
    if (typeof name !== 'string') throw new ValidationError('Las etiquetas deben ser texto');
    return normalizeTagName(name);
  });
}

const ASSIGNEE_MSG = 'Solo se puede asignar la tarea al dueño o a un miembro de la lista';

/**
 * Valida que el asignado tenga acceso a la lista. Depende de la base: llamar dentro de la transacción.
 * Bloquea la fila de la lista (FOR SHARE) para que quitar al miembro o borrar la lista espere a que termine.
 */
async function checkAssignee(db: DB, assigneeId: string | null, listId: string): Promise<string | null> {
  if (assigneeId === null) return null;
  await lockList(db, listId, 'share');
  if (typeof assigneeId !== 'string' || !(await canAccessList(db, assigneeId, listId))) {
    throw new ValidationError(ASSIGNEE_MSG);
  }
  return assigneeId;
}

// ---------- Lectura ----------

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

export async function getTask(
  db: DB, userId: string, taskId: string, opts: { includeDeleted?: boolean } = {},
): Promise<TaskWithDetails> {
  const [task] = await hydrate(db, userId, [await findTask(db, userId, taskId, opts)]);
  return task;
}

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
  return (await hydrate(db, userId, [row]))[0];
}

// ---------- Escritura ----------

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

/**
 * Reemplaza las subtareas. Los ítems con `id` de una subtarea existente de esta misma tarea la conservan
 * (se actualiza título y, si viene, `done`); el resto se inserta y las que no aparecen se borran.
 */
async function replaceSubtasks(db: DB, taskId: string, items: NormalizedSubtask[]): Promise<void> {
  const existing = await db.select().from(subtasks).where(eq(subtasks.taskId, taskId));
  const existingById = new Map(existing.map((s) => [s.id, s]));
  const keptIds = new Set<string>();
  const plan = items.map((item) => {
    const prev = item.id && !keptIds.has(item.id) ? existingById.get(item.id) : undefined;
    if (prev) keptIds.add(prev.id);
    return { item, prev };
  });

  const toDelete = existing.filter((s) => !keptIds.has(s.id)).map((s) => s.id);
  if (toDelete.length) await db.delete(subtasks).where(inArray(subtasks.id, toDelete));

  for (const [i, { item, prev }] of plan.entries()) {
    if (prev) {
      await db
        .update(subtasks)
        .set({ title: item.title, done: item.done ?? prev.done, sortOrder: i })
        .where(eq(subtasks.id, prev.id));
    } else {
      await db.insert(subtasks).values({ taskId, title: item.title, done: item.done ?? false, sortOrder: i });
    }
  }
}

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
      // Con la lista bloqueada, borrarla o quitar al miembro espera a que se inserte la tarea.
      await lockList(tx, listId, 'share');
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
    if (isForeignKeyViolation(err)) throw new NotFoundError('La lista');
    if (input.externalId !== undefined && isUniqueViolation(err)) {
      throw new ValidationError(`Ya existe una tarea con el id externo "${input.externalId}"`);
    }
    throw err;
  }
}

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

async function patchTask(
  db: DB, userId: string, taskId: string, patch: Partial<typeof tasks.$inferInsert>,
  opts: { includeDeleted?: boolean } = {},
): Promise<TaskWithDetails> {
  return db.transaction(async (tx) => {
    // Con la fila bloqueada la condición de acceso se evalúa sin carreras (p. ej. contra el borrado de la lista).
    const task = await findTask(tx, userId, taskId, { forUpdate: true, ...opts });
    await tx.update(tasks).set({ ...patch, updatedAt: new Date() }).where(eq(tasks.id, task.id));
    // includeDeleted: tras deleteTask la fila ya está en la papelera y igual hay que releerla.
    return getTask(tx, userId, task.id, { includeDeleted: true });
  });
}

/** Completar una tarea ya completada no cambia nada (conserva `completedAt`). */
export function completeTask(db: DB, userId: string, taskId: string): Promise<TaskWithDetails> {
  return db.transaction(async (tx) => {
    const task = await findTask(tx, userId, taskId, { forUpdate: true });
    if (task.status === 'completed') return getTask(tx, userId, task.id);
    return patchTask(tx, userId, taskId, { status: 'completed', completedAt: new Date() });
  });
}

export function uncompleteTask(db: DB, userId: string, taskId: string) {
  return patchTask(db, userId, taskId, { status: 'pending', completedAt: null });
}

const MOVE_MSG = 'Solo podés mover tareas de una lista compartida a otras listas del mismo dueño';

/**
 * Mueve la tarea a otra lista accesible; si el asignado no accede a la lista nueva, se quita la asignación.
 * Quien no es dueño de la lista de origen (un miembro) solo puede moverla a listas del mismo dueño.
 */
export async function moveTask(db: DB, userId: string, taskId: string, listId: string): Promise<TaskWithDetails> {
  try {
    return await db.transaction(async (tx) => {
      const list = await getList(tx, userId, listId);
      const task = await findTask(tx, userId, taskId, { forUpdate: true });
      const source = await getAccessibleList(tx, userId, task.listId);
      if (source.role !== 'owner' && source.list.userId !== list.userId) throw new ValidationError(MOVE_MSG);
      // Con la lista destino bloqueada no se puede borrar ni quitar al asignado mientras se decide si conserva la asignación.
      await lockList(tx, list.id, 'share');
      const keepAssignee = task.assigneeId !== null && (await canAccessList(tx, task.assigneeId, list.id));
      return await patchTask(tx, userId, task.id, { listId: list.id, assigneeId: keepAssignee ? task.assigneeId : null });
    });
  } catch (err) {
    if (isForeignKeyViolation(err)) throw new NotFoundError('La lista');
    throw err;
  }
}

/** Envía la tarea a la papelera (se purga a los 30 días). */
export async function deleteTask(db: DB, userId: string, taskId: string): Promise<void> {
  await patchTask(db, userId, taskId, { deletedAt: new Date() });
}

export function restoreTask(db: DB, userId: string, taskId: string) {
  return patchTask(db, userId, taskId, { deletedAt: null }, { includeDeleted: true });
}

// ---------- Subtareas individuales ----------

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

async function touchTask(db: DB, taskId: string): Promise<void> {
  await db.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, taskId));
}

/** Agrega una subtarea al final de la tarea. */
export async function addSubtask(db: DB, userId: string, taskId: string, title: string): Promise<TaskWithDetails> {
  const clean = cleanTitle(title);
  return db.transaction(async (tx) => {
    const task = await findTask(tx, userId, taskId, { forUpdate: true });
    const [{ max, count }] = await tx
      .select({
        max: sql<number>`coalesce(max(${subtasks.sortOrder}), -1)`,
        count: sql<number>`count(*)`,
      })
      .from(subtasks)
      .where(eq(subtasks.taskId, task.id));
    if (Number(count) >= MAX_SUBTASKS) throw new ValidationError(SUBTASKS_LIMIT_MSG);
    await tx.insert(subtasks).values({ taskId: task.id, title: clean, sortOrder: Number(max) + 1 });
    await touchTask(tx, task.id);
    return getTask(tx, userId, task.id);
  });
}

export async function updateSubtask(
  db: DB, userId: string, subtaskId: string, input: { title?: string; done?: boolean },
): Promise<TaskWithDetails> {
  const patch: Partial<typeof subtasks.$inferInsert> = {};
  if (input.title !== undefined) patch.title = cleanTitle(input.title);
  if (input.done !== undefined) patch.done = checkDone(input.done);
  return db.transaction(async (tx) => {
    const subtask = await findSubtask(tx, userId, subtaskId);
    if (Object.keys(patch).length) await tx.update(subtasks).set(patch).where(eq(subtasks.id, subtask.id));
    await touchTask(tx, subtask.taskId);
    return getTask(tx, userId, subtask.taskId);
  });
}

export function setSubtaskDone(db: DB, userId: string, subtaskId: string, done: boolean) {
  return updateSubtask(db, userId, subtaskId, { done });
}

export async function deleteSubtask(db: DB, userId: string, subtaskId: string): Promise<TaskWithDetails> {
  return db.transaction(async (tx) => {
    const subtask = await findSubtask(tx, userId, subtaskId);
    await tx.delete(subtasks).where(eq(subtasks.id, subtask.id));
    await touchTask(tx, subtask.taskId);
    return getTask(tx, userId, subtask.taskId);
  });
}

// ---------- Consultas ----------

export type TaskView = 'inbox' | 'today' | 'next7' | 'assigned' | 'completed' | 'trash';

export interface ListTasksFilter {
  view?: TaskView;
  listId?: string;
  tag?: string;
  includeCompleted?: boolean;
  /** Máximo de resultados (1 a 500, por defecto 100). */
  limit?: number;
  /** Cuántos resultados saltear (por defecto 0). */
  offset?: number;
  /** Para tests: momento que se toma como "ahora". */
  now?: Date;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

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

export async function searchTasks(
  db: DB, userId: string, query: string, opts: { includeCompleted?: boolean } = {},
): Promise<TaskWithDetails[]> {
  const q = query.trim();
  if (!q) throw new ValidationError('La búsqueda no puede estar vacía');
  if (q.length > 200) throw new ValidationError('La búsqueda no puede superar los 200 caracteres');
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const conditions: SQL[] = [
    inArray(tasks.listId, accessibleListIds(db, userId)),
    isNull(tasks.deletedAt),
    or(ilike(tasks.title, pattern), ilike(tasks.description, pattern))!,
  ];
  if (!opts.includeCompleted) conditions.push(eq(tasks.status, 'pending'));
  const rows = await db.select().from(tasks).where(and(...conditions)).orderBy(desc(tasks.updatedAt)).limit(50);
  return hydrate(db, userId, rows);
}

/**
 * Borra definitivamente las tareas que llevan más de `days` días en la papelera. Devuelve cuántas.
 *
 * ATENCIÓN: opera sobre las tareas de TODOS los usuarios. Es solo para el job diario de mantenimiento:
 * nunca se debe exponer a los usuarios ni por MCP.
 */
export async function purgeTrash(db: DB, now: Date = new Date(), days = 30): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(tasks)
    .where(and(isNotNull(tasks.deletedAt), lt(tasks.deletedAt, cutoff)))
    .returning({ id: tasks.id });
  return deleted.length;
}
