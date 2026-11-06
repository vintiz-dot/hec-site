// The rect table: every blank, line, write, tick and draw box in sheet px. Read-only: it measures the authored
// paper layout and reports differences from GOLDEN, it never corrects anything (section 3.2).
import { BOXES, DARK_SELECTORS, GOLDEN, SHEETS, SHEET_H, SHEET_W, TOOLS } from './constants.js?v=1';
import { emit, on } from './bus.js?v=1';
import { log } from './diag.js?v=1';

const GOLDEN_TOLERANCE_PX = 0.5;
const RECHECK_DELAY_MS = 200;
const SAMPLE_SCALE = 0.25;

let table = new Map();     // id -> Target
let bySheet = new Map();   // sheet -> Target[]
let darkBySheet = new Map(); // sheet -> Rect[]
let sheetSizes = new Map();  // sheet -> Rect
let unsubscribe = [];
let recheckTimer = 0;
let sampler = null;
const inked = new Set();

const round = n => Math.round(n * 100) / 100;

function relativeRect(el, origin) {
  const r = el.getBoundingClientRect();
  return { x: round(r.left - origin.left), y: round(r.top - origin.top), w: round(r.width), h: round(r.height) };
}

function kindOf(el) {
  if (el.matches('.draw')) return 'box';
  if (el.matches('.blank')) return 'blank';
  if (el.matches('.line')) return 'line';
  if (el.matches('.write')) return 'write';
  if (el.matches('ul.ticks li')) return 'tick';
  return null;
}

// All sheets laid out, no transform, no transition, so one CSS px is one sheet px. Restored before anything can paint.
function whileMeasuring(fn) {
  const book = document.querySelector('.book');
  if (!book) throw new Error('targets: no .book in the page');
  const { transform, transition } = book.style;
  const hadMeasure = book.classList.contains('measure');
  book.style.transition = 'none';
  book.style.transform = 'none';
  book.classList.add('measure');
  try {
    fn();
  } finally {
    if (!hadMeasure) book.classList.remove('measure');
    book.style.transform = transform;
    void book.offsetWidth; // flush, or restoring the transition would animate the restored transform
    book.style.transition = transition;
  }
}

function measureDark(sheet, origin) {
  const rects = [];
  for (const selector of DARK_SELECTORS) {
    for (const el of sheet.querySelectorAll(selector)) {
      const rect = relativeRect(el, origin);
      if (rect.w > 0 && rect.h > 0) rects.push(rect);
    }
  }
  return rects;
}

function measureAll() {
  table = new Map();
  bySheet = new Map();
  darkBySheet = new Map();
  sheetSizes = new Map();
  for (const sheetEl of document.querySelectorAll('.sheet[data-sheet]')) {
    const n = Number(sheetEl.dataset.sheet);
    const origin = sheetEl.getBoundingClientRect();
    sheetSizes.set(n, relativeRect(sheetEl, origin));
    const list = [];
    for (const el of sheetEl.querySelectorAll('[data-f],[data-box]')) {
      const kind = kindOf(el);
      if (!kind) continue;
      const target = { id: el.dataset.box || el.dataset.f, kind, sheet: n, rect: relativeRect(el, origin), el };
      table.set(target.id, target);
      list.push(target);
    }
    bySheet.set(n, list);
    darkBySheet.set(n, measureDark(sheetEl, origin));
  }
}

// Contract rects never change with language, but dark pills such as the timeline's do, and Magic Fill walls follow them.
function remeasureDark() {
  if (!document.documentElement.classList.contains('paper')) return;
  whileMeasuring(() => {
    for (const sheetEl of document.querySelectorAll('.sheet[data-sheet]')) {
      darkBySheet.set(Number(sheetEl.dataset.sheet), measureDark(sheetEl, sheetEl.getBoundingClientRect()));
    }
  });
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const insideOf = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
const contains = (r, pt) => pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;

function distance(r, pt) {
  const dx = Math.max(r.x - pt.x, 0, pt.x - (r.x + r.w));
  const dy = Math.max(r.y - pt.y, 0, pt.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

// Undo and the eraser can empty a box, and a stroke's bounding box can touch one it never entered: only pixels can tell.
// A small separate canvas, so paint stays GPU-backed (invariant 5).
async function recheckBoxes(sheet) {
  const engine = await import('./engine.js?v=1');
  if (engine.activeSheet() !== sheet) return;
  if (engine.isStroking()) { scheduleRecheck(sheet); return; }
  const paint = engine.paintCanvas();
  if (!paint || !paint.width) return;
  const S = paint.width / SHEET_W;
  sampler ??= document.createElement('canvas');
  const ctx = sampler.getContext('2d', { willReadFrequently: true });
  for (const [id, box] of Object.entries(BOXES)) {
    if (box.sheet !== sheet) continue;
    const { x, y, w, h } = box.rect;
    const sw = Math.ceil(w * SAMPLE_SCALE), sh = Math.ceil(h * SAMPLE_SCALE);
    sampler.width = sw;
    sampler.height = sh; // resizing also resets the context, so smoothing is set after it
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(paint, x * S, y * S, w * S, h * S, 0, 0, sw, sh);
    const { data } = ctx.getImageData(0, 0, sw, sh);
    let any = false;
    for (let i = 3; i < data.length && !any; i += 4) any = data[i] > 0;
    setHasInk(id, any);
  }
}

function scheduleRecheck(sheet) {
  if (!Object.values(BOXES).some(b => b.sheet === sheet)) return;
  clearTimeout(recheckTimer);
  recheckTimer = setTimeout(() => recheckBoxes(sheet).catch(err => log('targets', 'recheck: ' + err.message)), RECHECK_DELAY_MS);
}

// Ink wholly inside a box is certain, and Box Mode clips strokes to the box, so the usual case costs no readback.
function onInkCommit({ sheet, rect, tool }) {
  const adds = TOOLS[tool] && TOOLS[tool].kind !== 'eraser';
  let unsure = !adds;
  for (const [id, box] of Object.entries(BOXES)) {
    if (box.sheet !== sheet || !rect || !overlaps(rect, box.rect)) continue;
    if (adds && insideOf(rect, box.rect)) setHasInk(id, true);
    else unsure = true;
  }
  if (unsure) scheduleRecheck(sheet);
}

function listen() {
  if (unsubscribe.length) return;
  unsubscribe = [
    on('ink:commit', onInkCommit),
    on('undo:applied', ({ sheet }) => scheduleRecheck(sheet)),
    on('lang:change', remeasureDark),
    on('studio:exit', stopListening),
  ];
}

function stopListening() {
  clearTimeout(recheckTimer);
  for (const off of unsubscribe) off();
  unsubscribe = [];
}

export function build() {
  if (!document.documentElement.classList.contains('paper')) throw new Error('targets.build requires html.paper');
  whileMeasuring(measureAll);
  listen();
  goldenDiff();
}

export function all(sheet) { return bySheet.get(Number(sheet)) ?? []; }

export function get(id) { return table.get(id) ?? null; }

// Nearest target that is not a draw box. A tick's rect is its whole row.
export function hit(sheet, pt, tolSheet = 0) {
  let best = null, bestDistance = Infinity;
  for (const target of all(sheet)) {
    if (target.kind === 'box') continue;
    const d = distance(target.rect, pt);
    if (d <= tolSheet && d < bestDistance) { best = target; bestDistance = d; }
  }
  return best;
}

let cells = [];
export function setCells(list) { cells = list ?? []; }
export function cellAt(sheet, pt) { return cells.find(c => c.sheet === Number(sheet) && contains(c.rect, pt))?.rect ?? null; }

export function boxAt(sheet, pt) {
  for (const target of all(sheet)) if (target.kind === 'box' && contains(target.rect, pt)) return target.id;
  return null;
}

export function dark(sheet) { return darkBySheet.get(Number(sheet)) ?? []; }

export function isDark(sheet, pt) { return dark(sheet).some(r => contains(r, pt)); }

// Works before build() as well, because the reading-view print path shows saved ink without entering Studio.
export function setHasInk(boxId, bool) {
  if (!BOXES[boxId]) return;
  const isOn = !!bool;
  document.querySelector(`.draw[data-box="${boxId}"]`)?.classList.toggle('has-ink', isOn);
  if (inked.has(boxId) === isOn) return;
  if (isOn) inked.add(boxId); else inked.delete(boxId);
  emit('box:ink', { box: boxId, on: isOn });
}

export function hasInk(boxId) { return inked.has(boxId); }

export function goldenDiff() {
  if (!table.size) return ['targets: build() has not run'];
  const diffs = [];
  for (const n of SHEETS) {
    const size = sheetSizes.get(n);
    if (!size || Math.abs(size.w - SHEET_W) > GOLDEN_TOLERANCE_PX || Math.abs(size.h - SHEET_H) > GOLDEN_TOLERANCE_PX) {
      diffs.push(`sheet ${n}: ${size ? size.w + 'x' + size.h : 'missing'}, expected ${SHEET_W}x${SHEET_H}`);
    }
  }
  for (const [id, want] of Object.entries(GOLDEN)) {
    const target = table.get(id);
    if (!target) { diffs.push(`${id}: not in the page`); continue; }
    const { x, y, w, h } = target.rect;
    const got = [x, y, w, h];
    if (got.some((v, i) => Math.abs(v - want[i]) > GOLDEN_TOLERANCE_PX)) diffs.push(`${id}: [${got}] but golden is [${want}]`);
  }
  for (const id of table.keys()) if (!GOLDEN[id]) diffs.push(`${id}: not in GOLDEN`);
  for (const d of diffs) log('golden', d);
  return diffs;
}
