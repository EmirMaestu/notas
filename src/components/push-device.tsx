'use client';

import { Bell, BellOff, BellRing, Send } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import {
  checkPushSubscriptionAction, deletePushSubscriptionAction, savePushSubscriptionAction, sendTestNotificationAction,
} from '@/app/app/actions';
import { btn } from './ui';

type Support = 'checking' | 'unsupported' | 'ios-install' | 'denied' | 'ready';

/** Clave VAPID pública (base64url) → bytes para `applicationServerKey`. */
function base64UrlToBuffer(base64: string): ArrayBuffer {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

function sameKey(a: ArrayBuffer | null, b: ArrayBuffer): boolean {
  if (!a || a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  return x.every((v, i) => v === y[i]);
}

/** ¿El servidor tiene este endpoint registrado para la cuenta actual? Ante un error, se asume que no. */
async function isMine(endpoint: string): Promise<boolean> {
  const result = await checkPushSubscriptionAction(endpoint);
  return result.ok && result.data;
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Activar/desactivar las notificaciones en ESTE dispositivo. El service worker se registra recién al activar.
 * `publicKey` null = el servidor no tiene claves VAPID (todo deshabilitado, con la explicación).
 */
export function PushDevice({ publicKey, devices: initialDevices }: { publicKey: string | null; devices: number }) {
  const [support, setSupport] = useState<Support>('checking');
  const [subscribed, setSubscribed] = useState(false);
  const [devices, setDevices] = useState(initialDevices);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => setDevices(initialDevices), [initialDevices]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        if (!cancelled) setSupport(isIos() && !isStandalone() ? 'ios-install' : 'unsupported');
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (cancelled) return;
      // La suscripción del navegador puede ser de otra cuenta (dispositivo compartido): solo cuenta si es de esta.
      const owned = subscription !== null && await isMine(subscription.endpoint);
      if (cancelled) return;
      setSubscribed(owned);
      setSupport(Notification.permission === 'denied' ? 'denied' : 'ready');
    })().catch(() => {
      if (!cancelled) setSupport('unsupported');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function enable() {
    if (!publicKey) return;
    setMessage(null);
    // iPhone/iPad: el pedido de permiso tiene que salir directo del clic, antes de cualquier await.
    const permission = Notification.requestPermission();
    startTransition(async () => {
      try {
        if ((await permission) !== 'granted') {
          if (Notification.permission === 'denied') setSupport('denied');
          setMessage({ ok: false, text: 'No diste permiso para mostrar notificaciones.' });
          return;
        }
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
        await navigator.serviceWorker.ready;
        const key = base64UrlToBuffer(publicKey);
        let subscription = await registration.pushManager.getSubscription();
        // Una suscripción hecha con otras claves (si se regeneraron en el servidor) o que dejó otra cuenta en este
        // navegador no sirve: se da de baja acá (sin tocar la de la otra cuenta en el servidor) y se rehace.
        if (subscription && (!sameKey(subscription.options.applicationServerKey, key) || !(await isMine(subscription.endpoint)))) {
          await subscription.unsubscribe();
          subscription = null;
        }
        subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        const json = subscription.toJSON();
        const result = await savePushSubscriptionAction({
          endpoint: json.endpoint ?? subscription.endpoint,
          keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
          userAgent: navigator.userAgent,
        });
        if (!result.ok) {
          await subscription.unsubscribe();
          setMessage({ ok: false, text: result.error });
          return;
        }
        setSubscribed(true);
        setDevices(result.data.devices);
        setMessage({ ok: true, text: 'Listo: este dispositivo va a recibir tus avisos.' });
      } catch {
        setMessage({ ok: false, text: 'No se pudieron activar las notificaciones en este navegador.' });
      }
    });
  }

  function disable() {
    setMessage(null);
    startTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration('/');
        const subscription = registration ? await registration.pushManager.getSubscription() : null;
        if (subscription) {
          const result = await deletePushSubscriptionAction(subscription.endpoint);
          if (result.ok) setDevices(result.data.devices);
          await subscription.unsubscribe();
        }
        setSubscribed(false);
        setMessage({ ok: true, text: 'Este dispositivo ya no va a recibir avisos.' });
      } catch {
        setMessage({ ok: false, text: 'No se pudieron desactivar. Probá de nuevo.' });
      }
    });
  }

  function sendTest() {
    setMessage(null);
    startTransition(async () => {
      const result = await sendTestNotificationAction();
      setMessage(result.ok
        ? { ok: true, text: result.data.sent === 1 ? 'Prueba enviada a 1 dispositivo.' : `Prueba enviada a ${result.data.sent} dispositivos.` }
        : { ok: false, text: result.error });
    });
  }

  const status = !publicKey
    ? 'Las notificaciones no están configuradas en este servidor: faltan las claves VAPID.'
    : support === 'checking' ? 'Revisando este navegador…'
    : support === 'ios-install' ? 'En iPhone y iPad, primero agregá Notas a la pantalla de inicio (Compartir → «Agregar a inicio») y abrila desde ese ícono.'
    : support === 'unsupported' ? 'Este navegador no admite notificaciones push.'
    : support === 'denied' ? 'Bloqueaste las notificaciones de Notas en este navegador: habilitalas en la configuración del sitio y volvé a intentar.'
    : subscribed ? 'Activadas en este dispositivo.'
    : 'Desactivadas en este dispositivo.';

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-selected text-accent">
          {subscribed ? <BellRing size={17} /> : <Bell size={17} />}
        </span>
        <div className="min-w-0">
          <p className="font-semibold">Este dispositivo</p>
          <p className="text-caption text-pretty text-muted">{status}</p>
          {devices > 0 && (
            <p className="mt-1 text-meta text-muted">
              Activadas en {devices === 1 ? '1 dispositivo' : `${devices} dispositivos`} en total.
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {subscribed ? (
          <button type="button" onClick={disable} disabled={pending} className={`${btn.secondary} h-9 px-3 text-[13px]`}>
            <BellOff size={14} aria-hidden="true" />
            Desactivar en este dispositivo
          </button>
        ) : (
          <button
            type="button" onClick={enable} disabled={!publicKey || support !== 'ready' || pending}
            className={`${btn.primary} h-9 px-3.5 text-[13px]`}
          >
            <Bell size={14} aria-hidden="true" />
            Activar en este dispositivo
          </button>
        )}
        <button
          type="button" onClick={sendTest} disabled={!publicKey || devices === 0 || pending}
          className={`${btn.secondary} h-9 px-3 text-[13px]`}
        >
          <Send size={14} aria-hidden="true" />
          Enviar prueba
        </button>
      </div>
      <span role="status" className={`min-h-[17px] text-meta ${message?.ok === false ? 'text-danger' : 'text-muted'}`}>
        {pending ? 'Un momento…' : message?.text}
      </span>
    </div>
  );
}
