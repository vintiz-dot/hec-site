// cdp.mjs: drive headless Chrome or Edge through the DevTools Protocol. No dependencies, Node 24 only
// (global WebSocket and fetch). Proof it works: node tools/studio-tests/cdp-smoke.mjs <scratch dir>
//
//   import { launch, pngDiff, sleep } from './cdp.mjs';
//   const page = await launch({ browser: 'chrome', profileDir: 'C:/.../scratch/me/prof1',
//                               width: 390, height: 844, dsf: 2, mobile: true, touch: true });
//   try {
//     await page.goto('http://localhost:5310/clothes-story/?test=1');
//     const sheets = await page.eval('document.querySelectorAll(".sheet").length');
//     await page.touchStart({ x: 100, y: 200 });          // finger 0 lands
//     await page.touchStart({ id: 1, x: 200, y: 200 });   // finger 1 lands, finger 0 stays down
//     await page.touchMove([{ id: 0, x: 90, y: 200 }, { id: 1, x: 220, y: 200 }]);
//     await page.touchEnd(1);                             // lift finger 1 only; no argument lifts all
//     await page.touchEnd();
//     await page.penDown(100, 100, { force: .4 }); await page.penMove(120, 110, { force: .9 }); await page.penUp(120, 110);
//     await page.mouseDown(50, 50); await page.mouseMove(60, 60); await page.mouseUp(60, 60);
//     await page.wheel(200, 300, 0, 120, { ctrl: true });
//     await page.key('z', { ctrl: true });
//     await page.setLang('en');                           // the real language button, so lang.js runs and saves it
//     await page.screenshot('C:/.../scratch/me/a.png');
//     const { pages } = await page.printPDF('C:/.../scratch/me/a.pdf', { printBackground: true });
//     await page.throttle(6);
//     console.log(page.consoleErrors());
//   } finally { await page.close(); }                     // kills only the browser this launch() spawned
//
// Rules: pass a profileDir of your own in your scratch folder (the user's real profile is refused). The cache is
// off so edits show up; launch({ cache: true }) keeps it. Anything not wrapped here: page.send('Domain.method', params).
// Facts checked against real Chrome: touchCancel() produces a real pointercancel. CDP cannot produce a pen barrel or
// eraser button (buttons 32 is dropped), so use page.synthPointer() for those. printPDF fires beforeprint and afterprint.
// This laptop has a touch screen, so maxTouchPoints is 10 and (any-pointer:coarse) is true even with touch: false;
// (pointer:coarse) is true only with touch: true.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const BROWSERS = {
  chrome: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'],
  edge: ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'],
};
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
const KEYS = {
  ' ': { key: ' ', code: 'Space', vk: 32, text: ' ' }, Space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' }, Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 }, Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 }, ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 }, ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  Control: { key: 'Control', code: 'ControlLeft', vk: 17 }, Shift: { key: 'Shift', code: 'ShiftLeft', vk: 16 },
  Alt: { key: 'Alt', code: 'AltLeft', vk: 18 }, Meta: { key: 'Meta', code: 'MetaLeft', vk: 91 },
};

export const sleep = ms => new Promise(r => setTimeout(r, ms));

const modifiers = o => Object.entries(MOD).reduce((m, [k, bit]) => m | (o?.[k] ? bit : 0), o?.modifiers ?? 0);
const mkdirFor = file => fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });

function keyInfo(k) {
  if (KEYS[k]) return KEYS[k];
  if (k.length !== 1) return { key: k, code: k, vk: 0 };
  const up = k.toUpperCase();
  const code = /[a-z]/i.test(k) ? 'Key' + up : /[0-9]/.test(k) ? 'Digit' + k : '';
  return { key: k, code, vk: up.charCodeAt(0), text: k };
}

// One WebSocket to one DevTools target. Every call has a timeout that names the method, so a stuck test says why.
class Cdp {
  #ws; #nextId = 0; #pending = new Map(); #listeners = new Map();

  static async connect(url) {
    const c = new Cdp();
    c.#ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      c.#ws.onopen = resolve;
      c.#ws.onerror = () => reject(new Error('could not connect to ' + url));
    });
    c.#ws.onerror = null;
    c.#ws.onmessage = m => c.#receive(JSON.parse(m.data));
    c.#ws.onclose = () => c.failAll('connection closed');
    return c;
  }

  #receive(msg) {
    if (msg.id !== undefined) {
      const p = this.#pending.get(msg.id);
      if (!p) return;
      this.#pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`CDP ${p.method}: ${msg.error.message}${msg.error.data ? ' (' + msg.error.data + ')' : ''}`));
      else p.resolve(msg.result ?? {});
      return;
    }
    for (const fn of this.#listeners.get(msg.method) ?? []) fn(msg.params ?? {});
  }

  failAll(why) {
    for (const p of this.#pending.values()) { clearTimeout(p.timer); p.reject(new Error(`CDP ${p.method}: ${why}`)); }
    this.#pending.clear();
  }

  send(method, params = {}, { timeoutMs = 60000 } = {}) {
    return new Promise((resolve, reject) => {
      if (this.#ws.readyState !== WebSocket.OPEN) return reject(new Error(`CDP ${method}: connection closed`));
      const id = ++this.#nextId;
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP ${method}: no reply in ${timeoutMs}ms`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, method, timer });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    if (!this.#listeners.has(method)) this.#listeners.set(method, new Set());
    this.#listeners.get(method).add(fn);
    return () => this.#listeners.get(method).delete(fn);
  }

  closeSocket() { try { this.#ws.close(); } catch { /* already gone */ } }
}

class Browser {
  child; port; cdp; profile; tempProfile; stderr = ''; pages = new Set();
  get alive() { return this.child.exitCode === null && this.child.signalCode === null; }

  killNow() {
    if (!this.alive) return;
    // Our own process tree by PID, never by image name, so the user's own browser windows are safe.
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(this.child.pid), '/T', '/F'], { stdio: 'ignore' });
    else this.child.kill('SIGKILL');
  }

  async shutdown() {
    live.delete(this);
    for (const p of this.pages) p.cdp.closeSocket();
    try { await this.cdp.send('Browser.close', {}, { timeoutMs: 3000 }); } catch { /* it may close before replying */ }
    this.cdp.closeSocket();
    const until = Date.now() + 5000;
    while (this.alive && Date.now() < until) await sleep(50);
    this.killNow();
    if (this.tempProfile) fs.rmSync(this.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

const live = new Set();
let exitHook = false;
function installExitHook() {
  if (exitHook) return;
  exitHook = true;
  process.on('exit', () => { for (const b of live) b.killNow(); });
}

class Page {
  #view; #media = ''; #features = {};
  #touches = new Map(); #mouseButtons = 0; #penButtons = 0; #messages = []; #inFlight = new Map();
  crashed = false;

  constructor(cdp, browser, targetId, isMain) {
    this.cdp = cdp;
    this.browser = browser;
    this.targetId = targetId;
    this.isMain = isMain;
  }

  async _init(view) {
    this.cdp.on('Runtime.exceptionThrown', ({ exceptionDetails: d }) =>
      this.#record('error', 'exception: ' + (d.exception?.description || d.exception?.value || d.text)));
    this.cdp.on('Runtime.consoleAPICalled', ({ type, args }) =>
      this.#record(type === 'assert' ? 'error' : type, 'console.' + type + ': ' + args.map(a => a.value ?? a.description ?? a.type).join(' ')));
    // The browser's own favicon request is left out: the dev server has none and the page never asks for it.
    this.cdp.on('Log.entryAdded', ({ entry: e }) => {
      if (!/favicon\.ico$/.test(e.url ?? '')) this.#record(e.level, `${e.source}: ${e.text}${e.url ? ' ' + e.url : ''}`);
    });
    this.cdp.on('Inspector.targetCrashed', () => {
      this.crashed = true;
      this.cdp.failAll('target crashed');
    });
    this.cdp.on('Network.requestWillBeSent', e => this.#inFlight.set(e.requestId, e.request.url));
    this.cdp.on('Network.loadingFinished', e => this.#inFlight.delete(e.requestId));
    this.cdp.on('Network.loadingFailed', e => this.#inFlight.delete(e.requestId));
    await Promise.all(['Page.enable', 'Runtime.enable', 'Log.enable', 'Network.enable', 'Inspector.enable'].map(m => this.send(m)));
    if (!view.cache) await this.send('Network.setCacheDisabled', { cacheDisabled: true });
    await this.setViewport(view);
    // Also makes (pointer:coarse) true. setMedia cannot: Chrome ignores pointer and hover in setEmulatedMedia.
    if (view.touch) await this.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    return this;
  }

  #record(level, text) { this.#messages.push({ level, text }); }

  // ---- basics ----
  send(method, params, opts) { return this.cdp.send(method, params, opts); }
  on(method, fn) { return this.cdp.on(method, fn); }

  // expr: a string, or a function that is called in the page with JSON args. Waits for promises, returns by value.
  async eval(expr, ...args) {
    let opts = {};
    if (typeof expr !== 'function' && args.length && typeof args[0] === 'object') opts = args[0];
    const expression = typeof expr === 'function' ? `(${expr})(...${JSON.stringify(args)})` : String(expr);
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: !!opts.userGesture },
      { timeoutMs: opts.timeoutMs ?? 30000 });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      const why = d.exception?.description || d.exception?.value || d.text;
      throw new Error(`eval failed: ${why}\n  in: ${expression.slice(0, 300)}`);
    }
    return r.result.value;
  }

  #waitEvent(method, timeoutMs, what) {
    let off, timer;
    const promise = new Promise((resolve, reject) => {
      off = this.on(method, resolve);
      timer = setTimeout(() => reject(new Error(`${what}: no ${method} in ${timeoutMs}ms. Still loading: ${[...this.#inFlight.values()].slice(-5).join(', ') || 'nothing'}`)), timeoutMs);
    });
    promise.catch(() => {});
    const done = () => { off(); clearTimeout(timer); };
    promise.finally(done).catch(() => {});
    return { promise, cancel: done };
  }

  async goto(url, { timeoutMs = 30000 } = {}) {
    this.crashed = false;
    this.#touches.clear(); this.#mouseButtons = 0; this.#penButtons = 0; this.#inFlight.clear();
    const load = this.#waitEvent('Page.loadEventFired', timeoutMs, 'goto ' + url);
    const r = await this.send('Page.navigate', { url }, { timeoutMs });
    if (r.errorText) { load.cancel(); throw new Error(`goto ${url}: ${r.errorText}`); }
    if (!r.loaderId) { load.cancel(); return; } // same document, for example a hash change: no load event comes
    await load.promise;
  }

  async reload({ timeoutMs = 30000 } = {}) {
    const load = this.#waitEvent('Page.loadEventFired', timeoutMs, 'reload');
    await this.send('Page.reload', { ignoreCache: true });
    await load.promise;
  }

  async waitFor(expr, { timeoutMs = 5000, intervalMs = 50 } = {}) {
    const until = Date.now() + timeoutMs;
    let last;
    while (Date.now() < until) {
      last = await this.eval(expr);
      if (last) return last;
      await sleep(intervalMs);
    }
    throw new Error(`waitFor timed out after ${timeoutMs}ms (last value ${JSON.stringify(last)}): ${String(expr).slice(0, 200)}`);
  }

  // Waits n animation frames. Gives up after a second, because rAF stops in hidden pages.
  frames(n = 2) {
    return this.eval(`new Promise(done => { let k = ${n}; const tick = () => --k > 0 ? requestAnimationFrame(tick) : done(true);
      requestAnimationFrame(tick); setTimeout(() => done(false), 1000); })`);
  }

  onNewDocument(source) { return this.send('Page.addScriptToEvaluateOnNewDocument', { source }); }
  throttle(rate) { return this.send('Emulation.setCPUThrottlingRate', { rate }); }
  block(patterns = []) { return this.send('Network.setBlockedURLs', { urls: patterns }); }

  // A second tab in the same browser and profile, in its own window so its rAF runs. Inherits this view.
  async newPage(view = {}) {
    const { targetId } = await this.browser.cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true });
    return openPage(this.browser, targetId, { ...this.#view, ...view }, false);
  }

  // ---- view ----
  async setViewport({ width, height, dsf, mobile, orientation } = {}) {
    this.#view = { ...this.#view, ...(width && { width }), ...(height && { height }), ...(dsf && { dsf }), ...(mobile !== undefined && { mobile }) };
    const v = this.#view;
    const params = { width: v.width, height: v.height, deviceScaleFactor: v.dsf, mobile: !!v.mobile };
    if (orientation) params.screenOrientation = orientation === 'landscape' ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 };
    await this.send('Emulation.setDeviceMetricsOverride', params);
  }

  // setMedia({ media: 'print' | 'screen' | '', features: { 'prefers-reduced-motion': 'reduce' } }). Merges with earlier calls.
  async setMedia({ media, features } = {}) {
    if (media !== undefined) this.#media = media;
    if (features) Object.assign(this.#features, features);
    await this.send('Emulation.setEmulatedMedia', {
      media: this.#media,
      features: Object.entries(this.#features).map(([name, value]) => ({ name, value })),
    });
  }

  async setLang(lang) {
    const now = await this.eval(l => {
      const b = document.querySelector(`[data-set-lang="${l}"]`);
      if (b) b.click();
      else { document.documentElement.setAttribute('data-lang', l); document.documentElement.setAttribute('lang', l); }
      return document.documentElement.getAttribute('data-lang');
    }, lang);
    if (now !== lang) throw new Error(`setLang(${lang}): page is still ${now}. Did lang.js run?`);
    await this.frames(2);
  }

  // ---- touch: points are { x, y, id?, force?, radiusX?, radiusY? }, or an array of them ----
  #touchList() { return [...this.#touches].map(([id, p]) => ({ ...p, id })); }
  #freeId() { let id = 0; while (this.#touches.has(id)) id++; return id; }

  touchStart(points) {
    for (const p of [points].flat()) this.#touches.set(p.id ?? this.#freeId(), p);
    return this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this.#touchList() });
  }

  touchMove(points) {
    for (const p of [points].flat()) {
      const id = p.id ?? (this.#touches.size === 1 ? [...this.#touches.keys()][0] : 0);
      if (!this.#touches.has(id)) throw new Error(`touchMove: finger ${id} is not down`);
      this.#touches.set(id, { ...this.#touches.get(id), ...p });
    }
    return this.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.#touchList() });
  }

  // touchEnd() lifts every finger; touchEnd(id) or touchEnd([ids]) lifts only those while the others stay down.
  touchEnd(ids) {
    const lifting = ids === undefined ? this.#touchList() : [ids].flat().map(id => {
      if (!this.#touches.has(id)) throw new Error(`touchEnd: finger ${id} is not down`);
      return { ...this.#touches.get(id), id };
    });
    for (const p of lifting) this.#touches.delete(p.id);
    return this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: ids === undefined ? [] : lifting });
  }

  touchCancel() {
    this.#touches.clear();
    return this.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  }

  // ---- pen: real pen pointer events, e.pressure comes from force ----
  #pen(type, x, y, o = {}) {
    const { force = 0.5, tiltX = 0, tiltY = 0, twist = 0 } = o;
    return this.send('Input.dispatchMouseEvent', {
      type, x, y, pointerType: 'pen', force, tiltX, tiltY, twist, modifiers: modifiers(o),
      button: o.button ?? (this.#penButtons || type !== 'mouseMoved' ? 'left' : 'none'),
      buttons: o.buttons ?? this.#penButtons,
      clickCount: type === 'mouseMoved' ? 0 : 1,
    });
  }
  penDown(x, y, o = {}) { this.#penButtons = o.buttons ?? 1; return this.#pen('mousePressed', x, y, o); }
  penMove(x, y, o = {}) { return this.#pen('mouseMoved', x, y, o); }
  penHover(x, y, o = {}) { return this.#pen('mouseMoved', x, y, { force: 0, ...o, button: 'none', buttons: 0 }); }
  penUp(x, y, o = {}) { this.#penButtons = 0; return this.#pen('mouseReleased', x, y, { force: 0, ...o, buttons: 0 }); }

  // ---- mouse ----
  mouseMove(x, y, o = {}) {
    const pressed = { 1: 'left', 2: 'right', 4: 'middle' }[this.#mouseButtons] ?? 'none';
    return this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: pressed, buttons: this.#mouseButtons, modifiers: modifiers(o) });
  }
  mouseDown(x, y, { button = 'left', clickCount = 1, ...o } = {}) {
    this.#mouseButtons |= { left: 1, right: 2, middle: 4 }[button] ?? 0;
    return this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: this.#mouseButtons, clickCount, modifiers: modifiers(o) });
  }
  mouseUp(x, y, { button = 'left', clickCount = 1, ...o } = {}) {
    this.#mouseButtons &= ~({ left: 1, right: 2, middle: 4 }[button] ?? 0);
    return this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: this.#mouseButtons, clickCount, modifiers: modifiers(o) });
  }
  async click(x, y, o = {}) { await this.mouseMove(x, y, o); await this.mouseDown(x, y, o); await this.mouseUp(x, y, o); }
  // Deltas are CSS px: CDP reads them as device px, so without this a dsf 2 page would see half the scroll.
  wheel(x, y, deltaX, deltaY, o = {}) {
    const { dsf = 1 } = this.#view;
    return this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: deltaX * dsf, deltaY: deltaY * dsf, modifiers: modifiers(o) });
  }

  // kind 'touch' | 'pen' | 'mouse', pts [{x, y, force?}]. Down, moves with a pause between them, up.
  async stroke(kind, pts, { stepMs = 16, ...o } = {}) {
    const [first, ...rest] = pts;
    const last = pts[pts.length - 1];
    if (kind === 'touch') await this.touchStart({ ...first, ...o });
    if (kind === 'pen') await this.penDown(first.x, first.y, { ...o, ...first });
    if (kind === 'mouse') await this.mouseDown(first.x, first.y, o);
    for (const p of rest) {
      if (stepMs) await sleep(stepMs);
      if (kind === 'touch') await this.touchMove({ ...p, ...o });
      if (kind === 'pen') await this.penMove(p.x, p.y, { ...o, ...p });
      if (kind === 'mouse') await this.mouseMove(p.x, p.y, o);
    }
    if (kind === 'touch') await this.touchEnd();
    if (kind === 'pen') await this.penUp(last.x, last.y, o);
    if (kind === 'mouse') await this.mouseUp(last.x, last.y, o);
  }

  // A scripted PointerEvent on an element, for what CDP cannot make: barrel and eraser buttons (buttons 32, button 5).
  synthPointer(selector, type, init = {}) {
    return this.eval((sel, ty, ini) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error('synthPointer: no element ' + sel);
      return el.dispatchEvent(new PointerEvent(ty, { bubbles: true, cancelable: true, composed: true, pointerId: 1, ...ini }));
    }, selector, type, init);
  }

  // ---- keys: key('z', { ctrl: true }), key('Enter'), keyDown(' ') ... keyUp(' ') for Space+drag ----
  keyDown(k, o = {}) {
    const { key, code, vk, text } = keyInfo(k);
    const m = modifiers(o);
    const typed = text && !(m & (MOD.ctrl | MOD.meta | MOD.alt));
    return this.send('Input.dispatchKeyEvent', { type: typed ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: m, ...(typed && { text, unmodifiedText: text }) });
  }
  keyUp(k, o = {}) {
    const { key, code, vk } = keyInfo(k);
    return this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: modifiers(o) });
  }
  async key(k, o = {}) { await this.keyDown(k, o); await this.keyUp(k, o); }

  // ---- output ----
  // Options: clip {x, y, width, height}, fullPage (the whole document, not just the viewport).
  async screenshot(file, { clip, fullPage = false } = {}) {
    const params = { format: 'png' };
    if (fullPage) {
      const { cssContentSize: s } = await this.send('Page.getLayoutMetrics');
      clip = { x: 0, y: 0, width: s.width, height: s.height };
    }
    if (clip) { params.clip = { scale: 1, ...clip }; params.captureBeyondViewport = true; }
    const { data } = await this.send('Page.captureScreenshot', params, { timeoutMs: 120000 });
    mkdirFor(file);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }

  // Returns { path, bytes, pages }.
  async printPDF(file, { printBackground = true, ...rest } = {}) {
    const { data } = await this.send('Page.printToPDF', { preferCSSPageSize: true, printBackground, ...rest }, { timeoutMs: 120000 });
    const buf = Buffer.from(data, 'base64');
    mkdirFor(file);
    fs.writeFileSync(file, buf);
    return { path: file, bytes: buf.length, pages: pdfPageCount(buf) };
  }

  // Error-level entries from thrown exceptions, console.error and the browser log (failed requests, for example).
  consoleErrors() { return this.#messages.filter(m => m.level === 'error').map(m => m.text); }
  consoleMessages() { return [...this.#messages]; }
  clearConsole() { this.#messages.length = 0; }

  // The main page (from launch) closes the browser and kills its process. A newPage() closes only its own tab.
  async close() {
    if (this.isMain) return this.browser.shutdown();
    this.browser.pages.delete(this);
    this.cdp.closeSocket();
    await this.browser.cdp.send('Target.closeTarget', { targetId: this.targetId }).catch(() => {});
  }
}

async function openPage(browser, targetId, view, isMain) {
  const cdp = await Cdp.connect(`ws://127.0.0.1:${browser.port}/devtools/page/${targetId}`);
  const page = new Page(cdp, browser, targetId, isMain);
  browser.pages.add(page);
  return page._init(view);
}

async function waitForPort(browser) {
  const file = path.join(browser.profile, 'DevToolsActivePort');
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    if (!browser.alive) throw new Error(`browser exited at once (code ${browser.child.exitCode}). Is ${browser.profile} already open in another browser?\n${browser.stderr.slice(-500)}`);
    try {
      const [port, wsPath] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
      if (port && wsPath) return { port: Number(port), wsPath };
    } catch { /* not written yet */ }
    await sleep(50);
  }
  throw new Error(`no DevToolsActivePort after 30s in ${browser.profile}\n${browser.stderr.slice(-500)}`);
}

// launch({ browser: 'chrome'|'edge', profileDir, width, height, dsf, mobile, touch, cache, args }) resolves to a Page.
// Without profileDir a temp profile is made in $STUDIO_TEST_TMP or the OS temp folder and removed on close.
export async function launch({ browser = 'chrome', profileDir, width = 1280, height = 800, dsf = 1, mobile = false, touch = false, cache = false, args = [] } = {}) {
  const exe = (BROWSERS[browser] ?? []).find(p => fs.existsSync(p));
  if (!exe) throw new Error(`launch: cannot find browser "${browser}". Known: ${JSON.stringify(BROWSERS)}`);
  const profile = profileDir ? path.resolve(profileDir) : fs.mkdtempSync(path.join(process.env.STUDIO_TEST_TMP || os.tmpdir(), 'studio-cdp-'));
  if (/[\\/](Google[\\/]Chrome|Microsoft[\\/]Edge)[\\/]User Data/i.test(profile)) throw new Error('launch: refusing the real browser profile ' + profile);
  fs.mkdirSync(profile, { recursive: true });
  fs.rmSync(path.join(profile, 'DevToolsActivePort'), { force: true });

  const b = new Browser();
  b.profile = profile;
  b.tempProfile = !profileDir;
  b.child = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--force-color-profile=srgb', '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--disable-extensions', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    ...args, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  b.child.on('error', () => {});
  b.child.stderr.on('data', d => { b.stderr = (b.stderr + d).slice(-4000); });
  live.add(b);
  installExitHook();

  try {
    const { port, wsPath } = await waitForPort(b);
    b.port = port;
    b.cdp = await Cdp.connect(`ws://127.0.0.1:${port}${wsPath}`);
    const { targetInfos } = await b.cdp.send('Target.getTargets');
    const tab = targetInfos.find(t => t.type === 'page') ?? await b.cdp.send('Target.createTarget', { url: 'about:blank' });
    return await openPage(b, tab.targetId, { width, height, dsf, mobile, touch, cache }, true);
  } catch (err) {
    live.delete(b);
    b.killNow();
    throw err;
  }
}

// Skia writes each page object in plain text, but fall back on the page tree's /Count if that ever changes.
export function pdfPageCount(buf) {
  const text = buf.toString('latin1');
  const objects = (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
  return objects || Math.max(0, ...[...text.matchAll(/\/Count\s+(\d+)/g)].map(m => Number(m[1])));
}

// Decodes an 8-bit non-interlaced PNG, as Page.captureScreenshot makes. Returns { width, height, channels, data }.
export function readPng(fileOrBuffer) {
  const b = Buffer.isBuffer(fileOrBuffer) ? fileOrBuffer : fs.readFileSync(fileOrBuffer);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('readPng: not a PNG');
  let off = 8, width, height, depth, colorType, interlace;
  const idat = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('latin1', off + 4, off + 8);
    const chunk = b.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); depth = chunk[8]; colorType = chunk[9]; interlace = chunk[12]; }
    if (type === 'IDAT') idat.push(chunk);
    if (type === 'IEND') break;
    off += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (depth !== 8 || interlace || !channels) throw new Error(`readPng: unsupported PNG (depth ${depth}, color ${colorType}, interlace ${interlace})`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = y * (stride + 1) + 1;
    const out = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? data[out + x - channels] : 0;
      const u = y ? data[out - stride + x] : 0;
      const c = x >= channels && y ? data[out - stride + x - channels] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = u;
      else if (filter === 3) pred = (a + u) >> 1;
      else if (filter === 4) {
        const p = a + u - c, pa = Math.abs(p - a), pb = Math.abs(p - u), pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? u : c;
      }
      data[out + x] = (raw[row + x] + pred) & 255;
    }
  }
  return { width, height, channels, data };
}

// Compares two PNGs pixel by pixel. Returns { same, sizeMatch, width, height, diffPixels, bbox }, bbox as [x0, y0, x1, y1].
// Reload and compare again before believing a small difference: about once in 80 loads of a tall page, one raster
// tile came out with faint anti-aliasing noise on otherwise identical text, between loads of identical layout.
export function pngDiff(fileA, fileB, { tolerance = 0 } = {}) {
  const bufA = Buffer.isBuffer(fileA) ? fileA : fs.readFileSync(fileA);
  const bufB = Buffer.isBuffer(fileB) ? fileB : fs.readFileSync(fileB);
  if (bufA.equals(bufB)) return { same: true, sizeMatch: true, width: bufA.readUInt32BE(16), height: bufA.readUInt32BE(20), diffPixels: 0, bbox: null };
  const a = readPng(bufA), b = readPng(bufB);
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) {
    return { same: false, sizeMatch: false, width: a.width, height: a.height, otherWidth: b.width, otherHeight: b.height, diffPixels: -1, bbox: null };
  }
  let diffPixels = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  const ch = a.channels;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * ch;
      let differs = false;
      for (let k = 0; k < ch; k++) if (Math.abs(a.data[i + k] - b.data[i + k]) > tolerance) differs = true;
      if (differs) {
        diffPixels++;
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
      }
    }
  }
  return { same: diffPixels === 0, sizeMatch: true, width: a.width, height: a.height, diffPixels, bbox: diffPixels ? [x0, y0, x1, y1] : null };
}
