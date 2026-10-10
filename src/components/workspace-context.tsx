'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { TaskWithDetails } from '@/core/tasks';
import { deleteTaskAction, restoreTaskAction } from '@/app/app/actions';
import { useToast } from './toast';

/** Mensaje cuando una acción ni siquiera llega al servidor (red caída, etc.). */
export const SAVE_ERROR = 'No se pudo guardar. Probá de nuevo.';

export interface WorkspaceActions {
  /** Filas que están saliendo de la vista (completadas, a la papelera o restauradas). */
  hidden: ReadonlySet<string>;
  hide: (taskId: string) => void;
  unhide: (taskId: string) => void;
  /** Manda a la papelera sin confirmar: la fila sale y un toast ofrece «Deshacer» durante 6 s. */
  trash: (task: TaskWithDetails) => void;
  /** Abre el detalle; con `editTitle` el detalle enfoca el título al montarse (atajo E). */
  openTask: (taskId: string, opts?: { editTitle?: boolean }) => void;
  /** Cierra el detalle y devuelve el foco a la fila. */
  closeDetail: () => void;
  /** true una sola vez después de `openTask(…, { editTitle: true })`. */
  consumeEditTitle: () => boolean;
}

const WorkspaceContext = createContext<WorkspaceActions | null>(null);

export function useWorkspace(): WorkspaceActions {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace solo funciona dentro de WorkspaceProvider');
  return value;
}

/** ¿El evento viene de un lugar donde se escribe? (ahí no se disparan los atajos de una letra). */
export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'));
}

export function WorkspaceProvider({
  tasks, selectedId, children,
}: { tasks: TaskWithDetails[]; selectedId?: string; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const editTitle = useRef(false);
  const returnFocusTo = useRef<string | null>(null);

  const hide = useCallback((id: string) => setHidden((prev) => new Set(prev).add(id)), []);
  const unhide = useCallback((id: string) => setHidden((prev) => {
    if (!prev.has(id)) return prev;
    const next = new Set(prev);
    next.delete(id);
    return next;
  }), []);

  // Las que el servidor ya sacó dejan de estar "saliendo": si vuelven (deshacer), entran con fundido.
  useEffect(() => {
    setHidden((prev) => {
      const ids = new Set(tasks.map((t) => t.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [tasks]);

  const closeDetail = useCallback(() => {
    returnFocusTo.current = selectedId ?? null;
    router.push(pathname, { scroll: false });
  }, [router, pathname, selectedId]);

  const openTask = useCallback((id: string, opts?: { editTitle?: boolean }) => {
    editTitle.current = opts?.editTitle ?? false;
    router.push(`${pathname}?t=${id}`, { scroll: false });
  }, [router, pathname]);

  const consumeEditTitle = useCallback(() => {
    const value = editTitle.current;
    editTitle.current = false;
    return value;
  }, []);

  // Al cerrar el detalle (X, ← o Esc), el foco vuelve a la fila de la tarea.
  useEffect(() => {
    if (selectedId || !returnFocusTo.current) return;
    const id = returnFocusTo.current;
    returnFocusTo.current = null;
    const row = id ? document.querySelector<HTMLElement>(`[data-task-link="${id}"]`) : null;
    if (row) row.focus();
    else [...document.querySelectorAll<HTMLElement>('h1[tabindex="-1"]')].find((h) => h.offsetParent !== null)?.focus();
  }, [selectedId]);

  const undo = useCallback(async (id: string) => {
    try {
      const result = await restoreTaskAction(id);
      if (result.ok) unhide(id);
      else toast({ tone: 'error', message: result.error });
    } catch {
      toast({ tone: 'error', message: SAVE_ERROR });
    }
  }, [unhide, toast]);

  const trashRef = useRef<(task: TaskWithDetails) => void>(() => {});
  const trash = useCallback((task: TaskWithDetails) => {
    hide(task.id);
    if (selectedId === task.id) {
      // El detalle desaparece con la tarea: el foco pasa a la fila siguiente (o la anterior) y, si no queda ninguna, al título de la vista.
      const links = [...document.querySelectorAll<HTMLElement>('[data-task-link]')].filter((l) => !l.closest('[inert]'));
      const at = links.findIndex((l) => l.dataset.taskLink === task.id);
      const neighbour = at === -1 ? undefined : links[at + 1] ?? links[at - 1];
      returnFocusTo.current = neighbour?.dataset.taskLink ?? '';
      router.push(pathname, { scroll: false });
    }
    void (async () => {
      let error: string | null = null;
      try {
        const result = await deleteTaskAction(task.id);
        if (!result.ok) error = result.error;
      } catch {
        error = SAVE_ERROR;
      }
      if (error) {
        unhide(task.id);
        toast({ tone: 'error', message: error, action: { label: 'Reintentar', onClick: () => trashRef.current(task) } });
        return;
      }
      toast({ tone: 'trash', message: 'Tarea enviada a la papelera', action: { label: 'Deshacer', onClick: () => void undo(task.id) } });
    })();
  }, [hide, unhide, undo, toast, router, pathname, selectedId]);
  useEffect(() => { trashRef.current = trash; }, [trash]);

  const value = useMemo<WorkspaceActions>(
    () => ({ hidden, hide, unhide, trash, openTask, closeDetail, consumeEditTitle }),
    [hidden, hide, unhide, trash, openTask, closeDetail, consumeEditTitle],
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
