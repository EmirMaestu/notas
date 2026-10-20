/**
 * Editor de Markdown con «vista en vivo» (al estilo Obsidian/Typora) sobre CodeMirror 6.
 *
 * El documento es siempre el Markdown tal cual: no hay conversión de ida y vuelta, así que lo que se guarda es
 * exactamente lo que se escribió (las descripciones viejas en texto plano siguen intactas). El formato se ve
 * aplicado mientras se escribe —títulos, negritas, listas, enlaces— y los símbolos de Markdown (`**`, `#`, `[]()`…)
 * se ocultan en todas las líneas salvo en la que está el cursor, donde se muestran para poder editarlos.
 *
 * Se carga con `import()` desde el componente, para que CodeMirror no pese en el paquete inicial de la app.
 */
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, Transaction, type Range } from '@codemirror/state';
import {
  Decoration, EditorView, ViewPlugin, WidgetType, keymap, placeholder as placeholderExt,
  type Command, type DecorationSet, type ViewUpdate,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { makeLink, toggleMark, toggledTaskMarker, type MarkEdit } from './markdown-format';

export interface LiveEditorOptions {
  parent: HTMLElement;
  doc: string;
  label: string;
  placeholder: string;
  /** `focused`: si el cambio se hizo con el foco en el editor (si no, p. ej. al tildar una casilla, conviene guardar ya). */
  onChange: (value: string, focused: boolean) => void;
}

// ---------- Widgets ----------

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-md-bullet';
    el.textContent = '•';
    return el;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) { super(); }
  eq(other: CheckboxWidget) { return other.checked === this.checked && other.pos === this.pos; }
  toDOM(view: EditorView) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-md-checkbox';
    box.checked = this.checked;
    box.tabIndex = -1;
    box.setAttribute('aria-label', this.checked ? 'Desmarcar ítem' : 'Marcar ítem');
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => {
      e.preventDefault();
      const marker = view.state.sliceDoc(this.pos, this.pos + 3);
      view.dispatch({ changes: { from: this.pos, to: this.pos + 3, insert: toggledTaskMarker(marker) } });
    });
    return box;
  }
  ignoreEvent() { return true; }
}

class RuleWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-md-hr';
    return el;
  }
}

const hidden = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const rule = Decoration.replace({ widget: new RuleWidget() });

// ---------- Decoraciones de la vista en vivo ----------

/** Números de línea donde hay un cursor o selección: ahí se muestra el Markdown crudo. */
function activeLines(view: EditorView): Set<number> {
  const lines = new Set<number>();
  if (!view.hasFocus) return lines;
  for (const r of view.state.selection.ranges) {
    const first = view.state.doc.lineAt(r.from).number;
    const last = view.state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const active = activeLines(view);
  const ranges: Range<Decoration>[] = [];
  const isActive = (from: number, to = from) => {
    const a = doc.lineAt(from).number;
    const b = doc.lineAt(to).number;
    for (let n = a; n <= b; n++) if (active.has(n)) return true;
    return false;
  };
  const lineClass = (from: number, to: number, cls: string) => {
    for (let pos = from; pos <= to;) {
      const line = doc.lineAt(pos);
      ranges.push(Decoration.line({ class: cls }).range(line.from));
      pos = line.to + 1;
    }
  };
  const hide = (from: number, to: number) => {
    if (to > from && !doc.sliceString(from, to).includes('\n')) ranges.push(hidden.range(from, to));
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from, to,
      enter: (node) => {
        const name = node.name;
        const heading = /^ATXHeading(\d)$/.exec(name) ?? /^SetextHeading(\d)$/.exec(name);
        if (heading) {
          lineClass(node.from, node.from, `cm-md-h cm-md-h${heading[1]}`);
          return;
        }
        switch (name) {
          case 'HeaderMark': {
            if (node.node.parent?.name.startsWith('SetextHeading')) return;
            if (isActive(node.from)) return;
            const next = doc.sliceString(node.to, node.to + 1);
            hide(node.from, next === ' ' ? node.to + 1 : node.to);
            return;
          }
          case 'EmphasisMark':
          case 'StrikethroughMark':
            if (!isActive(node.from)) hide(node.from, node.to);
            return;
          case 'InlineCode':
            ranges.push(Decoration.mark({ class: 'cm-md-code' }).range(node.from, node.to));
            return;
          case 'CodeMark':
            if (node.node.parent?.name === 'InlineCode' && !isActive(node.from)) hide(node.from, node.to);
            return;
          case 'FencedCode':
          case 'CodeBlock':
            lineClass(node.from, node.to, 'cm-md-codeblock');
            return false;
          case 'Blockquote':
            lineClass(node.from, node.to, 'cm-md-quote');
            return;
          case 'QuoteMark':
            if (!isActive(node.from)) {
              const next = doc.sliceString(node.to, node.to + 1);
              hide(node.from, next === ' ' ? node.to + 1 : node.to);
            }
            return;
          case 'HorizontalRule':
            if (!isActive(node.from)) ranges.push(rule.range(node.from, node.to));
            return;
          case 'Link': {
            const url = node.node.getChild('URL');
            const href = url ? doc.sliceString(url.from, url.to) : '';
            const marks = node.node.getChildren('LinkMark');
            // [texto](url): marcas = «[», «]», «(», «)».
            if (marks.length >= 2) {
              const textFrom = marks[0].to;
              const textTo = marks[1].from;
              if (textTo > textFrom) {
                ranges.push(Decoration.mark({ class: 'cm-md-link', attributes: { 'data-href': href, title: linkTitle() } }).range(textFrom, textTo));
              }
              if (!isActive(node.from, node.to)) {
                hide(marks[0].from, marks[0].to);
                hide(marks[1].from, node.to);
              }
            }
            return false;
          }
          case 'URL': {
            // Enlaces sueltos (https://…, <https://…>) fuera de un [texto](url).
            if (node.node.parent?.name === 'Link' || node.node.parent?.name === 'Image') return;
            const href = doc.sliceString(node.from, node.to);
            ranges.push(Decoration.mark({ class: 'cm-md-link', attributes: { 'data-href': href, title: linkTitle() } }).range(node.from, node.to));
            return;
          }
          case 'ListMark': {
            const item = node.node.parent;
            const isBullet = item?.parent?.name === 'BulletList';
            // «- [ ] algo»: el nodo Task no siempre cuelga directo del ítem, así que se mira el texto.
            const task = /^ \[[ xX]\](\s|$)/.test(doc.sliceString(node.to, node.to + 5));
            if (isActive(node.from)) {
              if (!isBullet) ranges.push(Decoration.mark({ class: 'cm-md-ordered' }).range(node.from, node.to));
              return;
            }
            const next = doc.sliceString(node.to, node.to + 1);
            if (task && isBullet) {
              // «- [ ] algo»: solo se ve la casilla.
              hide(node.from, next === ' ' ? node.to + 1 : node.to);
            } else if (isBullet) {
              ranges.push(bullet.range(node.from, node.to));
            } else {
              ranges.push(Decoration.mark({ class: 'cm-md-ordered' }).range(node.from, node.to));
            }
            return;
          }
          case 'TaskMarker': {
            const marker = doc.sliceString(node.from, node.to);
            const checked = /x/i.test(marker);
            const task = node.node.parent;
            if (checked && task && task.to > node.to + 1) {
              ranges.push(Decoration.mark({ class: 'cm-md-task-done' }).range(node.to + 1, task.to));
            }
            if (!isActive(node.from)) {
              ranges.push(Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }).range(node.from, node.to));
            }
            return;
          }
        }
      },
    });
  }
  return Decoration.set(ranges, true);
}

function linkTitle(): string {
  const mac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform);
  return `${mac ? '⌘' : 'Ctrl'}+clic para abrir`;
}

const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildDecorations(view); }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      // Cmd/Ctrl+clic abre el enlace en otra pestaña (un clic normal edita, como en el resto del texto).
      mousedown(e) {
        if (!(e.metaKey || e.ctrlKey)) return false;
        const link = (e.target as HTMLElement).closest<HTMLElement>('.cm-md-link');
        const href = link?.dataset.href;
        if (!href) return false;
        const url = /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : `https://${href}`;
        if (!/^(https?|mailto):/i.test(url)) return false;
        e.preventDefault();
        window.open(url, '_blank', 'noopener,noreferrer');
        return true;
      },
    },
  },
);

// ---------- Atajos de formato ----------

function applyEdit(view: EditorView, edit: (doc: string, from: number, to: number) => MarkEdit): boolean {
  const doc = view.state.doc.toString();
  const r = view.state.selection.main;
  const e = edit(doc, r.from, r.to);
  view.dispatch({ changes: e.changes, selection: EditorSelection.single(e.anchor, e.head), scrollIntoView: true, userEvent: 'input' });
  return true;
}
const LIST_LINE = /^\s*([-*+]|\d+[.)])\s/;
function inListItem(view: EditorView): boolean {
  return view.state.selection.ranges.every((r) => LIST_LINE.test(view.state.doc.lineAt(r.from).text));
}
const markCommand = (mark: string): Command => (view) => applyEdit(view, (d, f, to) => toggleMark(d, f, to, mark));

const formatKeymap = keymap.of([
  { key: 'Mod-b', run: markCommand('**') },
  { key: 'Mod-i', run: markCommand('*') },
  { key: 'Mod-Shift-x', run: markCommand('~~') },
  { key: 'Mod-e', run: markCommand('`') },
  { key: 'Mod-k', run: (view) => applyEdit(view, makeLink) },
  // Tab anida/desanida ítems de lista. Fuera de una lista no hace nada especial: el foco sigue de largo
  // (si no, el teclado quedaría atrapado en el editor).
  { key: 'Tab', run: (v) => inListItem(v) && indentMore(v), shift: (v) => inListItem(v) && indentLess(v) },
]);

// ---------- Estilos ----------

const highlight = HighlightStyle.define([
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.heading, fontWeight: '700' },
  { tag: [t.processingInstruction, t.contentSeparator], color: 'var(--muted)' },
  { tag: t.quote, color: 'var(--muted)' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.92em' },
]);

const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--fg)', fontSize: 'inherit' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit', overflow: 'visible' },
  '.cm-content': { padding: '0', minHeight: 'var(--md-min-h, 3.2em)', caretColor: 'var(--fg)' },
  '.cm-line': { padding: '0' },
  '.cm-placeholder': { color: 'var(--muted)' },
  '.cm-cursor': { borderLeftColor: 'var(--fg)' },
  '.cm-md-h': { fontWeight: '700', letterSpacing: '-0.015em', lineHeight: '1.3' },
  '.cm-md-h1': { fontSize: '1.55em', fontWeight: '800', paddingTop: '.35em !important' },
  '.cm-md-h2': { fontSize: '1.3em', paddingTop: '.3em !important' },
  '.cm-md-h3': { fontSize: '1.13em', paddingTop: '.2em !important' },
  '.cm-md-code': { backgroundColor: 'var(--hover)', borderRadius: '5px', padding: '1px 4px' },
  '.cm-md-codeblock': { fontFamily: 'var(--font-mono)', fontSize: '0.9em', backgroundColor: 'var(--hover)', padding: '0 10px !important' },
  '.cm-md-quote': { borderLeft: '3px solid var(--border)', paddingLeft: '12px !important', color: 'var(--muted)' },
  '.cm-md-link': { color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: '2px', cursor: 'text' },
  '.cm-md-bullet': { color: 'var(--muted)', display: 'inline-block', width: '0.6em', fontWeight: '700' },
  '.cm-md-ordered': { color: 'var(--muted)' },
  '.cm-md-checkbox': {
    accentColor: 'var(--accent)', width: '14px', height: '14px', margin: '0 6px 0 0', verticalAlign: '-2px', cursor: 'pointer',
  },
  '.cm-md-task-done': { color: 'var(--muted)', textDecoration: 'line-through' },
  '.cm-md-hr': { display: 'inline-block', width: '100%', borderTop: '1px solid var(--border)', verticalAlign: 'middle' },
});

export function createLiveEditor({ parent, doc, label, placeholder, onChange }: LiveEditorOptions): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        formatKeymap,
        keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap]),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(highlight),
        livePreview,
        EditorView.lineWrapping,
        placeholderExt(placeholder),
        theme,
        EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true', spellcheck: 'true' }),
        EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString(), u.view.hasFocus); }),
      ],
    }),
  });
}

/** Reemplaza el documento entero (cambio remoto) sin pasar por el historial de deshacer. */
export function replaceDoc(view: EditorView, value: string) {
  if (view.state.doc.toString() === value) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, annotations: Transaction.addToHistory.of(false) });
}
