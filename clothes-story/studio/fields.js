// Everything a child writes on the paper: answers, name, signature, date, ticks. FieldValue is section 7.1.
// Values are kept by key: 'name' for both name fields, the data-f id for the rest. Unknown keys from storage stay
// in all() and are never shown (section 7.4).
import { emit } from './bus.js?v=1';
import * as card from './card.js?v=1';
import { FIELD_ALIAS, LIMITS, TICK_IDS } from './constants.js?v=1';
import { log } from './diag.js?v=1';
import { fitAnswer, isSafeInk, renderAnswer } from './fit.js?v=1';
import * as shell from './shell.js?v=1';
import { get as getState } from './state.js?v=1';

let values = {};
let targets = null;  // data-f id -> element
let fontAsked = false;

const keyOf = id => FIELD_ALIAS[id] ?? id;

function targetMap() {
  if (!targets) {
    targets = new Map();
    for (const el of document.querySelectorAll('.sheet [data-f]')) targets.set(el.dataset.f, el);
  }
  return targets;
}

// The data-f ids that show this key: both name fields for 'name'.
function idsOf(key) {
  const aliased = Object.keys(FIELD_ALIAS).filter(id => FIELD_ALIAS[id] === key);
  return aliased.length ? aliased : [key];
}

// A hidden sheet has no layout to fit against, so all sheets are laid out for the moment of the call. Nothing paints.
function whileLaidOut(fn) {
  const book = document.querySelector('.book');
  const had = !book || book.classList.contains('measure');
  book?.classList.add('measure');
  try {
    fn();
  } finally {
    if (!had) book.classList.remove('measure');
  }
}

function show(key, value) {
  for (const id of idsOf(key)) {
    const el = targetMap().get(id);
    if (!el) continue;
    if (el.tagName === 'LI' || el.offsetWidth) renderAnswer(el, value);
    else whileLaidOut(() => renderAnswer(el, value));
  }
}

// Playpen Hand loads on first need. The text argument pulls the Vietnamese subset as well (section 3.3).
export function ensureFont() {
  if (fontAsked || !document.fonts?.load) return;
  fontAsked = true;
  document.fonts.load('500 20px "Playpen Hand"', 'ệa').then(fitAll, err => log('fields', 'font: ' + err.message));
}

export function cleanText(text) {
  return String(text ?? '').normalize('NFC').replace(/[\r\n]+/g, ' ').trim()
    .slice(0, LIMITS.answerMaxChars).replace(/[\uD800-\uDBFF]$/, '');
}

function cleaned(value) {
  switch (value?.kind) {
    case 'text':
    case 'chip': {
      const text = cleanText(value.text);
      return text ? { ...value, text } : null;
    }
    case 'ink':
      if (isSafeInk(value.src)) return { kind: 'ink', src: value.src };
      log('fields', 'refused handwriting that is not a PNG data URL');
      return null;
    case 'tick':
      return value.on ? { kind: 'tick', on: true } : null;
    default:
      return null;
  }
}

const sameValue = (a, b) => a?.kind === b?.kind && a?.text === b?.text && a?.chipId === b?.chipId && a?.src === b?.src && a?.on === b?.on;

export function init(saved) {
  values = saved && typeof saved === 'object' ? { ...saved } : {};
  targets = null;
  whileLaidOut(() => {
    for (const id of targetMap().keys()) renderAnswer(targetMap().get(id), values[keyOf(id)] ?? null);
  });
  if (Object.values(values).some(v => v?.kind === 'text' || v?.kind === 'chip')) ensureFont();
}

export function get(id) {
  return values[keyOf(id)] ?? null;
}

export function set(id, value) {
  const key = keyOf(id);
  const next = cleaned(value);
  const old = values[key] ?? null;
  if (sameValue(old, next) || (!old && !next)) return;
  if (next) {
    next.t = Date.now();
    values[key] = next;
  } else {
    delete values[key];
  }
  if (next?.kind === 'text' || next?.kind === 'chip') ensureFont();
  show(key, next);
  emit('field:change', { id: key, value: next });
}

export function toggleTick(id) {
  if (getState('readOnly')) { shell.note('note.tab'); return; }
  set(id, get(id)?.on ? null : { kind: 'tick', on: true });
}

export function open(id) {
  if (TICK_IDS.includes(id)) { toggleTick(id); return; }
  if (getState('readOnly')) { shell.note('note.tab'); return; }
  card.open(id);
}

export function all() {
  return { ...values };
}

export function fitAll() {
  whileLaidOut(() => {
    for (const el of targetMap().values()) fitAnswer(el);
  });
}

export function isFilled(id) {
  const v = get(id);
  if (!v) return false;
  if (v.kind === 'tick') return !!v.on;
  if (v.kind === 'ink') return isSafeInk(v.src);
  return !!v.text;
}
