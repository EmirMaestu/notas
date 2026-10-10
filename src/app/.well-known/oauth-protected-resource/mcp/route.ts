import { json, preflight } from '@/lib/oauth-http';
import { protectedResourceMetadata } from '@/lib/oauth-metadata';

// APP_URL se lee en cada request (no en el build).
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return json(protectedResourceMetadata());
}

export function OPTIONS(): Response {
  return preflight();
}
