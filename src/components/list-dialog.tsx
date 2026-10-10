'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { Folder, ListWithRole } from '@/core/lists';
import {
  createFolderAction, createListAction, deleteListAction, leaveListAction, updateListAction,
} from '@/app/app/actions';
import { ListMembers } from './list-members';
import { Modal } from './modal';

export const LIST_COLORS = ['#5b5bd6', '#3e8ef7', '#12a594', '#30a46c', '#f5a524', '#f76b15', '#e5484d', '#d6409f', '#8e8c99'];
const NEW_FOLDER = '__new';

export function ListDialog({ list, folders, onClose }: { list?: ListWithRole; folders: Folder[]; onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [name, setName] = useState(list?.name ?? '');
  const [color, setColor] = useState<string | null>(list ? list.color : LIST_COLORS[0]);
  const [folderId, setFolderId] = useState(list?.folderId ?? '');
  const [newFolder, setNewFolder] = useState('');
  const [error, setError] = useState<string | null>(null);
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
    if (!list || !confirm(`¿Borrar la lista "${list.name}"? Sus tareas van a la papelera.`)) return;
    startTransition(async () => {
      const result = await deleteListAction(list.id);
      if (!result.ok) return setError(result.error);
      afterLosingList(list.id);
    });
  }

  function leave() {
    if (!list || !confirm(`¿Salir de la lista "${list.name}"? Vas a dejar de ver sus tareas.`)) return;
    startTransition(async () => {
      const result = await leaveListAction(list.id);
      if (!result.ok) return setError(result.error);
      afterLosingList(list.id);
    });
  }

  // Miembro: solo lectura, ver miembros y salir.
  if (list && list.role === 'member') {
    return (
      <Modal title={list.name} onClose={onClose}>
        <p className="text-sm text-muted">
          Esta lista está compartida con vos. Solo su dueño puede cambiarle el nombre, el color o borrarla.
        </p>
        <ListMembers listId={list.id} isOwner={false} />
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex">
          <button
            type="button" onClick={leave} disabled={pending}
            className="ml-auto rounded-md px-3 py-2 text-sm text-danger hover:bg-hover disabled:opacity-60"
          >
            Salir de la lista
          </button>
        </div>
      </Modal>
    );
  }

  const field = 'w-full rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent';
  return (
    <Modal title={list ? 'Editar lista' : 'Nueva lista'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" aria-label="Nombre de la lista" className={field} />
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
          {LIST_COLORS.map((c) => (
            <button
              key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)}
              className={`h-6 w-6 rounded-full ${color === c ? 'ring-2 ring-fg ring-offset-2 ring-offset-bg' : ''}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <select value={folderId} onChange={(e) => setFolderId(e.target.value)} aria-label="Carpeta" className={field}>
          <option value="">Sin carpeta</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          <option value={NEW_FOLDER}>+ Nueva carpeta…</option>
        </select>
        {folderId === NEW_FOLDER && (
          <input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="Nombre de la carpeta" aria-label="Nombre de la carpeta" className={field} />
        )}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex items-center gap-2">
          {list && (
            <button type="button" onClick={remove} disabled={pending} className="rounded-md px-3 py-2 text-sm text-danger hover:bg-hover">
              Borrar lista
            </button>
          )}
          <button type="submit" disabled={pending} className="ml-auto rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-60">
            Guardar
          </button>
        </div>
      </form>
      {/* Fuera del <form>: ListMembers tiene su propio formulario (no se pueden anidar). */}
      {list && <ListMembers listId={list.id} isOwner />}
    </Modal>
  );
}
