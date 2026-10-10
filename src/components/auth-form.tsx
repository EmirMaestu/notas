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
