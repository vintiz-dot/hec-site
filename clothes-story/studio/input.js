// The gesture state machine of section 5.2. Client px stop here: callbacks only ever see sheet-px Points.
// Ages come from e.timeStamp, not from when the handler ran, so a busy phone still classifies two fingers correctly.
import { LIMITS } from './constants.js?v=1';
import { emit } from './bus.js?v=1';
import * as card from './card.js?v=1';
import { log } from './diag.js?v=1';
import * as shell from './shell.js?v=1';
import * as state from './state.js?v=1';
import * as undo from './undo.js?v=1';
import * as viewport from './viewport.js?v=1';

const IDLE = 'IDLE', INK = 'INK', GUARD = 'GUARD', NAV1 = 'NAV1', NAV = 'NAV', LOCKOUT = 'LOCKOUT';
const BIG_DW = 50, BIG_DH = 120;
const PEN_GAMMA = .7, PEN_NO_PRESSURE = .5;
const SPEED_FOR_THINNEST = 1.6, THINNEST = .35, SPEED_EMA = .25; // sheet px per ms
const LINE_PX = 16;
const WHEEL_END_MS = 150, WHEEL_ZOOM_PER_PX = .006, WHEEL_ZOOM_MAX_STEP = 40;
const NONPASSIVE = { passive: false };

let pageEl = null, cb = null;
let unlisten = [];
let resizeObserver = null;
let mode = IDLE;
const pointers = new Map(); // id -> { type, x0, y0, t0, moved, ignored, x, y, v, downPt, ... }
let active = null;   // the pointer that inks or pans
let stray = null;    // GUARD: the contact that may yet turn into a gesture
let pair = null;     // NAV: the two fingers that drive pinch and pan
let panning = false; // NAV1: past the slop
let spaceHeld = false;
let lastPen = -Infinity, penTimer = 0;
let refitPending = false;
let wheelOn = false, wheelTimer = 0;
let lastW = 0, lastH = 0;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const prevent = e => e.preventDefault();

function inPenMode() {
  const on = performance.now() - lastPen < LIMITS.penModeMs;
  state.set('penMode', on);
  return on;
}

function isIOS() {
  const ua = navigator.userAgent;
  return /iP(hone|ad|od)/.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1);
}

function inEdgeBand(e) {
  const b = LIMITS.edgePx;
  return e.clientX < b || e.clientY < b || e.clientX > innerWidth - b || e.clientY > innerHeight - b;
}

// One throwing callback must not leave the machine stuck in INK with no way back.
function call(name, ...args) {
  try {
    cb?.[name]?.(...args);
  } catch (err) {
    log('input', `${name}: ${err.message}`);
  }
}

function markPen() {
  lastPen = performance.now();
  state.set('penMode', true);
  clearTimeout(penTimer);
  penTimer = setTimeout(() => state.set('penMode', false), LIMITS.penModeMs);
}

function makePoint(ev, p) {
  const { x, y } = viewport.toSheet(ev.clientX, ev.clientY);
  const t = ev.timeStamp;
  let pressure;
  if (p.type === 'pen') {
    pressure = ev.pressure > 0 ? ev.pressure ** PEN_GAMMA : PEN_NO_PRESSURE;
  } else {
    const dt = t - p.lastT;
    if (dt > 0) p.v += (Math.hypot(x - p.lastX, y - p.lastY) / dt - p.v) * SPEED_EMA;
    if (dt > 0 || p.lastT === undefined) { p.lastX = x; p.lastY = y; p.lastT = t; }
    pressure = clamp(1 - p.v / SPEED_FOR_THINNEST, THINNEST, 1);
  }
  return { x, y, p: pressure, t, type: p.type };
}

// Firefox on Android returns an empty list, so fall back on the event itself.
function pointsFrom(e, p) {
  const list = e.getCoalescedEvents?.();
  return (list?.length ? list : [e]).map(ev => makePoint(ev, p));
}

function track(p, e) {
  p.x = e.clientX;
  p.y = e.clientY;
  p.moved = Math.max(p.moved, Math.hypot(p.x - p.x0, p.y - p.y0));
}

function pairGeometry() {
  const a = pointers.get(pair[0]), b = pointers.get(pair[1]);
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
}

function startInk(id, p, e, opts = {}) {
  mode = INK;
  active = id;
  viewport.settle(); // a pen that cuts a gesture short may have just started its spring
  viewport.syncRect();
  p.downPt = makePoint(e, p);
  call('onInkStart', p.downPt, p.type, opts);
}

function enterNav1(id, p, e) {
  mode = NAV1;
  active = id;
  panning = false;
  viewport.syncRect();
  p.downPt = makePoint(e, p);
}

function enterNav(a, b) {
  mode = NAV;
  pair = [a, b];
  active = stray = null;
  panning = false;
  viewport.syncRect();
  viewport.beginGesture();
  const { cx, cy, d } = pairGeometry();
  viewport.pinchStart(cx, cy, d);
}

function leaveInk() {
  if (stray !== null && pointers.has(stray)) pointers.get(stray).ignored = true;
  mode = IDLE;
  active = stray = null;
}

function leaveNav1(p) {
  if (panning) {
    viewport.endGesture();
    if (p.type === 'mouse') call('onSpace', spaceHeld, false);
  }
  mode = IDLE;
  active = null;
  panning = false;
}

const finishByRule = (p, now) => call(now - p.t0 < LIMITS.cancelMaxMs ? 'onInkCancel' : 'onInkEnd');

// Every path that ends a pointer lands here. Only when the last one is gone can LOCKOUT end or a held-back refit run.
function settleIfEmpty() {
  if (pointers.size) return;
  if (mode === LOCKOUT) mode = IDLE;
  if (refitPending) {
    refitPending = false;
    viewport.refit();
  }
}

function secondTouch(id, e) {
  const first = pointers.get(active);
  const age = e.timeStamp - first.t0;
  if (age < LIMITS.cancelMaxMs) {
    call('onInkCancel');
    enterNav(active, id);
  } else if (first.moved < LIMITS.tapMaxPx && age > LIMITS.restMinMs) {
    call('onInkCancel'); // a resting thumb: its dot goes, and the new finger is the one that draws
    first.ignored = true;
    startInk(id, pointers.get(id), e);
  } else {
    mode = GUARD;
    stray = id;
  }
}

function touchDown(id, p, e) {
  if (mode === IDLE) {
    if (inEdgeBand(e)) p.ignored = true;
    else if (inPenMode()) enterNav1(id, p, e);
    else startInk(id, p, e);
  } else if (mode === INK) {
    if (pointers.get(active).type === 'touch') secondTouch(id, e);
    else p.ignored = true;
  } else if (mode === GUARD) {
    call('onInkEnd');
    enterNav(active, stray);
  } else if (mode === NAV1) {
    if (pointers.get(active).type === 'touch') enterNav(active, id);
    else p.ignored = true;
  } else if (mode === LOCKOUT) {
    p.ignored = true;
  } // NAV: a third finger takes no part in the pinch, but its lift still ends the gesture
}

function mouseDown(id, p, e) {
  if (mode !== IDLE) p.ignored = true;
  else if (spaceHeld) enterNav1(id, p, e);
  else startInk(id, p, e);
}

function penDown(id, p, e) {
  markPen();
  const penInking = mode === INK && pointers.get(active).type === 'pen';
  if (mode === LOCKOUT || penInking) {
    p.ignored = true;
    return;
  }
  if (mode === GUARD || (mode === INK && pointers.get(active).type === 'touch')) call('onInkCancel');
  else if (mode === INK) call('onInkEnd');
  else if (mode === NAV1 && panning) viewport.endGesture();
  else if (mode === NAV) viewport.endGesture();
  for (const [other, q] of pointers) if (other !== id) q.ignored = true;
  stray = pair = null;
  panning = false;
  const eraser = (e.buttons & 32) !== 0 || e.button === 5;
  startInk(id, p, e, eraser ? { eraserOverride: true } : {});
}

// A primary touch means the browser sees no other finger down, so anything we still track lost its up somewhere.
function purgeStale(e, type) {
  if (pointers.has(e.pointerId)) lost(e.pointerId, e.timeStamp);
  if (type === 'mouse' || e.isPrimary !== true) return;
  for (const [id, p] of [...pointers]) if (p.type === type) lost(id, e.timeStamp);
}

function onPointerDown(e) {
  const type = e.pointerType === 'pen' || e.pointerType === 'touch' ? e.pointerType : 'mouse';
  if (type === 'mouse' && e.button !== 0) return;
  endWheel();
  viewport.settle();
  purgeStale(e, type);
  const id = e.pointerId;
  const p = { type, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, moved: 0, ignored: false, x: e.clientX, y: e.clientY, v: 0, downPt: null };
  pointers.set(id, p);
  try {
    pageEl.setPointerCapture(id);
  } catch { /* the pointer is already gone, or scripted in a test */ }
  emit('input:down', { type });
  if (type === 'pen') penDown(id, p, e);
  else if (type === 'mouse') mouseDown(id, p, e);
  else touchDown(id, p, e);
}

function moveNav1(p) {
  if (!panning) {
    if (p.moved <= LIMITS.panStartPx) return;
    panning = true;
    viewport.beginGesture();
    if (p.type === 'mouse') call('onSpace', spaceHeld, true);
  } else {
    viewport.panBy(p.x - p.panX, p.y - p.panY);
  }
  p.panX = p.x; // from where the slop ended, so the page does not jump by 12px
  p.panY = p.y;
}

// A mouse that lost its left button, or a pen with no buttons, is not in contact, whatever we were told before.
function missedUp(p, e) {
  if (p.type === 'mouse') return (e.buttons & 1) === 0;
  return p.type === 'pen' && e.buttons === 0;
}

function onPointerMove(e) {
  const id = e.pointerId;
  const p = pointers.get(id);
  if (!p) {
    if ((e.pointerType === 'mouse' || e.pointerType === 'pen') && e.buttons === 0) call('onHover', e.clientX, e.clientY, e.pointerType);
    return;
  }
  if (missedUp(p, e)) { release(id, e); return; }
  track(p, e);
  if (p.ignored) return;
  if ((mode === INK || mode === GUARD) && id === active) {
    const pts = pointsFrom(e, p);
    p.sent = pts[pts.length - 1];
    call('onInkMove', pts);
  } else if (mode === GUARD && id === stray) {
    if (p.moved > LIMITS.strayPx) {
      call('onInkEnd');
      enterNav(active, stray);
    }
  } else if (mode === NAV1 && id === active) {
    moveNav1(p);
  } else if (mode === NAV && pair.includes(id)) {
    const { cx, cy, d } = pairGeometry();
    viewport.pinchMove(cx, cy, d);
  }
}

function endInkAt(p, e) {
  const last = p.sent ?? p.downPt;
  const now = makePoint(e, p);
  if (last && (now.x !== last.x || now.y !== last.y)) call('onInkMove', [now]);
  call('onInkEnd', { lifted: true }); // only here: every other commit is the machine ending the press, not the child
}

function release(id, e) {
  const p = pointers.get(id);
  if (!p) return;
  track(p, e);
  pointers.delete(id);
  if (!p.ignored) {
    const tap = p.moved < LIMITS.tapMaxPx && e.timeStamp - p.t0 < LIMITS.tapMaxMs;
    if ((mode === INK || mode === GUARD) && id === active) {
      if (tap) call('onTap', p.downPt);
      else endInkAt(p, e);
      leaveInk();
    } else if (mode === GUARD && id === stray) {
      stray = null;
      mode = INK;
    } else if (mode === NAV1 && id === active) {
      const wasPan = panning;
      leaveNav1(p);
      if (!wasPan && tap) call('onTap', p.downPt);
    } else if (mode === NAV) {
      viewport.endGesture();
      mode = LOCKOUT;
      pair = null;
    }
  }
  settleIfEmpty();
}

// pointercancel, lostpointercapture and purges: no up came, so there is no tap to read from this.
function lost(id, now) {
  const p = pointers.get(id);
  if (!p) return;
  pointers.delete(id);
  if (!p.ignored) {
    if ((mode === INK || mode === GUARD) && id === active) {
      finishByRule(p, now);
      leaveInk();
    } else if (mode === GUARD && id === stray) {
      stray = null;
      mode = INK;
    } else if (mode === NAV1 && id === active) {
      leaveNav1(p);
    } else if (mode === NAV) {
      viewport.endGesture();
      mode = LOCKOUT;
      pair = null;
    }
  }
  settleIfEmpty();
}

const onPointerUp = e => release(e.pointerId, e);
const onPointerLost = e => lost(e.pointerId, e.timeStamp);

function onPointerLeave(e) {
  if (!pointers.has(e.pointerId) && e.pointerType !== 'touch') call('onLeave');
}

// Blur, hidden, rotation, reset, detach: nothing more will arrive for anything we hold.
function abortAll() {
  viewport.settle();
  const p = pointers.get(active);
  if ((mode === INK || mode === GUARD) && p) finishByRule(p, performance.now());
  if (mode === NAV || (mode === NAV1 && panning)) viewport.endGesture();
  pointers.clear();
  mode = IDLE;
  active = stray = pair = null;
  panning = false;
}

function onBlur() {
  setSpace(false);
  abortAll();
  settleIfEmpty();
}

function onVisibility() {
  if (document.visibilityState !== 'hidden') return;
  abortAll();
  settleIfEmpty();
}

function onResize(e) {
  const w = innerWidth, h = innerHeight;
  const big = e.type === 'orientationchange' || Math.abs(w - lastW) > BIG_DW || Math.abs(h - lastH) > BIG_DH;
  lastW = w;
  lastH = h;
  if (big) {
    abortAll();
    refitPending = false;
    viewport.refit();
  } else {
    refitWhenFree();
  }
}

// The URL bar, or the dock changing shape: never worth cutting a stroke for.
function refitWhenFree() {
  if (pointers.size) refitPending = true;
  else viewport.refit();
}

function endWheel() {
  clearTimeout(wheelTimer);
  if (!wheelOn) return;
  wheelOn = false;
  viewport.endGesture();
}

function onWheel(e) {
  e.preventDefault();
  if (mode !== IDLE) return;
  if (!wheelOn) {
    wheelOn = true;
    viewport.beginGesture();
  }
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(endWheel, WHEEL_END_MS);
  const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? pageEl.clientHeight : 1;
  if (e.ctrlKey || e.metaKey) {
    const step = clamp(e.deltaY * unit, -WHEEL_ZOOM_MAX_STEP, WHEEL_ZOOM_MAX_STEP);
    viewport.zoomAt(e.clientX, e.clientY, Math.exp(-step * WHEEL_ZOOM_PER_PX));
  } else {
    const sideways = e.shiftKey && !e.deltaX;
    viewport.panBy(-(sideways ? e.deltaY : e.deltaX) * unit, -(sideways ? 0 : e.deltaY) * unit);
  }
}

// Ctrl+wheel over the dock would zoom the whole browser page and scale the dock with it.
function onWindowWheel(e) {
  if (e.ctrlKey) e.preventDefault();
}

function setSpace(held) {
  if (spaceHeld === held) return;
  spaceHeld = held;
  call('onSpace', held, false);
}

const isSpace = e => e.code === 'Space' || e.key === ' ';
const isTyping = t => !!t?.closest?.('input,textarea,select,[contenteditable]');

// A button clicked with the mouse keeps focus, and Space on it would click it again.
// A button reached with Tab should still work with Space, so only that case is left alone.
function keyboardOnControl(t) {
  try {
    return t.matches(':focus-visible') && !!t.closest('button,a,[role="button"]');
  } catch {
    return false;
  }
}

function run(promise) {
  Promise.resolve(promise).catch(err => log('input', 'key: ' + err.message));
}

function onKeyDown(e) {
  if (e.defaultPrevented || isTyping(e.target) || card.isOpen()) return;
  if (isSpace(e) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (keyboardOnControl(e.target)) return;
    e.preventDefault();
    setSpace(true);
    return;
  }
  if (mode !== IDLE) return;
  const key = (e.key || '').toLowerCase();
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    if (key === 'z') {
      e.preventDefault();
      run(e.shiftKey ? undo.redo() : undo.undo());
    } else if (key === 'y' && e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      run(undo.redo());
    }
    return;
  }
  if (!e.altKey && !e.shiftKey && !e.repeat && /^[1-4]$/.test(key)) run(shell.showPage(Number(key)));
}

function onKeyUp(e) {
  if (!isSpace(e) || !spaceHeld) return;
  e.preventDefault();
  setSpace(false);
}

function listen(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  unlisten.push(() => target.removeEventListener(type, fn, opts));
}

export function attach(el, callbacks) {
  if (pageEl) detach();
  pageEl = el;
  cb = callbacks;
  mode = IDLE;
  lastW = innerWidth;
  lastH = innerHeight;
  listen(el, 'pointerdown', onPointerDown);
  listen(el, 'pointermove', onPointerMove);
  listen(el, 'pointerup', onPointerUp);
  listen(el, 'pointercancel', onPointerLost);
  listen(el, 'lostpointercapture', onPointerLost);
  listen(el, 'pointerleave', onPointerLeave);
  listen(el, 'wheel', onWheel, NONPASSIVE);
  listen(el, 'contextmenu', prevent, NONPASSIVE);
  if (isIOS()) listen(el, 'touchstart', prevent, NONPASSIVE); // stops Apple Pencil Scribble and double-tap zoom
  listen(document, 'gesturestart', prevent, NONPASSIVE);
  listen(document, 'gesturechange', prevent, NONPASSIVE);
  listen(window, 'wheel', onWindowWheel, NONPASSIVE);
  listen(window, 'keydown', onKeyDown);
  listen(window, 'keyup', onKeyUp);
  listen(window, 'blur', onBlur);
  // Captured on window so a stroke is committed before store.js, listening on document, flushes the page to disk.
  listen(window, 'visibilitychange', onVisibility, { capture: true });
  listen(window, 'resize', onResize);
  listen(window, 'orientationchange', onResize);
  if (window.ResizeObserver) { // the dock changing shape moves the free rect without a window resize
    resizeObserver = new ResizeObserver(refitWhenFree);
    resizeObserver.observe(el);
  }
}

export function detach() {
  if (!pageEl) return;
  abortAll();
  endWheel();
  setSpace(false);
  resizeObserver?.disconnect();
  resizeObserver = null;
  for (const off of unlisten) off();
  unlisten = [];
  clearTimeout(penTimer);
  lastPen = -Infinity;
  state.set('penMode', false);
  refitPending = false;
  pageEl = cb = null;
}

export function reset() {
  abortAll();
  settleIfEmpty();
}

// For tests and ?diag=1. Reads only.
export function peek() {
  const inkType = mode === INK ? pointers.get(active)?.type : null;
  return {
    state: inkType ? `INK(${inkType})` : mode,
    active, stray, pair: pair && [...pair], panning, spaceHeld, refitPending,
    pointers: [...pointers].map(([id, p]) => ({ id, type: p.type, moved: p.moved, ignored: p.ignored })),
  };
}
