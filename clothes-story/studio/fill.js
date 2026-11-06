// Magic Fill (section 4.8). Decides on a small read canvas, composes at backing resolution, reveals on live, and only
// then commits, behind the line. Paint and live are never read back (invariant 5): only the read canvas here is.
import { BOXES, LIMITS, SHEET_H, SHEET_W, swatch as swatchById } from './constants.js?v=1';
import { emit, on } from './bus.js?v=1';
import { log } from './diag.js?v=1';
import * as engine from './engine.js?v=1';
import * as stickers from './stickers.js?v=1';
import * as store from './store.js?v=1';
import * as targets from './targets.js?v=1';
import * as textures from './textures.js?v=1';
import * as viewport from './viewport.js?v=1';
import * as fxLayer from './fx.js?v=1';

// The flood stops fillDilate px short of a line. One more px and the fill sits under the line's edge, so no paper shows.
const MASK_GROW = LIMITS.fillDilate + 1;
const MARKS_PER_SHEET = 40;
const NAVY = '#16224A';
const RAINBOW = ['#F2594B', '#F98F1D', '#FFD60A', '#3FA34D', '#18A3D0', '#3B4BA8', '#7C55C7'];
const FOLD_MIN_PX = 80;
const PALE_CLOTH = new Set(['gingham', 'stripe', 'flower']); // on white squares a full-strength crease reads as a smudge
const SEAM_INSET_PX = 6, SEAM_MIN_LOOP_PX = 70, SEAM_MIN_BOX_PX = 56, SEAM_DASH = [5.5, 4];
const SLOW_FRAME_MS = 28;
const LATE_FRAME_MS = 40;
const REVEAL_STRETCH = 2.5; // however late the frames, the pour ends by then
const STICKER_MARGIN_PX = 4;
const CORNER_CREEP_PX = 5;

const sheets = new Map();    // sheet -> { regions: Region[], marks: Mark[], history: Map<commitId, {add, drop}> }
let reader = null;           // the only canvas that is ever read back
let snap = null;             // offsets within fillSnap, nearest first
let job = null;              // the reveal in progress
let offs = [];
let nextRegionId = 1;

// ---- small helpers ----

function mk(w, h, opts) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  c.ctx = c.getContext('2d', opts);
  return c;
}

const rng = s => () => {
  s = s + 0x6D2B79F5 | 0;
  let t = Math.imul(s ^ s >>> 15, 1 | s);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const sheetRect = () => ({ x: 0, y: 0, w: SHEET_W, h: SHEET_H });
const inRect = (r, p) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;

function bookOf(sheet) {
  let b = sheets.get(sheet);
  if (!b) sheets.set(sheet, b = { regions: [], marks: [], history: new Map() });
  return b;
}

function listen() {
  if (offs.length) return;
  offs = [on('undo:applied', onUndo), on('ink:commit', onCommit), on('studio:exit', teardown)];
}

function teardown() {
  finishReveal();
  for (const off of offs) off();
  offs = [];
  sheets.clear();
  if (reader) reader.width = reader.height = 1;
  reader = null;
}

function offsets() {
  if (snap) return snap;
  const r = LIMITS.fillSnap;
  snap = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) snap.push([dx, dy]);
  snap.sort((a, b) => a[0] * a[0] + a[1] * a[1] - b[0] * b[0] - b[1] * b[1]);
  return snap;
}

// ---- reading paint ----

function readPaint(rect) {
  reader ??= mk(SHEET_W, SHEET_H, { willReadFrequently: true });
  const ctx = reader.ctx, S = engine.scale();
  ctx.clearRect(0, 0, rect.w, rect.h);
  ctx.drawImage(engine.paintCanvas(), rect.x * S, rect.y * S, rect.w * S, rect.h * S, 0, 0, rect.w, rect.h);
  return ctx.getImageData(0, 0, rect.w, rect.h).data;
}

// A sticker's gold hem is dashes on purpose. Under the dilation they would seal off a strip of cloth, so thread is not a
// wall. The window is tight enough to miss yellow #FFE500 and orange #F98F1D: a child's crayon line still holds water.
const isThread = (r, g, b) => r > 228 && g > 172 && g < 216 && b < 66;

function dilate(src, w, h, r) {
  const a = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let last = -1e6;
    for (let x = 0; x < w; x++) {
      if (src[row + x]) last = x;
      if (x - last <= r) a[row + x] = 1;
    }
    last = 1e6;
    for (let x = w - 1; x >= 0; x--) {
      if (src[row + x]) last = x;
      if (last - x <= r) a[row + x] = 1;
    }
  }
  for (let x = 0; x < w; x++) {
    let last = -1e6;
    for (let y = 0; y < h; y++) {
      if (a[y * w + x]) last = y;
      if (y - last <= r) out[y * w + x] = 1;
    }
    last = 1e6;
    for (let y = h - 1; y >= 0; y--) {
      if (a[y * w + x]) last = y;
      if (last - y <= r) out[y * w + x] = 1;
    }
  }
  return out;
}

function fillWallRect(wall, rect, r) {
  const x0 = Math.max(0, Math.floor(r.x - rect.x)), x1 = Math.min(rect.w, Math.ceil(r.x + r.w - rect.x));
  const y0 = Math.max(0, Math.floor(r.y - rect.y)), y1 = Math.min(rect.h, Math.ceil(r.y + r.h - rect.y));
  for (let y = y0; y < y1; y++) wall.fill(1, y * rect.w + x0, y * rect.w + Math.max(x0, x1));
}

function buildGrid(sheet, rect, data, framed) {
  const { w, h } = rect, n = w * h;
  const wall = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    if (data[j + 3] > LIMITS.fillAlpha && !isThread(data[j], data[j + 1], data[j + 2])) wall[i] = 1;
  }
  for (const d of targets.dark(sheet)) fillWallRect(wall, rect, d);
  if (framed) { // everything outside the box is a wall, so a shape drawn up to the box edge closes against it
    wall.fill(1, 0, w);
    wall.fill(1, n - w, n);
    for (let y = 0; y < h; y++) wall[y * w] = wall[y * w + w - 1] = 1;
  }
  return { rect, w, h, raw: wall, wall: dilate(wall, w, h, LIMITS.fillDilate), vis: new Uint8Array(n), framed };
}

// ---- flood ----

// 4-connected scanline. Runs to the end even when it has plainly leaked, so a later flood never stops at a half-marked edge.
function flood(g, sx, sy, mark) {
  const { wall, vis, w, h } = g;
  const stack = [sx, sy];
  let area = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
  while (stack.length) {
    const y = stack.pop(), x = stack.pop(), row = y * w;
    if (wall[row + x] || vis[row + x]) continue;
    let l = x, r = x;
    while (l > 0 && !wall[row + l - 1] && !vis[row + l - 1]) l--;
    while (r < w - 1 && !wall[row + r + 1] && !vis[row + r + 1]) r++;
    vis.fill(mark, row + l, row + r + 1);
    area += r - l + 1;
    if (l < x0) x0 = l;
    if (r > x1) x1 = r;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= h) continue;
      const nrow = ny * w;
      let open = false;
      for (let i = l; i <= r; i++) {
        const free = !wall[nrow + i] && !vis[nrow + i];
        if (free && !open) stack.push(i, ny);
        open = free;
      }
    }
  }
  return { mark, area, x0, x1, y0, y1 };
}

function hasLeaked(g, f) {
  if (g.framed) return false;
  const e = LIMITS.fillEdge, { rect } = g;
  return f.area > LIMITS.fillMaxArea * SHEET_W * SHEET_H
    || f.x0 + rect.x < e || f.y0 + rect.y < e || f.x1 + rect.x >= SHEET_W - e || f.y1 + rect.y >= SHEET_H - e;
}

// On a line there are two sides. The child means the shape, not the world outside it, so the smaller flood that holds wins.
function floodBesideLine(g, seed) {
  const { rect, w, h, wall, vis } = g;
  const found = [];
  for (const [dx, dy] of offsets()) {
    const x = seed.x + dx - rect.x, y = seed.y + dy - rect.y;
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = y * w + x;
    if (wall[i] || vis[i]) continue;
    const f = flood(g, x, y, found.length + 1);
    f.seed = { x: x + rect.x, y: y + rect.y };
    found.push(f);
    if (found.length === 2) break;
  }
  return found;
}

function chooseFlood(g, floods) {
  const held = floods.filter(f => !hasLeaked(g, f) && f.area >= LIMITS.fillMinArea);
  if (held.length) return held.reduce((a, b) => (b.area < a.area ? b : a));
  return floods.some(f => hasLeaked(g, f)) ? 'leak' : 'miss';
}

// A garment with a placket or straps is several rooms. Tapping one room of a placed sticker pours all of them, as one region.
function joinStickerRooms(g, f, mark) {
  const { rect, w, h, vis, wall } = g;
  const box = stickers.markRect(mark);
  const seeds = stickers.markSeeds(mark);
  const here = p => {
    const x = Math.round(p.x) - rect.x, y = Math.round(p.y) - rect.y;
    return x >= 0 && y >= 0 && x < w && y < h ? y * w + x : -1;
  };
  if (!seeds.some(p => { const i = here(p); return i >= 0 && vis[i] === f.mark; })) return false;
  const TEMP = 200;
  for (const p of seeds) {
    const i = here(p);
    if (i < 0 || wall[i] || vis[i]) continue;
    const room = flood(g, i % w, i / w | 0, TEMP);
    const held = room.x0 + rect.x >= box.x - STICKER_MARGIN_PX && room.y0 + rect.y >= box.y - STICKER_MARGIN_PX
      && room.x1 + rect.x <= box.x + box.w + STICKER_MARGIN_PX && room.y1 + rect.y <= box.y + box.h + STICKER_MARGIN_PX;
    for (let y = room.y0; y <= room.y1; y++) {
      for (let x = room.x0; x <= room.x1; x++) {
        if (vis[y * w + x] === TEMP) vis[y * w + x] = held ? f.mark : 0;
      }
    }
    if (!held) continue;
    f.area += room.area;
    f.x0 = Math.min(f.x0, room.x0);
    f.x1 = Math.max(f.x1, room.x1);
    f.y0 = Math.min(f.y0, room.y0);
    f.y1 = Math.max(f.y1, room.y1);
  }
  return true;
}

// A sharp corner of a sticker is narrower than the dilated walls, so the flood stops short and paper shows as a fleck.
// A sticker's line is crisp, not porous, so here the fill may creep on to the real line. Never for a child's crayon line.
function creepIntoCorners(g, f) {
  const { raw, vis, w, h } = g;
  let edge = [];
  const x0 = Math.max(0, f.x0 - 1), x1 = Math.min(w - 1, f.x1 + 1), y0 = Math.max(0, f.y0 - 1), y1 = Math.min(h - 1, f.y1 + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) if (vis[y * w + x] === f.mark) edge.push(x, y);
  }
  for (let step = 0; step < CORNER_CREEP_PX; step++) {
    const next = [];
    for (let i = 0; i < edge.length; i += 2) {
      const x = edge[i], y = edge[i + 1];
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const at = ny * w + nx;
        if (raw[at] || vis[at]) continue;
        vis[at] = f.mark;
        f.area++;
        if (nx < f.x0) f.x0 = nx;
        if (nx > f.x1) f.x1 = nx;
        if (ny < f.y0) f.y0 = ny;
        if (ny > f.y1) f.y1 = ny;
        next.push(nx, ny);
      }
    }
    edge = next;
  }
}

// ---- regions: row runs at read resolution, relative to bbox. [row, x, len, row, x, len, ...] ----

function encodeRegion(g, f) {
  const { rect, w, vis } = g;
  const bbox = { x: f.x0 + rect.x, y: f.y0 + rect.y, w: f.x1 - f.x0 + 1, h: f.y1 - f.y0 + 1 };
  const rle = [];
  for (let y = f.y0; y <= f.y1; y++) {
    const row = y * w;
    let x = f.x0;
    while (x <= f.x1) {
      if (vis[row + x] !== f.mark) { x++; continue; }
      const start = x;
      while (x <= f.x1 && vis[row + x] === f.mark) x++;
      rle.push(y - f.y0, start - f.x0, x - start);
    }
  }
  return { bbox, rle, area: f.area };
}

function regionHas(region, x, y) {
  const { bbox, rle } = region;
  const row = y - bbox.y, col = x - bbox.x;
  if (row < 0 || col < 0 || row >= bbox.h || col >= bbox.w) return false;
  for (let i = 0; i < rle.length; i += 3) {
    if (rle[i] > row) return false;
    if (rle[i] === row && col >= rle[i + 1] && col < rle[i + 1] + rle[i + 2]) return true;
  }
  return false;
}

// The eraser, a Clear or a stale saved list can leave memory of cloth that is no longer there.
function regionIsLive(region) {
  const { bbox, rle } = region;
  const data = readPaint(bbox);
  let total = 0, painted = 0;
  for (let i = 0; i < rle.length; i += 3) {
    const row = rle[i] * bbox.w;
    for (let x = rle[i + 1], end = x + rle[i + 2]; x < end; x++) {
      total++;
      if (data[(row + x) * 4 + 3] > LIMITS.fillAlpha) painted++;
    }
  }
  return total > 0 && painted * 2 >= total;
}

function findRegion(sheet, seed, painted) {
  const book = bookOf(sheet);
  const tries = painted ? offsets() : [[0, 0]];
  for (const [dx, dy] of tries) {
    for (let i = book.regions.length - 1; i >= 0; i--) {
      const r = book.regions[i];
      if (!regionHas(r, seed.x + dx, seed.y + dy)) continue;
      if (regionIsLive(r)) return r;
      book.regions.splice(i, 1);
      saveList(sheet);
    }
  }
  return null;
}

function saveList(sheet) {
  store.saveRegions(sheet, getRegions(sheet));
}

// ---- compose ----

function maskFromRuns(region, limit) {
  const { bbox, rle } = region;
  const x0 = Math.max(limit.x, bbox.x - MASK_GROW), y0 = Math.max(limit.y, bbox.y - MASK_GROW);
  const x1 = Math.min(limit.x + limit.w, bbox.x + bbox.w + MASK_GROW), y1 = Math.min(limit.y + limit.h, bbox.y + bbox.h + MASK_GROW);
  const m = { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  const on = new Uint8Array(m.w * m.h);
  const dx = bbox.x - m.x, dy = bbox.y - m.y;
  for (let i = 0; i < rle.length; i += 3) {
    const y = rle[i] + dy;
    if (y < 0 || y >= m.h) continue;
    const a = Math.max(0, rle[i + 1] + dx), b = Math.min(m.w, rle[i + 1] + rle[i + 2] + dx);
    if (b > a) on.fill(1, y * m.w + a, y * m.w + b);
  }
  return { rect: m, runs: on, grown: dilate(on, m.w, m.h, MASK_GROW) };
}

function alphaCanvas(bytes, w, h) {
  const c = mk(w, h);
  const img = c.ctx.createImageData(w, h);
  for (let i = 0, j = 3; i < bytes.length; i++, j += 4) img.data[j] = bytes[i] ? 255 : 0;
  c.ctx.putImageData(img, 0, 0);
  return c;
}

function anchored(ctx, b, S, source, alpha, op) {
  const k = S / 2; // tiles are drawn for a 2x backing, and stay the same size on the paper at 1x
  ctx.save();
  ctx.globalCompositeOperation = op;
  ctx.globalAlpha = alpha;
  ctx.setTransform(k, 0, 0, k, -b.x, -b.y);
  ctx.fillStyle = ctx.createPattern(source, 'repeat');
  ctx.fillRect(b.x / k, b.y / k, b.w / k, b.h / k);
  ctx.restore();
}

// Tinted cloth with metal flecks: the same lightness ramp as the glitter brush, so a pour and a stroke look related.
const glitterTiles = new Map();
function glitterTile(hex) {
  let tile = glitterTiles.get(hex);
  if (tile) return tile;
  const n = 128, r = rng(parseInt(hex.slice(1), 16));
  tile = mk(n, n);
  const x = tile.ctx;
  const [R, G, B] = [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16));
  const shade = l => {
    const m = v => Math.round(l < 0 ? v * (1 + l) : v + (255 - v) * l);
    return `rgb(${m(R)},${m(G)},${m(B)})`;
  };
  x.fillStyle = shade(.45);
  x.fillRect(0, 0, n, n);
  for (let i = 0; i < 1500; i++) {
    const u = r(), l = u < .08 ? -.55 : u < .2 ? -.25 : u < .62 ? 0 : u < .82 ? .2 : u < .94 ? .55 : .92;
    const s = 2 + r() * 4, a = r() * Math.PI, px = r() * n, py = r() * n;
    x.setTransform(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), px, py);
    x.fillStyle = shade(l);
    x.fillRect(-s / 2, -s / 3, s, s * 2 / 3);
  }
  x.setTransform(1, 0, 0, 1, 0, 0);
  glitterTiles.set(hex, tile);
  return tile;
}

function glitterStars(ctx, b, S, hex, seed) {
  const r = rng(seed), count = Math.min(26, Math.round(b.w * b.h / (S * S * 2600)));
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < count; i++) {
    const x = r() * b.w, y = r() * b.h, s = (5 + r() * 9) * S;
    ctx.globalAlpha = .7;
    ctx.fillStyle = hex;
    ctx.beginPath();
    ctx.arc(x, y, s * .22, 0, 7);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, d = k % 2 ? s * .12 : s * .5;
      ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
    }
    ctx.fill();
  }
  ctx.restore();
}

function paintSwatch(ctx, sw, b, S, seed) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-in';
  if (sw.kind === 'fabric') {
    ctx.restore();
    anchored(ctx, b, S, textures.tile(sw.fabric), 1, 'source-in');
    return;
  }
  if (sw.kind === 'rainbow') {
    const g = ctx.createLinearGradient(0, 0, 0, b.h), n = RAINBOW.length;
    RAINBOW.forEach((c, i) => {
      g.addColorStop(i / n, c);
      g.addColorStop((i + 1) / n, c);
    });
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, b.w, b.h);
    ctx.restore();
    return;
  }
  if (sw.kind === 'glitter') {
    ctx.restore();
    anchored(ctx, b, S, glitterTile(sw.hex), 1, 'source-in');
    glitterStars(ctx, b, S, sw.hex, seed);
    return;
  }
  ctx.fillStyle = sw.hex;
  ctx.fillRect(0, 0, b.w, b.h);
  ctx.restore();
}

function addRim(ctx, mask, b, strength) {
  const half = mk(mask.width / 2, mask.height / 2);
  half.ctx.imageSmoothingQuality = 'high';
  half.ctx.drawImage(mask, 0, 0, half.width, half.height);
  const tiny = mk(Math.max(2, half.width >> 2), Math.max(2, half.height >> 2));
  tiny.ctx.imageSmoothingQuality = 'high';
  tiny.ctx.drawImage(half, 0, 0, tiny.width, tiny.height);
  const x = half.ctx;
  x.globalCompositeOperation = 'destination-out';
  x.imageSmoothingQuality = 'high';
  x.drawImage(tiny, 0, 0, half.width, half.height);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = NAVY;
  x.fillRect(0, 0, half.width, half.height);
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = strength;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(half, 0, 0, b.w, b.h);
  ctx.restore();
}

// One soft crease: a shadow with a little light beside it. Radial with a stretch, because linear ones show hard rectangles.
function crease(ctx, x, y, halfLen, halfWidth, angle, strength) {
  const k = halfLen / halfWidth;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(1, k);
  const dark = ctx.createRadialGradient(0, 0, 0, 0, 0, halfWidth);
  dark.addColorStop(0, `rgba(12,20,50,${strength})`);
  dark.addColorStop(.55, `rgba(12,20,50,${strength * .42})`);
  dark.addColorStop(1, 'rgba(12,20,50,0)');
  ctx.fillStyle = dark;
  ctx.fillRect(-halfWidth, -halfWidth, 2 * halfWidth, 2 * halfWidth);
  ctx.translate(halfWidth * 1.05, 0);
  const light = ctx.createRadialGradient(0, 0, 0, 0, 0, halfWidth * .8);
  light.addColorStop(0, `rgba(255,255,255,${strength * .55})`);
  light.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = light;
  ctx.fillRect(-halfWidth, -halfWidth, 2 * halfWidth, 2 * halfWidth);
  ctx.restore();
}

function addFolds(ctx, b, S, seed, stickerFolds, depth = 1) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  if (stickerFolds) {
    for (const f of stickerFolds) crease(ctx, f.x * S - b.x, f.y * S - b.y, f.len * S, f.width * S, f.angle, (f.strength ?? .17) * depth);
  } else {
    const r = rng(seed);
    for (let i = 0; i < 5; i++) {
      const x = b.w * (.14 + .72 * (i + .2 + r() * .6) / 5), y = b.h * (.42 + r() * .28);
      crease(ctx, x, y, b.h * (.16 + r() * .16), (8 + r() * 9) * S, (r() - .5) * .22, .16 * depth);
    }
  }
  ctx.restore();
}

// ---- the seam: a running stitch set in from the edge, for cloth poured into a shape that has no hem of its own ----

// Boundary edges of a pixel mask, walked into closed loops on the (w+1)x(h+1) vertex grid. Inside is on the right.
function traceLoops(inside, w, h) {
  const W1 = w + 1, next = new Map();
  const link = (a, b) => {
    const list = next.get(a);
    if (list) list.push(b); else next.set(a, [b]);
  };
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? inside[y * w + x] : 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      const v = (vx, vy) => vy * W1 + vx;
      if (!at(x, y - 1)) link(v(x, y), v(x + 1, y));
      if (!at(x + 1, y)) link(v(x + 1, y), v(x + 1, y + 1));
      if (!at(x, y + 1)) link(v(x + 1, y + 1), v(x, y + 1));
      if (!at(x - 1, y)) link(v(x, y + 1), v(x, y));
    }
  }
  const loops = [];
  for (const start of [...next.keys()]) {
    while (next.get(start)?.length) {
      const pts = [];
      let v = start;
      do {
        const list = next.get(v);
        if (!list?.length) break;
        pts.push(v % W1, v / W1 | 0);
        v = list.pop();
      } while (v !== start);
      if (pts.length >= SEAM_MIN_LOOP_PX * 2) loops.push(pts);
    }
  }
  return loops;
}

function smoothLoop(pts, passes = 3, span = 4) {
  const n = pts.length / 2;
  let cur = Float32Array.from(pts);
  for (let k = 0; k < passes; k++) {
    const out = new Float32Array(pts.length), win = 2 * span + 1;
    let sx = 0, sy = 0;
    for (let i = -span; i <= span; i++) {
      const j = (i + n) % n;
      sx += cur[j * 2];
      sy += cur[j * 2 + 1];
    }
    for (let i = 0; i < n; i++) {
      out[i * 2] = sx / win;
      out[i * 2 + 1] = sy / win;
      const a = (i - span + n) % n, c = (i + span + 1) % n;
      sx += cur[c * 2] - cur[a * 2];
      sy += cur[c * 2 + 1] - cur[a * 2 + 1];
    }
    cur = out;
  }
  return cur;
}

function addSeam(ctx, mask, b, S, thread) {
  const { rect: m, runs } = mask;
  if (m.w < SEAM_MIN_BOX_PX || m.h < SEAM_MIN_BOX_PX) return;
  const outside = new Uint8Array(m.w * m.h);
  for (let i = 0; i < runs.length; i++) outside[i] = runs[i] ? 0 : 1;
  const grown = dilate(outside, m.w, m.h, SEAM_INSET_PX);
  for (let i = 0; i < grown.length; i++) grown[i] = grown[i] ? 0 : 1;
  const loops = traceLoops(grown, m.w, m.h).map(smoothLoop);
  if (!loops.length) return;
  const path = new Path2D();
  for (const lp of loops) {
    for (let i = 0; i < lp.length; i += 4) {
      const x = lp[i] * S, y = lp[i + 1] * S;
      if (i) path.lineTo(x, y); else path.moveTo(x, y);
    }
    path.closePath();
  }
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(SEAM_DASH.map(v => v * S));
  ctx.lineWidth = 1.25 * S;
  ctx.strokeStyle = 'rgba(12,20,50,.3)';
  ctx.translate(.4 * S, .7 * S);
  ctx.stroke(path);
  ctx.translate(-.4 * S, -.7 * S);
  ctx.strokeStyle = thread;
  ctx.stroke(path);
  ctx.restore();
}

// ---- building what will be committed ----

export function cloth(mark, swatchId, seedN, limit) {
  const sw = swatchById(swatchId);
  if (!sw) return null;
  return compose({ region: stickers.solidRuns(mark, { any: true }), sw, seed: { x: seedN, y: 17 }, limit, repour: false, sheet: 0, stickerMark: mark, blank: true });
}

function compose({ region, sw, seed, limit, repour, sheet, stickerMark, blank = false }) {
  const S = engine.scale();
  const mask = maskFromRuns(region, limit);
  const m = mask.rect;
  const b = { x: m.x * S, y: m.y * S, w: m.w * S, h: m.h * S };
  const maskCv = alphaCanvas(mask.grown, m.w, m.h);

  const up = mk(b.w, b.h);
  up.ctx.imageSmoothingEnabled = true;
  up.ctx.imageSmoothingQuality = 'high';
  up.ctx.drawImage(maskCv, 0, 0, b.w, b.h);

  const temp = mk(b.w, b.h);
  temp.ctx.drawImage(up, 0, 0);
  const noise = (seed.x * 73 + seed.y * 179 + region.bbox.w) | 0;
  paintSwatch(temp.ctx, sw, b, S, noise);
  const isCloth = sw.kind === 'fabric';
  addRim(temp.ctx, maskCv, b, isCloth ? .55 : .25);
  if (isCloth && Math.max(region.bbox.w, region.bbox.h) >= FOLD_MIN_PX) {
    addFolds(temp.ctx, b, S, noise, stickerMark ? stickers.markFolds(stickerMark) : null, PALE_CLOTH.has(sw.fabric) ? .5 : 1);
  }
  if (isCloth && !stickerMark) addSeam(temp.ctx, mask, b, S, sw.thread);
  if (sw.kind === 'solid' || sw.kind === 'skin') anchored(temp.ctx, b, S, textures.grain(), .11, 'destination-out');

  const final = mk(b.w, b.h);
  const fx = final.ctx;
  if (!blank) fx.drawImage(engine.paintCanvas(), b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
  if (repour) {
    fx.globalCompositeOperation = 'destination-out';
    fx.drawImage(up, 0, 0);
  }
  fx.globalCompositeOperation = 'destination-over';
  fx.drawImage(temp, 0, 0);
  fx.globalCompositeOperation = 'source-over';
  if (repour) relayLines(fx, sheet, up, b, S);
  temp.width = temp.height = 1;
  return { final, up, b, rect: m, S };
}

// The removal above also takes any sticker line it covers, and a hem lies right inside the mask. Lay them back, only there.
function relayLines(fx, sheet, up, b, S) {
  const marks = bookOf(sheet).marks.filter(k => {
    const r = stickers.markRect(k);
    return r.x * S < b.x + b.w && b.x < (r.x + r.w) * S && r.y * S < b.y + b.h && b.y < (r.y + r.h) * S;
  });
  if (!marks.length) return;
  const art = mk(b.w, b.h), x = art.ctx;
  x.translate(-b.x, -b.y);
  for (const k of marks) stickers.paintLines(x, k, S);
  x.setTransform(1, 0, 0, 1, 0, 0);
  // Saturate the mask's soft edge. There the old line is part-removed, and a part-alpha relay would leave a hairline.
  const hard = mk(b.w, b.h);
  hard.ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) hard.ctx.drawImage(up, 0, 0);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(hard, 0, 0);
  fx.drawImage(art, 0, 0);
}

// ---- reveal ----

function wobblePath(cx, cy, r, t, ph) {
  const n = 72, pts = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    const k = 1 + .06 * Math.sin(3 * a + ph[0] + t * 5) + .035 * Math.sin(5 * a + ph[1] - t * 7) + .016 * Math.sin(11 * a + ph[2] + t * 11);
    pts.push(cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k);
  }
  const p = new Path2D();
  p.moveTo((pts[n * 2 - 2] + pts[0]) / 2, (pts[n * 2 - 1] + pts[1]) / 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    p.quadraticCurveTo(pts[i * 2], pts[i * 2 + 1], (pts[i * 2] + pts[j * 2]) / 2, (pts[i * 2 + 1] + pts[j * 2 + 1]) / 2);
  }
  p.closePath();
  return p;
}

function drawFrontOn(j, path, t) {
  const { front, S, thread, up } = j;
  const f = front.ctx;
  f.save();
  f.setTransform(1, 0, 0, 1, 0, 0);
  f.globalCompositeOperation = 'source-over';
  f.clearRect(0, 0, front.width, front.height);
  const fade = Math.min(1, (1 - t) * 4);
  f.lineJoin = 'round';
  f.globalAlpha = fade;
  f.strokeStyle = 'rgba(22,34,74,.09)';
  for (const w of [22, 14, 7]) {
    f.lineWidth = w * S;
    f.stroke(path);
  }
  f.lineCap = 'round';
  if (thread) {
    f.setLineDash(SEAM_DASH.map(v => v * S * 1.1));
    f.lineDashOffset = -t * 70 * S;
    f.lineWidth = 1.5 * S;
    f.strokeStyle = thread;
    f.stroke(path);
    f.setLineDash([]);
  } else {
    f.lineWidth = 1.5 * S;
    f.strokeStyle = 'rgba(255,255,255,.75)';
    f.stroke(path);
  }
  f.globalAlpha = 1;
  f.globalCompositeOperation = 'destination-in';
  f.drawImage(up, 0, 0);
  f.restore();
}

function revealFrame(now) {
  const j = job;
  if (!j) return;
  const wall = now - j.start;
  j.played += Math.min(Math.max(now - j.last, 0), LATE_FRAME_MS);
  j.last = now;
  const t = Math.min(1, Math.max(j.played / LIMITS.fillRevealMs, wall / (LIMITS.fillRevealMs * REVEAL_STRETCH)));
  if (t >= 1) { const rect = j.rect, cloth = j.thread; finishReveal(); if (cloth) burst(rect); return; }
  j.raf = requestAnimationFrame(revealFrame);
  const spent = performance.now();
  const ease = 1 - Math.pow(1 - t, 2.1);
  const live = engine.liveCtx();
  const path = wobblePath(j.cx, j.cy, j.r0 + (j.rMax - j.r0) * ease, t, j.ph);
  live.save();
  live.setTransform(1, 0, 0, 1, j.b.x, j.b.y);
  live.clearRect(0, 0, j.b.w, j.b.h);
  live.fillStyle = j.pattern;
  live.fill(path);
  if (!j.plain) {
    drawFrontOn(j, path, t);
    live.drawImage(j.front, 0, 0);
  }
  live.restore();
  // The first frames carry the texture upload, so only a run of slow ones gives up the stitched rim.
  j.slow = performance.now() - spent > SLOW_FRAME_MS ? (j.slow || 0) + 1 : 0;
  if (j.slow >= 3) j.plain = true;
}

// Cloth lands with a small shower of gold from its edges: part of the gasp, and on the FX layer, so nothing is saved.
function burst(rect) {
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2 + Math.random() * .4;
    const c = viewport.toClient(rect.x + rect.w * (.5 + .52 * Math.cos(a)), rect.y + rect.h * (.5 + .52 * Math.sin(a)));
    fxLayer.sparkle(c.x, c.y);
  }
}

function farthest(region, cx, cy) {
  const { bbox, rle } = region;
  let d2 = 0;
  for (let i = 0; i < rle.length; i += 3) {
    const y = bbox.y + rle[i] - cy, a = bbox.x + rle[i + 1] - cx, b = a + rle[i + 2];
    d2 = Math.max(d2, a * a + y * y, b * b + y * y);
  }
  return Math.sqrt(d2);
}

function startReveal(j) {
  j.done = new Promise(resolve => {
    job = j;
    j.resolve = resolve;
    if (reducedMotion() || document.hidden) { finishReveal(); return; }
    const { S, b, seed, region, sw } = j;
    const r = rng(seed.x * 31 + seed.y);
    j.ph = [r() * 6.28, r() * 6.28, r() * 6.28];
    j.cx = seed.x * S - b.x;
    j.cy = seed.y * S - b.y;
    j.r0 = 5 * S;
    j.rMax = (farthest(region, seed.x, seed.y) + MASK_GROW + 2) * S * 1.14; // the wobble must not leave a corner unfilled at the end
    j.thread = sw.thread ?? null;
    j.front = mk(b.w, b.h);
    j.pattern = j.front.ctx.createPattern(j.final, 'no-repeat');
    const live = engine.liveCtx();
    live.canvas.style.opacity = '1';
    j.start = j.last = performance.now();
    j.played = 0;
    j.raf = requestAnimationFrame(revealFrame);
    j.timer = setTimeout(finishReveal, LIMITS.fillRevealMs * REVEAL_STRETCH + 250); // rAF stops in a hidden tab, and the commit must still happen
  });
  return j.done;
}

// Autosave waits here while the page is visible: a save that ended the pour early would kill the gasp, every time.
export function revealSettled() { return job?.done ?? Promise.resolve(); }

export function finishReveal() {
  const j = job;
  if (!j) return;
  job = null;
  cancelAnimationFrame(j.raf);
  clearTimeout(j.timer);
  const live = engine.liveCtx();
  live.save();
  live.setTransform(1, 0, 0, 1, 0, 0);
  live.clearRect(j.b.x, j.b.y, j.b.w, j.b.h);
  live.restore();
  if (engine.activeSheet() === j.sheet) commitPour(j);
  else log('fill', 'reveal outlived its sheet');
  if (j.front) j.front.width = j.front.height = 1;
  j.final.width = j.final.height = 1;
  j.up.width = j.up.height = 1;
  j.resolve('ok');
}

function commitPour(j) {
  const { final, b, rect, sheet, swatchId, region, replaced } = j;
  const commitId = engine.commitRaster(rect, ctx => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(b.x, b.y, b.w, b.h);
    ctx.drawImage(final, b.x, b.y);
    ctx.restore();
  }, { tool: 'fill', swatchId });
  const book = bookOf(sheet);
  const entry = { id: nextRegionId++, commitId, bbox: region.bbox, rle: region.rle, swatchId };
  const drop = [];
  if (replaced) {
    const i = book.regions.indexOf(replaced);
    if (i >= 0) book.regions.splice(i, 1);
    drop.push(replaced);
  }
  book.regions.push(entry);
  while (book.regions.length > LIMITS.regionsPerSheet) book.regions.shift();
  book.history.set(commitId, { add: [entry], drop });
  saveList(sheet);
}

// ---- undo memory ----

function onUndo({ sheet, id, dir }) {
  const book = sheets.get(sheet);
  const step = book?.history.get(id);
  if (!step) return;
  const [out, back] = dir < 0 ? [step.add, step.drop] : [step.drop, step.add];
  book.regions = book.regions.filter(r => !out.includes(r));
  book.marks = book.marks.filter(r => !out.includes(r));
  for (const r of back) (r.sticker ? book.marks : book.regions).push(r);
  saveList(sheet);
}

function onCommit({ sheet, id, rect, tool }) {
  if (tool === 'fill' || !rect || rect.w < SHEET_W - 1 || rect.h < SHEET_H - 1) return;
  const book = bookOf(sheet); // Clear page. Undo brings the memory back together with the pixels.
  book.history.set(id, { add: [], drop: [...book.regions, ...book.marks] });
  book.regions = [];
  book.marks = [];
  saveList(sheet);
}

// ---- public ----

function regionWithin({ bbox }, r) {
  return bbox.x >= r.x - STICKER_MARGIN_PX && bbox.y >= r.y - STICKER_MARGIN_PX
    && bbox.x + bbox.w <= r.x + r.w + STICKER_MARGIN_PX && bbox.y + bbox.h <= r.y + r.h + STICKER_MARGIN_PX;
}

function intersect(a, b) {
  const x = Math.max(Math.floor(a.x), b.x), y = Math.max(Math.floor(a.y), b.y);
  const r = Math.min(Math.ceil(a.x + a.w), b.x + b.w), bt = Math.min(Math.ceil(a.y + a.h), b.y + b.h);
  return { x, y, w: r - x, h: bt - y };
}

function decide(sheet, pt, boxId, near) {
  const seed = { x: Math.round(pt.x), y: Math.round(pt.y) };
  if (!inRect(sheetRect(), seed) || targets.isDark(sheet, seed)) return { result: 'miss' };
  const box = boxId ? BOXES[boxId] : null;
  if (box && (box.sheet !== sheet || !inRect(box.rect, seed))) return { result: 'miss' };

  const rect = near ? intersect(near, box ? box.rect : sheetRect()) : box ? box.rect : sheetRect();
  const data = readPaint(rect);
  const seedAt = ((seed.y - rect.y) * rect.w + seed.x - rect.x) * 4;
  const painted = data[seedAt + 3] > LIMITS.fillAlpha;
  const reuse = findRegion(sheet, seed, painted);
  if (reuse) {
    const mark = stickers.markAt(bookOf(sheet).marks, seed);
    const stickerMark = mark && regionWithin(reuse, stickers.markRect(mark)) ? mark : null; // keeps its folds, gains no seam
    return { result: 'ok', region: reuse, seed, repour: true, limit: sheetRect(), replaced: reuse, stickerMark };
  }

  const grid = buildGrid(sheet, rect, data, !!box || !!near);
  const sx = seed.x - rect.x, sy = seed.y - rect.y;
  const floods = grid.wall[sy * rect.w + sx] ? floodBesideLine(grid, seed) : [Object.assign(flood(grid, sx, sy, 1), { seed })];
  if (!floods.length) return { result: 'miss' };
  const chosen = chooseFlood(grid, floods);
  if (typeof chosen === 'string') return { result: chosen };

  const mark = stickers.markAt(bookOf(sheet).marks, chosen.seed);
  const joined = mark ? joinStickerRooms(grid, chosen, mark) : false;
  if (joined) creepIntoCorners(grid, chosen);
  const region = encodeRegion(grid, chosen);
  return { result: 'ok', region, seed: chosen.seed, repour: false, limit: rect, stickerMark: joined ? mark : null };
}

export async function pour(sheet, pt, swatchId, { box, near } = {}) {
  listen();
  finishReveal();
  try {
    await engine.flush(); // a watercolor bake may still be landing
    finishReveal();
    const sw = swatchById(swatchId);
    if (!sw || sheet !== engine.activeSheet() || engine.isStroking()) return report('miss', pt);
    const d = decide(sheet, stickers.takeRedirect(pt), box, near);
    if (d.result !== 'ok') return report(d.result, pt);
    const made = compose({ ...d, sw, sheet });
    const done = startReveal({ ...made, sheet, swatchId, sw, seed: d.seed, region: d.region, replaced: d.replaced });
    report('ok', pt);
    return await done;
  } catch (err) {
    log('fill', 'pour: ' + err.message);
    finishReveal();
    return report('miss', pt);
  }
}

function report(result, pt) {
  emit('fill:result', { result, pt });
  return result;
}

export function getRegions(sheet) {
  const book = sheets.get(sheet);
  return book ? [...book.regions, ...book.marks] : [];
}

export function setRegions(sheet, list) {
  listen();
  const book = bookOf(sheet);
  book.regions = [];
  book.marks = [];
  book.history.clear();
  for (const r of Array.isArray(list) ? list : []) {
    if (r?.sticker && Number.isFinite(r.x) && Number.isFinite(r.y) && r.s > 0) book.marks.push(r);
    else if (r?.bbox && Array.isArray(r.rle)) {
      book.regions.push(r);
      if (r.id >= nextRegionId) nextRegionId = r.id + 1;
    }
  }
}

// Additive to the contract. stickers.js tells the page's memory what it just flattened, so a later tap can pour the whole
// garment, and a pour can lay the sticker's own lines back. A solid sticker also becomes a region: its colour can be replaced.
export function noteSticker(sheet, commitId, mark) {
  listen();
  const book = bookOf(sheet);
  const entry = { ...mark, commitId };
  book.marks.push(entry);
  while (book.marks.length > MARKS_PER_SHEET) book.marks.shift();
  const add = [entry];
  const inner = stickers.solidRuns(mark);
  if (inner) {
    const region = { id: nextRegionId++, commitId, bbox: inner.bbox, rle: inner.rle, swatchId: null };
    book.regions.push(region);
    add.push(region);
  }
  book.history.set(commitId, { add, drop: [] });
  saveList(sheet);
}
