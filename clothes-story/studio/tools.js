// Routes each press to what the current tool does with it (section 5.5), records what the child used for
// "the page remembers", and owns the cursor dot.
import { BRUSH_D, LIMITS, MIN_SCREEN, TOOLS, resolveBrush, stitchColor, swatch as swatchById } from './constants.js?v=1';
import { emit, on } from './bus.js?v=1';
import { log } from './diag.js?v=1';
import * as engine from './engine.js?v=1';
import * as fields from './fields.js?v=1';
import * as fill from './fill.js?v=1';
import * as fx from './fx.js?v=1';
import * as state from './state.js?v=1';
import * as objects from './objects.js?v=1';
import * as stickers from './stickers.js?v=1';
import * as targets from './targets.js?v=1';
import * as viewport from './viewport.js?v=1';

const HIT_SCREEN_PX = 24;
const FIXED_DOT_PX = 14;   // tools without a brush size
const STITCH_DOT = 8;      // the stitch table holds scales of an 8 sheet px stitch
const FABRIC_DOT = { denim: '#2C4F8F', stripe: '#16224A', gingham: '#F2594B', polka: '#18A3D0', stars: '#16224A', flower: '#E0457B' };
const RAINBOW_DOT = 'linear-gradient(135deg,#F2594B,#FFD60A,#3FA34D,#18A3D0,#7C55C7)';

let press = null; // { route: 'stroke'|'sticker'|'fill'|'none', hit, down, last, travel, sparkles }
let offs = [];
let cursor = null;
let dotShown = false, spaceHeld = false, dragging = false;

const toolKind = () => TOOLS[state.get('tool')]?.kind;

function beginStroke(pt, toolId, eraserOverride) {
  fill.finishReveal(); // a new stroke during a reveal finishes it at once
  const opts = { toolId, swatchId: state.get('swatch'), size: state.get('size'), z: viewport.z() };
  if (eraserOverride) opts.eraserOverride = true;
  engine.beginStroke(pt, opts);
  press.route = 'stroke';
  if (!eraserOverride && toolId !== 'eraser' && toolId !== 'paint') engine.setStrokeSink(objects.sinkFor(objects.at(pt)));
  press.sparkles = toolId !== 'eraser';
  press.onlyDark = press.sparkles && targets.isDark(engine.activeSheet(), pt);
}

// A mark wholly over a dark panel is invisible, so it must not cost the child an undo that seems to do nothing.
function endInk(p) {
  if (!p.onlyDark) { engine.endStroke(); return; }
  engine.cancelStroke();
  const c = viewport.toClient(p.last.x, p.last.y);
  fx.sparkle(c.x, c.y);
}

function onInkStart(pt, type, opts = {}) {
  press = { route: 'none', hit: null, down: pt, last: pt, travel: 0, sparkles: false };
  if (type === 'touch' && dotShown) onLeave(); // a hybrid laptop: the mouse's dot must not sit there while a finger draws
  if (state.get('readOnly')) return;
  if (opts.eraserOverride) { // the pen's eraser end erases whatever tool is picked
    if (stickers.isPlacing()) stickers.commit();
    beginStroke(pt, 'eraser', true);
    return;
  }
  if (stickers.isPlacing()) {
    const hit = stickers.pointerDown(pt);
    if (hit) {
      press.route = 'sticker';
      press.hit = hit;
      return;
    }
    stickers.commit();
  }
  if (objects.pointerDown(pt)) {
    press.route = 'object';
    return;
  }
  const kind = toolKind();
  if (kind === 'fill') press.route = 'fill';
  else if (kind !== 'sticker') beginStroke(pt, state.get('tool'), false);
}

function onInkMove(pts) {
  if (!press) return;
  const last = pts[pts.length - 1];
  press.last = last;
  press.travel = Math.max(press.travel, Math.hypot(last.x - press.down.x, last.y - press.down.y) * viewport.z());
  if (press.route === 'object') {
    objects.pointerMove(last);
  } else if (press.route === 'sticker') {
    stickers.pointerMove(last);
  } else if (press.route === 'stroke') {
    engine.extendStroke(pts);
    if (press.onlyDark && !pts.every(q => targets.isDark(engine.activeSheet(), q))) press.onlyDark = false;
    if (press.sparkles && targets.isDark(engine.activeSheet(), last)) {
      const c = viewport.toClient(last.x, last.y);
      fx.sparkle(c.x, c.y);
    }
  }
  if (last.type !== 'touch') {
    const c = viewport.toClient(last.x, last.y);
    placeCursor(c.x, c.y);
  }
}

function onInkEnd({ lifted = false } = {}) {
  const p = press;
  press = null;
  if (!p) return;
  if (p.route === 'stroke') { if (p.travel >= LIMITS.tapMaxPx) objects.select(null); endInk(p); }
  else if (p.route === 'object') objects.pointerUp(p.last, false);
  else if (p.route === 'sticker') stickers.pointerUp(p.last, false);
  else if (!lifted) return; // a pinch or a lost pointer ended it: nobody asked for a pour or a Card
  else if (p.travel < LIMITS.tapMaxPx) tapAt(p.down, false); // a slow press is still a tap for a tool that makes no mark
  else if (p.route === 'fill') emit('tool:wiggle', { tool: 'crayon' }); // dragging is what the crayon is for
}

function onInkCancel() {
  const p = press;
  press = null;
  if (!p) return;
  if (p.route === 'stroke') {
    engine.cancelStroke();
  } else if (p.route === 'object') {
    objects.pointerCancel();
  } else if (p.route === 'sticker') { // walk it back to where the press began, which reverts a drag and a scale alike
    stickers.pointerMove(p.down);
    stickers.pointerUp(p.down, false);
  }
}

function pour(pt) {
  const sheet = engine.activeSheet();
  const spot = stickers.takeRedirect(pt);
  const hit = objects.at(spot);
  if (hit) {
    objects.select(hit);
    objects.pour(hit, state.get('swatch'), spot);
    emit('fill:result', { result: 'ok', pt: spot });
    return;
  }
  objects.select(null);
  const box = state.get('box') || targets.boxAt(sheet, spot) || undefined;
  fill.finishReveal();
  Promise.resolve(fill.pour(sheet, spot, state.get('swatch'), { box, near: targets.cellAt(sheet, spot) ?? undefined })).catch(err => log('tools', 'pour: ' + err.message));
}

function tapAt(pt, stroking, p) {
  if (state.get('readOnly')) return;
  if (toolKind() !== 'fill') { // like a design tool: a tap on a sticker picks it up, a tap elsewhere puts it down
    const hit = objects.at(pt);
    if (hit || objects.current()) {
      if (stroking) engine.cancelStroke();
      objects.select(hit);
      return;
    }
  }
  if (!state.get('box')) {
    const target = targets.hit(engine.activeSheet(), pt, HIT_SCREEN_PX / viewport.z());
    if (target) {
      if (stroking) engine.cancelStroke();
      if (target.kind === 'tick') fields.toggleTick(target.id);
      else fields.open(target.id);
      return;
    }
  }
  if (stroking) endInk(p);
  else if (toolKind() === 'fill') pour(pt);
}

function onTap(pt) {
  const p = press;
  press = null;
  if (p?.route === 'object') {
    objects.pointerUp(pt, true);
    return;
  }
  if (p?.route === 'sticker') {
    stickers.pointerUp(pt, true);
    if (p.hit !== 'scale') {
      if (stickers.isPlacing()) stickers.commit();
      pour(pt);
    }
    return;
  }
  tapAt(pt, p?.route === 'stroke', p);
}

function onFillResult({ result, pt } = {}) {
  if (result === 'ok' || !pt) return;
  emit('tool:wiggle', { tool: 'fill' });
  const c = viewport.toClient(pt.x, pt.y);
  fx.ripple(c.x, c.y);
  if (targets.isDark(engine.activeSheet(), pt)) fx.sparkle(c.x, c.y);
}

function addOnce(list = [], item) {
  return list.includes(item) ? list : [...list, item];
}

function recordUsage({ sheet, rect, tool, swatchId, stickerId } = {}) {
  if (!rect || tool === 'eraser') return;
  const box = targets.boxAt(sheet, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
  if (!box) return;
  const sw = swatchId ? swatchById(swatchId) : null;
  const usage = state.get('usage') ?? {};
  const was = usage[box] ?? { colors: [], stickers: [] };
  const now = {
    colors: sw?.kind === 'solid' && tool !== 'stickers' ? addOnce(was.colors, sw.word.en) : was.colors,
    stickers: tool === 'stickers' && (stickerId || (swatchId && !sw)) ? addOnce(was.stickers, stickerId || swatchId) : was.stickers,
  };
  if (now.colors !== was.colors || now.stickers !== was.stickers) state.set('usage', { ...usage, [box]: now });
}

function onToolChange({ value } = {}) {
  if (TOOLS[value]?.kind === 'brush') state.set('lastDraw', value);
  if (value !== 'stickers' && stickers.isPlacing()) stickers.commit();
  styleCursor();
}

// ---- cursor dot: real size, current color. Lives inside #studio-ui so it never prints. ----

// Same rule the engine uses, so what the dot promises is what the stroke paints.
function dotSize() {
  const size = state.get('size');
  const sw = swatchById(state.get('swatch'));
  const brush = sw ? resolveBrush(state.get('tool'), sw) : state.get('tool');
  let nominal = BRUSH_D[brush]?.[size];
  if (nominal === undefined) return FIXED_DOT_PX;
  if (brush === 'stitch') nominal *= STITCH_DOT;
  if (brush === 'glitter') nominal *= 2; // this one row of the table holds a radius
  const z = viewport.z();
  const d = nominal * z < MIN_SCREEN[size] ? Math.min(MIN_SCREEN[size] / z, 2 * nominal) : nominal;
  return d * z;
}

function dotPaint() {
  const sw = swatchById(state.get('swatch'));
  if (toolKind() === 'eraser' || !sw) return '#FFFFFF';
  if (state.get('tool') === 'stitch') return stitchColor(sw);
  if (sw.kind === 'rainbow') return RAINBOW_DOT;
  if (sw.kind === 'fabric') return FABRIC_DOT[sw.fabric] ?? sw.thread;
  return sw.hex;
}

function styleCursor() {
  if (!cursor) return;
  const size = dotSize();
  cursor.style.width = cursor.style.height = size + 'px';
  cursor.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`;
  cursor.style.background = dotPaint();
}

function ensureCursor() {
  if (cursor) return;
  cursor = document.createElement('div');
  cursor.id = 'st-cursor';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.style.cssText = 'position:fixed;left:0;top:0;display:none;border-radius:50%;pointer-events:none;z-index:36;' +
    'box-shadow:0 0 0 1.5px rgba(22,34,74,.6),0 0 0 3px rgba(255,255,255,.75)';
  (document.getElementById('studio-ui') ?? document.body).append(cursor);
  styleCursor();
}

function syncPageCursor() {
  const page = document.querySelector('.page');
  if (page) page.style.cursor = spaceHeld ? (dragging ? 'grabbing' : 'grab') : dotShown ? 'none' : '';
  if (cursor) cursor.style.display = dotShown && !spaceHeld ? 'block' : 'none';
}

function placeCursor(cx, cy) {
  ensureCursor();
  cursor.style.transform = `translate(${cx}px,${cy}px)`;
  if (!dotShown) {
    dotShown = true;
    syncPageCursor();
  }
}

function onHover(cx, cy) {
  placeCursor(cx, cy);
}

function onLeave() {
  dotShown = false;
  syncPageCursor();
}

function onSpace(held, isDragging) {
  spaceHeld = held;
  dragging = !!isDragging;
  syncPageCursor();
}

function teardown() {
  for (const off of offs) off();
  offs = [];
  press = null;
  dotShown = spaceHeld = dragging = false;
  syncPageCursor();
  cursor?.remove();
  cursor = null;
}

export function handlers() {
  if (!offs.length) {
    offs = [
      on('ink:commit', recordUsage),
      on('object:added', recordUsage),
      on('fill:result', onFillResult),
      on('state:tool', onToolChange),
      on('state:swatch', styleCursor),
      on('state:size', styleCursor),
      on('view:change', styleCursor),
      on('studio:exit', teardown),
    ];
  }
  return { onInkStart, onInkMove, onInkEnd, onInkCancel, onTap, onHover, onLeave, onSpace };
}
