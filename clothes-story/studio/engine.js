// The one paint canvas and the one live canvas (invariants 2, 3, 4, 5). Strokes draw on live and reach paint only at
// pointer-up, so any cancel is free. Public rects are sheet px unless the name says backing; a Patch rect is backing px.
import { BRUSH_D, LIMITS, MIN_SCREEN, SHEETS, SHEET_H, SHEET_W, resolveBrush, stitchColor, swatch as swatchById } from './constants.js?v=1';
import { emit, on } from './bus.js?v=1';
import { log } from './diag.js?v=1';
import { finishReveal } from './fill.js?v=1';
import { getInk } from './store.js?v=1';
import * as state from './state.js?v=1';
import * as textures from './textures.js?v=1';
import { makeBrush, uniteRects } from './brushes.js?v=1';

const SCRATCH_SIZE = 720;
const SAMPLE_SIZE = 64;
const POINTS_PER_BATCH = 16;
const LATE_GAP_MS = 26;       // a frame at 60Hz is 16.7ms, so "late" must sit clearly above it
const DRY_MS = 300;
const SLOW_BAKE_MS = 1500;
const PAPER = '#FFFEFB';

let S = 0, W = 0, H = 0;
let paint = null, live = null, paintX = null, liveX = null, scratch = null, backup = null, backupX = null, sampler = null;
let active = 0, showing = 0, clip = null, mirrorAxis = null;
let stroke = null, bake = null, fade = null;
let dirtyPaint = false, lastMark = null, publishRun = 0;
let lastId = 0, seed = 1;
let offs = [];
let watercolor = null;
const urls = new Map();

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const sheetEl = n => document.querySelector(`.sheet[data-sheet="${n}"]`);
const inkImg = n => sheetEl(n)?.querySelector(':scope>img.ink') ?? null;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const toBacking = r => {
  const x = Math.floor(r.x * S), y = Math.floor(r.y * S);
  return { x, y, w: Math.ceil((r.x + r.w) * S) - x, h: Math.ceil((r.y + r.h) * S) - y };
};
const toSheet = r => ({ x: r.x / S, y: r.y / S, w: r.w / S, h: r.h / S });

function intersect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x, h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

// ---- start and stop ----

// Draw one pixel and read it through a small canvas: a canvas too big for the device fails silently, not with an error.
function allocate(scale) {
  const w = SHEET_W * scale, h = SHEET_H * scale, c = mk(w, h), x = c.getContext('2d');
  if (!x) return null;
  x.fillStyle = '#010203';
  x.fillRect(w - 1, h - 1, 1, 1);
  const t = mk(1, 1), tx = t.getContext('2d', { willReadFrequently: true });
  tx.drawImage(c, w - 1, h - 1, 1, 1, 0, 0, 1, 1);
  const ok = tx.getImageData(0, 0, 1, 1).data[3] > 0;
  x.clearRect(w - 1, h - 1, 1, 1);
  return ok ? c : null;
}

function ensureImages() {
  for (const n of SHEETS) {
    const el = sheetEl(n);
    if (!el || inkImg(n)) continue;
    const img = document.createElement('img');
    img.className = 'ink';
    img.alt = '';
    img.decoding = 'sync'; // printing paints once and cannot wait for a late decode
    el.prepend(img);
  }
}

export async function init({ forceScale } = {}) {
  if (paint) return { scale: S, lowEnd: !!state.get('lowEnd') };
  let want = forceScale ?? (navigator.deviceMemory <= 1 ? 1 : 2);
  let canvas = allocate(want);
  if (!canvas && want > 1) {
    log('engine', `no canvas at ${want}x, trying 1x`);
    want = 1;
    canvas = allocate(1);
  }
  if (!canvas) throw new Error('no canvas available');
  S = want; W = SHEET_W * S; H = SHEET_H * S;
  paint = canvas;
  paint.id = 'st-paint';
  live = mk(W, H);
  live.id = 'st-live';
  paintX = paint.getContext('2d');
  liveX = live.getContext('2d');
  if (!liveX) throw new Error('no live canvas');
  for (const c of [paint, live]) c.setAttribute('aria-hidden', 'true');
  scratch = mk(SCRATCH_SIZE, SCRATCH_SIZE);
  ensureImages();
  live.addEventListener('contextrestored', () => { live.style.opacity = '1'; });
  state.set('scale', S);
  const lowEnd = S === 1;
  state.set('lowEnd', lowEnd);
  textures.tooth();
  offs = [on('state:tool', ({ value }) => { if (value === 'paint') loadWatercolor(); })];
  if (state.get('tool') === 'paint') loadWatercolor();
  return { scale: S, lowEnd };
}

export function release() {
  if (!paint) return;
  stopStroke();
  dropBake();
  settleFade();
  for (const off of offs) off();
  offs = [];
  for (const c of [paint, live, scratch, backup, sampler]) {
    if (!c) continue;
    c.remove();
    c.width = c.height = 1;
  }
  paint = live = paintX = liveX = scratch = backup = backupX = sampler = null;
  active = 0; clip = null; mirrorAxis = null; lastMark = null; dirtyPaint = false;
}

function stopStroke() {
  if (!stroke) return;
  if (stroke.raf) cancelAnimationFrame(stroke.raf);
  restoreClips();
  stroke = null;
}

// ---- pages ----

async function decodeInk(bytes) {
  const blob = new Blob([bytes], { type: 'image/png' });
  if (self.createImageBitmap) {
    try { return await createImageBitmap(blob); } catch (err) { log('engine', 'createImageBitmap: ' + err.message); }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function setImageFromBlob(n, blob) {
  const img = inkImg(n);
  if (!img) return null;
  const old = urls.get(n);
  const url = URL.createObjectURL(blob);
  urls.set(n, url);
  img.src = url;
  if (old) URL.revokeObjectURL(old);
  return img;
}

// Sheets other than the active one print and show thumbnails from their <img>, which reading-ink.js fills only in the
// reading view. Entering Studio directly at #ve has to fill them from the store.
async function seedOtherImages() {
  for (const n of SHEETS) {
    if (n === active || inkImg(n)?.getAttribute('src')) continue;
    try {
      const bytes = await getInk(n);
      if (bytes?.byteLength && n !== active && !inkImg(n)?.getAttribute('src')) setImageFromBlob(n, new Blob([bytes], { type: 'image/png' }));
    } catch (err) {
      log('engine', `sheet ${n} image: ${err.message}`);
    }
  }
}

export async function showSheet(n, inkBytes) {
  if (!paint) throw new Error('engine not initialised');
  const run = ++showing;
  await flush();
  if (active && active !== n && dirtyPaint) await publishActiveImg();
  if (run !== showing) return;
  const bitmap = inkBytes?.byteLength ? await decodeInk(inkBytes).catch(err => { log('engine', 'ink did not decode: ' + err.message); return null; }) : null;
  if (run !== showing) { bitmap?.close?.(); return; }
  stopStroke();
  settleFade();
  paintX.setTransform(1, 0, 0, 1, 0, 0);
  paintX.clearRect(0, 0, W, H);
  liveX.clearRect(0, 0, W, H);
  if (bitmap) {
    paintX.drawImage(bitmap, 0, 0, W, H); // saved 2x bytes land right on a 1x canvas too
    bitmap.close?.();
    setImageFromBlob(n, new Blob([inkBytes], { type: 'image/png' }));
  }
  const el = sheetEl(n);
  if (!el) throw new Error('no sheet ' + n);
  ensureImages();
  const img = inkImg(n);
  if (img) img.after(paint);
  else el.prepend(paint);
  paint.after(live);
  active = n;
  dirtyPaint = false;
  lastMark = null;
  seedOtherImages();
}

export const activeSheet = () => active;
export const scale = () => S;
export const paintCanvas = () => paint;

export function liveCtx() {
  settleFade();
  return liveX;
}

// ---- box clip and mirror ----

export function setClip(rect) {
  clip = rect ? intersect(toBacking(rect), { x: 0, y: 0, w: W, h: H }) : null;
}

export function setMirror(axisX) {
  mirrorAxis = axisX ?? null;
}

// ---- strokes ----

// The size of a mark holds a minimum on screen, so a child at phone scale does not draw with a hair.
function brushSize(kind, size, z) {
  const nominal = BRUSH_D[kind][size];
  if (kind === 'stitch') {
    const long = 8 * nominal;
    return long * z < MIN_SCREEN[size] ? Math.min(MIN_SCREEN[size] / z, 2 * long) / 8 : nominal;
  }
  const across = kind === 'glitter' ? 2 * nominal : nominal;
  if (across * z >= MIN_SCREEN[size]) return nominal;
  return Math.min(MIN_SCREEN[size] / z, 2 * across) * (nominal / across);
}

function makeInstance(kind, sw, D, shared, mirrored, runSeed, penLike) {
  return makeBrush(kind, {
    swatch: sw, D, S, seed: runSeed, shared, mirrored, penLike,
    stitchHex: stitchColor(sw),
    live: liveX, paint: paintX, scratch, tex: textures.toothNow(),
  });
}

function applyClip(ctx) {
  if (!clip) return;
  ctx.beginPath();
  ctx.rect(clip.x, clip.y, clip.w, clip.h);
  ctx.clip();
}

function restoreClips() {
  liveX.restore();
  if (stroke?.erasing) paintX.restore();
}

export function beginStroke(pt, { toolId, swatchId, size = 'M', z = 1, eraserOverride = false, seed: fixedSeed } = {}) {
  if (!paint || !active) return;
  if (stroke) endStroke();
  settleBake();
  settleFade();
  finishReveal();
  const sw = swatchById(swatchId) ?? swatchById('navy');
  const kind = eraserOverride ? 'eraser' : resolveBrush(toolId, sw);
  const D = brushSize(kind, size, z);
  const runSeed = fixedSeed ?? seed++;
  const shared = {};
  const penLike = pt.type === 'pen';
  const erasing = kind === 'eraser';
  liveX.save();
  applyClip(liveX);
  if (erasing) {
    if (!backup) { backup = mk(W, H); backupX = backup.getContext('2d'); }
    backupX.clearRect(0, 0, W, H);
    backupX.drawImage(paint, 0, 0);
    paintX.save();
    applyClip(paintX);
  }
  const brush = makeInstance(kind, sw, D, shared, false, runSeed, penLike);
  const twin = mirrorAxis === null ? null : makeInstance(kind, sw, D, shared, true, runSeed, penLike);
  live.style.opacity = String(brush.liveOpacity);
  stroke = { kind, toolId: erasing ? 'eraser' : toolId, swatchId, brush, twin, queue: [], dirty: null, raf: 0, lastFrame: 0, work: 0, late: false, erasing, hex: sw.hex, runSeed };
  stroke.brush.begin(pt);
  twin?.begin(reflect(pt));
}

const reflect = p => ({ ...p, x: 2 * mirrorAxis - p.x });

function feed(batch) {
  const st = stroke;
  st.dirty = uniteRects(st.dirty, st.brush.extend(batch));
  if (st.twin) st.dirty = uniteRects(st.dirty, st.twin.extend(batch.map(reflect)));
}

function drain(deadline) {
  const q = stroke.queue;
  let i = 0;
  while (i < q.length) {
    feed(q.slice(i, i + POINTS_PER_BATCH));
    i += POINTS_PER_BATCH;
    if (deadline && performance.now() > deadline) break;
  }
  q.splice(0, i);
}

function pace(now) {
  const st = stroke;
  const late = st.work > LIMITS.frameLateMs || (st.lastFrame > 0 && now - st.lastFrame > LATE_GAP_MS);
  if (late !== st.late) {
    st.late = late;
    st.brush.setLate(late);
    st.twin?.setLate(late);
  }
}

function frame(now) {
  const st = stroke;
  if (!st) return;
  st.raf = 0;
  pace(now);
  const started = performance.now();
  drain(started + LIMITS.frameBudgetMs);
  st.work = performance.now() - started;
  st.lastFrame = now;
  if (st.queue.length) st.raf = requestAnimationFrame(frame);
}

export function extendStroke(pts) {
  const st = stroke;
  if (!st || !pts?.length) return;
  for (const p of pts) st.queue.push(p);
  if (!st.raf) {
    if (!st.queue.length) return;
    // Pointer events can pause. The gap before they resume says nothing about how slow the frames are.
    if (st.lastFrame && performance.now() - st.lastFrame > 100) st.lastFrame = 0;
    st.raf = requestAnimationFrame(frame);
  }
}

export const isStroking = () => !!stroke;

function finishMarks() {
  const st = stroke;
  if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }
  drain(0);
  st.dirty = uniteRects(st.dirty, st.brush.finish());
  if (st.twin) st.dirty = uniteRects(st.dirty, st.twin.finish());
}

function commitRect(st) {
  if (!st.dirty) return null;
  const margin = st.brush.margin ?? 0;
  const r = { x: st.dirty.x - margin, y: st.dirty.y - margin, w: st.dirty.w + 2 * margin, h: st.dirty.h + 2 * margin };
  return intersect(clip ? intersect(r, clip) ?? { x: 0, y: 0, w: 0, h: 0 } : r, { x: 0, y: 0, w: W, h: H });
}

function grab(from, rect) {
  const canvas = mk(rect.w, rect.h);
  canvas.getContext('2d').drawImage(from, -rect.x, -rect.y);
  return { rect, canvas };
}

function nextId() {
  lastId = Math.max(Date.now() * 100, lastId + 1);
  return lastId;
}

function announce(rect, before, tool, swatchId) {
  const id = nextId();
  dirtyPaint = true;
  if (tool !== 'eraser' && tool !== 'clear') lastMark = rect;
  emit('ink:commit', { sheet: active, id, rect: toSheet(rect), before, tool, swatchId });
  return id;
}

function clearLive(rect) {
  liveX.clearRect(rect.x, rect.y, rect.w, rect.h);
}

export function endStroke() {
  const st = stroke;
  if (!st) return;
  finishMarks();
  const rect = commitRect(st);
  restoreClips();
  stroke = null;
  if (st.erasing) {
    if (rect) announce(rect, grab(backup, rect), 'eraser');
    return;
  }
  if (!rect) {
    if (st.dirty) clearLive(st.dirty);
    live.style.opacity = '1';
    return;
  }
  if (st.brush.bakes) {
    startBake(st, rect);
    return;
  }
  commitOnPaint(st, rect);
}

export function setStrokeSink(sink) { if (stroke) stroke.sink = sink; }

function commitOnPaint(st, rect) {
  if (st.sink?.accepts({ x: rect.x / S, y: rect.y / S, w: rect.w / S, h: rect.h / S })) { // a stroke that began on a sticker belongs to the sticker
    const c = document.createElement('canvas');
    c.width = paint.width;
    c.height = paint.height;
    const x = c.getContext('2d');
    st.brush.commit(x, rect);
    st.twin?.commit(x, rect);
    clearLive(st.dirty ? intersect(st.dirty, { x: 0, y: 0, w: W, h: H }) ?? rect : rect);
    live.style.opacity = '1';
    st.sink.take(c, S);
    return;
  }
  const before = grab(paint, rect);
  paintX.save();
  applyClip(paintX);
  st.brush.commit(paintX, rect);
  st.twin?.commit(paintX, rect);
  paintX.restore();
  clearLive(st.dirty ? intersect(st.dirty, { x: 0, y: 0, w: W, h: H }) ?? rect : rect);
  live.style.opacity = '1';
  announce(rect, before, st.toolId, st.swatchId);
}

export function cancelStroke() {
  const st = stroke;
  if (!st) return;
  if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }
  restoreClips();
  stroke = null;
  if (st.erasing) {
    if (st.dirty || st.queue.length) {
      paintX.save();
      paintX.setTransform(1, 0, 0, 1, 0, 0);
      paintX.globalCompositeOperation = 'copy';
      paintX.drawImage(backup, 0, 0);
      paintX.restore();
    }
  } else {
    liveX.clearRect(0, 0, W, H);
  }
  live.style.opacity = '1';
}

// ---- the watercolor bake ----

function loadWatercolor() {
  watercolor ??= import('./watercolor.js?v=1').catch(err => {
    log('engine', 'watercolor: ' + err.message);
    watercolor = null;
    return null;
  });
  return watercolor;
}

function startBake(st, rect) {
  const job = { st, rect, run: null, next: 0, spent: 0, timer: 0, waiting: true, seed: st.runSeed };
  bake = job;
  loadWatercolor().then(mod => {
    job.waiting = false;
    if (bake !== job) return;
    prepareBake(job, mod);
    job.timer = setTimeout(stepBake, 0, job);
  });
}

function prepareBake(job, mod) {
  if (job.run || !mod) return;
  try {
    const twinPaths = job.st.brush.bakeJob();
    job.run = mod.makeBake({
      ...twinPaths, rect: job.rect, seed: job.seed,
      grain: textures.grain(), cloud: textures.cloud(), lean: !!state.get('lowEnd'),
    });
  } catch (err) {
    log('engine', 'bake: ' + err.message);
  }
}

function runStage(job) {
  const t = performance.now();
  job.run.stages[job.next++]();
  job.spent += performance.now() - t;
}

function stepBake(job) {
  if (bake !== job) return;
  try {
    if (job.run && job.next < job.run.stages.length) {
      runStage(job);
      if (job.next < job.run.stages.length) {
        job.timer = setTimeout(stepBake, 0, job);
        return;
      }
    }
  } catch (err) {
    log('engine', 'bake stage: ' + err.message);
    job.run = null;
  }
  landBake(job);
}

// Multiply on paint, then a true crossfade: for one frame live shows the old look at full opacity, opaque inside the
// stroke, so nothing jumps; then it fades and the dried wash comes through.
function landBake(job) {
  bake = null;
  clearTimeout(job.timer);
  const { st, rect } = job;
  const out = job.run?.output();
  if (job.run && job.spent > SLOW_BAKE_MS && !state.get('lowEnd')) {
    log('engine', `slow bake ${Math.round(job.spent)}ms, leaner from now on`);
    state.set('lowEnd', true);
  }
  const before = grab(paint, rect);
  paintX.save();
  applyClip(paintX);
  if (out) {
    paintX.globalCompositeOperation = 'multiply';
    paintX.drawImage(out, 0, 0, out.width, out.height, rect.x, rect.y, rect.w, rect.h);
  } else {
    st.brush.commit(paintX, rect);
  }
  paintX.restore();
  if (out && !reducedMotion()) {
    liveX.save();
    liveX.globalCompositeOperation = 'source-atop';
    liveX.fillStyle = PAPER;
    liveX.fillRect(rect.x, rect.y, rect.w, rect.h);
    liveX.drawImage(before.canvas, rect.x, rect.y);
    liveX.globalAlpha = 0.5;
    liveX.fillStyle = st.hex;
    liveX.fillRect(rect.x, rect.y, rect.w, rect.h);
    liveX.restore();
    runFade(rect, DRY_MS);
  } else {
    clearLive(rect);
    live.style.opacity = '1';
  }
  if (out) { out.width = out.height = 1; }
  announce(rect, before, st.toolId, st.swatchId);
}

function settleBake() {
  const job = bake;
  if (!job) return;
  clearTimeout(job.timer);
  try {
    while (job.run && job.next < job.run.stages.length) runStage(job);
  } catch (err) {
    log('engine', 'bake stage: ' + err.message);
    job.run = null;
  }
  landBake(job);
}

function dropBake() {
  if (bake) clearTimeout(bake.timer);
  bake = null;
}

export async function flush() {
  try { finishReveal(); } catch (err) { log('engine', 'reveal: ' + err.message); }
  if (bake?.waiting) {
    const job = bake;
    prepareBake(job, await loadWatercolor());
    if (bake !== job) return;
  }
  settleBake();
}

// ---- fades ----

function runFade(rect, ms) {
  live.style.opacity = '1';
  const done = () => { if (fade === entry) settleFade(); };
  const anim = live.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'linear', fill: 'forwards' });
  const entry = { rect, anim, timer: setTimeout(done, ms + 80) };
  fade = entry;
  anim?.finished.then(done, () => {});
}

function settleFade() {
  const f = fade;
  if (!f) return;
  fade = null;
  clearTimeout(f.timer);
  f.anim?.cancel();
  clearLive(f.rect);
  live.style.opacity = '1';
}

export function fadeOut(patch, ms) {
  if (!live || stroke) return;
  settleFade();
  liveX.drawImage(patch.canvas, patch.rect.x, patch.rect.y);
  runFade(patch.rect, ms);
}

// ---- patches ----

export function capture(rect) {
  return grab(paint, intersect(toBacking(rect), { x: 0, y: 0, w: W, h: H }) ?? { x: 0, y: 0, w: 1, h: 1 });
}

export function restore(patch) {
  const { x, y, w, h } = patch.rect;
  paintX.save();
  paintX.setTransform(1, 0, 0, 1, 0, 0);
  paintX.globalCompositeOperation = 'source-over';
  paintX.globalAlpha = 1;
  paintX.clearRect(x, y, w, h);
  paintX.drawImage(patch.canvas, x, y);
  paintX.restore();
  dirtyPaint = true;
  lastMark = null;
}

// `draw` gets the paint context at identity in backing px, clipped to rect. Box Mode clips here too, so a sticker cannot
// land outside the box; a whole-sheet rect is Clear this page, and clear means the page.
export function commitRaster(rect, draw, meta = {}) {
  settleBake();
  let r = intersect(toBacking(rect), { x: 0, y: 0, w: W, h: H });
  const wholeSheet = r && r.w === W && r.h === H;
  if (r && clip && !wholeSheet) r = intersect(r, clip);
  if (!r) return nextId();
  const before = grab(paint, r);
  paintX.save();
  paintX.setTransform(1, 0, 0, 1, 0, 0);
  paintX.beginPath();
  paintX.rect(r.x, r.y, r.w, r.h);
  paintX.clip();
  try {
    draw(paintX, S);
  } finally {
    paintX.restore();
  }
  return announce(r, before, meta.tool, meta.swatchId);
}

// ---- getting ink out ----

// Chrome runs toBlob in idle time, and with no idle time on offer it can sit for about 6.7 s, seen on the real page: a tapped
// page tile did nothing for that long. So an encode has a patience, short while someone is waiting, and then is done at once.
const ENCODE_PATIENCE_MS = 2500, ENCODE_HURRY_MS = 250, STROKE_RECHECK_MS = 200;
let hurrying = 0;
export async function whileHurrying(work) {
  hurrying++;
  try { return await work(); } finally { hurrying--; }
}

function syncPng() {
  const base64 = paint.toDataURL('image/png').split(',')[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

function encodePng() {
  return new Promise(resolve => {
    const canvas = paint;
    let done = false, timer = 0;
    const finish = blob => { if (done) return; done = true; clearTimeout(timer); resolve(blob); };
    const giveUp = () => {
      if (done) return;
      if (stroke) { timer = setTimeout(giveUp, STROKE_RECHECK_MS); return; }
      if (paint !== canvas) { finish(null); return; }
      try { finish(syncPng()); } catch (err) { log('engine', 'sync encode: ' + err.message); finish(null); }
    };
    canvas.toBlob(finish, 'image/png');
    if (!done) timer = setTimeout(giveUp, hurrying ? ENCODE_HURRY_MS : ENCODE_PATIENCE_MS);
  });
}

export async function encodeActive() {
  if (!paint) return null;
  const sheet = active, wasDirty = dirtyPaint;
  dirtyPaint = false; // a commit during the encode raises it again
  const blob = await encodePng();
  if (!blob) { dirtyPaint = dirtyPaint || wasDirty; return null; }
  setImageFromBlob(sheet, blob);
  return blob;
}

export async function publishActiveImg() {
  if (!paint || !active) return;
  const img = inkImg(active);
  if (!img) return;
  if (!dirtyPaint && img.getAttribute('src')) return;
  const run = ++publishRun;
  const blob = await encodeActive();
  if (!blob || run !== publishRun) return;
  await img.decode().catch(err => log('engine', 'published ink did not decode: ' + err.message));
}

export function publishActiveImgSync() {
  if (!paint || !active) return;
  const img = inkImg(active);
  if (!img || (!dirtyPaint && img.getAttribute('src'))) return;
  const old = urls.get(active);
  urls.delete(active);
  img.src = paint.toDataURL('image/png');
  if (old) URL.revokeObjectURL(old);
  dirtyPaint = false;
}

function sampleHasInk(sx, sy, sw, sh) {
  const x = sampler.getContext('2d', { willReadFrequently: true });
  x.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  x.imageSmoothingQuality = 'high';
  x.drawImage(paint, sx, sy, sw, sh, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  const d = x.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
  for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
  return false;
}

// Small and separate, never paint itself (invariant 5). The whole sheet at 64px can lose one little dot, so the place
// the last mark went is looked at again, which a lost canvas cannot pass and real work always does.
export function sampleIsBlank() {
  if (!paint) return true;
  sampler ??= mk(SAMPLE_SIZE, SAMPLE_SIZE);
  if (sampleHasInk(0, 0, W, H)) return false;
  return !(lastMark && sampleHasInk(lastMark.x, lastMark.y, lastMark.w, lastMark.h));
}
