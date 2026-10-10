'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import type { AuthState } from '@/app/(auth)/actions';

type Action = (prev: AuthState, form: FormData) => Promise<AuthState>;

const inputClass =
  'w-full rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent';

export function AuthForm({ mode, action, next }: { mode: 'login' | 'registro'; action: Action; next?: string }) {
  const [state, formAction, pending] = useActionState(action, null);
  const isLogin = mode === 'login';
  // El destino después de entrar (p. ej. el consentimiento OAuth) viaja también al cambiar entre login y registro.
  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : '';
  return (
    <form action={formAction} className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-bg p-6 shadow-sm">
      <h1 className="text-xl font-semibold">{isLogin ? 'Ingresar a Notas' : 'Crear cuenta'}</h1>
      {next && <input type="hidden" name="next" value={next} />}
      {!isLogin && (
        <label className="block space-y-1 text-sm">
          <span>Nombre</span>
          <input name="name" autoComplete="name" defaultValue={state?.values?.name} className={inputClass} />
        </label>
      )}
      <label className="block space-y-1 text-sm">
        <span>Email</span>
        <input
          name="email" type="email" required autoComplete="email"
          defaultValue={state?.values?.email} className={inputClass}
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Contraseña</span>
        <input
          name="password" type="password" required minLength={isLogin ? undefined : 8}
          autoComplete={isLogin ? 'current-password' : 'new-password'} className={inputClass}
        />
      </label>
      {!isLogin && (
        <label className="block space-y-1 text-sm">
          <span>Código de invitación</span>
          <input name="invite" required className={inputClass} />
        </label>
      )}
      {state && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <button
        type="submit" disabled={pending}
        className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg disabled:opacity-60"
      >
        {pending ? 'Un momento…' : isLogin ? 'Ingresar' : 'Crear cuenta'}
      </button>
      <p className="text-center text-sm text-muted">
        {isLogin ? (
          <>¿No tenés cuenta? <Link href={`/registro${nextQuery}`} className="text-accent">Registrate</Link></>
        ) : (
          <>¿Ya tenés cuenta? <Link href={`/login${nextQuery}`} className="text-accent">Ingresá</Link></>
        )}
      </p>
    </form>
  );
}
