import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authorizationParamsFrom, isLoopbackRedirect, validateAuthorizationRequest } from '@/core/oauth';
import { getDb } from '@/db';
import { appUrl, mcpResourceUrl } from '@/lib/app-url';
import { getCurrentUser } from '@/lib/auth';
import { errorPageView, loginUrlFor } from '@/lib/oauth-consent';
import { approveAuthorizationAction, denyAuthorizationAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Autorizar acceso · Notas' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-line bg-bg p-6 shadow-sm">{children}</div>
    </main>
  );
}

export default async function AuthorizePage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  // Un parámetro repetido llega como array: el core lo rechaza (RFC 6749 §3.1).
  const params = authorizationParamsFrom((name) => raw[name]);

  // Primero se valida la solicitud: un pedido inválido no obliga a iniciar sesión.
  const check = await validateAuthorizationRequest(await getDb(), params, { resource: mcpResourceUrl() });
  if (!check.ok && !check.redirect) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">No se puede autorizar</h1>
        <p role="alert" className="text-sm text-danger">{check.error}</p>
        <p className="text-sm text-muted">Volvé a la aplicación que te trajo hasta acá y probá conectar de nuevo.</p>
      </Shell>
    );
  }
  if (!check.ok) {
    // Nunca se redirige sin que el usuario haga clic: si no, esta ruta sería un redirector abierto hacia
    // cualquier redirect_uri registrado (el registro es público).
    const view = errorPageView(check, appUrl());
    return (
      <Shell>
        <h1 className="text-xl font-semibold">No se puede autorizar</h1>
        <p role="alert" className="text-sm text-danger">{view.message}</p>
        <p className="text-sm text-muted">La solicitud de la aplicación es inválida. No se concedió ningún acceso.</p>
        <a href={view.href} className="inline-block rounded-md border border-line px-3 py-2 text-sm hover:bg-hover">
          Volver a {view.host}
        </a>
      </Shell>
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    redirect(loginUrlFor({
      responseType: 'code', clientId: check.client.clientId, redirectUri: check.redirectUri,
      codeChallenge: check.codeChallenge, codeChallengeMethod: 'S256', state: check.state, resource: params.resource,
    }));
  }

  const host = new URL(check.redirectUri).host;
  return (
    <Shell>
      <h1 className="text-xl font-semibold">{check.client.clientName} quiere acceder a tu cuenta de Notas</h1>
      <p className="text-sm">
        Va a poder <strong>ver, crear, modificar y borrar</strong> tus listas y tareas, incluidas las de listas
        compartidas con vos.
      </p>
      <dl className="space-y-1 text-sm">
        <div>
          <dt className="inline text-muted">Cuenta: </dt>
          <dd className="inline">{user.email}</dd>
        </div>
        <div>
          <dt className="inline text-muted">Al terminar vuelve a: </dt>
          <dd className="inline font-medium">{host}</dd>
        </div>
      </dl>
      {isLoopbackRedirect(check.redirectUri) && (
        <p role="alert" className="rounded-md border border-danger p-2 text-sm text-danger">
          Esta aplicación vuelve a un programa de tu propia computadora ({host}). Permití solo si la abriste vos recién.
        </p>
      )}
      <form className="flex justify-end gap-2">
        <input type="hidden" name="response_type" value="code" />
        <input type="hidden" name="client_id" value={check.client.clientId} />
        <input type="hidden" name="redirect_uri" value={check.redirectUri} />
        <input type="hidden" name="code_challenge" value={check.codeChallenge} />
        <input type="hidden" name="code_challenge_method" value="S256" />
        {check.state !== undefined && <input type="hidden" name="state" value={check.state} />}
        {params.resource !== undefined && <input type="hidden" name="resource" value={params.resource} />}
        <button
          type="submit" formAction={denyAuthorizationAction}
          className="rounded-md border border-line px-3 py-2 text-sm hover:bg-hover"
        >
          Cancelar
        </button>
        <button
          type="submit" formAction={approveAuthorizationAction}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg"
        >
          Permitir
        </button>
      </form>
    </Shell>
  );
}
