import { Sparkles } from 'lucide-react';
import { cookies } from 'next/headers';
import { logoutAction } from '@/app/(auth)/actions';
import { listApiTokens } from '@/core/api-tokens';
import { DEFAULT_TIMEZONE } from '@/core/dates';
import { listOAuthConnections } from '@/core/oauth';
import { getDb } from '@/db';
import { AiConnection } from '@/components/ai-connection';
import { Avatar } from '@/components/avatar';
import { LogoutButton } from '@/components/logout-button';
import { MobileHeader } from '@/components/mobile-header';
import { ThemeForm } from '@/components/theme-form';
import { TimezoneForm } from '@/components/timezone-form';
import { mcpResourceUrl } from '@/lib/app-url';
import { requireUser } from '@/lib/auth';
import { formatAgo, formatShortDate } from '@/lib/format';
import { THEME_COOKIE, parseTheme } from '@/lib/theme';

function SectionLabel({ title, help, ai = false }: { title: string; help?: string; ai?: boolean }) {
  return (
    <div className="mt-5 first:mt-0 md:mt-0">
      <h2 className="flex items-center gap-[7px] font-bold">
        {ai && <Sparkles size={15} strokeWidth={2.2} aria-hidden="true" className="text-accent" />}
        {title}
      </h2>
      {help && <p className="mt-1 text-caption text-pretty text-muted">{help}</p>}
    </div>
  );
}

export default async function SettingsPage() {
  const user = await requireUser();
  const db = await getDb();
  const [tokens, connections] = await Promise.all([listApiTokens(db, user.id), listOAuthConnections(db, user.id)]);
  // ICU no siempre lista el nombre actual de Buenos Aires; se agregan el default y el valor actual.
  const zones = [...new Set([...Intl.supportedValuesOf('timeZone'), DEFAULT_TIMEZONE, user.timezone])].sort();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  // Fechas armadas acá, en la zona del usuario: el cliente las recibe como texto.
  const now = new Date();
  const day = (d: Date) => formatShortDate(d, user.timezone);
  const lastUse = (d: Date | null) => (d ? formatAgo(d, now, user.timezone) : 'nunca');

  return (
    <div className="h-full overflow-y-auto">
      <MobileHeader title="Configuración" />
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-7 px-4 pb-10 md:px-7 md:pt-[30px]">
        <h1 className="hidden text-display md:block">Configuración</h1>
        <div className="grid grid-cols-1 items-start gap-x-6 gap-y-3 md:grid-cols-[180px_minmax(0,1fr)] md:gap-y-6">
          <SectionLabel title="Cuenta" />
          <div className="flex items-center gap-3 rounded-card border border-line bg-surface p-4">
            <Avatar person={user} size={36} />
            <div className="min-w-0">
              <p className="truncate font-semibold">{user.name || user.email}</p>
              {user.name && <p className="truncate text-caption text-muted">{user.email}</p>}
            </div>
          </div>

          <SectionLabel title="Zona horaria" help="Define qué es «hoy» para tus vistas y para la IA." />
          <TimezoneForm current={user.timezone} zones={zones} />

          <SectionLabel title="Tema" help="Por defecto sigue la configuración del sistema." />
          <ThemeForm current={theme} />

          <SectionLabel
            ai title="Conexión con IA"
            help="Claude, ChatGPT u otra IA compatible con MCP pueden crear, completar y mover tus tareas."
          />
          <AiConnection
            mcpUrl={mcpResourceUrl()}
            tokens={tokens.map((t) => ({
              id: t.id, name: t.name, prefix: t.prefix,
              detail: `Creado el ${day(t.createdAt)} · último uso ${lastUse(t.lastUsedAt)}`,
            }))}
            connections={connections.map((c) => ({
              clientId: c.clientId, clientName: c.clientName,
              detail: `${c.connectedAt ? `Conectada el ${day(c.connectedAt)} · último uso` : 'Último uso'} ${lastUse(c.lastUsedAt)}`,
            }))}
          />

          <div className="hidden md:block" />
          <form action={logoutAction} className="mt-5 md:mt-0">
            <LogoutButton />
          </form>
        </div>
      </div>
    </div>
  );
}
