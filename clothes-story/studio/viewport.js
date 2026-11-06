// Where the active sheet sits inside .page, which is the free rect the dock leaves. Owns .book's transform.
// Client px live only here and in input.js (section 4.1); everything else asks toSheet and toClient.
import { BOXES, SHEET_H, SHEET_W } from './constants.js?v=1';
import { emit } from './bus.js?v=1';
import * as state from './state.js?v=1';

const MAX_Z = 4;
const SPRING_BAND = 1.15; // a release this close to fit springs to fit, and isZoomed() is false inside it
const SPRING_MS = 160;
const FRAME_MS = 360;
const BIG_DW = 50, BIG_DH = 120; // same limits that cut a stroke in input.js: the free rect really changed shape

let page = null, book = null;
let rect = { left: 0, top: 0, width: 0, height: 0 };
let fitZ = 1, zoom = 1, tx = 0, ty = 0;
let gesture = false;
let tween = null;   // { to, raf }
let anchor = null;  // { x, y, cx, cy }: the sheet point held under a client point while zooming
let pinch = null;   // { z0, d0 }
let framed = null;  // { rect, pad }: what frameRect framed, until someone moves the view

const clampZ = v => Math.min(MAX_Z, Math.max(fitZ, v));
const reducedMotion = () => matchMedia('(prefers-reduced-motion:reduce)').matches;
const easeOut = e => 1 - (1 - e) ** 3;

function computeFit(w, h) {
  const coarse = matchMedia('(pointer:coarse)').matches;
  const phoneLandscape = innerHeight < 500 && innerWidth > innerHeight;
  const byWidth = w / SHEET_W;
  // Fit page on touch. A landscape phone would shrink the page to nothing that way, so it fits width like a mouse does.
  return Math.min(MAX_Z, coarse && !phoneLandscape ? Math.min(byWidth, h / SHEET_H) : Math.min(byWidth, 1));
}

function measure() {
  const r = page.getBoundingClientRect();
  rect = { left: r.left, top: r.top, width: r.width, height: r.height };
  if (r.width > 0 && r.height > 0) fitZ = computeFit(r.width, r.height);
}

// An axis with room to spare is centred at rest. During a gesture it may slide inside the free rect, so the page
// stays under the fingers instead of jumping sideways. An axis that overflows must keep covering the free rect.
function clampAxis(t, size, free, loose) {
  if (size <= free) return loose ? Math.min(Math.max(t, 0), free - size) : (free - size) / 2;
  return Math.min(0, Math.max(t, free - size));
}

function clamped(z, x, y, loose = false) {
  return {
    z,
    tx: clampAxis(x, SHEET_W * z, rect.width, loose),
    ty: clampAxis(y, SHEET_H * z, rect.height, loose),
  };
}

function write(z, x, y) {
  zoom = z; tx = x; ty = y;
  book.style.transform = `translate(${tx}px,${ty}px) scale(${zoom})`;
  state.set('z', zoom);
  emit('view:change', { z: zoom, tx, ty });
}

function put(z, x, y, loose = false) {
  const to = clamped(z, x, y, loose);
  if (to.z !== zoom || to.tx !== tx || to.ty !== ty) write(to.z, to.tx, to.ty);
}

const setWillChange = on => { book.style.willChange = on ? 'transform' : ''; };

function finishTween() {
  const { to } = tween;
  tween = null;
  write(to.z, to.tx, to.ty);
  if (!gesture) setWillChange(false); // the moment text re-rasterizes sharp at the new scale
}

// A straight zoom about the one point the two placements share: z is geometric, translation is linear in z.
function glide(to, ms) {
  if (!(ms > 0) || reducedMotion() || document.hidden) {
    write(to.z, to.tx, to.ty);
    if (!gesture) setWillChange(false);
    return;
  }
  setWillChange(true);
  const from = { z: zoom, tx, ty };
  const start = performance.now();
  const step = now => {
    if (!tween) return;
    const e = easeOut(Math.min(1, Math.max(0, now - start) / ms));
    if (e >= 1) { finishTween(); return; }
    const z = from.z * (to.z / from.z) ** e;
    const k = Math.abs(to.z - from.z) > 1e-6 ? (z - from.z) / (to.z - from.z) : e;
    write(z, from.tx + (to.tx - from.tx) * k, from.ty + (to.ty - from.ty) * k);
    tween.raf = requestAnimationFrame(step);
  };
  tween = { to, raf: requestAnimationFrame(step) };
}

// Finishes a running animation now, so coordinates hold still before a finger is mapped to the sheet.
export function settle() {
  if (!tween) return;
  cancelAnimationFrame(tween.raf);
  finishTween();
}

function framing(r, pad) {
  const z = clampZ(Math.min(rect.width / (r.w + 2 * pad), rect.height / (r.h + 2 * pad)));
  return clamped(z, rect.width / 2 - (r.x + r.w / 2) * z, rect.height / 2 - (r.y + r.h / 2) * z);
}

const fitPlace = () => clamped(fitZ, 0, 0); // top of the page when it overflows, as a mouse user expects

export function init(pageEl, bookEl) {
  page = pageEl;
  book = bookEl;
  gesture = false; tween = null; anchor = null; pinch = null; framed = null;
  measure();
  const to = fitPlace();
  write(to.z, to.tx, to.ty);
}

export function destroy() {
  if (!book) return;
  if (tween) cancelAnimationFrame(tween.raf);
  tween = null;
  book.style.transform = '';
  setWillChange(false);
  state.set('z', 1);
  page = book = null;
  gesture = false; anchor = null; pinch = null; framed = null;
  zoom = 1; tx = ty = 0;
}

// Re-reads the free rect. A framed box stays framed; otherwise the point at the centre stays at the centre.
// A call that finds nothing changed leaves a running animation alone: ResizeObserver reports once just for observing.
export function refit() {
  if (!book) return;
  const old = rect, oldFit = fitZ;
  measure();
  if (rect.left === old.left && rect.top === old.top && rect.width === old.width && rect.height === old.height && fitZ === oldFit) return;
  if (!(rect.width > 0 && rect.height > 0)) return;
  settle();
  const wasFit = Math.abs(zoom - oldFit) < 1e-3;
  const cx = (old.width / 2 - tx) / zoom, cy = (old.height / 2 - ty) / zoom;
  anchor = null;
  const big = Math.abs(rect.width - old.width) > BIG_DW || Math.abs(rect.height - old.height) > BIG_DH;
  const box = BOXES[state.get('box')];
  let to;
  if (framed) to = framing(framed.rect, framed.pad);
  else if (big && box) to = framing(box.rect, 8);
  else {
    const z = wasFit ? fitZ : clampZ(zoom);
    to = clamped(z, rect.width / 2 - cx * z, rect.height / 2 - cy * z);
  }
  write(to.z, to.tx, to.ty); // always emits: the free rect may have moved, and chips ask toClient
}

export function fit({ animate = false } = {}) {
  if (!book) return;
  settle();
  measure();
  framed = null; anchor = null;
  const to = fitPlace();
  if (animate) glide(to, FRAME_MS);
  else write(to.z, to.tx, to.ty);
}

export function frameRect(r, { pad = 8, animate = false } = {}) {
  if (!book) return;
  settle();
  measure();
  anchor = null;
  framed = { rect: r, pad };
  const to = framing(r, pad);
  if (animate) glide(to, FRAME_MS);
  else write(to.z, to.tx, to.ty);
}

export function panBy(dx, dy) {
  if (!book) return;
  settle();
  framed = null; anchor = null;
  put(zoom, tx + dx, ty + dy);
}

function hold(cx, cy) {
  anchor = { x: (cx - rect.left - tx) / zoom, y: (cy - rect.top - ty) / zoom, cx, cy };
}

function placeHeld(cx, cy, z) {
  put(z, cx - rect.left - anchor.x * z, cy - rect.top - anchor.y * z, gesture);
}

// Holds one sheet point rather than stepping from the last transform, so a clamp costs nothing:
// the point comes back under the cursor as soon as the clamp lets go.
export function zoomAt(cx, cy, factor) {
  if (!book) return;
  settle();
  framed = null;
  if (!anchor || anchor.cx !== cx || anchor.cy !== cy) hold(cx, cy);
  placeHeld(cx, cy, clampZ(zoom * factor));
}

export function pinchStart(cx, cy, dist) {
  if (!book) return;
  settle();
  framed = null;
  hold(cx, cy);
  pinch = { z0: zoom, d0: Math.max(dist, 1) };
}

export function pinchMove(cx, cy, dist) {
  if (!book || !pinch || !anchor) return;
  const wanted = pinch.z0 * dist / pinch.d0;
  const z = clampZ(wanted);
  if (z !== wanted) pinch = { z0: z, d0: Math.max(dist, 1) }; // past a limit, reversing must respond at once
  placeHeld(cx, cy, z);
}

export function beginGesture() {
  if (!book) return;
  settle();
  gesture = true;
  setWillChange(true);
}

export function endGesture() {
  if (!gesture) return;
  gesture = false;
  anchor = null;
  pinch = null;
  if (!book) return;
  const springs = zoom <= fitZ * SPRING_BAND && zoom !== fitZ;
  let to;
  if (springs) {
    const cx = (rect.width / 2 - tx) / zoom, cy = (rect.height / 2 - ty) / zoom;
    to = clamped(fitZ, rect.width / 2 - cx * fitZ, rect.height / 2 - cy * fitZ);
  } else {
    to = clamped(zoom, tx, ty);
  }
  if (to.z === zoom && to.tx === tx && to.ty === ty) setWillChange(false);
  else glide(to, SPRING_MS);
}

// The free rect's position can change without a resize reaching us yet. Stage rect is cached at stroke start (5.1).
export function syncRect() {
  if (!page) return;
  const r = page.getBoundingClientRect();
  rect.left = r.left;
  rect.top = r.top;
}

export function z() { return zoom; }
export function toSheet(cx, cy) { return { x: (cx - rect.left - tx) / zoom, y: (cy - rect.top - ty) / zoom }; }
export function toClient(x, y) { return { x: rect.left + tx + x * zoom, y: rect.top + ty + y * zoom }; }
export function isZoomed() { return zoom > fitZ * SPRING_BAND; }
