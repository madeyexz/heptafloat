// Floating card editor. The Swift host exposes `hf` messages for reading, saving, and searching
// through the Heptabase CLI; this file owns the editor, autosave, polling, and which card is shown:
// today's journal by default (rolling over at midnight), or any note/journal opened with ⌘O / ⌘P.

import { Node } from 'prosemirror-model';
import { EditorState, Plugin, Selection, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, setBlockType } from 'prosemirror-commands';
import { inputRules, wrappingInputRule, textblockTypeInputRule, InputRule } from 'prosemirror-inputrules';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { LIST_ITEMS, schemaFor, schemaCovers, serialize, titles, formatDate } from './schema.js';
import { backspaceAtItemStart, deleteAtLineEnd, enterInItem, lift, selectBlock, setChecked, sink, toggleTodo } from './commands.js';
import { caretPlugin, placeholderPlugin, suggestKey, suggestPlugin, toggleHighlight, toolbarPlugin } from './menus.js';
import { createPalette } from './palette.js';
import { renderSetup } from './setup.js';

const SAVE_DELAY = 600;
const POLL_INTERVAL = 3000;

// MARK: host bridge

let nextRequest = 1;
const waiting = new Map();
const CALL_TIMEOUT = 30_000;

/** Asks the app to do something; resolves with its reply. A reply that never comes resolves as an
 *  error after CALL_TIMEOUT, so one stuck request can't hold up every save behind it. */
function call(action, payload = {}) {
  const id = nextRequest++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!waiting.has(id)) return;
      waiting.delete(id);
      log(`no reply to ${action} after ${CALL_TIMEOUT / 1000} s`);
      resolve({ error: "Heptabase didn't respond" });
    }, CALL_TIMEOUT);
    waiting.set(id, (r) => { clearTimeout(timer); resolve(r); });
    window.webkit.messageHandlers.hf.postMessage({ ...payload, action, requestId: id });
  });
}
const post = (m) => window.webkit.messageHandlers.hf.postMessage(m);

/** A line in ~/Library/Logs/HeptaFloat.log, for tracing what happened to a card. */
function log(message) { post({ action: 'log', message }); }
window.addEventListener('error', (e) => log(`error: ${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => log(`unhandled: ${e.reason?.stack ?? e.reason}`));

async function searchCards(query) {
  const r = await call('search', { query });
  return r.results || [];
}

// MARK: which card is shown

const el = (id) => document.getElementById(id);
let cardTitle = '';
/** The card's title lives in the app's title bar. */
function showTitle(text) { cardTitle = text; post({ action: 'title', title: text }); }
let insetTop = 0; // height of the native title bar over the page
// Keep the caret clear of the title bar and the faded footer.
const scrollRoom = () => ({ top: insetTop + 28, bottom: 72, left: 0, right: 0 });
let view = null;
let current = null;       // { kind: 'journal' | 'note', id }
let followToday = true;   // showing today's journal: switch to the new day at midnight
let dirty = false;        // edits in the card on screen not yet handed to the save queue
const md5Of = new Map();  // card → md5 of the version Heptabase has (what its next save is checked against)
let saveTimer = null;
let lastEdit = 0;
let loadingRemote = false; // set while applying Heptabase's version, so it isn't saved back

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const isDate = (id) => /^\d{4}-\d{2}-\d{2}$/.test(id || '');

/** Heptabase's card types that HeptaFloat can edit, mapped to how the CLI reads them. */
function editableKind(objectType, id) {
  if (objectType === 'journal' || isDate(id)) return 'journal';
  if (objectType === 'note') return 'note';
  return null;
}

function openInHeptabase(id) {
  if (id) post({ action: 'openURL', url: `heptabase://card/${id}` });
}

/** Opens a card in the floating card if it's a note or journal, otherwise in Heptabase. */
async function openHere(card) {
  let kind = editableKind(card.objectType, card.id);
  if (!kind && !card.objectType) {
    const info = await call('cardType', { id: card.id });
    kind = editableKind(info.cardType, card.id);
  }
  if (!kind) { openInHeptabase(card.id); return; }
  await show({ kind, id: card.id });
}

// ⌘[ / ⌘] walk the Recent list (the same order as ⌘P), like Raycast Notes. Cards reached this way
// keep their place in the list, so repeated presses keep moving instead of bouncing between two.
let recentList = null;  // the ⌘P order, refreshed in the background
let navTarget = null;   // where a ⌘[ / ⌘] press is heading, so quick repeats keep moving
let navSeq = 0;         // the newest navigation wins; older ones stop before rendering

async function loadRecentList() {
  const cards = (await call('recents')).cards || [];
  recentList = [...cards.filter((c) => c.pinned), ...cards.filter((c) => !c.pinned)]; // as grouped in ⌘P
  pruneDeleted(recentList).then((gone) => { if (gone.length) { recentList = recentList.filter((c) => !gone.includes(c.id)); palette.reload(); } });
  return recentList;
}

// MARK: cards deleted in Heptabase
//
// A card moved to Heptabase's trash (or deleted) is gone from HeptaFloat too: it's removed from
// Recent, and if it's open it closes (any unsaved typing is kept as a new card when it saves).

const isGone = (r) => /trash|not found/i.test(r?.error ?? '');
const goneChecked = new Map(); // card id → when it was last checked
const TRASH_RECHECK = 60_000;

/** Checks the notes in a list against Heptabase (in parallel, at most once a minute each), removes
 *  deleted ones from Recent, and resolves with their ids. */
async function pruneDeleted(cards, maxAge = TRASH_RECHECK) {
  const due = cards.filter((c) => (c.objectType === 'note' || !c.objectType && !isDate(c.id))
    && Date.now() - (goneChecked.get(c.id) ?? 0) > maxAge).slice(0, 15);
  due.forEach((c) => goneChecked.set(c.id, Date.now()));
  const results = await Promise.all(due.map(async (c) => (isGone(await call('cardType', { id: c.id })) ? c.id : null)));
  const gone = results.filter(Boolean);
  for (const id of gone) {
    post({ action: 'forgetCard', id, requestId: 0 });
    cardCache.delete(cacheKey({ kind: 'note', id }));
    log(`card ${id} was deleted in Heptabase; removed from Recent`);
  }
  return gone;
}

/** The nearest card in the list (from index i, going `direction`) that the card can show. */
function nextShowable(list, i, direction) {
  for (let j = i; j >= 0 && j < list.length; j += direction) {
    const kind = editableKind(list[j].objectType, list[j].id);
    if (kind) return { kind, id: list[j].id, index: j };
  }
  return null;
}

async function step(direction) { // +1 = older (down the list), -1 = newer
  const list = recentList ?? await loadRecentList();
  const from = navTarget?.id ?? current?.id;
  const i = list.findIndex((c) => c.id === from);
  const target = nextShowable(list, i < 0 ? (direction > 0 ? 0 : list.length - 1) : i + direction, direction);
  if (!target) return;
  navTarget = target;
  await show(target, { keepPlace: true });
  if (navTarget === target) navTarget = null;
  // warm up the next stops in both directions
  for (const d of [1, -1]) { const n = nextShowable(list, target.index + d, d); if (n) prefetch(n); } // refresh if older than 30 s
  loadRecentList();
}

// Recently read cards (most recent last, at most CACHE_SIZE), so switching to one is instant;
// it's refreshed right after showing.
const CACHE_SIZE = 30;
const cardCache = new Map();
const cacheKey = (t) => `${t.kind}:${t.id}`;
function remember(r) {
  if (!r || r.error || !r.kind || r.kind === 'draft') return;
  const key = cacheKey(r);
  cardCache.delete(key);
  cardCache.set(key, { ...r, fetchedAt: Date.now() });
  if (cardCache.size > CACHE_SIZE) cardCache.delete(cardCache.keys().next().value);
}

// Reads run alongside saves, so a read that started before a save of the same card can come
// back with the older version. Each save bumps its card's counter; a read that sees the counter
// change while it was in flight is marked stale and never shown or cached.
const saveCounts = new Map();
async function readCard(target) {
  const key = cacheKey(target), before = saveCounts.get(key) ?? 0;
  const r = await call('read', target);
  if ((saveCounts.get(key) ?? 0) !== before) return { ...r, stale: true };
  remember(r);
  return r;
}
/** Loads a card into the cache if it isn't there or is older than maxAge ms. */
function prefetch(target, maxAge = 30_000) {
  const hit = cardCache.get(cacheKey(target));
  if (!hit || Date.now() - hit.fetchedAt > maxAge) readCard(target);
}

/** Edits made in Heptabase mostly happen while the card is hidden: when it's shown again,
 *  refresh the cards ⌘[ / ⌘] would show next, so they're current, not just instant. */
async function refreshNearby() {
  const list = await loadRecentList();
  const i = list.findIndex((c) => c.id === current?.id);
  for (const d of [1, -1]) {
    const n = nextShowable(list, i < 0 ? (d > 0 ? 0 : list.length - 1) : i + d, d);
    if (n) prefetch(n, 5_000);
  }
}

const todayKey = () => cacheKey({ kind: 'journal', id: today() });

/** Puts a link to a new card at the end of today's journal, when that journal is open in the card. */
function linkHereInJournal(cardId) {
  if (!current || cacheKey(current) !== todayKey()) { call('linkInJournal', { id: cardId }); forgetJournal(); return; }
  const { schema } = view.state;
  const line = schema.nodes.paragraph.create(null, schema.nodes.card.create({ cardId }));
  view.dispatch(view.state.tr.insert(view.state.doc.content.size, line)); // saves like any edit
}

/** Today's journal was changed in Heptabase by HeptaFloat itself: don't trust the cached copy. */
function forgetJournal() {
  cardCache.delete(todayKey());
  if (current && cacheKey(current) === todayKey() && !cardBusy(todayKey())) {
    readCard({ kind: 'journal', id: today() }).then((fresh) => {
      if (!fresh.error && !fresh.stale && current && cacheKey(current) === todayKey() && !cardBusy(todayKey())) applyRemote(fresh);
    });
  }
}

/** Switches the editor to another card. The card you leave is snapshotted and saves in the
 *  background, so switching (and ⌘N) is immediate and nothing typed is lost. */
async function show(target, { focusEnd = true, keepPlace = false } = {}) {
  if (current && target.kind === current.kind && target.id === current.id) { view?.focus(); return; }
  if (target.kind === 'draft' && current?.kind === 'draft' && !dirty) { view?.focus(); return; }
  const seq = ++navSeq;
  if (uploads.size) {
    // an image is still uploading into this card: let it land here first
    status('Finishing image upload…', { sticky: true });
    await Promise.all([...uploads]);
    if (seq !== navSeq) return;
  }
  save({ final: true });
  const key = cacheKey(target);
  if (inFlight.has(key)) { await saveChain; if (seq !== navSeq) return; } // back to a card that's still saving
  const retrying = unsaved.get(key); // a card whose save failed: show what you wrote, not the old version
  let r = target.kind === 'draft' ? newDraft()
    : retrying ? { ...(cardCache.get(key) ?? {}), kind: target.kind, id: target.id, content: JSON.stringify(serialize(retrying.doc)), contentMd5: md5Of.get(key) }
    : cardCache.get(key);
  const fromCache = !!r && target.kind !== 'draft' && !retrying;
  if (!r) {
    do r = await readCard(target); while (r.stale);
    if (seq !== navSeq) return;
  }
  if (r.error) { status(r.error, { error: true }); return; }
  save({ final: true }); // anything typed into the old card while this one loaded belongs to the old card
  if (!el('status').classList.contains('error')) status('');
  followToday = target.kind === 'journal' && target.id === today();
  applyRemote(r, { keepSelection: false });
  if (retrying) { unsaved.delete(key); dirty = true; scheduleSave(); }
  if (r.kind === 'draft') {
    // like Heptabase's new card: cursor on the "Heading 1" title line, body below
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
  } else if (focusEnd) {
    view.dispatch(view.state.tr.setSelection(endOfText(view.state.doc)).scrollIntoView());
    el('main').scrollTop = 0;
  }
  view.focus();
  if (r.kind !== 'draft') { touchRecent(r, { keepPlace }); checkTrashed(target); }
  if (fromCache) {
    // shown instantly from memory; pick up anything that changed since
    readCard(target).then((fresh) => {
      if (fresh.error || fresh.stale || current?.id !== fresh.id || cardBusy(key)) return;
      if (fresh.contentMd5 !== md5Of.get(key)) applyRemote(fresh);
    });
  }
}

/**
 * ⌘N: a blank card with an empty title line, like Raycast Notes. Nothing is created in Heptabase
 * until you type — the first save creates the note — so leaving it empty leaves no trace.
 */
function newDraft() {
  return {
    kind: 'draft', id: `draft-${Date.now()}`, title: '', contentMd5: null,
    content: JSON.stringify({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 } }, { type: 'paragraph' }] }),
  };
}

/** ⌘.: pins the card you're on to the top of ⌘P (or unpins it). */
async function togglePin() {
  if (palette.pinSelected()) return; // ⌘P open: the highlighted card
  if (!current || current.kind === 'draft') { status('Type something first — then pin it'); return; }
  const cards = (await call('recents')).cards || [];
  const pinned = !cards.find((c) => c.id === current.id)?.pinned;
  await call('pinCard', { id: current.id, pinned });
  loadRecentList();
  status(pinned ? 'Pinned — it stays at the top of ⌘P' : 'Unpinned', { duration: 2500 });
}

/** Records a card (the current one by default) in Recent. keepPlace updates its title and length
 *  without moving it up. */
function touchRecent(r, { keepPlace = false, card = current, doc = view?.state.doc } = {}) {
  post({
    action: 'touchRecent', id: card.id, objectType: card.kind, title: r.title || '',
    chars: doc ? [...doc.textContent].length : 0, keepPlace,
  });
}

// MARK: shortcuts (remappable; the Swift host sends the user's choices)

const bindings = {
  bold: 'Mod-b', italic: 'Mod-i', underline: 'Mod-u', strike: 'Mod-Shift-x', code: 'Mod-e', link: 'Mod-k',
  highlight: 'Mod-Shift-h', toggleTodo: 'Mod-Enter', paragraph: 'Mod-Alt-0',
  heading1: 'Mod-Alt-1', heading2: 'Mod-Alt-2', heading3: 'Mod-Alt-3',
  pinCard: 'Mod-.', back: 'Mod-[', forward: 'Mod-]', newCard: 'Mod-n', search: 'Mod-o', recent: 'Mod-p', today: 'Mod-Shift-d', openInHeptabase: 'Mod-Shift-o',
};

/** Named commands, run from the keymap here or from the app's menus. */
function commandFor(name, schema) {
  const n = schema.nodes, m = schema.marks;
  const run = (fn) => () => { fn(); return true; };
  return {
    bold: toggleMark(m.strong), italic: toggleMark(m.em), underline: toggleMark(m.underline),
    strike: toggleMark(m.strike), code: toggleMark(m.code), highlight: toggleHighlight, toggleTodo,
    link: run(() => document.dispatchEvent(new CustomEvent('hf-link'))),
    paragraph: setBlockType(n.paragraph),
    heading1: setBlockType(n.heading, { level: 1 }), heading2: setBlockType(n.heading, { level: 2 }),
    heading3: setBlockType(n.heading, { level: 3 }),
    search: run(() => palette.toggle('search')), recent: run(() => palette.toggle('recent')),
    newCard: run(() => show({ kind: 'draft' })),
    pinCard: run(() => togglePin()),
    back: run(() => step(1)),     // ⌘[ — older
    forward: run(() => step(-1)), // ⌘] — newer
    today: run(() => show({ kind: 'journal', id: today() })),
    openInHeptabase: run(() => { if (current?.kind !== 'draft') openInHeptabase(current?.id); }),
  }[name];
}

// MARK: card pickers (⌘P recent, ⌘O search)

const palette = createPalette({
  recents: async () => {
    const cards = (await call('recents')).cards || [];
    const list = cards.map((c) => ({ ...c, title: c.title || (isDate(c.id) ? formatDate(c.id) : 'Untitled'), current: c.id === current?.id }));
    // Today's journal is always one keystroke away, even before it's in the history.
    if (!list.some((c) => c.id === today())) list.push({ id: today(), objectType: 'journal', title: `${formatDate(today())} · Today` });
    pruneDeleted(cards, 3_000).then((gone) => { if (gone.length) palette.reload(); }); // drop cards deleted in Heptabase
    return list.sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0));
  },
  search: searchCards,
  open: (card) => openHere(card),
  openInHeptabase: (card) => openInHeptabase(card.id),
  pin: (card, on) => call('pinCard', { id: card.id, pinned: on }),
  forget: (card) => call('forgetCard', { id: card.id }),
  onClose: () => view?.focus(),
  isPinKey: (e) => keyName(e) === normalize(bindings.pinCard),
  pickerFor: (e) => {
    const key = keyName(e);
    return key === normalize(bindings.search) ? 'search' : key === normalize(bindings.recent) ? 'recent' : null;
  },
});

/** "Mod-Shift-o" in a fixed modifier order, so keys typed and keys bound compare equal. */
function normalize(name) {
  const parts = name.split('-'), key = parts.pop().toLowerCase();
  return [...parts.sort(), key].join('-');
}
function keyName(e) {
  const mods = [e.altKey && 'Alt', e.ctrlKey && 'Ctrl', e.metaKey && 'Mod', e.shiftKey && 'Shift'].filter(Boolean);
  const key = e.key === 'Enter' ? 'enter' : e.code?.startsWith('Key') ? e.code.slice(3).toLowerCase()
    : e.code?.startsWith('Digit') ? e.code.slice(5) : e.key.toLowerCase();
  return [...mods.sort(), key].join('-');
}

// MARK: mention popup — choose where to open a linked card

const mentionPopup = (() => {
  const pop = document.createElement('div');
  pop.className = 'popup mention-pop';
  document.body.append(pop);
  let chip = null, hideTimer = null, showTimer = null, pinned = false;

  function place(target) {
    const r = target.getBoundingClientRect();
    pop.style.display = 'block';
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
    const above = r.top - h - 6, roomAbove = above >= insetTop + 8; // never under the title bar
    pop.style.top = `${r.bottom + 6 + h < window.innerHeight - 8 || !roomAbove ? r.bottom + 6 : above}px`;
  }

  function open(target, pin = false) {
    clearTimeout(hideTimer);
    chip = target;
    pinned = pin;
    const { kind, id } = target.dataset;
    const here = kind === 'card' || kind === 'date';
    const label = target.textContent || 'Card';
    pop.innerHTML = `<div class="mp-title">${label.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))}</div>`
      + (here ? '<button data-where="here"><span>Open here</span></button>' : '')
      + '<button data-where="heptabase"><span>Open in Heptabase</span><kbd>⌘ click</kbd></button>';
    place(target);
    pop.dataset.id = id;
    pop.dataset.kind = kind;
  }

  function close() { pop.style.display = 'none'; chip = null; pinned = false; }
  function hideSoon() { clearTimeout(hideTimer); if (!pinned) hideTimer = setTimeout(close, 220); }

  pop.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const b = e.target.closest('[data-where]');
    if (!b) return;
    const { id, kind } = pop.dataset;
    close();
    if (b.dataset.where === 'heptabase') openInHeptabase(id);
    else openHere({ id, objectType: kind === 'date' ? 'journal' : undefined });
  });
  pop.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  pop.addEventListener('mouseleave', hideSoon);

  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest?.('.ProseMirror .chip[data-id]');
    if (!target || !target.dataset.id) return;
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    if (chip !== target) showTimer = setTimeout(() => open(target), 350);
    target.addEventListener('mouseleave', () => { clearTimeout(showTimer); hideSoon(); }, { once: true });
  });
  document.addEventListener('mousedown', (e) => { if (pinned && !pop.contains(e.target) && e.target !== chip) close(); });
  // Any key closes the popup (Esc without also hiding the card); keys are never taken from the editor.
  document.addEventListener('keydown', (e) => {
    if (pop.style.display === 'none') return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
    close();
  }, true);

  return { open, close };
})();

// MARK: plugins

function buildPlugins(schema) {
  const n = schema.nodes;
  const rules = [
    wrappingInputRule(/^\s*[-*]\s$/, n.bullet_list_item),
    wrappingInputRule(/^(\d+)\.\s$/, n.numbered_list_item),
    wrappingInputRule(/^\[( |x)?\]\s$/, n.todo_list_item, (match) => ({ checked: match[1] === 'x' })),
    wrappingInputRule(/^\+\s$/, n.toggle_list_item, { folded: false }),
    wrappingInputRule(/^>\s$/, n.blockquote),
    textblockTypeInputRule(/^(#{1,6})\s$/, n.heading, (match) => ({ level: match[1].length })),
    textblockTypeInputRule(/^```$/, n.code_block, { params: '' }),
    new InputRule(/^---$/, (state, _match, start) => {
      const $s = state.doc.resolve(start);
      return state.tr.replaceRangeWith($s.before(), $s.after(), n.horizontal_rule.create())
        .insert($s.before() + 1, n.paragraph.create());
    }),
  ];
  const remappable = Object.fromEntries(Object.entries(bindings).map(([name, key]) => [key, commandFor(name, schema)]));
  return [
    // Typing over a selection that spans lines deletes it like Backspace does, so no empty
    // list item is left behind.
    new Plugin({ props: {
      handleTextInput(view, from, to, text) {
        if (view.state.doc.resolve(from).sameParent(view.state.doc.resolve(to))) return false;
        view.dispatch(view.state.tr.deleteSelection().insertText(text).scrollIntoView());
        return true;
      },
      handleDOMEvents: { beforeinput(view, event) { // text that doesn't come from a keypress (dictation, autocorrect…)
        const { $from, $to } = view.state.selection;
        if (event.inputType !== 'insertText' || !event.data || $from.sameParent($to)) return false;
        event.preventDefault();
        view.dispatch(view.state.tr.deleteSelection().insertText(event.data).scrollIntoView());
        return true;
      } },
    } }),
    suggestPlugin(searchCards),
    toolbarPlugin((url) => post({ action: 'openURL', url })),
    inputRules({ rules }),
    keymap({
      ...remappable,
      'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo,
      Enter: enterInItem,
      Backspace: backspaceAtItemStart, Delete: deleteAtLineEnd, 'Ctrl-d': deleteAtLineEnd,
      Tab: sink, 'Shift-Tab': lift, 'Mod-a': selectBlock,
      Escape: () => { post({ action: 'hide' }); return true; },
    }),
    keymap({ ...baseKeymap, Tab: () => true, 'Shift-Tab': () => true }),
    history(),
    dropCursor({ color: 'var(--active-item)', width: 2 }),
    gapCursor(),
    placeholderPlugin(),
    caretPlugin(el('main')),
    new Plugin({ view: () => ({ update: (v, prev) => { if (!v.state.doc.eq(prev.doc)) onLocalChange(); } }) }),
  ];
}

// Marker clicks: tick todos, fold toggles and bullets with children.
class ItemView {
  constructor(node, view, getPos) {
    this.dom = document.createElement('div');
    this.marker = document.createElement('span');
    this.marker.className = 'mk';
    this.marker.contentEditable = 'false';
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'bd';
    this.due = document.createElement('span');
    this.due.className = 'due';
    this.due.contentEditable = 'false';
    this.dom.append(this.marker, this.contentDOM, this.due);
    this.marker.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const pos = getPos(), cur = view.state.doc.nodeAt(pos);
      if (!cur) return;
      if (cur.type.name === 'todo_list_item') view.dispatch(setChecked(view.state.tr, pos, cur, !cur.attrs.checked));
      else if (cur.childCount > 1 || cur.type.name === 'toggle_list_item') view.dispatch(view.state.tr.setNodeAttribute(pos, 'folded', !cur.attrs.folded));
    });
    this.update(node);
  }
  update(node) {
    if (this.node && node.type !== this.node.type) return false;
    this.node = node;
    const kind = node.type.name.replace('_list_item', '');
    const due = kind === 'todo' && node.attrs.dueDate ? dueLabel(node.attrs.dueDate) : null;
    this.dom.className = `li ${kind}${node.attrs.checked ? ' done' : ''}${node.attrs.folded ? ' folded' : ''}${node.childCount > 1 ? ' parent' : ''}${due ? ' has-due' : ''}`;
    this.dom.dataset.format = node.attrs.format ?? 0;
    this.due.textContent = due?.text ?? '';
    this.due.classList.toggle('overdue', !!due?.overdue && !node.attrs.checked);
    return true;
  }
  ignoreMutation(m) { return [this.marker, this.due].some((d) => m.target === d || d.contains(m.target)); }
}

/** "Today", "Tomorrow", "Yesterday", or "Oct 14", the way Heptabase labels to-do due dates. */
function dueLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return null;
  const due = new Date(y, m - 1, d), now = new Date();
  const days = Math.round((due - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
  const text = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday'
    : due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(y !== now.getFullYear() && { year: 'numeric' }) });
  return { text, overdue: days < 0 };
}

/** Cursor at the end of the last line of text, rather than selecting a trailing embed or image. */
function endOfText(doc) {
  return Selection.findFrom(doc.resolve(doc.content.size), -1, true) ?? Selection.atEnd(doc);
}

// MARK: chrome

/** Footer status. Errors stay until things work again; the full text is in the tooltip. */
/** Footer message. Plain messages fade after `duration` ms; sticky ones stay until the next
 *  message (for "Saving…"-style progress); errors stay until things work again. */
function status(text, { sticky = false, error = false, duration = 1600 } = {}) {
  if (error && text) log(`status: ${text}`);
  const s = el('status');
  s.textContent = text;
  s.title = text;
  s.classList.toggle('show', !!text);
  s.classList.toggle('error', error);
  clearTimeout(status.t);
  if (text && !sticky && !error) status.t = setTimeout(() => s.classList.remove('show'), duration);
}
function clearError() {
  if (el('status').classList.contains('error')) status('');
}

function updateCount() {
  const doc = view?.state.doc;
  const chars = doc ? [...doc.textContent].length : 0;
  el('count').textContent = `${chars.toLocaleString()} characters`;
  let open = 0;
  doc?.descendants((n) => { if (n.type.name === 'todo_list_item' && !n.attrs.checked) open++; });
  el('todocount').textContent = `${open} todo${open === 1 ? '' : 's'}`;
  el('todos').classList.toggle('show', open > 0);
}

/** Journals get Heptabase's weekday + date title. Notes show their title only when it isn't
 *  already the first line (web clips keep it separately). */
function setTitle(result, json) {
  const title = result.title || (isDate(result.id) ? formatDate(result.id) : 'Untitled');
  showTitle(title);
  if (result.kind === 'draft') {
    el('weekday').textContent = '';
    el('jtitle').hidden = true; // the title line is in the card itself
  } else if (result.kind === 'journal') {
    const [y, m, d] = result.id.split('-').map(Number);
    el('weekday').textContent = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' });
    el('bigtitle').textContent = title;
    el('jtitle').hidden = false;
  } else {
    const first = json.content?.[0];
    const firstText = (function text(n) { return n?.text ?? (n?.content || []).map(text).join(''); })(first).trim();
    const duplicate = first?.type === 'heading' && firstText === title.trim();
    el('weekday').textContent = '';
    el('bigtitle').textContent = title;
    el('jtitle').hidden = duplicate;
  }
  document.body.dataset.kind = result.kind;
}

// MARK: load / save / sync

function load(result, { keepSelection } = {}) {
  current = { kind: result.kind, id: result.id };
  if (result.kind !== 'draft') md5Of.set(cacheKey(result), result.contentMd5);
  mentionPopup.close();
  let json;
  try { json = JSON.parse(result.content); } catch { json = { type: 'doc', content: [{ type: 'paragraph' }] }; }
  if (!json.content?.length) json.content = [{ type: 'paragraph' }];
  setTitle(result, json);

  if (view && keepSelection && schemaCovers(view.state.schema, json)) {
    const { prepared } = schemaFor(json);
    const doc = Node.fromJSON(view.state.schema, prepared);
    const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content).setMeta('addToHistory', false);
    const max = tr.doc.content.size;
    const { from, to } = view.state.selection;
    try { tr.setSelection(TextSelection.create(tr.doc, Math.min(from, max), Math.min(to, max))); } catch { /* keep mapped selection */ }
    view.dispatch(tr);
  } else {
    const { schema, prepared } = schemaFor(json);
    const state = EditorState.create({ doc: Node.fromJSON(schema, prepared), plugins: buildPlugins(schema) });
    if (view) view.updateState(state);
    else view = new EditorView(el('main'), {
      state,
      nodeViews: Object.fromEntries(LIST_ITEMS.map((t) => [t, (n, v, g) => new ItemView(n, v, g)])),
      scrollThreshold: scrollRoom(),
      scrollMargin: scrollRoom(),
      // Pasted or dropped images are imported into Heptabase, then inserted like Heptabase does.
      handlePaste(_v, event) {
        const files = [...(event.clipboardData?.items || [])].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile());
        if (!files.length) return false;
        event.preventDefault();
        files.forEach((f) => insertImage(f));
        return true;
      },
      handleDrop(_v, event) {
        const files = [...(event.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        files.forEach((f) => insertImage(f, pos));
        return true;
      },
      handleClickOn(_v, _pos, _node, _nodePos, event) {
        const chip = event.target.closest('.chip[data-id]');
        if (chip && chip.dataset.id) {
          if (event.metaKey) openInHeptabase(chip.dataset.id);
          else mentionPopup.open(chip, true);
          return true;
        }
        const bookmark = event.target.closest('a.bookmark[href]');
        if (bookmark) { post({ action: 'openURL', url: bookmark.href }); return true; }
        return false;
      },
    });
  }
  dirty = false;
  composeBase = null; // a composition in the card it replaces is over
  dirtyBeforeCompose = false;
  updateCount();
}

/** Uploads an image file to Heptabase (via the CLI) and inserts an image block that points to it. */
const uploads = new Set(); // image uploads still running; switching cards waits for them

function insertImage(file, pos) {
  const upload = uploadImage(file, pos).finally(() => uploads.delete(upload));
  uploads.add(upload);
  return upload;
}

async function uploadImage(file, pos) {
  status('Adding image…', { sticky: true });
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const name = file.name && file.name !== 'image.png' ? file.name : `Pasted image ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
  const r = await call('importImage', { data, name });
  if (r.error || !r.fileId) { status(`Couldn't add image — ${r.error || 'unknown error'}`, { error: true }); return; }
  const node = view.state.schema.nodes.image.create({
    src: null, fileId: r.fileId, originalWidth: r.width ?? null, originalHeight: r.height ?? null, alignment: 'center',
  });
  let tr;
  if (pos == null) tr = view.state.tr.replaceSelectionWith(node);
  else {
    const $pos = view.state.doc.resolve(Math.min(pos, view.state.doc.content.size));
    tr = view.state.tr.insert($pos.depth >= 1 ? $pos.after(1) : $pos.pos, node); // dropped: after the block under the pointer
  }
  view.dispatch(tr.scrollIntoView());
  status('Image added');
}

function onLocalChange() {
  updateCount();
  if (loadingRemote) return;
  dirty = true;
  lastEdit = Date.now();
  if (!view.composing) scheduleSave(); // half-typed IME text isn't saved: see compositionend
}

// MARK: IME composition
//
// While an input method composes (Pinyin letters underlined, waiting for a choice), the doc holds
// those letters. They are never saved: saves wait for compositionend. A flush meanwhile (hide,
// quit) saves the text as it was when the composition began.

let composeBase = null;          // the doc when the composition began: committed text only
let dirtyBeforeCompose = false;  // it had edits not handed to the save queue yet
document.addEventListener('compositionstart', () => {
  if (!view) return;
  composeBase = view.state.doc;
  dirtyBeforeCompose = dirty;
}, true); // before ProseMirror's own handler touches the doc
document.addEventListener('compositionend', () => {
  // ProseMirror finishes the composition just after this event.
  setTimeout(() => {
    if (!view || view.composing) return;
    // cancelled (Esc): nothing changed since the last save
    if (!dirtyBeforeCompose && composeBase && view.state.doc.eq(composeBase)) dirty = false;
    composeBase = null;
    dirtyBeforeCompose = false;
    if (dirty) scheduleSave();
  }, 30);
});

function scheduleSave(delay = SAVE_DELAY) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, delay);
}

// MARK: save queue
//
// Every save is a snapshot of one card ({ target, doc }) taken the moment it's queued, so you can
// keep typing or switch cards while it runs. Saves run one at a time, in order. A save that can't
// reach Heptabase is kept per card and retried; a save that clashes with a change made in
// Heptabase keeps both versions (keepBoth).

let saveChain = Promise.resolve();
const inFlight = new Map();      // card → number of its saves queued or running
const unsaved = new Map();       // card → { target, doc } whose save failed; retried
const generation = new Map();    // card → bumped on a clash, so saves queued before it are dropped
const createdFrom = new Map();   // ⌘N draft id → the note it became
const latestDoc = new Map();     // card → newest snapshot queued
let retryTimer = null;

/** True while a card has edits that aren't in Heptabase yet (so syncing must not replace it). */
function cardBusy(key) {
  return (current && cacheKey(current) === key && dirty) || inFlight.has(key) || unsaved.has(key);
}

/** Queues the card on screen if it has edits. Resolves when everything queued so far is done.
 *  During an IME composition it waits for compositionend; `final` (hide, quit) saves the text
 *  committed before the composition instead. */
function save({ final = false } = {}) {
  clearTimeout(saveTimer);
  if (dirty && view && current && view.composing) {
    if (final && dirtyBeforeCompose && composeBase) {
      dirtyBeforeCompose = false;
      queueSave({ target: { ...current }, doc: composeBase });
    }
    return saveChain;
  }
  if (dirty && view && current) {
    dirty = false;
    queueSave({ target: { ...current }, doc: view.state.doc });
  }
  return saveChain;
}

function queueSave(snap) {
  const key = cacheKey(snap.target);
  snap.generation = generation.get(key) ?? 0;
  inFlight.set(key, (inFlight.get(key) ?? 0) + 1);
  latestDoc.set(key, snap.doc);
  unsaved.delete(key);
  saveChain = saveChain
    .then(() => send(snap))
    .catch((e) => status(`Not saved — ${e?.message ?? e}`, { error: true }))
    .finally(() => {
      const n = inFlight.get(key) - 1;
      if (n > 0) inFlight.set(key, n); else { inFlight.delete(key); latestDoc.delete(key); }
    });
  return saveChain;
}

async function send(snap) {
  let { target } = snap;
  const { doc } = snap;
  const firstKey = cacheKey(target);
  if (snap.generation < (generation.get(firstKey) ?? 0)) return; // already kept as a copy
  if (target.kind === 'draft' && createdFrom.has(target.id)) target = { kind: 'note', id: createdFrom.get(target.id) };
  if (movedTo.has(cacheKey(target))) target = movedTo.get(cacheKey(target));
  const isShown = () => current && current.kind === target.kind && current.id === target.id;
  const wasDraft = target.kind === 'draft';
  const content = JSON.stringify(serialize(doc));
  saveCounts.set(cacheKey(target), (saveCounts.get(cacheKey(target)) ?? 0) + 1);
  status('Saving…', { sticky: true });

  // A ⌘N draft becomes a real note on its first save.
  const r = wasDraft
    ? await call('createNote', { title: doc.firstChild?.textContent.trim() || 'Untitled', content, journalShown: !!current && cacheKey(current) === todayKey() })
    : await call('save', { ...target, content, md5: md5Of.get(cacheKey(target)) ?? '' });

  const createdId = wasDraft ? r.createdId ?? r.current?.id : null;
  if (createdId) {
    // The note exists now, even if filling it failed: from here on, saves go into it.
    const note = { kind: 'note', id: createdId };
    createdFrom.set(target.id, createdId);
    md5Of.set(cacheKey(note), r.current?.contentMd5 ?? ''); // '' = nothing else has touched it yet
    if (isShown()) {
      current = note;
      document.body.dataset.kind = 'note';
      showTitle(r.current?.title || doc.firstChild?.textContent.trim() || 'Untitled');
    }
    target = note;
  }
  const key = cacheKey(target);

  if (!r.error) {
    let fresh = r.current;
    if (!fresh) {
      // Saved, but reading it back failed: ask again, so the next save is checked against this version.
      const again = await readCard(target);
      fresh = again.error || again.stale ? null : again;
    }
    md5Of.set(key, fresh ? fresh.contentMd5 : ''); // '' = unknown: the next save checks against whatever Heptabase has
    if (fresh) remember(fresh);
    if (isShown() && fresh) adoptIds(doc, fresh);
    unsaved.delete(key);
    touchRecent(fresh ?? { title: cardTitle }, isShown() ? { keepPlace: !wasDraft } : { keepPlace: !wasDraft, card: target, doc });
    clearError();
    log(`saved ${target.kind} ${target.id}${wasDraft ? ' (new card)' : ''}`);
    if (r.linkHere) linkHereInJournal(target.id);
    if (r.linkedInJournal) forgetJournal();
    if (r.journalError) status(`Card created, but not linked in today's journal — ${r.journalError}`, { error: true });
    else status(r.linkedInJournal || r.linkHere ? "Saved · linked in today's journal" : 'Saved');
    return;
  }

  if (/trash/i.test(r.error ?? '')) {
    // The card was moved to Heptabase's trash: keep what you wrote as a new card.
    await rescueFromTrash({ target, doc: latestDoc.get(firstKey) ?? doc, shown: isShown() });
    return;
  }

  if (r.current && r.current.contentMd5 !== md5Of.get(key)) {
    // Changed in Heptabase too (another device, or right before switching apps).
    await keepBoth({ target, doc, theirs: r.current, shown: isShown() });
    return;
  }

  // Couldn't reach Heptabase (or another failure): keep this version and retry.
  if (isShown()) dirty = true;
  else unsaved.set(key, { target, doc: latestDoc.get(firstKey) ?? doc });
  status(`Not saved — ${r.error}`, { error: true });
  clearTimeout(retryTimer);
  retryTimer = setTimeout(retrySaves, 3000);
}

const movedTo = new Map(); // trashed card → the new card its text was saved to

async function rescueFromTrash({ target, doc, shown }) {
  const key = cacheKey(target);
  generation.set(key, (generation.get(key) ?? 0) + 1); // older queued saves of it are dropped
  post({ action: 'forgetCard', id: target.id, requestId: 0 });
  log(`card ${target.id} is in Heptabase's trash; saving its text as a new card`);
  const mineDoc = shown ? view.state.doc : doc;
  const title = mineDoc.firstChild?.textContent.trim() || 'Untitled';
  const c = await call('createNote', { title, content: JSON.stringify(serialize(mineDoc)), copy: true });
  const id = c.current?.id ?? c.createdId;
  if (!id) { status(`This card is in Heptabase's trash, and saving it as a new card failed — ${c.error}`, { error: true }); return; }
  const note = { kind: 'note', id };
  movedTo.set(key, note);
  md5Of.set(cacheKey(note), c.current?.contentMd5 ?? '');
  if (c.current) remember(c.current);
  if (shown && current && cacheKey(current) === key) {
    current = note;
    if (dirty) scheduleSave(0); // anything typed since goes to the new card
  }
  post({ action: 'touchRecent', id, objectType: 'note', title: c.current?.title || title, chars: [...mineDoc.textContent].length });
  status("That card was in Heptabase's trash — your text is saved as a new card", { duration: 8000 });
}

/** After opening a card: if it's in Heptabase's trash, say so (edits will become a new card). */
/** If the open card was deleted in Heptabase: close it and go to today's journal. With unsaved
 *  typing, stay — that save turns the text into a new card (rescueFromTrash). */
async function checkTrashed(target) {
  if (target.kind !== 'note') return;
  goneChecked.set(target.id, Date.now());
  const info = await call('cardType', { id: target.id });
  if (!isGone(info) || !current || cacheKey(current) !== cacheKey(target)) return;
  post({ action: 'forgetCard', id: target.id, requestId: 0 });
  cardCache.delete(cacheKey(target));
  log(`open card ${target.id} was deleted in Heptabase`);
  if (cardBusy(cacheKey(target))) {
    status("This card was deleted in Heptabase — your typing will be saved as a new card", { sticky: true });
    return;
  }
  await show({ kind: 'journal', id: today() });
  status('That card was deleted in Heptabase, so it was closed', { duration: 8000 });
}

function retrySaves() {
  for (const snap of [...unsaved.values()]) queueSave(snap);
  save();
}

/** On a save clash: keeps your version as a new note and Heptabase's in the card. Nothing is
 *  overwritten. Runs inside the save queue, so quitting waits for the copy to be saved. */
async function keepBoth({ target, doc, theirs, shown }) {
  const key = cacheKey(target);
  generation.set(key, (generation.get(key) ?? 0) + 1); // saves of the old version still queued are dropped
  md5Of.set(key, theirs.contentMd5);
  remember(theirs);
  let mineDoc = latestDoc.get(key) ?? doc;
  let name = cardCache.get(key)?.title || 'Untitled';
  if (shown) {
    mineDoc = view.state.doc; // includes anything typed since
    name = cardTitle || name;
    clearTimeout(saveTimer);
    dirty = false;
    applyRemote(theirs);
  }
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const title = `${name} — HeptaFloat copy ${time}`;
  const withoutIds = (n) => ({ ...n, ...(n.attrs && 'id' in n.attrs && { attrs: { ...n.attrs, id: null } }), ...(n.content && { content: n.content.map(withoutIds) }) });
  const mine = withoutIds(serialize(mineDoc));
  const copy = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] }, ...mine.content] };
  status('Changed in Heptabase too — saving your version as a copy…', { sticky: true });
  const c = await call('createNote', { title, content: JSON.stringify(copy), copy: true });
  if (c.current || c.createdId) {
    post({ action: 'touchRecent', id: c.current?.id ?? c.createdId, objectType: 'note', title: c.current?.title || title, chars: 0 });
    status(`Changed in Heptabase too — your version is saved as “${title}” (⌘P)`, { duration: 8000 });
  } else {
    status(`Changed in Heptabase too, and your version couldn't be saved — ${c.error}`, { error: true });
  }
}

/** After a save the CLI assigns ids to new blocks; copy them in so later saves keep them. */
function adoptIds(savedDoc, cur) {
  if (!view || !view.state.doc.eq(savedDoc)) return;
  let remote;
  try { remote = JSON.parse(cur.content); } catch { return; }
  const tr = view.state.tr;
  const walk = (node, json, pos) => {
    if (!json || json.type !== node.type.name) return;
    if ('id' in node.attrs && node.attrs.id == null && json.attrs?.id) tr.setNodeAttribute(pos, 'id', json.attrs.id);
    if (node.isTextblock || (json.content || []).length !== node.childCount) return;
    node.forEach((child, off, i) => walk(child, json.content[i], pos + 1 + off));
  };
  savedDoc.forEach((child, off, i) => walk(child, remote.content?.[i], off));
  if (tr.docChanged) {
    loadingRemote = true;
    view.dispatch(tr.setMeta('addToHistory', false));
    loadingRemote = false;
  }
}

function applyRemote(result, opts = { keepSelection: true }) {
  if (!result) return;
  remember(result);
  loadingRemote = true;
  load(result, opts);
  loadingRemote = false;
}

let onScreen = true; // the app tells us when the card is hidden; no syncing then

async function poll() {
  if (!onScreen || !current || current.kind === 'draft' || cardBusy(cacheKey(current)) || Date.now() - lastEdit < 1500) return;
  // Showing today's journal: follow the date across midnight.
  if (followToday && current.id !== today()) { show({ kind: 'journal', id: today() }); return; }
  const target = { ...current };
  if (target.kind === 'note' && Date.now() - (goneChecked.get(target.id) ?? 0) > 15_000) checkTrashed(target);
  const r = await readCard(target);
  if (r.error) { status(r.error, { error: true }); return; }
  clearError();
  if (r.stale || cardBusy(cacheKey(target)) || current.id !== target.id) return;
  if (r.contentMd5 !== md5Of.get(cacheKey(target))) applyRemote(r);
}

window.hf = {
  reply(requestId, result) { waiting.get(requestId)?.(result); waiting.delete(requestId); },
  setScale(s) { document.documentElement.style.setProperty('--scale', s); if (view) view.dispatch(view.state.tr); },
  setPinned(on) { document.body.classList.toggle('pinned', on); },
  /** Height of the title bar the page runs under (0 in the notch). */
  setInsets(top) {
    insetTop = top;
    document.documentElement.style.setProperty('--titlebar', `${top}px`);
    view?.setProps({ scrollThreshold: scrollRoom(), scrollMargin: scrollRoom() });
  },
  shown() { onScreen = true; view?.focus(); poll(); if (current) refreshNearby(); },
  setVisible(v) { const was = onScreen; onScreen = v; if (v && !was) { poll(); if (current) refreshNearby(); } },
  async flush() { await Promise.all([...uploads]); await save({ final: true }); return true; },
  /** In the notch with Keep on top off, the card folds when the pointer leaves, but not while
   *  you're in the middle of something here: an IME composition, the ⌘O / ⌘P palette, the
   *  / or @ menu, the link field or color picker, or a mention's popup. */
  holdsOpen() {
    const shown = (sel) => [...document.querySelectorAll(sel)].some((e) => e.style.display && e.style.display !== 'none');
    return !!(view?.composing || palette.isOpen || (view && suggestKey.getState(view.state))
      || shown('.popup.mention-pop') || shown('.popup.toolbar.palette') || document.querySelector('.popup.toolbar .link-input')?.offsetParent);
  },
  undo() { if (view) { undo(view.state, view.dispatch); view.focus(); } },
  redo() { if (view) { redo(view.state, view.dispatch); view.focus(); } },
  /** Edit → Select All (⌘A): a text field in focus selects its own text. */
  selectAll() {
    const field = document.activeElement?.closest?.('input, textarea');
    if (field) field.select();
    else if (view) { selectBlock(view.state, view.dispatch); view.focus(); }
  },
  titles(map) {
    Object.assign(titles, map);
    for (const c of document.querySelectorAll('.chip[data-id]')) if (map[c.dataset.id]) c.textContent = map[c.dataset.id];
  },
  /** { bold: "Mod-b", … } from Settings → Shortcuts. */
  setShortcuts(map) {
    Object.assign(bindings, map);
    if (view) view.updateState(view.state.reconfigure({ plugins: buildPlugins(view.state.schema) }));
  },
  /** The footer's update notice; empty hides it. */
  setUpdate(text) {
    el('update').textContent = text;
    el('update').hidden = !text;
    document.body.classList.toggle('has-update', !!text);
  },
  /** Runs a named command from the app menus. */
  command(name) {
    if (!view) return;
    const cmd = commandFor(name, view.state.schema);
    if (cmd) cmd(view.state, view.dispatch, view);
    if (!palette.isOpen) view.focus();
  },
};

el('update').onclick = () => post({ action: 'settings' });

/** Until Heptabase answers, show the setup checklist and keep checking; then start the editor. */
let connectTimer = null, connecting = false, started = false;
async function connect() {
  if (connecting || started) return;
  connecting = true;
  try { await tryConnect(); } finally { connecting = false; }
}

async function tryConnect() {
  clearTimeout(connectTimer);
  const r = await call('read', { kind: 'journal', id: today() });
  if (!r.error) { started = true; el('setup').hidden = true; document.body.classList.remove('needs-setup'); start(r); return; }
  const setupStatus = await call('setupStatus');
  if (setupStatus.step === 'ready') { connectTimer = setTimeout(connect, 500); return; } // came up meanwhile
  document.body.classList.add('needs-setup');
  renderSetup(el('setup'), setupStatus, {
    onOpenURL: (url) => post({ action: 'openURL', url }),
    onOpenHeptabase: () => post({ action: 'openHeptabase' }),
    onCheck: connect,
  });
  connectTimer = setTimeout(connect, POLL_INTERVAL);
}

function start(r) {
  followToday = true;
  applyRemote(r, { keepSelection: false });
  view.dispatch(view.state.tr.setSelection(endOfText(view.state.doc)));
  view.focus();
  touchRecent(r);
  // Start at the end of the journal, ready to write; wait for Inter so the measurement holds.
  document.fonts.ready.then(() => view.dispatch(view.state.tr.scrollIntoView()));
  setInterval(poll, POLL_INTERVAL);
  // warm the cache with the first few Recent cards, so ⌘[ is instant from the start
  loadRecentList().then((list) => {
    let i = 0;
    for (let n = 0; n < 3; n++) { const t = nextShowable(list, i, 1); if (!t) break; prefetch(t); i = t.index + 1; }
  });
  window.addEventListener('focus', poll);
  // Mark images Heptabase couldn't hand over (e.g. not synced to this Mac yet) instead of a broken icon.
  document.addEventListener('error', (e) => {
    if (e.target.tagName === 'IMG' && e.target.closest('.ProseMirror')) e.target.classList.add('missing');
  }, true);
}

connect();
