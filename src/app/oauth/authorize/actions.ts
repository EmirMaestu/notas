'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { authorizationParamsFrom } from '@/core/oauth';
import { getDb } from '@/db';
import { appUrl, mcpResourceUrl } from '@/lib/app-url';
import { getCurrentUser } from '@/lib/auth';
import { isSameOriginSubmission, resolveConsent } from '@/lib/oauth-consent';

/** Revalida todo lo que viene del formulario de consentimiento y redirige al cliente. */
async function decide(form: FormData, approve: boolean): Promise<never> {
  // Un envío iniciado desde otro sitio no puede aprobar nada (defensa extra al origen que Next ya comprueba).
  if (!isSameOriginSubmission((await headers()).get('sec-fetch-site'))) {
    throw new Error('Solicitud rechazada: el consentimiento solo se puede enviar desde Notas');
  }
  const user = await getCurrentUser();
  const params = authorizationParamsFrom((name) => {
    const values = form.getAll(name).filter((v): v is string => typeof v === 'string');
    return values.length > 1 ? values : values[0];
  });
  const outcome = await resolveConsent(await getDb(), params, {
    approve, user, issuer: appUrl(), resource: mcpResourceUrl(),
  });
  // La página ya validó lo mismo: un error de client_id/redirect_uri acá significa que el formulario fue manipulado.
  if (outcome.type === 'error') throw new Error(outcome.message);
  redirect(outcome.url);
}

export async function approveAuthorizationAction(form: FormData): Promise<void> {
  await decide(form, true);
}

export async function denyAuthorizationAction(form: FormData): Promise<void> {
  await decide(form, false);
}
