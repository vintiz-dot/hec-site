// Everything the brushes and Magic Fill paint with, generated at runtime, zero image bytes (section 4.7).
// Patterns stay on the paper: tiles and masks are drawn in backing px with the pattern's origin at the sheet's origin.
import { log } from './diag.js?v=1';

const TILE_LRU = 12;
const WORKER_WAIT_MS = 20000;
const NAVY = '#16224A', WHITE = '#FFFFFF';
const STAR_PATH = 'M12 1.8l3 6.6 7.2.7-5.4 4.8 1.6 7.1L12 17.3 5.6 21l1.6-7.1L1.8 9.1 9 8.4z'; // the site's star

export const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const rng = s => () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

// ---- tooth, grain, cloud ----

let toothPromise = null, ready = null, grainCanvas = null, cloudCanvas = null;

function fromAlpha(canvas, data, n) {
  if (canvas.width !== n) { canvas.width = n; canvas.height = n; }
  canvas.getContext('2d').putImageData(new ImageData(data, n, n), 0, 0);
  return canvas;
}

function accept(out) {
  ready = {
    masks: out.masks.map(m => fromAlpha(mk(out.n, out.n), m, out.n)),
    pencils: out.pencils.map(m => fromAlpha(mk(out.pn, out.pn), m, out.pn)),
  };
  fromAlpha(grain(), out.grain, out.n);
  fromAlpha(cloud(), out.cloud, out.cloudN);
  return ready;
}

function buildOnMain() {
  return new Promise((resolve, reject) => {
    const run = async () => {
      try {
        await import('./tooth-worker.js?v=1');
        resolve(self.__hecToothBuild());
      } catch (err) { reject(err); }
    };
    if (self.requestIdleCallback) requestIdleCallback(run, { timeout: 3000 });
    else setTimeout(run, 200);
  });
}

function buildInWorker() {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./tooth-worker.js?v=1', import.meta.url));
    const stop = fn => arg => { clearTimeout(timer); worker.terminate(); fn(arg); };
    const timer = setTimeout(() => stop(reject)(new Error('tooth worker timed out')), WORKER_WAIT_MS);
    worker.onmessage = e => stop(resolve)(e.data);
    worker.onerror = e => { e.preventDefault?.(); stop(reject)(new Error(e.message || 'tooth worker failed')); };
    worker.postMessage({});
  });
}

// Starts generation once. Brushes draw without the tooth pass until it resolves.
export function tooth() {
  if (!toothPromise) {
    toothPromise = (async () => {
      let out;
      try {
        out = await buildInWorker();
      } catch (err) {
        log('textures', 'worker: ' + err.message);
        out = await buildOnMain();
      }
      return accept(out);
    })();
    toothPromise.catch(err => log('textures', 'tooth: ' + err.message));
  }
  return toothPromise;
}

export const toothNow = () => ready;

// Both keep their canvas object for life, so a pattern made before generation finishes simply starts working later.
export function grain() { return grainCanvas ??= mk(512, 512); }
export function cloud() { return cloudCanvas ??= mk(256, 256); }

// ---- fabric tiles ----

// Plain weave: fine and faint, or it shimmers when a phone scales the page down.
function weave(x, n) {
  x.save();
  x.globalAlpha = 0.06;
  x.fillStyle = '#000';
  for (let i = 0; i < n; i += 3) x.fillRect(i, 0, 1, n);
  x.fillStyle = '#fff';
  for (let i = 0; i < n; i += 3) x.fillRect(0, i, n, 1);
  x.restore();
}

function diagonals(x, n, pitch, phase) {
  for (let k = 0; k < n / pitch; k++) {
    for (const shift of [-n, 0, n]) {
      x.beginPath();
      x.moveTo(k * pitch + shift + phase, 0);
      x.lineTo(k * pitch + shift + phase + n, n);
      x.stroke();
    }
  }
}

function denim(x, n) {
  const r = rng(n), pitch = 6;
  x.fillStyle = '#2C4F8F';
  x.fillRect(0, 0, n, n);
  x.lineWidth = 2.2;
  x.strokeStyle = 'rgba(255,255,255,.16)';
  diagonals(x, n, pitch, 0);
  x.lineWidth = 1;
  x.strokeStyle = 'rgba(10,20,50,.16)';
  diagonals(x, n, pitch, 3);
  // The pale slubs of the undyed weft
  for (let k = 0; k < n * 1.5; k++) {
    x.fillStyle = `rgba(255,255,255,${r() * 0.32})`;
    x.fillRect(r() * n, r() * n, 1 + r() * 1.5, 1);
  }
}

function stripe(x, n) {
  x.fillStyle = NAVY;
  x.fillRect(0, 0, n, n);
  x.fillStyle = WHITE;
  for (let y = 0; y < n; y += 24) x.fillRect(0, y + 7, n, 10);
  weave(x, n);
}

function gingham(x, n) {
  x.fillStyle = WHITE;
  x.fillRect(0, 0, n, n);
  x.fillStyle = '#F2594B';
  x.globalAlpha = 0.5;
  for (let i = 0; i < n; i += 48) {
    x.fillRect(i, 0, 24, n);
    x.fillRect(0, i, n, 24);
  }
  x.globalAlpha = 1;
  weave(x, n);
}

function polka(x, n) {
  x.fillStyle = '#18A3D0';
  x.fillRect(0, 0, n, n);
  x.fillStyle = WHITE;
  for (const [a, b] of [[24, 24], [72, 72]]) {
    x.beginPath();
    x.arc(a, b, 9.5, 0, Math.PI * 2);
    x.fill();
  }
  weave(x, n);
}

function stars(x, n) {
  x.fillStyle = NAVY;
  x.fillRect(0, 0, n, n);
  const star = new Path2D(STAR_PATH);
  x.fillStyle = '#FFE500';
  for (const [a, b] of [[24, 24], [72, 72]]) {
    x.save();
    x.translate(a - 14, b - 14);
    x.scale(1.16, 1.16);
    x.fill(star);
    x.restore();
  }
  weave(x, n);
}

function flowerAt(x, cx, cy, r) {
  x.fillStyle = '#E0457B';
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
    x.beginPath();
    x.ellipse(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62, r * 0.46, r * 0.36, a, 0, Math.PI * 2);
    x.fill();
  }
  x.fillStyle = '#FFE500';
  x.beginPath();
  x.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
  x.fill();
}

function flower(x, n) {
  x.fillStyle = '#FBD3E0';
  x.fillRect(0, 0, n, n);
  flowerAt(x, 26, 26, 16);
  flowerAt(x, 74, 72, 13);
  x.fillStyle = '#E0457B';
  x.globalAlpha = 0.55;
  for (const [a, b] of [[72, 22], [26, 76]]) {
    x.beginPath();
    x.arc(a, b, 3, 0, Math.PI * 2);
    x.fill();
  }
  x.globalAlpha = 1;
  weave(x, n);
}

const FABRICS = { denim: [denim, 120], stripe: [stripe, 96], gingham: [gingham, 96], polka: [polka, 96], stars: [stars, 96], flower: [flower, 96] };

const tiles = new Map(); // insertion order is the LRU order

function remember(key, make) {
  let c = tiles.get(key);
  if (c) tiles.delete(key);
  else c = make();
  tiles.set(key, c);
  while (tiles.size > TILE_LRU) tiles.delete(tiles.keys().next().value);
  return c;
}

export function tile(fabricId) {
  const [draw, n] = FABRICS[fabricId] ?? FABRICS.denim;
  return remember(fabricId, () => {
    const c = mk(n, n);
    draw(c.getContext('2d'), n);
    return c;
  });
}

// Six flecks from a lightness ramp, dark to white.
export function flecks(hex) {
  const v = [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16));
  return [-0.55, -0.25, 0, 0.2, 0.55, 0.92].map(l => {
    const m = c => Math.round(l < 0 ? c * (1 + l) : c + (255 - c) * l);
    const c = mk(8, 8), x = c.getContext('2d');
    x.fillStyle = `rgb(${m(v[0])},${m(v[1])},${m(v[2])})`;
    x.fillRect(1, 2, 6, 4);
    return c;
  });
}

// Weights 8/12/42/20/12/6, dark to white.
export const pickFleck = u => (u < 0.08 ? 0 : u < 0.2 ? 1 : u < 0.62 ? 2 : u < 0.82 ? 3 : u < 0.94 ? 4 : 5);

// A dealt hand of flecks that wraps at the edges: 1500 hard little rotated cards, written straight into pixels because
// drawing them one by one would cost a visible hitch on the first glitter stroke.
export function fleckTile(hex) {
  return remember('flecks' + hex, () => {
    const n = 192, c = mk(n, n), x = c.getContext('2d'), im = x.createImageData(n, n), d = im.data, r = rng(n);
    const v = [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16));
    const ramp = [-0.55, -0.25, 0, 0.2, 0.55, 0.92].map(l => v.map(k => Math.round(l < 0 ? k * (1 + l) : k + (255 - k) * l)));
    for (let i = 0; i < 1500; i++) {
      const col = ramp[pickFleck(r())], size = 3 + r() * 5, hw = size * 0.375, hh = size * 0.25, an = r() * Math.PI;
      const cos = Math.cos(an), sin = Math.sin(an), cx = r() * n, cy = r() * n, reach = Math.ceil(hw + hh);
      for (let py = -reach; py <= reach; py++) {
        for (let px = -reach; px <= reach; px++) {
          if (Math.abs(px * cos + py * sin) > hw || Math.abs(py * cos - px * sin) > hh) continue;
          const at = (((Math.round(cy) + py + n) % n) * n + ((Math.round(cx) + px + n) % n)) * 4;
          d[at] = col[0]; d[at + 1] = col[1]; d[at + 2] = col[2]; d[at + 3] = 255;
        }
      }
    }
    x.putImageData(im, 0, 0);
    return c;
  });
}

const previews = new Map();

// The real tile at its real scale, for the dock's cards.
export function previewTile(fabricId, sizeCss) {
  const key = fabricId + '@' + sizeCss;
  if (previews.has(key)) return previews.get(key);
  const side = Math.max(1, Math.round(sizeCss * 2));
  const c = mk(side, side), x = c.getContext('2d');
  x.fillStyle = x.createPattern(tile(fabricId), 'repeat');
  x.fillRect(0, 0, side, side);
  const url = c.toDataURL('image/png');
  previews.set(key, url);
  return url;
}
