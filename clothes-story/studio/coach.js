// The guide: walks a child through See, Think, Say. It asks in English and Vietnamese, offers words to pick, builds the poster
// from the answers, and goes over the speech before the camera. Answers stay in meta.coach as English words.
import { BOXES, swatch as swatchById } from './constants.js?v=1';
import { on } from './bus.js?v=1';
import * as fields from './fields.js?v=1';
import { cellRects, isSafeInk, renderCells } from './fit.js?v=1';
import * as objects from './objects.js?v=1';
import * as quest from './quest.js?v=1';
import * as shell from './shell.js?v=1';
import * as speech from './speech.js?v=1';
import * as state from './state.js?v=1';
import * as store from './store.js?v=1';
import * as targets from './targets.js?v=1';

const UNIFORM_BOX = 'p1-uniform', WEEKEND_BOX = 'p1-weekend';
const MAX_UNIFORMS = 6;
const TIP_MS = 5200;
const WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six'];

const STAGE = {
  see: ['👀', 'See', 'Nhìn'],
  think: ['💭', 'Think', 'Suy nghĩ'],
  say: ['🗣️', 'Say', 'Nói'],
};

const NAMES = [
  { en: 'everyday uniform', vi: 'đồng phục hằng ngày', when: 'every day', e: '🏫' },
  { en: 'P.E. uniform', vi: 'đồng phục thể dục', when: 'for P.E.', e: '🏃' },
  { en: 'Monday uniform', vi: 'đồng phục thứ Hai', when: 'on Monday', e: '🚩' },
  { en: 'special uniform', vi: 'đồng phục ngày lễ', when: 'on special days', e: '🎉' },
  { en: 'summer uniform', vi: 'đồng phục mùa hè', when: 'in summer', e: '☀️' },
  { en: 'winter uniform', vi: 'đồng phục mùa đông', when: 'in winter', e: '❄️' },
];
const TOPS = [
  { en: 'shirt', vi: 'áo sơ mi', e: '👔', st: 'shirt' },
  { en: 'T-shirt', vi: 'áo phông', e: '👕', st: 'tshirt' },
  { en: 'polo shirt', vi: 'áo polo', e: '🎽', st: 'polo' },
  { en: 'dress', vi: 'váy liền', e: '👗', st: 'dress' },
  { en: 'ao dai', vi: 'áo dài', e: '🥻', st: 'aodai' },
  { en: 'jacket', vi: 'áo khoác', e: '🧥', st: 'jacket' },
];
const BOTTOMS = [
  { en: 'shorts', vi: 'quần đùi', e: '🩳', st: 'shorts' },
  { en: 'trousers', vi: 'quần dài', e: '👖', st: 'trousers' },
  { en: 'skirt', vi: 'chân váy', e: '💃', st: 'skirt' },
];
const COLORS = [
  { en: 'white', vi: 'trắng', sw: 'white' },
  { en: 'blue', vi: 'xanh dương', sw: 'blue' },
  { en: 'navy', vi: 'xanh tím than', sw: 'navy' },
  { en: 'light blue', vi: 'xanh da trời', sw: 'sky' },
  { en: 'red', vi: 'đỏ', sw: 'red' },
  { en: 'yellow', vi: 'vàng', sw: 'yellow' },
  { en: 'green', vi: 'xanh lá', sw: 'green' },
  { en: 'pink', vi: 'hồng', sw: 'pink' },
  { en: 'purple', vi: 'tím', sw: 'purple' },
  { en: 'orange', vi: 'cam', sw: 'orange' },
  { en: 'brown', vi: 'nâu', sw: 'brown' },
  { en: 'checked', vi: 'kẻ ô', sw: 'gingham', e: '🏁' },
  { en: 'striped', vi: 'kẻ sọc', sw: 'stripe', e: '🦓' },
];
const EXTRAS = [
  { en: 'a tie', vi: 'cà vạt', e: '👔' },
  { en: 'a bow', vi: 'nơ', e: '🎀' },
  { en: 'a red scarf', vi: 'khăn quàng đỏ', e: '🧣' },
  { en: 'a hat', vi: 'mũ', e: '🧢' },
  { en: 'socks', vi: 'tất', e: '🧦' },
  { en: 'shoes', vi: 'giày', e: '👟' },
  { en: 'sandals', vi: 'dép quai hậu', e: '🩴', st: 'sandals' },
  { en: 'a backpack', vi: 'ba lô', e: '🎒', st: 'backpack' },
  { en: 'a name badge', vi: 'phù hiệu', e: '🏷️' },
  { en: 'a belt', vi: 'thắt lưng', e: '➰' },
];
const FEELS = [
  { en: 'comfortable', vi: 'thoải mái', e: '😊' },
  { en: 'smart', vi: 'gọn gàng', e: '🌟' },
  { en: 'cool', vi: 'mát mẻ', e: '😎' },
  { en: 'warm', vi: 'ấm áp', e: '🧣' },
  { en: 'proud', vi: 'tự hào', e: '🏅' },
  { en: 'ready to learn', vi: 'sẵn sàng học tập', e: '📚' },
];
const WEEKEND_STICKERS = [
  { en: 'T-shirt', vi: 'áo phông', e: '👕', st: 'tshirt', kind: 'top' },
  { en: 'shorts', vi: 'quần đùi', e: '🩳', st: 'shorts', kind: 'bottom' },
  { en: 'dress', vi: 'váy liền', e: '👗', st: 'dress', kind: 'top' },
  { en: 'trousers', vi: 'quần dài', e: '👖', st: 'trousers', kind: 'bottom' },
  { en: 'jacket', vi: 'áo khoác', e: '🧥', st: 'jacket', kind: 'top' },
  { en: 'sandals', vi: 'dép quai hậu', e: '🩴', st: 'sandals', kind: 'extra' },
  { en: 'backpack', vi: 'ba lô', e: '🎒', st: 'backpack', kind: 'extra' },
  { en: 'star', vi: 'ngôi sao', e: '⭐', st: 'star', kind: 'extra' },
];
const DRAW_TIPS = [
  ['Tap a sticker to move, turn or colour it.', 'Chạm vào hình dán để di chuyển, xoay hoặc tô màu.'],
  ['Add buttons, pockets or a collar.', 'Thêm cúc áo, túi áo hoặc cổ áo nhé.'],
  ['Does it have your school logo?', 'Áo có logo của trường em không?'],
  ['Draw yourself wearing it!', 'Vẽ em đang mặc bộ này nhé!'],
  ['What shoes do you wear with it?', 'Em đi giày gì với bộ này?'],
];
const WEEKEND_TIPS = [
  ['Where do you go on the weekend?', 'Cuối tuần em đi đâu?'],
  ['Draw your favourite clothes.', 'Vẽ bộ quần áo em thích nhất nhé.'],
  ['Who are you with? Draw them too!', 'Em đi cùng ai? Vẽ cả họ nữa nhé!'],
];

const DETAILS = {
  name: {
    stage: 'see',
    q: i => [`Uniform ${i}: when do you wear it?`, `Bộ đồng phục ${i}: em mặc khi nào?`],
    groups: [{ key: 'name', items: NAMES }],
    nudge: [['Which day of the week?', 'Vào ngày nào trong tuần?'], ['Is it for sport or for class?', 'Bộ này để tập thể thao hay để học trong lớp?']],
  },
  top: {
    stage: 'see',
    q: () => ['What do you wear on top?', 'Phần áo của bộ này là gì?'],
    groups: [{ key: 'top', items: TOPS }, { key: 'topColor', items: COLORS, label: ['What colour is it?', 'Nó màu gì?'] }],
    nudge: [['Long sleeves or short sleeves?', 'Tay dài hay tay ngắn?'], ['Does it have a collar?', 'Áo có cổ không?']],
  },
  bottom: {
    stage: 'see',
    q: () => ['What do you wear on the bottom?', 'Phần dưới của bộ này là gì?'],
    groups: [{ key: 'bottom', items: BOTTOMS }, { key: 'bottomColor', items: COLORS, label: ['What colour is it?', 'Nó màu gì?'] }],
    nudge: [['Is it long or short?', 'Nó dài hay ngắn?']],
  },
  extras: {
    stage: 'see',
    q: () => ['What else do you wear with it?', 'Em còn mặc hoặc đeo gì nữa?'],
    groups: [{ key: 'extras', items: EXTRAS, multi: true }],
    nudge: [['Pick as many as you like!', 'Chọn bao nhiêu cũng được!'], ['Do you have a special day for it?', 'Có ngày đặc biệt nào em mặc bộ này không?']],
  },
  feel: {
    stage: 'think',
    q: () => ['How do you feel in it?', 'Em cảm thấy thế nào khi mặc bộ này?'],
    groups: [{ key: 'feel', items: FEELS }],
    nudge: [['Why do you think schools have uniforms?', 'Theo em, vì sao trường có đồng phục?']],
  },
};
const U_STEPS = ['name', 'top', 'bottom', 'extras', 'draw', 'feel'];

let data = { started: false, count: 0, u: [], done: [], said: 0 };
let root = null;
let popOverlay = null;
let strip = null;
let tipTimer = 0;
let current = null;
let walking = false;
let listening = false;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const host = () => document.getElementById('studio-ui') ?? document.body;
const an = word => (/^[aeiou]/i.test(word) ? 'an ' : 'a ');
const list = items => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

function persist() {
  store.saveMeta({ coach: data });
  renderCells(data);
  targets.setCells(cellRects(BOXES[UNIFORM_BOX].rect, data.count).map(rect => ({ sheet: BOXES[UNIFORM_BOX].sheet, rect })));
}

function uni(i) { return (data.u[i - 1] ??= { extras: [] }); }

// ---- the flow, woven into the Next Star ----

export function weave(steps) {
  const out = [];
  for (const s of steps) {
    if (s === `box:${UNIFORM_BOX}`) {
      out.push('coach:count');
      for (let i = 1; i <= data.count; i++) for (const k of U_STEPS) out.push(`coach:u${i}:${k}`);
    } else if (s === `box:${WEEKEND_BOX}`) {
      out.push('coach:weekend');
    } else {
      out.push(s);
    }
  }
  return out;
}

export function isDone(step) {
  return step === 'count' ? data.count > 0 : data.done.includes(step);
}

function mark(step) {
  if (!data.done.includes(step)) data.done.push(step);
  persist();
  quest.refresh();
}

export function open(step) {
  listen();
  walking = true;
  current = step;
  if (step === 'count') return showCount();
  if (step === 'weekend') return showWeekend();
  if (step === 'think') return showThink();
  const m = /^u(\d+):(\w+)$/.exec(step);
  if (!m) return null;
  const i = Number(m[1]);
  return m[2] === 'draw' ? showDraw(i) : showDetail(i, m[2]);
}

function advance(step) {
  mark(step);
  closeAll();
  quest.go();
}

function previous(step) {
  const flow = weave(['box:' + UNIFORM_BOX]).map(s => s.slice(6));
  return flow[flow.indexOf(step) - 1] ?? null;
}

export function begin() {
  data.started = true;
  persist();
  walking = true;
  listen();
  quest.go();
}

function listen() {
  if (listening) return;
  listening = true;
  on('card:closed', () => {
    if (!walking || root || strip) return;
    const next = quest.next();
    if (next && (next.startsWith('coach:') || next === 'speech')) quest.go();
  });
  on('card:show', ({ id } = {}) => { // the Think step sits on top of the Card, right before the thinking blanks
    if (id === 'p3-uniform-is' && !data.done.includes('think')) open('think');
  });
  on('field:change', () => { if (root?.dataset.kind === 'rehearse') showRehearse(); });
  on('studio:exit', () => { walking = false; closeAll(); });
}

// ---- screens ----

function closeAll() {
  speech.stop();
  const hiddenCard = document.getElementById('studio-card');
  if (hiddenCard) hiddenCard.style.visibility = '';
  popOverlay?.();
  popOverlay = null;
  root?.remove();
  root = null;
  clearInterval(tipTimer);
  strip?.remove();
  strip = null;
}

function frame(kind, stage, [en, vi]) {
  closeAll();
  root = el('div');
  root.id = 'st-coach';
  root.dataset.kind = kind;
  const sheet = el('div', 'co-sheet');
  const head = el('div', 'co-head');
  const [emoji, sEn, sVi] = STAGE[stage];
  head.append(el('span', 'co-stage', `${emoji} ${sEn} · ${sVi}`));
  const x = el('button', 'co-x', '×');
  x.type = 'button';
  x.setAttribute('aria-label', 'Đóng / Close');
  x.addEventListener('click', () => { walking = false; closeAll(); });
  head.append(x);
  const q = el('div', 'co-q');
  const line = el('h2', '', en);
  q.append(line, sayButton(en), el('p', 'co-vi', vi));
  const body = el('div', 'co-body');
  sheet.append(head, q, body);
  root.append(sheet);
  host().append(root);
  popOverlay = shell.pushOverlay(() => { walking = false; closeAll(); });
  return { body, sheet };
}

function sayButton(text) {
  const b = el('button', 'co-say-btn', '🔊');
  b.type = 'button';
  b.setAttribute('aria-label', 'Nghe / Listen');
  b.hidden = !speech.available();
  b.addEventListener('click', () => speech.word(typeof text === 'function' ? text() : text));
  return b;
}

function chip(item, on_, click) {
  const b = el('button', 'co-chip');
  b.type = 'button';
  b.setAttribute('aria-pressed', String(!!on_));
  if (item.sw && !item.e) {
    const dot = el('i', 'co-dot');
    dot.style.background = swatchById(item.sw)?.hex ?? '#ccc';
    b.append(dot);
  } else if (item.e) {
    b.append(el('span', 'co-e', item.e));
  }
  b.append(el('b', '', item.en), el('small', '', item.vi));
  b.addEventListener('click', click);
  return b;
}

function nudges(rows) {
  const box = el('div', 'co-nudge');
  for (const [en, vi] of rows) {
    const row = el('p');
    row.append(el('span', 'co-bulb', '💡'), el('b', '', en), ' ', el('small', '', vi));
    box.append(row);
  }
  return box;
}

function footer({ back, next, nextText = 'Tiếp · Next ▶', skip }) {
  const f = el('div', 'co-foot');
  if (back) {
    const b = el('button', 'co-back', '◀');
    b.type = 'button';
    b.setAttribute('aria-label', 'Quay lại / Back');
    b.addEventListener('click', back);
    f.append(b);
  }
  if (skip) {
    const s = el('button', 'co-skip', 'Bỏ qua · Skip');
    s.type = 'button';
    s.addEventListener('click', skip);
    f.append(s);
  }
  const n = el('button', 'co-next', nextText);
  n.type = 'button';
  n.addEventListener('click', next);
  f.append(n);
  return f;
}

function showCount() {
  const { body } = frame('count', 'see', ['How many different school uniforms do you have?', 'Em có bao nhiêu bộ đồng phục khác nhau?']);
  const say = el('p', 'co-sentence', data.count ? countLine() : 'I have ... school uniforms.');
  const grid = el('div', 'co-nums');
  for (let n = 1; n <= MAX_UNIFORMS; n++) {
    const b = el('button', 'co-num');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(data.count === n));
    b.append(el('b', '', String(n)), el('small', '', WORDS[n]));
    b.addEventListener('click', () => {
      setCount(n);
      for (const k of grid.children) k.setAttribute('aria-pressed', String(k === b));
      say.textContent = countLine();
      speech.word(countLine());
      next.disabled = false;
    });
    grid.append(b);
  }
  body.append(say, grid, nudges([
    ['Think: a uniform for class? For P.E.? For Monday?', 'Hãy nghĩ: đồng phục học trên lớp? Đồng phục thể dục? Đồng phục thứ Hai?'],
    ['Then you will draw each one.', 'Sau đó em sẽ vẽ từng bộ.'],
  ]));
  const f = footer({ next: () => { closeAll(); quest.go(); } });
  const next = f.querySelector('.co-next');
  next.disabled = !data.count;
  body.append(f);
}

function setCount(n) {
  data.count = Math.max(1, Math.min(MAX_UNIFORMS, n));
  data.u.length = Math.min(data.u.length, data.count);
  quest.endLure();
  persist();
  quest.refresh();
}

const countLine = () => (data.count === 1 ? 'I have one school uniform.' : `I have ${WORDS[data.count]} different school uniforms.`);

function nameOf(i) { return data.u[i - 1]?.name ?? (data.count > 1 ? `uniform ${i}` : 'uniform'); }

function uniformLine(i) {
  const u = data.u[i - 1] ?? {};
  const bits = [];
  const top = u.top ? `${an(u.topColor || u.top)}${u.topColor ? u.topColor + ' ' : ''}${u.top}` : '';
  const bottom = u.bottom ? `${u.bottomColor ? u.bottomColor + ' ' : ''}${u.bottom}` : '';
  const article = u.bottom === 'skirt' ? an(u.bottomColor || 'skirt') : '';
  if (top || bottom) bits.push(`My ${nameOf(i)} has ${list([top, article + bottom].filter(Boolean))}.`);
  else bits.push(`This is my ${nameOf(i)}.`);
  if (u.extras?.length) bits.push(`I also wear ${list(u.extras)}.`);
  if (u.when) bits.push(`I wear it ${u.when}.`);
  if (u.feel) bits.push(`I feel ${u.feel} in it.`);
  return bits.join(' ');
}

function fillFromUniform() { // the packet's own script asks for these two colours
  const u = data.u[0] ?? {};
  if (u.topColor && !fields.isFilled('p3-shirt-color')) fields.set('p3-shirt-color', { kind: 'text', text: u.topColor });
  if (u.bottomColor && !fields.isFilled('p3-bottom-color')) fields.set('p3-bottom-color', { kind: 'text', text: u.bottomColor });
}

function showDetail(i, kind) {
  const def = DETAILS[kind];
  const step = `u${i}:${kind}`;
  const u = uni(i);
  const q = kind === 'name' ? def.q(i) : [`${def.q(i)[0]}`, def.q(i)[1]];
  const { body } = frame(step, def.stage, q);
  if (data.count > 1 || kind !== 'name') body.append(el('p', 'co-which', data.count > 1 ? `${i} / ${data.count} · ${nameOf(i)}` : nameOf(i)));
  const say = el('p', 'co-sentence');
  const refresh = () => {
    const line = uniformLine(i);
    say.replaceChildren(el('span', '', line), sayButton(() => uniformLine(i)));
    persist();
  };
  body.append(say);
  for (const g of def.groups) {
    if (g.label) body.append(el('h3', 'co-label', `${g.label[0]} · ${g.label[1]}`));
    const grid = el('div', 'co-chips');
    for (const item of g.items) {
      const isOn = () => (g.multi ? (u[g.key] ?? []).includes(item.en) : u[g.key] === item.en);
      const b = chip(item, isOn(), () => {
        if (g.multi) {
          const have = u[g.key] ?? (u[g.key] = []);
          if (have.includes(item.en)) have.splice(have.indexOf(item.en), 1); else have.push(item.en);
          if (item.st) u.extraSt = [...new Set([...(u.extraSt ?? []), item.st])];
        } else {
          const was = u[g.key] === item.en;
          u[g.key] = was ? undefined : item.en;
          if (g.key === 'name') u.when = was ? undefined : item.when;
          if (g.key === 'top') u.topSt = was ? undefined : item.st;
          if (g.key === 'bottom') u.bottomSt = was ? undefined : item.st;
          if (g.key === 'topColor') u.topSw = was ? undefined : item.sw;
          if (g.key === 'bottomColor') u.bottomSw = was ? undefined : item.sw;
          for (const k of grid.children) if (k !== b) k.setAttribute('aria-pressed', 'false');
        }
        b.setAttribute('aria-pressed', String(isOn()));
        speech.word(item.en.replace(/^an? /, ''));
        if (i === 1) fillFromUniform();
        refresh();
      });
      grid.append(b);
    }
    body.append(grid);
  }
  body.append(nudges(def.nudge));
  refresh();
  const back = previous(step);
  body.append(footer({ back: back ? () => { closeAll(); open(back); } : null, skip: () => advance(step), next: () => advance(step) }));
}

// ---- drawing with the guide beside you ----

function suggestionsFor(i) {
  const u = data.u[i - 1] ?? {};
  const out = [];
  if (u.topSt) out.push({ en: `${u.topColor ? u.topColor + ' ' : ''}${u.top}`, vi: 'áo của em', e: '👕', st: u.topSt, sw: u.topSw, kind: 'top' });
  if (u.bottomSt) out.push({ en: `${u.bottomColor ? u.bottomColor + ' ' : ''}${u.bottom}`, vi: 'phần dưới', e: '🩳', st: u.bottomSt, sw: u.bottomSw, kind: 'bottom' });
  for (const st of u.extraSt ?? []) out.push({ en: st, vi: '', e: st === 'backpack' ? '🎒' : '🩴', st, kind: 'extra' });
  for (const st of [['star', '⭐'], ['heart', '❤️'], ['child', '🧒']]) out.push({ en: st[0], vi: '', e: st[1], st: st[0], kind: 'extra' });
  return out;
}

function slot(rect, kind, n) {
  const m = Math.min(rect.w, rect.h), cx = rect.x + rect.w / 2;
  if (kind === 'top') return { cx, cy: rect.y + rect.h * .36, size: m * .62 };
  if (kind === 'bottom') return { cx, cy: rect.y + rect.h * .74, size: m * .46 };
  return { cx: rect.x + rect.w * (.2 + .3 * (n % 3)), cy: rect.y + rect.h * .2, size: m * .26 };
}

function drawStrip(step, [en, vi], rect, items, tips, sheet) {
  closeAll();
  strip = el('div');
  strip.id = 'st-coach-strip';
  const row = el('div', 'co-strip-top');
  const text = el('p', 'co-strip-q');
  text.append(el('b', '', en), el('small', '', vi));
  const done = el('button', 'co-next', 'Xong · Done ✓');
  done.type = 'button';
  done.addEventListener('click', () => advance(step));
  row.append(text, done);
  const chips = el('div', 'co-strip-chips st-scroll');
  let extras = 0;
  for (const item of items) {
    const b = el('button', 'co-mini');
    b.type = 'button';
    b.append(el('span', '', item.e), el('b', '', item.en));
    b.addEventListener('click', () => {
      const o = objects.add({ sticker: item.st, sheet, ...slot(rect, item.kind, extras++) });
      if (o && item.sw) objects.pour(o, item.sw);
      speech.word(item.en);
    });
    chips.append(b);
  }
  const tip = el('p', 'co-strip-tip');
  let t = 0;
  const showTip = () => {
    const [a, b] = tips[t++ % tips.length];
    tip.replaceChildren(el('span', '', '💡 '), el('b', '', a), ' ', el('small', '', b));
  };
  showTip();
  tipTimer = setInterval(showTip, TIP_MS);
  strip.append(row, chips, tip);
  host().append(strip);
}

function showDraw(i) {
  const rects = cellRects(BOXES[UNIFORM_BOX].rect, Math.max(1, data.count));
  const rect = rects[i - 1] ?? BOXES[UNIFORM_BOX].rect;
  if (state.get('tool') === 'stickers' || state.get('tool') === 'fill') state.set('tool', state.get('lastDraw') || 'crayon');
  shell.enterBox(UNIFORM_BOX, { cell: rect });
  drawStrip(`u${i}:draw`, [`Draw your ${nameOf(i)}!`, `Vẽ bộ đồng phục ${data.count > 1 ? i : ''} của em nhé!`.replace('  ', ' ')], rect, suggestionsFor(i), DRAW_TIPS, BOXES[UNIFORM_BOX].sheet);
}

function showWeekend() {
  const { rect, sheet } = BOXES[WEEKEND_BOX];
  if (state.get('tool') === 'stickers' || state.get('tool') === 'fill') state.set('tool', state.get('lastDraw') || 'crayon');
  shell.enterBox(WEEKEND_BOX);
  drawStrip('weekend', ['Now draw your weekend clothes!', 'Giờ vẽ quần áo cuối tuần của em nhé!'], rect, WEEKEND_STICKERS, WEEKEND_TIPS, sheet);
}

function showThink() {
  const { body } = frame('think', 'think', ['Why do we wear different clothes in different places?', 'Vì sao chúng ta mặc quần áo khác nhau ở những nơi khác nhau?']);
  const card = document.getElementById('studio-card'); // the Card waits underneath, it sits in a higher layer
  if (card) card.style.visibility = 'hidden';
  const compare = el('div', 'co-compare');
  const uniformWords = data.u.map((_, k) => nameOf(k + 1)).join(', ') || 'my uniform';
  const weekend = fields.get('p3-weekend-wear');
  const left = el('div');
  left.append(el('b', '', 'At school · Ở trường'), el('p', '', uniformWords));
  const right = el('div');
  right.append(el('b', '', 'On the weekend · Cuối tuần'), el('p', '', weekend?.text || 'my weekend clothes'));
  compare.append(left, right);
  body.append(compare, nudges([
    ['How are they different?', 'Chúng khác nhau thế nào?'],
    ['Who chooses them: you or your school?', 'Ai chọn: em hay nhà trường?'],
    ['What can you do in them? Learn? Run? Relax?', 'Mặc chúng em làm được gì? Học? Chạy? Nghỉ ngơi?'],
    ['Use the word "because".', 'Hãy dùng từ "because" (bởi vì).'],
  ]));
  body.append(footer({ next: () => { mark('think'); closeAll(); } }));
}

// ---- going over the speech ----

const T = (...tokens) => tokens;

function speechParts() {
  const parts = [
    { title: ['Hello', 'Xin chào'], lines: [T('Hello everyone! My name is ', { f: 'p3-name' }, '. This is my clothes poster.')] },
    { title: ['My clothes now', 'Quần áo em đang mặc'], lines: [T('Today, I am wearing a ', { f: 'p3-now-color' }, ' ', { f: 'p3-now-clothes' }, '.')] },
    { title: ['My favorite clothes', 'Quần áo em thích nhất'], lines: [T('My favorite clothes are my ', { f: 'p3-fav-clothes' }, '.'), T('I like them because they are ', { f: 'p3-fav-why' }, '.')] },
  ];
  const school = data.count ? [T(countLine())] : [T('At school, I wear my uniform.')];
  for (let i = 1; i <= data.count; i++) school.push(T(uniformLine(i)));
  if (!data.count) school.push(T('My uniform has a ', { f: 'p3-shirt-color' }, ' shirt and ', { f: 'p3-bottom-color' }, ' shorts / skirt.'));
  school.push(T('My uniform helps me feel ready to learn.'));
  parts.push({ title: ['My school uniform', 'Đồng phục của em'], lines: school });
  parts.push({ title: ['My weekend clothes', 'Quần áo cuối tuần'], lines: [T('On the weekend, I wear ', { f: 'p3-weekend-wear' }, '.'), T('I wear them because I like to ', { f: 'p3-weekend-like' }, '.')] });
  parts.push({ title: ['My thinking answer', 'Câu trả lời suy nghĩ'], lines: [
    T('My uniform and my weekend clothes are different.'),
    T('My uniform is ', { f: 'p3-uniform-is' }, ', but my weekend clothes are ', { f: 'p3-weekend-are' }, '.'),
    T('I wear different clothes because at school I ', { f: 'p3-at-school' }, ', and at home I ', { f: 'p3-at-home' }, '.'),
  ] });
  parts.push({ title: ['Goodbye', 'Tạm biệt'], lines: [T('Thank you for watching my video! Goodbye!')] });
  return parts;
}

const fieldText = id => { const v = fields.get(id); return v?.text ?? ''; };
const lineText = tokens => tokens.map(k => (typeof k === 'string' ? k : fieldText(k.f))).join('');

function renderLine(tokens) {
  const row = el('div', 'co-line');
  const p = el('p');
  for (const k of tokens) {
    if (typeof k === 'string') { p.append(k); continue; }
    const v = fields.get(k.f);
    if (v?.kind === 'ink' && isSafeInk(v.src)) {
      const img = new Image();
      img.src = v.src;
      img.alt = '';
      img.className = 'co-ink';
      p.append(img);
    } else if (v?.text) {
      p.append(el('b', 'co-w', v.text));
    } else {
      const gap = el('button', 'co-gap', '______');
      gap.type = 'button';
      gap.setAttribute('aria-label', 'Điền vào / Fill in');
      gap.addEventListener('click', () => fields.open(k.f));
      p.append(gap);
    }
  }
  row.append(sayButton(() => lineText(tokens)), p);
  row.dataset.say = '1';
  row.__text = () => lineText(tokens);
  return row;
}

export function rehearse() {
  listen();
  walking = false;
  showRehearse();
}

function showRehearse() {
  const keepTop = root?.dataset.kind === 'rehearse' ? root.querySelector('.co-body').scrollTop : 0;
  const { body } = frame('rehearse', 'say', ['Let\'s go over your speech before you record!', 'Cùng xem lại bài nói trước khi quay video nhé!']);
  const hear = el('button', 'co-hear', '🔊 Nghe cả bài · Hear it all');
  hear.type = 'button';
  hear.hidden = !speech.available();
  const rows = [];
  hear.addEventListener('click', async () => {
    for (const row of rows) {
      row.classList.add('co-now');
      row.scrollIntoView({ block: 'nearest' });
      const ok = await speech.word(row.__text());
      row.classList.remove('co-now');
      if (!ok || !root) break;
    }
  });
  body.append(hear);
  let gaps = 0;
  for (const part of speechParts()) {
    const box = el('section', 'co-part');
    box.append(el('h3', 'co-label', `${part.title[0]} · ${part.title[1]}`));
    for (const tokens of part.lines) {
      gaps += tokens.filter(k => typeof k !== 'string' && !fields.isFilled(k.f)).length;
      const row = renderLine(tokens);
      rows.push(row);
      box.append(row);
    }
    body.append(box);
  }
  if (gaps) body.append(nudges([[`${gaps} blank${gaps > 1 ? 's' : ''} left: tap a line to fill it in.`, `Còn ${gaps} chỗ trống: chạm vào để điền nhé.`]]));
  body.append(nudges([
    ['Say your speech 2 times before you record.', 'Hãy nói bài của em 2 lần trước khi quay.'],
    ['Face the window. Put the camera at your eyes.', 'Quay mặt về phía cửa sổ. Để camera ngang tầm mắt.'],
    ['Talk slowly and loudly. Point to each picture.', 'Nói chậm và to. Chỉ vào từng hình khi nói.'],
  ]));
  const count = el('button', 'co-said');
  count.type = 'button';
  const paint = () => { count.textContent = `${'⭐'.repeat(Math.min(data.said, 2))}${'☆'.repeat(Math.max(0, 2 - data.said))} Em đã nói xong · I said it!`; };
  paint();
  count.addEventListener('click', () => { data.said = Math.min(2, data.said + 1); persist(); paint(); rec.classList.toggle('co-ready', data.said >= 2); });
  const rec = el('button', 'co-next', '🎥 Sẵn sàng quay · Ready to record');
  rec.type = 'button';
  rec.classList.toggle('co-ready', data.said >= 2);
  rec.addEventListener('click', () => { quest.mark('speech'); closeAll(); shell.goRecord({ ready: true }); });
  const foot = el('div', 'co-foot');
  foot.append(count, rec);
  body.append(foot);
  body.scrollTop = keepTop;
}

// ---- lifecycle ----

export function init(saved) {
  closeAll();
  data = { started: false, count: 0, u: [], done: [], said: 0, ...(saved ?? {}) };
  data.u = Array.isArray(data.u) ? data.u : [];
  data.done = Array.isArray(data.done) ? data.done : [];
  renderCells(data);
  targets.setCells(cellRects(BOXES[UNIFORM_BOX].rect, data.count).map(rect => ({ sheet: BOXES[UNIFORM_BOX].sheet, rect })));
  listen();
}

export function reset() { init(null); }
export const started = () => !!data.started;
