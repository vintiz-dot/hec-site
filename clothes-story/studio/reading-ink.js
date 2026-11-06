// Saved work for the reading view (amendment A2): ink as <img class="ink"> and answers as .ans, all hidden on screen by
// paper.css, so printing from the reading view gives the same four A4 pages as printing from Studio.
// Imports stay small because this loads on every return visit, and it must never create the database.
import { BOXES, FIELD_ALIAS, STORAGE } from './constants.js?v=1';
import { log } from './diag.js?v=1';
import { fitAnswer, renderAnswer, renderCells } from './fit.js?v=1';
import { get as getState } from './state.js?v=1';
import { setHasInk } from './targets.js?v=1';

const OPEN_WAIT_MS = 4000;
const LIST_WAIT_MS = 1000;

const urls = new Map();  // sheet -> the object URL this module made for it
let generation = 0;

function deleteEmptyDatabase() {
  try { indexedDB.deleteDatabase(STORAGE.db); } catch (err) { log('reading-ink', 'delete: ' + err.message); }
}

function readAll(db) {
  return new Promise((resolve, reject) => {
    const saved = { sheets: [], fields: {}, meta: {} };
    const tx = db.transaction(['sheets', 'kv'], 'readonly');
    tx.objectStore('sheets').getAll().onsuccess = e => { saved.sheets = e.target.result; };
    tx.objectStore('kv').get('fields').onsuccess = e => { saved.fields = e.target.result?.values ?? {}; };
    tx.objectStore('kv').get('meta').onsuccess = e => { saved.meta = e.target.result ?? {}; };
    tx.oncomplete = () => resolve(saved);
    tx.onabort = () => reject(tx.error ?? new Error('read aborted'));
  });
}

// Where the browser can list its databases, a missing one is never even opened.
async function knownMissing() {
  try {
    const list = await Promise.race([indexedDB.databases(), new Promise(resolve => setTimeout(resolve, LIST_WAIT_MS))]);
    return !!list && !list.some(d => d.name === STORAGE.db);
  } catch {
    return false;
  }
}

function openAndRead() {
  return new Promise((resolve, reject) => {
    let wasMissing = false, expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error('open did not answer')); }, OPEN_WAIT_MS);
    const req = indexedDB.open(STORAGE.db);  // no version: an existing database opens as it is, with no upgrade
    req.onupgradeneeded = e => {
      wasMissing = e.oldVersion === 0;
      req.transaction.abort();
    };
    req.onerror = e => {
      e.preventDefault();
      clearTimeout(timer);
      if (!wasMissing) { reject(req.error); return; }
      deleteEmptyDatabase();  // the abort should have removed it, but this is cheap and harmless if it did
      resolve(null);
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      if (expired) { db.close(); return; }
      db.onversionchange = () => db.close();  // never stand in the way of Start over in another tab
      if (!db.objectStoreNames.contains('sheets') || !db.objectStoreNames.contains('kv')) {
        db.close();
        deleteEmptyDatabase();
        resolve(null);
        return;
      }
      readAll(db).then(resolve, reject).finally(() => db.close());
    };
  });
}

// Resolves to the saved work, or null when there is no database. Rejects when one exists but cannot be read right now.
export async function readSaved() {
  return (await knownMissing()) ? null : openAndRead();
}

function placeInk(sheetEl, record) {
  const n = Number(sheetEl.dataset.sheet);
  const old = urls.get(n);
  urls.delete(n);
  let img = sheetEl.querySelector(':scope>img.ink');
  if (record?.hasInk && record.ink instanceof ArrayBuffer && record.ink.byteLength) {
    if (!img) {
      img = document.createElement('img');
      img.className = 'ink';
      img.alt = '';
      img.decoding = 'sync';  // printing paints once and cannot wait for a late decode
      sheetEl.prepend(img);
    }
    const url = URL.createObjectURL(new Blob([record.ink], { type: 'image/png' }));
    urls.set(n, url);
    img.src = url;
    img.decode().catch(err => log('reading-ink', `sheet ${n} did not decode: ${err.message}`));
  } else if (img) {
    img.removeAttribute('src');
  }
  if (old) URL.revokeObjectURL(old);
}

function placeFields(fields) {
  let hasText = false;
  for (const el of document.querySelectorAll('.sheet [data-f]')) {
    const value = fields[FIELD_ALIAS[el.dataset.f] ?? el.dataset.f] ?? null;
    renderAnswer(el, value);
    hasText ||= !!value?.text;
  }
  return hasText;
}

// Written as an array by store.js. An object of flags is read too, in case the shape ever changes.
function placeBoxes(boxesInk) {
  const on = id => (Array.isArray(boxesInk) ? boxesInk.includes(id) : !!boxesInk?.[id]);
  for (const id of Object.keys(BOXES)) setHasInk(id, on(id));
}

// The font must be here before beforeprint, which cannot wait. The text pulls both the Latin and Vietnamese subsets.
function loadAnswerFont() {
  document.fonts?.load('500 20px "Playpen Hand"', 'ệa').catch(err => log('reading-ink', 'font: ' + err.message));
}

function place(saved) {
  const bySheet = new Map(saved.sheets.map(r => [r.sheet, r]));
  for (const sheetEl of document.querySelectorAll('.sheet[data-sheet]')) placeInk(sheetEl, bySheet.get(Number(sheetEl.dataset.sheet)));
  if (placeFields(saved.fields)) loadAnswerFont();
  placeBoxes(saved.meta.boxesInk);
  renderCells(saved.meta.coach);
  for (const old of document.querySelectorAll('.sheet>img.st-obj')) old.remove();
  for (const o of Array.isArray(saved.meta.objects) ? saved.meta.objects : []) {
    if (!/^data:image\/(png|webp);base64,/.test(o?.png ?? '')) continue;
    const img = new Image();
    img.className = 'st-obj';
    img.alt = '';
    img.src = o.png;
    const w = o.size * 260 / 240;
    img.style.cssText = `width:${w}px;height:${w}px;transform:translate(${o.cx - w / 2}px,${o.cy - w / 2}px) rotate(${o.rot}rad)`;
    document.querySelector(`.sheet[data-sheet="${Number(o.sheet)}"]`)?.append(img);
  }
}

export async function refresh() {
  const run = ++generation;
  let saved;
  try {
    saved = await readSaved();
  } catch (err) {
    log('reading-ink', 'not read: ' + (err?.message ?? err));  // locked, blocked or broken: the page just prints without the work
    return;
  }
  if (run !== generation) return;
  if (document.documentElement.classList.contains('paper')) return;  // Studio opened meanwhile and owns all of this now
  if (getState('mode') === 'memory') return;  // storage failed, so the sheets hold newer work than anything that can be read
  try {
    place(saved ?? { sheets: [], fields: {}, meta: {} });
  } catch (err) {
    log('reading-ink', 'not placed: ' + err.message);
  }
}

// Called from beforeprint, after html.paper goes on. Shrinking needs the sheets laid out, and the browser paints only later.
export function fitForPrint() {
  const book = document.querySelector('.book');
  if (!book) return;
  const hadMeasure = book.classList.contains('measure');
  book.classList.add('measure');
  try {
    for (const ans of document.querySelectorAll('.sheet .ans')) fitAnswer(ans.parentElement);
  } catch (err) {
    log('reading-ink', 'fit: ' + err.message);
  } finally {
    if (!hadMeasure) book.classList.remove('measure');
  }
}
