import { z } from 'zod';
import { todayIn } from '@/core/dates';
import { NotFoundError, ValidationError } from '@/core/errors';
import { createList, deleteList, getInbox, getList, listLists, updateList } from '@/core/lists';
import { addListMember, getListMembers, leaveList, removeListMember } from '@/core/members';
import { createTag, listTags } from '@/core/tags';
import {
  addSubtask, completeTask, createTask, deleteSubtask, deleteTask, getTask, listTasks, moveTask, restoreTask,
  searchTasks, uncompleteTask, updateSubtask, updateTask, type TaskWithDetails, type UpdateTaskInput,
} from '@/core/tasks';
import { getUser } from '@/core/users';
import type { DB } from '@/db/types';
import { shareLimiter } from '@/lib/limits';
import { formatList, formatMember, formatTag, formatTask, weekdayName } from './format';

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

/** Resultado de una herramienta (compatible con CallToolResult del SDK). */
export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  input: z.ZodObject;
  readOnly: boolean;
  destructive: boolean;
  /** Repetir la misma llamada deja el mismo estado final. */
  idempotent: boolean;
  /** Recibe argumentos ya validados con `input`. */
  run: (ctx: ToolContext, args: unknown) => Promise<unknown>;
}

function defineTool<S extends z.ZodObject>(def: {
  name: string;
  title: string;
  description: string;
  input: S;
  readOnly?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
  run: (ctx: ToolContext, args: z.infer<S>) => Promise<unknown>;
}): ToolDefinition {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    input: def.input,
    readOnly: def.readOnly ?? false,
    destructive: def.destructive ?? false,
    idempotent: def.idempotent ?? def.readOnly ?? false,
    run: (ctx, args) => def.run(ctx, args as z.infer<S>),
  };
}

// ---------- Esquemas compartidos ----------

const idOf = (what: string) => z.uuid().describe(`Id (uuid) de ${what}`);
const color = z.string().describe('Color #rrggbb');

// ---------- Contexto, listas y etiquetas ----------

const contextTools = [
  defineTool({
    name: 'get_today_context',
    title: 'Fecha de hoy',
    description:
      'Devuelve la fecha de hoy (YYYY-MM-DD), el día de la semana, la hora actual (HH:mm) y la zona horaria del usuario. '
      + 'Usala antes de interpretar fechas relativas como "hoy", "mañana" o "el viernes".',
    input: z.object({}).strict(),
    readOnly: true,
    run: async ({ db, userId }) => {
      const user = await getUser(db, userId);
      const now = new Date();
      const today = todayIn(user.timezone, now);
      const time = new Intl.DateTimeFormat('en-GB', {
        timeZone: user.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).format(now);
      return { today, weekday: weekdayName(today), time, timezone: user.timezone, user: { email: user.email, name: user.name } };
    },
  }),
];

const listTools = [
  defineTool({
    name: 'list_lists',
    title: 'Ver listas',
    description:
      'Lista las listas del usuario: las propias (la Bandeja primero) y las compartidas con él. '
      + 'role = owner (dueño) o member (miembro); shared = tiene miembros.',
    input: z.object({}).strict(),
    readOnly: true,
    run: async ({ db, userId }) => ({ lists: (await listLists(db, userId)).map(formatList) }),
  }),
  defineTool({
    name: 'create_list',
    title: 'Crear lista',
    description: 'Crea una lista propia.',
    input: z.object({ name: z.string().describe('Nombre (máx. 100 caracteres)'), color: color.optional() }).strict(),
    run: async ({ db, userId }, args) => {
      const list = await createList(db, userId, { name: args.name, color: args.color });
      return formatList(await getList(db, userId, list.id));
    },
  }),
  defineTool({
    name: 'update_list',
    title: 'Modificar lista',
    description: 'Renombra o cambia el color de una lista propia (solo el dueño). color: null quita el color.',
    input: z.object({
      list_id: idOf('la lista'),
      name: z.string().optional().describe('Nombre nuevo'),
      color: color.nullable().optional(),
    }).strict(),
    idempotent: true,
    run: async ({ db, userId }, args) => {
      await updateList(db, userId, args.list_id, { name: args.name, color: args.color });
      return formatList(await getList(db, userId, args.list_id));
    },
  }),
  defineTool({
    name: 'delete_list',
    title: 'Borrar lista',
    description:
      'Borra una lista propia (solo el dueño; la Bandeja no se puede borrar). Sus tareas van a la papelera '
      + 'y se pueden recuperar con restore_task.',
    input: z.object({ list_id: idOf('la lista') }).strict(),
    destructive: true,
    run: async ({ db, userId }, args) => {
      const { movedToTrash } = await deleteList(db, userId, args.list_id);
      return { deleted: true, moved_to_trash: movedToTrash };
    },
  }),
];

const tagTools = [
  defineTool({
    name: 'list_tags',
    title: 'Ver etiquetas',
    description: 'Lista las etiquetas del usuario.',
    input: z.object({}).strict(),
    readOnly: true,
    run: async ({ db, userId }) => ({ tags: (await listTags(db, userId)).map(formatTag) }),
  }),
  defineTool({
    name: 'create_tag',
    title: 'Crear etiqueta',
    description: 'Crea una etiqueta (o devuelve la existente) y opcionalmente le pone color.',
    input: z.object({ name: z.string().describe('Nombre sin "#" ni espacios'), color: color.optional() }).strict(),
    idempotent: true,
    run: async ({ db, userId }, args) => formatTag(await createTag(db, userId, { name: args.name, color: args.color })),
  }),
];

// ---------- Tareas ----------

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (formato YYYY-MM-DD)');
const timeStr = z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida (formato HH:mm, 24 hs)');
const DATE_HELP = 'Fecha YYYY-MM-DD en la zona horaria del usuario (usá get_today_context para saber qué día es hoy)';
const TIME_HELP = 'Hora HH:mm (24 hs) en la zona horaria del usuario; requiere fecha';
const priority = z.literal([0, 1, 3, 5]).describe('Prioridad: 0 ninguna, 1 baja, 3 media, 5 alta');
const tagNames = z.array(z.string()).max(30)
  .describe('Nombres de etiquetas, sin "#" ni espacios (las que no existen se crean)');
/** Tope de resultados de searchTasks en el core. */
const SEARCH_CAP = 50;
const VIEWS = ['inbox', 'today', 'next7', 'assigned', 'completed', 'trash'] as const;

async function listNames(ctx: ToolContext): Promise<Map<string, string>> {
  return new Map((await listLists(ctx.db, ctx.userId)).map((l) => [l.id, l.name]));
}

async function taskOut(ctx: ToolContext, task: TaskWithDetails) {
  const { timezone } = await getUser(ctx.db, ctx.userId);
  return formatTask(task, await listNames(ctx), { timezone });
}

/** Para listados: las descripciones largas se recortan (el detalle completo está en get_task). */
async function tasksOut(ctx: ToolContext, tasks: TaskWithDetails[]) {
  const [names, { timezone }] = await Promise.all([listNames(ctx), getUser(ctx.db, ctx.userId)]);
  return tasks.map((t) => formatTask(t, names, { timezone, truncateDescription: true }));
}

const ASSIGNEE_MSG =
  'Esa persona no tiene acceso a la lista: solo se puede asignar al dueño o a un miembro (ver list_members)';

/** Email → id de alguien con acceso a la lista (dueño o miembro); null = sin asignar. No revela si la cuenta existe. */
async function resolveAssignee(ctx: ToolContext, listId: string, email: string | null): Promise<string | null> {
  if (email === null) return null;
  const clean = email.trim().toLowerCase();
  const person = (await getListMembers(ctx.db, ctx.userId, listId)).find((m) => m.email === clean);
  if (!person) throw new ValidationError(ASSIGNEE_MSG);
  return person.id;
}

const taskTools = [
  defineTool({
    name: 'list_tasks',
    title: 'Ver tareas',
    description:
      'Lista tareas. Vistas: inbox = Bandeja; today = hoy y vencidas; next7 = próximos 7 días y vencidas; '
      + 'assigned = asignadas a mí; completed = completadas; trash = papelera. Sin view: las pendientes de todas las '
      + 'listas. Se puede filtrar por list_id y por tag. today y next7 incluyen tareas de listas compartidas solo si están asignadas a mí. '
      + 'Las descripciones de más de 200 caracteres vienen recortadas con "…" y description_truncated: true; usá get_task '
      + 'para ver la completa. Fechas YYYY-MM-DD y horas HH:mm en la zona horaria del usuario; completed_at y deleted_at '
      + 'vienen como YYYY-MM-DD HH:mm en esa misma zona.',
    input: z.object({
      view: z.enum(VIEWS).optional().describe('Vista inteligente'),
      list_id: idOf('la lista').optional(),
      tag: z.string().optional().describe('Nombre de una etiqueta propia'),
      include_completed: z.boolean().optional().describe('Incluir completadas (por defecto solo pendientes)'),
      limit: z.number().int().min(1).max(200).optional().describe('Máximo de resultados (por defecto 50)'),
      offset: z.number().int().min(0).optional().describe('Resultados a saltear, para paginar'),
    }).strict(),
    readOnly: true,
    run: async (ctx, args) => {
      const limit = args.limit ?? 50;
      const rows = await listTasks(ctx.db, ctx.userId, {
        view: args.view, listId: args.list_id, tag: args.tag, includeCompleted: args.include_completed,
        limit: limit + 1, offset: args.offset ?? 0,
      });
      const page = rows.slice(0, limit);
      return { tasks: await tasksOut(ctx, page), count: page.length, has_more: rows.length > limit };
    },
  }),
  defineTool({
    name: 'search_tasks',
    title: 'Buscar tareas',
    description:
      'Busca texto en el título y la descripción de las tareas (máx. 50 resultados, las más recientes primero; has_more '
      + 'indica que puede haber más, así que afiná la búsqueda). Las descripciones de más de 200 caracteres vienen '
      + 'recortadas (description_truncated: true); usá get_task para ver la completa.',
    input: z.object({
      query: z.string().describe('Texto a buscar'),
      include_completed: z.boolean().optional().describe('Incluir completadas (por defecto solo pendientes)'),
    }).strict(),
    readOnly: true,
    run: async (ctx, args) => {
      const found = await searchTasks(ctx.db, ctx.userId, args.query, { includeCompleted: args.include_completed });
      // El core devuelve como mucho SEARCH_CAP resultados y no pagina: si llegó al tope, puede haber más.
      return { tasks: await tasksOut(ctx, found), has_more: found.length >= SEARCH_CAP };
    },
  }),
  defineTool({
    name: 'get_task',
    title: 'Ver tarea',
    description: 'Devuelve una tarea con sus subtareas y etiquetas, con la descripción completa. completed_at y deleted_at vienen como YYYY-MM-DD HH:mm en la zona horaria del usuario.',
    input: z.object({
      task_id: idOf('la tarea'),
      include_deleted: z.boolean().optional().describe('Permitir una tarea que está en la papelera'),
    }).strict(),
    readOnly: true,
    run: async (ctx, args) => taskOut(ctx, await getTask(ctx.db, ctx.userId, args.task_id, { includeDeleted: args.include_deleted })),
  }),
  defineTool({
    name: 'create_task',
    title: 'Crear tarea',
    description:
      'Crea una tarea. Sin list_id va a la Bandeja. due_date YYYY-MM-DD y due_time HH:mm (24 hs) en la zona horaria '
      + 'del usuario. Prioridad 0/1/3/5. assignee_email: dueño o miembro de la lista.',
    input: z.object({
      title: z.string().describe('Título (máx. 500 caracteres)'),
      description: z.string().optional().describe('Notas de la tarea'),
      list_id: idOf('la lista').optional(),
      due_date: dateStr.optional().describe(DATE_HELP),
      due_time: timeStr.optional().describe(TIME_HELP),
      priority: priority.optional(),
      tags: tagNames.optional(),
      subtasks: z.array(z.string()).max(100).optional().describe('Títulos de las subtareas (checklist)'),
      assignee_email: z.string().optional().describe('Email de la persona asignada'),
    }).strict(),
    run: async (ctx, args) => {
      const listId = args.list_id ?? (await getInbox(ctx.db, ctx.userId)).id;
      const assigneeId = args.assignee_email !== undefined
        ? await resolveAssignee(ctx, listId, args.assignee_email)
        : undefined;
      return taskOut(ctx, await createTask(ctx.db, ctx.userId, {
        title: args.title, description: args.description, listId, dueDate: args.due_date, dueTime: args.due_time,
        priority: args.priority, tags: args.tags, subtasks: args.subtasks, assigneeId,
        createdVia: createdViaFor(ctx),
      }));
    },
  }),
  defineTool({
    name: 'update_task',
    title: 'Modificar tarea',
    description:
      'Modifica solo los campos que se envían. DESTRUCTIVA: tags REEMPLAZA tus etiquetas de la tarea y subtasks REEMPLAZA '
      + 'todas las subtareas (las que no incluyas, con su id, se borran). due_date/due_time en null los quitan (sin fecha '
      + 'no hay hora). assignee_email null quita la asignación. Para cambiar de lista usá move_task.',
    input: z.object({
      task_id: idOf('la tarea'),
      title: z.string().optional(),
      description: z.string().optional(),
      due_date: dateStr.nullable().optional().describe(DATE_HELP),
      due_time: timeStr.nullable().optional().describe(TIME_HELP),
      priority: priority.optional(),
      tags: tagNames.optional(),
      subtasks: z.array(z.object({
        id: z.uuid().optional().describe('Id de una subtarea existente para conservarla'),
        title: z.string(),
        done: z.boolean().optional(),
      }).strict()).max(100).optional(),
      assignee_email: z.string().nullable().optional().describe('Email de la persona asignada; null la quita'),
    }).strict(),
    destructive: true,
    idempotent: true,
    run: async (ctx, args) => {
      const input: UpdateTaskInput = {
        title: args.title, description: args.description, dueDate: args.due_date, dueTime: args.due_time,
        priority: args.priority, tags: args.tags, subtasks: args.subtasks,
      };
      if (args.assignee_email !== undefined) {
        const current = await getTask(ctx.db, ctx.userId, args.task_id);
        input.assigneeId = await resolveAssignee(ctx, current.listId, args.assignee_email);
      }
      return taskOut(ctx, await updateTask(ctx.db, ctx.userId, args.task_id, input));
    },
  }),
  defineTool({
    name: 'complete_task',
    title: 'Completar tarea',
    description: 'Marca la tarea como completada.',
    input: z.object({ task_id: idOf('la tarea') }).strict(),
    idempotent: true,
    run: async (ctx, args) => taskOut(ctx, await completeTask(ctx.db, ctx.userId, args.task_id)),
  }),
  defineTool({
    name: 'uncomplete_task',
    title: 'Reabrir tarea',
    description: 'Vuelve a dejar pendiente una tarea completada.',
    input: z.object({ task_id: idOf('la tarea') }).strict(),
    idempotent: true,
    run: async (ctx, args) => taskOut(ctx, await uncompleteTask(ctx.db, ctx.userId, args.task_id)),
  }),
  defineTool({
    name: 'move_task',
    title: 'Mover tarea',
    description: 'Mueve la tarea a otra lista. Si la persona asignada no tiene acceso a la lista nueva, se quita la asignación.',
    input: z.object({ task_id: idOf('la tarea'), list_id: idOf('la lista destino') }).strict(),
    idempotent: true,
    run: async (ctx, args) => taskOut(ctx, await moveTask(ctx.db, ctx.userId, args.task_id, args.list_id)),
  }),
  defineTool({
    name: 'delete_task',
    title: 'Borrar tarea',
    description: 'Manda la tarea a la papelera (se borra sola a los 30 días; se recupera con restore_task).',
    input: z.object({ task_id: idOf('la tarea') }).strict(),
    destructive: true,
    idempotent: true,
    run: async ({ db, userId }, args) => {
      await deleteTask(db, userId, args.task_id);
      return { deleted: true, task_id: args.task_id };
    },
  }),
  defineTool({
    name: 'restore_task',
    title: 'Restaurar tarea',
    description: 'Saca una tarea de la papelera.',
    input: z.object({ task_id: idOf('la tarea') }).strict(),
    idempotent: true,
    run: async (ctx, args) => taskOut(ctx, await restoreTask(ctx.db, ctx.userId, args.task_id)),
  }),
];

// ---------- Subtareas y listas compartidas ----------

const subtaskTools = [
  defineTool({
    name: 'add_subtask',
    title: 'Agregar subtarea',
    description: 'Agrega una subtarea al final del checklist de la tarea.',
    input: z.object({ task_id: idOf('la tarea'), title: z.string() }).strict(),
    run: async (ctx, args) => taskOut(ctx, await addSubtask(ctx.db, ctx.userId, args.task_id, args.title)),
  }),
  defineTool({
    name: 'update_subtask',
    title: 'Modificar subtarea',
    description: 'Cambia el título de una subtarea o la marca hecha/pendiente (done).',
    input: z.object({
      subtask_id: idOf('la subtarea'),
      title: z.string().optional(),
      done: z.boolean().optional(),
    }).strict(),
    idempotent: true,
    run: async (ctx, args) => taskOut(ctx, await updateSubtask(ctx.db, ctx.userId, args.subtask_id, {
      title: args.title, done: args.done,
    })),
  }),
  defineTool({
    name: 'delete_subtask',
    title: 'Borrar subtarea',
    description: 'Borra una subtarea.',
    input: z.object({ subtask_id: idOf('la subtarea') }).strict(),
    destructive: true,
    run: async (ctx, args) => taskOut(ctx, await deleteSubtask(ctx.db, ctx.userId, args.subtask_id)),
  }),
];

async function memberIdByEmail(ctx: ToolContext, listId: string, email: string): Promise<string> {
  const clean = email.trim().toLowerCase();
  const member = (await getListMembers(ctx.db, ctx.userId, listId)).find((m) => m.role === 'member' && m.email === clean);
  if (!member) throw new NotFoundError('El miembro');
  return member.id;
}

const sharingTools = [
  defineTool({
    name: 'list_members',
    title: 'Ver miembros de una lista',
    description: 'Personas con acceso a la lista: el dueño primero y después los miembros.',
    input: z.object({ list_id: idOf('la lista') }).strict(),
    readOnly: true,
    run: async ({ db, userId }, args) => ({ members: (await getListMembers(db, userId, args.list_id)).map(formatMember) }),
  }),
  defineTool({
    name: 'share_list',
    title: 'Compartir lista',
    description:
      'Agrega como miembro a una persona ya registrada en Notas, por email (solo el dueño; la Bandeja no se comparte). '
      + 'Los miembros ven y editan las tareas de la lista.',
    input: z.object({ list_id: idOf('la lista'), email: z.string().describe('Email de la persona') }).strict(),
    run: async ({ db, userId }, args) => {
      if (!shareLimiter.check(userId)) throw new ValidationError('Compartiste demasiadas veces seguidas. Probá más tarde.');
      return formatMember(await addListMember(db, userId, args.list_id, args.email));
    },
  }),
  defineTool({
    name: 'unshare_list',
    title: 'Quitar miembro',
    description: 'Quita a un miembro de la lista por su email (solo el dueño). Sus asignaciones en esa lista se borran.',
    input: z.object({ list_id: idOf('la lista'), email: z.string().describe('Email del miembro') }).strict(),
    destructive: true,
    run: async (ctx, args) => {
      const memberId = await memberIdByEmail(ctx, args.list_id, args.email);
      await removeListMember(ctx.db, ctx.userId, args.list_id, memberId);
      return { removed: args.email.trim().toLowerCase() };
    },
  }),
  defineTool({
    name: 'leave_list',
    title: 'Salir de una lista',
    description: 'Deja de ser miembro de una lista compartida con vos (el dueño no puede salir de su propia lista).',
    input: z.object({ list_id: idOf('la lista') }).strict(),
    destructive: true,
    run: async ({ db, userId }, args) => {
      await leaveList(db, userId, args.list_id);
      return { left: true, list_id: args.list_id };
    },
  }),
];

export const TOOLS: ToolDefinition[] = [
  ...contextTools, ...listTools, ...taskTools, ...subtaskTools, ...tagTools, ...sharingTools,
];

const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));
const GENERIC_ERROR = 'Ocurrió un error inesperado en Notas. Probá de nuevo más tarde.';

/** Pista de recuperación según qué entidad no existe (el core no sabe de herramientas MCP). */
export function notFoundHint(message: string): string {
  if (message.startsWith('La tarea')) return '; usá list_tasks o search_tasks para obtener ids válidos';
  if (message.startsWith('La lista')) return '; usá list_lists';
  if (message.startsWith('La subtarea')) return '; usá get_task para ver las subtareas';
  return '';
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Ejecuta una herramienta: valida los argumentos y traduce los errores. Los de dominio (validación, no existe)
 * vuelven como `isError` con su mensaje para que la IA corrija; los inesperados, con un mensaje genérico.
 */
export async function callTool(ctx: ToolContext, name: string, args: unknown): Promise<ToolResult> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) return errorResult(`Herramienta desconocida: ${name}`);
  const parsed = tool.input.safeParse(args ?? {});
  if (!parsed.success) return errorResult(`Argumentos inválidos:\n${z.prettifyError(parsed.error)}`);
  try {
    const data = await tool.run(ctx, parsed.data);
    return { content: [{ type: 'text', text: JSON.stringify(data) }] };
  } catch (err) {
    if (err instanceof NotFoundError) return errorResult(`${err.message}${notFoundHint(err.message)}`);
    if (err instanceof ValidationError) return errorResult(err.message);
    console.error(`[mcp] error inesperado en ${name}`, err);
    return errorResult(GENERIC_ERROR);
  }
}
