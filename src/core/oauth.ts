import { randomUUID } from 'node:crypto';
import { type SQL, and, asc, eq, gt, isNull, lt, max, notExists, or, sql } from 'drizzle-orm';
import { oauthClients, oauthCodes, oauthTokens } from '@/db/schema';
import type { DB } from '@/db/types';
import { NotFoundError } from './errors';
import { generateSecret, safeEqual, sha256Base64Url, sha256Hex } from './secrets';

/** Único scope: acceso completo a las listas y tareas del usuario. */
export const OAUTH_SCOPE = 'tasks';

const CLIENT_ID_PREFIX = 'ncl_';
const DEFAULT_CLIENT_NAME = 'Aplicación sin nombre';
const MAX_REDIRECT_URIS = 10;
const MAX_URI_LENGTH = 2000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unsupported_grant_type'
  | 'unsupported_response_type'
  | 'invalid_scope'
  | 'invalid_target'
  | 'access_denied'
  | 'invalid_redirect_uri'
  | 'invalid_client_metadata';

/** Error de protocolo OAuth: `code` va en `error` y el mensaje en `error_description`. */
export class OAuthError extends Error {
  readonly code: OAuthErrorCode;

  constructor(code: OAuthErrorCode, message: string) {
    super(message);
    this.name = 'OAuthError';
    this.code = code;
  }
}

export type OAuthClient = typeof oauthClients.$inferSelect;

// ---------- Redirect URIs y recurso ----------

/** El parser URL pasa esquema y host a minúsculas, así que `HTTP://LOCALHOST/cb` se acepta como loopback normal. */
function parseRedirectUri(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > MAX_URI_LENGTH || value.includes('#')) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return url;
  return null;
}

/** https (cualquier host) o http solo hacia la propia máquina (localhost, 127.0.0.1, [::1]); sin fragmento. */
export function isAllowedRedirectUri(value: unknown): boolean {
  return parseRedirectUri(value) !== null;
}

/** ¿Vuelve a un programa de la propia computadora? (el consentimiento muestra una advertencia) */
export function isLoopbackRedirect(value: string): boolean {
  return parseRedirectUri(value)?.protocol === 'http:';
}

/**
 * ¿`requested` es una de las URIs registradas? Comparación exacta, salvo loopback http, donde el puerto se
 * ignora porque las apps nativas (p. ej. Claude Code) usan un puerto distinto en cada sesión (RFC 8252 §7.3).
 */
export function matchesRegisteredRedirect(registered: readonly string[], requested: string): boolean {
  const req = parseRedirectUri(requested);
  if (!req) return false;
  if (registered.includes(requested)) return true;
  if (req.protocol !== 'http:') return false;
  return registered.some((value) => {
    const reg = parseRedirectUri(value);
    return reg !== null && reg.protocol === 'http:' && reg.hostname === req.hostname
      && reg.pathname === req.pathname && reg.search === req.search;
  });
}

function canonicalResource(value: string): string | null {
  if (value.includes('#')) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}${url.search}`;
}

/** Compara identificadores de recurso (RFC 8707) tolerando mayúsculas en esquema/host, puerto por defecto y barra final. */
export function sameResource(candidate: string, expected: string): boolean {
  const a = canonicalResource(candidate);
  return a !== null && a === canonicalResource(expected);
}

// ---------- Clientes (registro dinámico, RFC 7591) ----------

/** Controles C0/DEL, marcas bidi y espacios de ancho cero: con ellos un nombre puede hacerse pasar por otro. */
const HIDDEN_CHARS_RE = /[\x00-\x1f\x7f​-‏‪-‮⁦-⁩﻿]/g;

function cleanClientName(value: unknown): string {
  if (value === undefined || value === null) return DEFAULT_CLIENT_NAME;
  if (typeof value !== 'string') throw new OAuthError('invalid_client_metadata', 'client_name debe ser texto');
  const clean = value.replace(HIDDEN_CHARS_RE, '').trim().slice(0, 100);
  return clean || DEFAULT_CLIENT_NAME;
}

/**
 * Registra un cliente público. Solo importan `redirect_uris` y `client_name`: el resto de la metadata
 * (método de autenticación, grant types…) se ignora y la respuesta informa los valores reales.
 */
export async function registerClient(db: DB, metadata: unknown, now: Date = new Date()): Promise<OAuthClient> {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    throw new OAuthError('invalid_client_metadata', 'El cuerpo debe ser un objeto JSON');
  }
  const { redirect_uris: uris, client_name: name } = metadata as Record<string, unknown>;
  if (!Array.isArray(uris) || uris.length === 0) {
    throw new OAuthError('invalid_redirect_uri', 'redirect_uris es obligatorio y no puede estar vacío');
  }
  if (uris.length > MAX_REDIRECT_URIS) {
    throw new OAuthError('invalid_redirect_uri', `Se admiten como máximo ${MAX_REDIRECT_URIS} redirect_uris`);
  }
  for (const uri of uris) {
    if (!isAllowedRedirectUri(uri)) {
      throw new OAuthError(
        'invalid_redirect_uri',
        `redirect_uri no permitida: ${String(uri).slice(0, 200)} (usá https, o http solo para localhost/127.0.0.1)`,
      );
    }
  }
  const [client] = await db
    .insert(oauthClients)
    .values({
      clientId: generateSecret(CLIENT_ID_PREFIX, 16),
      clientName: cleanClientName(name),
      redirectUris: [...new Set(uris as string[])],
      createdAt: now,
    })
    .returning();
  return client;
}

export async function getClient(db: DB, clientId: string): Promise<OAuthClient | null> {
  if (typeof clientId !== 'string' || !clientId.startsWith(CLIENT_ID_PREFIX) || clientId.length > 100) return null;
  const [client] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId));
  return client ?? null;
}

// ---------- Solicitud de autorización y códigos ----------

export const CODE_TTL_MS = 5 * 60 * 1000;
const CODE_PREFIX = 'nac_';
/** S256 = base64url(sha256(verifier)) sin relleno: siempre 43 caracteres. */
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const MAX_STATE_LENGTH = 2000;

/** Un parámetro OAuth tal como llega: un valor, o varios si vino repetido. */
export type RawParam = string | readonly string[] | undefined;

/**
 * Valor de un parámetro de formulario: undefined si falta o está vacío, el string si viene una vez y el arreglo
 * completo si viene repetido (el core lo rechaza: RFC 6749 §3.1 prohíbe repetir parámetros).
 */
export function formValue(form: URLSearchParams, name: string): RawParam {
  const values = form.getAll(name);
  if (values.length > 1) return values;
  return values[0] === undefined || values[0] === '' ? undefined : values[0];
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value !== '';

export interface AuthorizationFields {
  responseType?: string;
  clientId?: string;
  redirectUri?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  state?: string;
  scope?: string;
  resource?: string;
}

export interface AuthorizationParams extends AuthorizationFields {
  /** Campos que llegaron más de una vez: la solicitud se rechaza. */
  repeated?: (keyof AuthorizationFields)[];
}

/** Nombre del parámetro OAuth de cada campo (query de /oauth/authorize y campos del formulario de consentimiento). */
export const AUTHORIZATION_PARAM_NAMES: Record<keyof AuthorizationFields, string> = {
  responseType: 'response_type',
  clientId: 'client_id',
  redirectUri: 'redirect_uri',
  codeChallenge: 'code_challenge',
  codeChallengeMethod: 'code_challenge_method',
  state: 'state',
  scope: 'scope',
  resource: 'resource',
};

/**
 * Arma los parámetros desde cualquier fuente (`get` devuelve el valor, un arreglo si vino repetido o undefined
 * si falta); vacío = ausente. Los repetidos no se leen: quedan anotados en `repeated`.
 */
export function authorizationParamsFrom(get: (name: string) => RawParam): AuthorizationParams {
  const params: AuthorizationParams = {};
  for (const field of Object.keys(AUTHORIZATION_PARAM_NAMES) as (keyof AuthorizationFields)[]) {
    const value = get(AUTHORIZATION_PARAM_NAMES[field]);
    if (typeof value !== 'string' && value !== undefined) {
      if (value.length > 1) (params.repeated ??= []).push(field);
      else if (value[0]) params[field] = value[0];
      continue;
    }
    if (value !== undefined && value !== '') params[field] = value;
  }
  return params;
}

export type AuthorizationCheck =
  | {
    ok: true; client: OAuthClient; redirectUri: string; codeChallenge: string; state?: string; scope: string;
    resource: string;
  }
  /** client_id o redirect_uri inválidos: se muestra el error, NUNCA se redirige (RFC 6749 §4.1.2.1). */
  | { ok: false; redirect: false; error: string }
  /** Error que se devuelve al redirect_uri (ya validado). */
  | { ok: false; redirect: true; redirectUri: string; state?: string; error: OAuthErrorCode; description: string };

/**
 * Valida una solicitud de autorización (code + PKCE S256). Si viene `resource` debe ser el recurso MCP propio;
 * el scope pedido se ignora y se concede siempre `tasks`.
 */
export async function validateAuthorizationRequest(
  db: DB, params: AuthorizationParams, opts: { resource: string },
): Promise<AuthorizationCheck> {
  const client = params.clientId ? await getClient(db, params.clientId) : null;
  if (!client) {
    return { ok: false, redirect: false, error: 'La aplicación que pide acceso no está registrada en Notas (client_id desconocido).' };
  }
  const redirectUri = params.redirectUri;
  if (!redirectUri || !matchesRegisteredRedirect(client.redirectUris, redirectUri)) {
    return {
      ok: false, redirect: false,
      error: 'La dirección de retorno (redirect_uri) no coincide con ninguna de las registradas por la aplicación.',
    };
  }
  const fail = (error: OAuthErrorCode, description: string): AuthorizationCheck => ({
    ok: false, redirect: true, redirectUri, state: params.state, error, description,
  });
  if (params.repeated?.length) {
    const other = params.repeated.some((field) => field !== 'resource');
    return other
      ? fail('invalid_request', 'No se pueden repetir parámetros')
      : fail('invalid_target', 'resource no puede repetirse');
  }
  if (params.state !== undefined && params.state.length > MAX_STATE_LENGTH) {
    // No se devuelve el state: es justo lo que es demasiado largo.
    return {
      ok: false, redirect: true, redirectUri, state: undefined, error: 'invalid_request',
      description: `state demasiado largo (máx. ${MAX_STATE_LENGTH} caracteres)`,
    };
  }
  if (params.responseType !== 'code') return fail('unsupported_response_type', 'Solo se admite response_type=code');
  if (params.codeChallengeMethod !== 'S256') return fail('invalid_request', 'PKCE es obligatorio: code_challenge_method=S256');
  if (!params.codeChallenge || !CHALLENGE_RE.test(params.codeChallenge)) {
    return fail('invalid_request', 'code_challenge inválido (base64url de 43 caracteres)');
  }
  if (params.resource !== undefined && !sameResource(params.resource, opts.resource)) {
    return fail('invalid_target', `resource debe ser ${opts.resource}`);
  }
  return {
    ok: true, client, redirectUri, codeChallenge: params.codeChallenge, state: params.state, scope: OAUTH_SCOPE,
    resource: opts.resource,
  };
}

/** Agrega parámetros a la URI de retorno conservando su query (RFC 6749 §3.1.2); ignora los undefined. */
export function buildRedirectUrl(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

export interface NewAuthorizationCode {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string;
}

/** Emite un código de un solo uso (5 min). Se devuelve en claro solo acá; en la base queda su hash. */
export async function createAuthorizationCode(
  db: DB, input: NewAuthorizationCode, now: Date = new Date(),
): Promise<string> {
  const code = generateSecret(CODE_PREFIX);
  await db.insert(oauthCodes).values({
    ...input, codeHash: sha256Hex(code), expiresAt: new Date(now.getTime() + CODE_TTL_MS), createdAt: now,
  });
  return code;
}

// ---------- Tokens ----------

export const ACCESS_TOKEN_PREFIX = 'nat_';
export const REFRESH_TOKEN_PREFIX = 'nrt_';
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000;
/** Vida máxima de una familia de refresh desde el canje original: pasado esto hay que volver a autorizar. */
export const REFRESH_FAMILY_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** RFC 7636 §4.1: 43 a 128 caracteres "unreserved". */
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;

/** PKCE S256: base64url(sha256(verifier)) === challenge, en tiempo constante. */
export function verifyPkce(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== 'string' || !VERIFIER_RE.test(verifier)) return false;
  return safeEqual(sha256Base64Url(verifier), challenge);
}

/** Respuesta del endpoint de token (RFC 6749 §5.1). */
export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

interface TokenGrant {
  clientId: string;
  userId: string;
  scope: string;
  resource: string;
  familyId: string;
  familyCreatedAt: Date;
}

async function issueTokens(db: DB, grant: TokenGrant, now: Date): Promise<TokenResponse> {
  const accessToken = generateSecret(ACCESS_TOKEN_PREFIX);
  const refreshToken = generateSecret(REFRESH_TOKEN_PREFIX);
  await db.insert(oauthTokens).values({
    ...grant,
    accessTokenHash: sha256Hex(accessToken),
    refreshTokenHash: sha256Hex(refreshToken),
    accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
    refreshExpiresAt: new Date(Math.min(
      now.getTime() + REFRESH_TOKEN_TTL_MS, grant.familyCreatedAt.getTime() + REFRESH_FAMILY_MAX_AGE_MS,
    )),
    createdAt: now,
  });
  return {
    access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_MS / 1000,
    refresh_token: refreshToken, scope: grant.scope,
  };
}

async function revokeFamily(db: DB, familyId: string, now: Date): Promise<void> {
  await db
    .update(oauthTokens)
    .set({ revokedAt: now })
    .where(and(eq(oauthTokens.familyId, familyId), isNull(oauthTokens.revokedAt)));
}

function checkResourceParam(resource: unknown, expected: string): void {
  if (resource !== undefined && (typeof resource !== 'string' || !sameResource(resource, expected))) {
    throw new OAuthError('invalid_target', `resource debe ser ${expected}`);
  }
}

/**
 * Las transacciones devuelven el error en vez de lanzarlo: así se confirma lo que tiene que quedar
 * (el código quemado, la familia revocada) y el error se lanza afuera.
 */
type Outcome = { tokens: TokenResponse } | { error: OAuthError };

function unwrap(outcome: Outcome): TokenResponse {
  if ('error' in outcome) throw outcome.error;
  return outcome.tokens;
}

/** Los campos son `unknown` a propósito: llegan de la red y un repetido o un no-string se rechaza acá, no con un TypeError. */
export interface CodeExchangeInput {
  code?: unknown;
  clientId?: unknown;
  redirectUri?: unknown;
  codeVerifier?: unknown;
  resource?: unknown;
}

/** grant_type=authorization_code: código de un solo uso + PKCE + mismo cliente y redirect_uri. */
export async function exchangeAuthorizationCode(
  db: DB, input: CodeExchangeInput, opts: { resource: string; now?: Date },
): Promise<TokenResponse> {
  const now = opts.now ?? new Date();
  const { code, clientId, redirectUri, codeVerifier } = input;
  if (!isNonEmptyString(code) || !isNonEmptyString(clientId) || !isNonEmptyString(redirectUri) || !isNonEmptyString(codeVerifier)) {
    throw new OAuthError('invalid_request', 'Faltan code, client_id, redirect_uri o code_verifier (o están repetidos)');
  }
  checkResourceParam(input.resource, opts.resource);
  const codeHash = sha256Hex(code);
  return unwrap(await db.transaction(async (tx): Promise<Outcome> => {
    // Marcado atómico: de dos canjes simultáneos, solo uno obtiene la fila.
    const [row] = await tx
      .update(oauthCodes)
      .set({ usedAt: now })
      .where(and(eq(oauthCodes.codeHash, codeHash), isNull(oauthCodes.usedAt)))
      .returning();
    if (!row) {
      // Reuso de un código ya canjeado: se revocan los tokens emitidos con él (OAuth 2.1 §4.1.3).
      const [used] = await tx.select({ familyId: oauthCodes.familyId }).from(oauthCodes).where(eq(oauthCodes.codeHash, codeHash));
      if (used?.familyId) await revokeFamily(tx, used.familyId, now);
      return { error: new OAuthError('invalid_grant', 'El código no es válido o ya se usó') };
    }
    if (row.expiresAt <= now) return { error: new OAuthError('invalid_grant', 'El código venció') };
    if (row.clientId !== clientId || row.redirectUri !== redirectUri) {
      return { error: new OAuthError('invalid_grant', 'El código no corresponde a este cliente o redirect_uri') };
    }
    if (!verifyPkce(codeVerifier, row.codeChallenge)) {
      return { error: new OAuthError('invalid_grant', 'code_verifier no coincide con el code_challenge') };
    }
    const familyId = randomUUID();
    await tx.update(oauthCodes).set({ familyId }).where(eq(oauthCodes.codeHash, codeHash));
    return {
      tokens: await issueTokens(tx, {
        clientId: row.clientId, userId: row.userId, scope: row.scope, resource: row.resource, familyId,
        familyCreatedAt: now,
      }, now),
    };
  }));
}

export interface RefreshInput {
  refreshToken?: unknown;
  clientId?: unknown;
  resource?: unknown;
}

/**
 * grant_type=refresh_token con rotación: la fila vieja se revoca y se emite otra de la misma familia.
 * Reusar un refresh ya rotado/revocado, o presentarlo desde otro cliente, revoca toda la familia.
 */
export async function refreshAccessToken(
  db: DB, input: RefreshInput, opts: { resource: string; now?: Date },
): Promise<TokenResponse> {
  const now = opts.now ?? new Date();
  const { refreshToken, clientId } = input;
  if (!isNonEmptyString(refreshToken) || !isNonEmptyString(clientId)) {
    throw new OAuthError('invalid_request', 'Faltan refresh_token o client_id (o están repetidos)');
  }
  checkResourceParam(input.resource, opts.resource);
  const hash = sha256Hex(refreshToken);
  return unwrap(await db.transaction(async (tx): Promise<Outcome> => {
    const [row] = await tx
      .update(oauthTokens)
      .set({ revokedAt: now })
      .where(and(eq(oauthTokens.refreshTokenHash, hash), isNull(oauthTokens.revokedAt)))
      .returning();
    if (!row) {
      const [old] = await tx.select({ familyId: oauthTokens.familyId }).from(oauthTokens).where(eq(oauthTokens.refreshTokenHash, hash));
      if (old) await revokeFamily(tx, old.familyId, now);
      return { error: new OAuthError('invalid_grant', 'El refresh token no es válido') };
    }
    if (row.clientId !== clientId) {
      await revokeFamily(tx, row.familyId, now);
      return { error: new OAuthError('invalid_grant', 'El refresh token no corresponde a este cliente') };
    }
    if (row.refreshExpiresAt <= now) return { error: new OAuthError('invalid_grant', 'El refresh token venció') };
    if (row.familyCreatedAt.getTime() + REFRESH_FAMILY_MAX_AGE_MS <= now.getTime()) {
      await revokeFamily(tx, row.familyId, now);
      return { error: new OAuthError('invalid_grant', 'La autorización venció: volvé a conectar la aplicación') };
    }
    return {
      tokens: await issueTokens(tx, {
        clientId: row.clientId, userId: row.userId, scope: row.scope, resource: row.resource, familyId: row.familyId,
        familyCreatedAt: row.familyCreatedAt,
      }, now),
    };
  }));
}

/** Revocación (RFC 7009): revoca la fila del token (access y refresh juntos). Desconocido = sin efecto. */
export async function revokeToken(
  db: DB, input: { token?: unknown; clientId?: unknown }, now: Date = new Date(),
): Promise<void> {
  if (!isNonEmptyString(input.token)) throw new OAuthError('invalid_request', 'Falta token (o está repetido)');
  if (input.clientId !== undefined && typeof input.clientId !== 'string') {
    throw new OAuthError('invalid_request', 'client_id repetido o inválido');
  }
  const column = input.token.startsWith(REFRESH_TOKEN_PREFIX) ? oauthTokens.refreshTokenHash : oauthTokens.accessTokenHash;
  const conditions: SQL[] = [eq(column, sha256Hex(input.token)), isNull(oauthTokens.revokedAt)];
  if (input.clientId) conditions.push(eq(oauthTokens.clientId, input.clientId));
  await db.update(oauthTokens).set({ revokedAt: now }).where(and(...conditions));
}

/** Usuario y cliente de un access token vigente emitido para `resource`, o null. */
export async function authenticateAccessToken(
  db: DB, token: string, opts: { resource: string; now?: Date },
): Promise<{ userId: string; clientId: string } | null> {
  if (typeof token !== 'string' || !token.startsWith(ACCESS_TOKEN_PREFIX)) return null;
  const now = opts.now ?? new Date();
  const [row] = await db
    .select({ id: oauthTokens.id, userId: oauthTokens.userId, clientId: oauthTokens.clientId, resource: oauthTokens.resource })
    .from(oauthTokens)
    .where(and(
      eq(oauthTokens.accessTokenHash, sha256Hex(token)),
      isNull(oauthTokens.revokedAt),
      gt(oauthTokens.accessExpiresAt, now),
    ));
  if (!row || !sameResource(row.resource, opts.resource)) return null;
  await db
    .update(oauthTokens)
    .set({ lastUsedAt: now })
    .where(and(
      eq(oauthTokens.id, row.id),
      or(isNull(oauthTokens.lastUsedAt), lt(oauthTokens.lastUsedAt, new Date(now.getTime() - TOUCH_INTERVAL_MS))),
    ));
  return { userId: row.userId, clientId: row.clientId };
}

// ---------- Conexiones del usuario ----------

/** App conectada por OAuth (tiene al menos un par de tokens vigente). */
export interface OAuthConnection {
  clientId: string;
  clientName: string;
  lastUsedAt: Date | null;
}

export async function listOAuthConnections(db: DB, userId: string, now: Date = new Date()): Promise<OAuthConnection[]> {
  return db
    .select({ clientId: oauthClients.clientId, clientName: oauthClients.clientName, lastUsedAt: max(oauthTokens.lastUsedAt) })
    .from(oauthTokens)
    .innerJoin(oauthClients, eq(oauthClients.clientId, oauthTokens.clientId))
    .where(and(eq(oauthTokens.userId, userId), isNull(oauthTokens.revokedAt), gt(oauthTokens.refreshExpiresAt, now)))
    .groupBy(oauthClients.clientId, oauthClients.clientName)
    .orderBy(asc(oauthClients.clientName), asc(oauthClients.clientId));
}

/**
 * Desconecta una app: revoca todos sus tokens del usuario y quema los códigos pendientes (si no, un código
 * emitido antes de desconectar se podría canjear después). NotFoundError si no había nada vigente.
 */
export async function revokeOAuthConnection(
  db: DB, userId: string, clientId: string, now: Date = new Date(),
): Promise<void> {
  const id = String(clientId);
  const count = await db.transaction(async (tx) => {
    const tokens = await tx
      .update(oauthTokens)
      .set({ revokedAt: now })
      .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.clientId, id), isNull(oauthTokens.revokedAt)))
      .returning({ id: oauthTokens.id });
    const codes = await tx
      .update(oauthCodes)
      .set({ usedAt: now })
      .where(and(eq(oauthCodes.userId, userId), eq(oauthCodes.clientId, id), isNull(oauthCodes.usedAt)))
      .returning({ codeHash: oauthCodes.codeHash });
    return tokens.length + codes.length;
  });
  if (count === 0) throw new NotFoundError('La conexión');
}

// ---------- Mantenimiento ----------

/**
 * Borra códigos vencidos hace más de un día, tokens con el refresh vencido o revocados hace más de 30 días,
 * y clientes de más de un día sin códigos ni tokens. Opera sobre TODOS los usuarios: solo para el cron (Plan 5).
 */
export async function purgeExpiredOAuthData(
  db: DB, now: Date = new Date(),
): Promise<{ codes: number; tokens: number; clients: number }> {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const codes = await db
    .delete(oauthCodes)
    .where(lt(oauthCodes.expiresAt, dayAgo))
    .returning({ codeHash: oauthCodes.codeHash });
  const tokens = await db
    .delete(oauthTokens)
    .where(or(lt(oauthTokens.refreshExpiresAt, now), lt(oauthTokens.revokedAt, new Date(now.getTime() - 30 * DAY_MS))))
    .returning({ id: oauthTokens.id });
  // Un solo DELETE: si entre un SELECT y el DELETE llegara un código nuevo, el cliente se borraría igual.
  const orphans = await db
    .delete(oauthClients)
    .where(and(
      lt(oauthClients.createdAt, dayAgo),
      notExists(db.select({ one: sql`1` }).from(oauthTokens).where(eq(oauthTokens.clientId, oauthClients.clientId))),
      notExists(db.select({ one: sql`1` }).from(oauthCodes).where(eq(oauthCodes.clientId, oauthClients.clientId))),
    ))
    .returning({ clientId: oauthClients.clientId });
  return { codes: codes.length, tokens: tokens.length, clients: orphans.length };
}
