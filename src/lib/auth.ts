import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createSession, deleteSession, getSessionUser } from '@/core/sessions';
import type { PublicUser } from '@/core/users';
import { getDb } from '@/db';

export const SESSION_COOKIE = 'notas_session';

/** Usuario logueado o null. Se memoiza por request. */
export const getCurrentUser = cache(async (): Promise<PublicUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionUser(await getDb(), token);
});

/** Usuario logueado; si no hay sesión, redirige a /login. Usar en TODA página y acción privada. */
export async function requireUser(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export async function startSession(userId: string): Promise<void> {
  const store = await cookies();
  // Si ya había una sesión en este navegador, se invalida antes de emitir la nueva.
  const oldToken = store.get(SESSION_COOKIE)?.value;
  if (oldToken) await deleteSession(await getDb(), oldToken);
  const { token, expiresAt } = await createSession(await getDb(), userId);
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(await getDb(), token);
  store.delete(SESSION_COOKIE);
}
