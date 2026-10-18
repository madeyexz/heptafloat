// Editing commands for Heptabase's flat list items: each item holds its line plus nested blocks.

import { AllSelection, TextSelection } from 'prosemirror-state';
import { setBlockType, wrapIn } from 'prosemirror-commands';
import { closeHistory } from 'prosemirror-history';
import { LIST_ITEMS } from './schema.js';

export const isItem = (n) => LIST_ITEMS.includes(n.type.name);

/** Cursor is in the first child (the "line") of a list item. Returns the item depth or -1. */
export function itemLineDepth($pos) {
  return $pos.depth >= 2 && isItem($pos.node(-1)) && $pos.index(-1) === 0 ? $pos.depth - 1 : -1;
}

function freshAttrs(type, from) {
  switch (type.name) {
    case 'todo_list_item': return { checked: false };
    case 'toggle_list_item': return { folded: false };
    default: return { format: from?.type === type ? from.attrs.format : undefined };
  }
}

/**
 * What Tab moves for a position: the list item when the cursor is on its line, a paragraph when
 * it's top level or a child of an item, otherwise the item around it. Returns a depth or -1.
 */
function unitDepth($pos) {
  const d = $pos.depth;
  if (!$pos.parent.isTextblock) return -1;
  for (let k = d; k > 0; k--) if (/^table_(cell|header)$/.test($pos.node(k).type.name)) return -1;
  if (d >= 2 && isItem($pos.node(d - 1)) && $pos.index(d - 1) === 0) return d - 1;
  if ($pos.parent.type.name === 'paragraph' && (d === 1 || isItem($pos.node(d - 1)))) return d;
  return itemAbove($pos, d);
}

const itemAbove = ($pos, d) => { for (d--; d > 0; d--) if (isItem($pos.node(d))) return d; return -1; };

/**
 * The selected blocks Tab acts on, as siblings: { depth, from, to } (child indexes in the parent at
 * depth - 1). A selection across levels is widened to the items that hold both ends.
 */
function selectedUnits({ $from, $to }) {
  let a = unitDepth($from), b = unitDepth($to);
  while (a > 0 && b > 0 && (a !== b || $from.start(a - 1) !== $to.start(a - 1))) {
    if (a >= b) a = itemAbove($from, a);
    if (b > a) b = itemAbove($to, b);
  }
  return a > 0 && b > 0 ? { depth: a, from: $from.index(a - 1), to: $to.index(a - 1) } : null;
}

/** A paragraph that can't move on its own moves with the item it's in. */
function orItemAround(cmd) {
  return (state, dispatch) => {
    const u = selectedUnits(state.selection);
    if (!u) return false;
    if (cmd(state, dispatch, u)) return true;
    const { $from } = state.selection;
    if (u.from !== u.to || isItem($from.node(u.depth)) || !isItem($from.node(u.depth - 1))) return false;
    return cmd(state, dispatch, { depth: u.depth - 1, from: $from.index(u.depth - 2), to: $from.index(u.depth - 2) });
  };
}

/** Child index → document position, in the parent at `depth - 1` of the selection's $from. */
const childPos = ($from, depth, index) => {
  let pos = $from.start(depth - 1);
  for (let i = 0; i < index; i++) pos += $from.node(depth - 1).child(i).nodeSize;
  return pos;
};

/** Tab: the selected items (with their children) become the last children of the item above. */
export const sink = orItemAround((state, dispatch, { depth, from, to }) => {
  const { $from } = state.selection;
  const parent = $from.node(depth - 1), prev = from > 0 && parent.child(from - 1);
  if (!prev || !isItem(prev)) return false;
  if (dispatch) {
    const start = childPos($from, depth, from), end = childPos($from, depth, to + 1);
    const tr = state.tr.delete(start, end).insert(start - 1, state.doc.slice(start, end).content);
    if (prev.attrs.folded) tr.setNodeAttribute(start - prev.nodeSize, 'folded', false);
    const { anchor, head } = state.selection;
    tr.setSelection(TextSelection.create(tr.doc, anchor - 1, head - 1));
    dispatch(closeHistory(tr).scrollIntoView());
  }
  return true;
});

/**
 * Shift-Tab: the selected items move out of their parent item, right after it. Later siblings
 * become children of the last moved item, as in an outliner.
 */
export const lift = orItemAround((state, dispatch, { depth, from, to }) => {
  const { $from } = state.selection;
  const parent = $from.node(depth - 1);
  if (depth < 2 || from === 0 || !isItem(parent)) return false;
  const last = parent.child(to), rest = parent.content.cut(childPos($from, depth, to + 1) - $from.start(depth - 1));
  if (rest.size && !isItem(last)) return false;
  if (dispatch) {
    const start = childPos($from, depth, from), lastStart = childPos($from, depth, to);
    const moved = state.doc.slice(start, lastStart).content.addToEnd(rest.size ? last.copy(last.content.append(rest)) : last);
    const tr = state.tr.delete(start, $from.end(depth - 1));
    const insertAt = tr.mapping.map($from.after(depth - 1));
    tr.insert(insertAt, moved);
    const { anchor, head } = state.selection;
    tr.setSelection(TextSelection.create(tr.doc, insertAt + anchor - start, insertAt + head - start));
    dispatch(closeHistory(tr).scrollIntoView());
  }
  return true;
});

/** Turns an item back into its plain blocks, where it is. */
export function unwrap(state, dispatch) {
  const { $from } = state.selection;
  const d = itemLineDepth($from);
  if (d < 0) return false;
  if (dispatch) {
    const start = $from.before(d), item = $from.node(d);
    const tr = state.tr.replaceWith(start, $from.after(d), item.content);
    tr.setSelection(TextSelection.create(tr.doc, start + 1 + $from.parentOffset));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

const joinable = (n) => n.type.name === 'paragraph' || n.type.name === 'heading';

/** End of the last line you can see in a block (folded children don't count), or null. */
function lastLineEnd(node, pos) {
  if (node.isTextblock) return joinable(node) ? pos + node.nodeSize - 1 : null;
  if (!isItem(node)) return null;
  const last = node.attrs.folded ? node.firstChild : node.lastChild;
  return lastLineEnd(last, node.attrs.folded ? pos + 1 : pos + node.nodeSize - 1 - last.nodeSize);
}

/**
 * Moves the line starting at `l2Start` onto the end of the line ending at `l1End` (the line above
 * it on screen). When that line is a list item's, the item goes too: its children move under the
 * item before it, keeping their indent, or take its place if there's none.
 */
function joinLines(state, dispatch, l1End, l2Start) {
  const $l2 = state.doc.resolve(l2Start), line = $l2.parent, target = state.doc.resolve(l1End).parent;
  if (!joinable(target) || !target.type.validContent(target.content.append(line.content))) return false;
  if (dispatch) {
    const tr = state.tr, d = itemLineDepth($l2);
    if (d >= 0) {
      const item = $l2.node(d), start = $l2.before(d), idx = $l2.index(d - 1);
      const prev = idx > 0 && $l2.node(d - 1).child(idx - 1), rest = item.content.cut(line.nodeSize);
      tr.delete(start, start + item.nodeSize);
      if (rest.size && prev && isItem(prev)) {
        tr.insert(start - 1, rest);
        if (prev.attrs.folded) tr.setNodeAttribute(start - prev.nodeSize, 'folded', false);
      } else if (rest.size) tr.insert(start, rest);
    } else {
      tr.delete($l2.before(), $l2.after());
    }
    tr.insert(l1End, line.content); // everything changed so far comes after l1End
    tr.setSelection(TextSelection.create(tr.doc, l1End));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/**
 * Backspace at the start of a line: a list item becomes plain text where it is (as in Heptabase
 * and Notion); a plain line right below a list item joins the last line above it.
 */
export function backspaceAtItemStart(state, dispatch) {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset > 0) return false;
  if (itemLineDepth($from) >= 0) return unwrap(state, dispatch);
  const d = $from.depth, idx = $from.index(d - 1);
  if (!joinable($from.parent) || idx === 0 || !(d === 1 || isItem($from.node(d - 1)))) return false;
  const prev = $from.node(d - 1).child(idx - 1);
  if (!isItem(prev)) return false;
  const end = lastLineEnd(prev, $from.before() - prev.nodeSize);
  return end != null && joinLines(state, dispatch, end, $from.pos);
}

/** Delete at the end of a line pulls up the next line you can see, whatever its indent. */
export function deleteAtLineEnd(state, dispatch) {
  const { $from, empty } = state.selection;
  if (!empty || !joinable($from.parent) || $from.parentOffset < $from.parent.content.size) return false;
  const d = itemLineDepth($from);
  let next = null, pos;
  if (d >= 0 && $from.node(d).childCount > 1 && !$from.node(d).attrs.folded) {
    next = $from.node(d).child(1); pos = $from.after();
  } else {
    for (let k = d >= 0 ? d : $from.depth; k >= 1 && !next; k--) {
      const parent = $from.node(k - 1);
      if (k > 1 && !isItem(parent)) return false; // in a quote, table…: the default
      if ($from.index(k - 1) + 1 < parent.childCount) { next = parent.child($from.index(k - 1) + 1); pos = $from.after(k); }
    }
  }
  if (!next) return false;
  const l2Start = isItem(next) ? joinable(next.firstChild) && pos + 2 : joinable(next) && pos + 1;
  return !!l2Start && joinLines(state, dispatch, $from.pos, l2Start);
}

export function enterInItem(state, dispatch, view) {
  const { $from, $to, empty } = state.selection;
  if (!empty && view && itemLineDepth($from) >= 0 && $to.parent.isTextblock) {
    view.dispatch(state.tr.deleteSelection());
    return enterInItem(view.state, view.dispatch);
  }
  const d = itemLineDepth($from);
  if (!empty || d < 0) return false;
  const item = $from.node(d), line = $from.parent;
  if (line.content.size === 0 && item.childCount === 1) return lift(state, dispatch) || unwrap(state, dispatch);
  if (dispatch) {
    const off = $from.parentOffset;
    const newLine = (line.type.name === 'heading' ? state.schema.nodes.paragraph : line.type).create(null, line.content.cut(off));
    const newItem = item.type.create(freshAttrs(item.type, item), newLine);
    const lineStart = $from.before(), lineEnd = $from.after();
    const tr = state.tr.replaceWith(lineStart, lineEnd, line.copy(line.content.cut(0, off)));
    // With visible children, the new line becomes the first child; otherwise the next sibling.
    const asChild = item.childCount > 1 && !item.attrs.folded;
    const at = asChild ? tr.mapping.map(lineEnd) : tr.mapping.map($from.after(d));
    tr.insert(at, newItem);
    tr.setSelection(TextSelection.create(tr.doc, at + 2));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

export function setChecked(tr, pos, node, checked) {
  const now = new Date().toISOString();
  return tr.setNodeMarkup(pos, null, { ...node.attrs, checked, lastCheckedTime: checked ? now : null, lastUpdatedTime: now });
}

export function toggleTodo(state, dispatch) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'todo_list_item') {
      if (dispatch) dispatch(setChecked(state.tr, $from.before(d), n, !n.attrs.checked));
      return true;
    }
  }
  return false;
}

/**
 * Converts the block at the cursor into `name` (paragraph, heading, code_block, a list item, or
 * blockquote), the way Heptabase's "/" menu does. Runs as a sequence of view dispatches.
 */
export function turnInto(view, name, attrs = null) {
  const run = (cmd) => cmd(view.state, view.dispatch);
  const { schema } = view.state;
  const type = schema.nodes[name];
  const d = itemLineDepth(view.state.selection.$from);

  if (LIST_ITEMS.includes(name)) {
    if (d >= 0) {
      const $from = view.state.selection.$from, item = $from.node(d);
      if (name !== 'toggle_list_item' && $from.parent.type.name !== 'paragraph') run(setBlockType(schema.nodes.paragraph));
      view.dispatch(view.state.tr.setNodeMarkup($from.before(d), type, { ...freshAttrs(type, item), ...attrs, id: item.attrs.id }));
    } else {
      if (view.state.selection.$from.parent.type.name !== 'paragraph') run(setBlockType(schema.nodes.paragraph));
      run(wrapIn(type, { ...freshAttrs(type), ...attrs }));
    }
    return;
  }
  if (name === 'blockquote') { run(wrapIn(type)); return; }
  if (d >= 0) run(unwrap);
  run(setBlockType(type, attrs));
}

export function insertBlock(view, name) {
  const { schema, selection } = view.state;
  const $from = selection.$from;
  const node = schema.nodes[name].create();
  const tr = view.state.tr;
  if ($from.parent.content.size === 0 && $from.depth === 1) {
    tr.replaceWith($from.before(), $from.after(), [node, schema.nodes.paragraph.create()]);
    tr.setSelection(TextSelection.create(tr.doc, $from.before() + node.nodeSize + 1));
  } else {
    tr.insert($from.after(1), [node, schema.nodes.paragraph.create()]);
    tr.setSelection(TextSelection.create(tr.doc, $from.after(1) + node.nodeSize + 1));
  }
  view.dispatch(tr.scrollIntoView());
}

/**
 * ⌘A, like Heptabase: the first press selects the text of the block the cursor is in; when that's
 * already selected (or the selection spans blocks), it selects the whole card.
 */
export function selectBlock(state, dispatch) {
  const { $from, $to } = state.selection;
  if ($from.parent.isTextblock && $from.sameParent($to)) {
    const start = $from.start(), end = $from.end();
    if ($from.pos > start || $to.pos < end) {
      dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, start, end)));
      return true;
    }
  }
  dispatch?.(state.tr.setSelection(new AllSelection(state.doc)));
  return true;
}
