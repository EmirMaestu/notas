'use server';

import { createHash, timingSafeEqual } from 'node:crypto';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createUser, verifyCredentials } from '@/core/users';
import { getDb } from '@/db';
import { runAction } from '@/lib/action-result';
import { endSession, startSession } from '@/lib/auth';
import { clientIpFrom, trustedProxyHops } from '@/lib/client-ip';
import { createRateLimiter } from '@/lib/rate-limit';
import { safeRedirect } from '@/lib/safe-redirect';

const MIN_15 = 15 * 60 * 1000;
const registerLimiter = createRateLimiter({ max: 10, windowMs: MIN_15 });
const loginPairLimiter = createRateLimiter({ max: 10, windowMs: MIN_15 });
const loginIpLimiter = createRateLimiter({ max: 30, windowMs: MIN_15 });
const loginEmailLimiter = createRateLimiter({ max: 50, windowMs: 60 * 60 * 1000 });

const TOO_MANY = 'Demasiados intentos. Esperá unos minutos.';

/** Estado de los formularios de acceso: en error devuelve los valores no sensibles para no borrarlos. */
export type AuthState = { ok: false; error: string; values?: { email?: string; name?: string } } | null;

// Detrás de Caddy (que agrega la IP real al final de X-Forwarded-For) hay que confiar solo en esa entrada.
async function clientIp(): Promise<string> {
  return clientIpFrom((await headers()).get('x-forwarded-for'), trustedProxyHops());
}

function sameSecret(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

const field = (form: FormData, name: string) => String(form.get(name) ?? '');

export async function loginAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = field(form, 'email');
  const values = { email };
  const emailKey = email.trim().toLowerCase().slice(0, 254);
  const ip = await clientIp();
  const pairKey = `${ip}:${emailKey}`;
  // Se consultan los tres (sin cortocircuito) para que cada uno cuente el intento.
  const allowed = [
    loginPairLimiter.check(pairKey),
    loginIpLimiter.check(ip),
    loginEmailLimiter.check(emailKey),
  ].every(Boolean);
  if (!allowed) return { ok: false, error: TOO_MANY, values };

  const result = await runAction(async () => {
    const user = await verifyCredentials(await getDb(), email, field(form, 'password'));
    if (!user) return false;
    await startSession(user.id);
    return true;
  });
  if (!result.ok) return { ok: false, error: result.error, values };
  if (!result.data) return { ok: false, error: 'Email o contraseña incorrectos', values };
  loginPairLimiter.reset(pairKey);
  redirect(safeRedirect(form.get('next')));
}

export async function registerAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const values = { email: field(form, 'email'), name: field(form, 'name') };
  const inviteCode = process.env.INVITE_CODE;
  if (!inviteCode) return { ok: false, error: 'El registro está deshabilitado', values };
  if (!registerLimiter.check(`registro:${await clientIp()}`)) return { ok: false, error: TOO_MANY, values };
  if (!sameSecret(field(form, 'invite'), inviteCode)) return { ok: false, error: 'Código de invitación inválido', values };

  const result = await runAction(async () => {
    const user = await createUser(await getDb(), {
      email: values.email, password: field(form, 'password'), name: values.name,
    });
    await startSession(user.id);
  });
  if (!result.ok) return { ok: false, error: result.error, values };
  redirect(safeRedirect(form.get('next')));
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect('/login');
}
