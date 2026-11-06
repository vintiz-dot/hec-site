// Printing from inside Studio (section 3.4). Ink prints from each sheet's <img class="ink">, answers stay DOM, and
// paper.css shows all four sheets at the fixed A4 geometry. Reading-view print belongs to boot.js.
import { on } from './bus.js?v=1';
import { log } from './diag.js?v=1';
import * as engine from './engine.js?v=1';
import * as shell from './shell.js?v=1';
import * as stickers from './stickers.js?v=1';
import * as viewport from './viewport.js?v=1';

const DECODE_WAIT_MS = 4000;

let installed = false;
let unsubscribe = [];
let publishedForPrint = false;

// A sticker still being placed would print as a floating ghost, so it lands first.
function settleSticker() {
  if (stickers.isPlacing()) stickers.commit();
}

function onBeforePrint() {
  try {
    settleSticker();
    if (!publishedForPrint) engine.publishActiveImgSync(); // printPacket already published, and toDataURL is not free
  } catch (err) {
    log('print', 'beforeprint: ' + err.message);
  }
}

function onAfterPrint() {
  publishedForPrint = false;
  viewport.refit(); // some browsers resize the window around a print dialog
}

const stale = () => { publishedForPrint = false; };

export function install() {
  if (installed) return;
  installed = true;
  window.addEventListener('beforeprint', onBeforePrint);
  window.addEventListener('afterprint', onAfterPrint);
  unsubscribe = [on('ink:commit', stale), on('undo:applied', stale), on('page:shown', stale)];
}

export function uninstall() {
  if (!installed) return;
  installed = false;
  window.removeEventListener('beforeprint', onBeforePrint);
  window.removeEventListener('afterprint', onAfterPrint);
  for (const off of unsubscribe) off();
  unsubscribe = [];
  publishedForPrint = false;
}

// [major, minor] of the WebKit Safari on this device, or null if this is not WebKit. Every iOS browser is WebKit.
function webkitVersion(ua) {
  const ios = ua.match(/(?:iPhone|iPad|iPod).*? OS (\d+)[_.](\d+)/);
  if (ios) return [Number(ios[1]), Number(ios[2])];
  if (/Chrome\/|Chromium\/|Edg\/|OPR\/|Firefox\/|Android/.test(ua)) return null;
  const mac = ua.match(/Version\/(\d+)\.(\d+).*Safari\//);
  return mac ? [Number(mac[1]), Number(mac[2])] : null;
}

// @page size arrived in Safari 18.2 [BCD]. Older ones fall back on break-inside:avoid and may not give exactly 4 pages.
export function lacksPageSize(ua = navigator.userAgent) {
  const v = webkitVersion(ua);
  return !!v && (v[0] < 18 || (v[0] === 18 && v[1] < 2));
}

function decodeAllInk() {
  const images = [...document.querySelectorAll('.sheet>img.ink')].filter(img => img.getAttribute('src'));
  const decodes = images.map(img => img.decode().catch(err => log('print', 'ink image did not decode: ' + err.message)));
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => { log('print', 'gave up waiting for ink images'); resolve(); }, DECODE_WAIT_MS);
  });
  return Promise.race([Promise.all(decodes), timeout]).finally(() => clearTimeout(timer));
}

export async function printPacket() {
  try {
    settleSticker();
    await engine.flush();
    await engine.whileHurrying(() => engine.publishActiveImg());
    publishedForPrint = true;
  } catch (err) {
    log('print', 'could not publish the live page: ' + err.message); // printing the rest beats printing nothing
  }
  await decodeAllInk();
  if (lacksPageSize()) shell.note('note.page');
  window.print();
}
