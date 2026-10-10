import { sql } from 'drizzle-orm';
import {
  boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { DEFAULT_TIMEZONE } from '../core/dates';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull().default(''),
  timezone: text('timezone').notNull().default(DEFAULT_TIMEZONE),
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
  uniqueIndex('lists_one_inbox_per_user_idx').on(t.userId).where(sql`${t.isInbox}`),
]);

/** Miembros de una lista compartida (el dueño es `lists.user_id` y no figura acá). */
export const listMembers = pgTable('list_members', {
  listId: uuid('list_id').notNull().references(() => lists.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.listId, t.userId] }),
  index('list_members_user_idx').on(t.userId),
]);

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

export const sessions = pgTable('sessions', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [index('sessions_user_idx').on(t.userId)]);

/** Tokens personales para el MCP (`ntk_…`). Solo se guarda el hash; `prefix` sirve para reconocerlos en la UI. */
export const apiTokens = pgTable('api_tokens', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: createdAt(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => [index('api_tokens_user_idx').on(t.userId)]);

/** Clientes OAuth registrados por registro dinámico (RFC 7591). Todos son públicos (sin secreto). */
export const oauthClients = pgTable('oauth_clients', {
  clientId: text('client_id').primaryKey(),
  clientName: text('client_name').notNull(),
  redirectUris: jsonb('redirect_uris').$type<string[]>().notNull(),
  createdAt: createdAt(),
});

/** Códigos de autorización (hash), de un solo uso. `family_id` = tokens emitidos al canjearlo. */
export const oauthCodes = pgTable('oauth_codes', {
  codeHash: text('code_hash').primaryKey(),
  clientId: text('client_id').notNull().references(() => oauthClients.clientId, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  scope: text('scope').notNull(),
  resource: text('resource').notNull(),
  familyId: uuid('family_id'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('oauth_codes_user_idx').on(t.userId)]);

/**
 * Par access/refresh emitido a un cliente (hashes). Cada refresh revoca la fila y crea otra con el mismo
 * `family_id`; reusar un refresh viejo revoca toda la familia.
 */
export const oauthTokens = pgTable('oauth_tokens', {
  id: id(),
  familyId: uuid('family_id').notNull(),
  /** Cuándo se canjeó el código que originó la familia: las rotaciones lo heredan (vida absoluta del refresh). */
  familyCreatedAt: timestamp('family_created_at', { withTimezone: true }).notNull().defaultNow(),
  accessTokenHash: text('access_token_hash').notNull().unique(),
  refreshTokenHash: text('refresh_token_hash').notNull().unique(),
  clientId: text('client_id').notNull().references(() => oauthClients.clientId, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  scope: text('scope').notNull(),
  resource: text('resource').notNull(),
  accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }).notNull(),
  refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index('oauth_tokens_user_idx').on(t.userId),
  index('oauth_tokens_client_idx').on(t.clientId),
  index('oauth_tokens_family_idx').on(t.familyId),
]);
