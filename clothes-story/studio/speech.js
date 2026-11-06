// English read aloud through speechSynthesis, only ever after a tap. Nothing here is required for the page to work:
// with no voices, or with the voice turned off in the menu, every call still resolves and Hear my speech walks silently.
import { on } from './bus.js?v=1';
import { log } from './diag.js?v=1';
import * as fields from './fields.js?v=1';
import * as shell from './shell.js?v=1';
import { get as getState } from './state.js?v=1';
import * as viewport from './viewport.js?v=1';
import { SCRIPT, SENTENCES } from './words.js?v=1';

const LANG = 'en-US', RATE = .85;
const VOICE_WAIT_MS = 1500;
const PAUSE_MS = 450;          // where a blank is empty or handwritten
const MS_PER_CHAR = 80;        // a slow voice, and the pace of the silent walk
const WATCHDOG_EXTRA_MS = 2500; // some Android engines never fire onend
const SPEECH_SHEET = 3;
const STYLE_ID = 'studio-speech-style';
const STYLE = '@media screen{html.paper .part.speaking{position:relative;background:rgba(255,229,0,.14)}'
  + 'html.paper .part.speaking::before{content:"";position:absolute;left:-14px;top:3px;bottom:3px;width:6px;border-radius:3px;background:#C99A1E}}';

let run = 0;              // every word, sentence, script and stop takes a new number; older ones give up
let current = null;       // holds the utterance: Chrome can collect one before its onend fires
let walk = null;          // the Hear my speech in progress: {onEnd, offs}
let voiceWait = null;

const api = () => (window.speechSynthesis && window.SpeechSynthesisUtterance ? window.speechSynthesis : null);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const isEnglish = v => /^en([-_]|$)/i.test(v.lang);

function voicesReady() {
  const s = api();
  if (!s) return Promise.resolve([]);
  voiceWait ??= new Promise(resolve => {
    if (s.getVoices().length) { resolve(); return; }
    let timer = 0;
    const done = () => {
      clearTimeout(timer);
      s.removeEventListener?.('voiceschanged', done);
      resolve();
    };
    timer = setTimeout(done, VOICE_WAIT_MS);
    s.addEventListener?.('voiceschanged', done);
  });
  return voiceWait;
}

// true, or false only when this browser has no speech at all, or 'unknown' while no English voice has shown up:
// cheap Android phones can list none and still speak, so only a definite false may hide a speaker.
export function available() {
  const s = api();
  if (!s) return false;
  voicesReady();
  return s.getVoices().some(isEnglish) ? true : 'unknown';
}

// On-device voices only: a cloud voice would send the child's name and words off the device. With none, the browser picks by lang.
function pickVoice() {
  const english = api().getVoices().filter(v => isEnglish(v) && v.localService);
  const american = english.filter(v => /^en[-_]US/i.test(v.lang));
  const pool = american.length ? american : english;
  return pool.find(v => /Samantha|Zira|Jenny|Aria|Allison|Ava/i.test(v.name)) ?? pool.find(v => v.default) ?? pool[0] ?? null;
}

function utter(text) {
  return new Promise(resolve => {
    const s = api();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANG;
    u.rate = RATE;
    const voice = pickVoice();
    if (voice) u.voice = voice;
    let timer = 0;
    const done = spoken => {
      clearTimeout(timer);
      if (current === u) current = null;
      resolve(spoken);
    };
    u.onend = () => done(true);
    u.onerror = e => {
      if (e.error !== 'canceled' && e.error !== 'interrupted') log('speech', 'utterance failed: ' + e.error);
      done(false);
    };
    timer = setTimeout(() => done(true), text.length * MS_PER_CHAR * 2 + WATCHDOG_EXTRA_MS);
    current = u;
    s.cancel();
    s.resume?.(); // Chrome can come back from the background paused, and then speak() stays silent
    s.speak(u);
  });
}

const canSpeak = () => !!api() && !getState('muted');

function fieldText(id) {
  const value = fields.get(id);
  return value && (value.kind === 'text' || value.kind === 'chip') ? value.text : '';
}

// Text runs and pauses. A filled blank joins the sentence, an empty or handwritten one splits it with a pause.
function segments(say, { opt } = {}) {
  const out = [];
  let text = '';
  const flush = () => {
    if (/[a-z0-9]/i.test(text)) out.push({ text: text.replace(/\s+\/\s+/g, ' or ').replace(/^[\s,.]+/, '').trim() });
    text = '';
  };
  for (const token of say) {
    if (typeof token === 'string') { text += token; continue; }
    const value = fieldText(token.f);
    if (value) { text += value; continue; }
    if (opt) return [];
    flush();
    out.push({ pause: PAUSE_MS });
  }
  flush();
  return out;
}

async function speakAll(list, mine, silent) {
  for (const seg of list) {
    if (mine !== run) return false;
    if (seg.pause) await wait(seg.pause);
    else if (silent) await wait(seg.text.length * MS_PER_CHAR);
    else await utter(seg.text);
  }
  return mine === run;
}

// Speak one word on tap. Resolves true when it finished, false if it could not or something else took over.
export function word(text) {
  endWalk(true);
  const mine = ++run;
  if (!text || !canSpeak()) return Promise.resolve(false);
  return utter(String(text)).then(spoken => spoken && mine === run);
}

const toTokens = ({ en, blanks }) => en.split('___').flatMap((text, i, all) => (i < all.length - 1 ? [text, { f: blanks[i] }] : [text]));

// Speak the sentence of a blank with the child's words in it.
export function sentence(id) {
  endWalk(true);
  const mine = ++run;
  const s = SENTENCES[id];
  if (!s?.en || !canSpeak()) return Promise.resolve(false);
  return speakAll(segments(toTokens(s)), mine, false);
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.append(style);
}

function markSpeaking(el) {
  for (const part of document.querySelectorAll('.part.speaking')) part.classList.remove('speaking');
  el?.classList.add('speaking');
}

// With a mouse the page can be taller than the screen, so the part being read is brought into view.
function bringIntoView(el) {
  const frame = document.querySelector('.page')?.getBoundingClientRect();
  if (!el || !frame) return;
  const r = el.getBoundingClientRect();
  if (r.bottom > frame.bottom) viewport.panBy(0, frame.bottom - r.bottom - 12);
  else if (r.top < frame.top) viewport.panBy(0, frame.top - r.top + 12);
}

function endWalk(stopped) {
  if (!walk) return;
  const { onEnd, offs } = walk;
  walk = null;
  for (const off of offs) off();
  markSpeaking(null);
  try { onEnd?.({ stopped }); } catch (err) { log('speech', 'onEnd: ' + err.message); }
}

// iOS unlocks speech only inside a tap, and a page change takes longer than a tap lasts.
function unlock() {
  const s = api();
  if (!s) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  s.speak(u);
}

// Hear my speech: page 3 shows, and each part is marked .speaking while it is read. onPart(number, element) on each
// part, onEnd({stopped}) exactly once, also after stop().
export function script({ onPart, onEnd } = {}) {
  stop();
  const mine = run;
  const silent = !canSpeak();
  ensureStyle();
  walk = {
    onEnd,
    offs: [on('studio:exit', stop), on('page:shown', ({ n }) => { if (n !== SPEECH_SHEET) stop(); })],
  };
  const start = async () => {
    if (getState('page') !== SPEECH_SHEET) {
      if (!silent) unlock();
      await shell.showPage(SPEECH_SHEET);
    }
    const parts = document.querySelectorAll(`.sheet[data-sheet="${SPEECH_SHEET}"] .part`);
    for (const { part, lines } of SCRIPT) {
      if (mine !== run) return;
      const el = parts[part - 1];
      markSpeaking(el);
      bringIntoView(el);
      onPart?.(part, el);
      for (const line of lines) {
        if (!await speakAll(segments(line.say, line), mine, silent)) return;
      }
    }
    if (mine === run) endWalk(false);
  };
  start().catch(err => {
    log('speech', 'script: ' + err.message);
    if (mine === run) endWalk(true);
  });
}

// Stops whatever is speaking and ends a Hear my speech walk.
export function stop() {
  run++;
  endWalk(true);
  api()?.cancel();
}
