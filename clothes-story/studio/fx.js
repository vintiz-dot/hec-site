// The effects canvas: gold sparkles where ink meets a dark panel, the stitched ripple when a fill can't pour, and the
// ghost crayon that shows a child where to start. Nothing here is saved, and the loop runs only while something is alive.
import { log } from './diag.js?v=1';

const MAX_PARTICLES = 56;
const STAR_TINTS = ['#FFC21A', '#FFE500', '#FFF4C2', '#E8A90F'];
const GHOST = { draw: 1300, hold: 260, fade: 480 };

let canvas = null, ctx = null;
let raf = 0, pr = 1, cssW = 0, cssH = 0;
let stars = null;
let particles = [], rings = [], ghost = null;
let lastSpark = { x: -1e4, y: -1e4, t: 0 };

const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const now = () => performance.now();
const clamp01 = v => Math.max(0, Math.min(1, v));

export function mount() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.id = 'studio-fx';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  fit();
}

export function unmount() {
  killGhost();
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  particles = [];
  rings = [];
  canvas?.remove();
  canvas = null;
  ctx = null;
}

function fit() {
  const w = window.innerWidth, h = window.innerHeight, ratio = Math.min(window.devicePixelRatio || 1, 2);
  if (w === cssW && h === cssH && ratio === pr && canvas.width) return;
  cssW = w; cssH = h; pr = ratio;
  canvas.width = Math.round(w * pr);
  canvas.height = Math.round(h * pr);
}

// A four-point star with a warm bloom, drawn once per tint and stamped from then on.
function starSprite(color) {
  const size = 48, c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d'), m = size / 2;
  const bloom = x.createRadialGradient(m, m, 0, m, m, m);
  // Kept tight and pale: a wide yellow glow turns muddy brown over the navy panels.
  bloom.addColorStop(0, 'rgba(255,244,190,.6)');
  bloom.addColorStop(.3, 'rgba(255,232,140,.14)');
  bloom.addColorStop(.55, 'rgba(255,232,140,0)');
  x.fillStyle = bloom;
  x.fillRect(0, 0, size, size);
  x.fillStyle = color;
  x.beginPath();
  x.moveTo(m, 3);
  x.quadraticCurveTo(m + 2.4, m - 2.4, size - 3, m);
  x.quadraticCurveTo(m + 2.4, m + 2.4, m, size - 3);
  x.quadraticCurveTo(m - 2.4, m + 2.4, 3, m);
  x.quadraticCurveTo(m - 2.4, m - 2.4, m, 3);
  x.fill();
  return c;
}

// A stroke calls this on every move, so it thins itself by distance: a trail, not a cloud.
export function sparkle(cx, cy) {
  if (!canvas || reduced()) return;
  const t = now();
  if (Math.hypot(cx - lastSpark.x, cy - lastSpark.y) < 11 && t - lastSpark.t < 90) return;
  lastSpark = { x: cx, y: cy, t };
  stars ??= STAR_TINTS.map(starSprite);
  for (let i = 0; i < 2; i++) {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    const angle = Math.random() * Math.PI * 2, speed = 8 + Math.random() * 34;
    particles.push({
      x: cx + (Math.random() - .5) * 10,
      y: cy + (Math.random() - .5) * 10,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 22,
      born: t,
      life: 520 + Math.random() * 520,
      size: 9 + Math.random() * 13,
      spin: (Math.random() - .5) * 3,
      rot: Math.random() * Math.PI,
      twinkle: 7 + Math.random() * 7,
      sprite: stars[Math.floor(Math.random() * stars.length)],
    });
  }
  start();
}

// Spec: never silence when a fill can't pour. Two rings of gold stitches that die out at 60px.
export function ripple(cx, cy) {
  if (!canvas) return;
  rings.push({ x: cx, y: cy, born: now(), still: reduced() });
  start();
}

// points are client px. Resolves when it has faded, or the moment any finger lands.
export function ghostCrayon(points) {
  if (!canvas || reduced() || !points?.length || ghost) return Promise.resolve();
  return new Promise(resolve => {
    const lengths = [0];
    for (let i = 1; i < points.length; i++) {
      lengths[i] = lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    const stop = () => killGhost();
    window.addEventListener('pointerdown', stop, { capture: true, passive: true });
    ghost = { points, lengths, born: now(), resolve, stop };
    start();
  });
}

function killGhost() {
  if (!ghost) return;
  window.removeEventListener('pointerdown', ghost.stop, { capture: true });
  const { resolve } = ghost;
  ghost = null;
  resolve();
}

function start() {
  if (raf || !canvas) return;
  fit();
  raf = requestAnimationFrame(frame);
}

function frame() {
  raf = 0;
  if (!ctx) return;
  try {
    const t = now();
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (ghost) drawGhost(t);
    drawRings(t);
    drawParticles(t);
    ctx.globalAlpha = 1;
    if (particles.length || rings.length || ghost) raf = requestAnimationFrame(frame);
  } catch (err) {
    log('fx', err.message);
    killGhost();
    particles = [];
    rings = [];
  }
}

function drawParticles(t) {
  particles = particles.filter(p => t - p.born < p.life);
  for (const p of particles) {
    const age = (t - p.born) / 1000, k = (t - p.born) / p.life;
    const x = p.x + p.vx * age, y = p.y + p.vy * age + 46 * age * age;
    const pulse = .62 + .38 * Math.sin(age * p.twinkle + p.rot);
    const size = p.size * (k < .15 ? k / .15 : 1) * (.7 + .3 * pulse);
    ctx.globalAlpha = (1 - k * k) * (.55 + .45 * pulse);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.rot + p.spin * age);
    ctx.drawImage(p.sprite, -size, -size, size * 2, size * 2);
    ctx.restore();
  }
}

function drawRings(t) {
  rings = rings.filter(r => t - r.born < (r.still ? 320 : 560));
  ctx.lineCap = 'round';
  for (const r of rings) {
    if (r.still) {
      ctx.globalAlpha = 1 - (t - r.born) / 320;
      stitchedRing(r.x, r.y, 34, 2.6, '#C99A1E');
      continue;
    }
    const k = (t - r.born) / 560;
    for (const [delay, color, width] of [[0, '#C99A1E', 3], [.2, '#16224A', 2]]) {
      const local = clamp01((k - delay) / (1 - delay));
      if (local <= 0) continue;
      const eased = 1 - (1 - local) ** 3;
      ctx.globalAlpha = (1 - local) ** 1.4 * (color === '#16224A' ? .45 : .95);
      stitchedRing(r.x, r.y, 10 + eased * 50, width * (1 - local * .5), color);
    }
  }
  ctx.setLineDash([]);
}

function stitchedRing(x, y, radius, width, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash([7, 6]);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
}

function drawGhost(t) {
  const age = t - ghost.born;
  if (age > GHOST.draw + GHOST.hold + GHOST.fade) return killGhost();
  const k = clamp01(age / GHOST.draw);
  const eased = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
  const { points, lengths } = ghost;
  const reach = lengths[lengths.length - 1] * eased;
  let tip = points[0], heading = -.6, last = 0;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (lengths[i] <= reach) {
      ctx.lineTo(b.x, b.y);
      tip = b;
      last = i;
    } else {
      const part = (reach - lengths[i - 1]) / Math.max(lengths[i] - lengths[i - 1], .001);
      tip = { x: a.x + (b.x - a.x) * part, y: a.y + (b.y - a.y) * part };
      ctx.lineTo(tip.x, tip.y);
      last = i;
      break;
    }
  }
  if (last) heading = Math.atan2(tip.y - points[last - 1].y, tip.x - points[last - 1].x);
  const fade = 1 - clamp01((age - GHOST.draw - GHOST.hold) / GHOST.fade);
  ctx.lineCap = ctx.lineJoin = 'round';
  // Soft body, then a broken dashed grain on top: wax skipping over paper.
  ctx.strokeStyle = '#F2594B';
  ctx.globalAlpha = .26 * fade;
  ctx.lineWidth = 9;
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.globalAlpha = .55 * fade;
  ctx.lineWidth = 5;
  ctx.setLineDash([2.4, 1.6, .8, 2.2]);
  ctx.stroke();
  ctx.setLineDash([]);
  drawCrayon(tip, heading, fade * (age < 140 ? age / 140 : 1));
}

// The crayon leans the way a hand holds it and rocks a little with the line.
function drawCrayon(tip, heading, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha * .92;
  ctx.translate(tip.x, tip.y);
  ctx.rotate(.72 + Math.sin(heading) * .1);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#16224A';
  ctx.lineWidth = 2;
  ctx.fillStyle = '#F2594B';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-6, -13);
  ctx.lineTo(6, -13);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(-7.5, -48, 15, 35);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#FFFEFB';
  ctx.fillRect(-6.5, -40, 13, 18);
  ctx.fillStyle = '#FFC21A';
  ctx.fillRect(-6.5, -33, 13, 4);
  ctx.restore();
}
