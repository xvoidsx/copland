// copland renderer — panes, PTYs, and the leader key.
//
// Architecture: the main process owns every PTY (node-pty). Each pane here
// owns one xterm.js Terminal, rendered with the WebGL addon (GPU-backed)
// and falling back to the canvas renderer if WebGL is unavailable.
//
// Layout is a tiny tree: leaves hold terminals, splits hold two children.
// Splits re-render as nested flexbox. Focus, zoom, and kill walk the tree.
//
// Keybinds come from config/keybinds.json. The leader (default Alt+Space)
// arms on keydown; the next key selects a binding. Nothing here hardcodes
// the leader — change the JSON, not this file.

const { Terminal } = window;
const { FitAddon } = window;
const { WebglAddon } = window;

let keybinds = null;
let leaderArmed = false;
let leaderTimer = null;

const panesRoot = document.getElementById('panes');
const leaderIndicator = document.getElementById('leader-indicator');
const statusPanes = document.getElementById('status-panes');

// ---------- pane tree ----------

let focusedLeaf = null;

function makeLeaf() {
  const el = document.createElement('div');
  el.className = 'leaf';
  const holder = document.createElement('div');
  holder.className = 'xterm-holder';
  el.appendChild(holder);

  const term = new Terminal({
    theme: window.NIGHTSHADE_NEON,
    fontFamily: '"JetBrains Mono", "Noto Sans Mono", monospace',
    fontSize: 14,
    cursorBlink: true,
    cursorStyle: 'block',
    scrollback: 5000,
    allowProposedApi: true,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(holder);
  try {
    term.loadAddon(new WebglAddon.WebglAddon());
  } catch (e) {
    console.warn('copland: WebGL unavailable, using canvas renderer', e);
  }
  fit.fit();

  const leaf = { type: 'leaf', el, holder, term, fit, ptyId: null };
  term.onData((data) => {
    if (leaf.ptyId != null) window.copland.writePty(leaf.ptyId, data);
  });
  // spawn the shell once we know our size
  requestAnimationFrame(async () => {
    fit.fit();
    leaf.ptyId = await window.copland.spawnPty(term.cols, term.rows);
  });
  el.addEventListener('mousedown', () => focusLeaf(leaf));
  return leaf;
}

let tree = null;

function render() {
  panesRoot.innerHTML = '';
  if (!tree) return;
  panesRoot.appendChild(renderNode(tree));
  updateStatus();
}

function renderNode(node) {
  if (node.type === 'leaf') {
    node.el.style.flex = '';
    return node.el;
  }
  const el = document.createElement('div');
  el.className = 'split ' + node.dir;
  const aEl = renderNode(node.a);
  const bEl = renderNode(node.b);
  aEl.style.flex = `${node.sizes[0]} 1 0%`;
  bEl.style.flex = `${node.sizes[1]} 1 0%`;
  el.appendChild(aEl);
  el.appendChild(bEl);
  return el;
}

function focusLeaf(leaf) {
  if (focusedLeaf) focusedLeaf.el.classList.remove('focused');
  focusedLeaf = leaf;
  leaf.el.classList.add('focused');
  leaf.term.focus();
  updateStatus();
}

function forEachLeaf(node, fn) {
  if (node.type === 'leaf') fn(node);
  else { forEachLeaf(node.a, fn); forEachLeaf(node.b, fn); }
}

function leafCount() {
  let n = 0;
  forEachLeaf(tree, () => n++);
  return n;
}

function fitAll() {
  forEachLeaf(tree, (leaf) => {
    leaf.fit.fit();
    if (leaf.ptyId != null) {
      window.copland.resizePty(leaf.ptyId, leaf.term.cols, leaf.term.rows);
    }
  });
}

// Replace `target` leaf with a split containing it and a fresh leaf.
function splitLeaf(target, dir) {
  const fresh = makeLeaf();
  const split = { type: 'split', dir, a: target, b: fresh, sizes: [0.5, 0.5] };
  if (tree === target) {
    tree = split;
  } else {
    replaceNode(tree, target, split);
  }
  render();
  focusLeaf(fresh);
  // the new leaf needs a beat for layout before it measures itself
  requestAnimationFrame(() => fitAll());
}

function replaceNode(node, target, replacement) {
  if (node.type !== 'split') return false;
  if (node.a === target) { node.a = replacement; return true; }
  if (node.b === target) { node.b = replacement; return true; }
  return replaceNode(node.a, target, replacement) || replaceNode(node.b, target, replacement);
}

function killLeaf(target) {
  if (tree === target) return; // never kill the last pane
  if (target.ptyId != null) window.copland.killPty(target.ptyId);
  target.term.dispose();
  const sibling = findSibling(tree, target);
  if (tree.type === 'split' && (tree.a === target || tree.b === target)) {
    tree = sibling;
  } else {
    replaceNode(tree, findParent(tree, target), sibling);
  }
  render();
  if (sibling.type === 'leaf') focusLeaf(sibling);
  else forEachLeaf(sibling, (l) => { focusLeaf(l); return; });
  requestAnimationFrame(() => fitAll());
}

function findParent(node, target) {
  if (node.type !== 'split') return null;
  if (node.a === target || node.b === target) return node;
  return findParent(node.a, target) || findParent(node.b, target);
}

function findSibling(node, target) {
  const parent = findParent(node, target);
  if (!parent) return null;
  return parent.a === target ? parent.b : parent.a;
}

// leaves in visual (in-order) order — the basis for cycling and swapping
function orderedLeaves() {
  const out = [];
  forEachLeaf(tree, (l) => out.push(l));
  return out;
}

function focusNext() {
  const leaves = orderedLeaves();
  if (leaves.length < 2) return;
  const i = leaves.indexOf(focusedLeaf);
  focusLeaf(leaves[(i + 1) % leaves.length]);
}

// swap the focused pane with its prev/next neighbor in tree order
function swapFocused(dir) {
  const leaves = orderedLeaves();
  if (leaves.length < 2 || !focusedLeaf) return;
  const i = leaves.indexOf(focusedLeaf);
  const j = (i + dir + leaves.length) % leaves.length;
  const other = leaves[j];
  if (other === focusedLeaf) return;
  const pa = findParent(tree, focusedLeaf);
  const pb = findParent(tree, other);
  if (!pa || !pb) return;
  if (pa === pb) {
    const tmp = pa.a; pa.a = pa.b; pa.b = tmp;
  } else {
    if (pa.a === focusedLeaf) pa.a = other; else pa.b = other;
    if (pb.a === other) pb.a = focusedLeaf; else pb.b = focusedLeaf;
  }
  render();
  focusLeaf(focusedLeaf);
  requestAnimationFrame(() => fitAll());
}

// resize the focused pane: find the nearest ancestor split whose axis
// matches the direction, then shift the size fractions.
function resizeFocused(dir, delta = 0.06) {
  if (!focusedLeaf) return;
  const wantAxis = (dir === 'left' || dir === 'right') ? 'row' : 'col';
  let node = focusedLeaf;
  let parent = findParent(tree, node);
  while (parent && parent.dir !== wantAxis) {
    node = parent;
    parent = findParent(tree, node);
  }
  if (!parent) return;
  const side = parent.a === node ? 0 : 1;
  let d;
  if (parent.dir === 'row') {
    d = dir === 'right' ? (side === 0 ? delta : -delta)
                        : (side === 0 ? -delta : delta);
  } else {
    d = dir === 'down' ? (side === 0 ? delta : -delta)
                       : (side === 0 ? -delta : delta);
  }
  parent.sizes[0] = Math.min(0.9, Math.max(0.1, parent.sizes[0] + d));
  parent.sizes[1] = 1 - parent.sizes[0];
  render();
  requestAnimationFrame(() => fitAll());
}

// Directional focus: pick the leaf whose center is nearest in that direction.
function focusDir(dir) {
  const leaves = [];
  forEachLeaf(tree, (l) => leaves.push(l));
  if (leaves.length < 2 || !focusedLeaf) return;
  const r0 = focusedLeaf.el.getBoundingClientRect();
  const c0 = { x: r0.left + r0.width / 2, y: r0.top + r0.height / 2 };
  let best = null, bestScore = Infinity;
  for (const l of leaves) {
    if (l === focusedLeaf) continue;
    const r = l.el.getBoundingClientRect();
    const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const dx = c.x - c0.x, dy = c.y - c0.y;
    let primary, secondary;
    if (dir === 'left') { primary = -dx; secondary = Math.abs(dy); }
    else if (dir === 'right') { primary = dx; secondary = Math.abs(dy); }
    else if (dir === 'up') { primary = -dy; secondary = Math.abs(dx); }
    else { primary = dy; secondary = Math.abs(dx); }
    if (primary <= 4) continue;
    const score = secondary * 3 - primary;
    if (score < bestScore) { bestScore = score; best = l; }
  }
  if (best) focusLeaf(best);
}

function updateStatus() {
  statusPanes.textContent = leafCount() + (leafCount() === 1 ? ' pane' : ' panes');
}

// ---------- leader key ----------

function armLeader() {
  leaderArmed = true;
  leaderIndicator.classList.remove('hidden');
  clearTimeout(leaderTimer);
  leaderTimer = setTimeout(disarmLeader, keybinds?.leaderTimeoutMs || 1500);
}

function disarmLeader() {
  leaderArmed = false;
  clearTimeout(leaderTimer);
  leaderIndicator.classList.add('hidden');
}

function leaderMatches(e) {
  const L = keybinds.leader;
  const modsOk = (L.modifiers || []).every((m) =>
    (m === 'alt' && e.altKey) ||
    (m === 'ctrl' && e.ctrlKey) ||
    (m === 'shift' && e.shiftKey) ||
    (m === 'meta' && e.metaKey));
  const noExtra =
    (L.modifiers.includes('alt') || !e.altKey) &&
    (L.modifiers.includes('ctrl') || !e.ctrlKey) &&
    (L.modifiers.includes('shift') || !e.shiftKey) &&
    (L.modifiers.includes('meta') || !e.metaKey);
  return modsOk && noExtra && e.key === L.key;
}

const ACTIONS = {
  'split-horizontal': () => focusedLeaf && splitLeaf(focusedLeaf, 'col'),
  'split-vertical': () => focusedLeaf && splitLeaf(focusedLeaf, 'row'),
  'focus-up': () => focusDir('up'),
  'focus-down': () => focusDir('down'),
  'focus-left': () => focusDir('left'),
  'focus-right': () => focusDir('right'),
  'focus-next': () => focusNext(),
  'swap-prev': () => swapFocused(-1),
  'swap-next': () => swapFocused(1),
  'resize-up': () => resizeFocused('up'),
  'resize-down': () => resizeFocused('down'),
  'resize-left': () => resizeFocused('left'),
  'resize-right': () => resizeFocused('right'),
  'kill-pane': () => focusedLeaf && killLeaf(focusedLeaf),
  'zoom-pane': () => {
    if (!focusedLeaf) return;
    focusedLeaf.el.classList.toggle('zoomed');
    requestAnimationFrame(() => fitAll());
  },
};

// "Shift+ArrowUp", "Ctrl+h", "x" — modifiers in canonical order, then the key.
// shift is dropped for single printable chars: typing "{" already holds
// shift, so "Shift+{" would never match a "{" binding.
// While the leader is armed, the leader's own modifiers are transparent:
// holding Alt through "leader, Alt+ArrowUp" computes "ArrowUp", so both
// the release-it and hold-it styles work.
function keyCombo(e) {
  const parts = [];
  const isChar = e.key.length === 1;
  const transparent = (leaderArmed && keybinds && keybinds.leader.modifiers) || [];
  if (e.ctrlKey && !transparent.includes('ctrl')) parts.push('Ctrl');
  if (e.altKey && !transparent.includes('alt')) parts.push('Alt');
  if (e.shiftKey && !isChar && !transparent.includes('shift')) parts.push('Shift');
  if (e.metaKey && !transparent.includes('meta')) parts.push('Meta');
  parts.push(isChar ? e.key.toLowerCase() : e.key);
  return parts.join('+');
}

// Ctrl+Shift+C copies the focused pane's selection to the clipboard.
// Ctrl+Shift+V pastes the clipboard into the focused pane. Both are global
// chords, independent of the leader — the terminal shortcuts nobody wants
// to arm a leader for.
async function copyFromFocused() {
  if (!focusedLeaf || !focusedLeaf.term) return;
  try {
    const text = focusedLeaf.term.getSelection();
    if (text) await navigator.clipboard.writeText(text);
  } catch (err) {
    console.warn('copland: clipboard write failed', err);
  }
}

async function pasteToFocused() {
  if (!focusedLeaf || focusedLeaf.ptyId == null) return;
  try {
    const text = await navigator.clipboard.readText();
    if (text) window.copland.writePty(focusedLeaf.ptyId, text);
  } catch (err) {
    console.warn('copland: clipboard read failed', err);
  }
}

window.addEventListener('keydown', (e) => {
  if (!keybinds) return;
  if (e.code === 'KeyC' && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    e.stopPropagation();
    if (leaderArmed) disarmLeader();
    copyFromFocused();
    return;
  }
  if (e.code === 'KeyV' && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    e.stopPropagation();
    if (leaderArmed) disarmLeader();
    pasteToFocused();
    return;
  }
  if (!leaderArmed && leaderMatches(e)) {
    e.preventDefault();
    e.stopPropagation();
    armLeader();
    return;
  }
  if (leaderArmed) {
    // auto-repeat while armed (a held leader key, a held arrow) must not
    // disarm the leader or leak repeats into the terminal.
    if (e.repeat) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Bare modifier keydowns (the Shift in Shift+Arrow) are part of a chord,
    // not a binding — swallow them but keep the leader armed for the real key.
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const action = keybinds.bindings[keyCombo(e)];
    disarmLeader();
    if (action && ACTIONS[action]) {
      e.preventDefault();
      e.stopPropagation();
      ACTIONS[action]();
    }
    // unbound key: leader cancels, key passes through to the terminal
  }
}, true);

window.addEventListener('resize', () => fitAll());

// ---------- PTY plumbing ----------

window.copland.onPtyData((id, data) => {
  forEachLeaf(tree, (leaf) => {
    if (leaf.ptyId === id) leaf.term.write(data);
  });
});

window.copland.onPtyExit((id) => {
  forEachLeaf(tree, (leaf) => {
    if (leaf.ptyId === id) {
      leaf.term.write('\r\n\x1b[38;2;255;49;49m[process exited]\x1b[0m\r\n');
      leaf.ptyId = null;
    }
  });
});

// ---------- boot ----------

(async function boot() {
  try {
    keybinds = await window.copland.loadKeybinds();
  } catch (e) {
    console.error('copland: could not load keybinds', e);
    keybinds = { leader: { key: ' ', modifiers: ['alt'] }, leaderTimeoutMs: 1500, bindings: {} };
  }
  tree = makeLeaf();
  render();
  focusLeaf(tree);
  requestAnimationFrame(() => fitAll());
})();
