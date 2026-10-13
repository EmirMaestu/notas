// Agrupación de listas por carpeta para selectores y nombres sin ambigüedad (módulo puro: se usa también en el cliente).

export interface GroupableList {
  id: string;
  name: string;
  isInbox: boolean;
  folderId: string | null;
  role: 'owner' | 'member';
}

export interface GroupableFolder {
  id: string;
  name: string;
}

export interface ListGroup<L extends GroupableList = GroupableList> {
  /** null = grupo sin título (Bandeja y listas sin carpeta). */
  label: string | null;
  lists: L[];
}

export const SHARED_GROUP_LABEL = 'Compartidas conmigo';

/**
 * Grupos para un select: Bandeja y listas sueltas, una por carpeta (en el orden dado) y las compartidas conmigo.
 * Dentro de cada grupo se respeta el orden de entrada; los grupos vacíos se omiten.
 */
export function groupListsByFolder<L extends GroupableList>(lists: readonly L[], folders: readonly GroupableFolder[]): ListGroup<L>[] {
  const known = new Set(folders.map((f) => f.id));
  const owned = lists.filter((l) => l.role === 'owner');
  const loose = [
    ...owned.filter((l) => l.isInbox),
    ...owned.filter((l) => !l.isInbox && (l.folderId === null || !known.has(l.folderId))),
  ];
  const groups: ListGroup<L>[] = [{ label: null, lists: loose }];
  for (const f of folders) {
    groups.push({ label: f.name, lists: owned.filter((l) => !l.isInbox && l.folderId === f.id) });
  }
  groups.push({ label: SHARED_GROUP_LABEL, lists: lists.filter((l) => l.role === 'member') });
  return groups.filter((g) => g.lists.length > 0);
}

/** "Carpeta › Lista" si la lista está en una carpeta conocida; si no, solo el nombre. */
export function listDisplayName(
  list: { name: string; folderId: string | null },
  foldersById: ReadonlyMap<string, GroupableFolder>,
): string {
  const folder = list.folderId ? foldersById.get(list.folderId) : undefined;
  return folder ? `${folder.name} › ${list.name}` : list.name;
}
