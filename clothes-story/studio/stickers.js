// A sticker in hand: place, drag, one corner handle, then flatten onto paint. Picking a swatch while placing commits and
// pours into it, which is the moment the whole Studio is built around (section 2.6).
import { BOXES, LIMITS, SHEET_H, SHEET_W } from './constants.js?v=1';
import { emit, on } from './bus.js?v=1';
import { log } from './diag.js?v=1';
import * as engine from './engine.js?v=1';
import * as fill from './fill.js?v=1';
import * as objects from './objects.js?v=1';
import * as speech from './speech.js?v=1';
import * as state from './state.js?v=1';
import { BUTTON_LINE_W, DETAIL_W, HEM_DASH, HEM_W, LINE_W, NAVY, SUN, THREAD, sticker as artOf } from './sticker-art.js?v=1';
import * as targets from './targets.js?v=1';
import * as viewport from './viewport.js?v=1';

const GRID = 96;
const LAND_SHARE = .7;           // of the smaller side of a draw box
const MIN_SCALE = .4, MAX_SCALE = 1.6;
const HANDLE_DOT_PX = 34, HANDLE_HIT_PX = 44, HANDLE_SLACK_PX = 6; // screen px, kept constant under zoom
const GOLD = '#C99A1E';
const SVG_NS = 'http://www.w3.org/2000/svg';
const BOUNCE_MS = 420;

const LAND_CLEAR_PX = 64;
const baseSize = Math.min(BOXES['p1-uniform'].rect.w, BOXES['p1-uniform'].rect.h) * LAND_SHARE;
const paths = new Map();

let placing = null;   // { art, sheet, cx, cy, size, el, parts, bounce }
let grab = null;      // { kind, dx, dy, d0, size0, cx0, cy0 }
let redirect = null;  // a tap on the sticker's empty corner means the sticker, not the paper behind it
let afterTool = null;
let tryOn = null;     // the sticker just poured: picking another swatch re-pours it until the child does anything else
let offs = [];
let probe = null;

// ---- art as canvas: the same numbers as svg() in sticker-art.js ----

function pathOf(d) {
  let p = paths.get(d);
  if (!p) paths.set(d, p = new Path2D(d));
  return p;
}

function setUnits(ctx, mark, S) {
  ctx.transform(mark.s * S, 0, 0, mark.s * S, mark.x * S, mark.y * S);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
}

export function paintLines(ctx, mark, S) {
  const art = artOf(mark.sticker);
  if (!art) return;
  ctx.save();
  setUnits(ctx, mark, S);
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = LINE_W;
  ctx.stroke(pathOf(art.outline));
  ctx.lineWidth = DETAIL_W;
  for (const d of art.details) ctx.stroke(pathOf(d));
  ctx.strokeStyle = THREAD;
  ctx.lineWidth = HEM_W;
  ctx.setLineDash(HEM_DASH);
  for (const d of art.hem) ctx.stroke(pathOf(d));
  ctx.setLineDash([]);
  ctx.lineWidth = BUTTON_LINE_W;
  ctx.fillStyle = SUN;
  ctx.strokeStyle = NAVY;
  for (const b of art.buttons) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

export function paintSolid(ctx, mark, S) {
  const art = artOf(mark.sticker);
  if (!art?.solid) return;
  ctx.save();
  setUnits(ctx, mark, S);
  ctx.fillStyle = art.solid;
  ctx.fill(pathOf(art.outline));
  ctx.restore();
}

// ---- what fill.js asks about a placed sticker ----

export const markRect = m => ({ x: m.x, y: m.y, w: GRID * m.s, h: GRID * m.s });
export const markSeeds = m => (artOf(m.sticker)?.fillSeeds ?? []).map(p => ({ x: m.x + p.x * m.s, y: m.y + p.y * m.s }));

// Sheet px, for the creases of a poured garment. Without its own folds a sticker gets the generic ones.
export function markFolds(m) {
  const folds = artOf(m.sticker)?.folds;
  if (!folds?.length) return null;
  return folds.map(([x, y, len, width, angle, strength]) => ({
    x: m.x + x * m.s, y: m.y + y * m.s, len: len * m.s, width: width * m.s, angle: angle * Math.PI / 180, strength,
  }));
}

function probeCtx() {
  probe ??= document.createElement('canvas').getContext('2d');
  return probe;
}

export function markAt(marks, p) {
  const ctx = probeCtx();
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i], art = artOf(m.sticker);
    if (art && ctx.isPointInPath(pathOf(art.outline), (p.x - m.x) / m.s, (p.y - m.y) / m.s)) return m;
  }
  return null;
}

// The inside of a solid sticker, as the runs a flood would have found: everything fillDilate px clear of its line.
export function solidRuns(mark, { any = false } = {}) {
  const art = artOf(mark.sticker);
  if (!art || (!art.solid && !any)) return null;
  const r = markRect(mark);
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
  const w = Math.min(SHEET_W, Math.ceil(r.x + r.w)) - x0, h = Math.min(SHEET_H, Math.ceil(r.y + r.h)) - y0;
  if (w <= 0 || h <= 0) return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.setTransform(mark.s, 0, 0, mark.s, mark.x - x0, mark.y - y0);
  ctx.fill(pathOf(art.outline));
  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineJoin = 'round';
  ctx.lineWidth = LINE_W + 2 * LIMITS.fillDilate / mark.s;
  ctx.stroke(pathOf(art.outline));
  if (any && art.id === 'child') ctx.fillRect(0, 0, 96, 51); // the cloth dresses the body, the face stays paper
  const { data } = ctx.getImageData(0, 0, w, h);
  let minX = w, minY = h, maxX = -1, maxY = -1;
  const runs = [];
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (data[(y * w + x) * 4 + 3] < 128) { x++; continue; }
      const start = x;
      while (x < w && data[(y * w + x) * 4 + 3] >= 128) x++;
      runs.push(y, start, x - start);
      minX = Math.min(minX, start);
      maxX = Math.max(maxX, x - 1);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) return null;
  for (let i = 0; i < runs.length; i += 3) {
    runs[i] -= minY;
    runs[i + 1] -= minX;
  }
  return { bbox: { x: x0 + minX, y: y0 + minY, w: maxX - minX + 1, h: maxY - minY + 1 }, rle: runs };
}

export function takeRedirect(pt) {
  const spot = redirect ?? pt;
  redirect = null;
  return spot;
}

// ---- the ghost: a small svg of its own, so dragging moves one layer and never repaints the page's text ----

function node(name, attrs, parent) {
  const n = document.createElementNS(SVG_NS, name);
  for (const k of Object.keys(attrs)) n.setAttribute(k, attrs[k]);
  parent?.append(n);
  return n;
}

function buildGhost(art, sheet) {
  const host = document.querySelector(`.sheet[data-sheet="${sheet}"]`);
  if (!host) return null;
  const el = node('svg', { class: 'st-ghost', 'aria-hidden': 'true', focusable: 'false' });
  el.style.cssText = 'position:absolute;left:0;top:0;z-index:5;pointer-events:none;overflow:visible;will-change:transform;touch-action:none';
  const stroke = (d, width, color, extra = {}) => node('path', { d, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...extra }, el);
  const frame = node('rect', { x: 0, y: 0, width: GRID, height: GRID, rx: 3, fill: 'none', stroke: GOLD }, el);
  if (art.solid) node('path', { d: art.outline, fill: art.solid }, el);
  stroke(art.outline, LINE_W, NAVY);
  for (const d of art.details) stroke(d, DETAIL_W, NAVY);
  for (const d of art.hem) stroke(d, HEM_W, THREAD, { 'stroke-dasharray': HEM_DASH.join(' ') });
  for (const b of art.buttons) node('circle', { cx: b.x, cy: b.y, r: b.r, fill: SUN, stroke: NAVY, 'stroke-width': BUTTON_LINE_W }, el);
  const handle = node('g', {}, el);
  const dot = node('circle', { r: 1, fill: SUN, stroke: NAVY }, handle);
  const arrows = node('path', { d: 'M-5 -1V-5H-1M5 1V5H1M-4.4 -4.4L4.4 4.4', fill: 'none', stroke: NAVY, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, handle);
  host.append(el);
  return { el, frame, handle, dot, arrows };
}

function layout() {
  const p = placing;
  if (!p) return;
  const z = viewport.z() || 1;
  const s = p.size / GRID;
  const pad = (HANDLE_HIT_PX / z) * .75;
  const padUnits = pad / s;
  const box = GRID + 2 * padUnits;
  const { el, frame, handle, dot, arrows } = p.parts;
  el.setAttribute('viewBox', `${-padUnits} ${-padUnits} ${box} ${box}`);
  el.style.width = el.style.height = p.size + 2 * pad + 'px';
  frame.setAttribute('stroke-width', 1.5 / z / s);
  frame.setAttribute('stroke-dasharray', `${6 / z / s} ${5 / z / s}`);
  const r = HANDLE_DOT_PX / 2 / z / s;
  dot.setAttribute('r', r);
  dot.setAttribute('stroke-width', 2.5 / z / s);
  handle.setAttribute('transform', `translate(${GRID} ${GRID})`);
  arrows.setAttribute('stroke-width', 2.2 / z / s);
  arrows.setAttribute('transform', `scale(${1.05 / z / s})`);
  place();
}

function ghostTransform(p) {
  const z = viewport.z() || 1, pad = (HANDLE_HIT_PX / z) * .75;
  return `translate(${p.cx - p.size / 2 - pad}px,${p.cy - p.size / 2 - pad}px)`;
}

function place() {
  placing.parts.el.style.transform = ghostTransform(placing);
}

// In Box Mode the view frames the box, so the whole frame stays in the box or its handle would be off screen.
function bounds(p) {
  const box = state.get('box');
  return box && BOXES[box]?.sheet === p.sheet ? BOXES[box].rect : { x: 0, y: 0, w: SHEET_W, h: SHEET_H };
}

function clampToBounds(p) {
  const r = bounds(p);
  p.size = Math.min(p.size, r.w, r.h);
  p.cx = Math.max(r.x + p.size / 2, Math.min(r.x + r.w - p.size / 2, p.cx));
  p.cy = Math.max(r.y + p.size / 2, Math.min(r.y + r.h - p.size / 2, p.cy));
}

function bounceIn(p) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !p.parts.el.animate) return;
  const at = ghostTransform(p);
  p.bounce = p.parts.el.animate([
    { transform: `${at} scale(.2)`, opacity: 0 },
    { transform: `${at} scale(1.14)`, opacity: 1, offset: .55 },
    { transform: `${at} scale(.95)`, offset: .8 },
    { transform: `${at} scale(1)` },
  ], { duration: BOUNCE_MS, easing: 'ease-out' });
}

function stopBounce(p) {
  p.bounce?.cancel();
  p.bounce = null;
}

function removeGhost(p) {
  document.documentElement.classList.remove('st-placing');
  stopBounce(p);
  p.parts.el.remove();
}

// ---- landing ----

// What the child can see of a box: a shirt half under the fold cannot make anyone gasp. The strip kept at the bottom is
// for the buttons that float over the lower edge of the page.
function visiblePart(r) {
  const page = document.querySelector('.page')?.getBoundingClientRect();
  if (!page) return r;
  const a = viewport.toSheet(page.left, page.top), z = viewport.toSheet(page.right, page.bottom - LAND_CLEAR_PX);
  const x0 = Math.max(r.x, a.x), y0 = Math.max(r.y, a.y), x1 = Math.min(r.x + r.w, z.x), y1 = Math.min(r.y + r.h, z.y);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

function landing(sheet) {
  const inBox = state.get('box');
  let rect = inBox && BOXES[inBox]?.sheet === sheet ? BOXES[inBox].rect : null;
  if (!rect) {
    let most = 0;
    for (const b of Object.values(BOXES)) {
      if (b.sheet !== sheet) continue;
      const v = visiblePart(b.rect), area = v.w * v.h;
      if (area > most + 1) { most = area; rect = b.rect; }
    }
  }
  if (!rect) {
    const page = document.querySelector('.page')?.getBoundingClientRect();
    const view = page ? viewport.toSheet(page.left + page.width / 2, page.top + page.height / 2) : { x: SHEET_W / 2, y: SHEET_H / 2 };
    return { ...view, size: baseSize };
  }
  const v = visiblePart(rect), room = Math.min(v.w, v.h);
  if (room < baseSize * MIN_SCALE) return { ...centreOf(rect), size: baseSize };
  return { ...centreOf(v), size: Math.min(baseSize, room) };
}

const centreOf = r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

// ---- listening ----

function endTryOn() {
  if (!tryOn) return;
  tryOn.page?.removeEventListener('pointerdown', endTryOn, true);
  tryOn = null;
}

function onSwatchChange() {
  // a selected sticker recolours through dock.js now
}

function listen() {
  if (offs.length) return;
  offs = [
    on('view:change', layout),
    on('state:swatch', onSwatchChange),
    on('state:tool', ({ value } = {}) => { if (value !== 'fill') endTryOn(); }),
    on('undo:applied', endTryOn),
    on('page:shown', endTryOn),
    on('studio:exit', teardown),
  ];
}

function teardown() {
  cancel();
  endTryOn();
  for (const off of offs) off();
  offs = [];
}

// ---- public ----

export function arm(stickerId) {
  const art = artOf(stickerId);
  if (!art || state.get('readOnly')) return;
  if (placing) commit();
  listen();
  endTryOn();
  redirect = null;
  const sheet = engine.activeSheet();
  const parts = buildGhost(art, sheet);
  if (!parts) return;
  const spot = landing(sheet);
  placing = { art, sheet, cx: spot.x, cy: spot.y, size: spot.size, parts, bounce: null };
  emit('sticker:arm', { sticker: stickerId });
  document.documentElement.classList.add('st-placing'); // the printed "draw here" would show through the ghost
  clampToBounds(placing);
  layout();
  bounceIn(placing);
  try {
    speech.word(art.word.en);
  } catch (err) {
    log('stickers', 'speech: ' + err.message);
  }
}

export function isPlacing() { return !!placing; }

export function pointerDown(pt) {
  const p = placing;
  if (!p) return null;
  stopBounce(p);
  const z = viewport.z() || 1;
  const half = p.size / 2;
  const hx = p.cx + half, hy = p.cy + half;
  if (Math.hypot(pt.x - hx, pt.y - hy) <= (HANDLE_HIT_PX / 2 + HANDLE_SLACK_PX) / z) {
    grab = { kind: 'scale', d0: Math.max(1, Math.hypot(pt.x - p.cx, pt.y - p.cy)), size0: p.size };
    return 'scale';
  }
  if (Math.abs(pt.x - p.cx) > half || Math.abs(pt.y - p.cy) > half) return null;
  const onShape = probeCtx().isPointInPath(pathOf(p.art.outline), (pt.x - p.cx + half) / (p.size / GRID), (pt.y - p.cy + half) / (p.size / GRID));
  grab = { kind: onShape ? 'body' : 'drag', dx: pt.x - p.cx, dy: pt.y - p.cy };
  return grab.kind;
}

export function pointerMove(pt) {
  const p = placing;
  if (!p || !grab) return;
  if (grab.kind === 'scale') {
    const k = Math.hypot(pt.x - p.cx, pt.y - p.cy) / grab.d0;
    p.size = Math.max(baseSize * MIN_SCALE, Math.min(baseSize * MAX_SCALE, grab.size0 * k));
    clampToBounds(p);
    layout();
    return;
  }
  p.cx = pt.x - grab.dx;
  p.cy = pt.y - grab.dy;
  clampToBounds(p);
  place();
}

export function pointerUp(pt, wasTap) {
  const p = placing;
  const kind = grab?.kind;
  grab = null;
  if (!p || !wasTap || kind === 'scale') return;
  afterTool = 'fill'; // tools.js commits and pours at the tap
  if (kind === 'drag') {
    const s = p.size / GRID, first = p.art.fillSeeds[0];
    redirect = { x: p.cx - p.size / 2 + first.x * s, y: p.cy - p.size / 2 + first.y * s };
  }
}

export function commit() {
  const p = placing;
  if (!p) return;
  placing = null;
  grab = null;
  removeGhost(p);
  const landed = objects.add({ sticker: p.art.id, cx: p.cx, cy: p.cy, size: p.size, sheet: p.sheet });
  // With the stickers tool still up, the next touch would do nothing, and that reads as broken.
  const next = afterTool ?? state.get('lastDraw');
  afterTool = null;
  queueMicrotask(() => {
    if (!placing && state.get('tool') === 'stickers') state.set('tool', next);
  });
  return landed;
}

export function cancel() {
  const p = placing;
  if (!p) return;
  placing = null;
  grab = null;
  redirect = null;
  afterTool = null;
  removeGhost(p);
}

export function onSwatchPicked(swatchId) {
  if (!placing) return;
  afterTool = 'fill';
  const landed = commit();
  if (landed) objects.pour(landed, swatchId);
}
