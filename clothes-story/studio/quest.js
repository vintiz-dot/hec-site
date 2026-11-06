// The Next Star (section 2.5) and the wordless first run: the ghost crayon and the small hints, each played once.
import { BLANK_IDS, BOXES, QUEST, TOOLS } from './constants.js?v=1';
import { emit, on } from './bus.js?v=1';
import { log } from './diag.js?v=1';
import * as coach from './coach.js?v=1';
import * as dock from './dock.js?v=1';
import * as fields from './fields.js?v=1';
import * as fx from './fx.js?v=1';
import * as shell from './shell.js?v=1';
import * as state from './state.js?v=1';
import * as stickers from './stickers.js?v=1';
import * as store from './store.js?v=1';
import * as targets from './targets.js?v=1';
import * as viewport from './viewport.js?v=1';

const FIRST_BOX = 'p1-uniform';
const STEPS_ON_PAGE = {
  1: ['p1-name', 'box:p1-uniform', 'box:p1-weekend', 'line'],
  3: [...BLANK_IDS, 'speech'],
};
const SEEN_FIT_MS = 800;
const GHOST_AFTER_ZOOM_MS = 1000;
const GHOST_AFTER_FIT_MS = 1000;
const STAR_IDLE_MS = 8000;
const HINT_IDLE_MS = 20000;
const STICKERS_AFTER = 3; // strokes
const BECKON_AGAIN_MS = 2600;

let done = new Set();
let firstRun = false;
let lureOn = false;
let offs = [];
let timers = [];
let starTimer = 0, hintTimer = 0;
let strokes = 0;
let starPulsed = false, hintPlayed = false;
let ghostAlive = false;
let refreshQueued = false;

const reducedMotion = () => matchMedia('(prefers-reduced-motion:reduce)').matches;
const isPhone = () => (document.getElementById('studio-ui')?.dataset.layout ?? '').startsWith('phone');

export function isDone(step) {
  if (step.startsWith('coach:')) return coach.isDone(step.slice(6));
  if (step.startsWith('box:')) return !!targets.hasInk(step.slice(4));
  if (step === 'line' || step === 'speech' || step === 'record') return done.has(step);
  return !!fields.isFilled(step);
}

export function next() {
  return coach.weave(QUEST).find(step => !isDone(step)) ?? null;
}

export function pageDone(n) {
  const steps = STEPS_ON_PAGE[n];
  return !!steps && steps.every(isDone);
}

export function refresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(() => {
    refreshQueued = false;
    emit('quest:change', { next: next() });
  });
}

// Marks a step that no field or pixel can prove: the washing line, the speech, the record page.
export function mark(step) {
  if (done.has(step)) return;
  done.add(step);
  store.saveMeta({ questDone: [...done] });
  refresh();
}

function goBox(id) {
  if (TOOLS[state.get('tool')]?.kind !== 'brush') state.set('tool', state.get('lastDraw') || 'crayon');
  if (state.get('box') === id) ghost(id);
  else shell.enterBox(id);
}

export async function go() {
  killHints();
  const step = next();
  if (!step) { // all done: a treat, never silence
    const star = document.querySelector('.st-star')?.getBoundingClientRect();
    if (star) fx.sparkle(star.left + star.width / 2, star.top + star.height / 2);
    dock.pulse('star');
    return step;
  }
  if (step.startsWith('coach:')) {
    coach.open(step.slice(6));
  } else if (step.startsWith('box:')) {
    goBox(step.slice(4));
  } else if (step === 'line') {
    if (!await shell.openLine()) { // nothing to hang yet, or it cannot open here: skip it rather than stick on it
      done.add('line');
      return go();
    }
  } else if (step === 'speech') {
    coach.rehearse();
  } else if (step === 'record') {
    await shell.goRecord();
  } else {
    const target = targets.get(step);
    await shell.showPage(target?.sheet ?? 3);
    fields.open(step);
  }
  return step;
}

// ---- wordless hints ----

function squiggle(boxId) {
  const r = BOXES[boxId].rect;
  const cx = r.x + r.w / 2, cy = r.y + r.h * .42;
  const width = r.w * .56, height = r.h * .09;
  const points = [];
  for (let i = 0; i <= 28; i++) {
    const k = i / 28;
    const c = viewport.toClient(cx - width / 2 + width * k, cy + Math.sin(k * Math.PI * 3.5) * height);
    points.push({ x: c.x, y: c.y });
  }
  return points;
}

async function ghost(boxId) {
  if (reducedMotion() || ghostAlive || state.get('page') !== BOXES[boxId].sheet) return;
  ghostAlive = true;
  try {
    await fx.ghostCrayon(squiggle(boxId));
  } catch (err) {
    log('quest', 'ghost: ' + err.message);
  }
  ghostAlive = false;
}

function later(ms, fn) {
  const timer = setTimeout(fn, ms);
  timers.push(timer);
  return timer;
}

function killIntro() {
  for (const timer of timers) clearTimeout(timer);
  timers = [];
  shell.hintBox(null);
}

function introPhone() {
  later(SEEN_FIT_MS, () => {
    shell.enterBox(FIRST_BOX);
    later(GHOST_AFTER_ZOOM_MS, () => ghost(FIRST_BOX));
  });
}

function introBig() {
  shell.hintBox(FIRST_BOX);
  later(GHOST_AFTER_FIT_MS, () => ghost(FIRST_BOX));
}

// ---- the T-shirt, so the gasp is two taps from opening: this sticker, then denim ----

export function endLure() {
  if (!lureOn) return;
  lureOn = false;
  shell.setLure(null);
  store.saveMeta({ lureDone: true });
}

function tapLure() {
  endLure();
  stickers.arm('tshirt');
  dock.pulse('denim');
  later(BECKON_AGAIN_MS, () => { if (stickers.isPlacing()) dock.pulse('denim'); });
}

function playHint() {
  const step = next();
  if (!step) return;
  if (step.startsWith('box:') && state.get('page') === BOXES[step.slice(4)].sheet) ghost(step.slice(4));
  else dock.pulse('star');
}

function armIdle() {
  clearTimeout(starTimer);
  clearTimeout(hintTimer);
  if (firstRun && !starPulsed) {
    starTimer = setTimeout(() => {
      starPulsed = true;
      dock.pulse('star');
    }, STAR_IDLE_MS);
  }
  if (!hintPlayed) {
    hintTimer = setTimeout(() => {
      hintPlayed = true;
      playHint();
    }, HINT_IDLE_MS);
  }
}

function killHints() {
  killIntro();
  armIdle();
}

// Any touch anywhere ends the intro and restarts the idle clocks.
function onAnyPress() {
  killHints();
  if (firstRun) store.saveMeta({ introDone: true });
}

function onInkCommit() {
  armIdle();
  refresh();
  if (!firstRun) return;
  strokes++;
  if (strokes === 1) dock.pulse('colors');
  if (strokes === STICKERS_AFTER) dock.pulse('stickers');
}

// quiet: Studio was opened at a box or a blank, so the child already knows what to do.
export function start({ meta = {}, quiet = false } = {}) {
  stop();
  done = new Set(Array.isArray(meta.questDone) ? meta.questDone.filter(s => s === 'line' || s === 'speech' || s === 'record') : []);
  firstRun = !meta.introDone;
  strokes = 0;
  starPulsed = hintPlayed = false;
  offs = [
    on('ink:commit', onInkCommit),
    on('undo:applied', refresh),
    on('field:change', refresh),
    on('box:ink', refresh),
    on('page:shown', refresh),
    on('box:change', () => { if (state.get('box')) killIntro(); }),
    on('sticker:arm', endLure),
    on('box:ink', ({ box, on: inked } = {}) => { if (box === FIRST_BOX && inked) endLure(); }),
  ];
  document.addEventListener('pointerdown', onAnyPress, true);
  refresh();
  lureOn = !meta.lureDone && !targets.hasInk(FIRST_BOX) && !meta.coach?.started;
  if (lureOn) shell.setLure(FIRST_BOX, tapLure);
  armIdle();
  if (firstRun && !quiet && !reducedMotion() && state.get('page') === BOXES[FIRST_BOX].sheet) {
    if (isPhone()) introPhone();
    else introBig();
  } else if (firstRun && isPhone() && !quiet && state.get('page') === BOXES[FIRST_BOX].sheet) {
    shell.enterBox(FIRST_BOX); // reduced motion: same place, no show
  }
  if (firstRun && quiet) store.saveMeta({ introDone: true });
}

export function stop() {
  killIntro();
  lureOn = false;
  shell.setLure(null);
  clearTimeout(starTimer);
  clearTimeout(hintTimer);
  for (const off of offs) off();
  offs = [];
  document.removeEventListener('pointerdown', onAnyPress, true);
}
