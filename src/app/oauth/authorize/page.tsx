import { ArrowLeft, Check, CircleAlert, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authorizationParamsFrom, isLoopbackRedirect, validateAuthorizationRequest } from '@/core/oauth';
import { getDb } from '@/db';
import { btn, sectionLabel } from '@/components/ui';
import { firstChar } from '@/lib/initials';
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
          {firstChar(clientName.trim()).toUpperCase() || '?'}
        </span>
        <span className="text-muted">⇄</span>
        <span className="flex h-11 w-11 items-center justify-center rounded-card bg-accent text-accent-fg">
          <Check size={22} strokeWidth={3} />
        </span>
      </div>
      <h1 className="text-[21px] font-extrabold leading-[1.25] tracking-[-0.02em] text-pretty [overflow-wrap:anywhere]">
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
      <p className="text-center text-meta text-pretty text-muted [overflow-wrap:anywhere]">
        Podés desconectar {clientName} cuando quieras desde Configuración.
      </p>
    </Shell>
  );
}
