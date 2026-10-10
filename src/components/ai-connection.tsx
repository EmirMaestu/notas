'use client';

import { Check, Copy } from 'lucide-react';
import { useState, useTransition } from 'react';
import { createApiTokenAction, revokeApiTokenAction, revokeOAuthConnectionAction } from '@/app/app/actions';

/** Fechas en ISO (las arma el servidor): así no hay diferencias de zona horaria al hidratar. */
export interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ConnectionRow {
  clientId: string;
  clientName: string;
  lastUsedAt: string | null;
}

const buttonClass = 'rounded-md border border-line px-3 py-2 text-sm hover:bg-hover disabled:opacity-60';

function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : 'nunca';
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button" aria-label={label} title={label} className={buttonClass}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
    </button>
  );
}

/** Sección "Conexión con IA" de Configuración: URL del MCP, tokens personales y apps conectadas por OAuth. */
export function AiConnection({ mcpUrl, tokens, connections }: {
  mcpUrl: string;
  tokens: TokenRow[];
  connections: ConnectionRow[];
}) {
  const [name, setName] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createApiTokenAction(name);
      if (result.ok) {
        setNewToken(result.data.token);
        setName('');
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }

  function revokeToken(row: TokenRow) {
    if (!window.confirm(`¿Revocar el token "${row.name}"? Lo que lo use deja de tener acceso.`)) return;
    startTransition(async () => {
      const result = await revokeApiTokenAction(row.id);
      setError(result.ok ? null : result.error);
    });
  }

  function revokeConnection(row: ConnectionRow) {
    if (!window.confirm(`¿Desconectar "${row.clientName}"? Va a tener que pedir acceso de nuevo.`)) return;
    startTransition(async () => {
      const result = await revokeOAuthConnectionAction(row.clientId);
      setError(result.ok ? null : result.error);
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted">
          Para conectar Claude, ChatGPT u otra IA compatible con MCP, usá esta URL. Te va a pedir que inicies sesión y
          autorices el acceso.
        </p>
        <div className="flex items-center gap-2">
          <code aria-label="URL del servidor MCP" className="min-w-0 flex-1 truncate rounded-md border border-line bg-sidebar px-3 py-2 text-sm">
            {mcpUrl}
          </code>
          <CopyButton text={mcpUrl} label="Copiar URL del servidor MCP" />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Tokens personales</h3>
        <p className="text-sm text-muted">
          Para apps sin OAuth (Cursor, n8n, scripts): mandá el token en el header{' '}
          <code className="text-xs">Authorization: Bearer …</code>.
        </p>
        <form onSubmit={create} className="flex flex-wrap items-center gap-2">
          <input
            value={name} onChange={(e) => setName(e.target.value)} aria-label="Nombre del token"
            placeholder="p. ej. Cursor" maxLength={100}
            className="min-w-0 flex-1 rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit" disabled={pending || !name.trim()}
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg disabled:opacity-60"
          >
            Crear token
          </button>
        </form>
        {newToken && (
          <div role="status" className="space-y-2 rounded-md border border-accent p-3">
            <p className="text-sm">Copiá el token ahora: no se va a volver a mostrar.</p>
            <div className="flex items-center gap-2">
              <code aria-label="Token nuevo" className="min-w-0 flex-1 break-all rounded-md bg-sidebar px-3 py-2 text-sm">
                {newToken}
              </code>
              <CopyButton text={newToken} label="Copiar token" />
            </div>
            <button type="button" onClick={() => setNewToken(null)} className="text-sm text-muted underline">
              Listo, ya lo guardé
            </button>
          </div>
        )}
        {tokens.length === 0 ? (
          <p className="text-sm text-muted">No tenés tokens activos.</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{t.name}</span>{' '}
                  <span className="text-muted">· {t.prefix}… · creado {day(t.createdAt)} · último uso {day(t.lastUsedAt)}</span>
                </span>
                <button
                  type="button" disabled={pending} onClick={() => revokeToken(t)} aria-label={`Revocar token ${t.name}`}
                  className="shrink-0 text-danger hover:underline disabled:opacity-60"
                >
                  Revocar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Apps conectadas</h3>
        {connections.length === 0 ? (
          <p className="text-sm text-muted">Ninguna app conectada con OAuth.</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {connections.map((c) => (
              <li key={c.clientId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{c.clientName}</span>{' '}
                  <span className="text-muted">· último uso {day(c.lastUsedAt)}</span>
                </span>
                <button
                  type="button" disabled={pending} onClick={() => revokeConnection(c)}
                  aria-label={`Desconectar ${c.clientName}`}
                  className="shrink-0 text-danger hover:underline disabled:opacity-60"
                >
                  Desconectar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
