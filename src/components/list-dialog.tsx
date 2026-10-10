'use client';

import { ChevronDown, Users } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import type { Folder, ListOwner, ListWithRole } from '@/core/lists';
import {
  createFolderAction, createListAction, deleteListAction, leaveListAction, updateListAction,
} from '@/app/app/actions';
import { ConfirmDialog } from './confirm-dialog';
import { ListMembers } from './list-members';
import { Modal } from './modal';
import { btn, field } from './ui';

/** Los 9 colores de lista del diseño (fijos en los dos temas). */
export const LIST_COLORS = [
  { value: '#15697B', name: 'Petróleo' },
  { value: '#2F6FD6', name: 'Azul' },
  { value: '#12A594', name: 'Turquesa' },
  { value: '#2F8F5B', name: 'Verde' },
  { value: '#D08A1A', name: 'Ámbar' },
  { value: '#E0641C', name: 'Naranja' },
  { value: '#C23B30', name: 'Rojo' },
  { value: '#C2559A', name: 'Rosa' },
  { value: '#7A5AD6', name: 'Violeta' },
];
const NEW_FOLDER = '__new';

const LABEL = 'flex flex-col gap-1.5 text-[13px] font-semibold';

function ColorDot({ color }: { color: string | null }) {
  return <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: color ?? 'var(--muted)' }} />;
}

export function ListDialog({
  list, folders, owner, currentUserId, onClose,
}: {
  list?: ListWithRole; folders: Folder[];
  /** Dueño de la lista (para el aviso que ve un miembro). */
  owner?: ListOwner;
  currentUserId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const formId = useId();
  const colorLabelId = useId();
  const [name, setName] = useState(list?.name ?? '');
  const [color, setColor] = useState<string | null>(list ? list.color : LIST_COLORS[0].value);
  const [folderId, setFolderId] = useState(list?.folderId ?? '');
  const [newFolder, setNewFolder] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'delete' | 'leave' | null>(null);
  const [pending, startTransition] = useTransition();

  /** Tras borrar la lista o salir de ella: si se la estaba mirando, a la Bandeja. */
  function afterLosingList(listId: string) {
    onClose();
    if (pathname === `/app/list/${listId}`) router.push('/app/inbox');
    else router.refresh();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('El nombre de la lista no puede estar vacío');
    if (folderId === NEW_FOLDER && !newFolder.trim()) return setError('El nombre de la carpeta no puede estar vacío');
    setError(null);
    startTransition(async () => {
      let targetFolder: string | null = folderId || null;
      if (folderId === NEW_FOLDER) {
        const created = await createFolderAction(newFolder);
        if (!created.ok) return setError(created.error);
        targetFolder = created.data.id;
        // Si el guardado de la lista falla, un reintento reutiliza la carpeta ya creada.
        setFolderId(created.data.id);
      }
      if (list) {
        const result = await updateListAction(list.id, { name, color, folderId: targetFolder });
        if (!result.ok) return setError(result.error);
        onClose();
      } else {
        const result = await createListAction({ name, color, folderId: targetFolder });
        if (!result.ok) return setError(result.error);
        onClose();
        router.push(`/app/list/${result.data.id}`);
      }
    });
  }

  function remove() {
    if (!list) return;
    startTransition(async () => {
      const result = await deleteListAction(list.id);
      if (!result.ok) {
        setConfirm(null);
        return setError(result.error);
      }
      afterLosingList(list.id);
    });
  }

  function leave() {
    if (!list) return;
    startTransition(async () => {
      const result = await leaveListAction(list.id);
      if (!result.ok) {
        setConfirm(null);
        return setError(result.error);
      }
      afterLosingList(list.id);
    });
  }

  const errorBox = error && <p role="alert" className="text-[13px] font-medium text-danger">{error}</p>;

  // Miembro: solo lectura, ver miembros y salir.
  if (list && list.role === 'member') {
    return (
      <Modal
        title={list.name} titleAdornment={<ColorDot color={list.color} />} onClose={onClose}
        footer={(
          <>
            <span className="flex-1" />
            <button
              type="button" onClick={() => setConfirm('leave')} disabled={pending}
              className="inline-flex h-10 items-center rounded-input border border-line bg-surface px-3.5 text-[13.5px] font-semibold text-danger transition-colors duration-120 hover:bg-danger-bg disabled:opacity-50"
            >
              Salir de la lista
            </button>
          </>
        )}
      >
        <div className="flex flex-col gap-4">
          <div className="flex gap-2.5 rounded-row border border-line bg-bg px-3.5 py-3 text-[13px] leading-normal text-muted">
            <Users size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
            <p className="text-pretty">
              {owner ? `${owner.name || owner.email} compartió esta lista con vos.` : 'Esta lista está compartida con vos.'}{' '}
              Solo quien la creó puede cambiarle el nombre, el color o borrarla.
            </p>
          </div>
          <ListMembers listId={list.id} isOwner={false} currentUserId={currentUserId} />
          {errorBox}
        </div>
        {confirm === 'leave' && (
          <ConfirmDialog
            title={`¿Salir de «${list.name}»?`} body="Vas a dejar de ver sus tareas. Para volver, te tienen que invitar de nuevo."
            confirmLabel="Salir de la lista" pending={pending} onCancel={() => setConfirm(null)} onConfirm={leave}
          />
        )}
      </Modal>
    );
  }

  return (
    <Modal
      title={list ? 'Editar lista' : 'Nueva lista'} onClose={onClose}
      footer={(
        <>
          {list && (
            <button
              type="button" onClick={() => setConfirm('delete')} disabled={pending}
              className={`${btn.ghostDanger} h-10 px-2.5 text-[13px]`}
            >
              Borrar lista
            </button>
          )}
          <span className="flex-1" />
          <button type="button" onClick={onClose} className={`${btn.secondary} h-10 px-3.5 text-[13.5px]`}>Cancelar</button>
          <button type="submit" form={formId} disabled={pending} className={`${btn.primary} h-10 px-[18px] text-[13.5px]`}>
            Guardar
          </button>
        </>
      )}
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-[18px]">
        <label className={LABEL}>
          Nombre
          <input
            autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Por ejemplo, Casa"
            aria-label="Nombre de la lista" className={`${field} h-[42px] bg-bg font-normal`}
          />
        </label>
        <div className="flex flex-col gap-2">
          <span id={colorLabelId} className="text-[13px] font-semibold">Color</span>
          <div role="radiogroup" aria-labelledby={colorLabelId} className="flex flex-wrap gap-2.5">
            {LIST_COLORS.map(({ value, name: colorName }) => {
              const checked = color?.toLowerCase() === value.toLowerCase();
              return (
                <button
                  key={value} type="button" role="radio" aria-checked={checked} aria-label={colorName}
                  onClick={() => setColor(value)} style={{ backgroundColor: value }}
                  className={`h-[26px] w-[26px] rounded-full transition-shadow duration-120 ${checked ? 'shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--fg)]' : 'hover:shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--border)]'}`}
                />
              );
            })}
          </div>
        </div>
        <label className={LABEL}>
          Carpeta
          <span className="relative flex items-center">
            <select
              value={folderId} onChange={(e) => setFolderId(e.target.value)} aria-label="Carpeta"
              className={`${field} h-[42px] cursor-pointer appearance-none bg-bg pr-9 font-normal ${folderId ? '' : 'text-muted'}`}
            >
              <option value="" className="text-fg">Sin carpeta</option>
              {folders.map((f) => <option key={f.id} value={f.id} className="text-fg">{f.name}</option>)}
              <option value={NEW_FOLDER} className="text-fg">+ Nueva carpeta…</option>
            </select>
            <ChevronDown size={14} strokeWidth={2.4} aria-hidden="true" className="pointer-events-none absolute right-2.5 text-muted" />
          </span>
        </label>
        {folderId === NEW_FOLDER && (
          <input
            value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="Nombre de la carpeta"
            aria-label="Nombre de la carpeta" className={`${field} h-[42px] bg-bg`}
          />
        )}
        {errorBox}
      </form>
      {/* Fuera del <form>: ListMembers tiene su propio formulario (no se pueden anidar). */}
      {list && (
        <div className="mt-[18px] border-t border-line pt-4">
          <ListMembers listId={list.id} isOwner currentUserId={currentUserId} />
        </div>
      )}
      {confirm === 'delete' && list && (
        <ConfirmDialog
          title={`¿Borrar «${list.name}»?`} body="Sus tareas van a la papelera: podés restaurarlas durante 30 días."
          confirmLabel="Borrar lista" pending={pending} onCancel={() => setConfirm(null)} onConfirm={remove}
        />
      )}
    </Modal>
  );
}
