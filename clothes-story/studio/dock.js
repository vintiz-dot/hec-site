// The art supplies, colors, page tiles and parents' menu. Owns #studio-dock and every popover beside it.
// Controls are built once and moved between bars when the layout changes, so their listeners and state survive a rotation.
import { BRUSH_D, DEFAULT_DOTS, DRAWER_TOOLS, MAIN_TOOLS, MIN_SCREEN, SHEETS, SWATCHES, resolveBrush, stitchColor, swatch as swatchById } from './constants.js?v=1';
import { emit, on } from './bus.js?v=1';
import { log } from './diag.js?v=1';
import * as engine from './engine.js?v=1';
import { icon, swatchCard, swatchDefs, swatchDot, swatchPaint } from './icons.js?v=1';
import { applyLabels, lang, t } from './labels.js?v=1';
import * as print from './print.js?v=1';
import * as quest from './quest.js?v=1';
import * as shell from './shell.js?v=1';
import * as speech from './speech.js?v=1';
import * as state from './state.js?v=1';
import { STICKERS, svg as stickerSvg } from './sticker-art.js?v=1';
import * as objects from './objects.js?v=1';
import * as stickers from './stickers.js?v=1';
import * as store from './store.js?v=1';
import * as textures from './textures.js?v=1';
import * as undo from './undo.js?v=1';

const MAX_SIZE_DOT = { S: 22, M: 30, L: 38 };
const SIZES = ['S', 'M', 'L'];
const EXTRA_DOTS = ['white', 'pink', 'orange', 'purple', 'brown', 'sky', 'teal'];
const TILE_PX = 96;
const HOLD_FIRST_MS = 300, HOLD_EVERY_MS = 120;
const REDO_STAYS_MS = 8000;
const RESTART_HOLD_MS = 2000;
const THUMB_W = 72, THUMB_H = 102;
const THUMB_WAIT_MS = 500;
const ONE_BUTTON_BELOW = 340, DROP_DOT_BELOW = 360;
const ART = { // tool art width in px, per layout
  'phone-p': { stick: 56, thing: 52 },
  'tablet-p': { stick: 66, thing: 62 },
  'phone-l': { stick: 46, thing: 42 },
  wide: { stick: 58, thing: 52 },
};

let ui = null, dock = null;
let bars = {};
let c = {};            // the controls
let layout = '';
let offs = [];
let open = null;       // { name, el, opener, closeFn, popOverlay }
let scrim = null;
let tools = new Map(); // tool id -> button
let thumbs = new Map();// sheet -> canvas
let tiles = null;      // fabric id -> data URL
let toolBeforeTray = null;
let undoHold = 0, undoRepeat = 0, redoTimer = 0, thumbTimer = 0, resizeRaf = 0;
let pulses = [];
let beckoned = false; // the first sticker from the tray points once at the cloth
let restart = null;    // the open start-over dialog
let lastUndoState = { canUndo: false, canRedo: false };

const reducedMotion = () => matchMedia('(prefers-reduced-motion:reduce)').matches;
const safely = (what, fn) => {
  try {
    const r = fn();
    if (r?.catch) r.catch(err => log('dock', `${what}: ${err?.message ?? err}`));
    return r;
  } catch (err) {
    log('dock', `${what}: ${err?.message ?? err}`);
    return undefined;
  }
};

function make(tag, className, attrs) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function btn(className, attrs) {
  return make('button', className, { type: 'button', ...attrs });
}

// ---- layout ----

export function layoutFor(w, h) {
  const portrait = h >= w;
  if (w < 600 && portrait) return 'phone-p';
  if (h < 500 && !portrait) return 'phone-l';
  if (w >= 600 && portrait) return 'tablet-p';
  return 'wide';
}

function dotCount() {
  const w = innerWidth;
  if (layout === 'phone-p') return w < DROP_DOT_BELOW ? 5 : 6;
  if (layout === 'phone-l') return 6;
  if (layout === 'tablet-p') return Math.max(6, Math.min(12, Math.floor((w - 16 - 2 * 56) / 50)));
  return 12;
}

function visibleDots() {
  const n = dotCount();
  const dot6 = state.get('dot6') || 'denim';
  const list = [...DEFAULT_DOTS, DEFAULT_DOTS.includes(dot6) ? 'denim' : dot6];
  if (n < 6) list.splice(4, 1); // the hero stays one tap away; navy is in the palette
  for (const id of EXTRA_DOTS) {
    if (list.length >= n) break;
    if (!list.includes(id)) list.push(id);
  }
  return list.slice(0, n);
}

function place() {
  const narrow = innerWidth < ONE_BUTTON_BELOW;
  const useOne = layout === 'phone-l' || narrow;
  const { menu, undoBtn, pages, one, star, toolsEl, colors } = c;
  for (const bar of Object.values(bars)) bar.replaceChildren();
  bars.top.hidden = bars.left.hidden = bars.right.hidden = bars.bottom.hidden = true;
  const fill = (bar, nodes) => { bar.hidden = false; bar.append(...nodes); };
  c.pagesPop.replaceChildren();
  if (useOne) c.pagesPop.append(pages);
  const pageNode = useOne ? one : pages;
  if (layout === 'phone-p' || layout === 'tablet-p') {
    fill(bars.top, [menu, undoBtn, pageNode, star]);
    fill(bars.bottom, [toolsEl, colors]);
  } else if (layout === 'wide') {
    fill(bars.top, [menu, undoBtn, pageNode, star]);
    fill(bars.left, [toolsEl]);
    fill(bars.right, [colors]);
  } else {
    const head = make('div', 'st-rail-head');
    head.append(menu, star);
    fill(bars.left, [undoBtn, toolsEl]);
    fill(bars.right, [head, colors, one]);
  }
}

function paintTools() {
  const sizes = ART[layout];
  for (const [id, button] of tools) {
    const art = button.querySelector('.st-art');
    const isStick = !['fill', 'stickers', 'eraser', 'more'].includes(id);
    art.innerHTML = icon(id === 'more' ? moreArt() : id, isStick ? sizes.stick : sizes.thing);
    art.classList.toggle('st-stick', isStick);
  }
  for (const button of c.drawer.querySelectorAll('.st-drawer-tool')) {
    button.querySelector('.st-art').innerHTML = icon(button.dataset.tool, 52);
  }
  paintTips();
}

function applyLayout() {
  const next = layoutFor(innerWidth, innerHeight);
  const changed = next !== layout;
  layout = next;
  dock.dataset.layout = layout;
  ui.dataset.layout = layout;
  place();
  applyLabels(ui); // place() may have just attached controls that were detached when the language was last applied
  paintTools();
  renderDots();
  paintSize();
  if (changed) closePopover();
  syncInsets();
}

function syncInsets() {
  emit('dock:insets', insets());
  if (open) placePopover();
  if (!c.redo.hidden) placeRedo();
}

function onResize() {
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0;
    if (dock) applyLayout();
  });
}

export function insets() {
  if (!dock) return { t: 0, r: 0, b: 0, l: 0 };
  const box = dock.getBoundingClientRect();
  const rect = bar => (bar.hidden ? null : bar.getBoundingClientRect());
  const top = rect(bars.top), bottom = rect(bars.bottom), left = rect(bars.left), right = rect(bars.right);
  return {
    t: top ? Math.round(top.bottom - box.top) : 0,
    b: bottom ? Math.round(box.bottom - bottom.top) : 0,
    l: left ? Math.round(left.right - box.left) : 0,
    r: right ? Math.round(box.right - right.left) : 0,
  };
}

// ---- swatches ----

function tileOf(fabric) {
  if (!tiles.has(fabric)) {
    tiles.set(fabric, safely('preview ' + fabric, () => textures.previewTile(fabric, TILE_PX)) || '');
  }
  return tiles.get(fabric);
}

function buildDefs() {
  const holder = make('div');
  holder.innerHTML = swatchDefs(tileOf, SWATCHES);
  return holder.firstChild;
}

// The tip of every tool wears the current swatch, including a pattern for cloth.
function paintTips() {
  const sw = swatchById(state.get('swatch'));
  if (!sw || !ui) return;
  const paint = swatchPaint(sw, 'i');
  const thread = stitchColor(sw);
  for (const el of ui.querySelectorAll('.st-art .tip')) el.setAttribute('fill', paint);
  for (const el of ui.querySelectorAll('.st-art .tips')) el.setAttribute('stroke', thread);
}

const wordOf = sw => sw.word[lang()] ?? sw.word.en;

function swatchButton(sw, cls, art) {
  const b = btn(cls, { 'data-sw': sw.id });
  b.innerHTML = art;
  return b;
}

function labelSwatches() {
  for (const b of ui.querySelectorAll('[data-sw]')) {
    const sw = swatchById(b.dataset.sw);
    if (!sw) continue;
    b.setAttribute('aria-label', wordOf(sw));
    b.title = wordOf(sw);
    const cap = b.querySelector('.st-cap');
    if (cap) cap.textContent = wordOf(sw);
  }
  for (const b of c.tray.querySelectorAll('[data-sticker]')) {
    const s = STICKERS.find(x => x.id === b.dataset.sticker);
    const word = s?.word?.[lang()] ?? s?.word?.en ?? '';
    b.setAttribute('aria-label', word);
    b.title = word;
  }
}

function markSwatch() {
  const id = state.get('swatch');
  for (const b of ui.querySelectorAll('[data-sw]')) b.setAttribute('aria-pressed', String(b.dataset.sw === id));
}

function renderDots() {
  const list = visibleDots();
  const px = layout === 'tablet-p' ? 44 : layout === 'wide' ? 46 : 40;
  const current = [...c.dots.children].map(b => `${b.dataset.sw}:${b.firstChild?.getAttribute?.('width')}`).join();
  const wanted = list.map(id => `${id}:${px}`).join();
  if (current !== wanted) {
    c.dots.replaceChildren(...list.map(id => swatchButton(swatchById(id), 'st-dot', swatchDot(swatchById(id), px))));
    labelSwatches();
  }
  markSwatch();
}

function pickSwatch(id) {
  const sw = swatchById(id);
  if (!sw) return;
  safely('speak', () => speech.word(sw.word.en));
  if (!visibleDots().includes(id)) state.set('dot6', id);
  if (state.get('tool') === 'eraser') state.set('tool', state.get('lastDraw') || 'crayon'); // first: leaving a pencil's eraser swaps swatches
  state.set('swatch', id);
  if (stickers.isPlacing()) safely('pour', () => stickers.onSwatchPicked(id));
  else if (objects.current()) safely('pour', () => objects.pour(objects.current(), id));
}

// A real-size dot: the same sum tools.js does for the cursor. Above what fits in the button it stays S < M < L.
function sizeDotPx() {
  const size = state.get('size');
  const sw = swatchById(state.get('swatch'));
  const tool = state.get('tool');
  const brush = sw && BRUSH_D[tool] ? resolveBrush(tool, sw) : tool === 'eraser' ? 'eraser' : 'crayon';
  let nominal = BRUSH_D[brush]?.[size] ?? BRUSH_D.crayon[size];
  if (brush === 'stitch') nominal *= 8;
  if (brush === 'glitter') nominal *= 2;
  const z = state.get('z') || 1;
  const d = nominal * z < MIN_SCREEN[size] ? Math.min(MIN_SCREEN[size] / z, 2 * nominal) : nominal;
  return Math.min(d * z, MAX_SIZE_DOT[size]);
}

function cssPaint(sw) {
  if (state.get('tool') === 'eraser') return '#FFFFFF';
  if (state.get('tool') === 'stitch') return stitchColor(sw);
  if (sw.kind === 'rainbow') return 'linear-gradient(135deg,#F2594B,#FFD60A,#3FA34D,#18A3D0,#7C55C7)';
  if (sw.kind === 'fabric') {
    const url = tileOf(sw.fabric);
    return url ? `url("${url}") center/48px` : ({ denim: '#2C4F8F', stripe: '#16224A', gingham: '#F2594B', polka: '#18A3D0', stars: '#16224A', flower: '#E0457B' })[sw.fabric];
  }
  return sw.hex;
}

function paintSize() {
  const sw = swatchById(state.get('swatch'));
  if (!sw || !c.sizeDot) return;
  const px = sizeDotPx();
  c.sizeDot.style.width = c.sizeDot.style.height = px + 'px';
  c.sizeDot.style.background = cssPaint(sw);
  const size = state.get('size');
  c.size.dataset.la = 'size.' + size;
  applyLabels(c.size);
  const noBrush = ['fill', 'stickers'].includes(state.get('tool'));
  c.size.classList.toggle('st-dim', noBrush);
}

// ---- tools ----

function moreArt() {
  const tool = state.get('tool');
  return DRAWER_TOOLS.includes(tool) ? 'more:' + tool : 'more';
}

function markTool() {
  const tool = state.get('tool');
  const shown = DRAWER_TOOLS.includes(tool) ? 'more' : tool;
  for (const [id, button] of tools) button.setAttribute('aria-pressed', String(id === shown));
  for (const button of c.drawer.querySelectorAll('.st-drawer-tool')) button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
  const more = tools.get('more');
  if (more) {
    more.querySelector('.st-art').innerHTML = icon(moreArt(), ART[layout]?.thing ?? 52);
    paintTips();
  }
  paintSize();
}

function tapTool(id) {
  if (id === 'more') {
    togglePopover('drawer', tools.get('more'));
    return;
  }
  if (id === 'stickers') {
    if (open?.name === 'tray') { closePopover(); return; }
    if (state.get('tool') !== 'stickers') toolBeforeTray = state.get('tool');
    state.set('tool', 'stickers');
    openPopover('tray', tools.get('stickers'));
    return;
  }
  state.set('tool', id);
}

// A pencil is for writing, so it starts as graphite and keeps its own colour; other tools get theirs back.
function swapPencilSwatch({ value, old } = {}) {
  if (value === 'pencil' && old !== 'pencil') {
    state.set('drawSwatch', state.get('swatch'));
    state.set('swatch', state.get('pencilSwatch'));
  } else if (old === 'pencil' && value !== 'pencil') {
    state.set('pencilSwatch', state.get('swatch'));
    state.set('swatch', state.get('drawSwatch'));
  }
}

function pickDrawerTool(id) {
  state.set('tool', id);
  closePopover();
}

// With no sticker in hand the stickers tool would leave the next touch doing nothing, which reads as broken.
function leaveStickersTool() {
  if (state.get('tool') !== 'stickers' || stickers.isPlacing()) return;
  state.set('tool', toolBeforeTray && toolBeforeTray !== 'stickers' ? toolBeforeTray : state.get('lastDraw') || 'crayon');
  toolBeforeTray = null;
}

function onInkCommit(e) {
  if (e?.tool === 'stickers') leaveStickersTool();
  scheduleThumb();
}

function wiggle(tool) {
  const target = tools.get(DRAWER_TOOLS.includes(tool) ? 'more' : tool);
  if (!target || reducedMotion()) return;
  retrigger(target, 'st-wiggle');
}

function retrigger(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth; // so the same animation can play twice in a row
  el.classList.add(cls);
  const timer = setTimeout(() => el.classList.remove(cls), 1600);
  pulses.push(timer);
}

export function pulse(target) {
  if (!dock || reducedMotion() || safely('stroking', () => engine.isStroking())) return;
  if (target === 'star') retrigger(c.star, 'st-pulse');
  else if (target === 'colors') [...c.dots.children].forEach((d, i) => { d.style.setProperty('--i', i); retrigger(d, 'st-ripple'); });
  else if (target === 'denim') {
    const dot = c.dots.querySelector('[data-sw="denim"]');
    if (dot) retrigger(dot, 'st-beckon');
    else pulse('colors');
  } else if (tools.has(target)) retrigger(tools.get(target), 'st-wiggle');
  else if (DRAWER_TOOLS.includes(target)) retrigger(tools.get('more'), 'st-wiggle');
}

// ---- undo and redo ----

function fireUndo() {
  safely('undo', () => undo.undo());
}

function stopHold() {
  clearTimeout(undoHold);
  clearInterval(undoRepeat);
  undoHold = undoRepeat = 0;
}

function onUndoDown(e) {
  if (e.button > 0) return;
  fireUndo();
  stopHold();
  undoHold = setTimeout(() => { undoRepeat = setInterval(fireUndo, HOLD_EVERY_MS); }, HOLD_FIRST_MS);
}

function placeRedo() {
  const r = c.undoBtn.getBoundingClientRect();
  const beside = layout === 'phone-l';
  c.redo.style.left = (beside ? r.right + 6 : r.left) + 'px';
  c.redo.style.top = (beside ? r.top : r.bottom + 8) + 'px';
}

function hideRedo() {
  clearTimeout(redoTimer);
  c.redo.hidden = true;
}

function showRedo() {
  placeRedo();
  c.redo.hidden = false;
  clearTimeout(redoTimer);
  redoTimer = setTimeout(hideRedo, REDO_STAYS_MS);
}

function onUndoState({ canUndo, canRedo } = {}) {
  const undidNow = canRedo && !lastUndoState.canRedo;
  lastUndoState = { canUndo: !!canUndo, canRedo: !!canRedo };
  c.undoBtn.classList.toggle('st-dim', !canUndo);
  if (!canRedo) hideRedo();
  else if (undidNow || !c.redo.hidden) showRedo();
}

// ---- save state ----

function onSaveState({ state: s } = {}) {
  const box = c.save;
  if (!box) return;
  const key = s === 'saving' ? 'saving' : s === 'saved' ? 'saved' : s === 'memory' || s === 'error' ? 'unsaved' : null;
  box.hidden = !key;
  if (!key) return;
  box.dataset.state = key;
  box.querySelector('.st-save-ic').innerHTML = key === 'unsaved' ? icon('warn', 14) : key === 'saved' ? icon('check', 14) : '';
  box.dataset.la = key;
  box.querySelector('.st-save-tx').dataset.l = key;
  applyLabels(box);
}

// ---- page tiles ----

function buildPageButton(n) {
  const b = btn('st-page', { 'data-page': n, 'data-la': 'page.n', 'data-n': n });
  const tile = make('span', 'st-tile');
  const map = make('span', 'st-map');
  map.innerHTML = icon('page' + n);
  const ink = make('canvas', 'st-ink', { width: THUMB_W, height: THUMB_H, 'aria-hidden': 'true' });
  const num = make('span', 'st-num');
  num.textContent = n;
  tile.append(map, ink, num);
  b.append(tile);
  thumbs.set(n, ink);
  return b;
}

function markPages() {
  const page = state.get('page');
  for (const b of c.pages.children) {
    const n = Number(b.dataset.page);
    if (n === page) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
    b.classList.toggle('st-done', safely('pageDone', () => quest.pageDone(n)) === true);
  }
  c.oneNum.textContent = `${page}/${SHEETS.length}`;
}

function goPage(n) {
  closePopover();
  safely('page', () => shell.showPage(n));
}

function drawThumb(n) {
  const canvas = thumbs.get(n);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let source = null;
  if (n === safely('active', () => engine.activeSheet()) && state.get('page') === n) source = engine.paintCanvas();
  else {
    const img = document.querySelector(`.sheet[data-sheet="${n}"]>img.ink`);
    if (img?.getAttribute('src') && img.complete && img.naturalWidth) source = img;
  }
  if (!source || !(source.width > 1)) return;
  ctx.clearRect(0, 0, THUMB_W, THUMB_H);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, THUMB_W, THUMB_H);
}

// Pen-up comes first: a thumbnail is never drawn while a stroke is going.
function scheduleThumb() {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => {
    if (safely('stroking', () => engine.isStroking())) { scheduleThumb(); return; }
    safely('thumb', () => drawThumb(state.get('page')));
  }, THUMB_WAIT_MS);
}

export function refreshThumbs() {
  for (const n of SHEETS) safely('thumb', () => drawThumb(n));
}

// ---- popovers: none of them blocks another, and an outside tap or Android Back closes each ----

function placePopover() {
  if (!open) return;
  const { el, opener } = open;
  el.style.left = el.style.right = el.style.top = el.style.bottom = '';
  const anchored = open.name === 'drawer' || open.name === 'pages';
  if (!anchored || !opener) return;
  const r = opener.getBoundingClientRect();
  if (layout === 'phone-l' || layout === 'wide') {
    if (open.name === 'pages' && layout === 'phone-l') {
      el.style.right = (innerWidth - r.left + 8) + 'px';
      el.style.bottom = (innerHeight - r.bottom) + 'px';
    } else {
      el.style.left = (r.right + 8) + 'px';
      el.style.top = Math.max(8, Math.min(r.top - 40, innerHeight - el.offsetHeight - 8)) + 'px';
    }
  } else if (open.name === 'pages') {
    el.style.left = Math.max(8, r.left - 80) + 'px';
    el.style.top = (r.bottom + 8) + 'px';
  } else {
    el.style.right = Math.max(8, innerWidth - r.right - 4) + 'px';
    el.style.bottom = (innerHeight - r.top + 8) + 'px';
  }
}

function popoverEl(name) {
  return { tray: c.tray, palette: c.palette, drawer: c.drawer, menu: c.menuPop, pages: c.pagesPop }[name];
}

function openPopover(name, opener) {
  if (open) closePopover({ keepStickers: name === 'tray' });
  const el = popoverEl(name);
  el.hidden = false;
  scrim.hidden = false;
  opener?.setAttribute('aria-expanded', 'true');
  open = { name, el, opener };
  open.popOverlay = shell.pushOverlay(() => closePopover({ fromBack: true }));
  if (name === 'menu') refreshMenu();
  placePopover();
}

export function closePopover({ fromBack = false, keepStickers = false } = {}) {
  if (!open) return;
  const { name, el, opener, popOverlay } = open;
  open = null;
  el.hidden = true;
  scrim.hidden = true;
  opener?.removeAttribute('aria-expanded');
  if (!fromBack) popOverlay?.();
  if (name === 'tray' && !keepStickers) leaveStickersTool();
}

function togglePopover(name, opener) {
  if (open?.name === name) closePopover();
  else openPopover(name, opener);
}

function onOutsidePress(e) {
  if (!open) return;
  const target = e.target;
  if (open.el.contains(target) || open.opener?.contains(target)) return;
  closePopover();
  if (target === scrim) holdScrim();
}

// A touch's click is aimed when the finger lifts, so with the scrim gone it would land on the chip underneath.
function holdScrim() {
  const el = scrim;
  el.hidden = false;
  el.classList.add('st-scrim-clear');
  const release = () => {
    window.removeEventListener('pointerup', later, true);
    window.removeEventListener('pointercancel', later, true);
    clearTimeout(safety);
    el.classList.remove('st-scrim-clear');
    if (!open) el.hidden = true;
  };
  const later = () => setTimeout(release, 80);
  const safety = setTimeout(release, 1200);
  window.addEventListener('pointerup', later, true);
  window.addEventListener('pointercancel', later, true);
}

function buildTray() {
  const tray = make('div', 'st-pop st-tray st-scroll', { role: 'group', 'data-la': 'tool.stickers' });
  tray.hidden = true;
  const grid = make('div', 'st-tray-grid');
  for (const s of STICKERS) {
    const b = btn('st-sticker', { 'data-sticker': s.id });
    b.innerHTML = stickerSvg(s.id, 64);
    b.addEventListener('click', () => {
      toolBeforeTray ??= state.get('lastDraw');
      closePopover({ keepStickers: true });
      safely('arm', () => stickers.arm(s.id));
      if (!beckoned) { beckoned = true; pulse('denim'); }
    });
    grid.append(b);
  }
  tray.append(grid);
  return tray;
}

function paletteSection(key, kinds, card) {
  const sec = make('section', 'st-pal-sec');
  const head = make('div', 'st-pal-head', { 'data-l': key });
  const grid = make('div', card ? 'st-pal-cards' : 'st-pal-dots');
  for (const sw of SWATCHES.filter(s => kinds.includes(s.kind))) {
    let b;
    if (card) {
      b = swatchButton(sw, 'st-card', swatchCard(sw, 92, 54));
      b.append(make('span', 'st-cap'));
    } else {
      b = swatchButton(sw, 'st-dot', swatchDot(sw, 40));
    }
    grid.append(b);
  }
  sec.append(head, grid);
  return sec;
}

function buildPalette() {
  const pop = make('div', 'st-pop st-palette st-scroll', { role: 'group', 'data-la': 'palette' });
  pop.hidden = true;
  pop.append(
    paletteSection('palette.colors', ['solid']),
    paletteSection('palette.skin', ['skin']),
    paletteSection('palette.fabric', ['fabric'], true),
    paletteSection('palette.magic', ['rainbow', 'glitter'], true),
  );
  pop.addEventListener('click', e => {
    const b = e.target.closest('[data-sw]');
    if (!b) return;
    pickSwatch(b.dataset.sw);
    closePopover();
  });
  return pop;
}

function buildDrawer() {
  const pop = make('div', 'st-pop st-drawer', { role: 'group', 'data-la': 'tool.more' });
  pop.hidden = true;
  for (const id of DRAWER_TOOLS) {
    const b = btn('st-drawer-tool', { 'data-tool': id, 'data-la': 'tool.' + id });
    const art = make('span', 'st-art');
    const cap = make('span', 'st-cap', { 'data-l': 'tool.' + id });
    b.append(art, cap);
    b.addEventListener('click', () => pickDrawerTool(id));
    pop.append(b);
  }
  return pop;
}

// ---- parents' menu ----

const MENU_ITEMS = [
  ['voice', ''],
  ['speech', 'menu.speech'],
  ['print', 'menu.print'],
  ['copy', 'menu.copy'],
  ['clear', 'menu.clear'],
  ['restart', 'menu.restart'],
  ['record', 'menu.record'],
  ['exit', 'menu.exit'],
];

function buildMenu() {
  const pop = make('div', 'st-pop st-menu st-scroll', { role: 'dialog', 'aria-modal': 'false', 'data-la': 'menu.title' });
  pop.hidden = true;
  const head = make('div', 'st-menu-head');
  head.append(make('div', 'st-menu-title', { role: 'heading', 'aria-level': '2', 'data-l': 'menu.title' }));
  const langs = make('div', 'st-langs', { role: 'group', 'data-la': 'menu.lang' });
  const vi = btn('', { 'data-set-lang': 'vi' });
  vi.textContent = 'Tiếng Việt';
  const en = btn('', { 'data-set-lang': 'en' });
  en.textContent = 'English';
  langs.append(vi, en);
  const list = make('div', 'st-menu-list');
  for (const [act, key] of MENU_ITEMS) {
    const b = btn('st-item', { 'data-act': act });
    if (key) b.dataset.l = key;
    if (act === 'restart' || act === 'clear') b.classList.add('st-danger');
    b.addEventListener('click', () => menuAction(act));
    list.append(b);
  }
  const fine = make('p', 'st-fine', { 'data-l': 'note.evict' });
  const close = btn('st-menu-close', { 'data-l': 'menu.close' });
  close.addEventListener('click', () => closePopover());
  pop.append(head, langs, list, fine, close);
  return pop;
}

function refreshMenu() {
  const muted = !!state.get('muted');
  const voice = c.menuPop.querySelector('[data-act="voice"]');
  voice.dataset.l = muted ? 'menu.voiceOn' : 'menu.voiceOff';
  voice.hidden = safely('voices', () => speech.available()) === false;
  for (const b of c.menuPop.querySelectorAll('[data-set-lang]')) {
    b.setAttribute('aria-pressed', String(b.dataset.setLang === lang()));
  }
  applyLabels(c.menuPop);
}

function clearPage() {
  safely('clear', () => objects.clearSheet(engine.activeSheet()));
  const w = 794, h = 1122;
  safely('clear', () => engine.commitRaster({ x: 0, y: 0, w, h }, (ctx, S) => ctx.clearRect(0, 0, w * S, h * S), { tool: 'clear' }));
}

function menuAction(act) {
  if (act === 'voice') {
    state.set('muted', !state.get('muted'));
    refreshMenu();
    return;
  }
  if (act === 'restart') {
    closePopover();
    openRestart();
    return;
  }
  closePopover();
  if (act === 'speech') safely('speech', () => shell.hearSpeech());
  else if (act === 'print') safely('print', () => print.printPacket());
  else if (act === 'copy') safely('copy', async () => { await store.requestPersist(); await store.savedCopy(); });
  else if (act === 'clear') clearPage();
  else if (act === 'record') safely('record', () => shell.goRecord());
  else if (act === 'exit') safely('exit', () => shell.exit());
}

// ---- start over: for a parent, a long press, never confirm() ----

const RING_R = 52, RING_LEN = 2 * Math.PI * RING_R;

function openRestart() {
  if (restart) return;
  const wrap = make('div', 'st-dialog-wrap');
  const box = make('div', 'st-dialog', { role: 'alertdialog', 'aria-modal': 'true' });
  const title = make('div', 'st-dialog-title', { role: 'heading', 'aria-level': '2', 'data-l': 'restart.title' });
  const body = make('p', 'st-dialog-body', { 'data-l': 'restart.body' });
  const hold = btn('st-hold');
  hold.innerHTML = `<svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true" focusable="false"><circle cx="60" cy="60" r="${RING_R}" fill="#FFFEFB" stroke="#D8DCE7" stroke-width="10"/><circle class="st-ring" cx="60" cy="60" r="${RING_R}" fill="none" stroke="#A32A1C" stroke-width="10" stroke-linecap="round" stroke-dasharray="${RING_LEN}" stroke-dashoffset="${RING_LEN}" transform="rotate(-90 60 60)"/></svg><span class="st-hold-ic">${icon('trash', 40)}</span>`;
  const holdLabel = make('span', 'st-hold-label', { 'data-l': 'restart.hold' });
  hold.append(holdLabel);
  const keep = btn('st-keep', { 'data-l': 'restart.keep' });
  box.append(title, body, hold, keep);
  wrap.append(box);
  ui.append(wrap);
  applyLabels(wrap);

  const ring = hold.querySelector('.st-ring');
  let raf = 0, started = 0, finished = false;
  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    if (!finished) ring.setAttribute('stroke-dashoffset', RING_LEN);
    hold.classList.remove('st-holding');
  };
  const finish = async () => {
    finished = true;
    stop();
    hold.disabled = keep.disabled = true;
    safely('restart', async () => { await shell.startOver(); });
  };
  const step = now => {
    const k = Math.min(1, (now - started) / RESTART_HOLD_MS);
    ring.setAttribute('stroke-dashoffset', RING_LEN * (1 - k));
    if (k >= 1) { finish(); return; }
    raf = requestAnimationFrame(step);
  };
  const begin = () => {
    if (raf || finished) return;
    started = performance.now();
    hold.classList.add('st-holding');
    raf = requestAnimationFrame(step);
  };
  hold.addEventListener('pointerdown', e => { if (!(e.button > 0)) begin(); });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) hold.addEventListener(type, stop);
  hold.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) begin(); });
  hold.addEventListener('keyup', stop);
  hold.addEventListener('contextmenu', e => e.preventDefault());

  const close = () => {
    stop();
    wrap.remove();
    restart = null;
  };
  const popOverlay = shell.pushOverlay(close);
  const closeFromHere = () => { popOverlay(); close(); };
  keep.addEventListener('click', closeFromHere);
  wrap.addEventListener('pointerdown', e => { if (e.target === wrap) closeFromHere(); });
  restart = { close: closeFromHere };
}

// ---- build ----

function buildTools() {
  const row = make('div', 'st-tools', { role: 'toolbar' });
  for (const id of [...MAIN_TOOLS, 'more']) {
    const b = btn('st-tool', { 'data-tool': id, 'data-la': 'tool.' + id });
    const art = make('span', 'st-art');
    const label = make('span', 'st-tool-label', { 'data-l': 'tool.' + id });
    b.append(art, label);
    b.addEventListener('click', () => tapTool(id));
    tools.set(id, b);
    row.append(b);
  }
  return row;
}

function buildControls() {
  // Menu, with the saved tick beside it.
  const menu = make('div', 'st-menu-wrap');
  const menuBtn = btn('st-menu-btn', { 'data-la': 'menu' });
  menuBtn.append(make('span', 'st-menu-tx', { 'data-l': 'menu' }));
  const save = make('span', 'st-save', { role: 'status' });
  save.hidden = true;
  save.append(make('span', 'st-save-ic'), make('span', 'st-save-tx'));
  menu.append(menuBtn, save);
  menuBtn.addEventListener('click', () => togglePopover('menu', menuBtn));

  const undoBtn = btn('st-undo st-dim', { 'data-la': 'undo' });
  undoBtn.innerHTML = `<span class="st-face">${icon('undo', 28)}</span>`;
  undoBtn.addEventListener('pointerdown', onUndoDown);
  for (const type of ['pointerup', 'pointerleave', 'pointercancel', 'lostpointercapture']) undoBtn.addEventListener(type, stopHold);
  undoBtn.addEventListener('click', e => { if (e.detail === 0) fireUndo(); }); // keyboard only; a press already fired
  undoBtn.addEventListener('contextmenu', e => e.preventDefault());

  const redo = btn('st-redo', { 'data-la': 'redo' });
  redo.innerHTML = `<span class="st-face">${icon('redo', 28)}</span>`;
  redo.hidden = true;
  redo.addEventListener('click', () => {
    safely('redo', () => undo.redo());
    showRedo();
  });

  const pages = make('div', 'st-pages');
  for (const n of SHEETS) {
    const b = buildPageButton(n);
    b.addEventListener('click', () => goPage(n));
    pages.append(b);
  }
  const one = btn('st-page-one', { 'data-la': 'page.n', 'data-n': '1' });
  const oneNum = make('span', 'st-tile st-one-tile');
  one.append(oneNum);
  one.addEventListener('click', () => togglePopover('pages', one));

  const star = btn('st-star', { 'data-la': 'star' });
  star.innerHTML = `<span class="st-star-art">${icon('star', 42)}</span>`;
  star.addEventListener('click', () => safely('star', () => quest.go()));

  const toolsEl = buildTools();

  const size = btn('st-size', { 'data-la': 'size.M' });
  const sizeDot = make('i', 'st-size-dot');
  size.append(make('span', 'st-size-ring'), sizeDot);
  size.addEventListener('click', () => {
    const i = SIZES.indexOf(state.get('size'));
    state.set('size', SIZES[(i + 1) % SIZES.length]);
  });

  const dots = make('div', 'st-dots');
  dots.addEventListener('click', e => {
    const b = e.target.closest('[data-sw]');
    if (b) pickSwatch(b.dataset.sw);
  });

  const paletteBtn = btn('st-pal-btn', { 'data-la': 'palette' });
  paletteBtn.innerHTML = `<span class="st-pal-art">${icon('palette', 38)}</span><span class="st-pal-tx" data-l="palette"></span>`;
  paletteBtn.addEventListener('click', () => togglePopover('palette', paletteBtn));

  const colors = make('div', 'st-colors');
  colors.append(size, dots, paletteBtn);

  const tray = buildTray();
  const palette = buildPalette();
  const drawer = buildDrawer();
  const menuPop = buildMenu();
  const pagesPop = make('div', 'st-pop st-pages-pop');
  pagesPop.hidden = true;

  c = { menu, menuBtn, save, undoBtn, redo, pages, one, oneNum, star, toolsEl, size, sizeDot, dots, paletteBtn, colors, tray, palette, drawer, menuPop, pagesPop };
}

function build() {
  tiles = new Map();
  dock = make('div', '', { id: 'studio-dock' });
  bars = {
    top: make('div', 'st-bar st-top'),
    left: make('div', 'st-bar st-left'),
    right: make('div', 'st-bar st-right'),
    bottom: make('div', 'st-bar st-bottom'),
  };
  buildControls();
  dock.append(buildDefs(), bars.top, bars.left, bars.right, bars.bottom, c.redo);
  scrim = make('div', 'st-scrim');
  scrim.hidden = true;
  ui.append(dock, scrim, c.tray, c.palette, c.drawer, c.menuPop, c.pagesPop);
  applyLabels(ui);
}

function subscribe() {
  offs = [
    on('state:tool', swapPencilSwatch),
    on('state:tool', markTool),
    on('state:swatch', () => { paintTips(); renderDots(); paintSize(); }),
    on('state:size', paintSize),
    on('state:dot6', renderDots),
    on('state:z', paintSize),
    on('state:page', markPages),
    on('page:shown', () => { markPages(); scheduleThumb(); hideRedo(); }),
    on('quest:change', markPages),
    on('undo:state', onUndoState),
    on('undo:applied', scheduleThumb),
    on('ink:commit', onInkCommit),
    on('save:state', onSaveState),
    on('tool:wiggle', ({ tool } = {}) => wiggle(tool)),
    on('lang:change', () => {
      applyLabels(ui);
      labelSwatches();
      paintSize();
      markPages();
      syncInsets();
    }),
  ];
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  document.addEventListener('pointerdown', onOutsidePress, true);
  // The layout was measured before fonts arrived, and in Vietnamese they change how wide things are.
  document.fonts?.ready?.then(() => { if (dock) syncInsets(); });
}

// Chrome swallows the click of a tap that lands while the flick ending the last stroke is still dying away, and a child
// goes straight from a fast scribble to a button. A press that really was a tap therefore always gets its click.
const TAP_SLOP_PX = 12, TAP_MAX_MS = 700, CLICK_WAIT_MS = 90, LATE_CLICK_MS = 500;
function rescueTaps(root) {
  let down = null, clicked = false, rescued = null, timer = 0;
  const buttonOf = e => e.target.closest?.('button');
  const onDown = e => {
    down = e.pointerType === 'touch' && e.isPrimary ? { b: buttonOf(e), x: e.clientX, y: e.clientY, at: e.timeStamp } : null;
  };
  const onUp = e => {
    const was = down;
    down = null;
    if (!was?.b || e.pointerType !== 'touch' || buttonOf(e) !== was.b || was.b.matches('.st-undo,.st-hold')) return;
    if (Math.hypot(e.clientX - was.x, e.clientY - was.y) > TAP_SLOP_PX || e.timeStamp - was.at > TAP_MAX_MS) return;
    clicked = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (clicked || !was.b.isConnected) return;
      rescued = { b: was.b, at: performance.now() };
      was.b.click();
    }, CLICK_WAIT_MS);
  };
  const onClick = e => {
    clicked = true;
    if (e.isTrusted && rescued?.b === buttonOf(e) && performance.now() - rescued.at < LATE_CLICK_MS) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
    if (e.isTrusted) rescued = null;
  };
  root.addEventListener('pointerdown', onDown, true);
  root.addEventListener('pointerup', onUp, true);
  root.addEventListener('click', onClick, true);
  return () => {
    clearTimeout(timer);
    root.removeEventListener('pointerdown', onDown, true);
    root.removeEventListener('pointerup', onUp, true);
    root.removeEventListener('click', onClick, true);
  };
}

export function mount(rootEl) {
  if (dock) unmount();
  ui = rootEl;
  layout = '';
  build();
  subscribe();
  offs.push(rescueTaps(ui));
  applyLayout();
  labelSwatches();
  markTool();
  markSwatch();
  markPages();
  lastUndoState = { canUndo: false, canRedo: false };
}

export function unmount() {
  if (!dock) return;
  closePopover();
  restart?.close();
  stopHold();
  clearTimeout(redoTimer);
  clearTimeout(thumbTimer);
  cancelAnimationFrame(resizeRaf);
  resizeRaf = 0;
  for (const timer of pulses) clearTimeout(timer);
  pulses = [];
  for (const off of offs) off();
  offs = [];
  window.removeEventListener('resize', onResize);
  window.removeEventListener('orientationchange', onResize);
  document.removeEventListener('pointerdown', onOutsidePress, true);
  for (const el of [dock, scrim, c.tray, c.palette, c.drawer, c.menuPop, c.pagesPop]) el?.remove();
  dock = scrim = ui = null;
  bars = {};
  c = {};
  tools = new Map();
  thumbs = new Map();
  tiles = null;
  toolBeforeTray = null;
  layout = '';
}
