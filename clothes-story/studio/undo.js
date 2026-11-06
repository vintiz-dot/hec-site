// Per-sheet undo (section 4.10). Patches are small canvases, never ImageData, so paint is never read back (invariant 5).
// An item holds one patch: `before` while it can be undone, `after` while it can be redone. The other side is captured
// from paint at that moment, so undoing costs no extra memory and the budget only needs enforcing on a new commit.
import { LIMITS } from './constants.js?v=1';
import { emit, on } from './bus.js?v=1';
import { log } from './diag.js?v=1';
import * as engine from './engine.js?v=1';
import { get as getState } from './state.js?v=1';

const FADE_MS = 120;
const FADE_MARGIN_MS = 60;

const stacks = new Map();  // sheet -> { undo: Item[], redo: Item[] }. undo[0] is the oldest step, redo[0] the farthest.
const fading = new Set();  // patches engine.fadeOut may still be drawing
let queue = Promise.resolve();
let seq = 0;

// The contract gives this module no init, and a bus subscription touches nothing outside it.
on('ink:commit', onCommit);
on('page:shown', publish);
on('studio:exit', reset);

function stackOf(sheet) {
  let st = stacks.get(sheet);
  if (!st) stacks.set(sheet, st = { undo: [], redo: [] });
  return st;
}

const bytesOf = patch => patch.canvas.width * patch.canvas.height * 4;

// Drawing a zero-size canvas throws, so a patch in mid-fade is released when its fade is over.
function free(patch) {
  if (!patch?.canvas) return;
  if (fading.has(patch)) { setTimeout(() => free(patch), FADE_MS + FADE_MARGIN_MS); return; }
  patch.canvas.width = 0;
  patch.canvas.height = 0;
}

const discard = item => { free(item.before); free(item.after); };

function fade(patch) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  fading.add(patch);
  setTimeout(() => fading.delete(patch), FADE_MS + FADE_MARGIN_MS);
  engine.fadeOut(patch, FADE_MS);
}

// Backing px in, backing px out, so the rect always matches the patch it will replace.
function grab(rect) {
  const canvas = document.createElement('canvas');
  canvas.width = rect.w;
  canvas.height = rect.h;
  canvas.getContext('2d').drawImage(engine.paintCanvas(), -rect.x, -rect.y);
  return { rect, canvas };
}

function totalBytes() {
  let total = 0;
  for (const st of stacks.values()) for (const list of [st.undo, st.redo]) for (const item of list) total += item.bytes;
  return total;
}

// Other pages first, redo before undo, because redo is only offered right after an undo on the page in front.
function nextVictim(active) {
  let oldest = null;
  for (const [sheet, st] of stacks) {
    if (sheet === active) continue;
    if (st.redo.length) return st.redo;
    if (st.undo.length && (!oldest || st.undo[0].seq < oldest[0].seq)) oldest = st.undo;
  }
  if (oldest) return oldest;
  const here = stackOf(active);
  return here.undo.length > LIMITS.undoMinSteps ? here.undo : null;
}

function enforceBudget(active) {
  let total = totalBytes();
  while (total > LIMITS.undoBytes) {
    const list = nextVictim(active);
    if (!list) return;  // the floor of steps on the active sheet wins over the budget
    const item = list.shift();
    total -= item.bytes;
    discard(item);
  }
}

function onCommit({ sheet, id, rect, before }) {
  if (!before?.canvas) { log('undo', 'commit without a before patch'); return; }
  const st = stackOf(sheet);
  for (const item of st.redo.splice(0)) discard(item);
  st.undo.push({ id, seq: ++seq, sheet, rect, before, after: null, bytes: bytesOf(before) });
  enforceBudget(sheet);
  publish();
}

export function pushCustom(sheet, custom) {
  const st = stackOf(sheet);
  for (const item of st.redo.splice(0)) discard(item);
  st.undo.push({ id: null, seq: ++seq, sheet, custom, bytes: 0 });
  publish();
}

function publish() {
  emit('undo:state', { canUndo: canUndo(), canRedo: canRedo() });
}

async function move(dir) {
  await engine.flush();
  if (engine.isStroking() || getState('readOnly')) return;  // the eraser works directly on paint, so a restore would fight it
  const sheet = engine.activeSheet();
  const st = stackOf(sheet);
  const [from, to, want, have] = dir < 0 ? [st.undo, st.redo, 'before', 'after'] : [st.redo, st.undo, 'after', 'before'];
  const item = from[from.length - 1];
  if (!item) return;
  if (item.custom) { // a sticker change: no pixels to restore
    from.pop();
    (dir < 0 ? item.custom.undo : item.custom.redo)();
    to.push(item);
    emit('undo:applied', { sheet, id: null, dir });
    publish();
    return;
  }
  const target = item[want];
  const current = grab(target.rect);
  engine.restore(target);
  from.pop();
  free(target);
  item[want] = null;
  item[have] = current;
  to.push(item);
  fade(current);
  emit('undo:applied', { sheet, id: item.id, dir });
  publish();
}

// Holding the button repeats faster than a flush can answer, so steps run strictly one after another.
function enqueue(dir) {
  queue = queue.then(() => move(dir)).catch(err => log('undo', err.message));
  return queue;
}

export const undo = () => enqueue(-1);
export const redo = () => enqueue(1);

export function canUndo() { return stackOf(engine.activeSheet()).undo.length > 0; }
export function canRedo() { return stackOf(engine.activeSheet()).redo.length > 0; }

export function reset() {
  for (const st of stacks.values()) for (const list of [st.undo, st.redo]) for (const item of list.splice(0)) discard(item);
  stacks.clear();
  publish();
}

// Budget figures for the test suite and diag.
export function stats() {
  const steps = {};
  for (const [sheet, st] of stacks) steps[sheet] = { undo: st.undo.length, redo: st.redo.length };
  return { bytes: totalBytes(), steps };
}
