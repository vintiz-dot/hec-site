// input-suite.mjs: the gesture machine (5.2), the viewport (5.3, 5.4) and tool routing (5.5), driven by real CDP input.
//   node tools/studio-tests/input-suite.mjs <scratch dir> [--browser=chrome|edge] [--base=http://localhost:5310/clothes-story/] [--only=regex]
//
// input.js, viewport.js, tools.js, targets.js, state, bus and constants are the real modules. Everything they call out to
// (engine, fields, fill, fx, stickers, card, shell, undo, diag, and boot, so nothing else runs) is replaced at the network
// level by a recording stub through the Fetch domain. So this suite does not depend on how far any other owner has got.
//
// Rows of the machine table are scripts: real touch, pen and mouse through the Input domain, with checkpoints in between.
// Events carry an explicit timestamp from a virtual clock, which e.timeStamp reports to the page, so every age threshold is
// tested to within 2ms however busy the machine is. A row with clock:'real' sends no timestamp and really waits, because
// blur, hidden and resize compare against performance.now(). Synthetic PointerEvents cover what CDP cannot make.
import fs from 'node:fs';
import path from 'node:path';
import { launch, pngDiff, readPng, sleep } from './cdp.mjs';

const args = process.argv.slice(2);
const opt = name => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const scratch = args.find(a => !a.startsWith('--'));
if (!scratch) { console.error('usage: node input-suite.mjs <scratch dir> [--browser=chrome|edge] [--only=regex]'); process.exit(2); }
const BASE = opt('base') || 'http://localhost:5310/clothes-story/';
const BROWSER = opt('browser') || 'chrome';
const only = opt('only') ? new RegExp(opt('only'), 'i') : null;
const out = path.join(scratch, 'input-suite-' + BROWSER);

// ---- recording stubs, served in place of the real files ----
const REC = `const r = t => (globalThis.__rec ??= []).push(t); const cfg = () => (globalThis.__cfg ??= {});`;
const STUBS = {
  'boot.js': '',
  'diag.js': `export function log(k, m) { (globalThis.__diag ??= []).push(k + ': ' + m); } export function showPanel() {}`,
  'card.js': `${REC} export function open() {} export function close() {} export function isOpen() { return !!cfg().cardOpen; }`,
  'shell.js': `${REC} export async function showPage(n) { r('showPage(' + n + ')'); } export async function enter() {} export async function exit() {}
    export function abort() {} export function enterBox() {} export function leaveBox() {} export function pushOverlay() { return () => {}; } export function note() {}`,
  'undo.js': `${REC} export async function undo() { r('undo'); } export async function redo() { r('redo'); }
    export function canUndo() { return false; } export function canRedo() { return false; } export function reset() {}`,
  'engine.js': `${REC}
    export function activeSheet() { return cfg().sheet ?? 1; }
    export function beginStroke(pt, o) { r('begin(' + [o.toolId, o.swatchId, o.size, ...(o.eraserOverride ? ['eraser'] : [])].join() + ')'); }
    export function extendStroke() { r('extend'); }
    export function endStroke() { r('endStroke'); }
    export function cancelStroke() { r('cancelStroke'); }
    export function isStroking() { return false; }
    export function paintCanvas() { return null; }`,
  'fields.js': `${REC} export function open(id) { r('open(' + id + ')'); } export function toggleTick(id) { r('tick(' + id + ')'); }`,
  'fill.js': `${REC} export async function pour(sheet, pt, sw, o) { r('pour(' + sw + ',' + (o && o.box || '-') + ')'); return 'ok'; }
    export function finishReveal() {} export function getRegions() { return []; } export function setRegions() {}`,
  'fx.js': `${REC} export function sparkle() { r('sparkle'); } export function ripple() { r('ripple'); } export function mount() {} export function unmount() {} export async function ghostCrayon() {}`,
  'stickers.js': `${REC}
    export function isPlacing() { return !!cfg().placing; }
    export function pointerDown() { r('s.down'); return cfg().stickerHit ?? null; }
    export function pointerMove() { r('s.move'); }
    export function pointerUp(pt, tap) { r('s.up(' + tap + ')'); }
    export function commit() { r('s.commit'); cfg().placing = false; }
    export function cancel() { r('s.cancel'); }
    export function arm() {} export function onSwatchPicked() {}`,
};

async function serveStubs(page) {
  const names = Object.keys(STUBS);
  await page.send('Fetch.enable', { patterns: names.map(n => ({ urlPattern: `*/studio/${n}*` })) });
  page.on('Fetch.requestPaused', ({ requestId, request }) => {
    const name = names.find(n => request.url.includes(`/studio/${n}`));
    page.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }],
      body: Buffer.from(STUBS[name]).toString('base64') }).catch(() => {});
  });
}

// ---- the page side ----
const installHarness = async baseIns => {
  const load = m => import(`/clothes-story/studio/${m}.js?v=1`);
  const [input, viewport, tools, state, constants, bus, targets] = await Promise.all(['input', 'viewport', 'tools', 'state', 'constants', 'bus', 'targets'].map(load));
  const root = document.documentElement;
  root.classList.add('paper');
  const pageEl = document.querySelector('.page'), book = document.querySelector('.book');
  const H = window.H = { input, viewport, tools, state, constants, bus, targets, pageEl, book, rec: [], hover: [], space: [], view: null, views: 0, pts: 0, last: null, tapPt: null, baseIns };
  H.setInsets = ([t, r, b, l]) => { for (const [k, v] of [['t', t], ['r', r], ['b', b], ['l', l]]) root.style.setProperty('--ins-' + k, v + 'px'); };
  H.showSheet = n => { document.querySelectorAll('.sheet').forEach(s => s.classList.toggle('on', Number(s.dataset.sheet) === n)); };
  H.cbs = {
    onInkStart(pt, type, opts) { H.rec.push(`start:${type}${opts?.eraserOverride ? '+eraser' : ''}`); H.last = pt; H.downPt = pt; },
    onInkMove(pts) { H.rec.push('move'); H.pts += pts.length; H.last = pts[pts.length - 1]; H.allPts?.push(...pts); },
    onInkEnd(a) { H.rec.push(a?.lifted ? 'end' : 'end~'); },
    onInkCancel() { H.rec.push('cancel'); },
    onTap(pt) { H.rec.push('tap'); H.tapPt = pt; },
    onHover(cx, cy, type) { H.hover.push([cx, cy, type]); },
    onLeave() { H.hover.push('leave'); },
    onSpace(held, drag) { H.space.push([held, drag]); },
  };
  const squeeze = list => list.filter((t, i, a) => !(t === a[i - 1] && /^(move|extend|sparkle|s\.move)$/.test(t)));
  H.calls = () => squeeze(H.rec).join(' ');
  H.toolCalls = () => squeeze(globalThis.__rec ??= []).join(' ');
  H.snap = () => {
    const k = input.peek();
    return { state: k.state, n: k.pointers.length, ignored: k.pointers.filter(p => p.ignored).length, pair: k.pair ? k.pair.length : 0, panning: k.panning, space: k.spaceHeld,
      refit: k.refitPending, calls: H.calls(), z: viewport.z(), wc: book.style.willChange, penMode: state.get('penMode'), view: H.view, active: k.active !== null };
  };
  H.setHidden = on => {
    if (on) { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); }
    else delete document.visibilityState;
  };
  H.synth = async seq => {
    for (const [type, init, delay] of seq) {
      if (delay) await new Promise(r => setTimeout(r, delay));
      const i = { ...init };
      if (i.pointerId === 'active') i.pointerId = input.peek().active;
      pageEl.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, ...i }));
    }
  };
  H.probe = (x, y) => {
    let p = document.getElementById('h-probe');
    if (!p) { p = document.createElement('div'); p.id = 'h-probe'; }
    p.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:0;height:0`;
    document.querySelector('.sheet.on').append(p);
  };
  H.probeAt = () => { const r = document.getElementById('h-probe').getBoundingClientRect(); return [r.left, r.top]; };
  H.boxCentre = id => { const r = constants.BOXES[id].rect; const c = viewport.toClient(r.x + r.w / 2, r.y + r.h / 2); return [c.x, c.y]; };
  H.targetCentre = id => { const r = targets.get(id).rect; const c = viewport.toClient(r.x + r.w / 2, r.y + r.h / 2); return [c.x, c.y]; };
  // A spot this many screen px off the target's edge in the direction where nothing else competes for the tap.
  H.offTarget = (id, screenPx) => {
    const t = targets.get(id), z = viewport.z(), r = t.rect, d = screenPx / z;
    const near = (24 - 4) / z, far = (24 + 6) / z;
    for (const [px, py, nx, ny] of [[r.x - d, r.y + r.h / 2, -1, 0], [r.x + r.w + d, r.y + r.h / 2, 1, 0], [r.x + r.w / 2, r.y - d, 0, -1], [r.x + r.w / 2, r.y + r.h + d, 0, 1]]) {
      const inHit = targets.hit(t.sheet, { x: px - nx * d + nx * near, y: py - ny * d + ny * near }, 24 / z);
      const outHit = targets.hit(t.sheet, { x: px - nx * d + nx * far, y: py - ny * d + ny * far }, 24 / z);
      if (inHit?.id === id && !outHit) { const c = viewport.toClient(px, py); return [c.x, c.y]; }
    }
    throw new Error('no free side around ' + id);
  };
  H.darkCentre = sheet => { const r = targets.dark(sheet)[0]; const c = viewport.toClient(r.x + r.w / 2, r.y + r.h / 2); return [c.x, c.y]; };
  H.fresh = ({ routing = 'stub', ins = H.baseIns, sheet = 3, tool = 'crayon', swatch = 'red', size = 'M', box = null, readOnly = false, cfg = {} } = {}) => {
    input.detach();
    viewport.destroy();
    H.setHidden(false);
    H.rec.length = 0; H.hover.length = 0; H.space.length = 0; H.pts = 0; H.last = null; H.tapPt = null; H.downPt = null; H.allPts = null; H.views = 0;
    (globalThis.__rec ??= []).length = 0;
    globalThis.__cfg = { sheet, ...cfg };
    H.setInsets(ins);
    H.showSheet(sheet);
    for (const [k, v] of Object.entries({ tool, swatch, size, box, readOnly, usage: {}, lastDraw: 'crayon' })) state.set(k, v);
    constants.LIMITS.penModeMs = 30000;
    viewport.init(pageEl, book);
    input.attach(pageEl, routing === 'tools' ? tools.handlers() : H.cbs);
    return true;
  };
  bus.on('view:change', v => { H.view = v; H.views++; });
  bus.on('tool:wiggle', ({ tool }) => globalThis.__rec.push(`wiggle(${tool})`));
  H.setInsets(baseIns);
  targets.build();
  H.fresh();
  return true;
};

// ---- the node side: what a row can do ----
const down = (id, x, y) => ['td', id, x, y];
const downAt = (id, expr) => ['tdAt', id, expr];
const to = (id, x, y) => ['tm', [[id, x, y]]];
const both = (...f) => ['tm', f];
const up = id => ['tu', id];
const tcancel = () => ['tc'];
const pd = (x, y, force = .5) => ['pd', x, y, force];
const pm = (x, y, force = .5) => ['pm', x, y, force];
const pu = (x, y) => ['pu', x, y];
const hover = (x, y) => ['ph', x, y];
const md = (x, y, button = 'left') => ['md', x, y, button];
const mm = (x, y) => ['mm', x, y];
const mu = (x, y, button = 'left') => ['mu', x, y, button];
const wheel = (x, y, dx, dy, o = {}) => ['wheel', x, y, dx, dy, o];
const kd = (k, o = {}) => ['kd', k, o];
const ku = (k, o = {}) => ['ku', k, o];
const key = (k, o = {}) => ['key', k, o];
const wait = ms => ['wait', ms];       // the virtual clock moves on, no real waiting
const pause = ms => ['pause', ms];     // really waits
const run = expr => ['run', expr];
const synth = seq => ['synth', seq];
const vp = (w, h) => ['vp', w, h];
const see = (state, calls, more = {}) => ['see', { state, calls, ...more }];
const rec = calls => ['rec', calls];
const mark = () => ['mark'];
const moved = (dx, dy) => ['moved', dx, dy];
const truth = (expr, note) => ['truth', expr, note];

class Driver {
  fingers = new Map(); pen = 0; mouse = 0; base = null; vt = 0; last = 0; mk = null; sized = false;
  constructor(page, view) { this.page = page; this.view = view; }

  async begin(clock) {
    this.vt = 0;
    if (clock === 'real') { this.base = null; return; }
    const now = await this.page.eval('performance.timeOrigin + performance.now()');
    this.base = Math.max(now - 3000, this.last + 5);
  }
  stamp() {
    if (this.base === null) return {};
    this.last = this.base + this.vt;
    return { timestamp: this.last / 1000 };
  }
  list() { return [...this.fingers].map(([id, p]) => ({ id, ...p })); }
  touch(type, touchPoints) { return this.page.send('Input.dispatchTouchEvent', { type, touchPoints, ...this.stamp() }); }
  penEvent(type, x, y, force, button, buttons) {
    return this.page.send('Input.dispatchMouseEvent', { type, x, y, pointerType: 'pen', force, button, buttons, clickCount: type === 'mouseMoved' ? 0 : 1, ...this.stamp() });
  }
  mouseEvent(type, x, y, button, buttons) {
    return this.page.send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: type === 'mouseMoved' ? 0 : 1, ...this.stamp() });
  }

  async td(id, x, y) { this.fingers.set(id, { x, y }); await this.touch('touchStart', this.list()); }
  async tdAt(id, expr) { const [x, y] = await this.page.eval(expr); return this.td(id, x, y); }
  async tm(list) {
    for (const [id, x, y] of list) {
      if (!this.fingers.has(id)) throw new Error(`finger ${id} is not down`);
      this.fingers.set(id, { x, y });
    }
    await this.touch('touchMove', this.list());
  }
  async tu(id) { const p = this.fingers.get(id); this.fingers.delete(id); await this.touch('touchEnd', this.fingers.size ? [{ id, ...p }] : []); }
  async tc() { this.fingers.clear(); await this.touch('touchCancel', []); }
  async pd(x, y, force) { this.pen = 1; await this.penEvent('mousePressed', x, y, force, 'left', 1); }
  async pm(x, y, force) { await this.penEvent('mouseMoved', x, y, force, 'left', 1); }
  async pu(x, y) { this.pen = 0; await this.penEvent('mouseReleased', x, y, 0, 'left', 0); }
  async ph(x, y) { await this.penEvent('mouseMoved', x, y, 0, 'none', 0); }
  async md(x, y, button) { this.mouse |= { left: 1, right: 2, middle: 4 }[button]; await this.mouseEvent('mousePressed', x, y, button, this.mouse); }
  async mm(x, y) { await this.mouseEvent('mouseMoved', x, y, { 1: 'left', 2: 'right', 4: 'middle' }[this.mouse] ?? 'none', this.mouse); }
  async mu(x, y, button) { this.mouse &= ~{ left: 1, right: 2, middle: 4 }[button]; await this.mouseEvent('mouseReleased', x, y, button, this.mouse); }
  wheel(x, y, dx, dy, o) { return this.page.wheel(x, y, dx, dy, o); }
  kd(k, o) { return this.page.keyDown(k, o); }
  ku(k, o) { return this.page.keyUp(k, o); }
  key(k, o) { return this.page.key(k, o); }
  wait(ms) { this.vt += ms; }
  async pause(ms) { await sleep(ms); this.vt += ms; }
  run(expr) { return this.page.eval(expr); }
  synth(seq) { return this.page.eval(s => H.synth(s), seq); }
  async vp(w, h) {
    this.sized = true;
    await this.page.eval(`window.__rz = new Promise(r => { addEventListener('resize', r, { once: true }); setTimeout(r, 1000); })`);
    await this.page.setViewport({ width: w, height: h });
    await this.page.eval('window.__rz');
    await this.page.frames(2);
  }
  async see(want) {
    await this.page.frames(2);
    const s = await this.page.eval('H.snap()');
    const bad = [];
    for (const [k, v] of Object.entries(want)) {
      if (k === 'zNear') { if (Math.abs(s.z - v) > .002) bad.push(`z ${s.z} want ${v}`); continue; }
      if (s[k] !== v) bad.push(`${k} is ${JSON.stringify(s[k])}, want ${JSON.stringify(v)}`);
    }
    if (bad.length) throw new Error(bad.join('; '));
  }
  async rec(want) {
    await this.page.frames(2);
    const got = await this.page.eval('H.toolCalls()');
    if (got !== want) throw new Error(`tools called "${got}", want "${want}"`);
  }
  async mark() { await this.page.frames(2); this.mk = await this.page.eval('H.view'); }
  async moved(dx, dy) {
    await this.page.frames(2);
    const v = await this.page.eval('H.view');
    const gx = v.tx - this.mk.tx, gy = v.ty - this.mk.ty;
    if (Math.abs(gx - dx) > .01 || Math.abs(gy - dy) > .01) throw new Error(`view moved by ${gx},${gy}, want ${dx},${dy}`);
  }
  async truth(expr, note) {
    await this.page.frames(2);
    const v = await this.page.eval(expr);
    if (!v) throw new Error(`${note || 'not true'}: ${expr}`);
  }

  async cleanup() {
    this.base = null;
    if (this.fingers.size) { this.fingers.clear(); await this.touch('touchEnd', []); }
    if (this.pen) { this.pen = 0; await this.penEvent('mouseReleased', 1, 1, 0, 'left', 0); }
    if (this.mouse) { for (const b of ['left', 'right', 'middle']) await this.mouseEvent('mouseReleased', 1, 1, b, 0); this.mouse = 0; }
    if (this.sized) { this.sized = false; await this.vp(this.view.width, this.view.height); this.sized = false; }
  }

  async exec([op, ...a]) { await this[op](...a); }
}

// ---- results ----
let passed = 0;
const failures = [];
const pass = () => { passed++; };
const fail = (name, why) => { failures.push(name); console.log(`  FAIL ${name}\n       ${String(why).split('\n')[0]}`); };
const check = (name, ok, why = '') => { if (only && !only.test(name)) return; if (ok) pass(); else fail(name, why || 'false'); };

async function runRows(page, d, rows) {
  for (const row of rows) {
    if (only && !only.test(row.name)) continue;
    let err = null;
    for (let attempt = 1; attempt <= 3; attempt++) { // a real-clock row can lose a race on a machine under load; a bug fails all three
      err = null;
      try {
        await page.eval(s => H.fresh(s), row.setup);
        await d.begin(row.clock);
        for (const op of row.ops) await d.exec(op);
      } catch (e) { err = e; }
      await d.cleanup().catch(() => {});
      if (!err) break;
    }
    if (err) fail(row.name, err.message); else pass();
  }
}

const R = (name, ...rest) => {
  const setup = rest[0] && !Array.isArray(rest[0]) ? rest.shift() : {};
  const { clock, ...s } = setup;
  return { name, clock, setup: s, ops: rest };
};

// ---- machine table: real fingers, pen and mouse against recording callbacks ----
function machineRows() {
  const rows = [];
  const add = (...a) => rows.push(R(...a));
  const FULL = { ins: [0, 0, 0, 0] };

  // IDLE
  add('IDLE touch down -> INK(touch)', down(0, 300, 400), see('INK(touch)', 'start:touch', { n: 1, active: true, wc: '' }));
  for (const [side, x, y] of [['left', 15, 400], ['right', 585, 400], ['top', 300, 15], ['bottom', 300, 885]]) {
    add(`IDLE touch in ${side} edge band -> ignored, stays IDLE`, FULL, down(0, x, y), see('IDLE', '', { n: 1, ignored: 1 }),
      to(0, 300, 420), see('IDLE', '', { n: 1 }), up(0), see('IDLE', '', { n: 0 }));
  }
  for (const [side, x, y] of [['left', 17, 400], ['right', 583, 400], ['top', 300, 17], ['bottom', 300, 883]]) {
    add(`IDLE touch just inside ${side} edge band -> inks`, FULL, down(0, x, y), see('INK(touch)', 'start:touch', { ignored: 0 }));
  }
  add('IDLE an ignored band finger does not stop the next finger inking', FULL, down(0, 8, 400), down(1, 300, 400), see('INK(touch)', 'start:touch', { n: 2, ignored: 1 }),
    wait(300), up(1), see('IDLE', 'start:touch end', { n: 1 }), up(0), see('IDLE', 'start:touch end', { n: 0 }));
  add('IDLE pen down -> INK(pen), penMode on', pd(300, 400), see('INK(pen)', 'start:pen', { n: 1, penMode: true }));
  const penSynth = (extra, id = 91) => synth([['pointerdown', { pointerId: id, pointerType: 'pen', isPrimary: true, clientX: 300, clientY: 400, ...extra }], ['pointerup', { pointerId: id, pointerType: 'pen', clientX: 300, clientY: 400, buttons: 0 }]]);
  add('IDLE pen buttons&32 -> eraser for that stroke only', penSynth({ buttons: 32, button: 0 }), see('IDLE', 'start:pen+eraser tap', { n: 0 }), pd(300, 400), see('INK(pen)', 'start:pen+eraser tap start:pen'));
  add('IDLE pen button==5 -> eraser for that stroke only', penSynth({ buttons: 1, button: 5 }), see('IDLE', 'start:pen+eraser tap', { n: 0 }), pd(300, 400), see('INK(pen)', 'start:pen+eraser tap start:pen'));
  add('IDLE mouse left -> INK(mouse)', md(300, 400), see('INK(mouse)', 'start:mouse', { n: 1 }));
  for (const b of ['right', 'middle']) add(`IDLE mouse ${b} button -> ignored`, md(300, 400, b), see('IDLE', '', { n: 0 }), mm(330, 430), see('IDLE', ''), mu(330, 430, b), see('IDLE', '', { n: 0 }));
  add('IDLE touch while penMode -> NAV1, no ink', pd(100, 200), pu(100, 200), see('IDLE', 'start:pen tap', { penMode: true }), down(0, 300, 400), see('NAV1', 'start:pen tap', { n: 1 }));

  // INK(touch), second touch
  for (const [age, travel, st, calls] of [
    [0, 0, 'NAV', 'start:touch cancel'], [198, 0, 'NAV', 'start:touch cancel'], [198, 30, 'NAV', 'start:touch move cancel'],
    [202, 0, 'GUARD', 'start:touch'], [298, 0, 'GUARD', 'start:touch'], [202, 30, 'GUARD', 'start:touch move'],
    [302, 0, 'INK(touch)', 'start:touch cancel start:touch'], [302, 7, 'INK(touch)', 'start:touch move cancel start:touch'],
    [302, 8, 'GUARD', 'start:touch move'], [1000, 40, 'GUARD', 'start:touch move'],
  ]) {
    add(`INK(touch) second touch at age ${age}, first moved ${travel} -> ${st}`, down(0, 300, 400), ...(travel ? [wait(1), to(0, 300 + travel, 400)] : []), wait(age - (travel ? 1 : 0)),
      down(1, 450, 550), see(st, calls, { n: 2, wc: st === 'NAV' ? 'transform' : '', pair: st === 'NAV' ? 2 : 0, ignored: st === 'INK(touch)' ? 1 : 0 }));
  }
  add('INK(touch) resting thumb: thumb is dead, second finger draws from its own point', down(0, 300, 400), wait(400), down(1, 450, 550), see('INK(touch)', 'start:touch cancel start:touch', { ignored: 1 }),
    truth('Math.abs(H.downPt.x - H.viewport.toSheet(450, 550).x) < .01', 'second finger starts where it landed'),
    to(0, 200, 300), see('INK(touch)', 'start:touch cancel start:touch'), to(1, 470, 560), see('INK(touch)', 'start:touch cancel start:touch move'),
    up(0), see('INK(touch)', 'start:touch cancel start:touch move', { n: 1 }), wait(300), up(1), see('IDLE', 'start:touch cancel start:touch move end', { n: 0 }));
  add('INK(touch) third finger after a resting thumb is a second touch of the new stroke', down(0, 300, 400), wait(400), down(1, 450, 550), wait(50), down(2, 200, 600),
    see('NAV', 'start:touch cancel start:touch cancel', { n: 3, ignored: 1 }));

  // GUARD
  const guard = [down(0, 200, 300), wait(1), to(0, 230, 300), wait(300), down(1, 420, 500)];
  const G = 'start:touch move';
  add('GUARD first finger keeps inking', ...guard, to(0, 260, 300), see('GUARD', G), truth('Math.abs(H.last.x - H.viewport.toSheet(260, 300).x) < .01', 'stroke follows the first finger'));
  add('GUARD stray moved 24 -> stays', ...guard, to(1, 444, 500), see('GUARD', G));
  add('GUARD stray moved 25 -> commit first, NAV', ...guard, to(1, 445, 500), see('NAV', G + ' end~', { wc: 'transform', pair: 2 }));
  add('GUARD stray lifts -> INK(touch)', ...guard, up(1), see('INK(touch)', G, { n: 1 }), to(0, 270, 300), see('INK(touch)', G), up(0), see('IDLE', G + ' end', { n: 0 }));
  add('GUARD third touch -> commit first, NAV', ...guard, down(2, 100, 600), see('NAV', G + ' end~', { n: 3, pair: 2, wc: 'transform' }));
  add('GUARD pen down -> discard, INK(pen)', ...guard, pd(300, 400), see('INK(pen)', G + ' cancel start:pen', { n: 3, ignored: 2 }), to(0, 100, 200), to(1, 500, 650),
    see('INK(pen)', G + ' cancel start:pen'), up(0), up(1), see('INK(pen)', G + ' cancel start:pen', { n: 1 }), wait(300), pu(300, 400), see('IDLE', G + ' cancel start:pen end', { n: 0 }));
  add('GUARD first lifts -> commit; stray dead until it lifts', ...guard, up(0), see('IDLE', G + ' end', { n: 1, ignored: 1 }), to(1, 500, 600), see('IDLE', G + ' end', { n: 1 }), up(1), see('IDLE', G + ' end', { n: 0 }));
  add('GUARD pointercancel of all -> commit by rule', ...guard, tcancel(), see('IDLE', G + ' end~', { n: 0 }));

  // INK(any): up
  const inks = {
    touch: { dn: down(0, 300, 400), mv: x => to(0, x, 400), up: x => up(0) },
    pen: { dn: pd(300, 400), mv: x => pm(x, 400), up: x => pu(x, 400) },
    mouse: { dn: md(300, 400), mv: x => mm(x, 400), up: x => mu(x, 400) },
  };
  for (const [kind, k] of Object.entries(inks)) {
    for (const [travel, age, out] of [[0, 0, 'tap'], [7, 248, 'tap'], [8, 100, 'end'], [0, 252, 'end'], [40, 100, 'end']]) {
      add(`INK(${kind}) up, travel ${travel}, age ${age} -> ${out}`, k.dn, ...(travel ? [wait(1), k.mv(300 + travel)] : []), wait(age - (travel ? 1 : 0)), k.up(300 + travel),
        see('IDLE', `start:${kind}${travel ? ' move' : ''} ${out}`, { n: 0, wc: '' }));
    }
  }

  // INK(any): lost pointers
  add('INK(touch) real pointercancel, age 100 -> discard', down(0, 300, 400), wait(100), tcancel(), see('IDLE', 'start:touch cancel', { n: 0 }));
  add('INK(touch) real pointercancel, age 300 -> commit', down(0, 300, 400), wait(300), tcancel(), see('IDLE', 'start:touch end~', { n: 0 }));
  add('INK(touch) real capture release (after the first move: Chrome sends no lostpointercapture for a capture never delivered), age 300 -> commit', down(0, 300, 400), to(0, 301, 400), wait(300), run('H.pageEl.releasePointerCapture(H.input.peek().active)'), wait(1), to(0, 320, 400),
    see('IDLE', 'start:touch move end~', { n: 0 }), up(0), see('IDLE', 'start:touch move end~', { n: 0 }));
  for (const type of ['touch', 'pen', 'mouse']) {
    for (const ev of ['pointercancel', 'lostpointercapture']) {
      for (const [delay, tok] of [[0, 'cancel'], [230, 'end~']]) {
        add(`INK(${type}) synthetic ${ev}, ${delay ? 'old' : 'young'} -> ${tok}`, { clock: 'real' },
          synth([['pointerdown', { pointerId: 800, pointerType: type, isPrimary: true, clientX: 300, clientY: 400, buttons: 1, button: 0 }], [ev, { pointerId: 800, pointerType: type, clientX: 300, clientY: 400 }, delay]]),
          see('IDLE', `start:${type} ${tok}`, { n: 0 }));
      }
    }
  }
  const triggers = [['window blur', 'window.dispatchEvent(new Event("blur"))'], ['visibility hidden', 'H.setHidden(true)'], ['orientationchange', 'window.dispatchEvent(new Event("orientationchange"))']];
  for (const [label, trigger] of triggers) {
    for (const [kind, k] of Object.entries(inks)) {
      for (const [delay, tok] of [[0, 'cancel'], [260, 'end~']]) {
        add(`INK(${kind}) ${label}, ${delay ? 'old' : 'young'} -> ${tok}, map cleared`, { clock: 'real' }, k.dn, pause(delay), run(trigger), see('IDLE', `start:${kind} ${tok}`, { n: 0 }),
          k.mv(340), k.up(340), see('IDLE', `start:${kind} ${tok}`, { n: 0 }));
      }
    }
  }
  add('INK visibility event while visible changes nothing', down(0, 300, 400), run('document.dispatchEvent(new Event("visibilitychange"))'), see('INK(touch)', 'start:touch', { n: 1 }));
  add('NAV blur -> IDLE, gesture ended, map cleared', down(0, 250, 410), down(1, 350, 410), run('window.dispatchEvent(new Event("blur"))'), see('IDLE', 'start:touch cancel', { n: 0, wc: '' }));
  add('LOCKOUT hidden -> IDLE, map cleared', down(0, 250, 410), down(1, 350, 410), up(0), see('LOCKOUT', 'start:touch cancel'), run('H.setHidden(true)'), see('IDLE', 'start:touch cancel', { n: 0 }));
  add('reset() -> same rule, IDLE', { clock: 'real' }, down(0, 300, 400), run('H.input.reset()'), see('IDLE', 'start:touch cancel', { n: 0 }));
  add('detach() ends the stroke by rule and listens to nothing more', { clock: 'real' }, down(0, 300, 400), pause(260), run('H.input.detach()'), truth('H.calls() === "start:touch end~"'), to(0, 350, 400), wait(300), up(0), truth('H.calls() === "start:touch end~"'));

  // Resizes: a real change of the viewport mid-stroke
  add('INK resize dW 60 -> commit, map cleared, refit', { clock: 'real' }, down(0, 300, 400), pause(260), vp(660, 900), see('IDLE', 'start:touch end~', { n: 0, zNear: Math.min(660 / 794, 716 / 1122), refit: false }), up(0));
  add('INK resize dH 130 -> commit, map cleared, refit', { clock: 'real' }, down(0, 300, 400), pause(260), vp(600, 1030), see('IDLE', 'start:touch end~', { n: 0, zNear: Math.min(600 / 794, 846 / 1122), refit: false }), up(0));
  add('INK resize dH 40 (URL bar) -> stroke goes on, refit waits for the up', down(0, 300, 400), wait(1), to(0, 330, 400), vp(600, 940), see('INK(touch)', 'start:touch move', { n: 1, refit: true, zNear: 716 / 1122 }),
    wait(300), to(0, 350, 400), see('INK(touch)', 'start:touch move'), up(0), see('IDLE', 'start:touch move end', { refit: false, zNear: 756 / 1122 }));
  add('INK resize dW 40 -> stroke goes on, refit waits for the up', down(0, 300, 400), vp(640, 900), see('INK(touch)', 'start:touch', { refit: true }), wait(300), up(0), see('IDLE', 'start:touch end', { refit: false, zNear: Math.min(640 / 794, 716 / 1122) }));
  add('NAV1 resize dH 40 waits too', pd(100, 200), pu(100, 200), down(0, 300, 400), vp(600, 940), see('NAV1', 'start:pen tap', { refit: true }), up(0), see('IDLE', 'start:pen tap tap', { refit: false }));

  // INK(pen), INK(mouse): touches are ignored
  add('INK(pen) any touch -> ignored', pd(300, 400), down(0, 200, 300), see('INK(pen)', 'start:pen', { n: 2, ignored: 1 }), to(0, 260, 360), down(1, 100, 500), to(1, 150, 520),
    see('INK(pen)', 'start:pen', { n: 3, ignored: 2, wc: '' }), up(0), up(1), see('INK(pen)', 'start:pen', { n: 1 }), wait(1), pm(340, 420), see('INK(pen)', 'start:pen move'), wait(300), pu(340, 420), see('IDLE', 'start:pen move end', { n: 0 }));
  add('INK(pen) a palm still down after the pen lifts stays dead', pd(300, 400), down(0, 200, 300), wait(300), pu(300, 400), see('IDLE', 'start:pen end', { n: 1, ignored: 1 }), to(0, 260, 360), see('IDLE', 'start:pen end'), up(0), see('IDLE', 'start:pen end', { n: 0 }));
  add('INK(mouse) any touch -> ignored', md(300, 400), down(0, 200, 300), see('INK(mouse)', 'start:mouse', { n: 2, ignored: 1 }), to(0, 260, 360), up(0), see('INK(mouse)', 'start:mouse', { n: 1 }));
  add('INK(touch) mouse down -> ignored', down(0, 300, 400), md(100, 200), see('INK(touch)', 'start:touch', { n: 2, ignored: 1 }), mm(150, 240), mu(150, 240), see('INK(touch)', 'start:touch', { n: 1 }));

  // NAV1
  const seen = [pd(100, 200), pu(100, 200)], S = 'start:pen tap';
  const zoomed = run('H.viewport.zoomAt(300, 410, 3.2); H.viewport.endGesture(); true');
  add('NAV1 at fit nothing moves', ...seen, down(0, 300, 400), mark(), to(0, 360, 470), see('NAV1', S, { panning: true, wc: 'transform' }), moved(0, 0), wait(300), up(0), see('IDLE', S, { n: 0, panning: false, wc: '' }));
  add('NAV1 zoomed: move over 12 pans, without a jump', ...seen, zoomed, down(0, 300, 400), mark(), to(0, 312, 400), see('NAV1', S, { panning: false }), moved(0, 0), to(0, 320, 400), see('NAV1', S, { panning: true, wc: 'transform' }), moved(0, 0),
    to(0, 350, 420), moved(30, 20), wait(50), up(0), see('IDLE', S, { n: 0, wc: '' }), moved(30, 20));
  add('NAV1 up, travel 0, age 0 -> tap', ...seen, down(0, 300, 400), up(0), see('IDLE', S + ' tap', { n: 0 }));
  add('NAV1 up, travel 7, age 248 -> tap', ...seen, down(0, 300, 400), wait(1), to(0, 307, 400), wait(247), up(0), see('IDLE', S + ' tap'));
  add('NAV1 up, travel 8 -> neither pan nor tap', ...seen, down(0, 300, 400), wait(1), to(0, 308, 400), wait(50), up(0), see('IDLE', S));
  add('NAV1 up, age 252 -> no tap', ...seen, down(0, 300, 400), wait(252), up(0), see('IDLE', S));
  add('NAV1 up after a pan -> no tap', ...seen, zoomed, down(0, 300, 400), wait(1), to(0, 340, 400), wait(50), up(0), see('IDLE', S));
  add('NAV1 second touch -> NAV', ...seen, down(0, 300, 400), wait(100), down(1, 420, 500), see('NAV', S, { n: 2, pair: 2, wc: 'transform' }));
  add('NAV1 panning, second touch -> NAV keeps will-change', ...seen, zoomed, down(0, 300, 400), wait(1), to(0, 340, 400), down(1, 420, 500), see('NAV', S, { wc: 'transform', panning: false }), up(1), see('LOCKOUT', S, { wc: '' }));
  add('NAV1 pen down -> cancel, INK(pen); the finger stays dead', ...seen, down(0, 300, 400), pd(200, 300), see('INK(pen)', S + ' start:pen', { n: 2, ignored: 1 }), to(0, 340, 440), see('INK(pen)', S + ' start:pen'), wait(300), pu(200, 300), see('IDLE', S + ' start:pen end', { n: 1, ignored: 1 }));
  add('NAV1 panning, pen down -> gesture ends, INK(pen)', ...seen, zoomed, down(0, 300, 400), wait(1), to(0, 340, 400), see('NAV1', S, { wc: 'transform' }), pd(200, 300), see('INK(pen)', S + ' start:pen', { wc: '' }));
  add('NAV1 real pointercancel -> IDLE', ...seen, zoomed, down(0, 300, 400), wait(1), to(0, 340, 400), tcancel(), see('IDLE', S, { n: 0, wc: '' }));

  // NAV
  const pinch = [down(0, 250, 410), down(1, 350, 410)], P = 'start:touch cancel';
  add('NAV starts with will-change, pinch zooms, map tracks both', ...pinch, see('NAV', P, { wc: 'transform', pair: 2, n: 2 }), both([0, 200, 410], [1, 400, 410]), truth('H.viewport.z() > 1.2', 'z grew'), see('NAV', P, { wc: 'transform' }));
  add('NAV any finger lifts -> LOCKOUT, will-change off', ...pinch, both([0, 200, 410], [1, 400, 410]), up(0), see('LOCKOUT', P, { wc: '', n: 1, pair: 0 }));
  add('NAV third finger takes no part; its lift -> LOCKOUT', ...pinch, both([0, 200, 410], [1, 400, 410]), down(2, 100, 600), see('NAV', P, { n: 3, pair: 2 }), mark(), to(2, 160, 660), moved(0, 0), up(2), see('LOCKOUT', P, { n: 2, wc: '' }));
  add('NAV pen down -> gesture ends, INK(pen), fingers dead', ...pinch, both([0, 200, 410], [1, 400, 410]), pd(300, 300), see('INK(pen)', P + ' start:pen', { n: 3, ignored: 2, wc: '' }), mark(), to(0, 100, 410), moved(0, 0));
  add('NAV real pointercancel -> IDLE through LOCKOUT', ...pinch, both([0, 200, 410], [1, 400, 410]), tcancel(), see('IDLE', P, { n: 0, wc: '' }));

  // LOCKOUT
  add('LOCKOUT remaining finger moving draws nothing and moves nothing, then IDLE, then inks', ...pinch, both([0, 200, 410], [1, 400, 410]), up(0), see('LOCKOUT', P), mark(), to(1, 200, 600), moved(0, 0), see('LOCKOUT', P, { wc: '' }),
    up(1), see('IDLE', P, { n: 0 }), down(2, 300, 400), see('INK(touch)', P + ' start:touch'));
  add('LOCKOUT new touch, pen and mouse -> all ignored until the map empties', ...pinch, up(0), see('LOCKOUT', P, { n: 1, ignored: 0 }), down(2, 100, 600), see('LOCKOUT', P, { n: 2, ignored: 1 }),
    pd(200, 300), see('LOCKOUT', P, { n: 3, ignored: 2, penMode: true }), pm(240, 340), pu(240, 340), see('LOCKOUT', P, { n: 2 }), md(400, 300), see('LOCKOUT', P, { n: 3, ignored: 2 }), mm(420, 320), mu(420, 320), see('LOCKOUT', P, { n: 2 }),
    up(2), see('LOCKOUT', P, { n: 1 }), up(1), see('IDLE', P, { n: 0 }));
  add('LOCKOUT a finger lifted and put back stays locked while the other is down', ...pinch, up(0), see('LOCKOUT', P), down(0, 250, 410), see('LOCKOUT', P, { n: 2, ignored: 1 }), to(0, 300, 500), see('LOCKOUT', P), up(0), up(1), see('IDLE', P, { n: 0 }));

  // penMode
  add('penMode: fingers ink again after LIMITS.penModeMs, and state.penMode says so', { clock: 'real' }, run('H.constants.LIMITS.penModeMs = 150'), pd(100, 200), pu(100, 200), see('IDLE', S, { penMode: true }), pause(220), see('IDLE', S, { penMode: false }), down(0, 300, 400), see('INK(touch)', S + ' start:touch'));
  add('penMode: state falls even if nothing touches', { clock: 'real' }, run('H.constants.LIMITS.penModeMs = 100'), pd(100, 200), pu(100, 200), pause(200), see('IDLE', S, { penMode: false }));
  add('penMode: a new pen stroke extends it', { clock: 'real' }, run('H.constants.LIMITS.penModeMs = 400'), pd(100, 200), pu(100, 200), pause(250), pd(100, 200), pu(100, 200), pause(250), down(0, 300, 400), see('NAV1', S + ' start:pen tap', { penMode: true }));

  // Stuck pointers
  const sd = (id, primary, delay = 0, type = 'touch') => ['pointerdown', { pointerId: id, pointerType: type, isPrimary: primary, clientX: 300, clientY: 400, buttons: 1, button: 0 }, delay];
  const su = (id, type = 'touch') => ['pointerup', { pointerId: id, pointerType: type, clientX: 300, clientY: 400, buttons: 0, button: 0 }];
  add('stuck: primary touch purges a stale young stroke', { clock: 'real' }, synth([sd(900, true), sd(901, true)]), see('INK(touch)', 'start:touch cancel start:touch', { n: 1, ignored: 0 }), synth([su(901)]));
  add('stuck: primary touch commits a stale old stroke', { clock: 'real' }, synth([sd(900, true), sd(901, true, 230)]), see('INK(touch)', 'start:touch end~ start:touch', { n: 1 }), synth([su(901)]));
  add('stuck: primary touch ends a LOCKOUT with a stale finger', { clock: 'real' }, synth([sd(900, true), sd(901, false), su(901)]), see('LOCKOUT', P, { n: 1 }), synth([sd(902, true)]), see('INK(touch)', P + ' start:touch', { n: 1 }), synth([su(902)]));
  add('stuck: primary touch ends a NAV with two stale fingers', { clock: 'real' }, synth([sd(900, true), sd(901, false)]), see('NAV', P, { n: 2, wc: 'transform' }), synth([sd(902, true)]), see('INK(touch)', P + ' start:touch', { n: 1, wc: '' }), synth([su(902)]));
  add('stuck: primary touch clears an ignored band finger', { clock: 'real', ...FULL }, synth([['pointerdown', { pointerId: 900, pointerType: 'touch', isPrimary: true, clientX: 5, clientY: 400, buttons: 1 }]]), see('IDLE', '', { n: 1, ignored: 1 }), synth([sd(901, true)]), see('INK(touch)', 'start:touch', { n: 1, ignored: 0 }), synth([su(901)]));
  add('stuck: a non-primary touch purges nothing', { clock: 'real' }, synth([sd(900, true), sd(901, false)]), see('NAV', P, { n: 2 }), synth([su(900), su(901)]), see('IDLE', P, { n: 0 }));
  add('stuck: same pointer id down again replaces the old entry', { clock: 'real' }, synth([sd(900, true), sd(900, false)]), see('INK(touch)', 'start:touch cancel start:touch', { n: 1 }), synth([su(900)]));
  add('stuck: primary pen purges a stale pen', { clock: 'real' }, synth([sd(910, true, 0, 'pen'), sd(911, true, 230, 'pen')]), see('INK(pen)', 'start:pen end~ start:pen', { n: 1 }), synth([su(911, 'pen')]));
  add('a primary mouse or pen does not purge a real resting touch', pd(100, 200), down(0, 300, 400), see('INK(pen)', 'start:pen', { n: 2, ignored: 1 }), wait(300), pu(100, 200), see('IDLE', 'start:pen end', { n: 1 }), md(200, 300), see('INK(mouse)', 'start:pen end start:mouse', { n: 2, ignored: 1 }));

  // Hover and missed ups
  add('hover: pen and mouse report position, never ink', hover(300, 400), mm(310, 410), truth('H.hover.length === 2 && H.hover[0][2] === "pen" && H.hover[1][2] === "mouse"'), see('IDLE', '', { n: 0 }));
  add('hover: a touch never reports hover', down(0, 300, 400), to(0, 320, 410), truth('H.hover.length === 0'));
  add('mouse: a move with no button is the up we missed', md(300, 400), wait(1), mm(340, 400), synth([['pointermove', { pointerId: 'active', pointerType: 'mouse', clientX: 360, clientY: 400, buttons: 0 }]]), see('IDLE', 'start:mouse move end', { n: 0 }));
  add('pen: a move with no button is the up we missed', pd(300, 400), wait(1), pm(340, 400), synth([['pointermove', { pointerId: 'active', pointerType: 'pen', clientX: 360, clientY: 400, buttons: 0 }]]), see('IDLE', 'start:pen move end', { n: 0 }));
  add('a throwing callback cannot leave the machine stuck', run('H.cbs.onInkStart = () => { throw new Error("boom") }; true'), down(0, 300, 400), see('INK(touch)', ''), wait(300), up(0), see('IDLE', 'end', { n: 0 }), truth('globalThis.__diag.some(m => /boom/.test(m))'),
    run('location.hash = ""; delete H.cbs.onInkStart; H.cbs.onInkStart = (pt, type, opts) => { H.rec.push(`start:${type}${opts?.eraserOverride ? "+eraser" : ""}`); H.last = pt; H.downPt = pt; }; true'));
  return rows;
}

// ---- mouse and keyboard, on a page with a fine pointer ----
function mouseRows() {
  const rows = [];
  const add = (...a) => rows.push(R(...a));
  add('mouse: draws, and the up commits', md(500, 300), wait(1), mm(540, 330), see('INK(mouse)', 'start:mouse move'), wait(100), mu(540, 330), see('IDLE', 'start:mouse move end', { n: 0 }));
  add('wheel: pans down, stops at the bottom, up stops at the top', mark(), wheel(500, 400, 0, 120), moved(0, -120), wheel(500, 400, 0, 5000), moved(0, -382), wheel(500, 400, 0, -9000), moved(0, 0));
  add('wheel: at fit width sideways stays centred', mark(), wheel(500, 400, 300, 0), moved(0, 0));
  add('wheel: will-change only while wheeling', wheel(500, 400, 0, 40), see('IDLE', '', { wc: 'transform' }), pause(260), see('IDLE', '', { wc: '' }));
  add('wheel: line and page units', mark(), run('H.pageEl.dispatchEvent(new WheelEvent("wheel", { deltaY: 3, deltaMode: 1, bubbles: true, cancelable: true }))'), moved(0, -48));
  add('wheel: shift scrolls sideways when zoomed', run('H.viewport.zoomAt(500, 400, 2); H.viewport.endGesture(); true'), mark(), run('H.pageEl.dispatchEvent(new WheelEvent("wheel", { deltaY: 30, shiftKey: true, bubbles: true, cancelable: true }))'), moved(-30, 0));
  add('wheel: is ignored during a stroke', md(500, 300), mark(), wheel(500, 400, 0, 120), moved(0, 0), see('INK(mouse)', 'start:mouse', { wc: '' }));
  add('wheel: default is prevented, so the page never scrolls behind', truth('!H.pageEl.dispatchEvent(new WheelEvent("wheel", { deltaY: 30, bubbles: true, cancelable: true }))'));
  add('ctrl+wheel: zooms in at the cursor and the point holds', run('H.probe(...Object.values(H.viewport.toSheet(500, 400)))'), wheel(500, 400, 0, -100, { ctrl: true }), wheel(500, 400, 0, -100, { ctrl: true }),
    truth('H.viewport.z() > 1.5', 'z grew'), truth('Math.hypot(H.probeAt()[0] - 500, H.probeAt()[1] - 400) < .6', 'point under the cursor held'), see('IDLE', '', { wc: 'transform' }), pause(260), see('IDLE', '', { wc: '' }));
  add('ctrl+wheel: never above 4', ...Array.from({ length: 14 }, () => wheel(500, 400, 0, -100, { ctrl: true })), truth('H.viewport.z() === 4'));
  add('ctrl+wheel: never below fit', wheel(500, 400, 0, 100, { ctrl: true }), truth('H.viewport.z() === 1'));
  add('ctrl+wheel: over the dock it cannot zoom the browser', truth('!document.body.dispatchEvent(new WheelEvent("wheel", { deltaY: 30, ctrlKey: true, bubbles: true, cancelable: true }))'), truth('document.body.dispatchEvent(new WheelEvent("wheel", { deltaY: 30, bubbles: true, cancelable: true }))', 'plain wheel over the dock stays free'));
  add('right button: no ink, no menu', md(500, 300, 'right'), see('IDLE', '', { n: 0 }), mm(540, 340), mu(540, 340, 'right'), see('IDLE', ''), truth('!H.pageEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))', 'context menu prevented'));
  add('Space+drag: pans; Space up ends it', run('H.viewport.zoomAt(500, 400, 2); H.viewport.endGesture(); true'), kd(' '), see('IDLE', '', { space: true }), md(500, 300), see('NAV1', '', { n: 1 }), mark(), mm(520, 300), mm(540, 320), moved(20, 20), see('NAV1', '', { panning: true, wc: 'transform' }),
    mu(540, 320), see('IDLE', '', { n: 0, wc: '' }), ku(' '), see('IDLE', '', { space: false }), truth('JSON.stringify(H.space) === JSON.stringify([[true,false],[true,true],[true,false],[false,false]])', 'cursor told about space and dragging'));
  add('Space+click: tap, no pan, no ink', kd(' '), md(500, 300), wait(10), mu(500, 300), see('IDLE', 'tap', { space: true }), ku(' '));
  add('Space held then released mid-drag: the drag finishes as a pan', run('H.viewport.zoomAt(500, 400, 2); H.viewport.endGesture(); true'), kd(' '), md(500, 300), mark(), mm(520, 300), ku(' '), mm(540, 300), see('NAV1', '', { space: false }), moved(20, 0), mu(540, 300), see('IDLE', '', { n: 0 }));
  add('Space then blur: not stuck panning', kd(' '), run('window.dispatchEvent(new Event("blur"))'), see('IDLE', '', { space: false }), ku(' '), md(500, 300), see('INK(mouse)', 'start:mouse'));
  add('Space in a text field is left alone', run('const t = document.createElement("textarea"); t.id = "h-t"; document.body.append(t); t.focus(); true'), kd(' '), see('IDLE', '', { space: false }), ku(' '), run('document.getElementById("h-t").remove(); true'));
  add('Space is prevented, so it never scrolls or clicks a button', run('window.__sp = null; addEventListener("keydown", e => { window.__sp = e.defaultPrevented; }, { once: true }); true'), kd(' '), truth('window.__sp === true'), ku(' '));
  for (const [label, k, o, want] of [
    ['Ctrl+Z', 'z', { ctrl: true }, 'undo'], ['Cmd+Z', 'z', { meta: true }, 'undo'], ['Ctrl+Y', 'y', { ctrl: true }, 'redo'], ['Ctrl+Shift+Z', 'z', { ctrl: true, shift: true }, 'redo'], ['Cmd+Shift+Z', 'z', { meta: true, shift: true }, 'redo'],
    ['1', '1', {}, 'showPage(1)'], ['2', '2', {}, 'showPage(2)'], ['3', '3', {}, 'showPage(3)'], ['4', '4', {}, 'showPage(4)'],
    ['5', '5', {}, ''], ['Ctrl+1', '1', { ctrl: true }, ''], ['z alone', 'z', {}, ''],
  ]) {
    add(`keys: ${label} -> ${want || 'nothing'}`, key(k, o), rec(want));
    if (want) {
      add(`keys: ${label} ignored while the Card is open`, { cfg: { cardOpen: true } }, key(k, o), rec(''));
      add(`keys: ${label} ignored during a stroke`, md(500, 300), key(k, o), rec(''));
    }
  }
  add('keys: ignored while typing', run('(() => { const el = document.createElement("input"); el.id = "h-t"; document.body.append(el); el.focus(); return true; })()'), key('z', { ctrl: true }), key('1'), rec(''), run('document.getElementById("h-t").remove(); true'));
  return rows;
}

// ---- tools.js against the recording engine, with real input and real targets ----
function toolRows() {
  const rows = [];
  const T = (name, setup, ...ops) => rows.push(R(name, { routing: 'tools', ...setup }, ...ops));
  const box = id => `H.boxCentre(${JSON.stringify(id)})`;
  const tg = id => `H.targetCentre(${JSON.stringify(id)})`;
  const ON1 = { sheet: 1 };
  const BEGIN = 'begin(crayon,red,M)';

  T('onInkStart..End: crayon stroke runs the engine', ON1, down(0, 300, 400), wait(1), to(0, 340, 420), wait(300), up(0), rec(`${BEGIN} extend endStroke`));
  T('stroke carries the current tool, swatch and size', { sheet: 1, tool: 'marker', swatch: 'denim', size: 'L' }, down(0, 300, 400), rec('begin(marker,denim,L)'));
  T('onTap: crayon tap clear of targets makes a dot', ON1, downAt(0, box('p1-uniform')), up(0), rec(`${BEGIN} endStroke`));
  T('onTap: tap on a blank opens the Card and leaves no dot', {}, downAt(0, tg('p3-name')), up(0), rec(`${BEGIN} cancelStroke open(p3-name)`));
  T('onTap: tap on the name line on the cover', ON1, downAt(0, tg('p1-name')), up(0), rec(`${BEGIN} cancelStroke open(p1-name)`));
  T('onTap: tap on a tick toggles it, no Card, no dot', { sheet: 2 }, downAt(0, tg('p2-t1')), up(0), rec(`${BEGIN} cancelStroke tick(p2-t1)`));
  T('onTap: 20 screen px off a target still hits it', {}, downAt(0, 'H.offTarget("p3-name", 20)'), up(0), rec(`${BEGIN} cancelStroke open(p3-name)`));
  T('onTap: 30 screen px off a target is a dot', {}, downAt(0, 'H.offTarget("p3-name", 30)'), up(0), rec(`${BEGIN} endStroke`));
  T('onTap: in Box Mode targets are inert', { sheet: 1, box: 'p1-uniform' }, downAt(0, tg('p1-name')), up(0), rec(`${BEGIN} endStroke`));
  T('onTap: a blank opens with any tool: marker', { tool: 'marker' }, downAt(0, tg('p3-name')), up(0), rec('begin(marker,red,M) cancelStroke open(p3-name)'));
  T('onTap: a blank opens with any tool: eraser', { tool: 'eraser' }, downAt(0, tg('p3-name')), up(0), rec('begin(eraser,red,M) cancelStroke open(p3-name)'));
  T('onTap: a blank opens with any tool: fill', { tool: 'fill' }, downAt(0, tg('p3-name')), up(0), rec('open(p3-name)'));
  T('onTap: a blank opens with any tool: stickers', { tool: 'stickers' }, downAt(0, tg('p3-name')), up(0), rec('open(p3-name)'));
  T('a long press on a blank with a crayon commits, it does not open', {}, downAt(0, tg('p3-name')), wait(300), up(0), rec(`${BEGIN} endStroke`));

  const FILL = { sheet: 1, tool: 'fill' };
  T('fill: no ink on down, pour on tap, inside a box', FILL, downAt(0, box('p1-weekend')), rec(''), up(0), rec('pour(red,p1-weekend)'));
  T('fill: pour outside any box', { sheet: 1, tool: 'fill', swatch: 'denim' }, down(0, 40, 300), up(0), rec('pour(denim,-)'));
  T('fill: in Box Mode the pour takes that box', { sheet: 1, tool: 'fill', box: 'p1-uniform' }, downAt(0, box('p1-weekend')), up(0), rec('pour(red,p1-uniform)'));
  T('fill: slow press still pours', FILL, downAt(0, box('p1-uniform')), wait(300), up(0), rec('pour(red,p1-uniform)'));
  T('fill: drag wiggles the crayon, no pour', FILL, down(0, 200, 400), wait(1), to(0, 240, 400), wait(100), up(0), rec('wiggle(crayon)'));
  T('fill: travel 7 is still a pour', FILL, downAt(0, box('p1-uniform')), wait(300), up(0), rec('pour(red,p1-uniform)'));
  T('fill: second finger within 200ms: nothing', FILL, down(0, 200, 400), wait(100), down(1, 400, 500), rec(''));
  T('fill: pinch that begins from a guard: nothing, not a pour and not a wiggle', FILL, down(0, 200, 400), wait(1), to(0, 240, 400), wait(300), down(1, 400, 500), to(1, 440, 500), see('NAV', undefined === 0 ? '' : ''), rec(''));
  T('fill: lost pointer: nothing', FILL, down(0, 200, 400), wait(300), tcancel(), rec(''));
  T('fill: page blur while holding: nothing', { ...FILL, clock: 'real' }, down(0, 200, 400), pause(260), run('window.dispatchEvent(new Event("blur"))'), rec(''));
  T('fill:result miss: tool wiggles, ripple', FILL, run('(() => { const r = H.constants.BOXES["p1-weekend"].rect; H.bus.emit("fill:result", { result: "miss", pt: { x: r.x + r.w / 2, y: r.y + r.h / 2 } }); })()'), rec('wiggle(fill) ripple'));
  T('fill:result leak: tool wiggles, ripple', FILL, run('(() => { const r = H.constants.BOXES["p1-weekend"].rect; H.bus.emit("fill:result", { result: "leak", pt: { x: r.x + r.w / 2, y: r.y + r.h / 2 } }); })()'), rec('wiggle(fill) ripple'));
  T('fill:result on a dark panel: plus a sparkle', FILL, run('(() => { const r = H.targets.dark(1)[0]; H.bus.emit("fill:result", { result: "miss", pt: { x: r.x + 2, y: r.y + 2 } }); })()'), rec('wiggle(fill) ripple sparkle'));
  T('fill:result ok: silent', FILL, run('H.bus.emit("fill:result", { result: "ok", pt: { x: 100, y: 100 } })'), rec(''));

  const STK = { sheet: 1, tool: 'stickers' };
  T('stickers tool, nothing placing: no ink', STK, downAt(0, box('p1-uniform')), wait(1), to(0, 300, 400), wait(100), up(0), rec(''));
  const placing = hit => ({ sheet: 1, tool: 'stickers', cfg: { placing: true, stickerHit: hit } });
  T('placing, drag: routes moves to the sticker until up', placing('drag'), down(0, 300, 400), wait(1), to(0, 340, 420), to(0, 350, 430), wait(300), up(0), rec('s.down s.move s.up(false)'));
  T('placing, body tap: commit and pour at the tap', placing('body'), down(0, 300, 400), up(0), rec('s.down s.up(true) s.commit pour(red,-)'));
  T('placing, body tap inside a box: pours into that box', placing('body'), downAt(0, box('p1-uniform')), up(0), rec('s.down s.up(true) s.commit pour(red,p1-uniform)'));
  T('placing, scale handle tap: no pour', placing('scale'), down(0, 300, 400), up(0), rec('s.down s.up(true)'));
  T('placing, miss with crayon in hand: commit and draw', { sheet: 1, tool: 'crayon', cfg: { placing: true, stickerHit: null } }, down(0, 300, 400), rec(`s.down s.commit ${BEGIN}`));
  T('placing, miss with stickers in hand: commit, no ink', placing(null), down(0, 300, 400), rec('s.down s.commit'));
  T('placing, drag then second finger: reverted', placing('drag'), down(0, 300, 400), wait(50), to(0, 340, 420), wait(50), down(1, 450, 550), rec('s.down s.move s.up(false)'), see('NAV', ''));
  T('placing, pen eraser end: commits, then erases', { sheet: 1, cfg: { placing: true, stickerHit: 'drag' } }, synth([['pointerdown', { pointerId: 91, pointerType: 'pen', isPrimary: true, clientX: 300, clientY: 400, buttons: 32 }]]), rec('s.commit begin(eraser,red,M,eraser)'));
  T('switching tool commits a placed sticker and remembers the drawing tool', placing('drag'), run('H.state.set("tool", "marker")'), rec('s.commit'), truth('H.state.get("lastDraw") === "marker"'), run('H.state.set("tool", "eraser")'), truth('H.state.get("lastDraw") === "marker"', 'eraser is not a drawing tool'));
  T('switching to stickers keeps placing', placing('drag'), run('H.state.set("tool", "stickers")'), rec(''));

  T('pen eraser end erases for that stroke only', ON1, synth([['pointerdown', { pointerId: 91, pointerType: 'pen', isPrimary: true, clientX: 300, clientY: 400, buttons: 32 }], ['pointerup', { pointerId: 91, pointerType: 'pen', clientX: 300, clientY: 400, buttons: 0 }]]), rec('begin(eraser,red,M,eraser) endStroke'), pd(300, 400), rec(`begin(eraser,red,M,eraser) endStroke ${BEGIN}`));
  T('onInkCancel cancels the engine', ON1, down(0, 300, 400), wait(50), down(1, 450, 550), rec(`${BEGIN} cancelStroke`));
  T('a moving guard commits the stroke', ON1, down(0, 200, 300), wait(1), to(0, 240, 300), wait(300), down(1, 450, 550), to(1, 490, 550), rec(`${BEGIN} extend endStroke`));
  T('sparkle over a dark panel', ON1, downAt(0, 'H.darkCentre(1)'), wait(1), run('true'), ['tdMove', 0, 12], rec(`${BEGIN} extend sparkle`));
  T('no sparkle with the eraser', { sheet: 1, tool: 'eraser' }, downAt(0, 'H.darkCentre(1)'), wait(1), ['tdMove', 0, 12], rec('begin(eraser,red,M) extend'));
  T('no sparkle on open paper', ON1, downAt(0, box('p1-uniform')), wait(1), ['tdMove', 0, 12], rec(`${BEGIN} extend`));
  T('read only: nothing draws, nothing opens', { sheet: 3, readOnly: true }, down(0, 300, 400), wait(1), to(0, 340, 420), wait(300), up(0), downAt(0, tg('p3-name')), up(0), rec(''));
  T('NAV1 tap (pen seen) on a blank opens it, with no stroke at all', {}, pd(100, 110), pu(100, 110), run('globalThis.__rec.length = 0'), downAt(0, tg('p3-name')), up(0), rec('open(p3-name)'));

  const emit = detail => run(`H.bus.emit("ink:commit", ${JSON.stringify(detail)})`);
  const inU = { x: 100, y: 500, w: 40, h: 40 }; // centre inside p1-uniform
  T('usage: solid color in a box is recorded once', ON1, emit({ sheet: 1, rect: inU, tool: 'crayon', swatchId: 'red' }), emit({ sheet: 1, rect: inU, tool: 'marker', swatchId: 'red' }), emit({ sheet: 1, rect: inU, tool: 'crayon', swatchId: 'blue' }),
    truth('JSON.stringify(H.state.get("usage")) === JSON.stringify({ "p1-uniform": { colors: ["red", "blue"], stickers: [] } })'));
  T('usage: fabric, skin and rainbow are not colors', ON1, emit({ sheet: 1, rect: inU, tool: 'crayon', swatchId: 'denim' }), emit({ sheet: 1, rect: inU, tool: 'crayon', swatchId: 'skin1' }), emit({ sheet: 1, rect: inU, tool: 'crayon', swatchId: 'rainbow' }), truth('JSON.stringify(H.state.get("usage")) === "{}"'));
  T('usage: outside a box, and the eraser, record nothing', ON1, emit({ sheet: 1, rect: { x: 10, y: 10, w: 10, h: 10 }, tool: 'crayon', swatchId: 'red' }), emit({ sheet: 1, rect: inU, tool: 'eraser', swatchId: 'red' }), truth('JSON.stringify(H.state.get("usage")) === "{}"'));
  T('usage: a sticker commit records its id', ON1, emit({ sheet: 1, rect: inU, tool: 'stickers', swatchId: 'tshirt' }), emit({ sheet: 1, rect: inU, tool: 'stickers', stickerId: 'aodai' }), truth('JSON.stringify(H.state.get("usage")["p1-uniform"].stickers) === JSON.stringify(["tshirt", "aodai"])'));
  T('usage: the right box', ON1, emit({ sheet: 1, rect: { x: 500, y: 500, w: 40, h: 40 }, tool: 'crayon', swatchId: 'green' }), truth('H.state.get("usage")["p1-weekend"].colors[0] === "green"'));
  return rows;
}

// ---- numbers: fit, frame, pan, zoom, spring, refit ----
async function viewportSuite(page, d) {
  const num = (a, b, tol = .01) => Math.abs(a - b) <= tol;
  for (const c of [
    { name: 'phone portrait 360x640', vp: [360, 640], ins: [52, 0, 132, 0], fit: Math.min(360 / 794, 456 / 1122), boxZ: 1 },
    { name: 'tablet portrait 768x1024', vp: [768, 1024], ins: [76, 0, 132, 0], fit: Math.min(768 / 794, 816 / 1122), boxZ: Math.min(768 / 344, 816 / 456) },
    { name: 'tablet landscape 1024x768', vp: [1024, 768], ins: [76, 120, 0, 120], fit: Math.min(784 / 794, 692 / 1122), boxZ: Math.min(784 / 344, 692 / 456) },
    { name: 'phone landscape 640x360 fits width', vp: [640, 360], ins: [0, 76, 0, 76], fit: 488 / 794, boxZ: Math.min(488 / 344, 360 / 456) },
  ]) {
    await d.vp(...c.vp);
    const r = await page.eval(ins => {
      H.fresh({ ins, sheet: 1 });
      const pr = H.pageEl.getBoundingClientRect();
      const fit = H.viewport.z(), atFit = { ...H.view };
      const rect = H.constants.BOXES['p1-uniform'].rect;
      H.viewport.frameRect(rect, { pad: 8, animate: false });
      const a = H.viewport.toClient(rect.x, rect.y), b = H.viewport.toClient(rect.x + rect.w, rect.y + rect.h);
      const out = { fit, atFit, boxZ: H.viewport.z(), a, b, wc: H.book.style.willChange, stateZ: H.state.get('z'), left: pr.left, top: pr.top, right: pr.right, bottom: pr.bottom, w: pr.width, h: pr.height };
      H.probe(rect.x, rect.y);
      out.probe = H.probeAt();
      return out;
    }, c.ins);
    check(`fit ${c.name}`, num(r.fit, c.fit, .001), `z ${r.fit}, want ${c.fit}`);
    const sW = 794 * r.fit, sH = 1122 * r.fit;
    check(`fit ${c.name}: sheet inside the free rect`, sW <= r.w + .01 && (r.h >= sH - .01 || c.vp[1] < 500), `${sW}x${sH} in ${r.w}x${r.h}`);
    check(`fit ${c.name}: centred`, num(r.atFit.tx, Math.max(0, (r.w - sW) / 2), .01), `tx ${r.atFit.tx}`);
    check(`Box Mode ${c.name}: scale`, num(r.boxZ, c.boxZ, .001), `z ${r.boxZ}, want ${c.boxZ}`);
    check(`Box Mode ${c.name}: state.z follows`, r.stateZ === r.boxZ);
    check(`Box Mode ${c.name}: box inside the free rect with its pad`, r.a.x >= r.left + 7.9 * .99 * Math.min(1, r.boxZ) && r.a.y >= r.top + 7.9 * .99 * Math.min(1, r.boxZ) && r.b.x <= r.right - 7.9 * .99 * Math.min(1, r.boxZ) && r.b.y <= r.bottom - 7.9 * .99 * Math.min(1, r.boxZ), JSON.stringify(r));
    check(`Box Mode ${c.name}: toClient matches the DOM`, num(r.probe[0], r.a.x, .1) && num(r.probe[1], r.a.y, .1), `probe ${r.probe}, toClient ${r.a.x},${r.a.y}`);
  }
  await d.vp(d.view.width, d.view.height);
  d.sized = false;

  const r = await page.eval(async () => {
    const v = H.viewport, o = {};
    const raf = () => new Promise(res => requestAnimationFrame(res));
    H.fresh();
    const fit = o.fit = v.z();
    const pr = H.pageEl.getBoundingClientRect();
    o.pr = [pr.left, pr.top, pr.width, pr.height];

    v.panBy(100, 100);
    o.panAtFit = { ...H.view };
    v.zoomAt(pr.left + pr.width / 2, pr.top + pr.height / 2, 3);
    v.panBy(1e5, 1e5);
    o.panMax = { ...H.view };
    v.panBy(-1e6, -1e6);
    o.panMin = { ...H.view };
    o.zoomed = v.z();

    v.zoomAt(300, 400, 1000);
    o.zMax = v.z();
    v.zoomAt(300, 400, 1 / 1000);
    o.zMin = v.z();

    H.fresh();
    v.zoomAt(300, 400, 1.14);
    o.zoomed114 = v.isZoomed();
    H.fresh();
    v.zoomAt(300, 400, 1.16);
    o.zoomed116 = v.isZoomed();

    H.fresh();
    const pt = v.toSheet(123, 456), c = v.toClient(pt.x, pt.y);
    o.round = [c.x, c.y];
    H.probe(pt.x, pt.y);
    o.probeRound = H.probeAt();

    // Spring: within 15% of fit, over about 160ms. Beyond 15%, stays.
    H.fresh();
    v.beginGesture();
    v.zoomAt(300, 410, 1.1);
    const t0 = performance.now();
    v.endGesture();
    o.springMoving = v.z() !== fit && H.book.style.willChange === 'transform';
    while (v.z() !== fit && performance.now() - t0 < 2000) await raf();
    o.springMs = performance.now() - t0;
    o.springEnd = v.z();
    o.springWc = H.book.style.willChange;
    H.fresh();
    v.beginGesture();
    v.zoomAt(300, 410, 1.2);
    const z12 = v.z();
    v.endGesture();
    await raf();
    o.noSpring = v.z() === z12;
    o.noSpringWc = H.book.style.willChange;

    // A loose axis slides during a gesture, and settles centred afterwards.
    H.fresh();
    v.beginGesture();
    v.pinchStart(300, 410, 100);
    v.pinchMove(330, 410, 100);
    o.looseTx = H.view.tx;
    v.endGesture();
    for (let i = 0; i < 40 && H.book.style.willChange; i++) await raf();
    o.settledTx = H.view.tx;
    o.settledWc = H.book.style.willChange;

    // Framing animates, ends exact, and refit with nothing changed leaves it running.
    H.fresh({ sheet: 1 });
    const rect = H.constants.BOXES['p1-uniform'].rect;
    v.frameRect(rect, { pad: 8, animate: true });
    o.frameStartWc = H.book.style.willChange;
    o.frameStartZ = v.z();
    await raf();
    v.refit();
    o.frameAfterRefit = v.z();
    const t1 = performance.now();
    while (H.book.style.willChange && performance.now() - t1 < 2000) await raf();
    o.frameEndZ = v.z();
    o.frameMs = performance.now() - t1;
    o.frameIsZoomed = v.isZoomed();
    o.frameWant = Math.min(pr.width / 344, pr.height / 456);

    // A press during the glide lands it first, so the finger maps to where the page ends up.
    v.fit();
    v.frameRect(rect, { pad: 8, animate: true });
    await raf();
    v.settle();
    o.settled = v.z();
    o.settledWc2 = H.book.style.willChange;

    v.fit({ animate: true });
    o.fitAnimated = v.z() !== fit;
    v.settle();
    o.fitEnd = v.z();

    // destroy gives the reading view its book back.
    H.fresh();
    v.zoomAt(300, 400, 2);
    v.beginGesture();
    v.destroy();
    o.destroyTransform = H.book.style.transform;
    o.destroyWc = H.book.style.willChange;
    o.destroyZ = H.state.get('z');
    H.fresh();
    return o;
  });
  check('pan at fit: nothing moves', num(r.panAtFit.tx, (r.pr[2] - 794 * r.fit) / 2) && r.panAtFit.ty === 0, JSON.stringify(r.panAtFit));
  check('pan: stops at the top left of the free rect', r.panMax.tx === 0 && r.panMax.ty === 0, JSON.stringify(r.panMax));
  check('pan: stops at the bottom right of the free rect', num(r.panMin.tx, r.pr[2] - 794 * r.zoomed) && num(r.panMin.ty, r.pr[3] - 1122 * r.zoomed), JSON.stringify(r.panMin));
  check('zoom: never above 4', r.zMax === 4, r.zMax);
  check('zoom: never below fit', r.zMin === r.fit, r.zMin);
  check('isZoomed: false at 1.14 fit', r.zoomed114 === false);
  check('isZoomed: true at 1.16 fit', r.zoomed116 === true);
  check('toClient undoes toSheet', num(r.round[0], 123) && num(r.round[1], 456), r.round);
  check('toSheet agrees with the DOM', num(r.probeRound[0], 123, .1) && num(r.probeRound[1], 456, .1), r.probeRound);
  check('spring: within 15% it starts moving under will-change', r.springMoving);
  check('spring: reaches fit in about 160ms', r.springEnd === r.fit && r.springMs > 100 && r.springMs < 500, `${r.springMs}ms to z ${r.springEnd}`);
  check('spring: will-change off at the end', r.springWc === '', r.springWc);
  check('no spring beyond 15%', r.noSpring);
  check('no spring: will-change off at once', r.noSpringWc === '', r.noSpringWc);
  check('loose axis slides during a gesture', r.looseTx > (r.pr[2] - 794 * r.fit) / 2 + 20, r.looseTx);
  check('loose axis settles centred after it', num(r.settledTx, (r.pr[2] - 794 * r.fit) / 2) && r.settledWc === '', `${r.settledTx}`);
  check('frameRect animate: will-change on, starts at the old view', r.frameStartWc === 'transform' && r.frameStartZ === r.fit, JSON.stringify([r.frameStartWc, r.frameStartZ]));
  check('refit with nothing changed leaves the glide running', r.frameAfterRefit < r.frameWant - 1e-3, `${r.frameAfterRefit} vs ${r.frameWant}`);
  check('frameRect animate: ends exact, will-change off', num(r.frameEndZ, r.frameWant, .001) && r.frameIsZoomed, `${r.frameEndZ} vs ${r.frameWant}`);
  check('frameRect animate: about 360ms', r.frameMs < 800, r.frameMs);
  check('settle() lands the glide at once', num(r.settled, r.frameWant, .001) && r.settledWc2 === '', r.settled);
  check('fit animate, settled', r.fitAnimated && r.fitEnd === r.fit, r.fitEnd);
  check('destroy clears transform, will-change, z', r.destroyTransform === '' && r.destroyWc === '' && r.destroyZ === 1, JSON.stringify([r.destroyTransform, r.destroyWc, r.destroyZ]));

  // Reduced motion: every view change is instant.
  await page.setMedia({ features: { 'prefers-reduced-motion': 'reduce' } });
  const rm = await page.eval(() => {
    const v = H.viewport, o = {};
    H.fresh({ sheet: 1 });
    const fit = v.z();
    v.beginGesture();
    v.zoomAt(300, 410, 1.1);
    v.endGesture();
    o.spring = v.z() === fit && H.book.style.willChange === '';
    const rect = H.constants.BOXES['p1-uniform'].rect;
    const pr = H.pageEl.getBoundingClientRect();
    v.frameRect(rect, { pad: 8, animate: true });
    o.frame = Math.abs(v.z() - Math.min(pr.width / 344, pr.height / 456)) < 1e-6 && H.book.style.willChange === '';
    v.fit({ animate: true });
    o.fit = v.z() === fit && H.book.style.willChange === '';
    H.fresh();
    return o;
  });
  await page.setMedia({ features: { 'prefers-reduced-motion': 'no-preference' } });
  check('reduced motion: spring instant', rm.spring);
  check('reduced motion: frameRect instant', rm.frame);
  check('reduced motion: fit instant', rm.fit);

  // Refit: keeps the sheet centre on a small change, keeps a framed box framed, and re-frames Box Mode after a rotation.
  await page.eval(() => {
    H.fresh();
    H.viewport.zoomAt(300, 410, 3.2);
    H.viewport.endGesture();
    const pr = H.pageEl.getBoundingClientRect();
    window.__c = H.viewport.toSheet(pr.left + pr.width / 2, pr.top + pr.height / 2);
    window.__z = H.viewport.z();
    window.__fitOld = true;
  });
  await d.vp(600, 940);
  const small = await page.eval(() => {
    H.viewport.refit();
    const pr = H.pageEl.getBoundingClientRect();
    const c = H.viewport.toSheet(pr.left + pr.width / 2, pr.top + pr.height / 2);
    return { dx: c.x - window.__c.x, dy: c.y - window.__c.y, z: H.viewport.z(), z0: window.__z };
  });
  check('refit: small change keeps the sheet centre and the zoom', num(small.dx, 0, .01) && num(small.dy, 0, .01) && small.z === small.z0, JSON.stringify(small));
  await d.vp(600, 900);
  const framed = await page.eval(() => {
    H.fresh({ sheet: 1, box: 'p1-uniform' });
    H.viewport.frameRect(H.constants.BOXES['p1-uniform'].rect, { pad: 8, animate: false });
    return true;
  });
  await d.vp(900, 600);
  const rotated = await page.eval(() => {
    H.viewport.refit();
    const pr = H.pageEl.getBoundingClientRect();
    const got = { z: H.viewport.z(), c: H.boxCentre('p1-uniform') };
    // Where a fresh framing puts the box. A sheet narrower than the free rect stays centred, so the box need not be.
    H.viewport.frameRect(H.constants.BOXES['p1-uniform'].rect, { pad: 8, animate: false });
    return { z: got.z, want: H.viewport.z(), c: got.c, mid: H.boxCentre('p1-uniform'), zFit: Math.min(pr.width / 344, pr.height / 456) };
  });
  check('refit: a framed box stays framed across a rotation', framed && num(rotated.z, rotated.want, .001) && num(rotated.c[0], rotated.mid[0], .1) && num(rotated.c[1], rotated.mid[1], .1), JSON.stringify(rotated));
  await d.vp(600, 900);
  await page.eval(() => {
    H.fresh({ sheet: 1, box: 'p1-uniform' });
    H.viewport.frameRect(H.constants.BOXES['p1-uniform'].rect, { pad: 8, animate: false });
    H.viewport.panBy(-5, -5);
    return true;
  });
  await d.vp(900, 600);
  const rotated2 = await page.eval(() => {
    H.viewport.refit();
    const pr = H.pageEl.getBoundingClientRect();
    return { z: H.viewport.z(), want: Math.min(pr.width / 344, pr.height / 456) };
  });
  check('refit: Box Mode re-frames after a rotation even if panned', num(rotated2.z, rotated2.want, .001), JSON.stringify(rotated2));
  await d.vp(d.view.width, d.view.height);
  d.sized = false;

  // The dock changing shape: ResizeObserver refits even though the window did not change.
  const dock = await page.eval(async () => {
    H.fresh();
    const z0 = H.viewport.z();
    H.setInsets([52, 0, 232, 0]);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { z0, z1: H.viewport.z(), want: Math.min(600 / 794, 616 / 1122) };
  });
  check('free rect change without a window resize refits', num(dock.z1, dock.want, .001), JSON.stringify(dock));
  await page.eval('H.fresh()');
}

// ---- pinch: the point between the fingers stays where it is, checked against the DOM, not the arithmetic ----
async function pinchSuite(page, d) {
  const stepErrors = async (cx, cy, frames) => {
    const errs = [];
    for (const f of frames) {
      await d.tm(f.fingers);
      await page.frames(2);
      const [px, py] = await page.eval('H.probeAt()');
      errs.push(Math.hypot(px - f.cx, py - f.cy));
    }
    return errs;
  };
  const spread = (cx, cy, radii, dx = 0, dy = 0) => radii.map((r, i) => ({
    cx: cx + dx * i, cy: cy + dy * i,
    fingers: [[0, cx + dx * i - r, cy + dy * i], [1, cx + dx * i + r, cy + dy * i]],
  }));
  const start = async (cx, cy, r, setupExpr) => {
    await page.eval(`H.fresh(); ${setupExpr || ''}; H.probe(...Object.values(H.viewport.toSheet(${cx}, ${cy}))); true`);
    await d.begin('virtual');
    await d.td(0, cx - r, cy);
    await d.td(1, cx + r, cy);
    await page.frames(2);
  };
  const ZOOM = 'H.viewport.zoomAt(300, 410, 3); H.viewport.endGesture()';

  // Centre of the free rect, from fit: the one point where no clamp ever acts.
  await start(300, 410, 40);
  let errs = await stepErrors(300, 410, spread(300, 410, [50, 70, 90, 120, 160, 200, 240, 280]));
  check('pinch from fit about the free rect centre: focal point stationary', Math.max(...errs) < .6, 'errors ' + errs.map(e => e.toFixed(2)));
  const z1 = await page.eval('H.viewport.z()');
  check('pinch from fit: z followed the fingers', Math.abs(z1 - (716 / 1122) * 280 / 40) < .01 || z1 === 4, 'z ' + z1);
  const wcDuring = await page.eval('[H.book.style.willChange, getComputedStyle(H.book).willChange]');
  check('pinch: will-change:transform during the gesture', wcDuring[0] === 'transform' && wcDuring[1] === 'transform', wcDuring);
  await d.tu(0); await d.tu(1);
  await page.frames(2);
  check('pinch: will-change gone after the gesture', await page.eval('H.book.style.willChange === "" && getComputedStyle(H.book).willChange === "auto"'));

  // Off centre, zoomed, pinching out and back in.
  await start(220, 300, 60, ZOOM);
  errs = await stepErrors(220, 300, spread(220, 300, [70, 90, 110, 130, 110, 90, 70, 60, 50, 45]));
  check('pinch zoomed, off centre, out and back in: focal point stationary', Math.max(...errs) < .6, 'errors ' + errs.map(e => e.toFixed(2)));
  await d.tu(0); await d.tu(1);

  // Two fingers at a fixed distance: the sheet follows the centroid.
  await start(300, 410, 80, ZOOM);
  errs = await stepErrors(300, 410, spread(300, 410, Array(8).fill(80), 12, -9));
  check('two finger pan: sheet follows the centroid', Math.max(...errs) < .6, 'errors ' + errs.map(e => e.toFixed(2)));
  check('two finger pan: z unchanged', Math.abs(await page.eval('H.viewport.z()') - 3 * 716 / 1122) < .001);
  await d.tu(0); await d.tu(1);

  // Pinch and pan at once.
  await start(260, 360, 60, ZOOM);
  errs = await stepErrors(260, 360, spread(260, 360, [70, 85, 100, 120, 140, 130, 110], 5, 7));
  check('pinch and pan at once: focal point follows the centroid', Math.max(...errs) < .6, 'errors ' + errs.map(e => e.toFixed(2)));
  await d.tu(0); await d.tu(1);

  // Past the top of the range, the point stays and reversing answers at once.
  await start(300, 410, 100, ZOOM);
  errs = await stepErrors(300, 410, spread(300, 410, [290, 295]));
  const atMax = await page.eval('H.viewport.z()');
  check('pinch past 4x: z stops at 4', atMax === 4, atMax);
  errs = errs.concat(await stepErrors(300, 410, spread(300, 410, [295, 290, 280])));
  const afterTurn = await page.eval('H.viewport.z()');
  check('pinch past 4x: focal point stationary, reversing answers at once', Math.max(...errs) < .6 && afterTurn < 4, `z ${afterTurn}, errors ${errs.map(e => e.toFixed(2))}`);
  await d.tu(0); await d.tu(1);

  // The clamp: near a page corner the sheet may not leave the free rect, and the point comes back once the clamp lets go.
  await start(120, 120, 40);
  const edgeFrames = spread(120, 120, [50, 60, 80, 100, 120, 140, 160]);
  const bounds = [];
  for (const f of edgeFrames) {
    await d.tm(f.fingers);
    await page.frames(2);
    bounds.push(await page.eval('({ ...H.view, w: H.pageEl.clientWidth, h: H.pageEl.clientHeight })'));
  }
  check('pinch near a corner: the sheet never leaves the free rect', bounds.every(v => {
    const sw = 794 * v.z, sh = 1122 * v.z;
    const okX = sw <= v.w ? v.tx >= -.01 && v.tx + sw <= v.w + .01 : v.tx <= .01 && v.tx + sw >= v.w - .01;
    const okY = sh <= v.h ? v.ty >= -.01 && v.ty + sh <= v.h + .01 : v.ty <= .01 && v.ty + sh >= v.h - .01;
    return okX && okY;
  }), JSON.stringify(bounds.at(-1)));
  const [ex, ey] = await page.eval('H.probeAt()');
  check('pinch near a corner: the point is back under the fingers once the clamp lets go', Math.hypot(ex - 120, ey - 120) < .6, `off by ${ex - 120},${ey - 120}`);
  await d.tu(0); await d.tu(1);
  await d.cleanup();
  await page.eval('H.fresh()');

  // Text sharpness. During the gesture the layer is a stretched texture; after it, text is re-rasterized at the real scale.
  const sharp = file => {
    const { width, height, channels: c, data } = readPng(file);
    const lum = (x, y) => { const i = (y * width + x) * c; return .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2]; };
    let sum = 0, n = 0;
    for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) { const g = lum(x, y); sum += (lum(x + 1, y) - g) ** 2 + (lum(x, y + 1) - g) ** 2; n++; }
    return sum / n;
  };
  const clip = { x: 60, y: 200, width: 480, height: 420 };
  await page.eval('H.fresh({ sheet: 3 }); true');
  await d.begin('virtual');
  await page.frames(3);
  // Not page.screenshot: its clip turns on captureBeyondViewport, which resizes the window and rightly aborts the gesture.
  const shot = async file => { const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip: { scale: 1, ...clip } }); fs.writeFileSync(file, Buffer.from(data, 'base64')); };
  await d.td(0, 240, 380);
  await d.td(1, 360, 380);
  for (const r of [100, 140, 180, 220, 260]) { await d.tm([[0, 300 - r, 380], [1, 300 + r, 380]]); await page.frames(2); }
  await sleep(150);
  const during = path.join(out, 'pinch-during.png'), after = path.join(out, 'pinch-after.png'), control = path.join(out, 'pinch-control.png');
  await shot(during);
  const wcHold = await page.eval('H.book.style.willChange');
  const tf = await page.eval('H.book.style.transform');
  await d.tu(0); await d.tu(1);
  await page.frames(3);
  const wcAfter = await page.eval('H.book.style.willChange');
  await sleep(150);
  await shot(after);
  await page.eval(t => { H.input.detach(); H.viewport.destroy(); H.book.style.transform = t; }, tf);
  await page.frames(3);
  await sleep(150);
  await shot(control);
  await page.eval('H.fresh()');
  const sD = sharp(during), sA = sharp(after), sC = sharp(control);
  check('sharpness: will-change is on while the fingers hold', wcHold === 'transform', wcHold);
  check('sharpness: will-change is off once they lift', wcAfter === '', wcAfter);
  // Headless Chrome paints a fresh sharp raster for every screenshot, so it cannot show the stretched texture a phone GPU keeps
  // under will-change. What it can prove: the page is never blurrier after the gesture than during it.
  check('sharpness: text is no blurrier once the gesture ends', sA >= sD * .98, `edge energy ${sD.toFixed(1)} during, ${sA.toFixed(1)} after`);
  const same = pngDiff(after, control, { tolerance: 8 });
  check('sharpness: after the gesture it matches a page never under will-change', same.same || same.diffPixels < 300, `${same.diffPixels} px differ`);
  console.log(`  sharpness: edge energy ${sD.toFixed(1)} during the gesture, ${sA.toFixed(1)} after, ${sC.toFixed(1)} control; transform ${tf}`);
}

// ---- coalesced points, pressure, sheet mapping ----
async function pointSuite(page, d) {
  await page.eval('H.fresh(); H.allPts = []; true');
  await d.begin('virtual');
  await d.td(0, 200, 300);
  for (let i = 1; i <= 24; i++) { d.vt += 4; await d.tm([[0, 200 + i * 6, 300 + i * 3]]); }
  await page.frames(3);
  let r = await page.eval(() => ({ n: H.allPts.length, calls: H.rec.filter(t => t === 'move').length, last: H.last, map: H.viewport.toSheet(344, 372), mono: H.allPts.every((p, i, a) => !i || p.t >= a[i - 1].t), type: H.allPts[0].type, p: H.allPts.map(q => q.p) }));
  check('moves: every point arrives, coalesced or not', r.n === 24, `${r.n} of 24 in ${r.calls} calls`);
  check('moves: last point is in sheet px', Math.abs(r.last.x - r.map.x) < .01 && Math.abs(r.last.y - r.map.y) < .01, JSON.stringify([r.last, r.map]));
  check('moves: time runs forward, type is set', r.mono && r.type === 'touch');
  check('moves: fast touch thins toward .35, never below', Math.min(...r.p) >= .35 && r.p.at(-1) < .7, `last p ${r.p.at(-1)}`);
  await d.tu(0);
  await d.cleanup();

  await page.eval('H.fresh(); H.allPts = []; true');
  await d.begin('virtual');
  await d.td(0, 200, 300);
  for (let i = 1; i <= 12; i++) { d.vt += 60; await d.tm([[0, 200 + i * 2, 300]]); }
  await page.frames(3);
  r = await page.eval('H.allPts.map(q => q.p)');
  check('moves: slow touch stays near full pressure', Math.min(...r) > .9, `min ${Math.min(...r)}`);
  await d.tu(0);
  await d.cleanup();

  await page.eval('H.fresh(); H.allPts = []; true');
  await d.begin('virtual');
  await d.pd(300, 400, .25);
  for (const f of [.1, .4, .9]) { d.vt += 16; await d.pm(300 + f * 100, 400, f); }
  await page.frames(3);
  r = await page.eval('H.allPts.map(q => q.p)');
  const want = [.1, .4, .9].map(f => f ** .7);
  check('pen: p = pressure ** 0.7', r.length === 3 && r.every((p, i) => Math.abs(p - want[i]) < .01), JSON.stringify(r));
  await d.pu(390, 400);
  await d.cleanup();
  await page.eval(() => {
    H.fresh(); H.allPts = [];
    H.pageEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 70, pointerType: 'pen', isPrimary: true, clientX: 300, clientY: 400, buttons: 1, pressure: 0 }));
    return true;
  });
  check('pen: a pen reporting no pressure still draws at .5', await page.eval('H.downPt.p === .5 && H.downPt.type === "pen"'));
  await page.eval('H.fresh(); true');
}

// ---- what section 5.1 asks of the page, including the iOS-only guards ----
async function setupSuite(page, d) {
  const css = await page.eval(() => {
    const c = getComputedStyle(H.pageEl), r = getComputedStyle(document.documentElement);
    return { ta: c.touchAction, us: c.userSelect, ob: r.overscrollBehaviorY, pe: getComputedStyle(document.querySelector('.sheet.on .inner') || document.querySelector('.sheet.on')).pointerEvents, zero: document.querySelectorAll('.book').length };
  });
  check('setup: .page has touch-action:none', css.ta === 'none', css.ta);
  check('setup: .page has user-select:none', css.us === 'none', css.us);
  check('setup: html has overscroll-behavior:none', css.ob === 'none', css.ob);
  check('setup: sheet content has pointer-events:none', css.pe === 'none', css.pe);
  const manip = await page.eval(() => [...document.querySelectorAll('html, body, .page, .book, .book *')].filter(e => /manipulation|pinch-zoom/.test(getComputedStyle(e).touchAction)).length);
  check('setup: no manipulation or pinch-zoom in the stage', manip === 0, manip);
  const allGuard = await page.eval(() => {
    const fire = (t, type, C = Event) => t.dispatchEvent(new C(type, { bubbles: true, cancelable: true })) === false;
    H.fresh();
    const on = { gesturestart: fire(document, 'gesturestart'), gesturechange: fire(document, 'gesturechange'), contextmenu: fire(H.pageEl, 'contextmenu', MouseEvent) };
    H.input.detach();
    const off = { gesturestart: fire(document, 'gesturestart'), gesturechange: fire(document, 'gesturechange'), contextmenu: fire(H.pageEl, 'contextmenu', MouseEvent) };
    H.fresh();
    return { on, off };
  });
  check('setup: gesture and contextmenu prevented while attached', Object.values(allGuard.on).every(Boolean), JSON.stringify(allGuard.on));
  check('setup: gesture and contextmenu free after detach', !Object.values(allGuard.off).some(Boolean), JSON.stringify(allGuard.off));

  // A real touch, seen at the document after .page's handler ran. Only iOS may prevent touchstart: it suppresses click.
  const touchPrevented = async () => {
    await page.eval(`window.__ts = null; document.addEventListener('touchstart', e => { window.__ts = e.defaultPrevented; }, { once: true }); true`);
    await d.begin('real');
    await d.td(0, 300, 400);
    await page.frames(2);
    const v = await page.eval('window.__ts');
    await d.tu(0);
    await page.frames(2);
    return v;
  };
  const UA = await page.eval('navigator.userAgent');
  check('setup: not iOS: touchstart is left alone', await touchPrevented() === false);
  for (const [label, ua] of [
    ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'],
    ['iPad claiming to be a Mac', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'],
  ]) {
    await page.send('Emulation.setUserAgentOverride', { userAgent: ua });
    await page.eval('H.fresh(); true');
    check(`setup: ${label}: touchstart prevented`, await touchPrevented() === true);
    await page.eval('H.input.detach(); true');
    check(`setup: ${label}: released on detach`, await touchPrevented() === false);
  }
  await page.send('Emulation.setUserAgentOverride', { userAgent: UA });
  await page.eval('H.fresh(); true');
}

// ---- the cursor dot, on a page with a fine pointer ----
async function cursorSuite(page, d) {
  const dot = () => page.eval(() => {
    const c = document.getElementById('st-cursor');
    if (!c) return null;
    const s = getComputedStyle(c);
    return { display: s.display, w: parseFloat(s.width), bg: c.style.background, tf: c.style.transform, parent: c.parentElement.id || c.parentElement.tagName, pe: s.pointerEvents, page: H.pageEl.style.cursor };
  });
  await page.eval('H.fresh({ routing: "tools", sheet: 1, ins: [60, 200, 0, 120] }); true');
  await d.begin('real');
  await d.mm(500, 300);
  await page.frames(2);
  let c = await dot();
  check('cursor: hover shows the dot where the mouse is', c?.display === 'block' && /500px, ?300px/.test(c.tf), JSON.stringify(c));
  check('cursor: real size at this zoom', c && Math.abs(c.w - 15) < .01, c?.w);
  check('cursor: current color', c && /rgb\(242, 89, 75\)|#F2594B/i.test(c.bg), c?.bg);
  check('cursor: hides the system cursor', c?.page === 'none', c?.page);
  check('cursor: ignores pointers', c?.pe === 'none');
  await page.eval('H.state.set("size", "L"); H.state.set("swatch", "blue"); true');
  c = await dot();
  check('cursor: follows size and swatch', c && Math.abs(c.w - 24) < .01 && /rgb\(42, 91, 215\)|#2A5BD7/i.test(c.bg), JSON.stringify(c));
  await page.eval('H.state.set("tool", "eraser"); true');
  c = await dot();
  check('cursor: eraser is white at eraser size', c && Math.abs(c.w - 44) < .01 && /rgb\(255, 255, 255\)|#FFFFFF/i.test(c.bg), JSON.stringify(c));
  await page.eval('H.state.set("tool", "crayon"); H.state.set("swatch", "red"); H.state.set("size", "M"); H.viewport.zoomAt(500, 300, 2); H.viewport.endGesture(); true');
  c = await dot();
  check('cursor: scales with zoom', c && Math.abs(c.w - 30) < .01, c?.w);
  await d.md(500, 300);
  await d.mm(530, 320);
  await page.frames(2);
  c = await dot();
  check('cursor: follows the stroke', /530px, ?320px/.test(c?.tf ?? ''), JSON.stringify(c));
  await d.mu(530, 320);
  await d.mm(60, 300); // over the left inset, off .page
  await page.frames(2);
  c = await dot();
  check('cursor: gone when the mouse leaves the stage', c?.display === 'none' && c?.page === '', JSON.stringify(c));
  await d.mm(500, 300);
  await page.frames(2);
  c = await dot();
  check('cursor: back when it returns', c?.display === 'block', JSON.stringify(c));
  await page.keyDown(' ');
  await page.frames(2);
  c = await dot();
  check('cursor: Space shows a grab hand instead', c?.display === 'none' && c?.page === 'grab', JSON.stringify(c));
  await page.keyUp(' ');
  await page.eval('H.bus.emit("studio:exit"); H.targets.build(); true');
  check('cursor: exit removes it', await dot() === null);
  await d.mm(510, 300);
  await page.eval('H.fresh(); true');
}

async function cursorTouchSuite(page, d) {
  await page.eval('H.fresh({ routing: "tools", sheet: 1 }); true');
  await d.begin('real');
  await d.mm(500, 300);
  await page.frames(2);
  const shown = await page.eval('getComputedStyle(document.getElementById("st-cursor")).display');
  await d.td(0, 300, 400);
  await page.frames(2);
  const afterTouch = await page.eval('getComputedStyle(document.getElementById("st-cursor")).display');
  await d.tu(0);
  check('cursor: a touch hides the dot the mouse left behind', shown === 'block' && afterTouch === 'none', `${shown} then ${afterTouch}`);
  await page.eval('H.bus.emit("studio:exit"); H.targets.build(); H.fresh(); true');
}

// tdMove: moves finger id by px from wherever tdAt put it, for rows that do not know the coordinates in advance.
Driver.prototype.tdMove = async function (id, px) {
  const p = this.fingers.get(id);
  await this.tm([[id, p.x + px, p.y]]);
};

// ---- run ----
const prof = n => path.join(out, 'prof-' + n);
const open = async (name, view, ins) => {
  const page = await launch({ browser: BROWSER, profileDir: prof(name), ...view });
  await serveStubs(page);
  await page.block(['*fonts.googleapis.com*', '*fonts.gstatic.com*']);
  await page.goto(BASE + '?test=1');
  await page.eval(installHarness, ins);
  const age = await page.eval('performance.now()');
  if (age < 3200) await sleep(3200 - age); // the virtual clock starts 3s back, and must not start before the page does
  return page;
};
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null; // ONLY=setup,pinch runs just those sections
const section = async (name, fn) => {
  if (ONLY && !ONLY.includes(name)) return;
  const before = passed + failures.length, t0 = Date.now();
  await fn();
  console.log(`${name}: ${passed + failures.length - before} checks, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
};

const TOUCH_VIEW = { width: 600, height: 900, dsf: 2, mobile: true, touch: true };
const MOUSE_VIEW = { width: 1280, height: 800, dsf: 1, mobile: false, touch: false };
const results = async () => {
  const touch = await open('touch', TOUCH_VIEW, [52, 0, 132, 0]);
  try {
    const d = new Driver(touch, TOUCH_VIEW);
    await section('setup', () => setupSuite(touch, d));
    await section('machine', () => runRows(touch, d, machineRows()));
    await section('points', () => pointSuite(touch, d));
    await section('viewport', () => viewportSuite(touch, d));
    await section('pinch', () => pinchSuite(touch, d));
    await section('tools', () => runRows(touch, d, toolRows()));
    await section('cursor on touch', () => cursorTouchSuite(touch, d));
    const errs = touch.consoleErrors().filter(e => !/fonts\.g/.test(e));
    check('touch page: no console errors', !errs.length, errs[0]);
    const diag = await touch.eval('(globalThis.__diag || []).filter(m => !/boom|^golden:/.test(m))');
    check('touch page: nothing logged to diag', !diag.length, diag[0]);
  } finally { await touch.close(); }

  const mouse = await open('mouse', MOUSE_VIEW, [60, 200, 0, 120]);
  try {
    const d = new Driver(mouse, MOUSE_VIEW);
    const fit = await mouse.eval(() => ({ z: H.viewport.z(), tx: H.view.tx, ty: H.view.ty }));
    check('mouse fit: width capped at 1.0, centred, top of page', fit.z === 1 && fit.tx === 83 && fit.ty === 0, JSON.stringify(fit));
    await section('mouse', () => runRows(mouse, d, mouseRows()));
    await section('cursor', () => cursorSuite(mouse, d));
    const errs = mouse.consoleErrors().filter(e => !/fonts\.g/.test(e));
    check('mouse page: no console errors', !errs.length, errs[0]);
  } finally { await mouse.close(); }
};

await results();
console.log(`\n${BROWSER}: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
