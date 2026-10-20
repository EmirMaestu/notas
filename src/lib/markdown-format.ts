/**
 * Atajos de formato del editor de descripción (Cmd/Ctrl+B, Cmd/Ctrl+I…), como funciones puras sobre el texto:
 * reciben el documento y la selección y devuelven el cambio a aplicar, así se prueban sin un editor.
 */
export interface MarkEdit {
  /** Reemplazo de un tramo del documento original. */
  changes: { from: number; to: number; insert: string }[];
  /** Selección resultante (posiciones en el documento ya modificado). */
  anchor: number;
  head: number;
}

/**
 * Pone o saca una marca simétrica (`**`, `*`, `~~`, `` ` ``) alrededor de la selección.
 * - Sin selección: inserta la marca doble y deja el cursor en el medio.
 * - Si la selección ya está envuelta por la marca (por dentro o por fuera), la saca.
 * - Si no, la envuelve y mantiene seleccionado el texto.
 */
export function toggleMark(doc: string, from: number, to: number, mark: string): MarkEdit {
  const n = mark.length;
  if (from === to) {
    return { changes: [{ from, to, insert: mark + mark }], anchor: from + n, head: from + n };
  }
  const selected = doc.slice(from, to);
  // La selección incluye las marcas: «**hola**» seleccionado entero.
  if (selected.length >= 2 * n && wrapped(runAt(selected, 0, mark[0], 1), runAt(selected, selected.length - 1, mark[0], -1), mark)) {
    const inner = selected.slice(n, selected.length - n);
    return { changes: [{ from, to, insert: inner }], anchor: from, head: from + inner.length };
  }
  // Las marcas quedan justo afuera de la selección: «**[hola]**».
  if (wrapped(runAt(doc, from - 1, mark[0], -1), runAt(doc, to, mark[0], 1), mark)) {
    return {
      changes: [{ from: from - n, to: from, insert: '' }, { from: to, to: to + n, insert: '' }],
      anchor: from - n, head: to - n,
    };
  }
  return {
    changes: [{ from, to: from, insert: mark }, { from: to, to, insert: mark }],
    anchor: from + n, head: to + n,
  };
}

/** Cuántos `ch` seguidos hay desde `pos` avanzando en `dir` (1 o -1). */
function runAt(text: string, pos: number, ch: string, dir: 1 | -1): number {
  let n = 0;
  for (let i = pos; i >= 0 && i < text.length && text[i] === ch; i += dir) n++;
  return n;
}

/**
 * ¿Las corridas de símbolos a cada lado incluyen esta marca? `*` (cursiva) no se confunde con `**`: «**hola**»
 * no está en cursiva, «***hola***» sí (y en negrita).
 */
function wrapped(before: number, after: number, mark: string): boolean {
  if (mark.length === 1) return before % 2 === 1 && after % 2 === 1;
  return before >= mark.length && after >= mark.length;
}

/** Convierte la selección en un enlace `[texto](url)` y deja seleccionada la parte «url» para escribirla. */
export function makeLink(doc: string, from: number, to: number): MarkEdit {
  const text = doc.slice(from, to);
  const insert = `[${text}](url)`;
  if (!text) return { changes: [{ from, to, insert: '[]()' }], anchor: from + 1, head: from + 1 };
  const urlStart = from + text.length + 3;
  return { changes: [{ from, to, insert }], anchor: urlStart, head: urlStart + 3 };
}

/** Marca o desmarca una casilla de tarea (`[ ]` ↔ `[x]`) dado el texto del marcador. */
export function toggledTaskMarker(marker: string): string {
  return /^\[\s\]$/.test(marker) ? '[x]' : '[ ]';
}
