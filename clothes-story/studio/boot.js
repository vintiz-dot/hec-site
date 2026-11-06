// The only Studio code that runs on page load. Without it, or with ?nostudio=1, the packet is exactly today's page.
import { STORAGE, STUDIO_ENABLED } from './constants.js?v=1';
import { on } from './bus.js?v=1';
import { applyLabels, t } from './labels.js?v=1';

const root = document.documentElement;
const params = new URLSearchParams(location.search);
const GUARD = 'hec-studio-entering';
const INAPP = /Zalo|FBAN|FBAV|FB_IAB|Messenger|Instagram/i;
const CRAYON = '<svg viewBox="0 0 64 44" width="64" height="44" aria-hidden="true" focusable="false" fill="none" stroke="#16224A" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path class="st-sc" pathLength="1" stroke="#F2594B" stroke-width="3.4" d="M6 35c5-9 8-9 11-2s7 6 10 0 6-8 10-2 6 5 9-1"/><g class="st-cr"><path fill="#F2594B" d="M46 30 44 19l9-14 3 2 3 2-8 15Z"/><path fill="#FFFEFB" d="M47.800 16.200 57 2.700l3.500 2.300-9.200 13.500Z" transform="translate(0 2)"/><path fill="#F2594B" d="m44.800 24.300 1.200 5.700 5-3Z"/></g></svg>';

let cta = null, shellModule = null, readingInk = null, printing = false, printY = 0;

const has = key => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const session = (fn, fallback) => { try { return fn(sessionStorage); } catch { return fallback; } };

function gate() {
  return STUDIO_ENABLED && !params.has('nostudio') && !!window.PointerEvent && !!window.Path2D
    && !!HTMLCanvasElement.prototype.toBlob && !!window.CSS?.supports?.('isolation', 'isolate');
}

function showNote(key) {
  let box = document.getElementById('studio-reading-note');
  if (!box) {
    box = document.createElement('p');
    box.id = 'studio-reading-note';
    box.setAttribute('role', 'status');
    document.body.append(box);
  }
  box.dataset.l = key;
  applyLabels(box);
}

function label() {
  cta.querySelector('b').dataset.l = has(STORAGE.hasWork) ? 'cta.resume' : 'cta.start';
  applyLabels(cta);
}

function loadReadingInk() {
  if (!has(STORAGE.hasWork)) return;
  import('./reading-ink.js?v=1').then(m => { readingInk = m; return m.refresh(); }).catch(() => {});
}

async function enter(args) {
  if (cta.classList.contains('busy')) return;
  cta.classList.add('busy');
  try {
    shellModule ??= await import('./shell.js?v=1');
    await shellModule.enter(args);
  } catch {
    root.classList.remove('paper');
    showNote('note.enterFail');
  }
  cta.classList.remove('busy');
}

// iOS opens the keyboard only inside the tap itself, and entering is async: focus a hidden field now, the Card takes it over.
function primeKeyboard() {
  const i = document.createElement('input');
  i.setAttribute('aria-hidden', 'true');
  i.tabIndex = -1;
  i.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0';
  document.body.append(i);
  i.focus();
  setTimeout(() => i.remove(), 6000);
}

function onRecordLink(e) {
  const link = e.target.closest?.('a[href*="record.html"]');
  if (!link || root.classList.contains('paper')) return;
  e.preventDefault();
  enter({ rehearse: true });
}

function onBookClick(e) {
  if (root.classList.contains('paper')) return;
  const hit = e.target.closest?.('.draw[data-box],.blank[data-f]');
  if (!hit) return;
  if (hit.dataset.f === 'p1-name' || hit.dataset.f === 'p3-name') primeKeyboard();
  enter(hit.dataset.box ? { box: hit.dataset.box } : { target: hit.dataset.f });
}

function injectCta() {
  cta = document.createElement('button');
  cta.id = 'studio-reading-cta';
  cta.type = 'button';
  cta.innerHTML = `${CRAYON}<b></b>`;
  cta.addEventListener('click', () => { if (!has(STORAGE.hasWork)) primeKeyboard(); enter({}); });
  document.addEventListener('click', onRecordLink);
  document.body.append(cta);
  root.classList.add('st-ready');
  label();
  document.querySelector('.book')?.addEventListener('click', onBookClick);
  if (INAPP.test(navigator.userAgent)) showNote('note.inapp');
  on('lang:change', () => {
    label();
    applyLabels(document.getElementById('studio-reading-note'));
  });
  on('studio:abort', () => showNote('note.enterFail'));
  on('studio:left', () => { label(); loadReadingInk(); });
}

// Amendment A2: printing the reading view also gives the four A4 pages, with the child's work. Studio has its own path.
function onBeforePrint() {
  if (root.classList.contains('paper')) return;
  printing = true;
  printY = window.scrollY;
  root.classList.add('st-settled');
  root.classList.add('paper');
  readingInk?.fitForPrint();
}

function onAfterPrint() {
  if (!printing) return;
  printing = false;
  root.classList.remove('paper');
  window.scrollTo(0, printY);
}

function start() {
  if (!gate()) return;
  injectCta();
  window.addEventListener('beforeprint', onBeforePrint);
  window.addEventListener('afterprint', onAfterPrint);
  if (params.has('diag')) import('./diag.js?v=1').then(m => m.showPanel());
  if (params.has('test')) import('./shell.js?v=1').then(m => { shellModule = m; m.expose(); });
  if (location.hash === '#ve') {
    if (session(s => s.getItem(GUARD), null)) { // the last try never reached healthy: stay on the plain page
      session(s => s.removeItem(GUARD));
      history.replaceState(null, '', location.pathname + location.search);
    } else {
      enter({});
      return;
    }
  }
  if (document.readyState === 'complete') loadReadingInk();
  else window.addEventListener('load', loadReadingInk, { once: true });
}

start();
