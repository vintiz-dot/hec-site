// The only eye on devices that cannot be tested here (section 9.1). log() is safe to import anywhere and touches no DOM.
// showPanel() runs under ?diag=1 and prints plain text a parent or teacher can copy and paste. Nothing is ever sent, and
// the child's answers are never printed: the report counts them.
const MAX_ENTRIES = 200;
const SHOWN_ENTRIES = 40;
const PROBE_W = 1588, PROBE_H = 2244;
const ROUND_TRIP_DB = 'hec-clothes-diag';
const FONT_WAIT_MS = 3000;

const ring = [];
let captureInstalled = false;

export function log(kind, msg) {
  ring.push({ t: Date.now(), kind: String(kind), msg: String(msg) });
  if (ring.length > MAX_ENTRIES) ring.shift();
}

export const entries = () => ring.slice();

const yesNo = v => (v ? 'yes' : 'no');
const mb = n => (n / 1e6).toFixed(1) + 'MB';
const ms = n => Math.round(n) + 'ms';

function canShareFiles() {
  try {
    return !!navigator.canShare?.({ files: [new File(['x'], 'x.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

function localStorageWorks() {
  try {
    localStorage.setItem('hec-clothes-diag', '1');
    localStorage.removeItem('hec-clothes-diag');
    return true;
  } catch {
    return false;
  }
}

function deviceLines() {
  const media = q => matchMedia(q).matches;
  return [
    'url: ' + location.pathname + location.search,
    'ua: ' + navigator.userAgent,
    `screen: ${innerWidth}x${innerHeight} dpr ${devicePixelRatio} touch points ${navigator.maxTouchPoints}`,
    `pointer: coarse ${yesNo(media('(pointer:coarse)'))}, fine ${yesNo(media('(pointer:fine)'))}, hover ${yesNo(media('(hover:hover)'))}`,
    `reduced motion: ${yesNo(media('(prefers-reduced-motion:reduce)'))}`,
    `memory: ${navigator.deviceMemory ?? 'unknown'}GB, cores ${navigator.hardwareConcurrency ?? 'unknown'}`,
    `secure context: ${yesNo(window.isSecureContext)}, in-app browser: ${yesNo(/Zalo|FBAN|FBAV|FB_IAB|Messenger|Instagram/i.test(navigator.userAgent))}`,
  ];
}

function featureLines() {
  const flags = {
    PointerEvent: !!window.PointerEvent,
    getCoalescedEvents: !!window.PointerEvent?.prototype.getCoalescedEvents,
    Path2D: !!window.Path2D,
    toBlob: !!HTMLCanvasElement.prototype.toBlob,
    isolation: !!window.CSS?.supports?.('isolation', 'isolate'),
    createImageBitmap: !!window.createImageBitmap,
    OffscreenCanvas: !!window.OffscreenCanvas,
    Worker: !!window.Worker,
    indexedDB: !!window.indexedDB,
    webLocks: !!navigator.locks?.request,
    storagePersist: !!navigator.storage?.persist,
    localStorage: localStorageWorks(),
    share: !!navigator.share,
    shareFiles: canShareFiles(),
    speech: !!window.speechSynthesis,
    contextRestored: 'oncontextrestored' in HTMLCanvasElement.prototype,
  };
  return Object.entries(flags).map(([k, v]) => `${k}: ${yesNo(v)}`);
}

async function storageLines() {
  const out = [];
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate) out.push(`storage: ${mb(estimate.usage ?? 0)} of ${mb(estimate.quota ?? 0)}`);
    const persisted = await navigator.storage?.persisted?.();
    if (persisted !== undefined) out.push('persisted: ' + yesNo(persisted));
  } catch (err) {
    out.push('storage: ' + err.message);
  }
  return out;
}

function encodeProbe(canvas) {
  return new Promise(resolve => {
    const started = performance.now();
    canvas.toBlob(blob => resolve({ blob, took: performance.now() - started }), 'image/png');
  });
}

// The same probe the engine runs at start, plus the encode time autosave will see. Returns the PNG for the round trip.
async function canvasProbe(lines) {
  const canvas = document.createElement('canvas');
  canvas.width = PROBE_W;
  canvas.height = PROBE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) { lines.push(`canvas ${PROBE_W}x${PROBE_H}: FAIL, no context`); return null; }
  ctx.fillStyle = '#F2594B';
  ctx.fillRect(100, 100, 400, 400);
  const pixel = document.createElement('canvas');
  pixel.width = pixel.height = 1;
  const pixelCtx = pixel.getContext('2d', { willReadFrequently: true });
  pixelCtx.drawImage(canvas, 200, 200, 1, 1, 0, 0, 1, 1);
  const alpha = pixelCtx.getImageData(0, 0, 1, 1).data[3];
  lines.push(`canvas ${PROBE_W}x${PROBE_H}: ${alpha === 255 ? 'ok' : 'FAIL, a drawn pixel read back as alpha ' + alpha}`);
  const { blob, took } = await encodeProbe(canvas);
  canvas.width = canvas.height = 1;
  lines.push(`png encode: ${blob ? ms(took) + ', ' + blob.size + ' bytes' : 'FAIL, null blob'}`);
  return blob;
}

function roundTripOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ROUND_TRIP_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('t');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function roundTripRun(db, mode, body) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('t', mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
    body(tx.objectStore('t'), v => { result = v; });
  });
}

// A throwaway database, so checking the save path can never touch the child's work.
async function roundTrip(blob, lines) {
  if (!blob) return;
  const started = performance.now();
  try {
    const bytes = await blob.arrayBuffer();
    let db = await roundTripOpen();
    await roundTripRun(db, 'readwrite', store => store.put(bytes, 'png'));
    db.close();
    db = await roundTripOpen();
    const back = await roundTripRun(db, 'readonly', (store, done) => { store.get('png').onsuccess = e => done(e.target.result); });
    db.close();
    const same = back instanceof ArrayBuffer && back.byteLength === bytes.byteLength
      && new Uint8Array(back).every((b, i) => b === new Uint8Array(bytes)[i]);
    lines.push(`save and reload round trip: ${same ? 'ok' : 'FAIL, bytes differ'}, ${ms(performance.now() - started)}`);
  } catch (err) {
    lines.push(`save and reload round trip: FAIL, ${err.name}: ${err.message}`);
  } finally {
    try { indexedDB.deleteDatabase(ROUND_TRIP_DB); } catch { /* nothing to clean up */ }
  }
}

// Sizes and counts only, read without ever creating the database.
async function savedWorkLines() {
  try {
    const { readSaved } = await import('./reading-ink.js?v=1');
    const saved = await readSaved();
    if (!saved) return ['saved work: none'];
    const lines = saved.sheets.map(r => `saved sheet ${r.sheet}: ink ${yesNo(r.hasInk)}, ${r.ink?.byteLength ?? 0} bytes, ${r.w}x${r.h}, layout ${r.layoutV}, regions ${r.regions?.length ?? 0}`);
    const filled = Object.values(saved.fields).filter(Boolean).length;
    lines.push(`saved answers: ${filled}, saved page: ${saved.meta.page ?? 'none'}`);
    return lines;
  } catch (err) {
    return ['saved work: could not read, ' + err.message];
  }
}

// Outside Studio this measures with html.paper on for one synchronous moment, so nothing paints in between.
async function goldenLines() {
  try {
    const targets = await import('./targets.js?v=1');
    const root = document.documentElement;
    const wasPaper = root.classList.contains('paper');
    const timeout = new Promise(resolve => setTimeout(resolve, FONT_WAIT_MS));
    await Promise.race([document.fonts.load('700 18px "Nunito Paper"', 'Hello'), timeout]);
    root.classList.add('paper');
    let diffs;
    try {
      if (!wasPaper) targets.build();
      diffs = targets.goldenDiff();
    } finally {
      if (!wasPaper) root.classList.remove('paper');
    }
    return diffs.length ? ['golden: ' + diffs.length + ' differ', ...diffs] : ['golden: all rects match'];
  } catch (err) {
    return ['golden: could not run, ' + err.message];
  }
}

function errorLines() {
  const recent = ring.slice(-SHOWN_ENTRIES);
  if (!recent.length) return ['log: empty'];
  return ['log:', ...recent.map(e => `${new Date(e.t).toISOString().slice(11, 19)} ${e.kind}: ${e.msg}`)];
}

function captureWindowErrors() {
  if (captureInstalled) return;
  captureInstalled = true;
  window.addEventListener('error', e => log('window', e.message));
  window.addEventListener('unhandledrejection', e => log('promise', e.reason?.message ?? e.reason));
}

function button(text, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.style.cssText = 'min-height:44px;padding:0 18px;border:0;border-radius:999px;background:#FFE500;color:#16224A;font:700 15px system-ui,sans-serif;cursor:pointer';
  b.addEventListener('click', onClick);
  return b;
}

function copyText(area, copyButton) {
  const done = ok => { copyButton.textContent = ok ? 'Đã sao chép · Copied' : 'Hãy chọn và sao chép · Select and copy'; };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(area.value).then(() => done(true), () => done(false));
    return;
  }
  area.select();
  done(document.execCommand('copy'));
}

function mountPanel() {
  document.getElementById('studio-diag')?.remove();
  const panel = document.createElement('div');
  panel.id = 'studio-diag';
  panel.className = 'noprint';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Chẩn đoán · Diagnostics');
  panel.style.cssText = 'position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;gap:10px;padding:12px;background:#16224A;color:#FFFEFB;font:15px system-ui,sans-serif';
  const title = document.createElement('div');
  title.textContent = 'Chẩn đoán · Diagnostics';
  title.style.fontWeight = '700';
  const area = document.createElement('textarea');
  area.readOnly = true;
  area.spellcheck = false;
  area.style.cssText = 'flex:1;min-height:0;width:100%;padding:10px;border:0;border-radius:4px;background:#FFFEFB;color:#16224A;font:13px/1.45 ui-monospace,Consolas,monospace;white-space:pre';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap';
  const copy = button('Sao chép · Copy', () => copyText(area, copy));
  const close = button('Đóng · Close', () => panel.remove());
  row.append(copy, close);
  panel.append(title, area, row);
  document.body.append(panel);
  return { panel, area };
}

export async function showPanel() {
  captureWindowErrors();
  const { panel, area } = mountPanel();
  const lines = [...deviceLines(), '', ...featureLines()];
  const render = () => { area.value = lines.join('\n'); };
  render();
  const step = async run => {
    const more = await run();
    if (more) lines.push(...more);
    render();
  };
  await step(storageLines);
  lines.push('');
  const probeLines = [];
  const blob = await canvasProbe(probeLines).catch(err => { probeLines.push('canvas: FAIL, ' + err.message); return null; });
  lines.push(...probeLines);
  render();
  const tripLines = [];
  await roundTrip(blob, tripLines);
  lines.push(...tripLines, '');
  render();
  await step(savedWorkLines);
  lines.push('');
  await step(goldenLines);
  lines.push('');
  await step(errorLines);
  panel.dataset.done = '1';
  return area.value;
}
