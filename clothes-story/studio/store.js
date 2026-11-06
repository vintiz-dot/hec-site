// Keeping the child's work (section 7). PNG bytes go in as ArrayBuffer, never Blob. Nothing here may hang or throw at a
// caller, because a page switch and the way out of Studio wait on it: a browser that stops answering means memory mode.
import { emit, on } from './bus.js?v=1';
import { BOXES, LAYOUT_V, LIMITS, SHEETS, STORAGE, TOOLS } from './constants.js?v=1';
import { log } from './diag.js?v=1';
import * as engine from './engine.js?v=1';
import * as fields from './fields.js?v=1';
import * as fill from './fill.js?v=1';
import * as quest from './quest.js?v=1';
import * as shell from './shell.js?v=1';
import * as state from './state.js?v=1';
import * as targets from './targets.js?v=1';
import * as undo from './undo.js?v=1';

const OPEN_WAIT_MS = 4000, LOCK_WAIT_MS = 2000, TX_WAIT_MS = 10000, ENCODE_WAIT_MS = 20000, FLUSH_WAIT_MS = 5000;
const RETRY_MS = 250;
const MAX_UNSAVED_MS = 10000;  // a child who never pauses for 1.5s still gets saved, or the stated guarantee means nothing
const SLOW_ENCODE_MS = 300, VERY_SLOW_ENCODE_MS = 1000;
const CONFIRM_DIVISOR = 4;     // at quarter size the smallest mark any tool makes still covers whole pixels
const DOWNLOAD_GAP_MS = 400, URL_LIFETIME_MS = 60000;
const PAPER = '#FFFEFB';
const STATE_IN_META = ['tool', 'swatch', 'drawSwatch', 'pencilSwatch', 'size', 'muted', 'usage', 'dot6'];

let db = null, opening = null;
let mode = 'idb', readOnly = false, opened = false, status = 'saved';
let releaseLock = null;
let epoch = 0;             // rises on Start over, so a save already running cannot write the work back
let loadedOnce = false;
let fieldsCache = {}, metaCache = {};
let fieldsDirty = false, metaDirty = false, fieldsTimer = 0, metaTimer = 0;
let saveTimer = 0, unsavedSince = 0, idleMs = LIMITS.saveIdleMs;
let pump = null, restoring = null;
let memoryDirty = false, hasWorkSet = false;
let watchedCanvas = null, contextLost = false;
let listeners = [];

const wanted = new Set();  // sheets waiting for the one running encode
const sheets = new Map();  // sheet -> { version, saved, hasInk, emptied, regions }. Dirty means version differs from saved.
const memory = new Map();  // sheet -> full record, once storage has failed

const hasLocks = () => !!navigator.locks?.request;
const describe = err => (err?.name ? `${err.name}: ${err.message}` : String(err));
const isQuota = err => /quota/i.test(`${err?.name} ${err?.message}`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function sheetOf(n) {
  let s = sheets.get(n);
  if (!s) sheets.set(n, s = { version: 0, saved: 0, hasInk: false, emptied: false, regions: [] });
  return s;
}

const isDirty = s => s.version !== s.saved;

function setStatus(next) {
  const value = mode === 'memory' ? 'memory' : next;
  if (value === status) return;
  status = value;
  emit('save:state', { state: value });
}

function within(ms, promise, what) {
  let timer;
  const expired = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(what + ' did not answer')), ms); });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

// ---- connection ----

function openDb() {
  return new Promise((resolve, reject) => {
    let late = false;
    const timer = setTimeout(() => { late = true; reject(new Error('open did not answer')); }, OPEN_WAIT_MS);
    const req = indexedDB.open(STORAGE.db, STORAGE.dbVersion);
    req.onupgradeneeded = () => {
      const { result } = req;
      if (!result.objectStoreNames.contains('sheets')) result.createObjectStore('sheets', { keyPath: 'sheet' });
      if (!result.objectStoreNames.contains('kv')) result.createObjectStore('kv', { keyPath: 'k' });
    };
    req.onerror = e => { e.preventDefault(); clearTimeout(timer); reject(req.error); };
    req.onsuccess = () => {
      clearTimeout(timer);
      const conn = req.result;
      if (late) { conn.close(); return; }
      const forget = () => { if (db === conn) db = null; };
      conn.onversionchange = () => { conn.close(); forget(); };  // Start over in another tab must not wait on this one
      conn.onclose = forget;                                     // site data was cleared, or the browser let go
      resolve(conn);
    };
  });
}

async function connection() {
  if (db) return db;
  opening ??= openDb().finally(() => { opening = null; });
  db = await opening;
  return db;
}

function dropConnection() {
  try { db?.close(); } catch (err) { log('store', 'close: ' + describe(err)); }
  db = null;
}

function transact(txMode, body) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['sheets', 'kv'], txMode);
    const timer = setTimeout(() => reject(new Error('transaction did not finish')), TX_WAIT_MS);
    const settle = (fn, value) => { clearTimeout(timer); fn(value); };
    let result;
    tx.oncomplete = () => settle(resolve, result);
    tx.onabort = () => settle(reject, tx.error ?? new Error('transaction aborted'));
    try {
      body(tx, value => { result = value; });
    } catch (err) {
      settle(reject, err);
      tx.abort();
    }
  });
}

// iOS is known to drop the connection while in the background [U on current status], so a fresh connection and one more
// try come before giving up on storage for this session.
async function attempt(txMode, body) {
  try {
    await connection();
    return await transact(txMode, body);
  } catch (err) {
    if (isQuota(err)) throw err;
    log('store', `${txMode} failed, trying a new connection: ${describe(err)}`);
    dropConnection();
    await connection();
    return transact(txMode, body);
  }
}

async function write(body) {
  if (mode === 'memory') return false;
  try {
    await attempt('readwrite', body);
    return true;
  } catch (err) {
    enterMemory(err);
    memoryDirty = true;
    return false;
  }
}

// A failed read also means memory mode: a page shown blank because its ink could not be read must never overwrite that ink.
async function read(body) {
  if (mode === 'memory' && !db) return undefined;
  try {
    return await attempt('readonly', body);
  } catch (err) {
    enterMemory(err);
    return undefined;
  }
}

// ---- memory mode ----

function onBeforeUnload(e) {
  if (!memoryDirty) return;
  e.preventDefault();
  e.returnValue = '';
}

function enterMemory(err) {
  if (mode === 'memory') return;
  log('store', 'storage failed, keeping the work in memory: ' + describe(err));
  mode = 'memory';
  releaseLock?.();
  releaseLock = null;
  state.set('mode', 'memory');
  window.addEventListener('beforeunload', onBeforeUnload);
  shell.note('note.private', { sticky: true });
  setStatus('memory');
}

function markWork() {
  if (hasWorkSet || mode === 'memory') return;
  hasWorkSet = true;
  try {
    localStorage.setItem(STORAGE.hasWork, '1');
  } catch (err) {
    log('store', 'localStorage: ' + describe(err));
  }
}

// ---- tab lock ----

function onStolen() {
  releaseLock = null;
  if (!opened) return;
  readOnly = true;
  clearTimeout(saveTimer);
  wanted.clear();
  state.set('readOnly', true);
  shell.note('note.tab', { sticky: true });
}

// Resolves true when this tab may write. The lock stays held by a promise only close() or a thief ends.
function takeLock(options) {
  if (!hasLocks()) return Promise.resolve(true);  // iOS below 15.4 [U]: last writer wins
  const granted = new Promise(resolve => {
    navigator.locks.request(STORAGE.lock, options, lock => {
      resolve(!!lock);
      return lock ? new Promise(release => { releaseLock = release; }) : undefined;
    }).catch(err => {
      if (err?.name === 'AbortError' && releaseLock) { onStolen(); return; }
      log('store', 'lock: ' + describe(err));
      resolve(true);
    });
  });
  return within(LOCK_WAIT_MS, granted, 'lock').catch(err => { log('store', err.message); return true; });
}

// ---- reading ----

const readRow = n => read((tx, done) => { tx.objectStore('sheets').get(n).onsuccess = e => done(e.target.result); });

async function storedRow(n) {
  const row = memory.get(n) ?? await readRow(n);
  return row ?? null;
}

export async function getInk(n) {
  const row = await storedRow(n);
  return row?.ink instanceof ArrayBuffer ? row.ink : null;
}

function readEverything() {
  return read((tx, done) => {
    const out = { rows: [], fields: null, meta: null };
    tx.objectStore('sheets').getAll().onsuccess = e => { out.rows = e.target.result; };
    tx.objectStore('kv').get('fields').onsuccess = e => { out.fields = e.target.result?.values ?? null; };
    tx.objectStore('kv').get('meta').onsuccess = e => { out.meta = e.target.result ?? null; };
    done(out);
  });
}

// Once only per change of the packet: untouched sheets keep their old layoutV, and the note would repeat for ever.
function noteLayoutChange(list) {
  const signature = JSON.stringify(LAYOUT_V);
  if (metaCache.layoutNoted === signature) return;
  if (!list.some(r => r.hasInk && r.layoutV !== LAYOUT_V[r.sheet])) return;
  shell.note('note.layout');
  saveMeta({ layoutNoted: signature });
}

export async function load() {
  const saved = await readEverything();
  if (!(mode === 'memory' && loadedOnce)) {  // otherwise these two are newer than anything stored
    fieldsCache = saved?.fields ?? {};
    metaCache = saved?.meta ?? {};
  }
  loadedOnce = true;
  const out = {};
  for (const row of [...(saved?.rows ?? []), ...memory.values()]) {
    const ink = row.ink instanceof ArrayBuffer ? row.ink : null;
    out[row.sheet] = { ink, layoutV: row.layoutV, hasInk: !!row.hasInk && !!ink, regions: row.regions ?? [], w: row.w, h: row.h };
  }
  for (const n of SHEETS) {
    const s = sheetOf(n);
    s.hasInk = !!out[n]?.hasInk;
    s.regions = out[n]?.regions ?? [];
    s.emptied = false;
    s.saved = s.version;
  }
  const list = Object.entries(out).map(([n, r]) => ({ sheet: Number(n), ...r }));
  if (list.some(r => r.hasInk) || Object.keys(fieldsCache).length) markWork();
  noteLayoutChange(list);
  return { meta: { ...metaCache }, fields: { ...fieldsCache }, sheets: out };
}

// ---- blank guard ----

// The engine's 64x64 sample can miss one small dot, and a false alarm would throw a child's marks away, so a blank is
// looked at again at a larger size before anything acts on it. A separate canvas, so paint is not read (invariant 5).
function looksBlank() {
  if (!engine.sampleIsBlank()) return false;
  const paint = engine.paintCanvas();
  const w = Math.ceil(paint.width / CONFIRM_DIVISOR), h = Math.ceil(paint.height / CONFIRM_DIVISOR);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(paint, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  canvas.width = canvas.height = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]) return false;
  return true;
}

async function decodeInk(bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Saved 2x bytes also land right on a 1x canvas. Null bytes clear the canvas.
async function paintStored(bytes) {
  const paint = engine.paintCanvas();
  const patch = document.createElement('canvas');
  patch.width = paint.width;
  patch.height = paint.height;
  if (bytes) patch.getContext('2d').drawImage(await decodeInk(bytes), 0, 0, paint.width, paint.height);
  engine.restore({ rect: { x: 0, y: 0, w: paint.width, h: paint.height }, canvas: patch });
  patch.width = patch.height = 0;
}

async function recover(n) {
  const s = sheetOf(n);
  const row = await storedRow(n);
  if (engine.activeSheet() !== n) return;
  s.saved = s.version;
  s.emptied = false;
  if (!(row?.ink instanceof ArrayBuffer)) { s.hasInk = false; return; }  // nothing was ever stored, so nothing to bring back
  await paintStored(row.ink);
  undo.reset();  // its patches describe marks that are gone, and they may have been blanked as well
  s.regions = row.regions ?? [];
  fill.setRegions(n, s.regions);
  if (looksBlank()) {
    log('store', `sheet ${n} stays blank after a restore`);
    setStatus('error');
    return;
  }
  shell.note('note.restored');
  setStatus('saved');
}

function restoreStored(n) {
  restoring ??= recover(n).catch(err => {
    log('store', 'restore: ' + describe(err));
    setStatus('error');
  }).finally(() => { restoring = null; });
  return restoring;
}

function guardCheck() {
  if (!opened || readOnly || contextLost || engine.isStroking()) return;
  const n = engine.activeSheet();
  const s = sheetOf(n);
  if (s.hasInk && !s.emptied && looksBlank()) restoreStored(n);
}

function onContextLost() { contextLost = true; }

// The browser wiped this canvas, whatever the child did before, so the eraser exception of the guard does not apply.
function onContextRestored() {
  contextLost = false;
  if (!opened || readOnly) return;
  const n = engine.activeSheet();
  if (sheetOf(n).hasInk || isDirty(sheetOf(n))) restoreStored(n);
}

function unwatchCanvas() {
  watchedCanvas?.removeEventListener('contextlost', onContextLost);
  watchedCanvas?.removeEventListener('contextrestored', onContextRestored);
  watchedCanvas = null;
  contextLost = false;
}

function watchCanvas() {
  unwatchCanvas();
  watchedCanvas = engine.paintCanvas();
  watchedCanvas?.addEventListener('contextlost', onContextLost);
  watchedCanvas?.addEventListener('contextrestored', onContextRestored);
}

// ---- autosave ----

function schedule() {
  clearTimeout(saveTimer);
  if (!opened || readOnly) return;
  const now = performance.now();
  unsavedSince ||= now;
  const deadline = unsavedSince + Math.max(MAX_UNSAVED_MS, idleMs * 2) - now;
  saveTimer = setTimeout(autosave, Math.max(RETRY_MS, Math.min(idleMs, deadline)));
}

function autosave() {
  if (engine.isStroking()) schedule();
  else saveNow();
}

const toBuffer = blob => (blob.arrayBuffer ? blob.arrayBuffer() : new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsArrayBuffer(blob);
}));

// A hidden page runs slow, which proves nothing about the device.
function adaptIdle(took) {
  if (document.visibilityState !== 'visible') return;
  idleMs = took > VERY_SLOW_ENCODE_MS ? LIMITS.saveIdleVerySlowMs : took > SLOW_ENCODE_MS ? LIMITS.saveIdleSlowMs : LIMITS.saveIdleMs;
}

async function encodeBytes() {
  const started = performance.now();
  const blob = await within(ENCODE_WAIT_MS, engine.encodeActive(), 'encode').catch(err => { log('store', err.message); return null; });
  adaptIdle(performance.now() - started);
  if (!blob) { log('store', 'no PNG from the encoder, the last save stands'); return null; }
  return toBuffer(blob);
}

async function writeRecord(record, run) {
  const stored = await write(tx => { if (run === epoch) tx.objectStore('sheets').put(record); });
  if (!stored && run === epoch) memory.set(record.sheet, record);
}

// A canvas on another page cannot be encoded, so only its regions can be written.
async function patchRegions(n, s) {
  const version = s.version;
  const kept = memory.get(n);
  if (kept) kept.regions = s.regions;
  await write(tx => {
    const store = tx.objectStore('sheets');
    store.get(n).onsuccess = e => { if (e.target.result) store.put({ ...e.target.result, regions: s.regions }); };
  });
  s.saved = version;
}

function afterWrite(s, version, blank) {
  s.saved = version;
  if (s.version === version) {
    s.hasInk = !blank;
    if (!blank) s.emptied = false;  // only if no eraser or undo arrived during this save
  }
  const dirtyLeft = [...sheets.values()].some(isDirty);
  if (dirtyLeft) { schedule(); return; }
  unsavedSince = 0;
  setStatus('saved');
}

async function saveSheet(n) {
  const s = sheetOf(n);
  if (readOnly || !isDirty(s)) return;
  const run = epoch;
  await restoring;
  if (document.visibilityState !== 'hidden') await within(FLUSH_WAIT_MS, fill.revealSettled(), 'reveal').catch(err => log('store', err.message));
  await within(FLUSH_WAIT_MS, engine.flush(), 'flush').catch(err => log('store', err.message));
  if (run !== epoch || readOnly) return;
  if (contextLost || engine.isStroking()) { schedule(); return; }
  if (engine.activeSheet() !== n) { await patchRegions(n, s); return; }
  const blank = looksBlank();
  if (blank && s.hasInk && !s.emptied) { await restoreStored(n); return; }
  const version = s.version;
  setStatus('saving');
  const paint = engine.paintCanvas();
  const { width: w, height: h } = paint;
  const ink = blank ? null : await encodeBytes();
  if (run !== epoch || readOnly) return;
  if (!blank && !ink) { setStatus('error'); schedule(); return; }  // a null blob never overwrites
  await writeRecord({ sheet: n, ink, w, h, layoutV: LAYOUT_V[n], hasInk: !blank, regions: s.regions, t: Date.now() }, run);
  if (run === epoch) afterWrite(s, version, blank);
}

async function drain() {
  while (wanted.size) {
    const [n] = wanted;
    wanted.delete(n);
    try {
      await saveSheet(n);
    } catch (err) {
      log('store', `sheet ${n}: ${describe(err)}`);
      setStatus('error');
    }
  }
  pump = null;
}

// One encode at a time. A request during a save joins the same pump, and a sheet changed meanwhile goes round again.
export function saveNow(n) {
  if (!opened || readOnly) return pump ?? Promise.resolve();
  clearTimeout(saveTimer);
  if (n !== undefined) wanted.add(n);
  for (const [sheet, s] of sheets) if (isDirty(s)) wanted.add(sheet);
  if (wanted.size) pump ??= Promise.resolve().then(drain);
  return pump ?? Promise.resolve();
}

// ---- fields and meta ----

async function flushFields() {
  clearTimeout(fieldsTimer);
  if (!fieldsDirty || readOnly) return;
  fieldsDirty = false;
  await write(tx => tx.objectStore('kv').put({ k: 'fields', values: fieldsCache, t: Date.now() }));
}

async function flushMeta() {
  clearTimeout(metaTimer);
  if (!metaDirty || readOnly) return;
  metaDirty = false;
  await write(tx => tx.objectStore('kv').put({ ...metaCache, k: 'meta', schema: 1, t: Date.now() }));
}

function fieldsChanged() {
  if (!opened || readOnly) return;
  fieldsDirty = true;
  clearTimeout(fieldsTimer);
  fieldsTimer = setTimeout(flushFields, LIMITS.fieldsDebounceMs);
}

export function saveFields(values) {
  fieldsCache = { ...values };
  fieldsChanged();
}

export function saveMeta(partial) {
  Object.assign(metaCache, partial);
  if (!opened || readOnly) return;
  metaDirty = true;
  clearTimeout(metaTimer);
  metaTimer = setTimeout(flushMeta, LIMITS.metaDebounceMs);
}

export function saveRegions(n, regions) {
  const s = sheetOf(n);
  s.regions = regions ?? [];
  if (!opened || readOnly) return;
  s.version++;
  schedule();
}

// ---- what the store listens to ----

function onCommit({ sheet: n, tool }) {
  if (readOnly) return;
  const s = sheetOf(n);
  s.version++;
  if (TOOLS[tool] && TOOLS[tool].kind !== 'eraser') {
    s.hasInk = true;
    markWork();
    if (mode === 'memory') memoryDirty = true;
  } else {
    s.emptied = true;  // the eraser, and Clear this page, which is not a tool
  }
  if (document.visibilityState === 'hidden') saveNow(n);
  else schedule();
}

function onUndoApplied({ sheet: n }) {
  if (readOnly) return;
  const s = sheetOf(n);
  s.version++;
  s.emptied = true;
  if (mode === 'memory') memoryDirty = true;
  schedule();
}

function onFieldChange({ id, value }) {
  if (value == null) {
    delete fieldsCache[id];
  } else {
    fieldsCache[id] = value;
    markWork();
  }
  if (mode === 'memory' && !readOnly) memoryDirty = true;
  fieldsChanged();
}

function onBoxInk({ box, on: isOn }) {
  const list = new Set(metaCache.boxesInk ?? []);
  if (isOn) list.add(box); else list.delete(box);
  saveMeta({ boxesInk: [...list] });
}

// A save needs an async encode, and a page that is closing never finishes one. So when the page leaves with a change that
// is not stored yet, take the PNG synchronously and queue the write in the same turn: the browser process finishes an
// IndexedDB write that was already queued, even when the page is gone. The normal save still runs and wins if it is newer.
function snapshotNow() {
  if (!db || mode === 'memory' || contextLost) return;
  const n = engine.activeSheet(), s = sheetOf(n);
  if (!isDirty(s) || looksBlank()) return;
  try {
    const paint = engine.paintCanvas();
    const url = paint.toDataURL('image/png');
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const record = { sheet: n, ink: bytes.buffer, w: paint.width, h: paint.height, layoutV: LAYOUT_V[n], hasInk: true, regions: s.regions, t: Date.now() };
    const tx = db.transaction('sheets', 'readwrite');
    tx.objectStore('sheets').put(record);
    tx.commit?.();  // without this the commit waits for the end of the task, which a closing page never reaches
  } catch (err) {
    log('store', 'snapshot: ' + describe(err));
  }
}

function flushAll() {
  if (!opened || readOnly) return;
  flushFields();
  flushMeta();
  snapshotNow();
  saveNow();
}

function onVisibility() {
  if (document.visibilityState === 'hidden') flushAll();
  else guardCheck();
}

function listen() {
  listeners = [
    on('ink:commit', onCommit),
    on('undo:applied', onUndoApplied),
    on('field:change', onFieldChange),
    on('box:ink', onBoxInk),
    on('page:shown', ({ n }) => saveMeta({ page: n })),
    on('state:tool', () => saveNow()),
    on('studio:enter', () => emit('save:state', { state: status })),  // for a dock mounted after open()
    ...STATE_IN_META.map(key => on('state:' + key, ({ value }) => saveMeta({ [key]: value }))),
  ];
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', flushAll);
}

function unlisten() {
  for (const off of listeners) off();
  listeners = [];
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('pagehide', flushAll);
}

// ---- opening and closing ----

async function openStorage() {
  if (mode === 'memory' && (memory.size || memoryDirty)) {  // newer than the database and no way to merge, so it stays
    shell.note('note.private', { sticky: true });
    return;
  }
  mode = 'idb';
  window.removeEventListener('beforeunload', onBeforeUnload);
  try {
    await connection();
  } catch (err) {
    enterMemory(err);
    return;
  }
  readOnly = !(await takeLock({ ifAvailable: true }));
  if (readOnly) return;
  try {
    await transact('readwrite', tx => {  // a browser may open the database and refuse the first write
      const kv = tx.objectStore('kv');
      kv.put({ k: 'probe' });
      kv.delete('probe');
    });
  } catch (err) {
    enterMemory(err);
  }
}

export async function open() {
  if (opened) return { mode, readOnly };
  opened = true;
  readOnly = false;
  listen();
  watchCanvas();
  await openStorage();
  state.set('mode', mode);
  state.set('readOnly', readOnly);
  if (readOnly) shell.note('note.tab', { sticky: true });
  status = '';
  setStatus('saved');
  return { mode, readOnly };
}

export async function close() {
  if (!opened) return;
  clearTimeout(saveTimer);
  await pump;
  await Promise.all([flushFields(), flushMeta()]);
  opened = false;
  unlisten();
  unwatchCanvas();
  dropConnection();
  releaseLock?.();
  releaseLock = null;
}

// Whatever the other tab did meanwhile becomes what this tab shows, or the first save here would overwrite it.
async function adoptStored() {
  const data = await load();
  fields.init(data.fields);
  for (const n of SHEETS) fill.setRegions(n, data.sheets[n]?.regions ?? []);
  for (const id of Object.keys(BOXES)) targets.setHasInk(id, (data.meta.boxesInk ?? []).includes(id));
  undo.reset();
  await paintStored(data.sheets[engine.activeSheet()]?.ink ?? null);
  quest.refresh();
}

export async function useHere() {
  if (!readOnly) return;
  await takeLock({ steal: true });
  readOnly = false;
  try {
    await adoptStored();
  } catch (err) {
    log('store', 'taking over: ' + describe(err));
  }
  state.set('readOnly', false);
  setStatus('saved');
}

// ---- Save a copy ----

export async function requestPersist() {
  try {
    return !!(await navigator.storage?.persist?.());
  } catch (err) {
    log('store', 'persist: ' + describe(err));
    return false;
  }
}

async function paperCopy(bytes, n) {
  const img = bytes ? await decodeInk(bytes) : null;
  const canvas = document.createElement('canvas');
  canvas.width = img?.naturalWidth ?? 1588;
  canvas.height = img?.naturalHeight ?? 2244;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (img) ctx.drawImage(img, 0, 0);
  const k = canvas.width / 794;
  for (const o of (metaCache.objects ?? []).filter(m => m.sheet === n)) { // movable stickers are not in the ink
    const pic = new Image();
    pic.src = o.png;
    await pic.decode();
    const w = o.size * 260 / 240 * k;
    ctx.save();
    ctx.translate(o.cx * k, o.cy * k);
    ctx.rotate(o.rot);
    ctx.drawImage(pic, -w / 2, -w / 2, w, w);
    ctx.restore();
  }
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  canvas.width = canvas.height = 0;
  return blob;
}

function download(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), URL_LIFETIME_MS);
}

async function deliver(files) {
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;  // the parent closed the share sheet
      log('store', 'share: ' + describe(err)); // often encoding outlasted the tap. Downloads do not need one.
    }
  }
  for (const [i, file] of files.entries()) {
    if (i) await sleep(DOWNLOAD_GAP_MS);
    download(file);
  }
}

// Resolves to the number of pages handed over. Not waited on: Firefox's persist popup can sit unanswered for ever.
export async function savedCopy() {
  requestPersist();
  await saveNow();
  const files = [];
  for (const n of SHEETS) {
    const bytes = await getInk(n);
    if (!bytes && !metaCache.objects?.some(m => m.sheet === n)) continue;
    const blob = await paperCopy(bytes, n).catch(err => { log('store', `copy of page ${n}: ${describe(err)}`); return null; });
    if (blob) files.push(new File([blob], `my-clothes-story-${n}.png`, { type: 'image/png' }));
  }
  if (!files.length) return 0;
  await deliver(files);
  memoryDirty = false;
  return files.length;
}

// ---- Start over ----

// Emptied first: a delete stays blocked for as long as another tab holds a connection, and the parent was told it is gone.
async function eraseDatabase() {
  try {
    if (db) await transact('readwrite', tx => { tx.objectStore('sheets').clear(); tx.objectStore('kv').clear(); });
  } catch (err) {
    log('store', 'clear: ' + describe(err));
  }
  dropConnection();
  await new Promise(resolve => {
    const timer = setTimeout(resolve, OPEN_WAIT_MS);
    const req = indexedDB.deleteDatabase(STORAGE.db);
    req.onsuccess = req.onerror = () => { clearTimeout(timer); resolve(); };
  }).catch(err => log('store', 'delete: ' + describe(err)));
}

export async function clearAll() {
  epoch++;
  clearTimeout(saveTimer);
  clearTimeout(fieldsTimer);
  clearTimeout(metaTimer);
  wanted.clear();
  fieldsDirty = metaDirty = memoryDirty = hasWorkSet = false;
  fieldsCache = {};
  metaCache = {};
  unsavedSince = 0;
  sheets.clear();
  memory.clear();
  undo.reset();
  if (readOnly) {  // the tab that holds the lock stops writing first, or it would write the work back
    await takeLock({ steal: true });
    readOnly = false;
    state.set('readOnly', false);
  }
  await eraseDatabase();
  for (const key of [STORAGE.hasWork, STORAGE.answers]) {
    try {
      localStorage.removeItem(key);
    } catch (err) {
      log('store', 'localStorage: ' + describe(err));
    }
  }
  setStatus('saved');
}

// For the test suite, diag and a dock mounted late.
export function stats() {
  const list = {};
  for (const [n, s] of sheets) list[n] = { dirty: isDirty(s), hasInk: s.hasInk, emptied: s.emptied };
  return { mode, readOnly, status, idleMs, sheets: list };
}
