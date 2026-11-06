// Studio's lifecycle: the order things start and stop in (section 8.6), pages, Box Mode, history, chips and parent notes.
// Any failure on the way in leaves today's page exactly as it was (invariant 6).
import { BOXES, FIELD_ALIAS, LAYOUT_V, SHEETS, STORAGE, TOOLS, swatch as swatchById } from './constants.js?v=1';
import * as constants from './constants.js?v=1';
import { emit, on } from './bus.js?v=1';
import * as bus from './bus.js?v=1';
import { svg as stickerSvg } from './sticker-art.js?v=1';
import * as card from './card.js?v=1';
import * as diag from './diag.js?v=1';
import * as dock from './dock.js?v=1';
import * as engine from './engine.js?v=1';
import * as fields from './fields.js?v=1';
import * as fill from './fill.js?v=1';
import * as fx from './fx.js?v=1';
import { icon } from './icons.js?v=1';
import * as input from './input.js?v=1';
import * as labels from './labels.js?v=1';
import { applyLabels, t } from './labels.js?v=1';
import * as print from './print.js?v=1';
import * as coach from './coach.js?v=1';
import * as objects from './objects.js?v=1';
import * as quest from './quest.js?v=1';
import * as speech from './speech.js?v=1';
import * as state from './state.js?v=1';
import * as stickers from './stickers.js?v=1';
import * as store from './store.js?v=1';
import * as targets from './targets.js?v=1';
import * as tools from './tools.js?v=1';
import * as undo from './undo.js?v=1';
import * as viewport from './viewport.js?v=1';

const { log } = diag;
const GUARD_KEY = 'hec-studio-entering';
const GUARD_CLEAR_MS = 5000;
const FONT_WAIT_MS = 3000;
const NOTE_STAYS_MS = 9000;
const SLIDE_MS = 260;
const CHIP_GAP = 6;
const INK_BOX_PAD = 8;
const META_KEYS = ['tool', 'lastDraw', 'swatch', 'drawSwatch', 'pencilSwatch', 'size', 'muted', 'usage', 'dot6'];
const INAPP = /Zalo|FBAN|FBAV|FB_IAB|Messenger|Instagram/i;

const root = document.documentElement;
let phase = 'off';     // off | entering | on | leaving
let entering = null;
let ui = null, chipLayer = null, noteLayer = null, loader = null;
let chips = null;
let lure = null;       // {box, onTap}: the first-run T-shirt, set by quest
let offs = [];
let guardTimer = 0;
let scrollY0 = 0;
let overlays = [];
let shown = null;      // the sheet on screen
let pageChain = Promise.resolve(), pageWanted = null;
let noteTimer = 0, noteQueue = [], noteNow = null;
let ignorePop = false, leftByBack = false;
let speaking = false;
let keyHandler = null;

const pageEl = () => document.querySelector('.page');
const bookEl = () => document.querySelector('.book');
const sheetEl = n => document.querySelector(`.sheet[data-sheet="${n}"]`);
const reducedMotion = () => matchMedia('(prefers-reduced-motion:reduce)').matches;

function setGuard() { try { sessionStorage.setItem(GUARD_KEY, '1'); } catch { /* private window: no guard, no harm */ } }
function clearGuard() { try { sessionStorage.removeItem(GUARD_KEY); } catch { /* same */ } }

// ---- history: one entry for Studio, re-armed each time Back closes something instead of leaving ----

function arm() {
  history.pushState({ studio: 1 }, '', location.pathname + location.search + '#ve');
}

function armOnEnter() {
  history.scrollRestoration = 'manual';
  if (history.state?.studio) return; // a reload inside Studio: the reading view's entry is already behind us
  if (location.hash === '#ve') history.replaceState(null, '', location.pathname + location.search);
  arm();
}

function onPopState() {
  if (ignorePop) {
    ignorePop = false;
    window.removeEventListener('popstate', onPopState);
    history.scrollRestoration = 'auto';
    return;
  }
  if (phase !== 'on') return;
  const top = overlays.pop();
  if (top) {
    arm();
    try { top(); } catch (err) { log('shell', 'overlay: ' + err.message); }
    return;
  }
  if (state.get('box')) {
    arm();
    leaveBox();
    return;
  }
  leftByBack = true;
  exit();
}

function onKeyDown(e) {
  if (e.key !== 'Escape' || !overlays.length) return;
  const top = overlays.pop();
  try { top(); } catch (err) { log('shell', 'overlay: ' + err.message); }
}

export function pushOverlay(closeFn) {
  overlays.push(closeFn);
  return () => {
    const i = overlays.indexOf(closeFn);
    if (i >= 0) overlays.splice(i, 1);
  };
}

// ---- notes for parents: never a modal in front of the child ----

function hideNote() {
  clearTimeout(noteTimer);
  noteNow = null;
  if (noteLayer) {
    noteLayer.hidden = true;
    noteLayer.replaceChildren();
  }
  const next = noteQueue.shift();
  if (next) showNote(next.key, next.opts);
}

function showNote(key, opts) {
  noteNow = key;
  const text = document.createElement('p');
  text.textContent = t(key);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'st-note-x';
  close.dataset.la = 'menu.close';
  close.innerHTML = icon('close', 20);
  close.addEventListener('click', hideNote);
  noteLayer.replaceChildren(text);
  if (key === 'note.tab') {
    const use = document.createElement('button');
    use.type = 'button';
    use.className = 'st-note-act';
    use.textContent = t('note.useHere');
    use.addEventListener('click', takeOver);
    noteLayer.append(use);
  }
  noteLayer.append(close);
  applyLabels(close);
  noteLayer.hidden = false;
  clearTimeout(noteTimer);
  if (!opts?.sticky) noteTimer = setTimeout(hideNote, NOTE_STAYS_MS);
}

export function note(key, opts = {}) {
  if (!noteLayer) { log('shell', 'note outside Studio: ' + key); return; }
  if (noteNow === key || noteQueue.some(n => n.key === key)) return;
  if (noteNow) noteQueue.push({ key, opts });
  else showNote(key, opts);
}

async function takeOver() {
  hideNote();
  try {
    await store.useHere();
    state.set('readOnly', false);
  } catch (err) {
    log('shell', 'useHere: ' + err.message);
  }
}

// ---- chips: positioned over the stage from view:change ----

function chip(className, iconName, labelKey, onTap) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'st-chip ' + className;
  b.innerHTML = icon(iconName, 26);
  if (labelKey) {
    const span = document.createElement('span');
    span.dataset.l = labelKey;
    b.append(span);
    b.dataset.la = labelKey;
  }
  b.hidden = true;
  b.addEventListener('click', onTap);
  chipLayer.append(b);
  return b;
}

function buildChips() {
  chipLayer.replaceChildren();
  chips = { zoom: {}, peg: {} };
  for (const id of Object.keys(BOXES)) {
    chips.zoom[id] = chip('st-chip-zoom', 'zoom', null, () => enterBox(id));
    chips.zoom[id].dataset.la = 'box.zoom';
    chips.peg[id] = chip('st-chip-peg', 'peg', 'line.hang', () => openLine());
  }
  chips.whole = chip('st-chip-whole', 'whole', 'box.whole', () => {
    if (state.get('box')) leaveBox();
    else viewport.fit({ animate: true });
  });
  chips.mirror = chip('st-chip-mirror', 'mirror', null, () => setMirror(!state.get('mirror')));
  chips.stop = chip('st-chip-stop', 'stop', 'speech.stop', () => speech.stop());
  chips.axis = document.createElement('div');
  chips.axis.className = 'st-axis';
  chips.axis.hidden = true;
  chipLayer.append(chips.axis);
  chips.lure = document.createElement('button');
  chips.lure.type = 'button';
  chips.lure.className = 'st-chip-lure';
  chips.lure.hidden = true;
  chips.lure.setAttribute('aria-label', 'T-shirt');
  chips.lure.innerHTML = `<span class="st-lure-card">${stickerSvg('tshirt', 60)}</span>`; // our own art data
  chips.lure.addEventListener('click', () => lure?.onTap());
  chipLayer.append(chips.lure);
  chips.hint = document.createElement('div');
  chips.hint.className = 'st-box-hint';
  chips.hint.hidden = true;
  chipLayer.append(chips.hint);
  applyLabels(chipLayer);
  labelMirror();
}

function labelMirror() {
  if (!chips) return;
  const on = !!state.get('mirror');
  chips.mirror.dataset.la = on ? 'mirror.on' : 'mirror.off';
  chips.mirror.setAttribute('aria-pressed', String(on));
  applyLabels(chips.mirror);
}

function freeRect() {
  const r = pageEl().getBoundingClientRect();
  return { l: r.left, t: r.top, r: r.right, b: r.bottom };
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

function put(el, x, y) {
  el.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
}

const PEG_LABEL_MIN_BOX = 300;
function placeBoxChips(id, free, box, page) {
  const def = BOXES[id];
  const onSheet = page === def.sheet;
  const zoomChip = chips.zoom[id], pegChip = chips.peg[id];
  const showZoom = onSheet && !box;
  const showPeg = onSheet && targets.hasInk(id) && (!box || box === id);
  zoomChip.hidden = !showZoom;
  pegChip.hidden = !showPeg;
  if (!showZoom && !showPeg) return;
  const a = viewport.toClient(def.rect.x, def.rect.y);
  const b = viewport.toClient(def.rect.x + def.rect.w, def.rect.y + def.rect.h);
  if (showZoom) {
    const w = zoomChip.offsetWidth, h = zoomChip.offsetHeight;
    const x = b.x - w - CHIP_GAP, y = a.y + CHIP_GAP;
    zoomChip.hidden = x < free.l - w || x > free.r || y < free.t - h || y > free.b;
    put(zoomChip, x, y);
  }
  if (showPeg) {
    // Drawing comes first: it keeps to the box's corner, and on a small box the peg alone says it.
    pegChip.classList.toggle('st-chip-compact', b.x - a.x < PEG_LABEL_MIN_BOX);
    const w = pegChip.offsetWidth, h = pegChip.offsetHeight;
    const y = clamp(b.y - h - CHIP_GAP, free.t + CHIP_GAP, free.b - h - CHIP_GAP);
    const cx = (a.x + b.x) / 2;
    pegChip.hidden = cx < free.l || cx > free.r || b.y < free.t || a.y > free.b;
    put(pegChip, clamp(b.x - w - CHIP_GAP, free.l + CHIP_GAP, free.r - w - CHIP_GAP), y);
  }
}

function placeChips() {
  if (!chips || phase !== 'on') return;
  const free = freeRect();
  const box = state.get('box'), page = state.get('page');
  for (const id of Object.keys(BOXES)) placeBoxChips(id, free, box, page);
  chips.whole.hidden = !(box || viewport.isZoomed());
  if (!chips.whole.hidden) put(chips.whole, free.l + CHIP_GAP, free.t + CHIP_GAP);
  chips.mirror.hidden = !box;
  if (box) put(chips.mirror, free.r - chips.mirror.offsetWidth - CHIP_GAP, free.t + CHIP_GAP);
  chips.stop.hidden = !speaking;
  if (speaking) put(chips.stop, (free.l + free.r - chips.stop.offsetWidth) / 2, free.b - chips.stop.offsetHeight - 12);
  placeAxis(box, free);
  placeHint();
  placeLure(box, page, free);
}

function placeAxis(box, free) {
  const on = !!(box && state.get('mirror'));
  chips.axis.hidden = !on;
  if (!on) return;
  const r = BOXES[box].rect;
  const a = viewport.toClient(r.x + r.w / 2, r.y), b = viewport.toClient(r.x + r.w / 2, r.y + r.h);
  const top = Math.max(a.y, free.t), bottom = Math.min(b.y, free.b);
  chips.axis.style.height = Math.max(0, bottom - top) + 'px';
  put(chips.axis, a.x, top);
}

// A T-shirt sticker waiting in the corner of the empty first box: the gasp is this tap and one colour tap.
const LURE_MIN_BOX = 180;
function placeLure(box, page, free) {
  const def = lure && BOXES[lure.box];
  const on = !!def && page === def.sheet && (!box || box === lure.box) && !targets.hasInk(lure.box)
    && !document.documentElement.classList.contains('st-placing');
  if (!on) { chips.lure.hidden = true; return; }
  const a = viewport.toClient(def.rect.x, def.rect.y), b = viewport.toClient(def.rect.x + def.rect.w, def.rect.y + def.rect.h);
  chips.lure.hidden = b.x - a.x < LURE_MIN_BOX || b.y - a.y < LURE_MIN_BOX;
  if (chips.lure.hidden) return;
  const size = chips.lure.offsetWidth;
  const bottom = Math.min(b.y, free.b), right = Math.min(b.x, free.r);
  chips.lure.hidden = bottom - Math.max(a.y, free.t) < size + 24;
  put(chips.lure, right - size - 14, bottom - size - 14);
}

export function setLure(boxId, onTap) {
  lure = boxId ? { box: boxId, onTap } : null;
  placeChips();
}

function placeHint() {
  const id = chips.hint.dataset.box;
  chips.hint.hidden = !id || reducedMotion() || BOXES[id].sheet !== state.get('page');
  if (chips.hint.hidden) return;
  const r = BOXES[id].rect;
  const a = viewport.toClient(r.x, r.y), b = viewport.toClient(r.x + r.w, r.y + r.h);
  chips.hint.style.width = (b.x - a.x) + 'px';
  chips.hint.style.height = (b.y - a.y) + 'px';
  put(chips.hint, a.x, a.y);
}

// The tablet intro's pulsing gold edge. On top of the page rather than in it, so nothing inside the scaled stage repaints.
export function hintBox(id) {
  if (!chips) return;
  chips.hint.dataset.box = id || '';
  placeHint();
}

function setMirror(on) {
  const box = state.get('box');
  const value = !!(on && box);
  state.set('mirror', value);
  engine.setMirror(value ? BOXES[box].rect.x + BOXES[box].rect.w / 2 : null);
  labelMirror();
  placeChips();
}

// ---- pages ----

function slide(n, from) {
  const el = sheetEl(n);
  if (!from || !el?.animate || reducedMotion()) return;
  const dir = n > from ? 1 : -1;
  el.animate([{ transform: `translateX(${dir * 56}px)`, opacity: .35 }, { transform: 'none', opacity: 1 }], { duration: SLIDE_MS, easing: 'cubic-bezier(.2,.8,.2,1)' });
}

async function swapPage(n) {
  const from = shown;
  if (from === n) return;
  if (state.get('box')) leaveBox({ animate: false });
  if (stickers.isPlacing()) stickers.commit();
  await engine.flush();
  if (from) {
    await engine.whileHurrying(async () => {
      try {
        await store.saveNow(from);
      } catch (err) {
        log('shell', 'save before page change: ' + err.message);
      }
      await engine.publishActiveImg();
    });
  }
  const ink = await store.getInk(n);
  await engine.showSheet(n, ink);
  if (from) sheetEl(from)?.classList.remove('on');
  sheetEl(n)?.classList.add('on');
  shown = n;
  state.set('page', n);
  viewport.fit();
  slide(n, from);
  store.saveMeta({ page: n });
  emit('page:shown', { n });
  placeChips();
}

// Requests made while a page is changing collapse to the last one. Every caller gets a promise that ends after it.
export function showPage(n) {
  const wanted = Number(n);
  if (!SHEETS.includes(wanted)) return Promise.resolve();
  pageWanted = wanted;
  pageChain = pageChain.then(async () => {
    if (pageWanted !== wanted || (phase !== 'on' && phase !== 'entering')) return;
    try {
      await swapPage(wanted);
    } catch (err) {
      log('shell', `page ${wanted}: ${err?.message ?? err}`);
      if (phase === 'entering') throw err;
    }
  });
  return pageChain;
}

// ---- Box Mode ----

export function enterBox(id, { cell } = {}) {
  const def = BOXES[id];
  if (!def || phase !== 'on') return;
  if (state.get('page') !== def.sheet) {
    showPage(def.sheet).then(() => enterBox(id, { cell }));
    return;
  }
  if (stickers.isPlacing()) stickers.commit();
  if (state.get('box') !== id) {
    if (state.get('mirror')) setMirror(false);
    state.set('box', id);
  }
  engine.setClip(cell ?? def.rect);
  viewport.frameRect(cell ?? def.rect, { pad: INK_BOX_PAD, animate: true });
  emit('box:change', { box: id });
  placeChips();
}

export function leaveBox({ animate = true } = {}) {
  if (!state.get('box')) return;
  if (stickers.isPlacing()) stickers.commit();
  setMirror(false);
  state.set('box', null);
  engine.setClip(null);
  viewport.fit({ animate });
  emit('box:change', { box: null });
  placeChips();
}

// ---- things Star and the menu both do ----

export async function openLine() {
  try {
    const line = await import('./washline.js?v=1');
    if (!line.canOpen()) return false;
    await showPage(1);
    quest.mark('line');
    await line.open();
    return true;
  } catch (err) {
    log('shell', 'washing line: ' + err.message);
    return false;
  }
}

export function hearSpeech() {
  speaking = true;
  placeChips();
  speech.script({
    onEnd: ({ stopped } = {}) => {
      speaking = false;
      placeChips();
      if (!stopped) quest.mark('speech');
    },
  });
}

async function flushAll() {
  if (stickers.isPlacing()) stickers.commit();
  await engine.flush();
  await store.saveNow();
}

// The Next Star's last step, and the menu's: nothing about this page travels with the visit.
export async function goRecord({ ready = false } = {}) {
  if (!ready) { coach.rehearse(); return; } // always through the speech first
  try {
    await flushAll();
  } catch (err) {
    log('shell', 'flush before record: ' + err.message);
  }
  quest.mark('record');
  location.href = 'record.html';
}

export async function startOver() {
  try {
    await store.clearAll();
    objects.reset();
    coach.reset();
  } catch (err) {
    log('shell', 'clear: ' + err.message);
  }
  clearGuard();
  location.reload();
}

// ---- entering ----

function fontGate() {
  if (!document.fonts?.load) return Promise.resolve();
  const wait = new Promise(resolve => setTimeout(resolve, FONT_WAIT_MS));
  const font = document.fonts.load('700 18px "Nunito Paper"', 'Hello').catch(err => log('shell', 'font: ' + err.message));
  return Promise.race([font, wait]);
}

function makeUi() {
  ui = document.createElement('div');
  ui.id = 'studio-ui';
  chipLayer = document.createElement('div');
  chipLayer.id = 'studio-chips';
  noteLayer = document.createElement('div');
  noteLayer.id = 'studio-note';
  noteLayer.setAttribute('role', 'status');
  noteLayer.hidden = true;
  loader = document.createElement('div');
  loader.className = 'st-loader';
  loader.innerHTML = icon('crayon', 56);
  ui.append(chipLayer, noteLayer, loader);
  document.body.append(ui);
}

function writeInsets(ins) {
  const { t: top = 0, r = 0, b = 0, l = 0 } = ins ?? dock.insets();
  root.style.setProperty('--ins-t', top + 'px');
  root.style.setProperty('--ins-r', r + 'px');
  root.style.setProperty('--ins-b', b + 'px');
  root.style.setProperty('--ins-l', l + 'px');
}

function clearInsets() {
  for (const side of ['t', 'r', 'b', 'l']) root.style.removeProperty('--ins-' + side);
}

function restoreState(meta = {}) {
  const toolOk = id => TOOLS[id] && !(id === 'paint' && state.get('scale') === 1);
  if (toolOk(meta.lastDraw) && TOOLS[meta.lastDraw].kind === 'brush') state.set('lastDraw', meta.lastDraw);
  else if (toolOk(meta.tool) && TOOLS[meta.tool].kind === 'brush') state.set('lastDraw', meta.tool);
  // A sticker in hand does not survive a reload, and the stickers tool alone would leave the first touch dead.
  if (toolOk(meta.tool) && meta.tool !== 'stickers') state.set('tool', meta.tool);
  else state.set('tool', state.get('lastDraw'));
  if (swatchById(meta.swatch)) state.set('swatch', meta.swatch);
  if (swatchById(meta.drawSwatch)) state.set('drawSwatch', meta.drawSwatch);
  if (swatchById(meta.pencilSwatch)) state.set('pencilSwatch', meta.pencilSwatch);
  if (['S', 'M', 'L'].includes(meta.size)) state.set('size', meta.size);
  if (typeof meta.muted === 'boolean') state.set('muted', meta.muted);
  if (meta.usage && typeof meta.usage === 'object') state.set('usage', meta.usage);
  if (swatchById(meta.dot6)) state.set('dot6', meta.dot6);
}

function restoreSaved(saved) {
  const { meta = {}, fields: values = {}, sheets = {} } = saved ?? {};
  fields.init(values);
  let layoutMoved = false;
  for (const n of SHEETS) {
    const rec = sheets[n];
    fill.setRegions(n, rec?.regions ?? []);
    if (rec?.hasInk && rec.layoutV !== undefined && rec.layoutV !== LAYOUT_V[n]) layoutMoved = true;
  }
  restoreState(meta);
  const inked = meta.boxesInk;
  for (const id of Object.keys(BOXES)) targets.setHasInk(id, Array.isArray(inked) ? inked.includes(id) : !!inked?.[id]);
  return { meta, layoutMoved };
}

function listen() {
  offs = [
    on('view:change', placeChips),
    on('dock:insets', ins => {
      writeInsets(ins);
      viewport.refit();
      placeChips();
    }),
    on('box:ink', ({ box, on: inked } = {}) => {
      store.saveMeta({ boxesInk: Object.keys(BOXES).filter(id => targets.hasInk(id)) });
      if (box && inked) quest.refresh();
      placeChips();
    }),
    on('state:mirror', labelMirror),
    on('lang:change', () => {
      if (ui) applyLabels(chipLayer);
      if (noteNow) showNote(noteNow, { sticky: !noteTimer });
      placeChips();
    }),
  ];
  for (const key of META_KEYS) offs.push(on('state:' + key, ({ value } = {}) => store.saveMeta({ [key]: value })));
  window.addEventListener('popstate', onPopState);
  keyHandler = onKeyDown;
  window.addEventListener('keydown', keyHandler);
}

function unlisten() {
  for (const off of offs) off();
  offs = [];
  if (keyHandler) window.removeEventListener('keydown', keyHandler);
  keyHandler = null;
}

// A reload inside Studio restarts at the top, so where the reading view was has to survive it.
function rememberReadingScroll() {
  try {
    if (history.state?.studio) return Number(sessionStorage.getItem('hec-studio-y')) || 0;
    sessionStorage.setItem('hec-studio-y', String(window.scrollY));
  } catch { /* storage blocked: only the scroll position on exit is lost */ }
  return window.scrollY;
}

async function run({ page, box, target, rehearse } = {}) {
  phase = 'entering';
  scrollY0 = rememberReadingScroll();
  setGuard();
  root.classList.add('st-settled'); // leaving paper mode must not replay the reading view's entrance
  root.classList.add('paper');
  makeUi();
  armOnEnter();
  await fontGate();
  targets.build();
  await engine.init();
  const opened = await store.open();
  state.set('mode', opened?.mode ?? 'memory');
  state.set('readOnly', !!opened?.readOnly);
  const { meta, layoutMoved } = restoreSaved(await store.load());
  dock.mount(ui);
  buildChips();
  writeInsets();
  viewport.init(pageEl(), bookEl());
  fx.mount();
  print.install();
  input.attach(pageEl(), tools.handlers());
  listen();
  const targetDef = target ? targets.get(target) : null;
  const boxDef = BOXES[box];
  const first = targetDef?.sheet ?? boxDef?.sheet ?? (SHEETS.includes(page) ? page : meta.page);
  await showPage(SHEETS.includes(first) ? first : 1);
  phase = 'on';
  loader?.remove();
  loader = null;
  placeChips();
  dock.refreshThumbs();
  emit('studio:enter');
  if (boxDef) enterBox(box);
  if (targetDef) fields.open(FIELD_ALIAS[target] && target !== 'p1-name' && target !== 'p3-name' ? FIELD_ALIAS[target] : target);
  const guide = !boxDef && !targetDef && !rehearse && !meta.coach?.started && !new URLSearchParams(location.search).has('noguide');
  objects.init(meta.objects);
  coach.init(meta.coach);
  quest.start({ meta, quiet: !!(boxDef || targetDef || rehearse) || guide });
  if (rehearse) coach.rehearse();
  else if (guide) coach.begin();
  if (opened?.readOnly) note('note.tab', { sticky: true });
  else if (opened?.mode === 'memory') note('note.private', { sticky: true });
  if (layoutMoved) note('note.layout');
  if (INAPP.test(navigator.userAgent)) note('note.inapp', { sticky: true });
  guardTimer = setTimeout(clearGuard, GUARD_CLEAR_MS);
}

export function enter(args = {}) {
  if (phase === 'on') return Promise.resolve();
  if (entering) return entering;
  entering = run(args).catch(abort).finally(() => { entering = null; });
  return entering;
}

// ---- leaving ----

function tearDown() {
  const steps = [
    () => quest.stop(),
    () => speech.stop(),
    () => input.detach(),
    () => print.uninstall(),
    () => unlisten(),
    () => fx.unmount(),
    () => viewport.destroy(),
    () => dock.unmount(),
    () => emit('studio:exit'),
    () => engine.release(),
  ];
  for (const step of steps) {
    try { step(); } catch (err) { log('shell', 'teardown: ' + err.message); }
  }
  clearTimeout(guardTimer);
  clearTimeout(noteTimer);
  noteQueue = [];
  noteNow = null;
  overlays = [];
  chips = null;
  speaking = false;
  shown = null;
  pageWanted = null;
  pageChain = Promise.resolve();
  state.set('box', null);
  state.set('mirror', false);
  for (const el of document.querySelectorAll('.sheet.on')) el.classList.remove('on');
  ui?.remove();
  ui = chipLayer = noteLayer = loader = null;
  clearInsets();
  root.classList.remove('paper');
}

export async function exit() {
  if (phase !== 'on') return;
  phase = 'leaving';
  clearTimeout(guardTimer);
  clearGuard();
  try {
    await engine.whileHurrying(flushAll);
    await store.close();
  } catch (err) {
    log('shell', 'exit: ' + err.message);
  }
  tearDown();
  window.scrollTo(0, scrollY0);
  if (leftByBack) {
    leftByBack = false;
    window.removeEventListener('popstate', onPopState);
    history.scrollRestoration = 'auto';
  } else if (history.state?.studio) {
    ignorePop = true;
    history.back();
  } else {
    window.removeEventListener('popstate', onPopState);
    history.scrollRestoration = 'auto';
  }
  phase = 'off';
  emit('studio:left');
}

export function abort(err) {
  log('shell', 'abort: ' + (err?.stack ?? err?.message ?? err));
  if (phase === 'off') return;
  phase = 'leaving';
  tearDown();
  try { store.close()?.catch?.(() => {}); } catch { /* it never opened */ }
  window.removeEventListener('popstate', onPopState);
  history.scrollRestoration = 'auto';
  // The guard stays set only for a crash. This failure was caught, and with the hash gone a reload stays in the reading view.
  if (location.hash === '#ve') history.replaceState(null, '', location.pathname + location.search);
  clearGuard();
  window.scrollTo(0, scrollY0);
  phase = 'off';
  emit('studio:abort');
  emit('studio:left');
}

// ---- ?test=1 only, called by boot.js ----

export function expose() {
  window.__studio = {
    bus, card, coach, objects, constants, diag, dock, engine, fields, fill, fx, input, labels, print, quest, shell: { enter, exit, abort, showPage, enterBox, leaveBox, pushOverlay, note, hintBox, openLine, hearSpeech, goRecord, startOver }, speech, state, stickers, store, targets, tools, undo, viewport,
  };
}
