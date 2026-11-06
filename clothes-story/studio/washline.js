// The washing line, section 2.7 and 4.9. The child's two drawings peel off the paper as die-cut paper shapes, fly up and
// peg onto a line above the packet's question. Nothing here changes ink: every picture is a copy made once per open.
import { on } from './bus.js?v=1';
import { BOXES } from './constants.js?v=1';
import { log } from './diag.js?v=1';
import * as engine from './engine.js?v=1';
import * as fields from './fields.js?v=1';
import { isSafeInk } from './fit.js?v=1';
import { icon } from './icons.js?v=1';
import { lang, t, tIn } from './labels.js?v=1';
import * as shell from './shell.js?v=1';
import * as objects from './objects.js?v=1';
import * as speech from './speech.js?v=1';
import * as stickers from './stickers.js?v=1';
import * as targets from './targets.js?v=1';
import * as viewport from './viewport.js?v=1';

const BOX_IDS = ['p1-uniform', 'p1-weekend'];
const NAVY = '#16224A', PAPER = '#FFFEFB', THREAD = '#FFC21A', GOLD = '#C99A1E', HOUSE = '#E7EAF1';
const BODY_FONT = '"Be Vietnam Pro","Nunito",system-ui,sans-serif';
const HAND_FONT = '"Playpen Hand","Be Vietnam Pro",system-ui,sans-serif';

const CELL = 3;           // sheet px per mask cell
const STRIPS = 24;
const CLOTH_K = 200, CLOTH_C = 2.4;
const SWING_K = 34, SWING_C = 1.05, SWAY = .02;
const MAX_SHEAR = .25, MAX_W = 40;
const LINE_NODES = 34, LINE_K = 900, LINE_C = 3.2;
const FLY_MS = 860, BACK_MS = 430, IDLE_MS = 20000, STEP = 1 / 60;

let scene = null;

const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const now = () => performance.now();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const easeInOut = k => (k < .5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const easeOutBack = k => 1 + 2.1 * (k - 1) ** 3 + 1.1 * (k - 1) ** 2;
const makeCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
};

// ---- reading the drawing: only ever from small canvases of our own (invariant 5) ----

function snapshotBox(id) {
  const { rect } = BOXES[id];
  const S = engine.scale();
  const snap = makeCanvas(rect.w * S, rect.h * S);
  snap.getContext('2d').drawImage(engine.paintCanvas(), rect.x * S, rect.y * S, rect.w * S, rect.h * S, 0, 0, snap.width, snap.height);
  objects.drawInto(snap.getContext('2d'), rect, S);
  const cols = Math.ceil(rect.w / CELL), rows = Math.ceil(rect.h / CELL);
  const small = makeCanvas(cols, rows);
  const x = small.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high';
  x.drawImage(snap, 0, 0, cols, rows);
  const data = x.getImageData(0, 0, cols, rows).data;
  const ink = new Uint8Array(cols * rows);
  let count = 0, x0 = cols, x1 = -1, y0 = rows, y1 = -1;
  for (let r = 0, i = 3; r < rows; r++) {
    for (let c = 0; c < cols; c++, i += 4) {
      if (data[i] <= 10) continue;
      ink[r * cols + c] = 1;
      count++;
      if (c < x0) x0 = c;
      if (c > x1) x1 = c;
      if (r < y0) y0 = r;
      if (r > y1) y1 = r;
    }
  }
  if (count < 3) return { id, empty: true, rect };
  return { id, empty: false, rect, snap, shape: dieCut(ink, cols, { x0, x1, y0, y1 }, rect) };
}

// Chamfer distance to the nearest set cell. One border row and column are enough: shapes keep their padding inside.
function distanceTo(mask, cols, rows, setValue = 1) {
  const d = new Float32Array(cols * rows).fill(1e6);
  for (let i = 0; i < d.length; i++) if (mask[i] === setValue) d[i] = 0;
  const D = 1.41;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      let v = d[i];
      if (c > 0 && d[i - 1] + 1 < v) v = d[i - 1] + 1;
      if (r > 0) {
        if (d[i - cols] + 1 < v) v = d[i - cols] + 1;
        if (c > 0 && d[i - cols - 1] + D < v) v = d[i - cols - 1] + D;
        if (c < cols - 1 && d[i - cols + 1] + D < v) v = d[i - cols + 1] + D;
      }
      d[i] = v;
    }
  }
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      let v = d[i];
      if (c < cols - 1 && d[i + 1] + 1 < v) v = d[i + 1] + 1;
      if (r < rows - 1) {
        if (d[i + cols] + 1 < v) v = d[i + cols] + 1;
        if (c < cols - 1 && d[i + cols + 1] + D < v) v = d[i + cols + 1] + D;
        if (c > 0 && d[i + cols - 1] + D < v) v = d[i + cols - 1] + D;
      }
      d[i] = v;
    }
  }
  return d;
}

function fillHoles(mask, cols, rows) {
  const outside = new Uint8Array(mask.length), stack = [];
  const push = i => { if (!mask[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
  for (let c = 0; c < cols; c++) { push(c); push((rows - 1) * cols + c); }
  for (let r = 0; r < rows; r++) { push(r * cols); push(r * cols + cols - 1); }
  while (stack.length) {
    const i = stack.pop(), c = i % cols;
    if (c > 0) push(i - 1);
    if (c < cols - 1) push(i + 1);
    if (i >= cols) push(i - cols);
    if (i < mask.length - cols) push(i + cols);
  }
  for (let i = 0; i < mask.length; i++) if (!outside[i]) mask[i] = 1;
}

// A paper thread between stray pieces, so a sun in the corner is cut out with the shirt, not left floating.
function bridgePieces(mask, cols, rows) {
  const label = new Int32Array(mask.length), pieces = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s]) continue;
    const id = pieces.length + 1, cells = [s], stack = [s];
    label[s] = id;
    while (stack.length) {
      const i = stack.pop(), c = i % cols;
      for (const n of [c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1, i - cols, i + cols]) {
        if (n < 0 || n >= mask.length || !mask[n] || label[n]) continue;
        label[n] = id;
        cells.push(n);
        stack.push(n);
      }
    }
    pieces.push(cells);
  }
  if (pieces.length < 2) return;
  pieces.sort((a, b) => b.length - a.length);
  const main = pieces[0].filter((_, n) => n % 3 === 0);
  for (const piece of pieces.slice(1)) {
    let best = Infinity, from = 0, to = 0;
    for (const a of piece.filter((_, n) => n % 3 === 0 || piece.length < 9)) {
      const ax = a % cols, ay = (a - ax) / cols;
      for (const b of main) {
        const bx = b % cols, by = (b - bx) / cols, dist = (ax - bx) ** 2 + (ay - by) ** 2;
        if (dist < best) { best = dist; from = a; to = b; }
      }
    }
    const fx = from % cols, fy = (from - fx) / cols, tx = to % cols, ty = (to - tx) / cols;
    const steps = Math.ceil(Math.sqrt(best)) + 1;
    for (let s = 0; s <= steps; s++) {
      const cx = Math.round(lerp(fx, tx, s / steps)), cy = Math.round(lerp(fy, ty, s / steps));
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) mask[ny * cols + nx] = 1;
      }
    }
  }
}

function dieCut(ink, srcCols, b, rect) {
  const pad = 7;
  const cols = b.x1 - b.x0 + 1 + pad * 2, rows = b.y1 - b.y0 + 1 + pad * 2;
  const solid = new Uint8Array(cols * rows);
  for (let r = b.y0; r <= b.y1; r++) {
    for (let c = b.x0; c <= b.x1; c++) {
      if (ink[r * srcCols + c]) solid[(r - b.y0 + pad) * cols + c - b.x0 + pad] = 1;
    }
  }
  // Close gaps up to about 30 sheet px, then shrink back to leave a 7px paper rim around the ink.
  const grow = distanceTo(solid, cols, rows);
  const closed = new Uint8Array(solid.length);
  for (let i = 0; i < closed.length; i++) closed[i] = grow[i] <= 5 ? 1 : 0;
  const inward = distanceTo(closed, cols, rows, 0);
  const mask = new Uint8Array(solid.length);
  for (let i = 0; i < mask.length; i++) mask[i] = inward[i] > 2.6 ? 1 : 0;
  for (let i = 0; i < mask.length; i++) if (solid[i]) mask[i] = 1;
  bridgePieces(mask, cols, rows);
  fillHoles(mask, cols, rows);

  let left = cols, right = -1, top = rows, bottom = -1;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!mask[r * cols + c]) continue;
    if (c < left) left = c;
    if (c > right) right = c;
    if (r < top) top = r;
    if (r > bottom) bottom = r;
  }
  const pegs = addPaperTabs(mask, cols, rows, { left, right, top });
  // Soften the stair steps; the threshold in silhouette() turns this back into a clean cut edge.
  let field = Float32Array.from(mask, v => v * 255);
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(field.length);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = c + dx, ny = r + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        sum += field[ny * cols + nx];
        n++;
      }
      next[r * cols + c] = sum / n;
    }
    field = next;
  }
  const fieldCanvas = makeCanvas(cols, rows);
  const fx = fieldCanvas.getContext('2d', { willReadFrequently: true });
  const img = fx.createImageData(cols, rows);
  for (let i = 0; i < field.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = field[i];
  }
  fx.putImageData(img, 0, 0);
  // Sheet px of the shape, relative to the box, and where the bottom of the shape is widest for the name tag.
  const originX = (b.x0 - pad) * CELL, originY = (b.y0 - pad) * CELL;
  let sum = 0, n = 0;
  for (let c = 0; c < cols; c++) if (mask[bottom * cols + c]) { sum += c; n++; }
  return {
    fieldCanvas, originX, originY, cols, rows, left, right, top, bottom, pegs,
    tagAt: n ? sum / n : (left + right) / 2,
    w: (right - left + 3) * CELL, h: (bottom - top + 3) * CELL,
  };
}

// Paper-doll tabs: the top of a drawing is rarely flat, so a tab rises to the line at each peg.
function addPaperTabs(mask, cols, rows, { left, right, top }) {
  const span = right - left;
  const middle = (left + right) / 2;
  const wanted = span < 16 ? [middle - 7, middle + 7] : [left + span * .25, left + span * .75];
  const half = 3;
  return wanted.map(target => {
    const col = clamp(Math.round(target), half, cols - half - 1);
    let hit = -1;
    for (let r = top; r < rows && hit < 0; r++) if (mask[r * cols + col]) hit = r;
    const until = hit < 0 ? top + 3 : hit + 2;
    for (let r = top; r <= until && r < rows; r++) {
      for (let c = col - half; c <= col + half; c++) mask[r * cols + c] = 1;
    }
    if (hit < 0) {
      const toward = col < middle ? 1 : -1;
      for (let c = col; c !== Math.round(middle); c += toward) {
        for (let r = top; r <= top + 2; r++) mask[r * cols + c] = 1;
      }
    }
    return col;
  });
}

// ---- turning a shape into pictures ----

// The cut edge is worked out at about one canvas px per css px, however sharp the screen: reading pixels is the slow part.
function silhouette(shape, cw, ch, cellPx, pr) {
  const down = Math.max(1, pr);
  const small = makeCanvas(cw / down, ch / down);
  const x = small.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  const k = cellPx / down;
  x.drawImage(shape.fieldCanvas, -(shape.left - 1) * k, -(shape.top - 1) * k, shape.cols * k, shape.rows * k);
  const img = x.getImageData(0, 0, small.width, small.height), d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = clamp((d[i] - 112) * 8, 0, 255);
  x.putImageData(img, 0, 0);
  if (down === 1) return small;
  const c = makeCanvas(cw, ch);
  const out = c.getContext('2d');
  out.imageSmoothingQuality = 'high';
  out.drawImage(small, 0, 0, small.width * down, small.height * down);
  return c;
}

function tint(mask, color) {
  const c = makeCanvas(mask.width, mask.height);
  const x = c.getContext('2d');
  x.drawImage(mask, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

// Half css resolution: it is a blur, so nobody sees the difference and it rasters far faster.
function softShadow(mask, pr) {
  const k = .5 / pr, blur = 6, pad = 14;
  const w = mask.width * k, h = mask.height * k;
  const c = makeCanvas(w + pad * 2, h + pad * 2);
  const x = c.getContext('2d');
  // Drawn off the canvas so only its blurred shadow lands: canvas shadows blur the same way in every browser.
  x.shadowColor = NAVY;
  x.shadowBlur = blur;
  x.shadowOffsetX = c.width;
  x.drawImage(mask, pad - c.width, pad, w, h);
  return { canvas: c, pad: pad * 2, w: c.width * 2, h: c.height * 2 };
}

function wrap(x, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    const next = line ? line + ' ' + word : word;
    if (line && x.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function roundRectPath(x, l, t2, w, h, r) {
  x.beginPath();
  x.moveTo(l + r, t2);
  x.arcTo(l + w, t2, l + w, t2 + h, r);
  x.arcTo(l + w, t2 + h, l, t2 + h, r);
  x.arcTo(l, t2 + h, l, t2, r);
  x.arcTo(l, t2, l + w, t2, r);
  x.closePath();
}

// A small sewn-in label with the box's title. Sizes are in final canvas px.
function measureTag(text, fontPx, maxWidth) {
  const x = makeCanvas(2, 2).getContext('2d');
  const usable = px => maxWidth - px * 1.5;
  let size = fontPx;
  for (let px = fontPx; px >= fontPx * .84; px -= fontPx * .04) {
    x.font = `700 ${px}px ${BODY_FONT}`;
    if (x.measureText(text).width <= usable(px)) { size = px; break; }
  }
  x.font = `700 ${size}px ${BODY_FONT}`;
  let lines = wrap(x, text, usable(size));
  if (lines.length > 1) {
    for (let w = usable(size); w > usable(size) * .4; w -= usable(size) * .05) {
      const tighter = wrap(x, text, w);
      if (tighter.length > lines.length) break;
      lines = tighter;
    }
  }
  const padX = size * .75, padY = size * .42, lead = size * 1.24;
  const width = Math.max(...lines.map(l => x.measureText(l).width)) + padX * 2;
  return { lines, fontPx: size, lead, padY, w: width, h: lines.length * lead + padY * 2 };
}

function tagCanvas(tag) {
  const pad = Math.ceil(tag.fontPx * .7);
  const c = makeCanvas(tag.w + pad * 2, tag.h + pad * 2);
  const x = c.getContext('2d');
  x.translate(c.width / 2, c.height / 2);
  x.shadowColor = 'rgba(22,34,74,.25)';
  x.shadowBlur = tag.fontPx * .35;
  x.shadowOffsetY = tag.fontPx * .14;
  x.fillStyle = NAVY;
  roundRectPath(x, -tag.w / 2, -tag.h / 2, tag.w, tag.h, tag.fontPx * .42);
  x.fill();
  x.shadowColor = 'transparent';
  x.strokeStyle = THREAD;
  x.lineWidth = Math.max(1, tag.fontPx * .085);
  x.setLineDash([tag.fontPx * .4, tag.fontPx * .3]);
  const inset = tag.fontPx * .2;
  roundRectPath(x, -tag.w / 2 + inset, -tag.h / 2 + inset, tag.w - inset * 2, tag.h - inset * 2, tag.fontPx * .28);
  x.stroke();
  x.setLineDash([]);
  x.fillStyle = PAPER;
  x.font = `700 ${tag.fontPx}px ${BODY_FONT}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  tag.lines.forEach((line, i) => x.fillText(line, 0, (i - (tag.lines.length - 1) / 2) * tag.lead + tag.fontPx * .04));
  return { canvas: c, pad, w: c.width, h: c.height, bodyH: tag.h, fontPx: tag.fontPx };
}

// Everything one hanging piece needs. sc is css px per sheet px, pr is canvas px per css px.
function pictureOf(item, sc, pr, title, fontCss, tagMaxCss) {
  const { shape, snap, rect } = item;
  const k = sc * pr, cellPx = CELL * k;
  const bodyW = shape.w * k, bodyH = shape.h * k;
  const rim = Math.ceil(2.5 * pr);
  const mask = silhouette(shape, bodyW, bodyH, cellPx, pr);
  const sprite = makeCanvas(bodyW + rim * 2, bodyH + rim * 2);
  const x = sprite.getContext('2d');
  // A crisp little contact shadow, then paper, then the ink: reads as cut paper even on pale sky.
  x.globalAlpha = .2;
  x.drawImage(tint(mask, NAVY), rim, 1.6 * pr);
  x.globalAlpha = 1;
  x.drawImage(tint(mask, PAPER), rim, 0);
  // originX is box-relative, so box (0,0) sits at this offset inside the sprite.
  const boxX = rim - ((shape.left - 1) * CELL + shape.originX) * k;
  const boxY = -((shape.top - 1) * CELL + shape.originY) * k;
  x.drawImage(snap, boxX, boxY, rect.w * k, rect.h * k);
  const tag = tagCanvas(measureTag(title, fontCss * pr, tagMaxCss * pr));
  return finishPicture(sprite, pr, {
    boxX: boxX / pr,
    boxY: boxY / pr,
    pegX: shape.pegs.map(col => (rim + (col - shape.left + 1 + .5) * cellPx) / pr),
    topInset: CELL * sc,
    mask,
    maskX: rim,
    tag,
    tagX: (rim + (shape.tagAt - shape.left + 1) * cellPx) / pr,
    tagY: (bodyH - tag.fontPx * .5) / pr,
  });
}

function placeholderPicture(sc, w, h, pr, title, text, fontCss, tagMaxCss) {
  const bodyW = w * pr, bodyH = h * pr, rim = Math.ceil(2.5 * pr);
  const mask = makeCanvas(bodyW, bodyH);
  const m = mask.getContext('2d');
  m.fillStyle = '#fff';
  roundRectPath(m, 0, 0, bodyW, bodyH, 16 * pr);
  m.fill();
  const sprite = makeCanvas(bodyW + rim * 2, bodyH + rim * 2);
  const x = sprite.getContext('2d');
  x.globalAlpha = .2;
  x.drawImage(tint(mask, NAVY), rim, 1.6 * pr);
  x.globalAlpha = 1;
  x.drawImage(tint(mask, PAPER), rim, 0);
  x.strokeStyle = GOLD;
  x.lineWidth = 2.5 * pr;
  x.lineCap = 'round';
  x.setLineDash([8 * pr, 8 * pr]);
  roundRectPath(x, rim + 9 * pr, 9 * pr, bodyW - 18 * pr, bodyH - 18 * pr, 10 * pr);
  x.stroke();
  x.setLineDash([]);
  const cx = rim + bodyW / 2;
  const fontPx = clamp(w * .105, 15, 22) * pr, lead = fontPx * 1.26;
  x.font = `800 ${fontPx}px ${BODY_FONT}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const lines = wrap(x, text, bodyW - 44 * pr);
  const r = fontPx * 1.15;
  const blockH = r * 2 + fontPx * .7 + lines.length * lead;
  const y0 = bodyH / 2 - blockH / 2;
  x.fillStyle = THREAD;
  x.strokeStyle = NAVY;
  x.lineWidth = 2.25 * pr;
  x.beginPath();
  x.arc(cx, y0 + r, r, 0, Math.PI * 2);
  x.fill();
  x.stroke();
  x.lineWidth = 3 * pr;
  x.beginPath();
  x.moveTo(cx - r * .45, y0 + r);
  x.lineTo(cx + r * .45, y0 + r);
  x.moveTo(cx, y0 + r * .55);
  x.lineTo(cx, y0 + r * 1.45);
  x.stroke();
  x.fillStyle = NAVY;
  lines.forEach((line, i) => x.fillText(line, cx, y0 + r * 2 + fontPx * .7 + (i + .5) * lead));
  const tag = tagCanvas(measureTag(title, fontCss * pr, tagMaxCss * pr));
  return finishPicture(sprite, pr, {
    boxX: 0,
    boxY: 0,
    pegX: [(rim + bodyW * .25) / pr, (rim + bodyW * .75) / pr],
    topInset: 0,
    mask,
    maskX: rim,
    tag,
    tagX: cx / pr,
    tagY: (bodyH - tag.fontPx * .5) / pr,
  });
}

function finishPicture(sprite, pr, info) {
  const shade = tint(sprite, NAVY);
  const shadow = softShadow(info.mask, pr);
  return { sprite, shade, shadow, w: sprite.width / pr, h: sprite.height / pr, ...info, maskX: info.maskX / pr };
}

// ---- the tube houses: original art, drawn once to a canvas ----

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let v = s;
    v = Math.imul(v ^ (v >>> 15), v | 1);
    v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
}

function waterTank(x, cx, top, size, color) {
  x.fillStyle = color;
  const w = size, h = size * .62;
  roundRectPath(x, cx - w / 2, top - h - size * .3, w, h, h * .46);
  x.fill();
  x.fillRect(cx - w * .38, top - size * .32, size * .09, size * .32);
  x.fillRect(cx + w * .29, top - size * .32, size * .09, size * .32);
}

function tubeHouse(x, l, base, w, h, u, rand, tone) {
  const { wall, window: win, deep } = tone;
  const top = base - h;
  x.fillStyle = wall;
  x.fillRect(l, top, w, h + 1);
  const floorH = u * .92, wide = w > u * .95;
  // Upper floors step back and the roof finishes differently from house to house, the way a real row does.
  const style = rand();
  if (style < .34) {
    const back = w * .16;
    x.fillRect(l + back, top - floorH * .62, w - back * 2, floorH * .63);
    waterTank(x, l + w * .5, top - floorH * .62, u * .42, wall);
  } else if (style < .62) {
    x.beginPath();
    x.moveTo(l - u * .04, top + 1);
    x.lineTo(l + w * .5, top - u * .38);
    x.lineTo(l + w + u * .04, top + 1);
    x.closePath();
    x.fill();
  } else {
    x.fillRect(l - 1, top - u * .08, w + 2, u * .08);
    waterTank(x, l + w * (rand() < .5 ? .28 : .7), top - u * .08, u * .4, wall);
    x.fillRect(l + w * .86, top - u * .62, 1.6, u * .54);
    x.fillRect(l + w * .86 - u * .1, top - u * .54, u * .2, 1.4);
    x.fillRect(l + w * .86 - u * .07, top - u * .44, u * .14, 1.4);
  }
  for (let fy = top + floorH * .2; fy + floorH * .55 < base; fy += floorH) {
    const panes = wide ? 2 : 1;
    const paneW = w * (panes === 2 ? .26 : .44), paneH = floorH * .5;
    for (let p = 0; p < panes; p++) {
      const px = l + (w - paneW * panes - (panes - 1) * w * .12) / 2 + p * (paneW + w * .12);
      const lit = rand() < .24;
      x.fillStyle = lit ? deep : win;
      roundRectPath(x, px, fy, paneW, paneH, Math.min(paneW / 2, paneH * .34));
      x.fill();
    }
    if (rand() < .6) {
      x.fillStyle = deep;
      x.fillRect(l + w * .08, fy + paneH + floorH * .06, w * .84, 1.6);
      for (let bar = 0; bar <= 7; bar++) x.fillRect(l + w * .08 + w * .84 * bar / 7 - .5, fy + paneH - floorH * .06, 1, floorH * .12);
    }
  }
}

function drawStreet(x, W, base, maxH, seed) {
  const rand = seeded(seed);
  const u = clamp(W / 7.2, 50, 94);
  const back = { wall: '#EEF1F7', window: '#F6F8FC', deep: '#E7EAF1' };
  const front = { wall: HOUSE, window: '#F5F7FB', deep: '#D8DDE9' };
  for (const [tone, hMin, hMax, drop] of [[back, .62, 1, 0], [front, .4, .78, 0]]) {
    let l = -rand() * u * .6;
    while (l < W) {
      const w = u * (.74 + rand() * .62);
      const h = maxH * lerp(hMin, hMax, rand());
      tubeHouse(x, l, base - drop, w, h, u, rand, tone);
      l += w + (rand() < .14 ? u * .06 : 0);
    }
  }
}

function drawCloud(x, cx, cy, s) {
  x.fillStyle = 'rgba(255,254,251,.72)';
  x.beginPath();
  x.ellipse(cx, cy, s, s * .3, 0, 0, Math.PI * 2);
  x.ellipse(cx - s * .42, cy - s * .1, s * .36, s * .26, 0, 0, Math.PI * 2);
  x.ellipse(cx + s * .28, cy - s * .18, s * .44, s * .34, 0, 0, Math.PI * 2);
  x.fill();
}

function drawBackground(c, W, H, pr, ground) {
  c.width = Math.round(W * pr);
  c.height = Math.round(H * pr);
  const x = c.getContext('2d');
  x.setTransform(pr, 0, 0, pr, 0, 0);
  const sky = x.createLinearGradient(0, 0, 0, ground);
  sky.addColorStop(0, '#DCEBFA');
  sky.addColorStop(1, PAPER);
  x.fillStyle = sky;
  x.fillRect(0, 0, W, H);
  drawCloud(x, W * .2, ground * .3, clamp(W * .09, 34, 96));
  drawCloud(x, W * .8, ground * .18, clamp(W * .07, 26, 74));
  drawStreet(x, W, ground, clamp(ground * (W < H ? .36 : .52), 90, 330), 20261106);
  x.fillStyle = PAPER;
  x.fillRect(0, ground, W, H - ground);
  x.fillStyle = GOLD;
  for (let l = 6; l < W; l += 15) x.fillRect(l, ground - 1, 8, 2);
}

// ---- pegs ----

function pegSprite(w, h, pr) {
  const c = makeCanvas(w * pr, h * pr);
  const x = c.getContext('2d');
  x.scale(pr, pr);
  const jaw = (l, r, fill) => {
    x.fillStyle = fill;
    x.beginPath();
    x.moveTo(l + (r - l) * .12, 1);
    x.lineTo(r, 1);
    x.lineTo(r, h * .5);
    x.quadraticCurveTo(r - .4, h * .78, r - (r - l) * .12, h - 1);
    x.quadraticCurveTo(l + (r - l) * .3, h - 1, l + (r - l) * .28, h * .62);
    x.lineTo(l, h * .4);
    x.closePath();
    x.fill();
    x.strokeStyle = 'rgba(92,60,24,.72)';
    x.lineWidth = 1;
    x.stroke();
  };
  jaw(.5, w * .5, '#E2BC84');
  x.save();
  x.translate(w, 0);
  x.scale(-1, 1);
  jaw(.5, w * .5, '#CFA267');
  x.restore();
  // Spring, in the packet's gold.
  x.fillStyle = '#9A7416';
  x.fillRect(0, h * .3, w, h * .13);
  x.fillStyle = THREAD;
  x.fillRect(.5, h * .31, w - 1, h * .05);
  return c;
}

// ---- the scene ----

function makeCloth(item, side) {
  return {
    item, id: item.id, side,
    w: new Float32Array(STRIPS + 1), v: new Float32Array(STRIPS + 1),
    shear: 0, sv: 0, phase: reduced() ? 'hang' : 'wait',
    seed: side * 3.7 + 11, pic: null, ox: 0, x0: 0, y0: 0, s0: 1, p: 0, landed: reduced() ? -1e6 : 0,
    tagK: reduced() ? 1 : 0, pegCols: [6, 17], grabbed: 0,
  };
}

function buildDom() {
  const root = document.createElement('div');
  root.id = 'studio-line';
  root.setAttribute('role', 'dialog');
  const sky = document.createElement('canvas');
  sky.className = 'st-line-sky';
  sky.setAttribute('aria-hidden', 'true');
  const cloth = document.createElement('canvas');
  cloth.className = 'st-line-cloth';
  const panel = document.createElement('div');
  panel.className = 'st-line-panel';
  const q = document.createElement('div');
  q.className = 'st-line-q';
  const say = document.createElement('button');
  say.type = 'button';
  say.className = 'st-line-say';
  say.innerHTML = icon('speaker', 30); // static, from our own icon table
  const words = document.createElement('div');
  words.className = 'st-line-words';
  const prompt = document.createElement('p');
  prompt.className = 'st-line-prompt';
  const en = document.createElement('p');
  en.className = 'st-line-en';
  words.append(prompt, en);
  q.append(say, words);
  const btns = document.createElement('div');
  btns.className = 'st-line-btns';
  const down = document.createElement('button');
  down.type = 'button';
  down.className = 'st-line-btn';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'st-line-btn is-main';
  btns.append(down, save);
  panel.append(q, btns);
  root.append(sky, cloth, panel);
  (document.getElementById('studio-ui') ?? document.body).appendChild(root);
  return { root, sky, cloth, panel, say, prompt, en, down, save };
}

function writeWords(s) {
  const { dom } = s;
  dom.root.setAttribute('aria-label', t('line.title'));
  dom.prompt.textContent = t('line.prompt');
  dom.en.textContent = lang() === 'en' ? '' : tIn('line.prompt', 'en');
  dom.say.setAttribute('aria-label', t('line.hear'));
  dom.say.title = t('line.hear');
  dom.down.textContent = t('line.down');
  if (!dom.save.dataset.flash) dom.save.textContent = t('line.save');
}

function layout(s) {
  const { dom } = s;
  const W = window.innerWidth, H = window.innerHeight;
  const pr = Math.min(window.devicePixelRatio || 1, 2);
  s.W = W; s.H = H; s.pr = pr;
  dom.cloth.width = Math.round(W * pr);
  dom.cloth.height = Math.round(H * pr);
  const panelH = dom.panel.getBoundingClientRect().height || 170;
  s.ground = H - panelH;
  drawBackground(dom.sky, W, H, pr, s.ground);
  const safeTop = parseFloat(getComputedStyle(dom.root).paddingTop) || 0;
  const lineMin = safeTop + clamp(H * .075, 34, 68);
  s.lineY = lineMin;
  s.sag = clamp(W * .016, 7, 20);
  const pegW = clamp(W * .036, 13, 19), pegH = pegW * 2.5;
  s.peg = { w: pegW, h: pegH, sprite: pegSprite(pegW, pegH, pr) };

  const gap = clamp(W * .03, 8, 72);
  const slotW = Math.min(W * .46, (W - gap * 3) / 2, 480);
  const slotH = Math.max(120, s.ground - lineMin - s.sag - 16);
  const fontCss = clamp(slotW * .075, 11.5, 15);
  const cxs = [W / 2 - slotW / 2 - gap / 2, W / 2 + slotW / 2 + gap / 2];
  const drawn = s.cloths.filter(c => !c.item.empty);
  const reference = drawn.length ? drawn[0] : null;
  let refW = slotW * .9, refH = slotH * .8;

  s.cloths.forEach((c, n) => {
    if (c.item.empty) return;
    const shape = c.item.shape;
    const tagReserve = fontCss * 3.2;
    const sc = Math.min(slotW / shape.w, (slotH - tagReserve) / shape.h, 2.1);
    c.sc = sc;
    c.pic = pictureOf(c.item, sc, pr, BOXES[c.id].title[lang()], fontCss, slotW);
    if (c === reference) { refW = Math.max(shape.w * sc, slotW * .72); refH = Math.max(shape.h * sc, slotW * .86); }
    place(s, c, cxs[n]);
  });
  s.cloths.forEach((c, n) => {
    if (!c.item.empty) return;
    const w = Math.min(refW, slotW), h = Math.min(refH, slotH - fontCss * 3);
    c.sc = 1;
    c.pic = placeholderPicture(1, w, h, pr, BOXES[c.id].title[lang()], t('line.empty'), fontCss, slotW);
    place(s, c, cxs[n]);
  });
  const tallest = Math.max(...s.cloths.map(c => c.pic.h + c.pic.tag.h / pr));
  s.lineY = lineMin + Math.max(0, (s.ground - lineMin - s.sag - tallest) * .3);
}

function place(s, c, cx) {
  c.ox = cx - c.pic.w / 2;
  const dx = c.pic.w / STRIPS;
  c.pegCols = c.pic.pegX.map(px => clamp(Math.round(px / dx), 1, STRIPS - 1));
  c.pic.pegX = c.pegCols.map(i => i * dx);
  c.dx = dx;
  if (c.item.empty) {
    c.x0 = c.ox;
    c.y0 = -c.pic.h - 30;
    c.s0 = 1;
    return;
  }
  // Where this piece sits on the real paper right now, so the first frame lies exactly on the child's drawing.
  const { rect } = BOXES[c.id];
  const at = viewport.toClient(rect.x, rect.y);
  const z = viewport.z();
  c.s0 = z / c.sc;
  c.x0 = at.x - c.pic.boxX * c.s0;
  c.y0 = at.y - c.pic.boxY * c.s0;
}

const lineBase = (s, x) => {
  const k = (x - s.W / 2) / (s.W / 2);
  return s.lineY + s.sag * (1 - k * k);
};

function lineOffset(s, x) {
  const f = clamp(x / s.W, 0, 1) * (LINE_NODES - 1), i = Math.min(Math.floor(f), LINE_NODES - 2);
  return lerp(s.lineW[i], s.lineW[i + 1], f - i);
}

const lineAt = (s, x) => lineBase(s, x) + lineOffset(s, x);

// ---- the cloth ----

function stepCloth(s, c, t) {
  const { w, v } = c;
  const sway = SWAY * (Math.sin(t * .63 + c.seed) * .6 + Math.sin(t * 1.27 + c.seed * 2.1) * .4);
  let target = sway;
  for (const grab of s.grabs.values()) {
    if (grab.cloth === c) target = clamp(grab.dx / Math.max(grab.reach, 70), -MAX_SHEAR, MAX_SHEAR);
  }
  const held = c.grabbed > 0;
  c.sv += (-(held ? 120 : SWING_K) * (c.shear - target) - (held ? 12 : SWING_C) * c.sv) * STEP;
  c.shear = clamp(c.shear + c.sv * STEP, -MAX_SHEAR, MAX_SHEAR);
  // The swing drags the free corners behind it, and a little breeze keeps the paper alive between tugs.
  const flap = c.sv * 34;
  const breeze = 1.7 * Math.sin(t * .9 + c.seed);
  for (let i = 0; i <= STRIPS; i++) {
    const left = w[i === 0 ? 0 : i - 1], right = w[i === STRIPS ? STRIPS : i + 1];
    const edge = Math.abs(i / STRIPS - .5) * 2;
    let force = CLOTH_K * (left + right - 2 * w[i]) - CLOTH_C * v[i];
    force += flap * edge * (i / STRIPS - .5) * 2 + breeze * Math.sin(i * .36 + t * 1.6);
    for (const grab of s.grabs.values()) {
      if (grab.cloth !== c) continue;
      const spread = Math.exp(-((i - grab.col) ** 2) / 34);
      force += spread * 70 * (clamp(grab.dy * .4, -MAX_W, MAX_W) - w[i]);
    }
    v[i] += force * STEP;
  }
  for (let i = 0; i <= STRIPS; i++) w[i] = clamp(w[i] + v[i] * STEP, -MAX_W, MAX_W);
  for (const col of c.pegCols) { w[col] = 0; v[col] = 0; }
}

function stepLine(s) {
  const { lineW: l, lineV: v } = s;
  for (let j = 1; j < LINE_NODES - 1; j++) {
    v[j] += (LINE_K * (l[j - 1] + l[j + 1] - 2 * l[j]) - LINE_C * v[j]) * STEP;
  }
  for (const grab of s.grabs.values()) {
    const c = grab.cloth;
    for (const px of c.pic.pegX) {
      const f = clamp((c.ox + px) / s.W, 0, 1) * (LINE_NODES - 1), j = clamp(Math.round(f), 1, LINE_NODES - 2);
      v[j] += 400 * (clamp(grab.dy * .3, -16, 34) - l[j]) * STEP;
    }
  }
  for (let j = 1; j < LINE_NODES - 1; j++) l[j] = clamp(l[j] + v[j] * STEP, -36, 44);
}

// What travels down the line reaches the other piece, so a tug on one nudges its partner.
function couple(s, c) {
  const a = c.ox + c.pic.pegX[0], b = c.ox + c.pic.pegX[1];
  const f = x => clamp(x / s.W, 0, 1) * (LINE_NODES - 1);
  const va = s.lineV[Math.round(f(a))], vb = s.lineV[Math.round(f(b))];
  c.sv += clamp((va - vb) * .0016, -.05, .05);
}

function kick(s, x, amount) {
  const f = clamp(x / s.W, 0, 1) * (LINE_NODES - 1), j = clamp(Math.round(f), 1, LINE_NODES - 2);
  for (let k = -2; k <= 2; k++) {
    const n = j + k;
    if (n > 0 && n < LINE_NODES - 1) s.lineV[n] += amount * (1 - Math.abs(k) * .3);
  }
}

// ---- drawing ----

function drawLine(s, reach) {
  const { ctx: x, pr } = s;
  x.setTransform(pr, 0, 0, pr, 0, 0);
  const end = s.W * reach;
  x.beginPath();
  for (let j = 0; j < 40; j++) {
    const px = -4 + (end + 8) * j / 39;
    if (j) x.lineTo(px, lineAt(s, px));
    else x.moveTo(px, lineAt(s, px));
  }
  x.lineJoin = x.lineCap = 'round';
  x.strokeStyle = 'rgba(22,34,74,.13)';
  x.lineWidth = 3;
  x.setLineDash([]);
  x.translate(0, 2.5);
  x.stroke();
  x.translate(0, -2.5);
  x.strokeStyle = GOLD;
  x.lineWidth = 3.2;
  x.stroke();
  // A twist of lighter thread, so it reads as cord, not a ruled line.
  x.strokeStyle = THREAD;
  x.lineWidth = 1.5;
  x.setLineDash([5, 5]);
  x.stroke();
  x.setLineDash([]);
}

function clothTop(s, c) {
  const { pegX } = c.pic;
  const ya = lineAt(s, c.ox + pegX[0]), yb = lineAt(s, c.ox + pegX[1]);
  return { ya, slope: (yb - ya) / Math.max(pegX[1] - pegX[0], 1) };
}

function drawFlying(s, c, p) {
  const { ctx: x, pr } = s;
  const { pic } = c;
  const lift = easeInOut(clamp(p / .26, 0, 1));
  const fly = easeInOut(clamp((p - .16) / .84, 0, 1));
  const rise = easeOutBack(clamp((p - .16) / .84, 0, 1));
  const { ya, slope } = clothTop(s, c);
  const yHang = ya - slope * pic.pegX[0] - pic.topInset;
  const scale = lerp(c.s0, 1, fly) * (1 + .05 * lift * (1 - fly));
  const px = lerp(c.x0, c.ox, fly), py = lerp(c.y0, yHang, rise);
  const air = Math.sin(Math.PI * fly);
  const rot = air * c.side * .1 + Math.atan(slope) * fly;
  const alpha = c.item.empty ? 1 : clamp(p / .1, 0, 1);
  const cx = pic.w / 2, cy = pic.h / 2;
  drawShadowAt(s, c, px, py, scale, rot, lift * (1 - fly * .75) + air * .35, alpha);
  x.setTransform(pr, 0, 0, pr, 0, 0);
  x.translate(px + cx * scale, py + cy * scale);
  x.rotate(rot);
  x.scale(scale, scale);
  x.translate(-cx, -cy);
  x.globalAlpha = alpha;
  x.drawImage(pic.sprite, 0, 0, pic.w, pic.h);
  x.globalAlpha = 1;
}

function drawShadowAt(s, c, px, py, scale, rot, lift, alpha) {
  const { ctx: x, pr } = s;
  const { pic } = c, { shadow } = pic;
  const off = 4 + lift * 28;
  const cx = pic.w / 2, cy = pic.h / 2;
  x.setTransform(pr, 0, 0, pr, 0, 0);
  x.translate(px + off * .7 + cx * scale, py + off + cy * scale);
  x.rotate(rot);
  x.scale(scale * (1 + lift * .04), scale * (1 + lift * .04));
  x.translate(-cx, -cy);
  x.globalAlpha = (.12 + lift * .16) * alpha;
  x.drawImage(shadow.canvas, pic.maskX - shadow.pad, -shadow.pad, shadow.w, shadow.h);
  x.globalAlpha = 1;
}

function drawCloth(s, c) {
  const { ctx: x, pr } = s;
  const { pic, w } = c;
  const { ya, slope } = clothTop(s, c);
  const dx = c.dx, srcW = pic.sprite.width / STRIPS, srcH = pic.sprite.height, shear = c.shear;
  // A pendulum's foot rises as it swings out.
  const drop = 1 - shear * shear * .5;
  const yAtZero = ya - slope * pic.pegX[0] - pic.topInset;
  // The soft shadow swings with the cloth but a little further, as if it falls on air behind it.
  x.globalAlpha = .15;
  x.setTransform(pr, pr * slope, pr * shear * 1.12, pr * drop, pr * (c.ox + 4), pr * (yAtZero + 9));
  x.drawImage(pic.shadow.canvas, pic.maskX - pic.shadow.pad, -pic.shadow.pad, pic.shadow.w, pic.shadow.h);
  x.globalAlpha = 1;
  for (let i = 0; i < STRIPS; i++) {
    const turn = (w[i + 1] - w[i]) / dx;
    const b = slope + turn;
    const xi = i * dx;
    const f = yAtZero + slope * xi + w[i] - b * xi;
    x.setTransform(pr, pr * b, pr * shear, pr * drop, pr * c.ox, pr * f);
    const overlap = i < STRIPS - 1 ? .8 : 0;
    x.drawImage(pic.sprite, i * srcW, 0, srcW + overlap * pr, srcH, xi, 0, dx + overlap, pic.h);
    // Folds: paper turning from the light darkens. Averaged over neighbours so it reads as a soft crease, not stripes.
    const lo = Math.max(0, i - 2), hi = Math.min(STRIPS, i + 3);
    const soft = (w[hi] - w[lo]) / ((hi - lo) * dx);
    const shade = soft > 0 ? soft * .3 : -soft * .12;
    if (shade > .006) {
      x.globalAlpha = Math.min(.09, shade);
      x.drawImage(pic.shade, i * srcW, 0, srcW, srcH, xi, 0, dx, pic.h);
      x.globalAlpha = 1;
    }
  }
  drawClothTag(s, c, yAtZero, slope, drop);
}

// The label hangs off the hem, popping on as the pegs bite and lagging the swing a beat behind.
function drawClothTag(s, c, yAtZero, slope, drop) {
  if (c.tagK <= 0) return;
  const { ctx: x, pr } = s;
  const { pic } = c, { tag } = pic;
  const col = clamp(Math.round(pic.tagX / c.dx), 0, STRIPS);
  const tw = tag.w / pr, th = tag.h / pr;
  const inner = tw / 2 + 3;
  const rest = c.side < 0 ? clamp(c.ox + pic.tagX, inner, s.W / 2 - inner) : clamp(c.ox + pic.tagX, s.W / 2 + inner, s.W - inner);
  const px = rest + c.shear * pic.tagY;
  const py = yAtZero + slope * pic.tagX + c.w[col] + drop * pic.tagY + tag.pad / pr;
  const pop = reduced() ? 1 : easeOutBack(c.tagK);
  x.setTransform(pr, 0, 0, pr, 0, 0);
  x.translate(px, py);
  x.rotate(c.side * .026 - c.shear * .5 - clamp(c.sv * .05, -.2, .2));
  x.scale(pop, pop);
  x.drawImage(tag.canvas, -tw / 2, -tag.pad / pr, tw, th);
}

function drawPegs(s, c, t) {
  const { ctx: x, pr, peg } = s;
  const { pegX } = c.pic;
  pegX.forEach((px, n) => {
    const at = reduced() ? 1 : clamp((t - c.landed - n * 75) / 150, 0, 1);
    if (at <= 0) return;
    const ease = easeOutBack(at);
    const gx = c.ox + px, gy = lineAt(s, gx);
    const slope = (lineAt(s, gx + 8) - lineAt(s, gx - 8)) / 16;
    x.setTransform(pr, 0, 0, pr, 0, 0);
    x.translate(gx, gy - (1 - ease) * 26);
    x.rotate(Math.atan(slope) + c.shear * .22 + (n ? .05 : -.05));
    x.globalAlpha = Math.min(1, at * 2.2);
    x.drawImage(peg.sprite, -peg.w / 2, -peg.h * .36, peg.w, peg.h);
  });
  x.globalAlpha = 1;
}

function render(s, t) {
  const { ctx: x, pr } = s;
  x.setTransform(pr, 0, 0, pr, 0, 0);
  x.clearRect(0, 0, s.W, s.H);
  const reach = s.instant ? 1 : easeInOut(clamp((t - s.t0 - 180) / 520, 0, 1));
  const shrink = s.leaving ? clamp((t - s.leaving) / BACK_MS, 0, 1) : 0;
  x.globalAlpha = 1 - shrink;
  drawLine(s, reach);
  x.globalAlpha = 1;
  for (const c of s.cloths) {
    if (c.phase === 'hang') drawCloth(s, c);
  }
  for (const c of s.cloths) {
    if (c.phase === 'hang') drawPegs(s, c, t);
  }
  for (const c of s.cloths) {
    if (c.phase === 'fly' || c.phase === 'back') drawFlying(s, c, c.p);
  }
}

// ---- the loop ----

function frame(s) {
  s.raf = 0;
  if (scene !== s) return;
  try {
    const t = now();
    const elapsed = Math.min(t - s.last, 50);
    s.last = t;
    advance(s, t);
    s.acc += elapsed / 1000;
    while (s.acc >= STEP) {
      stepLine(s);
      for (const c of s.cloths) {
        if (c.phase === 'hang') { stepCloth(s, c, t / 1000); couple(s, c); }
      }
      s.acc -= STEP;
    }
    render(s, t);
    if (s.leaving && t - s.leaving >= BACK_MS) return destroy(s);
    if (t - s.touched < IDLE_MS || s.leaving || s.grabs.size) s.raf = requestAnimationFrame(() => frame(s));
  } catch (err) {
    log('washline', err.message);
    destroy(s);
  }
}

function wake(s) {
  s.touched = now();
  if (!s.raf && !s.reducedNow && scene === s) {
    s.last = now();
    s.raf = requestAnimationFrame(() => frame(s));
  }
}

function advance(s, t) {
  s.cloths.forEach((c, n) => {
    if (c.phase === 'wait' && t - s.t0 >= c.delay) c.phase = 'fly';
    if (c.phase === 'fly') {
      c.p = clamp((t - s.t0 - c.delay) / c.flyMs, 0, 1);
      if (c.p >= 1) land(s, c, t, n);
    } else if (c.phase === 'back') {
      c.p = c.backFrom * (1 - easeInOut(clamp((t - s.leaving) / BACK_MS, 0, 1)));
    }
    if (c.phase === 'hang' && c.tagK < 1) c.tagK = clamp((t - c.landed - 90) / 210, 0, 1);
  });
  if (!s.settled && s.cloths.every(c => c.phase === 'hang')) settle(s, t);
}

function land(s, c, t, n) {
  c.phase = 'hang';
  c.landed = t;
  c.sv = (n ? 1 : -1) * .55;
  for (const px of c.pic.pegX) kick(s, c.ox + px, 92);
  for (let i = 0; i <= STRIPS; i++) c.v[i] = Math.sin(i * .75 + n) * 24;
}

function settle(s, t) {
  s.settled = t;
  s.dom.root.classList.add('is-settled');
  s.resolveOpen?.();
  s.resolveOpen = null;
  setTimeout(() => { if (scene === s && !s.leaving && !s.blobWork) prepareLooks(s); }, 2600);
}

// ---- touch ----

function clothAt(s, px, py) {
  for (const c of s.cloths) {
    if (c.phase !== 'hang') continue;
    const { ya, slope } = clothTop(s, c);
    const y = py - (ya - slope * c.pic.pegX[0]);
    const x = px - c.ox - c.shear * Math.max(y, 0);
    if (x >= -14 && x <= c.pic.w + 14 && y >= -22 && y <= c.pic.h + c.pic.tag.h / s.pr) return { cloth: c, x, y };
  }
  return null;
}

function onDown(s, e) {
  if (s.leaving) return;
  wake(s);
  const hit = clothAt(s, e.clientX, e.clientY);
  if (!hit) return;
  try { s.dom.cloth.setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ }
  const { cloth, x, y } = hit;
  cloth.grabbed++;
  s.grabs.set(e.pointerId, {
    cloth, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, moved: 0, born: now(),
    col: clamp(x / cloth.dx, 0, STRIPS), reach: Math.max(y, 40), side: x < cloth.pic.w / 2 ? -1 : 1,
  });
  e.preventDefault();
}

function onMove(s, e) {
  const grab = s.grabs.get(e.pointerId);
  if (!grab) return;
  grab.dx = e.clientX - grab.x0;
  grab.dy = e.clientY - grab.y0;
  grab.moved = Math.max(grab.moved, Math.hypot(grab.dx, grab.dy));
  wake(s);
}

function onUp(s, e, cancelled) {
  const grab = s.grabs.get(e.pointerId);
  if (!grab) return;
  s.grabs.delete(e.pointerId);
  const c = grab.cloth;
  c.grabbed = Math.max(0, c.grabbed - 1);
  wake(s);
  if (cancelled || grab.moved > 10) return;
  if (c.item.empty) {
    const id = c.id;
    close({ instant: true });
    shell.enterBox?.(id);
    return;
  }
  // A plain tap still answers: the piece bobs and swings away from the finger.
  c.sv += grab.side * -1.15;
  const col = Math.round(grab.col);
  for (let i = Math.max(0, col - 3); i <= Math.min(STRIPS, col + 3); i++) c.v[i] += 70;
  kick(s, c.ox + c.pic.w / 2, 42);
}

// ---- open and close ----

export function canOpen() {
  if (scene) return false;
  return BOX_IDS.some(id => targets.hasInk(id));
}

export function isOpen() { return !!scene; }

export async function open() {
  if (scene) return;
  if (engine.activeSheet() !== 1) await shell.showPage(1);
  if (stickers.isPlacing()) stickers.commit();
  const items = BOX_IDS.map(snapshotBox);
  if (items.every(item => item.empty)) return;
  document.fonts?.load(`700 16px ${BODY_FONT}`, 'ệa').catch(() => {});

  const still = reduced();
  const dom = buildDom();
  const s = {
    dom, items, instant: still, reducedNow: still, t0: now(), last: now(), touched: now(), acc: 0, raf: 0,
    ctx: dom.cloth.getContext('2d'), grabs: new Map(), settled: 0, leaving: 0, blob: null,
    lineW: new Float32Array(LINE_NODES), lineV: new Float32Array(LINE_NODES),
    cloths: items.map((item, n) => makeCloth(item, n ? 1 : -1)),
  };
  s.cloths.forEach((c, n) => {
    c.delay = c.item.empty ? 440 : n * 110;
    c.flyMs = c.item.empty ? 560 : FLY_MS;
  });
  scene = s;
  writeWords(s);
  layout(s);
  wire(s);

  if (still) {
    s.cloths.forEach(c => { c.phase = 'hang'; c.tagK = 1; c.landed = -1e6; });
    dom.root.classList.add('is-up', 'is-settled');
    s.settled = 1;
    render(s, now());
    setTimeout(() => { if (scene === s) prepareLooks(s); }, 300);
    return;
  }
  // Getting every picture onto the graphics chip is the slow first frame. Do it nearly invisibly, and start the clock
  // only after that, so a slow phone pauses before the lift rather than skipping the lift.
  warmUp(s);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (scene !== s || s.leaving) return;
    s.t0 = s.last = s.touched = now();
    dom.root.classList.add('is-up');
    s.raf = requestAnimationFrame(() => frame(s));
  }));
  await new Promise(resolve => { s.resolveOpen = resolve; });
}

function warmUp(s) {
  const { ctx: x, pr } = s;
  x.setTransform(pr, 0, 0, pr, 0, 0);
  x.globalAlpha = .004;
  for (const { pic } of s.cloths) {
    for (const source of [pic.sprite, pic.shade, pic.shadow.canvas, pic.tag.canvas]) x.drawImage(source, 0, 0, 2, 2);
  }
  x.drawImage(s.peg.sprite, 0, 0, 2, 2);
  x.globalAlpha = 1;
}

function wire(s) {
  const { dom } = s;
  const target = dom.cloth;
  const handlers = [
    [target, 'pointerdown', e => onDown(s, e)],
    [target, 'pointermove', e => onMove(s, e)],
    [target, 'pointerup', e => onUp(s, e, false)],
    [target, 'pointercancel', e => onUp(s, e, true)],
    [dom.down, 'click', () => close()],
    [dom.save, 'click', () => saveLooks(s)],
    [dom.say, 'click', () => { speech.word(tIn('line.prompt', 'en')); wake(s); }],
    [document, 'keydown', e => { if (e.key === 'Escape') close(); }],
    [window, 'resize', () => {
      clearTimeout(s.resizeTimer);
      s.resizeTimer = setTimeout(() => { if (scene === s && !s.leaving) { layout(s); render(s, now()); } }, 140);
    }],
  ];
  for (const [el, name, fn] of handlers) el.addEventListener(name, fn);
  s.unwire = [
    () => handlers.forEach(([el, name, fn]) => el.removeEventListener(name, fn)),
    on('lang:change', () => {
      if (scene !== s || s.leaving) return;
      s.blob = null;
      writeWords(s);
      layout(s);
      render(s, now());
      prepareLooks(s);
    }),
    on('studio:exit', () => close({ instant: true })),
  ];
}

export function close({ instant = false } = {}) {
  const s = scene;
  if (!s || s.leaving) return;
  if (instant || s.reducedNow) { destroy(s); return; }
  s.leaving = now();
  s.grabs.clear();
  s.resolveOpen?.();
  s.resolveOpen = null;
  s.dom.root.classList.add('is-leaving');
  s.dom.root.classList.remove('is-up');
  s.cloths.forEach(c => {
    c.backFrom = c.phase === 'hang' ? 1 : c.p;
    c.phase = 'back';
  });
  wake(s);
}

function destroy(s) {
  if (s.raf) cancelAnimationFrame(s.raf);
  s.raf = 0;
  clearTimeout(s.resizeTimer);
  clearTimeout(s.flashTimer);
  speech.stop?.();
  s.unwire?.forEach(fn => fn());
  s.resolveOpen?.();
  s.dom.root.remove();
  for (const item of s.items) if (item.snap) item.snap.width = 0;
  if (scene === s) scene = null;
}

// ---- My Two Looks ----

function textAnswer(id) {
  const value = fields.get(id);
  if (!value || (value.kind !== 'text' && value.kind !== 'chip')) return '';
  return String(value.text ?? '').trim();
}

async function childNameArt() {
  const value = fields.get('p1-name');
  if (value?.kind === 'ink' && isSafeInk(value.src)) {
    try {
      const img = new Image();
      img.src = value.src;
      await img.decode();
      return { img };
    } catch (err) {
      log('washline', 'name image: ' + err.message);
      return null;
    }
  }
  const text = (value?.kind === 'text' || value?.kind === 'chip') ? String(value.text ?? '').trim() : '';
  return text ? { text } : null;
}

function fitFont(x, text, weightFamily, maxPx, minPx, maxWidth) {
  for (let px = maxPx; px >= minPx; px -= 1) {
    x.font = weightFamily(px);
    if (x.measureText(text).width <= maxWidth) return px;
  }
  return minPx;
}

async function drawLooks(items) {
  const W = 1200, H = 900, ground = 716;
  const canvas = makeCanvas(W, H);
  const x = canvas.getContext('2d');
  const sky = x.createLinearGradient(0, 0, 0, ground);
  sky.addColorStop(0, '#DCEBFA');
  sky.addColorStop(1, PAPER);
  x.fillStyle = sky;
  x.fillRect(0, 0, W, H);
  drawCloud(x, 170, 216, 96);
  drawCloud(x, 1040, 240, 78);
  drawStreet(x, W, ground, 370, 20261106);
  x.fillStyle = PAPER;
  x.fillRect(0, ground, W, H - ground);
  x.fillStyle = GOLD;
  for (let l = 6; l < W; l += 15) x.fillRect(l, ground - 1.5, 8, 3);

  // Title and the child's name.
  x.textAlign = 'center';
  x.textBaseline = 'alphabetic';
  x.fillStyle = NAVY;
  const display = getComputedStyle(document.documentElement).getPropertyValue('--display').trim() || 'serif';
  x.font = `italic 700 62px ${display}`;
  const name = await childNameArt();
  const titleY = name ? 66 : 84;
  x.fillText(items.filter(item => !item.empty).length === 2 ? 'My Two Looks' : 'My Look', W / 2, titleY);
  if (name?.text) {
    fitFont(x, name.text, px => `500 ${px}px ${HAND_FONT}`, 36, 20, 760);
    x.fillStyle = '#4F5878';
    x.fillText(name.text, W / 2, titleY + 46);
  } else if (name?.img) {
    const h = 54, w = Math.min(h * name.img.naturalWidth / Math.max(name.img.naturalHeight, 1), 620);
    x.drawImage(name.img, W / 2 - w / 2, titleY + 6, w, h);
  }

  // The line, the cutouts and their pegs.
  const lineTop = 136, sag = 22;
  const yOf = px => lineTop + sag * (1 - ((px - W / 2) / (W / 2)) ** 2);
  x.lineCap = 'round';
  x.beginPath();
  for (let i = 0; i <= 40; i++) {
    const px = -4 + (W + 8) * i / 40;
    if (i) x.lineTo(px, yOf(px));
    else x.moveTo(px, yOf(px));
  }
  x.strokeStyle = GOLD;
  x.lineWidth = 5;
  x.stroke();
  x.strokeStyle = THREAD;
  x.lineWidth = 2.2;
  x.setLineDash([8, 8]);
  x.stroke();
  x.setLineDash([]);

  const drawn = items.filter(item => !item.empty);
  const peg = pegSprite(24, 60, 1);
  const slotW = 500, slotH = ground - lineTop - sag - 16;
  const centres = drawn.length === 2 ? [320, 880] : [600];
  drawn.forEach((item, n) => {
    const fontPx = 21;
    const reserve = fontPx * 2.4;
    const sc = Math.min(slotW / item.shape.w, (slotH - reserve) / item.shape.h, 2.4);
    const pic = pictureOf(item, sc, 1, BOXES[item.id].title[lang()], fontPx, slotW);
    const ox = centres[n] - pic.w / 2;
    const ya = yOf(ox + pic.pegX[0]), yb = yOf(ox + pic.pegX[1]);
    const slope = (yb - ya) / Math.max(pic.pegX[1] - pic.pegX[0], 1);
    x.setTransform(1, slope, 0, 1, ox, ya - slope * pic.pegX[0] - pic.topInset);
    x.globalAlpha = .18;
    x.drawImage(pic.shadow.canvas, pic.maskX + 6 - pic.shadow.pad, 12 - pic.shadow.pad, pic.shadow.w, pic.shadow.h);
    x.globalAlpha = 1;
    x.drawImage(pic.sprite, 0, 0);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.translate(ox + pic.tagX, ya - slope * pic.pegX[0] - pic.topInset + slope * pic.tagX + pic.tagY + pic.tag.pad);
    x.rotate(n ? .022 : -.022);
    x.drawImage(pic.tag.canvas, -pic.tag.w / 2, -pic.tag.pad);
    x.setTransform(1, 0, 0, 1, 0, 0);
    pic.pegX.forEach(px => {
      const gx = ox + px;
      x.drawImage(peg, gx - 12, yOf(gx) - 22);
    });
  });

  // The packet's own sentence if both blanks are written words, otherwise the packet's question.
  const isWords = textAnswer('p3-uniform-is'), areWords = textAnswer('p3-weekend-are');
  const sentence = isWords && areWords
    ? `My uniform is ${isWords}, but my weekend clothes are ${areWords}.`
    : tIn('line.prompt', 'en');
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillStyle = NAVY;
  x.font = `500 38px ${HAND_FONT}`;
  const lines = wrap(x, sentence, 1090);
  const px = lines.length > 2 ? 28 : 38;
  x.font = `500 ${px}px ${HAND_FONT}`;
  const packed = wrap(x, sentence, 1090).slice(0, 3);
  const lead = px * 1.34;
  packed.forEach((line, i) => x.fillText(line, W / 2, 806 + (i - (packed.length - 1) / 2) * lead));

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('picture could not be made'))), 'image/png');
  });
}

async function looksFonts() {
  if (!document.fonts) return;
  const display = getComputedStyle(document.documentElement).getPropertyValue('--display').trim() || 'serif';
  const asks = [
    document.fonts.load('500 20px "Playpen Hand"', 'ệa'),
    document.fonts.load(`700 21px ${BODY_FONT}`, 'ệa'),
    document.fonts.load(`italic 700 62px ${display}`, 'My Two Looks'),
  ];
  await Promise.race([Promise.allSettled(asks), new Promise(done => setTimeout(done, 1500))]);
}

// 1200x900 PNG. Works open or closed; when closed it reads the paper as it is now.
export async function twoLooks() {
  if (engine.activeSheet() !== 1) await shell.showPage(1);
  const items = scene ? scene.items : BOX_IDS.map(snapshotBox);
  await looksFonts();
  return drawLooks(items);
}

// Made ahead of the tap: Safari only lets a share start close to the finger.
function prepareLooks(s) {
  s.blobWork = twoLooks().then(blob => { if (scene === s) s.blob = blob; return blob; }).catch(err => {
    log('washline', 'two looks: ' + err.message);
    return null;
  });
  return s.blobWork;
}

async function deliver(blob) {
  const name = 'my-two-looks.png';
  const file = typeof File === 'function' ? new File([blob], name, { type: 'image/png' }) : null;
  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'My Two Looks' });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
      log('washline', 'share: ' + err.message);
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}

async function saveLooks(s) {
  const { save } = s.dom;
  if (save.disabled) return;
  save.disabled = true;
  wake(s);
  let label = '';
  try {
    const blob = s.blob ?? await (s.blobWork ?? prepareLooks(s)) ?? await twoLooks();
    const outcome = await deliver(blob);
    if (outcome !== 'cancelled') label = t('line.saved');
  } catch (err) {
    log('washline', 'save: ' + err.message);
    label = t('line.unsaved');
  }
  if (scene !== s) return;
  save.disabled = false;
  if (!label) return;
  save.dataset.flash = '1';
  save.textContent = label;
  clearTimeout(s.flashTimer);
  s.flashTimer = setTimeout(() => {
    delete save.dataset.flash;
    save.textContent = t('line.save');
  }, 1900);
}
