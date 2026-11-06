// The handwriting pad: a child writes big on notebook ruling, and the word comes out as a small cropped PNG.
// Strokes are kept as points, so a rotated phone can redraw them and one stroke can be taken back.
import { LIMITS } from './constants.js?v=1';
import { getStroke } from '../vendor/perfect-freehand.js?v=1';

const INK = '#1F3FA8';
const OUTPUT_HEIGHTS = [96, 64, 48, 32]; // the first is the size asked for, the rest are the guard against padMaxBytes
const OUTPUT_MAX_W = 800;
const SMALL_COPY_PX = 256;
const ALPHA_MIN = 8;
const PALM_MS = 5000;   // after a stylus, a finger landing is most likely the hand holding it
const SVG_NS = 'http://www.w3.org/2000/svg';
const BASE = { thinning: .5, smoothing: .6, streamline: .5, start: { cap: true }, end: { cap: true } };

function outlinePath(outline) {
  const path = new Path2D();
  if (!outline.length) return path;
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i <= outline.length; i++) {
    const [ax, ay] = outline[i % outline.length];
    const [bx, by] = outline[(i + 1) % outline.length];
    path.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
  }
  path.closePath();
  return path;
}

const strokePath = (stroke, last) => outlinePath(getStroke(stroke.pts, {
  ...BASE, size: stroke.size, simulatePressure: !stroke.pen, last,
}));

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function line(svg, x1, y1, x2, y2, stroke, width, dash) {
  const el = document.createElementNS(SVG_NS, 'line');
  for (const [k, v] of Object.entries({ x1, y1, x2, y2, stroke, 'stroke-width': width })) el.setAttribute(k, v);
  if (dash) el.setAttribute('stroke-dasharray', dash);
  svg.append(el);
}

// Four guide lines and the middle band emphasised, with the small squares of a Vietnamese "ô li" notebook behind them.
function drawSchool(svg, w, h) {
  const mid = Math.max(44, Math.min(120, h * .22));
  const side = mid * .72;
  const top = Math.round((h - mid - 2 * side) / 2);
  const ys = [top, top + side, top + side + mid, top + side + mid + side];
  const cell = mid / 3;
  const shade = document.createElementNS(SVG_NS, 'rect');
  for (const [k, v] of Object.entries({ x: 0, y: ys[1], width: w, height: mid, fill: 'rgba(42,91,215,.07)' })) shade.setAttribute(k, v);
  svg.append(shade);
  for (let x = cell; x < w; x += cell) line(svg, x, ys[0], x, ys[3], '#E2EBFA', 1);
  for (let y = ys[0] + cell; y < ys[3]; y += cell) line(svg, 0, y, w, y, '#E2EBFA', 1);
  line(svg, 0, ys[0], w, ys[0], '#B9CFF2', 1.5);
  line(svg, 0, ys[1], w, ys[1], '#6E97E0', 2);
  line(svg, 0, ys[2], w, ys[2], '#6E97E0', 2);
  line(svg, 0, ys[3], w, ys[3], '#B9CFF2', 1.5);
}

// One line to sign on.
function drawSign(svg, w, h) {
  const y = Math.round(h * .66);
  line(svg, 16, y, w - 16, y, '#4F5878', 2, '2 6');
}

// onStart fires when a stroke begins, onChange after any stroke, clear or undo. Additive: undo(), lastBox().
export function mountPad(hostEl, { guide = 'school', onStart, onChange } = {}) {
  const S = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
  const strokes = [];
  let w = 0, h = 0;
  let now = null;
  let activeId = null;
  let lastPen = -Infinity;
  let frame = 0;
  let origin = null;
  let crop = null;
  let alive = true;

  const box = document.createElement('div');
  box.className = 'pad';
  box.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;overflow:hidden';
  const rule = document.createElementNS(SVG_NS, 'svg');
  rule.setAttribute('aria-hidden', 'true');
  rule.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none';
  const ink = makeCanvas(1, 1);
  const live = makeCanvas(1, 1);
  const layer = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none';
  ink.style.cssText = layer;
  live.style.cssText = layer;
  const surface = document.createElement('div');
  surface.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;cursor:crosshair';
  box.append(rule, ink, live, surface);
  hostEl.append(box);
  const inkCtx = ink.getContext('2d');
  const liveCtx = live.getContext('2d');

  const lineWidth = () => (guide === 'school' ? Math.max(8, Math.min(13, h / 30)) : Math.max(4, Math.min(6, h / 60)));

  function paintRule() {
    rule.replaceChildren();
    if (guide === 'school') drawSchool(rule, w, h);
    else drawSign(rule, w, h);
  }

  function redrawInk() {
    inkCtx.setTransform(S, 0, 0, S, 0, 0);
    inkCtx.clearRect(0, 0, w, h);
    inkCtx.fillStyle = INK;
    for (const stroke of strokes) inkCtx.fill(strokePath(stroke, true));
  }

  function clearLive() {
    liveCtx.setTransform(S, 0, 0, S, 0, 0);
    liveCtx.clearRect(0, 0, w, h);
  }

  function resize() {
    const nw = box.clientWidth, nh = box.clientHeight;
    if (!alive || !nw || !nh || (nw === w && nh === h)) return; // hidden tab: keep everything as it is
    if (strokes.length && w && h) {
      const k = Math.min(nw / w, nh / h);
      for (const stroke of strokes) {
        stroke.size *= k;
        for (const pt of stroke.pts) { pt[0] *= k; pt[1] *= k; }
      }
    }
    w = nw;
    h = nh;
    ink.width = live.width = Math.round(w * S);
    ink.height = live.height = Math.round(h * S);
    rule.setAttribute('viewBox', `0 0 ${w} ${h}`);
    paintRule();
    redrawInk();
    clearLive();
  }

  function drawLive() {
    frame = 0;
    if (!now) return;
    clearLive();
    liveCtx.fillStyle = INK;
    liveCtx.fill(strokePath(now, false));
  }

  const toPoint = e => [e.clientX - origin.left, e.clientY - origin.top, e.pointerType === 'pen' ? e.pressure ** .7 : .5];

  function down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'touch' && e.timeStamp - lastPen < PALM_MS) return;
    if (activeId !== null) {
      if (e.pointerType !== 'pen' || !now || now.pen) return; // one finger only; a stylus beats the palm that landed first
      discard();
    }
    if (!w || !h) resize();
    activeId = e.pointerId;
    try { surface.setPointerCapture(e.pointerId); } catch { /* the pointer already left; its up still arrives here or never mattered */ }
    origin = surface.getBoundingClientRect();
    if (e.pointerType === 'pen') lastPen = e.timeStamp;
    now = { pts: [toPoint(e)], pen: e.pointerType === 'pen', size: lineWidth() };
    onStart?.();
    drawLive();
  }

  function move(e) {
    if (e.pointerId !== activeId || !now) return;
    if (now.pen) lastPen = e.timeStamp;
    const list = e.getCoalescedEvents?.();
    for (const c of list?.length ? list : [e]) now.pts.push(toPoint(c));
    frame ||= requestAnimationFrame(drawLive);
  }

  function discard() {
    cancelAnimationFrame(frame);
    frame = 0;
    now = null;
    activeId = null;
    clearLive();
  }

  // Never through rAF, which stops in a hidden tab.
  function finish(e) {
    if (e.pointerId !== activeId || !now) return;
    const stroke = now;
    discard();
    strokes.push(stroke);
    inkCtx.setTransform(S, 0, 0, S, 0, 0);
    inkCtx.fillStyle = INK;
    inkCtx.fill(strokePath(stroke, true));
    onChange?.();
  }

  // Stops the iOS magnifier and double-tap zoom. Pointer events keep coming.
  const stopTouch = e => e.preventDefault();

  surface.addEventListener('pointerdown', down);
  surface.addEventListener('pointermove', move);
  surface.addEventListener('pointerup', finish);
  surface.addEventListener('pointercancel', finish);
  surface.addEventListener('lostpointercapture', finish);
  surface.addEventListener('touchstart', stopTouch, { passive: false });
  surface.addEventListener('contextmenu', stopTouch);

  const observer = window.ResizeObserver ? new ResizeObserver(resize) : null;
  observer?.observe(box);
  if (!observer) window.addEventListener('resize', resize);
  resize();

  // The alpha box of the ink, in backing px. Pixels are read from a small copy, never from the big canvas.
  function inkBounds() {
    const k = Math.min(1, SMALL_COPY_PX / Math.max(ink.width, ink.height));
    const sw = Math.max(1, Math.round(ink.width * k)), sh = Math.max(1, Math.round(ink.height * k));
    const copy = makeCanvas(sw, sh);
    const copyCtx = copy.getContext('2d', { willReadFrequently: true });
    copyCtx.drawImage(ink, 0, 0, sw, sh);
    const { data } = copyCtx.getImageData(0, 0, sw, sh);
    let x0 = sw, y0 = sh, x1 = -1, y1 = -1;
    for (let y = 0, i = 3; y < sh; y++) {
      for (let x = 0; x < sw; x++, i += 4) {
        if (data[i] <= ALPHA_MIN) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return null;
    const margin = Math.ceil(1 / k) + 2;
    const left = Math.max(0, Math.floor(x0 / k) - margin), top = Math.max(0, Math.floor(y0 / k) - margin);
    const right = Math.min(ink.width, Math.ceil((x1 + 1) / k) + margin), bottom = Math.min(ink.height, Math.ceil((y1 + 1) / k) + margin);
    return { x: left, y: top, w: right - left, h: bottom - top };
  }

  // Halving first: one big drawImage drops thin strokes in some browsers.
  function encode(from, maxH) {
    const scale = Math.min(1, maxH / from.h, OUTPUT_MAX_W / from.w);
    const dw = Math.max(1, Math.round(from.w * scale)), dh = Math.max(1, Math.round(from.h * scale));
    let src = ink, sx = from.x, sy = from.y, sw = from.w, sh = from.h;
    while (sw >= dw * 2 && sh >= dh * 2) {
      const tw = Math.ceil(sw / 2), th = Math.ceil(sh / 2);
      const half = makeCanvas(tw, th);
      const c = half.getContext('2d');
      c.imageSmoothingQuality = 'high';
      c.drawImage(src, sx, sy, sw, sh, 0, 0, tw, th);
      src = half;
      sx = sy = 0;
      sw = tw;
      sh = th;
    }
    const out = makeCanvas(dw, dh);
    const c = out.getContext('2d');
    c.imageSmoothingQuality = 'high';
    c.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
    return out.toDataURL('image/png');
  }

  return {
    clear() {
      discard();
      strokes.length = 0;
      redrawInk();
      onChange?.();
    },
    undo() {
      discard();
      strokes.pop();
      redrawInk();
      onChange?.();
    },
    isEmpty: () => strokes.length === 0,
    // Does its work before returning, so the caller may destroy the pad straight after the call.
    toDataURL() {
      crop = strokes.length ? inkBounds() : null;
      if (!crop) return Promise.resolve('');
      let src = '';
      for (const maxH of OUTPUT_HEIGHTS) {
        src = encode(crop, maxH);
        if (src.length <= LIMITS.padMaxBytes) break;
      }
      return Promise.resolve(src);
    },
    // Where the last crop sits on screen, for the flight into the blank.
    lastBox() {
      if (!crop) return null;
      const r = box.getBoundingClientRect();
      return { left: r.left + crop.x / S, top: r.top + crop.y / S, width: crop.w / S, height: crop.h / S };
    },
    destroy() {
      alive = false;
      discard();
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', resize);
      ink.width = ink.height = live.width = live.height = 1; // gives the memory back at once on iOS
      box.remove();
    },
  };
}
