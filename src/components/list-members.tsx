'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import type { ListMember } from '@/core/members';
import { addListMemberAction, getListMembersAction, removeListMemberAction } from '@/app/app/actions';
import { Avatar } from './avatar';
import { ConfirmDialog } from './confirm-dialog';
import { btn, field } from './ui';

/** Sección "Miembros" del diálogo de lista. El dueño invita por email y quita; un miembro solo ve. */
export function ListMembers({
  listId, isOwner, currentUserId,
}: { listId: string; isOwner: boolean; currentUserId: string }) {
  const headingId = useId();
  const [members, setMembers] = useState<ListMember[] | null>(null);
  const [email, setEmail] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<ListMember | null>(null);
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

  function remove() {
    const member = toRemove;
    if (!member) return;
    setActionError(null);
    startTransition(async () => {
      const result = await removeListMemberAction(listId, member.id);
      setToRemove(null);
      if (!result.ok) return setActionError(result.error);
      await load();
    });
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <h3 id={headingId} className="text-[13px] font-semibold">Miembros</h3>
        {members && <span className="text-meta tabular-nums text-muted">{members.length}</span>}
      </div>
      {isOwner && (
        <form onSubmit={add} className="flex gap-2">
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
            placeholder="Agregar por email" aria-label="Email del nuevo miembro" aria-invalid={actionError !== null}
            className={`${field} h-10 min-w-0 flex-1 bg-bg`}
          />
          <button type="submit" disabled={pending || members === null} className={`${btn.secondary} h-10 px-3.5 text-[13px]`}>
            Invitar
          </button>
        </form>
      )}
      {actionError && <p role="alert" className="text-meta font-medium text-danger">{actionError}</p>}
      {members === null && !loadError && (
        <div aria-busy="true" aria-label="Cargando miembros" className="flex flex-col">
          {[0, 1].map((i) => (
            <div key={i} className="flex h-11 items-center gap-2.5">
              <span className="h-[26px] w-[26px] animate-skeleton rounded-full bg-skeleton" />
              <span className="h-3 w-40 animate-skeleton rounded-chip bg-skeleton" />
            </div>
          ))}
        </div>
      )}
      {loadError && <p role="alert" className="text-[13px] text-danger">{loadError}</p>}
      {members && (
        <ul className="flex flex-col">
          {members.map((m) => {
            const isMe = m.id === currentUserId;
            return (
              <li key={m.id} className="flex h-11 items-center gap-2.5">
                <Avatar person={m} size={26} />
                <span className="min-w-0 flex-1 truncate text-body-sm">
                  {m.name || m.email}
                  {!isOwner && isMe
                    ? <span className="text-muted"> · vos</span>
                    : m.name && <span className="text-muted"> · {m.email}</span>}
                </span>
                {m.role === 'owner' ? (
                  <span className="text-overline uppercase tracking-[.05em] text-muted">Dueño</span>
                ) : isOwner && (
                  <button
                    type="button" onClick={() => setToRemove(m)} disabled={pending} aria-label={`Quitar a ${m.email}`}
                    className="rounded-nav px-2 py-1.5 text-[13px] font-semibold text-muted transition-colors duration-120 hover:bg-danger-bg hover:text-danger disabled:opacity-50"
                  >
                    Quitar
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {toRemove && (
        <ConfirmDialog
          title={`¿Quitar a ${toRemove.name || toRemove.email}?`}
          body="Deja de ver la lista y sus tareas asignadas quedan sin asignar."
          confirmLabel="Quitar" pending={pending} onCancel={() => setToRemove(null)} onConfirm={remove}
        />
      )}
    </section>
  );
}
