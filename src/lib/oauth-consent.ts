import {
  AUTHORIZATION_PARAM_NAMES, type AuthorizationCheck, type AuthorizationFields, type AuthorizationParams,
  buildRedirectUrl, createAuthorizationCode, validateAuthorizationRequest,
} from '@/core/oauth';
import type { DB } from '@/db/types';

/** Error de la solicitud que puede volver al redirect_uri (ya validado). */
export type RedirectableError = Extract<AuthorizationCheck, { ok: false; redirect: true }>;

/** URL a la que se devuelve el error OAuth (con state e iss, RFC 9207). */
export function errorRedirectUrl(check: RedirectableError, issuer: string): string {
  return buildRedirectUrl(check.redirectUri, {
    error: check.error, error_description: check.description, state: check.state, iss: issuer,
  });
}

/**
 * Datos para mostrar un error redirigible SIN redirigir: la página de autorización nunca manda al usuario
 * a otro sitio antes de que haga clic (evita que /oauth/authorize sirva de redirector abierto).
 */
export function errorPageView(check: RedirectableError, issuer: string): { message: string; host: string; href: string } {
  return { message: check.description, host: new URL(check.redirectUri).host, href: errorRedirectUrl(check, issuer) };
}

/** Ruta de vuelta al consentimiento, reconstruida solo con campos ya validados (para `/login?next=`). */
export function authorizePath(fields: AuthorizationFields): string {
  const query = new URLSearchParams();
  for (const [field, name] of Object.entries(AUTHORIZATION_PARAM_NAMES)) {
    const value = fields[field as keyof AuthorizationFields];
    if (value !== undefined) query.set(name, value);
  }
  return `/oauth/authorize?${query}`;
}

export function loginUrlFor(fields: AuthorizationFields): string {
  return `/login?next=${encodeURIComponent(authorizePath(fields))}`;
}

/** ¿La petición viene de nuestro propio origen? Si el navegador manda Sec-Fetch-Site debe ser same-origin. */
export function isSameOriginSubmission(secFetchSite: string | null): boolean {
  return secFetchSite === null || secFetchSite === 'same-origin';
}

export type ConsentOutcome =
  /** Redirigir al cliente: código, access_denied o error de la solicitud. */
  | { type: 'redirect'; url: string }
  /** La sesión venció: ir a iniciar sesión y volver al consentimiento. */
  | { type: 'login'; url: string }
  /** client_id / redirect_uri inválidos: nunca se redirige. */
  | { type: 'error'; message: string };

/** Revalida el formulario de consentimiento y decide a dónde ir. `user` es null si la sesión venció. */
export async function resolveConsent(
  db: DB, params: AuthorizationParams,
  opts: { approve: boolean; user: { id: string } | null; issuer: string; resource: string },
): Promise<ConsentOutcome> {
  const check = await validateAuthorizationRequest(db, params, { resource: opts.resource });
  if (!check.ok) {
    return check.redirect
      ? { type: 'redirect', url: errorRedirectUrl(check, opts.issuer) }
      : { type: 'error', message: check.error };
  }
  if (!opts.user) {
    return {
      type: 'login',
      url: loginUrlFor({
        responseType: 'code', clientId: check.client.clientId, redirectUri: check.redirectUri,
        codeChallenge: check.codeChallenge, codeChallengeMethod: 'S256', state: check.state,
        resource: params.resource,
      }),
    };
  }
  if (!opts.approve) {
    return {
      type: 'redirect',
      url: buildRedirectUrl(check.redirectUri, {
        error: 'access_denied', error_description: 'El usuario no autorizó el acceso', state: check.state, iss: opts.issuer,
      }),
    };
  }
  const code = await createAuthorizationCode(db, {
    clientId: check.client.clientId, userId: opts.user.id, redirectUri: check.redirectUri,
    codeChallenge: check.codeChallenge, scope: check.scope, resource: check.resource,
  });
  return { type: 'redirect', url: buildRedirectUrl(check.redirectUri, { code, state: check.state, iss: opts.issuer }) };
}
