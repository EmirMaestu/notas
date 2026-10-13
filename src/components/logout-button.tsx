'use client';

import { LogOut } from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import { useFormStatus } from 'react-dom';
import { deletePushSubscriptionAction } from '@/app/app/actions';
import { btn } from './ui';

/** Lo más que se espera por la baja del dispositivo: cerrar sesión no puede quedar colgado por esto. */
const FORGET_TIMEOUT_MS = 4000;

/**
 * Antes de cerrar sesión, borra la suscripción push de ESTE navegador (en el servidor y en el navegador): en un
 * dispositivo compartido, la persona siguiente no tiene que recibir los avisos de la anterior. Nunca lanza.
 */
async function forgetThisDevice(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    if (!subscription) return;
    await deletePushSubscriptionAction(subscription.endpoint);
    await subscription.unsubscribe();
  } catch {
    // Si falla, se cierra la sesión igual: PushDevice detecta al entrar que la suscripción no es de esa cuenta.
  }
}

export function LogoutButton() {
  const { pending } = useFormStatus();
  const [forgetting, setForgetting] = useState(false);

  async function onClick(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    if (!form || forgetting) return;
    event.preventDefault();
    setForgetting(true);
    await Promise.race([forgetThisDevice(), new Promise((resolve) => setTimeout(resolve, FORGET_TIMEOUT_MS))]);
    form.requestSubmit();
  }

  const busy = pending || forgetting;
  return (
    <button type="submit" onClick={onClick} disabled={busy} className={`${btn.secondary} h-[38px] px-3.5 text-[13px]`}>
      <LogOut size={14} aria-hidden="true" />
      {busy ? 'Cerrando sesión…' : 'Cerrar sesión'}
    </button>
  );
}
