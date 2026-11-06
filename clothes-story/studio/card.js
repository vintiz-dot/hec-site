// The Sentence Card: a full-screen sheet outside the scaled stage where a blank gets its answer, from a word chip,
// the handwriting pad or the keyboard. It is rebuilt piece by piece and never while the child is typing.
// Keyboard rules (section 6.5): the field is a plain textarea, its value is written once while it is still detached,
// it is read only in the input event, and focus is never moved by code. A tap on the field is what opens the keyboard.
import { on, emit } from './bus.js?v=1';
import { BLANK_IDS } from './constants.js?v=1';
import { log } from './diag.js?v=1';
import * as fields from './fields.js?v=1';
import { isSafeInk } from './fit.js?v=1';
import { icon } from './icons.js?v=1';
import { applyLabels, t } from './labels.js?v=1';
import * as shell from './shell.js?v=1';
import * as speech from './speech.js?v=1';
import { svg as stickerSvg } from './sticker-art.js?v=1';
import { get as getState } from './state.js?v=1';
import * as viewport from './viewport.js?v=1';
import { chipsFor, SENTENCES } from './words.js?v=1';

const HOST_ID = 'studio-ui';   // print hides it, so the Card can never reach paper
const STYLE_ID = 'studio-card-style';
const FLY_MS = 380;
const SLIDE_MS = 170;
const OPEN_GUARD_MS = 250;     // the tap that opened the Card must not also press what appeared under the finger
const LONG_CHIP = 14;          // characters: this chip takes a whole row
const PARENT_WALK = ['p4-sign', 'p4-date'];
const PAD_FIRST = new Set(['p1-name', 'p3-name', ...PARENT_WALK]);
const SIGN_LINE = new Set(PARENT_WALK);

const TAB_ART = {
  chips: '<svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true" focusable="false" fill="#FFFEFB" stroke="#16224A" stroke-width="3" stroke-linejoin="round"><rect x="3" y="4" width="26" height="11" rx="3"/><rect x="3" y="18" width="16" height="11" rx="3" fill="#FFE500"/></svg>',
  pad: '<svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true" focusable="false" fill="none" stroke="#16224A" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"><path fill="#FFE500" d="M21.5 4.5 27.5 10.5 12 26 4.5 27.5 6 20Z"/><path d="M18 8 24 14"/></svg>',
  type: '<svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true" focusable="false" fill="#FFFEFB" stroke="#16224A" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"><rect x="2.5" y="7" width="27" height="18" rx="4"/><path d="M8 13h.1M13.5 13h.1M19 13h.1M24 13h.1M10 19.5h12"/></svg>',
};
const TAB_LABEL = { chips: 'card.chips', pad: 'card.pad', type: 'card.type' };
const ARROW = {
  prev: '<svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 7 9 16l9 9M10 16h15"/></svg>',
  next: '<svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 7l9 9-9 9M22 16H7"/></svg>',
};
const HINT = '<svg class="c-hint" viewBox="0 0 240 80" aria-hidden="true" focusable="false"><path pathLength="1" d="M8 54C30 8 46 6 46 30S40 72 58 60 86 16 98 30 88 68 110 58 140 22 150 36 146 66 168 56 200 32 232 42"/></svg>';

let root = null;
let ui = null;
let id = null;          // the blank on show
const KEYBOARD_FIRST = new Set(['p1-name', 'p3-name']);
let tab = null;
let chosenTab = null;   // a tab the child picked stays picked while walking, where the next blank has it
let pad = null;
let padRun = 0;
let typing = null;      // {ta, id, typed, dirty, composing, justComposed}
let chips = new Map();
let offs = [];
let popOverlay = null;
let openedAt = 0;
let busy = false;
let sayRun = 0;
let selfWrite = false;
let renderTimer = 0;
const flights = new Set();

const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const walkOf = key => (BLANK_IDS.includes(key) ? BLANK_IDS : PARENT_WALK.includes(key) ? PARENT_WALK : [key]);
const blankOf = key => root?.querySelector(`[data-blank="${key}"]`);

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

// Text and name of a control, tagged so a language change reaches them through applyLabels.
function text(node, key) {
  node.dataset.l = key;
  node.textContent = t(key);
  return node;
}
function named(node, key) {
  node.dataset.la = key;
  const name = t(key);
  node.setAttribute('aria-label', name);
  node.title = name;
  return node;
}

function button(className, act) {
  const b = el('button', className);
  b.type = 'button';
  if (act) b.dataset.act = act;
  return b;
}

function write(key, value) {
  selfWrite = true;
  try { fields.set(key, value); } finally { selfWrite = false; }
}

function tabsFor(key) {
  if (key === 'p4-sign') return ['pad'];
  return PAD_FIRST.has(key) ? ['pad', 'type'] : ['chips', 'pad', 'type'];
}

function firstTab(key) {
  const tabs = tabsFor(key);
  if (KEYBOARD_FIRST.has(key) && tabs.includes('type')) return 'type';
  if (tabs.includes(chosenTab)) return chosenTab;
  const kind = fields.get(key)?.kind;
  if (kind === 'text' && tabs.includes('type')) return 'type';
  if (kind === 'ink') return 'pad';
  return tabs[0];
}

// ---- the flight of a word into its blank ----

function endFlight(flight) {
  if (!flights.delete(flight)) return;
  flight.ghost.remove();
  flight.target.classList.remove('c-wait');
  flight.target.classList.add('c-land');
}

function cancelFlights() {
  for (const flight of [...flights]) endFlight(flight);
}

function fly(content, from, target) {
  if (reduced() || !root || !from?.width || !target?.isConnected || !target.animate) return Promise.resolve();
  const to = (target.querySelector('img') ?? target).getBoundingClientRect();
  if (!to.width) return Promise.resolve();
  const ghost = el(content.src ? 'img' : 'span', 'c-fly');
  if (content.src) {
    ghost.src = content.src;
    ghost.alt = '';
  } else {
    ghost.textContent = content.text;
    ghost.style.fontSize = getComputedStyle(target).fontSize;
  }
  Object.assign(ghost.style, { left: to.left + 'px', top: to.top + 'px', width: to.width + 'px', height: to.height + 'px' });
  const scale = content.src ? from.width / to.width : Math.min(2, Math.max(1, from.height / to.height));
  const dx = from.left + from.width / 2 - to.left - to.width / 2;
  const dy = from.top + from.height / 2 - to.top - to.height / 2;
  target.classList.add('c-wait');
  root.append(ghost);
  const anim = ghost.animate([
    { transform: `translate(${dx}px,${dy}px) scale(${scale})`, opacity: .9, offset: 0 },
    { transform: 'translate(0,-5px) scale(1.08)', opacity: 1, offset: .78 },
    { transform: 'none', opacity: 1, offset: 1 },
  ], { duration: FLY_MS, easing: 'cubic-bezier(.33,.7,.3,1)', fill: 'both' });
  const flight = { ghost, target };
  flights.add(flight);
  return new Promise(resolve => {
    const land = () => { endFlight(flight); resolve(); };
    anim.finished.then(land, land);
    setTimeout(land, FLY_MS + 240); // a hidden tab may never finish the animation
  });
}

// ---- the sentence ----

function blankNode(key) {
  const current = key === id;
  const node = el(current ? 'span' : 'button', 'c-blank');
  if (current) {
    node.classList.add('now');
  } else {
    node.type = 'button';
    node.dataset.act = 'blank';
  }
  node.dataset.blank = key;
  const value = fields.get(key);
  if (value?.kind === 'ink' && isSafeInk(value.src)) {
    const img = el('img');
    img.src = value.src;
    img.alt = '';
    node.append(img);
  } else if (value?.text) {
    node.textContent = value.text;
  } else {
    node.classList.add('empty');
  }
  return node;
}

function renderSentence(s) {
  const line = ui.sentence;
  line.replaceChildren();
  if (s.label) {
    line.removeAttribute('lang');
    line.append(text(el('span', 'c-label'), s.label), blankNode(id));
    return;
  }
  line.lang = 'en';
  const quoted = s.quoted ? `“${s.en}”` : s.en;
  const pieces = quoted.split('___');
  let stuck = 0;
  pieces.forEach((piece, i) => {
    line.append(piece.slice(stuck));
    if (i === s.blanks.length) return;
    // The comma or full stop after a blank stays on its line.
    const mark = pieces[i + 1].match(/^[.,!?”]+/)?.[0] ?? '';
    stuck = mark.length;
    const keep = el('span', 'c-keep');
    keep.append(blankNode(s.blanks[i]), mark);
    line.append(keep);
  });
}

function renderSay() {
  const s = SENTENCES[id];
  renderSentence(s);
  ui.sheet.classList.toggle('labelled', !!s.label);
  ui.gloss.textContent = s.vi;
  ui.gloss.hidden = !s.vi;
  ui.hear.hidden = !s.en || speech.available() === false || !!getState('muted');
  const today = id === 'p4-date' ? chipsFor(id)[0] : null;
  ui.today.hidden = !today;
  if (today) {
    ui.today.querySelector('b').textContent = today.text;
    chips.set('today', today);
  }
}

function renderProgress() {
  const counted = walkOf(id) === BLANK_IDS;
  ui.progress.hidden = ui.count.hidden = !counted;
  if (!counted) return;
  if (!ui.progress.childElementCount) ui.progress.append(...BLANK_IDS.map(() => el('i')));
  BLANK_IDS.forEach((key, i) => {
    ui.progress.children[i].className = key === id ? 'now' : fields.isFilled(key) ? 'done' : '';
  });
  ui.count.textContent = `${BLANK_IDS.indexOf(id) + 1} / ${BLANK_IDS.length}`;
}

function renderFoot() {
  const walk = walkOf(id);
  const i = walk.indexOf(id);
  const filled = fields.isFilled(id);
  ui.prev.hidden = ui.next.hidden = walk.length < 2;
  ui.prev.disabled = i === 0;
  ui.next.disabled = i === walk.length - 1;
  ui.next.classList.toggle('ready', filled && i < walk.length - 1);
  ui.done.classList.toggle('ready', filled && i === walk.length - 1);
}

function afterWrite() {
  renderSay();
  renderProgress();
  renderFoot();
  renderPadTools();
  ui.today.classList.toggle('on', fields.get(id)?.chipId === 'today');
  for (const node of ui.panel.querySelectorAll('.c-chip')) {
    const on = fields.get(id)?.chipId === node.dataset.chip;
    node.classList.toggle('on', on);
    node.setAttribute('aria-pressed', String(on));
  }
}

// ---- chips ----

function picture({ pic, fb }) {
  const box = el('span', 'c-pic');
  const cut = pic.indexOf(':');
  const kind = pic.slice(0, cut), rest = pic.slice(cut + 1);
  if (kind === 'dot') {
    const [a, b] = rest.split('/');
    const dot = el('span', 'c-dot');
    dot.style.background = b ? `linear-gradient(135deg,${a} 50%,${b} 50%)` : a;
    box.append(dot);
  } else if (kind === 'st') {
    const art = stickerSvg(rest, 44); // our own art data, never child input
    if (art) box.innerHTML = art;
    else box.textContent = fb ?? '';
  } else {
    box.textContent = rest;
  }
  return box;
}

function buildChips() {
  const grid = el('div', 'c-chips');
  const current = fields.get(id)?.chipId;
  const list = chipsFor(id, getState('usage') ?? {});
  grid.dataset.n = list.length;
  for (const chip of list) {
    chips.set(chip.id, chip);
    const node = button('c-chip', 'chip');
    node.dataset.chip = chip.id;
    node.classList.toggle('on', current === chip.id);
    node.classList.toggle('used', !!chip.used);
    node.classList.toggle('long', chip.en.length >= LONG_CHIP);
    node.setAttribute('aria-pressed', String(current === chip.id));
    const words = el('span', 'c-words');
    const word = el('b');
    word.lang = 'en';
    word.textContent = chip.en;
    const gloss = el('small', 'vi');
    gloss.lang = 'vi';
    gloss.textContent = chip.vi;
    words.append(word, gloss);
    node.append(picture(chip), words);
    grid.append(node);
  }
  ui.panel.append(grid);
}

function canSpeak() {
  return !getState('muted') && speech.available() !== false;
}

async function readSentence() {
  const mine = ++sayRun;
  ui.hear.classList.add('c-pulse');
  await speech.sentence(id);
  if (mine === sayRun) ui.hear?.classList.remove('c-pulse');
}

async function sayChip(chip) {
  const mine = ++sayRun;
  const spoken = await speech.word(chip.en);
  if (spoken && root && mine === sayRun) await readSentence();
}

function pickChip(chip, node) {
  const value = chip.text ?? chip.en;
  if (fields.get(id)?.chipId !== chip.id) {
    cancelFlights();
    const from = (node.querySelector('b') ?? node).getBoundingClientRect();
    write(id, { kind: 'chip', text: value, chipId: chip.id });
    afterWrite();
    fly({ text: value }, from, blankOf(id));
  }
  if (!chip.today && canSpeak()) sayChip(chip);
}

// ---- keyboard ----

function settleViewport() {
  window.scrollTo(0, 0);
  viewport.refit();
}

function commitTyped(s) {
  if (!s.dirty) return false;
  s.dirty = false;
  const value = fields.cleanText(s.typed);
  write(s.id, value ? { kind: 'text', text: value } : null);
  return true;
}

function landTyped(s) {
  if (!commitTyped(s)) return Promise.resolve();
  if (!root || s.id !== id) return Promise.resolve();
  const from = s.ta.getBoundingClientRect();
  afterWrite();
  const value = fields.get(id)?.text;
  return value ? fly({ text: value }, from, blankOf(id)) : Promise.resolve();
}

function buildType() {
  const row = el('div', 'c-typerow');
  const ta = el('textarea', 'c-text');
  ta.rows = 1;
  for (const [k, v] of Object.entries({ autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'done' })) ta.setAttribute(k, v);
  ta.dataset.la = 'card.type';
  ta.setAttribute('aria-label', t('card.type'));
  const value = fields.get(id);
  const initial = value?.kind === 'text' || value?.kind === 'chip' ? value.text : '';
  ta.value = initial; // still detached, and never written again
  const s = { ta, id, typed: initial, dirty: false, composing: false, justComposed: false };
  typing = s;
  ta.addEventListener('input', e => {
    s.typed = e.target.value;
    s.dirty = true;
    if (document.activeElement !== e.target) commitTyped(s); // an IME can finish after the field lost focus
  });
  ta.addEventListener('compositionstart', () => { s.composing = true; });
  ta.addEventListener('compositionend', () => {
    s.composing = false;
    s.justComposed = true;
    setTimeout(() => { s.justComposed = false; }, 0); // Safari sends the Enter that ended a composition after compositionend
  });
  ta.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || s.composing || s.justComposed) return;
    e.preventDefault();
    landTyped(s);
    ta.blur();
  });
  // The re-render waits a tick: a press on a button under the finger must still hit that button.
  ta.addEventListener('blur', () => {
    settleViewport();
    setTimeout(() => { if (typing === s) landTyped(s); }, 0);
  });
  const ok = named(button('c-ok', 'ok'), 'card.done');
  ok.innerHTML = icon('check', 34);
  row.append(ta, ok);
  ui.panel.append(row);
}

// ---- handwriting ----

function renderPadTools() {
  const tools = ui.panel.querySelector('.c-padtools');
  if (!tools) return;
  const empty = !pad || pad.isEmpty();
  tools.querySelector('[data-act="padundo"]').hidden = empty;
  tools.querySelector('[data-act="padclear"]').hidden = empty && fields.get(id)?.kind !== 'ink';
}

function padFailed(err) {
  log('card', 'pad: ' + (err?.message ?? err));
  if (tabsFor(id).includes('type')) setTab('type');
}

async function buildPad() {
  const run = ++padRun;
  const host = el('div', 'c-padhost');
  const tools = el('div', 'c-padtools');
  const undo = named(button('c-mini', 'padundo'), 'undo');
  undo.innerHTML = icon('undo', 26);
  undo.hidden = true;
  const clear = button('c-mini', 'padclear');
  clear.append(text(el('span'), 'card.clear'));
  clear.hidden = true;
  tools.append(undo, clear);
  host.append(tools);
  if (!SIGN_LINE.has(id) && !fields.get(id)) host.insertAdjacentHTML('beforeend', HINT);
  ui.panel.append(host);
  renderPadTools();
  let made;
  try {
    const { mountPad } = await import('./pad.js?v=1');
    if (run !== padRun || !root) return;
    made = mountPad(host, {
      guide: SIGN_LINE.has(id) ? 'line' : 'school',
      onStart: () => host.querySelector('.c-hint')?.remove(),
      onChange: renderPadTools,
    });
  } catch (err) {
    padFailed(err);
    return;
  }
  pad = made;
  renderPadTools();
}

async function landPad() {
  if (!pad || pad.isEmpty()) return;
  const key = id;
  const src = await pad.toDataURL();
  const from = pad.lastBox?.();
  if (!root || key !== id || !pad) {
    if (src) write(key, { kind: 'ink', src });
    return;
  }
  pad.clear();
  if (!src) return;
  write(key, { kind: 'ink', src });
  afterWrite();
  const target = blankOf(key);
  await target?.querySelector('img')?.decode?.().catch(() => {});
  if (root && key === id) await fly({ src }, from, target);
}

// ---- walking ----

function dropPanel() {
  padRun++;
  pad?.destroy();
  pad = null;
  const s = typing;
  typing = null;
  const hadKeyboard = s && document.activeElement === s.ta;
  chips = new Map();
  ui.panel.replaceChildren();
  if (hadKeyboard) settleViewport();
}

function setTab(name) {
  dropPanel();
  tab = name;
  ui.sheet.dataset.tab = name;
  for (const b of ui.tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  ui.panel.scrollTop = 0;
  if (name === 'chips') buildChips();
  else if (name === 'pad') buildPad();
  else {
    buildType();
    if (KEYBOARD_FIRST.has(id)) ui.panel.querySelector('.c-text')?.focus(); // the name line opens straight to the keyboard
  }
  if (id === 'p4-date') renderSay(); // the Hôm nay chip was dropped from the chip map along with the panel
}

function renderTabs() {
  const tabs = tabsFor(id);
  ui.tabs.hidden = tabs.length < 2;
  ui.sheet.classList.toggle('tabless', tabs.length < 2);
  ui.tabs.replaceChildren(...tabs.map(name => {
    const b = button('c-tab', 'tab');
    b.dataset.tab = name;
    b.setAttribute('role', 'tab');
    b.insertAdjacentHTML('afterbegin', TAB_ART[name]);
    b.append(text(el('span'), TAB_LABEL[name]));
    return b;
  }));
}

function show(key, direction = 0) {
  cancelFlights();
  id = key;
  renderTabs();
  setTab(firstTab(key));
  queueMicrotask(() => emit('card:show', { id: key }));
  afterWrite();
  if (direction && !reduced()) {
    for (const node of [ui.say, ui.panel]) {
      node.animate?.([{ transform: `translateX(${direction * 18}px)`, opacity: .35 }, { transform: 'none', opacity: 1 }], { duration: SLIDE_MS, easing: 'ease-out' });
    }
  }
}

// Commits whatever is on the current tab, and waits for the word to land.
async function settlePanel() {
  if (typing) await landTyped(typing);
  await landPad();
}

async function act(fn) {
  if (busy) return;
  busy = true;
  try {
    await fn();
  } catch (err) {
    log('card', err.message);
  } finally {
    busy = false;
  }
}

function walk(step) {
  act(async () => {
    const list = walkOf(id);
    const next = list[list.indexOf(id) + step];
    if (!next) return;
    await settlePanel();
    if (!root) return;
    sayRun++;
    speech.stop();
    show(next, step);
  });
}

function onClick(e) {
  if (performance.now() - openedAt < OPEN_GUARD_MS) return;
  const b = e.target.closest?.('button[data-act]');
  if (!b || !root?.contains(b)) return;
  switch (b.dataset.act) {
    case 'close':
      close();
      break;
    case 'done':
      act(async () => {
        await settlePanel();
        close();
      });
      break;
    case 'prev':
      walk(-1);
      break;
    case 'next':
      walk(1);
      break;
    case 'hear':
      if (typing) commitTyped(typing);
      readSentence();
      break;
    case 'tab':
      if (b.dataset.tab !== tab) {
        act(async () => {
          await settlePanel();
          if (!root) return;
          chosenTab = b.dataset.tab;
          setTab(chosenTab);
          afterWrite();
        });
      }
      break;
    case 'blank':
      act(async () => {
        await settlePanel();
        if (root) show(b.dataset.blank);
      });
      break;
    case 'chip':
    case 'today': {
      const chip = chips.get(b.dataset.chip ?? 'today');
      if (chip) pickChip(chip, b);
      break;
    }
    case 'ok':
      if (typing) {
        landTyped(typing);
        typing.ta.blur();
      }
      break;
    case 'padundo':
      pad?.undo();
      break;
    case 'padclear':
      pad?.clear();
      if (fields.get(id)?.kind === 'ink') {
        write(id, null);
        afterWrite();
      }
      break;
    default:
  }
}

function onKey(e) {
  if (e.key === 'Escape' && !e.isComposing && e.target !== typing?.ta) close();
}

// The browser may be killed while hidden. Whatever is in progress goes into the fields now, and nothing is cleared.
function onVisibility() {
  if (document.visibilityState !== 'hidden' || !root) return;
  if (typing && commitTyped(typing)) scheduleRender();
  if (pad && !pad.isEmpty()) {
    const key = id;
    pad.toDataURL().then(src => {
      if (src) write(key, { kind: 'ink', src });
      scheduleRender();
    }, err => log('card', 'pad on hide: ' + err.message));
  }
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => { if (root) afterWrite(); }, 0);
}

// ---- building and leaving ----

function skeleton() {
  return `<div class="c-sheet">
  <header class="c-top">
    <button type="button" class="c-close" data-act="close">${icon('close', 22)}<span></span></button>
    <div class="c-progress" aria-hidden="true"></div>
    <span class="c-count"></span>
  </header>
  <section class="c-say">
    <button type="button" class="c-hear" data-act="hear">${icon('speaker', 30)}</button>
    <p class="c-sentence"></p>
    <p class="c-gloss vi" lang="vi"></p>
    <button type="button" class="c-today" data-act="today" hidden><span class="c-pic">📅</span><span></span><b></b></button>
  </section>
  <div class="c-tabs" role="tablist"></div>
  <div class="c-panel" role="tabpanel"></div>
  <footer class="c-foot">
    <button type="button" class="c-arrow c-prev" data-act="prev">${ARROW.prev}<span></span></button>
    <button type="button" class="c-done" data-act="done">${icon('check', 26)}<span></span></button>
    <button type="button" class="c-arrow c-next" data-act="next">${ARROW.next}<span></span></button>
  </footer>
</div>`;
}

function setBackgroundInert(on) {
  const host = root.parentElement;
  const rest = host?.id === HOST_ID ? [...host.children].filter(node => node !== root) : [];
  for (const node of [...document.querySelectorAll('.page,.topbar'), ...rest]) node.inert = on;
}

function build() {
  ensureStyle();
  root = el('div');
  root.id = 'studio-card';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.innerHTML = skeleton(); // constant markup and our own icons
  const $ = selector => root.querySelector(selector);
  ui = {
    sheet: $('.c-sheet'), progress: $('.c-progress'), count: $('.c-count'),
    say: $('.c-say'), hear: $('.c-hear'), sentence: $('.c-sentence'), gloss: $('.c-gloss'), today: $('.c-today'),
    tabs: $('.c-tabs'), panel: $('.c-panel'),
    prev: $('.c-prev'), done: $('.c-done'), next: $('.c-next'),
  };
  text($('.c-close span'), 'card.close');
  text($('.c-today span:not(.c-pic)'), 'card.today');
  text(ui.prev.querySelector('span'), 'card.prev');
  text(ui.done.querySelector('span'), 'card.done');
  text(ui.next.querySelector('span'), 'card.next');
  named(ui.hear, 'card.hear');
  (document.getElementById(HOST_ID) ?? document.body).append(root);
  setBackgroundInert(true);
  root.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisibility);
  offs = [
    on('field:change', () => { if (!selfWrite) scheduleRender(); }),
    on('lang:change', () => applyLabels(root)),
    on('studio:exit', close),
  ];
  popOverlay = shell.pushOverlay(() => {
    popOverlay = null;
    close();
  });
}

export function open(key) {
  if (!SENTENCES[key]) {
    log('card', 'no sentence for ' + key);
    return;
  }
  if (root) {
    act(async () => {
      await settlePanel();
      if (root) show(key);
    });
    return;
  }
  chosenTab = null;
  openedAt = performance.now();
  build();
  fields.ensureFont();
  show(key);
}

export function close() {
  if (!root) return;
  const key = id;
  // Back, Escape and exit cannot wait for a flight, but the work still goes in.
  if (typing) commitTyped(typing);
  if (pad && !pad.isEmpty()) {
    pad.toDataURL().then(src => { if (src) write(key, { kind: 'ink', src }); }, err => log('card', 'pad on close: ' + err.message));
  }
  clearTimeout(renderTimer);
  cancelFlights();
  dropPanel();
  queueMicrotask(() => emit('card:closed', {}));
  for (const off of offs) off();
  offs = [];
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('visibilitychange', onVisibility);
  setBackgroundInert(false);
  root.remove();
  root = ui = id = tab = null;
  sayRun++;
  speech.stop();
  const pop = popOverlay;
  popOverlay = null;
  pop?.();
  settleViewport();
}

export function isOpen() {
  return !!root;
}

// ---- style: scoped here so this file owns the whole Card ----

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = el('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

const HAND = '"Playpen Hand","Nunito Paper","Be Vietnam Pro",system-ui,sans-serif';
const SPEAK = '"Nunito Paper","Nunito","Trebuchet MS",system-ui,sans-serif';
const CSS = `
#studio-card{--thread:#FFC21A;--pen:#1F3FA8;--tint:#F3F5FB;--white:#FFFFFF;--say:20px;--gloss:14.5px;--tabh:52px;--chiph:56px;--cols:2;--pic:40px;--word:17px;--sub:12.5px;--footh:60px;--line:3px solid var(--ink);
  position:fixed;left:0;top:0;right:0;bottom:0;z-index:70;display:flex;justify-content:center;align-items:flex-start;overflow:hidden;background:var(--desk);color:var(--ink);
  font-family:var(--body);font-size:16px;line-height:1.35;pointer-events:auto;touch-action:pan-y;overscroll-behavior:contain;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none}
#studio-card *{box-sizing:border-box}
#studio-card button{font:inherit;color:inherit;cursor:pointer;-webkit-appearance:none;appearance:none;touch-action:pan-y}
#studio-card button:disabled{cursor:default}
#studio-card svg{display:block;flex:none}
#studio-card p{margin:0}
#studio-card .c-sheet{display:flex;flex-direction:column;width:100%;max-width:780px;height:100%;min-height:0;background:var(--paper);
  padding:max(6px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) 0 max(12px,env(safe-area-inset-left));animation:studio-card-rise .22s ease-out both}
@keyframes studio-card-rise{from{transform:translateY(14px);opacity:0}to{transform:none;opacity:1}}

/* header: close, a line of stitches for the 14 blanks, the count */
#studio-card .c-top{flex:none;display:flex;align-items:center;gap:10px;min-height:50px}
#studio-card .c-close{flex:none;display:inline-flex;align-items:center;gap:5px;min-height:44px;margin-right:auto;padding:0 14px 0 8px;border:2.5px solid var(--ink);border-radius:999px;background:var(--white);font-size:15px;font-weight:800}
#studio-card .c-progress{flex:1 1 0;min-width:0;display:flex;align-items:center;justify-content:center;gap:3px}
#studio-card .c-progress i{flex:0 1 12px;min-width:3px;height:4px;border-radius:2px;background:#D8DCE7}
#studio-card .c-progress i.done{background:var(--thread)}
#studio-card .c-progress i.now{height:8px;border-radius:3px;background:var(--ink)}
#studio-card .c-count{flex:none;font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}

/* the sentence, a label sewn onto the paper */
#studio-card .c-say{position:relative;flex:none;margin:4px 0 12px;padding:13px 14px 12px;border:var(--line);border-radius:19px 15px 20px 14px;background:var(--white);box-shadow:0 3px 0 var(--ink)}
#studio-card .c-say::before{content:"";position:absolute;left:4px;top:4px;right:4px;bottom:4px;border:2px dashed var(--thread);border-radius:13px 10px 14px 9px;pointer-events:none}
#studio-card .c-hear{position:relative;z-index:1;float:right;width:48px;height:48px;margin:-3px -3px 2px 8px;display:grid;place-items:center;border:var(--line);border-radius:50%;background:var(--sun);box-shadow:0 2px 0 var(--ink)}
#studio-card .c-hear:active{transform:translateY(2px);box-shadow:none}
#studio-card .c-hear.c-pulse{animation:studio-card-pulse .9s ease-out infinite}
@keyframes studio-card-pulse{0%{box-shadow:0 2px 0 var(--ink),0 0 0 0 rgba(255,194,26,.75)}100%{box-shadow:0 2px 0 var(--ink),0 0 0 14px rgba(255,194,26,0)}}
#studio-card .c-sentence{position:relative;font:700 var(--say)/1.42 ${SPEAK};overflow-wrap:anywhere}
#studio-card .c-label{display:block;font:800 var(--say)/1.3 var(--body)}
#studio-card .c-gloss{position:relative;clear:both;margin-top:6px;padding-top:6px;border-top:1px solid var(--rule);font:400 var(--gloss)/1.4 var(--viet);color:var(--ink-soft)}
#studio-card .c-keep{white-space:nowrap}
#studio-card .c-blank{position:relative;display:inline-block;min-width:4.4em;min-height:1.28em;max-width:100%;margin:0 .06em;padding:0 .34em;border:0;border-bottom:2px dotted var(--ink-soft);border-radius:0;background:none;
  font:500 1em/1.28 ${HAND};color:var(--pen);text-align:center;vertical-align:baseline;overflow-wrap:anywhere;white-space:normal}
#studio-card .c-blank.empty::before{content:"\\200b"}
#studio-card .c-blank.now{border-bottom:2.5px solid var(--ink);border-radius:7px 6px 3px 3px;background:var(--sun)}
#studio-card button.c-blank::after{content:"";position:absolute;left:0;right:0;top:-8px;bottom:-8px}
#studio-card .c-blank img{display:inline-block;height:1.5em;max-width:100%;vertical-align:bottom}
#studio-card .c-blank.c-wait{color:transparent}
#studio-card .c-blank.c-wait img{visibility:hidden}
#studio-card .c-blank.c-land{animation:studio-card-land .3s cubic-bezier(.3,1.6,.5,1)}
@keyframes studio-card-land{from{transform:scale(.86)}to{transform:none}}
#studio-card .labelled .c-blank{display:block;min-height:54px;margin:8px 0 2px;padding:6px 10px;font-size:26px;text-align:left}
#studio-card .labelled .c-blank.now{background:#FFFBD0}
#studio-card .labelled .c-blank img{height:42px}
#studio-card .c-today{position:relative;display:flex;align-items:center;gap:8px;width:100%;min-height:56px;margin-top:8px;padding:0 12px;border:var(--line);border-radius:15px 12px 16px 11px;background:var(--white);box-shadow:0 3px 0 var(--ink);font-weight:800;text-align:left}
#studio-card .c-today.on{background:var(--sun)}
#studio-card .c-today:active{transform:translateY(2px);box-shadow:0 1px 0 var(--ink)}
#studio-card .c-today .c-pic{--pic:30px}
#studio-card .c-today b{margin-left:auto;font:700 18px/1 ${SPEAK}}
#studio-card .c-fly{position:fixed;z-index:3;display:flex;align-items:center;justify-content:center;pointer-events:none;white-space:nowrap;font-family:${HAND};font-weight:500;color:var(--pen);will-change:transform}

/* three paper tabs on a tinted pocket */
#studio-card .c-tabs{position:relative;z-index:1;flex:none;display:flex;gap:5px;margin-bottom:-3px;padding:0 12px}
#studio-card .c-tab{flex:1 1 0;min-width:0;min-height:var(--tabh);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:2px 1px;border:var(--line);border-radius:15px 13px 0 0;background:#DFE4F0;font-size:13px;font-weight:800;line-height:1.1;white-space:nowrap}
#studio-card .c-tab svg{width:23px;height:23px}
#studio-card .c-tab[aria-selected="true"]{background:var(--tint);border-bottom-color:var(--tint)}
#studio-card .c-panel{position:relative;flex:1 1 0;min-height:0;display:flex;flex-direction:column;overflow-x:hidden;overflow-y:auto;border:var(--line);border-radius:17px 15px 17px 15px;background:var(--tint);overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y}
#studio-card .c-sheet[data-tab="pad"] .c-panel{overflow:hidden;touch-action:none;background:var(--white)}
#studio-card .c-sheet[data-tab="pad"] .c-tab[aria-selected="true"]{background:var(--white);border-bottom-color:var(--white)}

/* chips */
#studio-card .c-chips{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));gap:8px;padding:8px 9px 11px;align-content:start}
#studio-card .c-chip{position:relative;display:flex;align-items:center;gap:8px;min-width:0;min-height:var(--chiph);padding:5px 8px 5px 6px;border:var(--line);border-radius:15px 12px 16px 11px;background:var(--white);box-shadow:0 3px 0 var(--ink);text-align:left;transition:transform .08s,box-shadow .08s,background-color .12s}
#studio-card .c-chip:nth-child(2n){border-radius:12px 15px 11px 16px}
#studio-card .c-chip:active{transform:translateY(2px);box-shadow:0 1px 0 var(--ink)}
#studio-card .c-chip.long{grid-column:1/-1}
#studio-card .c-chip.on{background:var(--sun)}
#studio-card .c-chip.used::after{content:"";position:absolute;left:10px;right:10px;bottom:3px;border-bottom:2px dashed var(--thread)}
#studio-card .c-words{display:block;min-width:0}
#studio-card .c-words b{display:block;font:700 var(--word)/1.14 ${SPEAK}}
#studio-card .c-words small{display:block;margin-top:2px;font:500 var(--sub)/1.2 var(--viet);color:var(--ink-soft)}
#studio-card .c-chip.on small{color:var(--ink)}
#studio-card .c-pic{flex:none;width:var(--pic);height:var(--pic);display:grid;place-items:center;font-size:calc(var(--pic)*.68);line-height:1}
#studio-card .c-pic svg{width:100%;height:100%}
#studio-card .c-dot{width:76%;height:76%;border:var(--line);border-radius:50%}

/* keyboard */
#studio-card .c-typerow{flex:none;display:flex;gap:8px;padding:10px 9px}
#studio-card .c-text{flex:1 1 0;min-width:0;height:66px;padding:8px 12px;border:var(--line);border-radius:15px 12px 16px 11px;background:var(--white);color:var(--pen);font:500 20px/24px ${HAND};
  resize:none;outline:0;-webkit-appearance:none;appearance:none;-webkit-user-select:text;user-select:text;touch-action:auto}
#studio-card .c-text:focus{box-shadow:0 0 0 3px var(--sun)}
#studio-card .c-ok{flex:none;width:66px;display:grid;place-items:center;border:var(--line);border-radius:12px 15px 11px 16px;background:var(--sun);box-shadow:0 3px 0 var(--ink)}
#studio-card .c-ok:active{transform:translateY(2px);box-shadow:0 1px 0 var(--ink)}

/* handwriting pad: pad.js fills .c-padhost and takes the touches */
#studio-card .c-padhost{position:relative;flex:1 1 auto;min-height:0;overflow:hidden}
#studio-card .c-padtools{position:absolute;right:6px;top:6px;z-index:2;display:flex;gap:6px}
#studio-card .c-mini{min-width:46px;height:46px;padding:0 10px;display:inline-flex;align-items:center;justify-content:center;border:2.5px solid var(--ink);border-radius:13px 11px 14px 10px;background:var(--white);font-size:14px;font-weight:800}
#studio-card .c-hint{position:absolute;left:50%;top:50%;width:min(64%,380px);transform:translate(-50%,-50%);pointer-events:none;opacity:.8}
#studio-card .c-hint path{fill:none;stroke:#B5C9EF;stroke-width:6;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:0;animation:studio-card-draw 1.6s ease-in-out .15s both}
@keyframes studio-card-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}

/* walking */
#studio-card .c-foot{flex:none;display:flex;align-items:stretch;gap:8px;margin-top:0;padding:11px 0 max(11px,env(safe-area-inset-bottom))}
#studio-card .c-arrow{flex:0 0 92px;min-height:var(--footh);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;padding:2px 2px 4px;border:var(--line);border-radius:17px 13px 18px 12px;background:var(--white);box-shadow:0 3px 0 var(--ink);font-size:13px;font-weight:800;line-height:1.1;white-space:nowrap}
#studio-card .c-next{border-radius:13px 17px 12px 18px}
#studio-card .c-arrow:disabled{opacity:.3;box-shadow:none}
#studio-card .c-arrow:not(:disabled):active,#studio-card .c-done:active{transform:translateY(2px);box-shadow:0 1px 0 var(--ink)}
#studio-card .c-done{flex:1 1 0;min-width:0;min-height:var(--footh);display:flex;align-items:center;justify-content:center;gap:7px;padding:0 8px;border:var(--line);border-radius:17px 14px 18px 13px;background:var(--ink);color:var(--paper);box-shadow:0 3px 0 var(--ink);font-size:19px;font-weight:800}
#studio-card .c-done svg path{stroke:currentColor}
#studio-card .c-next.ready,#studio-card .c-done.ready{background:var(--sun);color:var(--ink);animation:studio-card-ready .42s cubic-bezier(.3,1.7,.5,1)}
@keyframes studio-card-ready{from{transform:scale(.92)}to{transform:none}}

/* Type tab on a short screen: the field must sit above the keyboard, so the gloss gives way */
@media (max-height:760px) and (max-width:599px){#studio-card .c-sheet[data-tab="type"] .c-gloss{display:none}}
@media (max-height:760px) and (max-width:599px){
  #studio-card .labelled[data-tab="type"] .c-today{display:none}
  #studio-card .labelled[data-tab="type"] .c-blank{min-height:44px;font-size:22px}
  #studio-card .labelled[data-tab="type"] .c-blank img{height:36px}
}
@media (max-height:600px) and (max-width:599px){
  #studio-card .c-sheet[data-tab="type"]{--say:17px;--tabh:44px}
}
/* a keyboard that shrinks the page (old Android), and very small phones */
@media (max-height:560px) and (max-width:559px){
  #studio-card{--say:18px;--tabh:46px;--footh:48px;--chiph:54px}
  #studio-card .c-top{min-height:46px}
  #studio-card .c-say{margin-bottom:8px;padding:9px 11px}
  #studio-card .c-hear{width:44px;height:44px}
  #studio-card .c-gloss{display:none}
  #studio-card .c-foot{padding-top:7px;padding-bottom:7px}
  #studio-card .c-arrow span{display:none}
}
/* phone on its side: words on the left, answers on the right */
@media (max-height:500px) and (min-width:560px){
  #studio-card{--say:20px;--gloss:14px;--tabh:46px;--footh:50px;--chiph:54px;--pic:34px;--word:15.5px;--sub:11.5px}
  #studio-card .c-sheet{max-width:none;display:grid;grid-template-columns:minmax(0,5fr) minmax(0,6fr);grid-template-rows:auto minmax(0,1fr) auto;column-gap:12px}
  #studio-card .c-top{grid-column:1;grid-row:1;min-height:46px}
  #studio-card .c-say{grid-column:1;grid-row:2;margin:2px 0 0;overflow-y:auto;padding:10px 12px}
  #studio-card .c-foot{grid-column:1;grid-row:3;padding-top:8px;padding-bottom:max(8px,env(safe-area-inset-bottom))}
  #studio-card .c-arrow{flex-basis:60px}
  #studio-card .c-arrow span{display:none}
  #studio-card .c-tabs{grid-column:2;grid-row:1;align-self:end;padding-top:4px}
  #studio-card .c-panel{grid-column:2;grid-row:2/4;margin-bottom:max(6px,env(safe-area-inset-bottom))}
  #studio-card .tabless .c-panel{grid-row:1/4;margin-top:6px}
}
/* tablet and desktop: a big sheet of paper lying on the desk */
@media (min-width:600px) and (min-height:561px){
  #studio-card{--say:27px;--gloss:17px;--tabh:66px;--chiph:138px;--cols:3;--pic:68px;--word:22px;--sub:15px;--footh:74px}
  #studio-card .c-sheet{height:calc(100% - 28px);margin-top:14px;padding:12px 18px 0;border:var(--line);border-radius:26px 22px 28px 20px;box-shadow:0 5px 0 var(--ink),0 18px 44px rgba(22,34,74,.18)}
  #studio-card .c-say{padding:18px 20px 16px;margin-bottom:14px}
  #studio-card .c-hear{width:60px;height:60px;margin:-4px -4px 4px 12px}
  #studio-card .c-tab{flex-direction:row;gap:9px;padding:4px 6px;font-size:18px}
  #studio-card .c-tab svg{width:32px;height:32px}
  #studio-card .c-chips{gap:14px 12px;padding:14px 12px 16px}
  #studio-card .c-chips[data-n="4"],#studio-card .c-chips[data-n="7"]{--cols:4}
  #studio-card .c-chip{flex-direction:column;justify-content:center;gap:8px;padding:10px 8px 12px;text-align:center}
  #studio-card .c-chip.long{grid-column:auto}
  #studio-card .c-typerow{padding:14px 12px}
  #studio-card .c-arrow{flex-basis:128px;font-size:15px}
  #studio-card .c-arrow svg{width:30px;height:30px}
  #studio-card .c-done{font-size:22px}
  #studio-card .c-foot{padding-top:14px;padding-bottom:max(14px,env(safe-area-inset-bottom))}
  #studio-card .labelled .c-blank{min-height:76px;font-size:32px}
  #studio-card .labelled .c-blank img{height:62px}
  #studio-card .c-today{max-width:420px}
  #studio-card .c-mini{height:52px;min-width:52px;font-size:16px}
}
@media (min-width:600px) and (min-height:900px){
  #studio-card{--chiph:176px;--pic:92px;--word:24px;--sub:17px}
}
@media print{#studio-card{display:none!important}}
`;
