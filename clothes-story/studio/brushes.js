// The marks (section 4.6). A brush turns sheet-px points into pixels on the live canvas; the engine owns when.
// All coordinates below are backing px unless a name says otherwise.
import { getStrokeOutlinePoints, getStrokePoints } from '../vendor/perfect-freehand.js?v=1';
import { fleckTile, flecks, mk, pickFleck, tile, toothNow } from './textures.js?v=1';

const SCRATCH = 720;
const TAU = Math.PI * 2;
const NAVY_SHADOW = 'rgba(22,34,74,.28)';
const CHUNK_POINTS = 64;
const MAX_TURN = (4 * Math.PI) / 180;
const MAX_RUN_TURN = (24 * Math.PI) / 180;
const RAINBOW = ['#F2594B', '#F98F1D', '#FFD60A', '#3FA34D', '#18A3D0', '#3B4BA8', '#7C55C7'];
const GRAPHITE = '#3A3D46';
const NAVY_HEX = '#16224A';
const SPRITE_LRU = 8;

const rng = s => () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const smooth = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };
const hexRgb = hex => [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16));

// ---- rects ----

const rectOf = (x0, y0, x1, y1) => {
  const x = Math.floor(x0), y = Math.floor(y0);
  return { x, y, w: Math.ceil(x1) - x, h: Math.ceil(y1) - y };
};
export const uniteRects = (a, b) => {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const grow = (r, m) => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });

// ---- the sprite cache: per (kind, size bucket, color) ----

const sprites = new Map();
function cached(key, make) {
  let c = sprites.get(key);
  if (c) sprites.delete(key);
  else c = make();
  sprites.set(key, c);
  while (sprites.size > SPRITE_LRU) sprites.delete(sprites.keys().next().value);
  return c;
}

// ---- the walker: smooths input, then walks at fixed spacing ----

// Tangents come from the smoothed path only, because raw headings fringe the rainbow.
class Walker {
  constructor(spacing) {
    this.spacing = spacing;
    this.started = false;
    this.carry = spacing; // so the first step lands on the start point itself
    this.hx = 0; this.hy = 0;
    this.p = 0.7;
    this.travel = 0;
  }
  push(x, y, p, emit) {
    this.raw = { x, y, p };
    if (!this.started) {
      this.started = true;
      this.sx = this.lx = x;
      this.sy = this.ly = y;
      this.p = p;
      return;
    }
    this.sx += (x - this.sx) * 0.45;
    this.sy += (y - this.sy) * 0.45;
    this.p += (p - this.p) * 0.35;
    const dx = this.sx - this.lx, dy = this.sy - this.ly, L = Math.hypot(dx, dy);
    if (L < 0.01) return;
    this.hx += (dx / L - this.hx) * 0.35;
    this.hy += (dy / L - this.hy) * 0.35;
    const an = Math.atan2(this.hy, this.hx), s = this.spacing;
    let t = s - this.carry;
    while (t <= L) {
      emit(this.lx + dx * t / L, this.ly + dy * t / L, an, this.p);
      t += s;
    }
    this.carry = L - (t - s);
    this.travel += L;
    this.lx = this.sx;
    this.ly = this.sy;
  }
  // The smoothed path lags the finger, so at the end it catches up and the mark reaches where the finger stopped.
  settle(emit) {
    if (!this.raw) return;
    for (let i = 0; i < 16; i++) {
      if (Math.hypot(this.raw.x - this.sx, this.raw.y - this.sy) < 0.4) break;
      this.push(this.raw.x, this.raw.y, this.raw.p, emit);
    }
  }
}

// ---- crayon and pencil: stamps on the scratch, one pass of the tooth, then a blit ----

// A lateral profile: the wear of the stick, so the wax leaves streaks along the stroke.
function streaks(d, r, depth) {
  const a = new Float32Array(d);
  for (let i = 0; i < d; i++) a[i] = r();
  for (let k = 0; k < 3; k++) {
    const b = a.slice();
    for (let i = 0; i < d; i++) a[i] = (b[(i + d - 1) % d] + b[i] + b[(i + 1) % d]) / 3;
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
  for (let i = 0; i < d; i++) a[i] = 1 - depth * (1 - (a[i] - lo) / (hi - lo || 1));
  return a;
}

function waxSprite(hex, d, seed, depth, edgePx) {
  const c = mk(d, d), x = c.getContext('2d'), im = x.createImageData(d, d), r = rng(seed);
  const lat = streaks(d, r, depth), [R, G, B] = hexRgb(hex), edge = Math.min(0.5, edgePx / d), mid = (d - 1) / 2;
  for (let y = 0; y < d; y++) {
    for (let x0 = 0; x0 < d; x0++) {
      const rr = Math.hypot((x0 - mid) / (d / 2), (y - mid) / (d / 2));
      const a = smooth(1, 1 - edge, rr + (r() - 0.5) * edge) * lat[y];
      const i = (y * d + x0) * 4;
      im.data[i] = R; im.data[i + 1] = G; im.data[i + 2] = B; im.data[i + 3] = 255 * a;
    }
  }
  x.putImageData(im, 0, 0);
  return c;
}

const patterns = new WeakMap();
function maskPattern(ctx, mask) {
  let e = patterns.get(mask);
  if (!e || e.ctx !== ctx) patterns.set(mask, e = { ctx, pattern: ctx.createPattern(mask, 'repeat') });
  return e.pattern;
}

const WAX = {
  crayon: { spacing: 0.16, late: 0.22, alpha: 0.86, floor: 0.24, jitter: 0.05, streak: 0.7, sweep: 0.125, press: 0, edge: 5 },
  // Graphite stays translucent even on the paper's hills, so a line has a dark core and fuzzy sides, slow writing comes
  // out darker than fast, and going over a line darkens it. Stamps overlap about six deep, so this adds up to about .8.
  pencil: { spacing: 0.16, late: 0.22, alpha: 0.34, floor: 0.42, jitter: 0.03, streak: 0.2, sweep: 0.2, press: 0.6, edge: 2.5 },
};

function waxBrush(kind, o) {
  const cfg = WAX[kind], Db = o.D * o.S, r = rng(o.seed), sc = o.scratch.getContext('2d'), live = o.live;
  const hex = kind === 'pencil' && o.swatch.hex === NAVY_HEX ? GRAPHITE : o.swatch.hex;
  const d = Math.max(4, Math.ceil(Db / 4) * 4);
  const sprite = cached(`${kind}|${d}|${hex}`, () => waxSprite(hex, d, 3, cfg.streak, cfg.edge));
  const isPen = () => o.penLike;
  const walk = new Walker(Db * cfg.spacing);
  const margin = Math.ceil(d * 0.75) + 2;
  let pending = [], swept = 0, dirty = null, lastP = 0.7, stamped = false, sx = 0, sy = 0;

  const stamp = (x, y, an, p) => {
    const w = d * (o.penLike ? 0.5 + 0.5 * p : 0.84 + 0.16 * p) * (Db / d);
    pending.push({
      x: x + (r() - 0.5) * Db * cfg.jitter,
      y: y + (r() - 0.5) * Db * cfg.jitter,
      c: Math.cos(an), s: Math.sin(an), w,
      a: cfg.alpha * (0.88 + r() * 0.12) * (1 - cfg.press * 0.5 + cfg.press * p * 0.75),
    });
    swept += walk.spacing;
    lastP = p;
    stamped = true;
  };

  function maskFor(tex, p) {
    return (kind === 'pencil' ? tex.pencils : tex.masks)[p < 0.55 ? 0 : p < 0.8 ? 1 : 2];
  }

  // Draws stamps [i, j) as one pass. The hardness of the tooth follows distance, not frames: a pass that sweeps
  // a tenth of the brush removes just enough from the valleys that ten of them add up to one full sweep, so a slow
  // stroke on a fast screen keeps its grain instead of filling in.
  function blitPass(i, j, x0, y0, x1, y1, fraction) {
    const ox = Math.floor(x0 - margin), oy = Math.floor(y0 - margin);
    const bw = Math.min(SCRATCH, Math.ceil(x1 - x0) + 2 * margin), bh = Math.min(SCRATCH, Math.ceil(y1 - y0) + 2 * margin);
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.globalCompositeOperation = 'source-over';
    sc.globalAlpha = 1;
    sc.clearRect(0, 0, bw, bh);
    for (let k = i; k < j; k++) {
      const q = pending[k];
      sc.setTransform(q.c, q.s, -q.s, q.c, q.x - ox, q.y - oy);
      sc.globalAlpha = q.a;
      sc.drawImage(sprite, -q.w / 2, -q.w / 2, q.w, q.w);
    }
    const tex = o.tex ?? toothNow();
    if (tex) {
      sc.setTransform(1, 0, 0, 1, -ox, -oy);
      sc.globalCompositeOperation = 'destination-out';
      sc.globalAlpha = Math.pow(1 - cfg.floor, fraction);
      sc.fillStyle = maskPattern(sc, maskFor(tex, lastP));
      sc.fillRect(ox, oy, bw, bh);
    }
    live.drawImage(o.scratch, 0, 0, bw, bh, ox, oy, bw, bh);
    dirty = uniteRects(dirty, { x: ox, y: oy, w: bw, h: bh });
  }

  function drawPending() {
    const n = pending.length;
    if (!n) return;
    const fraction = Math.min(1, Math.max(cfg.sweep, swept / Db));
    let i = 0;
    while (i < n) {
      let x0 = pending[i].x, x1 = x0, y0 = pending[i].y, y1 = y0, j = i + 1;
      for (; j < n; j++) {
        const q = pending[j];
        const nx0 = Math.min(x0, q.x), nx1 = Math.max(x1, q.x), ny0 = Math.min(y0, q.y), ny1 = Math.max(y1, q.y);
        if (Math.max(nx1 - nx0, ny1 - ny0) + 2 * margin > SCRATCH) break;
        x0 = nx0; x1 = nx1; y0 = ny0; y1 = ny1;
      }
      blitPass(i, j, x0, y0, x1, y1, fraction);
      i = j;
    }
    pending = [];
    swept = 0;
  }

  const take = () => { const out = dirty; dirty = null; return out; };

  return {
    liveOpacity: 1,
    bakes: false,
    begin(pt) {
      sx = pt.x * o.S; sy = pt.y * o.S;
      walk.push(sx, sy, pt.p ?? 0.7, stamp);
    },
    extend(pts) {
      for (const p of pts) walk.push(p.x * o.S, p.y * o.S, p.p ?? 0.7, stamp);
      if (swept >= Db * cfg.sweep) drawPending();
      return take();
    },
    finish() {
      walk.settle(stamp);
      // A tap makes a dot: a few stamps on the spot, so it has the same body as a stroke.
      if (!stamped) for (let k = 0; k < 4; k++) stamp(sx, sy, r() * TAU, lastP);
      swept = Math.max(swept, Db);
      drawPending();
      return take();
    },
    setLate(late) { walk.spacing = Db * (late ? cfg.late : cfg.spacing); },
    commit(ctx, rect) { if (!o.mirrored) blit(ctx, rect, live.canvas); },
  };
}

function blit(ctx, r, from) {
  ctx.drawImage(from, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
}

// ---- polygons: marker, watercolor, fabric ----

function outlinePath(outline) {
  const path = new Path2D(), n = outline.length;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const end = outline[n - 1], first = outline[0];
  path.moveTo((end[0] + first[0]) / 2, (end[1] + first[1]) / 2);
  for (let i = 0; i < n; i++) {
    const a = outline[i], b = outline[(i + 1) % n];
    path.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    if (a[0] < x0) x0 = a[0];
    if (a[0] > x1) x1 = a[0];
    if (a[1] < y0) y0 = a[1];
    if (a[1] > y1) y1 = a[1];
  }
  path.closePath();
  return { path, box: rectOf(x0 - 2, y0 - 2, x1 + 2, y1 + 2) };
}

// One stroke as a list of polygons. A polygon is frozen every 64 points because getStroke is linear in stroke length.
// Only the tail of a polygon changes as points arrive, so each frame repaints a box around the tail: everything else
// on live is already right. Mirrored strokes share one list, since the box may also hold the other side's ink.
class PolyStroke {
  constructor(o, thinning) {
    this.ctx = o.live;
    this.size = o.D * o.S;
    this.opts = { size: this.size, thinning, smoothing: 0.6, streamline: 0.5, simulatePressure: false };
    this.polys = o.shared.polys ??= [];
    this.points = [];
    this.spine = [];
    this.tail = null;
    this.S = o.S;
    this.open();
  }
  open() {
    this.cur = { path: null, box: null };
    this.polys.push(this.cur);
  }
  add(pts) {
    for (const p of pts) this.points.push([p.x * this.S, p.y * this.S, p.p ?? 0.7]);
  }
  // Starting the next polygon from the last smoothed point keeps the path continuous across the joint.
  freeze(style) {
    const sp = this.draw(style, false);
    if (!sp?.length) return;
    this.spine.push(...sp);
    const end = sp[sp.length - 1];
    const keep = this.points.slice(-1);
    this.points = [[end.point[0], end.point[1], end.pressure], ...keep];
    this.open();
  }
  draw(style, last) {
    const opts = last ? { ...this.opts, last: true } : this.opts;
    const sp = getStrokePoints(this.points, opts);
    const outline = getStrokeOutlinePoints(sp, opts);
    if (!outline.length) return sp;
    const { path, box } = outlinePath(outline);
    this.cur.path = path;
    this.cur.box = box;
    const tail = this.tailBox(sp);
    this.repaint(uniteRects(this.tail, tail), style);
    this.tail = tail;
    return sp;
  }
  tailBox(sp) {
    const total = sp[sp.length - 1].runningLength, back = this.size * 2.5, m = Math.ceil(this.size) + 3;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = sp.length - 1; i >= 0; i--) {
      const q = sp[i].point;
      if (q[0] < x0) x0 = q[0];
      if (q[0] > x1) x1 = q[0];
      if (q[1] < y0) y0 = q[1];
      if (q[1] > y1) y1 = q[1];
      if (total - sp[i].runningLength > back) break;
    }
    return rectOf(x0 - m, y0 - m, x1 + m, y1 + m);
  }
  repaint(box, style) {
    const c = this.ctx;
    c.save();
    c.beginPath();
    c.rect(box.x, box.y, box.w, box.h);
    c.clip();
    c.clearRect(box.x, box.y, box.w, box.h);
    c.fillStyle = style;
    for (const q of this.polys) if (q.path && overlap(q.box, box)) c.fill(q.path);
    c.restore();
  }
  extend(pts, style) {
    this.add(pts);
    if (this.points.length >= CHUNK_POINTS) this.freeze(style);
    this.draw(style, false);
    return this.cur.box;
  }
  finish(style) {
    const sp = this.draw(style, true);
    if (sp?.length) this.spine.push(...sp);
    return this.cur.box ?? null;
  }
  smoothRadius(p) {
    return this.size * (0.5 - this.opts.thinning * (0.5 - p));
  }
}

function markerBrush(o) {
  const poly = new PolyStroke(o, 0.2), hex = o.swatch.hex;
  return {
    liveOpacity: 0.85,
    bakes: false,
    begin(pt) { poly.add([pt]); },
    extend(pts) { return poly.extend(pts, hex); },
    finish() { return poly.finish(hex); },
    setLate() {},
    commit(ctx, rect) {
      if (o.mirrored) return;
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.85;
      blit(ctx, rect, o.live.canvas);
    },
  };
}

function paintBrush(o) {
  const poly = new PolyStroke(o, 0.25), hex = o.swatch.hex;
  return {
    liveOpacity: 0.5,
    bakes: true,
    begin(pt) { poly.add([pt]); },
    extend(pts) { return poly.extend(pts, hex); },
    finish() { return poly.finish(hex); },
    setLate() {},
    bakeJob() { return { hex, paths: poly.polys.filter(q => q.path).map(q => q.path) }; },
    commit(ctx, rect) { // only when no bake can run: a flat wash, so nothing a child painted is ever lost
      if (o.mirrored) return;
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.5;
      blit(ctx, rect, o.live.canvas);
    },
  };
}

function tilePattern(ctx, fabricId, S) {
  const pattern = ctx.createPattern(tile(fabricId), 'repeat');
  if (S !== 2) pattern.setTransform(new DOMMatrix([S / 2, 0, 0, S / 2, 0, 0]));
  return pattern;
}

// The running stitch, walking round the ends so the patch is sewn all the way round. Returns the walk as points that
// remember which part of the spine they came from.
function stitchWalk(spine, radiusAt, inset) {
  const n = spine.length, smoothed = [];
  let arc = 0;
  for (let i = 0; i < n; i++) {
    const a = spine[Math.max(0, i - 3)].point, b = spine[Math.min(n - 1, i + 3)].point;
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const L = Math.hypot(tx, ty) || 1;
    tx /= L; ty /= L;
    if (i) arc += Math.hypot(spine[i].point[0] - spine[i - 1].point[0], spine[i].point[1] - spine[i - 1].point[1]);
    const full = radiusAt(spine[i].pressure);
    smoothed.push({ x: spine[i].point[0], y: spine[i].point[1], tx, ty, full, r: full - inset, arc });
  }
  const side = sign => {
    const out = [];
    let px = null, py = null;
    for (const q of smoothed) {
      if (q.r <= 0.5) continue;
      const x = q.x - sign * q.ty * q.r, y = q.y + sign * q.tx * q.r;
      // On the inside of a tight turn the offset runs backwards: skip it rather than draw a knot.
      if (px !== null) {
        const dx = x - px, dy = y - py;
        if (dx * q.tx + dy * q.ty <= 0) continue;
      }
      out.push({ x, y, arc: q.arc });
      px = x; py = y;
    }
    return out;
  };
  const left = side(-1), right = side(1);
  const cap = (q, from, to) => {
    const out = [];
    const steps = Math.max(4, Math.ceil(Math.abs(to - from) / 0.25));
    for (let i = 1; i < steps; i++) {
      const a = from + (to - from) * (i / steps);
      out.push({ x: q.x + Math.cos(a) * q.r, y: q.y + Math.sin(a) * q.r, arc: q.arc });
    }
    return out;
  };
  const head = smoothed[0], foot = smoothed[n - 1];
  const footAn = Math.atan2(foot.ty, foot.tx), headAn = Math.atan2(head.ty, head.tx);
  const walk = [
    ...left,
    ...cap(foot, footAn - Math.PI / 2, footAn + Math.PI / 2),
    ...right.reverse(),
    ...cap(head, headAn + Math.PI / 2, headAn + Math.PI * 1.5),
  ];
  if (walk.length) walk.push(walk[0]);
  return { walk, smoothed };
}

// Patches are sewn round their outside. Where the stroke runs over itself a stitch would land in the middle of the
// patch, and a scribble turns into a pile of thread, so a stitch that lies inside another part of the stroke is skipped.
function buriedTest(smoothed, cell, keepIn) {
  const grid = new Map(), key = (x, y) => (Math.floor(x / cell) + 4096) * 8192 + Math.floor(y / cell) + 4096;
  const put = q => {
    const k = key(q.x, q.y), list = grid.get(k);
    if (list) list.push(q); else grid.set(k, [q]);
  };
  // A fast stroke has its spine points far apart, and the stretch between them still covers the paper.
  smoothed.forEach((q, i) => {
    put(q);
    const b = smoothed[i + 1];
    if (!b) return;
    const parts = Math.min(64, Math.floor(Math.hypot(b.x - q.x, b.y - q.y) / (q.full * 0.5)));
    for (let k = 1; k < parts; k++) {
      const t = k / parts;
      put({ x: q.x + (b.x - q.x) * t, y: q.y + (b.y - q.y) * t, full: q.full, arc: q.arc + (b.arc - q.arc) * t });
    }
  });
  return (x, y, arc) => {
    for (let ax = -1; ax <= 1; ax++) {
      for (let ay = -1; ay <= 1; ay++) {
        const list = grid.get(key(x + ax * cell, y + ay * cell));
        if (!list) continue;
        for (const q of list) {
          if (Math.abs(q.arc - arc) < q.full * 2.6) continue;
          // Later passes lie on top, so they bury a stitch easily. An earlier pass only buries one deep inside it, so that a
          // stroke drawn back along itself keeps the stitches of its last pass.
          const dx = x - q.x, dy = y - q.y, reach = q.full - (q.arc > arc ? keepIn : keepIn * 3);
          if (dx * dx + dy * dy < reach * reach) return true;
        }
      }
    }
    return false;
  };
}

function stitchPath(spine, radiusAt, inset, dash, gap, keepIn) {
  const { walk, smoothed } = stitchWalk(spine, radiusAt, inset);
  const path = new Path2D();
  if (walk.length < 2) return path;
  const cell = Math.max(8, Math.max(...smoothed.map(q => q.full)));
  const buried = buriedTest(smoothed, cell, keepIn);
  let on = true, left = dash, a = walk[0], open = false;
  const start = (x, y, arc) => {
    open = !buried(x, y, arc);
    if (open) path.moveTo(x, y);
  };
  start(a.x, a.y, a.arc);
  for (let i = 1; i < walk.length; i++) {
    const b = walk[i];
    let L = Math.hypot(b.x - a.x, b.y - a.y), ax = a.x, ay = a.y;
    while (L >= left && L > 0) {
      const t = left / L, x = ax + (b.x - ax) * t, y = ay + (b.y - ay) * t;
      if (on) {
        if (open) path.lineTo(x, y);
      } else {
        start(x, y, b.arc);
      }
      on = !on;
      L -= left;
      left = on ? dash : gap;
      ax = x; ay = y;
    }
    left -= L;
    if (on && open) path.lineTo(b.x, b.y);
    a = b;
  }
  return path;
}

function fabricBrush(o) {
  const poly = new PolyStroke(o, 0.1), S = o.S, id = o.swatch.fabric, thread = o.swatch.thread;
  const style = tilePattern(o.live, id, S);
  const body = () => {
    const all = new Path2D();
    for (const q of poly.polys) if (q.path) all.addPath(q.path);
    return all;
  };

  // A soft dark inner edge: the mask minus a shrunk copy of itself, so a self-crossing stroke grows no inner rings.
  function rim(ctx, rect, path) {
    const w = Math.max(2, rect.w >> 1), h = Math.max(2, rect.h >> 1);
    const m = mk(w, h), mx = m.getContext('2d');
    mx.setTransform(w / rect.w, 0, 0, h / rect.h, -rect.x * w / rect.w, -rect.y * h / rect.h);
    mx.fill(path);
    const small = mk(Math.max(2, w >> 2), Math.max(2, h >> 2)), sx = small.getContext('2d');
    sx.imageSmoothingQuality = 'high';
    sx.drawImage(m, 0, 0, small.width, small.height);
    mx.setTransform(1, 0, 0, 1, 0, 0);
    mx.globalCompositeOperation = 'destination-out';
    mx.drawImage(small, 0, 0, w, h);
    mx.globalCompositeOperation = 'source-in';
    mx.fillStyle = NAVY_HEX;
    mx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.5;
    ctx.drawImage(m, rect.x, rect.y, rect.w, rect.h);
    ctx.globalAlpha = 1;
  }

  return {
    liveOpacity: 1,
    bakes: false,
    margin: Math.ceil(2.5 * S),
    begin(pt) { poly.add([pt]); },
    extend(pts) { return poly.extend(pts, style); },
    finish() { return poly.finish(style); },
    setLate() {},
    commit(ctx, rect) {
      const path = body();
      if (!o.mirrored) {
        ctx.save();
        ctx.translate(S, 2 * S);
        ctx.fillStyle = 'rgba(22,34,74,.22)';
        ctx.fill(path);
        ctx.restore();
        ctx.fillStyle = tilePattern(ctx, id, S);
        ctx.fill(path);
      }
      ctx.save();
      ctx.clip(path);
      if (!o.mirrored) rim(ctx, rect, path);
      const loop = stitchPath(poly.spine, p => poly.smoothRadius(p), 4.5 * S, 5.5 * S, 4 * S, 2 * S);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 1.5 * S;
      ctx.save();
      ctx.translate(0.5 * S, 0.7 * S);
      ctx.strokeStyle = 'rgba(10,16,40,.38)';
      ctx.stroke(loop);
      ctx.restore();
      ctx.strokeStyle = thread;
      ctx.stroke(loop);
      ctx.restore();
    },
  };
}

// ---- rainbow: a ribbon, seven bands of quads between cross-sections ----

function rainbowBrush(o) {
  const W = o.D * o.S, S = o.S, c = o.live, flip = o.mirrored ? -1 : 1;
  const bandEdge = i => flip * (-1 + 2 * i / RAINBOW.length);
  const walk = new Walker(1.5 * S);
  let prev = null, batch = [], dirty = null, hw = W * 0.43, startX = 0, startY = 0, startP = 0.7;

  const section = (x, y, an, half) => ({ x, y, an, half, nx: -Math.sin(an), ny: Math.cos(an) });

  // Never more than 4 degrees between cross-sections, or the outside of a U-turn opens into a fan of gaps.
  const step = (x, y, an, p) => {
    hw += (W / 2 * (0.72 + 0.28 * p) - hw) * 0.25;
    if (!prev) {
      prev = section(x, y, an, hw);
      batch.push(prev);
      return;
    }
    let da = an - prev.an;
    while (da > Math.PI) da -= TAU;
    while (da < -Math.PI) da += TAU;
    const n = Math.max(1, Math.ceil(Math.abs(da) / MAX_TURN));
    const { x: px, y: py, an: pa, half: ph } = prev;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      prev = section(px + (x - px) * t, py + (y - py) * t, pa + da * t, ph + (hw - ph) * t);
      batch.push(prev);
    }
  };

  function drawBatch() {
    if (batch.length < 2) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of batch) {
      if (q.x < x0) x0 = q.x;
      if (q.x > x1) x1 = q.x;
      if (q.y < y0) y0 = q.y;
      if (q.y > y1) y1 = q.y;
    }
    const m = W / 2 + 3;
    dirty = uniteRects(dirty, rectOf(x0 - m, y0 - m, x1 + m, y1 + m));
    // Run by run, not the whole frame band by band: when the ribbon folds at a sharp turn, the newer run simply lies on
    // the older one. Drawn band by band across a fold, colors interleave into a row of teeth. Straight stretches stay one
    // run, which keeps the fills per frame low. Each run starts a pixel back so no seam shows between two fills.
    for (let from = 0; from < batch.length - 1;) {
      let to = from + 1, turned = 0;
      while (to < batch.length - 1 && turned < MAX_RUN_TURN) {
        let da = batch[to + 1].an - batch[to].an;
        while (da > Math.PI) da -= TAU;
        while (da < -Math.PI) da += TAU;
        turned += Math.abs(da);
        to++;
      }
      for (let i = 0; i < RAINBOW.length; i++) {
        // Each band tucks under the next, so anti-aliased joins never show paper between them.
        const u0 = bandEdge(i), u1 = bandEdge(i + 1), tuck = i < RAINBOW.length - 1 ? flip * 1.1 : 0;
        c.beginPath();
        for (let k = from + 1; k <= to; k++) {
          const a = batch[k - 1], b = batch[k];
          const back = k === from + 1 ? 1 : 0, ax = a.x - Math.cos(a.an) * back, ay = a.y - Math.sin(a.an) * back;
          const e0a = u0 * a.half, e1a = u1 * a.half + tuck, e0b = u0 * b.half, e1b = u1 * b.half + tuck;
          c.moveTo(ax + a.nx * e0a, ay + a.ny * e0a);
          c.lineTo(b.x + b.nx * e0b, b.y + b.ny * e0b);
          c.lineTo(b.x + b.nx * e1b, b.y + b.ny * e1b);
          c.lineTo(ax + a.nx * e1a, ay + a.ny * e1a);
          c.closePath();
        }
        c.fillStyle = RAINBOW[i];
        c.fill();
      }
      from = to;
    }
    const last = batch[batch.length - 1];
    batch = [last];
  }

  function dot() {
    const R = W / 2 * (0.72 + 0.28 * startP);
    for (let i = 0; i < RAINBOW.length; i++) {
      c.beginPath();
      c.arc(startX, startY, R * (1 - i / RAINBOW.length), 0, TAU);
      c.fillStyle = RAINBOW[i];
      c.fill();
    }
    dirty = uniteRects(dirty, rectOf(startX - R - 2, startY - R - 2, startX + R + 2, startY + R + 2));
  }

  const take = () => { const out = dirty; dirty = null; return out; };

  return {
    liveOpacity: 1,
    bakes: false,
    begin(pt) {
      startX = pt.x * S; startY = pt.y * S; startP = pt.p ?? 0.7;
      walk.push(startX, startY, startP, step);
    },
    extend(pts) {
      for (const p of pts) walk.push(p.x * S, p.y * S, p.p ?? 0.7, step);
      drawBatch();
      return take();
    },
    finish() {
      walk.settle(step);
      drawBatch();
      if (!prev || (walk.travel < 1 && batch.length < 2)) dot();
      return take();
    },
    setLate() {},
    commit(ctx, rect) { if (!o.mirrored) blit(ctx, rect, c.canvas); },
  };
}

// ---- glitter ----

function softDisc(hex, size) {
  const c = mk(size, size), x = c.getContext('2d'), g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const [R, G, B] = hexRgb(hex);
  g.addColorStop(0, `rgba(${R},${G},${B},1)`);
  g.addColorStop(0.7, `rgba(${R},${G},${B},.9)`);
  g.addColorStop(1, `rgba(${R},${G},${B},0)`);
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return c;
}

function sparkleSprite() {
  const c = mk(48, 48), x = c.getContext('2d');
  x.translate(24, 24);
  const g = x.createRadialGradient(0, 0, 0, 0, 0, 24);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.25, 'rgba(255,255,255,.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  for (let i = 0; i < 2; i++) {
    x.beginPath();
    x.moveTo(-24, 0);
    x.quadraticCurveTo(0, -1.2, 24, 0);
    x.quadraticCurveTo(0, 1.2, -24, 0);
    x.fill();
    x.rotate(Math.PI / 2);
  }
  x.beginPath();
  x.arc(0, 0, 5, 0, TAU);
  x.fill();
  return c;
}

let sparkle = null;

function glitterBrush(o) {
  const R = o.D * o.S, S = o.S, c = o.live, sc = o.scratch.getContext('2d'), hex = o.swatch.hex, r = rng(o.seed);
  const ramp = cached(`fleck|${hex}`, () => flecks(hex));
  const dust = fleckTile(hex);
  const discSize = Math.ceil(R * 2.3);
  const disc = cached(`disc|${discSize}|${hex}`, () => softDisc(hex, discSize));
  const dustDisc = cached(`dust|${discSize}`, () => softDisc('#000000', discSize));
  const walk = new Walker(Math.max(2, R / 4));
  const tile0 = { x: Math.floor(r() * 192), y: Math.floor(r() * 192) };
  const budget = { full: 60, now: 60 };
  let steps = [], dirty = null, sinceStar = 0, startX = 0, startY = 0;
  const stars = [];

  const step = (x, y, an, p) => {
    const reach = R * (0.75 + 0.25 * p);
    steps.push({ x, y, reach });
    sinceStar += walk.spacing;
    if (sinceStar > R * 1.5 && stars.length < 26) {
      sinceStar = 0;
      const a = r() * TAU, d = reach * Math.sqrt(r()) * 0.85;
      stars.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, s: (20 + r() * 34) * S / 2 });
    }
  };

  function drawFrame() {
    const n = steps.length;
    if (!n) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of steps) {
      if (q.x < x0) x0 = q.x;
      if (q.x > x1) x1 = q.x;
      if (q.y < y0) y0 = q.y;
      if (q.y > y1) y1 = q.y;
    }
    const m = Math.ceil(R * 1.35) + 4;
    const box = rectOf(x0 - m, y0 - m, x1 + m, y1 + m);
    dirty = uniteRects(dirty, box);

    // The pale tint under the flecks
    c.globalAlpha = 0.05;
    for (const q of steps) c.drawImage(disc, q.x - q.reach * 1.15, q.y - q.reach * 1.15, q.reach * 2.3, q.reach * 2.3);
    c.globalAlpha = 1;

    // The dense dust: one fill of a dealt tile through soft discs, so density never depends on speed
    for (let oy = box.y; oy < box.y + box.h; oy += SCRATCH) {
      for (let ox = box.x; ox < box.x + box.w; ox += SCRATCH) {
        const bw = Math.min(SCRATCH, box.x + box.w - ox), bh = Math.min(SCRATCH, box.y + box.h - oy);
        sc.setTransform(1, 0, 0, 1, 0, 0);
        sc.globalCompositeOperation = 'source-over';
        sc.globalAlpha = 1;
        sc.clearRect(0, 0, bw, bh);
        for (const q of steps) sc.drawImage(dustDisc, q.x - ox - q.reach, q.y - oy - q.reach, q.reach * 2, q.reach * 2);
        sc.globalCompositeOperation = 'source-in';
        sc.setTransform(1, 0, 0, 1, -ox + tile0.x, -oy + tile0.y);
        sc.fillStyle = maskPattern(sc, dust);
        sc.fillRect(ox - tile0.x, oy - tile0.y, bw, bh);
        c.drawImage(o.scratch, 0, 0, bw, bh, ox, oy, bw, bh);
      }
    }

    // A budget of loose flecks that break the outline
    const each = Math.max(1, Math.floor(budget.now / n));
    let left = budget.now;
    for (const q of steps) {
      for (let k = 0; k < each && left > 0; k++, left--) {
        const a = r() * TAU, d = q.reach * Math.sqrt(r()) * (r() < 0.35 ? 1.28 : 0.95);
        const s = (3 + r() * 5) * S / 2, ca = r() * Math.PI, cos = Math.cos(ca), sin = Math.sin(ca);
        c.setTransform(cos, sin, -sin, cos, q.x + Math.cos(a) * d, q.y + Math.sin(a) * d);
        c.drawImage(ramp[pickFleck(r())], -s / 2, -s / 2, s, s);
      }
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    steps = [];
  }

  function bakeStars() {
    sparkle ??= sparkleSprite();
    for (const st of stars) {
      c.globalAlpha = 0.75;
      c.fillStyle = hex;
      c.beginPath();
      c.arc(st.x, st.y, st.s * 0.13, 0, TAU);
      c.fill();
      c.globalAlpha = 1;
      c.drawImage(sparkle, st.x - st.s / 2, st.y - st.s / 2, st.s, st.s);
      dirty = uniteRects(dirty, rectOf(st.x - st.s, st.y - st.s, st.x + st.s, st.y + st.s));
    }
  }

  const take = () => { const out = dirty; dirty = null; return out; };

  return {
    liveOpacity: 1,
    bakes: false,
    begin(pt) {
      startX = pt.x * S; startY = pt.y * S;
      walk.push(startX, startY, pt.p ?? 0.7, step);
    },
    extend(pts) {
      for (const p of pts) walk.push(p.x * S, p.y * S, p.p ?? 0.7, step);
      drawFrame();
      return take();
    },
    finish() {
      walk.settle(step);
      if (walk.travel < 1) {
        steps = [];
        for (let k = 0; k < 3; k++) step(startX, startY, 0, 0.7);
        if (!stars.length) stars.push({ x: startX, y: startY, s: 34 * S / 2 });
      }
      drawFrame();
      bakeStars();
      return take();
    },
    setLate(late) { budget.now = late ? budget.full >> 1 : budget.full; },
    commit(ctx, rect) { if (!o.mirrored) blit(ctx, rect, c.canvas); },
  };
}

// ---- stitch ----

function threadSprites(hex, len, wid) {
  const pad = 2, w = Math.ceil(len + wid + pad * 2), h = Math.ceil(wid + pad * 2);
  const pill = (x, color) => {
    x.strokeStyle = color;
    x.beginPath();
    x.moveTo(pad + wid / 2, h / 2);
    x.lineTo(pad + wid / 2 + len, h / 2);
    x.stroke();
  };
  const c = mk(w, h), x = c.getContext('2d');
  x.lineCap = 'round';
  x.lineWidth = wid;
  pill(x, hex);
  // Twist: a lit edge and a shaded edge, kept inside the pill
  x.globalCompositeOperation = 'source-atop';
  x.fillStyle = 'rgba(255,255,255,.35)';
  x.fillRect(0, 0, w, h * 0.42);
  x.fillStyle = 'rgba(10,16,40,.22)';
  x.fillRect(0, h * 0.62, w, h);
  const s = mk(w, h), sx = s.getContext('2d');
  sx.lineCap = 'round';
  sx.lineWidth = wid;
  pill(sx, NAVY_SHADOW);
  return { thread: c, shadow: s, w, h };
}

function stitchBrush(o) {
  const scale = o.D, S = o.S, c = o.live, len = 8 * S * scale, wid = 2.5 * S * scale, gap = 13 * S * scale, off = 1 * S * scale;
  const hex = o.stitchHex ?? o.swatch.hex ?? '#C99A1E';
  const sp = cached(`stitch|${len}|${hex}`, () => threadSprites(hex, len, wid));
  const walk = new Walker(gap);
  const m = Math.ceil(len) + wid + off + 2;
  let dirty = null, made = 0, startX = 0, startY = 0, r = rng(o.seed);

  const put = (x, y, an) => {
    const tilt = an + (r() - 0.5) * 0.06, cos = Math.cos(tilt), sin = Math.sin(tilt);
    c.setTransform(cos, sin, -sin, cos, x + off, y + off);
    c.drawImage(sp.shadow, -sp.w / 2, -sp.h / 2);
    c.setTransform(cos, sin, -sin, cos, x, y);
    c.drawImage(sp.thread, -sp.w / 2, -sp.h / 2);
    c.setTransform(1, 0, 0, 1, 0, 0);
    dirty = uniteRects(dirty, rectOf(x - m, y - m, x + m, y + m));
    made++;
  };

  const take = () => { const out = dirty; dirty = null; return out; };

  return {
    liveOpacity: 1,
    bakes: false,
    begin(pt) {
      startX = pt.x * S; startY = pt.y * S;
      walk.push(startX, startY, 0.7, put);
    },
    extend(pts) {
      for (const p of pts) walk.push(p.x * S, p.y * S, 0.7, put);
      return take();
    },
    finish() {
      walk.settle(put);
      if (!made) { // a tap sews a little cross, like a button
        put(startX, startY, Math.PI / 4);
        put(startX, startY, -Math.PI / 4);
      }
      return take();
    },
    setLate() {},
    commit(ctx, rect) { if (!o.mirrored) blit(ctx, rect, c.canvas); },
  };
}

// ---- eraser: works directly on paint, the one exception to invariant 4 ----

function eraserBrush(o) {
  const Db = o.D * o.S, S = o.S, c = o.paint;
  let sx = 0, sy = 0, started = false, moved = false, dirty = null;
  const m = Math.ceil(Db / 2) + 2;

  const prepare = () => {
    c.globalCompositeOperation = 'destination-out';
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.lineWidth = Db;
    c.strokeStyle = '#000';
    c.fillStyle = '#000';
  };
  const reset = () => { c.globalCompositeOperation = 'source-over'; };

  const take = () => { const out = dirty; dirty = null; return out; };

  return {
    liveOpacity: 1,
    bakes: false,
    begin(pt) {
      sx = pt.x * S; sy = pt.y * S;
      started = true;
    },
    extend(pts) {
      if (!pts.length) return null;
      prepare();
      c.beginPath();
      c.moveTo(sx, sy);
      let x0 = sx, y0 = sy, x1 = sx, y1 = sy;
      for (const p of pts) {
        // Light smoothing only: a child rubbing out wants the eraser under the finger.
        sx += (p.x * S - sx) * 0.7;
        sy += (p.y * S - sy) * 0.7;
        c.lineTo(sx, sy);
        if (sx < x0) x0 = sx;
        if (sx > x1) x1 = sx;
        if (sy < y0) y0 = sy;
        if (sy > y1) y1 = sy;
      }
      c.stroke();
      reset();
      moved = true;
      dirty = uniteRects(dirty, rectOf(x0 - m, y0 - m, x1 + m, y1 + m));
      return take();
    },
    finish() {
      if (started && !moved) {
        prepare();
        c.beginPath();
        c.arc(sx, sy, Db / 2, 0, TAU);
        c.fill();
        reset();
        dirty = rectOf(sx - m, sy - m, sx + m, sy + m);
      }
      return take();
    },
    setLate() {},
    commit() {},
  };
}

export function makeBrush(kind, opts) {
  const o = { shared: {}, ...opts };
  switch (kind) {
    case 'crayon':
    case 'pencil': return waxBrush(kind, o);
    case 'marker': return markerBrush(o);
    case 'paint': return paintBrush(o);
    case 'fabric': return fabricBrush(o);
    case 'rainbow': return rainbowBrush(o);
    case 'glitter': return glitterBrush(o);
    case 'stitch': return stitchBrush(o);
    case 'eraser': return eraserBrush(o);
    default: throw new Error('unknown brush ' + kind);
  }
}
