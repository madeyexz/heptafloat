// Heptabase-style editor menus: "/" commands, "@" / "[[" card mentions, a selection toolbar,
// and empty-line placeholders.

import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { toggleMark } from 'prosemirror-commands';
import { insertBlock, turnInto } from './commands.js';
import { formatDate, titles } from './schema.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// MARK: "/" and mention suggestions

export const suggestKey = new PluginKey('suggest');

/** Where the page starts below the native title bar (0 in the notch). Popups stay below it:
 *  presses in the bar move the window instead of reaching the page. */
export const barBottom = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--titlebar')) || 0;

const COMMANDS = [
  { label: 'Text', icon: 'T', keys: 'text paragraph plain', run: (v) => turnInto(v, 'paragraph') },
  { label: 'Heading 1', icon: 'H1', keys: 'h1 heading title', run: (v) => turnInto(v, 'heading', { level: 1 }) },
  { label: 'Heading 2', icon: 'H2', keys: 'h2 heading subtitle', run: (v) => turnInto(v, 'heading', { level: 2 }) },
  { label: 'Heading 3', icon: 'H3', keys: 'h3 heading', run: (v) => turnInto(v, 'heading', { level: 3 }) },
  { label: 'To-do list', icon: '☐', keys: 'todo task checkbox check []', run: (v) => turnInto(v, 'todo_list_item') },
  { label: 'Bulleted list', icon: '•', keys: 'bullet list ul unordered -', run: (v) => turnInto(v, 'bullet_list_item') },
  { label: 'Numbered list', icon: '1.', keys: 'numbered ordered list ol', run: (v) => turnInto(v, 'numbered_list_item') },
  { label: 'Toggle list', icon: '▸', keys: 'toggle fold collapse', run: (v) => turnInto(v, 'toggle_list_item') },
  { label: 'Quote', icon: '❝', keys: 'quote blockquote', run: (v) => turnInto(v, 'blockquote') },
  { label: 'Code block', icon: '</>', keys: 'code pre snippet', run: (v) => turnInto(v, 'code_block', { params: '' }) },
  { label: 'Divider', icon: '—', keys: 'divider hr line separator', run: (v) => insertBlock(v, 'horizontal_rule') },
  { label: 'Today', icon: '📅', keys: 'date today now', run: (v) => insertInline(v, v.state.schema.nodes.date.create({ date: todayISO() })) },
  { label: 'Mention a card', icon: '@', keys: 'mention card link page', run: (v) => startMention(v) },
];

function insertInline(view, node) {
  view.dispatch(view.state.tr.replaceSelectionWith(node, false).insertText(' ').scrollIntoView());
}

function startMention(view) {
  const { from } = view.state.selection;
  view.dispatch(view.state.tr.insertText('@').setMeta(suggestKey, { kind: 'mention', from, trigger: '@' }));
}

function mentionNode(schema, r) {
  const n = schema.nodes;
  titles[r.id] = r.title;
  switch (r.objectType) {
    case 'journal': return n.date.create({ date: r.id });
    case 'pdf': case 'pdfCard': return n.pdf_card.create({ pdfCardId: r.id });
    case 'highlightElement': return n.highlight_element.create({ highlightElementId: r.id });
    case 'image': return n.image_card.create({ cardId: r.id });
    case 'video': return n.video_card.create({ cardId: r.id });
    case 'audio': return n.audio_card.create({ cardId: r.id });
    default: return n.card.create({ cardId: r.id });
  }
}

const TYPE_ICON = { journal: '📅', pdf: '📄', highlightElement: '✎', image: '🖼', video: '▶', audio: '♪', web: '🌐' };

/** `search(query)` resolves to [{ id, objectType, title }]. */
export function suggestPlugin(search) {
  return new Plugin({
    key: suggestKey,
    state: {
      init: () => null,
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(suggestKey);
        if (meta !== undefined) return meta;
        if (!prev) return null;
        const from = tr.mapping.map(prev.from);
        const { empty, $head, head } = state.selection;
        if (!empty || head < from + prev.trigger.length || state.doc.resolve(from).parent !== $head.parent) return null;
        const text = state.doc.textBetween(from, head, '\n', '￼');
        if (!text.startsWith(prev.trigger)) return null;
        const query = text.slice(prev.trigger.length);
        if (query.length > 40 || /[\n￼]/.test(query) || (prev.kind === 'command' ? /\s/.test(query) : /\s\s/.test(query))) return null;
        return { ...prev, from, query };
      },
    },
    props: {
      handleTextInput(view, from, to, text) {
        const $from = view.state.doc.resolve(from);
        if ($from.parent.type.spec.code) return false;
        const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset, '\n', '￼');
        const atWordStart = before === '' || /\s/.test(before);
        let meta = null;
        if (text === '/' && atWordStart) meta = { kind: 'command', from, trigger: '/' };
        else if (text === '@' && atWordStart) meta = { kind: 'mention', from, trigger: '@' };
        else if (text === '[' && before === '[') meta = { kind: 'mention', from: from - 1, trigger: '[[' };
        if (!meta) return false;
        view.dispatch(view.state.tr.insertText(text, from, to).setMeta(suggestKey, { ...meta, query: '' }));
        return true;
      },
      handleKeyDown(view, event) {
        return menu.active ? menu.key(view, event) : false;
      },
    },
    view: (view) => {
      menu.search = search;
      return { update: (v) => menu.update(v), destroy: () => menu.hide() };
    },
  });
}

const menu = {
  el: null, items: [], index: 0, active: null, seq: 0, timer: null, search: null, lastKey: null,

  ensure() {
    if (this.el) return this.el;
    this.el = document.createElement('div');
    this.el.className = 'popup suggest';
    this.el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const row = e.target.closest('[data-i]');
      if (row) this.choose(this.view, Number(row.dataset.i));
    });
    document.body.append(this.el);
    return this.el;
  },

  update(view) {
    this.view = view;
    const s = suggestKey.getState(view.state);
    this.active = s;
    if (!s) return this.hide();
    const key = `${s.kind}:${s.from}:${s.query}`;
    if (key === this.lastKey) return this.place(view, s);
    this.lastKey = key;
    if (s.kind === 'command') {
      const q = s.query.toLowerCase();
      this.setItems(COMMANDS.filter((c) => !q || c.label.toLowerCase().includes(q) || c.keys.includes(q)));
    } else {
      this.setItems(null, 'Searching…');
      clearTimeout(this.timer);
      const seq = ++this.seq;
      this.timer = setTimeout(async () => {
        const results = await this.search(s.query);
        if (seq !== this.seq || !this.active) return;
        this.setItems(results.map((r) => ({
          label: r.objectType === 'journal' ? formatDate(r.id) : r.title || 'Untitled',
          icon: TYPE_ICON[r.objectType] || '▤',
          run: (v) => insertInline(v, mentionNode(v.state.schema, r)),
        })), s.query ? 'No cards found' : 'No recent cards');
      }, s.query ? 140 : 0);
    }
    this.place(view, s);
  },

  setItems(items, emptyText = 'No results') {
    this.items = items || [];
    this.index = 0;
    const el = this.ensure();
    el.innerHTML = this.items.length
      ? this.items.map((it, i) => `<div class="row${i === 0 ? ' sel' : ''}" data-i="${i}"><span class="ic">${esc(it.icon)}</span><span class="lb">${esc(it.label)}</span></div>`).join('')
      : `<div class="empty">${esc(emptyText)}</div>`;
    el.style.display = 'block';
    // Results change the menu's height, so re-fit it above or below the caret.
    if (this.active && this.view) this.place(this.view, this.active);
  },

  place(view, s) {
    const el = this.ensure();
    const c = view.coordsAtPos(s.from);
    const h = el.offsetHeight, w = el.offsetWidth;
    const top = barBottom() + 8;
    const below = c.bottom + 6 + h < window.innerHeight - 8 || c.top - 6 - h < top;
    el.style.top = `${below ? c.bottom + 6 : Math.max(top, c.top - 6 - h)}px`;
    el.style.left = `${Math.max(8, Math.min(c.left - 4, window.innerWidth - w - 8))}px`;
  },

  highlight(i) {
    if (!this.items.length) return;
    this.index = (i + this.items.length) % this.items.length;
    this.el.querySelectorAll('.row').forEach((r, j) => r.classList.toggle('sel', j === this.index));
    this.el.querySelector('.row.sel')?.scrollIntoView({ block: 'nearest' });
  },

  key(view, e) {
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { this.highlight(this.index + 1); return true; }
    if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { this.highlight(this.index - 1); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (!this.items.length) return false;
      this.choose(view, this.index);
      return true;
    }
    if (e.key === 'Escape') { view.dispatch(view.state.tr.setMeta(suggestKey, null)); return true; }
    return false;
  },

  choose(view, i) {
    const s = suggestKey.getState(view.state), item = this.items[i];
    if (!s || !item) return;
    const tr = view.state.tr.delete(s.from, view.state.selection.head).setMeta(suggestKey, null);
    view.dispatch(tr);
    item.run(view);
    view.focus();
  },

  hide() {
    this.active = null;
    this.lastKey = null;
    if (this.el) this.el.style.display = 'none';
  },
};

// MARK: selection toolbar

const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

/** Sets the text color or highlight (type "text" / "background") on the selection; null clears it. */
export function setColor(state, dispatch, type, color) {
  const markType = state.schema.marks.color;
  const { from, to, empty } = state.selection;
  if (!markType || empty) return false;
  if (dispatch) {
    const tr = state.tr;
    state.doc.nodesBetween(from, to, (node, pos) => {
      for (const m of node.marks) {
        if (m.type === markType && (m.attrs.type || 'text') === type) tr.removeMark(Math.max(from, pos), Math.min(to, pos + node.nodeSize), m);
      }
    });
    if (color) tr.addMark(from, to, markType.create({ type, color }));
    dispatch(tr);
  }
  return true;
}

/** ⌘⇧H: yellow highlight on, or off if the selection is already highlighted. */
export function toggleHighlight(state, dispatch) {
  const markType = state.schema.marks.color;
  const { from, to, empty } = state.selection;
  if (!markType || empty) return false;
  let highlighted = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.marks.some((m) => m.type === markType && m.attrs.type === 'background')) highlighted = true;
  });
  return setColor(state, dispatch, 'background', highlighted ? null : 'yellow');
}

export function toolbarPlugin(onOpenLink) {
  let el = null, mode = null, render = () => {}; // mode: null | 'link' | 'color'
  const buttons = [
    ['strong', '<b>B</b>', 'Bold ⌘B'], ['em', '<i>I</i>', 'Italic ⌘I'], ['underline', '<u>U</u>', 'Underline ⌘U'],
    ['strike', '<s>S</s>', 'Strikethrough ⌘⇧X'], ['code', '&lt;/&gt;', 'Code ⌘E'], ['link', '🔗', 'Link ⌘K'],
  ];
  const isActive = (state, type) => {
    const { from, to, empty, $from } = state.selection;
    return empty ? !!type.isInSet(state.storedMarks || $from.marks()) : state.doc.rangeHasMark(from, to, type);
  };
  const swatches = (type) => [`<button class="sw none" data-color-type="${type}" data-color="" title="Default">${type === 'text' ? 'A' : '∅'}</button>`]
    .concat(COLORS.map((c) => `<button class="sw ${type === 'text' ? `c-text-${c}` : `c-background-${c}`}" data-color-type="${type}" data-color="${c}" title="${c[0].toUpperCase()}${c.slice(1)}">${type === 'text' ? 'A' : ''}</button>`))
    .join('');
  return new Plugin({
    view(view) {
      el = document.createElement('div');
      el.className = 'popup toolbar';
      el.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'INPUT') return;
        e.preventDefault();
        const sw = e.target.closest('[data-color-type]');
        if (sw) {
          mode = null;
          setColor(view.state, view.dispatch, sw.dataset.colorType, sw.dataset.color || null);
          render(view);
          return;
        }
        if (e.target.closest('[data-action="color"]')) { mode = 'color'; render(view); return; }
        const b = e.target.closest('[data-mark]');
        if (!b) return;
        const type = view.state.schema.marks[b.dataset.mark];
        if (b.dataset.mark === 'link') {
          if (isActive(view.state, type)) view.dispatch(view.state.tr.removeMark(view.state.selection.from, view.state.selection.to, type));
          else { mode = 'link'; render(view); }
          return;
        }
        toggleMark(type)(view.state, view.dispatch);
      });
      document.body.append(el);

      render = (v) => {
        const { state } = v;
        const sel = state.selection;
        const show = v.hasFocus() || mode;
        if (sel.empty || !(sel instanceof TextSelection) || !show || suggestKey.getState(state)) {
          el.style.display = 'none';
          mode = null;
          return;
        }
        el.classList.toggle('palette', mode === 'color');
        if (mode === 'link') {
          el.innerHTML = '<input class="link-input" placeholder="Paste a link and press Enter">';
          const input = el.querySelector('input');
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && input.value.trim()) {
              const href = /^[a-z][a-z0-9+.-]*:/i.test(input.value.trim()) ? input.value.trim() : `https://${input.value.trim()}`;
              const { from, to } = v.state.selection;
              mode = null;
              v.dispatch(v.state.tr.addMark(from, to, v.state.schema.marks.link.create({ href, title: null, 'data-internal-href': null, edited: false })));
              v.focus();
            } else if (e.key === 'Escape') { mode = null; v.focus(); render(v); }
          });
          setTimeout(() => input.focus());
        } else if (mode === 'color') {
          el.innerHTML = `<div><div class="pl-label">Text color</div><div class="sw-row">${swatches('text')}</div>`
            + `<div class="pl-label">Highlight</div><div class="sw-row">${swatches('background')}</div></div>`;
        } else {
          el.innerHTML = buttons.filter(([m]) => state.schema.marks[m])
            .map(([m, html, title]) => `<button data-mark="${m}" title="${title}" class="${isActive(state, state.schema.marks[m]) ? 'on' : ''}">${html}</button>`).join('')
            + (state.schema.marks.color ? '<button data-action="color" title="Highlight & color ⌘⇧H"><span class="hl">A</span></button>' : '');
        }
        el.style.display = mode === 'color' ? 'block' : 'flex';
        const a = v.coordsAtPos(sel.from), b = v.coordsAtPos(sel.to);
        const w = el.offsetWidth, h = el.offsetHeight;
        const mid = (Math.min(a.left, b.left) + Math.max(a.right, b.right)) / 2;
        el.style.left = `${Math.max(8, Math.min(mid - w / 2, window.innerWidth - w - 8))}px`;
        el.style.top = `${a.top - h - 8 > barBottom() + 8 ? a.top - h - 8 : b.bottom + 8}px`;
      };
      // The link shortcut is remappable, so the editor asks for link mode with an event.
      const onLink = () => { if (!view.state.selection.empty) { mode = 'link'; render(view); } };
      const later = () => setTimeout(() => render(view), 0);
      const onDown = () => { el.style.display = 'none'; mode = null; };
      document.addEventListener('hf-link', onLink);
      view.dom.addEventListener('blur', later);
      view.dom.addEventListener('mousedown', onDown);
      view.dom.addEventListener('mouseup', later);
      return {
        update: (v, prev) => { if (mode !== 'link' && !(prev && v.state.selection.eq(prev.selection) && v.state.doc.eq(prev.doc))) render(v); },
        // plugins are rebuilt on every card switch, so take everything back down
        destroy: () => {
          el.remove();
          document.removeEventListener('hf-link', onLink);
          view.dom.removeEventListener('blur', later);
          view.dom.removeEventListener('mousedown', onDown);
          view.dom.removeEventListener('mouseup', later);
        },
      };
    },
    props: {
      handleKeyDown(view, e) {
        if (e.key === 'Escape' && mode) { mode = null; render(view); return true; }
        return false;
      },
      handleClickOn(view, _pos, _node, _nodePos, event) {
        const a = event.target.closest('a[href]');
        if (a && event.metaKey) { onOpenLink(a.href); return true; }
        return false;
      },
    },
  });
}

// MARK: placeholders

export function placeholderPlugin() {
  return new Plugin({
    props: {
      decorations(state) {
        const { doc, selection } = state;
        const decos = [];
        // Like Heptabase: empty headings always show "Heading N"; a lone empty line shows the hint.
        doc.descendants((node, pos) => {
          if (node.type.name === 'heading' && node.content.size === 0) {
            decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'ph', 'data-ph': `Heading ${node.attrs.level || 1}` }));
          }
          return !node.isTextblock;
        });
        if (doc.childCount === 1 && doc.firstChild.type.name === 'paragraph' && doc.firstChild.content.size === 0) {
          decos.push(Decoration.node(0, doc.firstChild.nodeSize, { class: 'ph', 'data-ph': "Type '/' or '@' for commands" }));
        }
        const { $from, empty } = selection;
        if (empty && $from.parent.isTextblock && $from.parent.content.size === 0 && $from.parent.type.name !== 'heading'
            && !(doc.childCount === 1 && $from.depth === 1)) {
          const label = $from.depth > 1 && $from.node(-1).type.name.endsWith('_list_item') ? 'List' : "Type '/' or '@' for commands";
          decos.push(Decoration.node($from.before(), $from.after(), { class: 'ph line', 'data-ph': label }));
        }
        return DecorationSet.create(doc, decos);
      },
    },
  });
}

// MARK: caret

/**
 * Draws the text cursor ourselves. WebKit sizes the native caret to the whole line box, so with
 * Heptabase's 1.5 line height it towers over the text (most visibly next to Chinese). This caret
 * is centred on the characters at the cursor and sized to the font. While an input method is
 * composing, the native caret takes over so composition stays exactly as macOS draws it.
 */
export function caretPlugin(container) {
  return new Plugin({
    view(view) {
      const caret = document.createElement('div');
      caret.className = 'hf-caret';
      container.append(caret);
      let composing = false;

      const place = () => {
        const { selection } = view.state;
        const show = view.hasFocus() && selection.empty && !composing && selection instanceof TextSelection;
        document.body.classList.toggle('custom-caret', show);
        caret.style.display = show ? 'block' : 'none';
        if (!show) return;
        let rect;
        try { rect = view.coordsAtPos(selection.head, selection.$head.parentOffset === 0 ? 1 : -1); } catch { return; }
        const { node } = view.domAtPos(selection.head);
        const el = node.nodeType === 1 ? node : node.parentElement;
        const size = parseFloat(getComputedStyle(el).fontSize) || 17;
        const height = Math.round(size * 1.18);
        const box = container.getBoundingClientRect();
        const center = (rect.top + rect.bottom) / 2;
        caret.style.height = `${height}px`;
        caret.style.left = `${Math.round(rect.left - box.left + container.scrollLeft)}px`;
        caret.style.top = `${Math.round(center - height / 2 - box.top + container.scrollTop)}px`;
        // restart the blink so the caret is solid right after it moves, as native carets are
        caret.style.animation = 'none';
        void caret.offsetWidth;
        caret.style.animation = '';
      };

      let alive = true;
      const later = () => requestAnimationFrame(() => { if (alive) place(); });
      const onStart = () => { composing = true; place(); };
      const onEnd = () => { composing = false; later(); };
      view.dom.addEventListener('focus', later);
      view.dom.addEventListener('blur', later);
      view.dom.addEventListener('compositionstart', onStart);
      view.dom.addEventListener('compositionend', onEnd);
      window.addEventListener('resize', later);
      document.fonts?.ready.then(later);
      later();
      return {
        update: later,
        destroy() {
          alive = false;
          caret.remove();
          view.dom.removeEventListener('focus', later);
          view.dom.removeEventListener('blur', later);
          view.dom.removeEventListener('compositionstart', onStart);
          view.dom.removeEventListener('compositionend', onEnd);
          window.removeEventListener('resize', later);
        },
      };
    },
  });
}
