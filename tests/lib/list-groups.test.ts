import { describe, expect, it } from 'vitest';
import { groupListsByFolder, listDisplayName } from '@/lib/list-groups';

type L = Parameters<typeof groupListsByFolder>[0][number];
type F = Parameters<typeof groupListsByFolder>[1][number];

const list = (id: string, name: string, extra: Partial<L> = {}): L => ({
  id, name, isInbox: false, folderId: null, role: 'owner', ...extra,
});
const folder = (id: string, name: string): F => ({ id, name });

describe('groupListsByFolder', () => {
  const folders = [folder('f1', 'Rider G'), folder('f2', 'Sitrack')];

  it('Bandeja y sueltas primero (sin etiqueta), luego una por carpeta y al final las compartidas', () => {
    const lists = [
      list('inbox', 'Bandeja', { isInbox: true }),
      list('a', 'Tareas', { folderId: 'f1' }),
      list('b', 'Tareas', { folderId: 'f2' }),
      list('c', 'Casa'),
      list('d', 'Compartida', { role: 'member' }),
    ];
    expect(groupListsByFolder(lists, folders)).toEqual([
      { label: null, lists: [lists[0], lists[3]] },
      { label: 'Rider G', lists: [lists[1]] },
      { label: 'Sitrack', lists: [lists[2]] },
      { label: 'Compartidas conmigo', lists: [lists[4]] },
    ]);
  });

  it('la Bandeja va antes que las sueltas aunque venga después', () => {
    const lists = [list('c', 'Casa'), list('inbox', 'Bandeja', { isInbox: true })];
    expect(groupListsByFolder(lists, []).map((g) => g.lists.map((l) => l.id))).toEqual([['inbox', 'c']]);
  });

  it('omite grupos vacíos y respeta el orden de carpetas y de listas', () => {
    const lists = [list('x', 'Z', { folderId: 'f2' }), list('y', 'A', { folderId: 'f2' })];
    const groups = groupListsByFolder(lists, folders);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Sitrack');
    expect(groups[0].lists.map((l) => l.id)).toEqual(['x', 'y']);
  });

  it('una lista con carpeta desconocida queda entre las sueltas', () => {
    const lists = [list('a', 'Huérfana', { folderId: 'nope' })];
    expect(groupListsByFolder(lists, folders)).toEqual([{ label: null, lists }]);
  });

  it('sin listas no hay grupos', () => {
    expect(groupListsByFolder([], folders)).toEqual([]);
  });
});

describe('listDisplayName', () => {
  const byId = new Map([['f1', { id: 'f1', name: 'Rider G' }]]);

  it('"Carpeta › Lista" si está en una carpeta', () => {
    expect(listDisplayName({ name: 'Tareas', folderId: 'f1' }, byId)).toBe('Rider G › Tareas');
  });

  it('solo el nombre si no tiene carpeta o la carpeta no se conoce', () => {
    expect(listDisplayName({ name: 'Casa', folderId: null }, byId)).toBe('Casa');
    expect(listDisplayName({ name: 'Casa', folderId: 'otra' }, byId)).toBe('Casa');
  });
});
