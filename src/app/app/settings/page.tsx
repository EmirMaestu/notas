import { logoutAction } from '@/app/(auth)/actions';
import { listApiTokens } from '@/core/api-tokens';
import { DEFAULT_TIMEZONE } from '@/core/dates';
import { listOAuthConnections } from '@/core/oauth';
import { getDb } from '@/db';
import { AiConnection } from '@/components/ai-connection';
import { LogoutButton } from '@/components/logout-button';
import { TimezoneForm } from '@/components/timezone-form';
import { mcpResourceUrl } from '@/lib/app-url';
import { requireUser } from '@/lib/auth';

export default async function SettingsPage() {
  const user = await requireUser();
  const db = await getDb();
  const [tokens, connections] = await Promise.all([listApiTokens(db, user.id), listOAuthConnections(db, user.id)]);
  // ICU no siempre lista el nombre actual de Buenos Aires; se agregan el default y el valor actual.
  const zones = [...new Set([...Intl.supportedValuesOf('timeZone'), DEFAULT_TIMEZONE, user.timezone])].sort();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-8 p-6">
        <h1 className="text-xl font-semibold">Configuración</h1>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Cuenta</h2>
          <p className="text-sm text-muted">{user.name ? `${user.name} · ` : ''}{user.email}</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Zona horaria</h2>
          <p className="text-sm text-muted">Define qué es &quot;hoy&quot; para tus vistas y para la IA.</p>
          <TimezoneForm current={user.timezone} zones={zones} />
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Conexión con IA</h2>
          <AiConnection
            mcpUrl={mcpResourceUrl()}
            tokens={tokens.map((t) => ({
              id: t.id, name: t.name, prefix: t.prefix, createdAt: t.createdAt.toISOString(),
              lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
            }))}
            connections={connections.map((c) => ({
              clientId: c.clientId, clientName: c.clientName, lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
            }))}
          />
        </section>

        <form action={logoutAction}>
          <LogoutButton />
        </form>
      </div>
    </div>
  );
}
