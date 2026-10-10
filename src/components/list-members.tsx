'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import type { ListMember } from '@/core/members';
import { addListMemberAction, getListMembersAction, removeListMemberAction } from '@/app/app/actions';
import { Avatar } from './avatar';

/** Sección "Miembros" del diálogo de lista. El dueño agrega por email y quita; un miembro solo ve. */
export function ListMembers({ listId, isOwner }: { listId: string; isOwner: boolean }) {
  const headingId = useId();
  const [members, setMembers] = useState<ListMember[] | null>(null);
  const [email, setEmail] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Cada carga lleva un número; solo la última puede escribir el estado (descarta respuestas viejas).
  const requestId = useRef(0);

  async function load() {
    const id = ++requestId.current;
    const result = await getListMembersAction(listId);
    if (id !== requestId.current) return;
    if (result.ok) {
      setMembers(result.data);
      setLoadError(null);
    } else {
      setLoadError(result.error);
    }
  }

  useEffect(() => {
    setMembers(null);
    setLoadError(null);
    void load();
    // Invalida cualquier carga en vuelo al desmontar o cambiar de lista.
    const counter = requestId;
    return () => { counter.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId]);

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return setActionError('Ingresá el email de la persona');
    setActionError(null);
    startTransition(async () => {
      const result = await addListMemberAction(listId, email);
      if (!result.ok) return setActionError(result.error);
      setEmail('');
      await load();
    });
  }

  function remove(member: ListMember) {
    if (!confirm(`¿Quitar a ${member.email} de la lista? Sus tareas asignadas quedan sin asignar.`)) return;
    setActionError(null);
    startTransition(async () => {
      const result = await removeListMemberAction(listId, member.id);
      if (!result.ok) return setActionError(result.error);
      await load();
    });
  }

  return (
    <section aria-labelledby={headingId} className="mt-5 border-t border-line pt-4">
      <h3 id={headingId} className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Miembros</h3>
      {members === null && !loadError && <p className="text-sm text-muted">Cargando…</p>}
      {loadError && <p role="alert" className="mb-2 text-sm text-danger">{loadError}</p>}
      {members && (
        <ul className="mb-3 space-y-1.5 text-sm">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-2">
              <Avatar person={m} size={26} />
              <span className="min-w-0 flex-1 truncate">
                {m.name || m.email}
                {m.name && <span className="text-muted"> · {m.email}</span>}
              </span>
              {m.role === 'owner' ? (
                <span className="text-xs text-muted">Dueño</span>
              ) : isOwner && (
                <button
                  type="button" onClick={() => remove(m)} disabled={pending} aria-label={`Quitar a ${m.email}`}
                  className="rounded p-1 text-muted hover:bg-hover hover:text-danger disabled:opacity-60"
                >
                  <X size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {isOwner && (
        <form onSubmit={add} className="flex gap-2">
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
            placeholder="Email de la persona" aria-label="Email del nuevo miembro"
            className="min-w-0 flex-1 rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit" disabled={pending || members === null}
            className="rounded-md border border-line px-3 py-2 text-sm hover:bg-hover disabled:opacity-60"
          >
            Agregar
          </button>
        </form>
      )}
      {actionError && <p role="alert" className="mt-2 text-sm text-danger">{actionError}</p>}
    </section>
  );
}
