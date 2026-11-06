// Stickers as objects, like elements in a design tool: tap to select, drag, resize, rotate, delete, recolour, at any time.
// Each one is an <img> in its sheet, above the ink and under the printed words. Its picture is kept as a data URL in meta, so
// reload, print and the reading view need no drawing code. A stroke that starts on a sticker becomes part of that sticker.
import { SHEET_H, SHEET_W, STORAGE, swatch as swatchById } from './constants.js?v=1';
import { emit, on } from './bus.js?v=1';
import { log } from './diag.js?v=1';
import * as engine from './engine.js?v=1';
import * as fill from './fill.js?v=1';
import * as fx from './fx.js?v=1';
import { sticker as artOf } from './sticker-art.js?v=1';
import * as state from './state.js?v=1';
import * as stickers from './stickers.js?v=1';
import * as store from './store.js?v=1';
import * as targets from './targets.js?v=1';
import * as undo from './undo.js?v=1';
import * as viewport from './viewport.js?v=1';

const UNITS = 240, PAD = 10, FULL = UNITS + 2 * PAD; // the art is drawn 240 sheet px wide, whatever size it shows at
const ART_SCALE = UNITS / 96;
const MIN_SIZE = 44, MAX_SIZE = 460;
const HANDLE_HIT_PX = 27;
const SNAP_ROT = .07;
const REVEAL_MS = 640;
const SAFE_PNG = /^data:image\/(png|webp);base64,/;

let list = [];        // bottom to top
let selected = null;
let grab = null;      // { kind, o, before, ... }
let selEl = null;
let seq = 0;
let probe = null;

const paths = new Map();
const pathOf = d => { let p = paths.get(d); if (!p) paths.set(d, p = new Path2D(d)); return p; };
const sheetEl = n => document.querySelector(`.sheet[data-sheet="${n}"]`);
const reduced = () => matchMedia('(prefers-reduced-motion:reduce)').matches;
const rec = ({ el, top, ...data }) => ({ ...data });
const shownSize = o => o.size * FULL / UNITS;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  return c;
}

function save() {
  store.saveMeta({ objects: list.map(rec) });
  try { if (list.length) localStorage.setItem(STORAGE.hasWork, '1'); } catch { /* private window */ }
}

// ---- drawing the picture ----

function render(o) {
  const S = engine.scale();
  const c = canvas(FULL * S, FULL * S);
  const x = c.getContext('2d');
  const mark = { sticker: o.sticker, x: PAD, y: PAD, s: ART_SCALE };
  if (o.swatch) {
    const made = fill.cloth(mark, o.swatch, o.seed, { x: 0, y: 0, w: FULL, h: FULL });
    if (made) x.drawImage(made.final, made.b.x, made.b.y);
  }
  x.save();
  stickers.paintSolid(x, mark, S);
  stickers.paintLines(x, mark, S);
  x.restore();
  return c.toDataURL('image/webp', .92);
}

function makeEl(o) {
  const el = new Image();
  el.className = 'st-obj';
  el.alt = '';
  el.draggable = false;
  el.src = o.png;
  o.el = el;
  sheetEl(o.sheet)?.append(el);
  layout(o);
}

function layout(o) {
  const w = shownSize(o);
  o.el.style.width = o.el.style.height = w + 'px';
  o.el.style.transform = `translate(${o.cx - w / 2}px,${o.cy - w / 2}px) rotate(${o.rot}rad)`;
  if (o.top) { o.top.style.cssText += `;width:${w}px;height:${w}px;transform:${o.el.style.transform}`; }
}

// ---- selection frame: pictures only, every press goes through pointerDown below ----

function syncSel() {
  const o = selected;
  if (!o) { selEl?.remove(); return; }
  if (!selEl) {
    selEl = document.createElement('div');
    selEl.id = 'st-sel';
    selEl.setAttribute('aria-hidden', 'true');
    selEl.innerHTML = '<i class="del">×</i><i class="rot">↻</i><i class="siz">⤡</i>';
  }
  const host = sheetEl(o.sheet);
  if (selEl.parentNode !== host) host?.append(selEl);
  selEl.style.width = selEl.style.height = o.size + 'px';
  selEl.style.transform = `translate(${o.cx - o.size / 2}px,${o.cy - o.size / 2}px) rotate(${o.rot}rad)`;
  selEl.style.setProperty('--k', String(1 / (viewport.z() || 1)));
}

function handlePos(o, kind) {
  const h = o.size / 2;
  const [lx, ly] = kind === 'del' ? [-h, -h] : kind === 'rot' ? [h, -h] : [h, h];
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  return { x: o.cx + lx * c - ly * s, y: o.cy + lx * s + ly * c };
}

function toLocal(o, p) {
  const dx = p.x - o.cx, dy = p.y - o.cy, c = Math.cos(-o.rot), s = Math.sin(-o.rot);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

const inSquare = (o, p) => { const l = toLocal(o, p); return Math.abs(l.x) <= o.size / 2 && Math.abs(l.y) <= o.size / 2; };

export function at(pt, sheet = engine.activeSheet()) {
  probe ??= document.createElement('canvas').getContext('2d');
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i], art = artOf(o.sticker);
    if (o.sheet !== sheet || !art) continue;
    const l = toLocal(o, pt), k = 96 / o.size;
    if (probe.isPointInPath(pathOf(art.outline), l.x * k + 48, l.y * k + 48)) return o;
  }
  return null;
}

export const current = () => selected;

export function select(o) {
  const next = o ?? null;
  if (selected !== next) {
    selected = next;
    if (next) { // on top, the way a design tool brings forward what you touch
      list.splice(list.indexOf(next), 1);
      list.push(next);
      sheetEl(next.sheet)?.append(next.el);
      if (next.top) next.el.after(next.top);
    }
    emit('object:select', { id: next?.id ?? null });
  }
  syncSel();
}

// ---- changes, each one undoable ----

function restore(id, data) {
  let o = list.find(k => k.id === id);
  if (!data) { if (o) drop(o); return; }
  if (!o) {
    o = { ...data };
    list.push(o);
    makeEl(o);
  } else {
    const { el } = o;
    Object.assign(o, data);
    o.el = el;
    if (el.getAttribute('src') !== o.png) el.src = o.png;
    layout(o);
  }
  syncSel();
}

function drop(o) {
  if (selected === o) select(null);
  o.top?.remove();
  o.el.remove();
  list = list.filter(k => k !== o);
}

function changed(sheet, id, before, after) {
  undo.pushCustom(sheet, {
    undo() { restore(id, before); save(); },
    redo() { restore(id, after); save(); },
  });
  save();
}

export function add({ sticker, cx, cy, size, sheet = engine.activeSheet(), selectIt = true, rot = 0 }) {
  if (!artOf(sticker)) return null;
  const id = Date.now().toString(36) + (++seq);
  const o = { id, sheet, sticker, cx, cy, size, rot, swatch: null, seed: (seq * 37) % 911, png: '' };
  o.png = render(o);
  list.push(o);
  makeEl(o);
  changed(sheet, id, null, rec(o));
  const box = targets.boxAt(sheet, { x: cx, y: cy });
  if (box) targets.setHasInk(box, true);
  emit('object:added', { sheet, rect: { x: cx - 1, y: cy - 1, w: 2, h: 2 }, tool: 'stickers', swatchId: sticker, stickerId: sticker });
  if (selectIt) select(o);
  return o;
}

function reveal(o, png, pt) {
  o.top?.remove();
  o.top = null;
  if (reduced()) { o.el.src = png; return; }
  const l = pt ? toLocal(o, pt) : { x: 0, y: 0 };
  const w = shownSize(o), px = (l.x / w + .5) * 100, py = (l.y / w + .5) * 100;
  const top = new Image();
  top.className = 'st-obj';
  top.alt = '';
  top.src = png;
  top.style.cssText = `width:${w}px;height:${w}px;transform:${o.el.style.transform};clip-path:circle(0% at ${px}% ${py}%);transition:clip-path ${REVEAL_MS}ms cubic-bezier(.3,.7,.3,1)`;
  o.el.after(top);
  o.top = top;
  const open = () => {
    top.getBoundingClientRect();
    top.style.clipPath = `circle(150% at ${px}% ${py}%)`;
    setTimeout(() => {
      if (o.top !== top) { top.remove(); return; }
      o.el.src = o.png;
      o.top = null;
      setTimeout(() => top.remove(), 80);
    }, REVEAL_MS + 40);
  };
  top.decode().then(open, open);
}

export function pour(o, swatchId, pt) {
  if (!o || !swatchById(swatchId) || state.get('readOnly')) return false;
  try {
    const before = rec(o);
    o.swatch = swatchId;
    o.seed = (o.seed + 13) % 911;
    o.png = render(o);
    reveal(o, o.png, pt);
    changed(o.sheet, o.id, before, rec(o));
    const c = viewport.toClient(o.cx, o.cy);
    fx.sparkle(c.x, c.y);
    emit('object:poured', { id: o.id });
    return true;
  } catch (err) {
    log('objects', 'pour: ' + err.message);
    return false;
  }
}

// A stroke that begins on a sticker and stays near it goes onto the sticker, clipped to its shape, and moves with it.
export function sinkFor(o) {
  if (!o) return null;
  return {
    accepts(rect) {
      const h = o.size * .65;
      return rect.x >= o.cx - h && rect.y >= o.cy - h && rect.x + rect.w <= o.cx + h && rect.y + rect.h <= o.cy + h;
    },
    take(src, S) { decorate(o, src, S).catch(err => log('objects', 'decorate: ' + err.message)); },
  };
}

async function decorate(o, src, S) {
  const before = rec(o);
  const art = artOf(o.sticker);
  const img = new Image();
  img.src = o.png;
  await img.decode();
  const R = FULL * S, c = canvas(R, R), x = c.getContext('2d');
  x.drawImage(img, 0, 0, R, R);
  x.setTransform(ART_SCALE * S, 0, 0, ART_SCALE * S, PAD * S, PAD * S);
  x.clip(pathOf(art.outline));
  const k = UNITS / o.size * S;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.translate(R / 2, R / 2);
  x.scale(k, k);
  x.rotate(-o.rot);
  x.translate(-o.cx, -o.cy);
  x.drawImage(src, 0, 0, src.width / S, src.height / S);
  src.width = src.height = 0;
  o.png = c.toDataURL('image/webp', .92);
  o.el.src = o.png;
  changed(o.sheet, o.id, before, rec(o));
}

// ---- pointer, called by tools.js ----

export function pointerDown(pt) {
  const o = selected;
  if (o && o.sheet === engine.activeSheet()) {
    const r = HANDLE_HIT_PX / (viewport.z() || 1);
    for (const kind of ['del', 'rot', 'siz']) {
      const h = handlePos(o, kind);
      if (Math.hypot(pt.x - h.x, pt.y - h.y) <= r) {
        grab = { kind, o, before: rec(o), d0: Math.max(1, Math.hypot(pt.x - o.cx, pt.y - o.cy)), size0: o.size, a0: Math.atan2(pt.y - o.cy, pt.x - o.cx), rot0: o.rot };
        return true;
      }
    }
    if (inSquare(o, pt)) {
      grab = { kind: 'move', o, before: rec(o), dx: pt.x - o.cx, dy: pt.y - o.cy };
      return true;
    }
    return false;
  }
  if (state.get('tool') === 'stickers') {
    const hit = at(pt);
    if (hit) {
      select(hit);
      grab = { kind: 'move', o: hit, before: rec(hit), dx: pt.x - hit.cx, dy: pt.y - hit.cy };
      return true;
    }
  }
  return false;
}

export function pointerMove(pt) {
  const g = grab;
  if (!g) return;
  const o = g.o;
  if (g.kind === 'move') {
    o.cx = Math.max(0, Math.min(SHEET_W, pt.x - g.dx));
    o.cy = Math.max(0, Math.min(SHEET_H, pt.y - g.dy));
  } else if (g.kind === 'siz') {
    o.size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, g.size0 * Math.hypot(pt.x - o.cx, pt.y - o.cy) / g.d0));
  } else if (g.kind === 'rot') {
    const r = g.rot0 + Math.atan2(pt.y - o.cy, pt.x - o.cx) - g.a0;
    o.rot = Math.abs(Math.sin(r)) < SNAP_ROT && Math.cos(r) > 0 ? 0 : r;
  } else {
    return;
  }
  layout(o);
  syncSel();
}

export function pointerUp(pt, wasTap) {
  const g = grab;
  grab = null;
  if (!g) return;
  const o = g.o;
  if (g.kind === 'del') {
    if (wasTap) {
      drop(o);
      changed(o.sheet, o.id, g.before, null);
    }
    return;
  }
  if (wasTap && g.kind === 'move' && state.get('tool') === 'fill') { pour(o, state.get('swatch'), pt); return; }
  if (o.cx !== g.before.cx || o.cy !== g.before.cy || o.size !== g.before.size || o.rot !== g.before.rot) {
    changed(o.sheet, o.id, g.before, rec(o));
    const box = targets.boxAt(o.sheet, { x: o.cx, y: o.cy });
    if (box) targets.setHasInk(box, true);
  }
}

export function pointerCancel() {
  const g = grab;
  grab = null;
  if (g) restore(g.o.id, g.before);
}

// ---- everything else ----

export function drawInto(ctx, rect, S, sheet = engine.activeSheet()) {
  for (const o of list) {
    if (o.sheet !== sheet) continue;
    const w = shownSize(o);
    ctx.save();
    ctx.translate((o.cx - rect.x) * S, (o.cy - rect.y) * S);
    ctx.rotate(o.rot);
    try { ctx.drawImage(o.el, -w / 2 * S, -w / 2 * S, w * S, w * S); } catch { /* an image still decoding */ }
    ctx.restore();
  }
}

export function clearSheet(n) {
  const old = list.filter(o => o.sheet === n).map(rec);
  if (!old.length) return;
  for (const d of old) restore(d.id, null);
  undo.pushCustom(n, {
    undo() { for (const d of old) restore(d.id, d); save(); },
    redo() { for (const d of old) restore(d.id, null); save(); },
  });
  save();
}

export function reset() {
  select(null);
  grab = null;
  list = [];
  for (const el of document.querySelectorAll('.sheet>img.st-obj')) el.remove();
}

export function init(saved) {
  reset();
  for (const data of Array.isArray(saved) ? saved : []) {
    if (!SAFE_PNG.test(data?.png ?? '') || !artOf(data.sticker) || !sheetEl(data.sheet)) continue;
    const o = { ...data };
    list.push(o);
    makeEl(o);
  }
}

on('view:change', syncSel);
on('page:shown', () => select(null));
on('box:change', syncSel);
on('studio:exit', () => select(null));
