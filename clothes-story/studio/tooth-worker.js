// Paper tooth: a wrapped 512px height field and the masks cut from it (section 4.6), plus the soft cloud tile the
// watercolor blooms use. 185-240ms on a fast laptop and over a second on a phone, so never on the main thread.
// A classic worker script. When a Worker cannot start, textures.js imports this file and calls __hecToothBuild.
(function () {
  const rng = s => () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const smooth = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };

  // Wrapped box blur, horizontal then vertical.
  function blur(a, n, r) {
    const b = new Float32Array(n * n), w = 2 * r + 1;
    for (let y = 0; y < n; y++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += a[y * n + ((i + n) % n)];
      for (let x = 0; x < n; x++) { b[y * n + x] = s / w; s += a[y * n + ((x + r + 1) % n)] - a[y * n + ((x - r + n) % n)]; }
    }
    for (let x = 0; x < n; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += b[((i + n) % n) * n + x];
      for (let y = 0; y < n; y++) { a[y * n + x] = s / w; s += b[((y + r + 1) % n) * n + x] - b[((y - r + n) % n) * n + x]; }
    }
    return a;
  }

  function normalise(a) {
    let m = 0, v = 0;
    for (const x of a) m += x;
    m /= a.length;
    for (const x of a) v += (x - m) * (x - m);
    v = Math.sqrt(v / a.length);
    for (let i = 0; i < a.length; i++) a[i] = (a[i] - m) / v;
  }

  // Rank-mapped through a CDF, so a coverage of .62 really keeps 62% of the paper.
  function field(n, seed, finePasses = 2, coarseR = 3, fineShare = 0.82) {
    const r = rng(seed), f = new Float32Array(n * n), c = new Float32Array(n * n), h = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) { f[i] = r(); c[i] = r(); }
    for (let k = 0; k < finePasses; k++) blur(f, n, 1);
    blur(blur(c, n, coarseR), n, coarseR);
    normalise(f);
    normalise(c);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n * n; i++) { const v = h[i] = f[i] * fineShare + c[i] * (1 - fineShare); if (v < lo) lo = v; if (v > hi) hi = v; }
    const B = 4096, hist = new Uint32Array(B), cdf = new Float32Array(B), k = (B - 1) / (hi - lo);
    for (const v of h) hist[(v - lo) * k | 0]++;
    let run = 0;
    for (let b = 0; b < B; b++) { run += hist[b]; cdf[b] = run / (n * n); }
    for (let i = 0; i < n * n; i++) h[i] = cdf[(h[i] - lo) * k | 0];
    return h;
  }

  // RGBA with only alpha set. Alpha 1 means the mask removes that pixel; how hard is the globalAlpha it is drawn at.
  function removal(h, n, coverage, soft = 0.07) {
    const out = new Uint8ClampedArray(n * n * 4);
    for (let i = 0; i < n * n; i++) out[i * 4 + 3] = 255 * smooth(coverage - soft, coverage + soft, h[i]);
    return out;
  }

  function cloudTile(n, seed) {
    const r = rng(seed), a = new Float32Array(n * n), out = new Uint8ClampedArray(n * n * 4);
    for (let i = 0; i < n * n; i++) a[i] = r();
    blur(blur(blur(a, n, 16), n, 16), n, 16);
    let lo = Infinity, hi = -Infinity;
    for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
    for (let i = 0; i < n * n; i++) out[i * 4 + 3] = 255 * smooth(0.25, 0.85, (a[i] - lo) / (hi - lo));
    return out;
  }

  function build({ n = 512, seed = 7, coverages = [0.62, 0.78, 0.9], pencils = [0.6, 0.74, 0.88], grain = 0.6, cloudN = 256, cloudSeed = 21 } = {}) {
    const h = field(n, seed);
    // Graphite has a much finer grain than wax: a coarse tooth breaks a thin line into dots, and writing goes unreadable.
    const pn = n >> 1, fine = field(pn, seed + 5, 0, 1, 0.5);
    return {
      n, cloudN, pn,
      masks: coverages.map(c => removal(h, n, c)),
      pencils: pencils.map(c => removal(fine, pn, c, 0.18)),
      grain: removal(h, n, grain),
      cloud: cloudTile(cloudN, cloudSeed),
    };
  }

  self.__hecToothBuild = build;
  if (typeof importScripts === 'function') {
    self.onmessage = e => {
      const out = build(e.data);
      self.postMessage(out, [...out.masks.map(m => m.buffer), ...out.pencils.map(m => m.buffer), out.grain.buffer, out.cloud.buffer]);
    };
  }
})();
