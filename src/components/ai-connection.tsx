'use client';

import { Check, Copy, KeyRound } from 'lucide-react';
import { useState, useTransition } from 'react';
import { firstChar } from '@/lib/initials';
import { createApiTokenAction, revokeApiTokenAction, revokeOAuthConnectionAction } from '@/app/app/actions';
import { ConfirmDialog } from './confirm-dialog';
import { useToast } from './toast';
import { btn, field, sectionLabel } from './ui';

/** El servidor arma `detail` en la zona del usuario: así no hay diferencias de fechas al hidratar. */
export interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  detail: string;
}

export interface ConnectionRow {
  clientId: string;
  clientName: string;
  detail: string;
}

type Pending = { kind: 'token'; row: TokenRow } | { kind: 'connection'; row: ConnectionRow };

const CARD = 'overflow-hidden rounded-card border border-line bg-surface';
const ROW = 'flex items-center gap-3 border-b border-line px-3.5 py-3 last:border-b-0';
const DANGER_LINK = 'shrink-0 rounded-pill px-2 py-1.5 text-[13px] font-semibold text-danger transition-colors duration-120 hover:bg-danger-bg disabled:opacity-50';
const CODE = 'flex h-10 min-w-0 flex-1 items-center truncate rounded-input border border-line bg-surface px-3 font-mono';

function CopyButton({ text, label, primary = false }: { text: string; label: string; primary?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button" aria-label={label} title={label}
      className={`${primary ? btn.primary : btn.secondary} h-10 shrink-0 px-3 text-[13px]`}
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
      {copied ? <Check size={14} strokeWidth={2.2} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      {copied ? 'Copiado' : 'Copiar'}
    </button>
  );
}

/** Sección "Conexión con IA" de Configuración: URL del MCP, apps conectadas por OAuth y tokens personales. */
export function AiConnection({ mcpUrl, tokens, connections }: {
  mcpUrl: string;
  tokens: TokenRow[];
  connections: ConnectionRow[];
}) {
  const [name, setName] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function create(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const result = await createApiTokenAction(name);
        if (result.ok) {
          setNewToken(result.data.token);
          setName('');
          setError(null);
        } else {
          setError(result.error);
        }
      } catch {
        toast({ tone: 'error', message: 'No se pudo crear el token. Probá de nuevo.' });
      }
    });
  }

  function revoke() {
    const target = confirm;
    if (!target) return;
    startTransition(async () => {
      try {
        const result = target.kind === 'token'
          ? await revokeApiTokenAction(target.row.id)
          : await revokeOAuthConnectionAction(target.row.clientId);
        setError(result.ok ? null : result.error);
      } catch {
        toast({ tone: 'error', message: target.kind === 'token' ? 'No se pudo revocar el token. Probá de nuevo.' : 'No se pudo desconectar la app. Probá de nuevo.' });
      } finally {
        setConfirm(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h3 className={sectionLabel}>URL del servidor MCP</h3>
        <p className="text-caption text-pretty text-muted">
          Pegala en tu IA: te va a pedir que inicies sesión y autorices el acceso.
        </p>
        <div className="flex gap-2">
          <code aria-label="URL del servidor MCP" className={`${CODE} text-[13px]`}>{mcpUrl}</code>
          <CopyButton text={mcpUrl} label="Copiar URL del servidor MCP" />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className={sectionLabel}>Apps conectadas</h3>
        {connections.length === 0 ? (
          <p className="text-caption text-muted">Ninguna app conectada con OAuth.</p>
        ) : (
          <ul className={CARD}>
            {connections.map((c) => (
              <li key={c.clientId} className={ROW}>
                <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-nav bg-hover text-[13px] font-extrabold">
                  {firstChar(c.clientName.trim()).toUpperCase() || '?'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{c.clientName}</p>
                  <p className="truncate text-meta text-muted">{c.detail}</p>
                </div>
                <button
                  type="button" disabled={pending} onClick={() => setConfirm({ kind: 'connection', row: c })}
                  aria-label={`Desconectar ${c.clientName}`} className={DANGER_LINK}
                >
                  Desconectar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className={sectionLabel}>Tokens personales</h3>
        <p className="text-caption text-pretty text-muted">
          Para apps sin OAuth (Cursor, n8n, scripts). Se mandan como{' '}
          <code className="font-mono text-[12px]">Authorization: Bearer …</code>
        </p>
        <form onSubmit={create} className="flex gap-2">
          <input
            value={name} onChange={(e) => setName(e.target.value)} aria-label="Nombre del token"
            placeholder="Nombre del token, p. ej. Cursor" maxLength={100}
            className={`${field} h-10 min-w-0 flex-1 bg-surface`}
          />
          <button type="submit" disabled={pending || !name.trim()} className={`${btn.primary} h-10 shrink-0 px-3.5 text-[13px]`}>
            Crear token
          </button>
        </form>
        {newToken && (
          <div role="status" className="flex flex-col gap-2.5 rounded-card border border-accent bg-selected p-3.5">
            <p className="flex items-center gap-2 font-bold text-accent">
              <KeyRound size={15} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
              Copiá el token ahora: no se va a volver a mostrar.
            </p>
            <div className="flex gap-2">
              <code aria-label="Token nuevo" className={`${CODE} text-[12.5px]`}>{newToken}</code>
              <CopyButton text={newToken} label="Copiar token" primary />
            </div>
            <button
              type="button" onClick={() => setNewToken(null)}
              className="self-start text-[13px] font-semibold text-accent underline underline-offset-[3px] hover:text-accent-hover"
            >
              Listo, ya lo guardé
            </button>
          </div>
        )}
        {tokens.length === 0 ? (
          <p className="text-caption text-muted">No tenés tokens activos.</p>
        ) : (
          <ul className={CARD}>
            {tokens.map((t) => (
              <li key={t.id} className={ROW}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {t.name}
                    <code className="ml-1.5 font-mono text-[12px] font-normal text-muted">{t.prefix}…</code>
                  </p>
                  <p className="truncate text-meta text-muted">{t.detail}</p>
                </div>
                <button
                  type="button" disabled={pending} onClick={() => setConfirm({ kind: 'token', row: t })}
                  aria-label={`Revocar token ${t.name}`} className={DANGER_LINK}
                >
                  Revocar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p role="alert" className="text-[13px] font-medium text-danger">{error}</p>}

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'token' ? `¿Revocar «${confirm.row.name}»?` : `¿Desconectar ${confirm.row.clientName}?`}
          body={confirm.kind === 'token'
            ? 'Lo que use este token deja de tener acceso al instante.'
            : 'La app va a tener que pedir acceso de nuevo.'}
          confirmLabel={confirm.kind === 'token' ? 'Revocar' : 'Desconectar'}
          pending={pending} onCancel={() => setConfirm(null)} onConfirm={revoke}
        />
      )}
    </div>
  );
}
