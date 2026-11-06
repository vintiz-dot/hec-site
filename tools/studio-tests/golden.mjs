// golden.mjs: measures the contract rects (draw boxes, name line, 14 blanks, 2 signature lines, 8 ticks) in paper mode
// and compares them with GOLDEN in clothes-story/studio/constants.js.
//
//   node tools/studio-tests/golden.mjs                check: vi and en, screen and print media, viewports 360, 794, 1280, within 0.5px
//   node tools/studio-tests/golden.mjs --write        rewrite GOLDEN from a fresh measurement, then review the diff
//   options: --browser=chrome|edge  --base=<url of /clothes-story/>  --profile=<dir>
//
// If packet text moves a rect: run --write, review it, and bump LAYOUT_V[sheet] in constants.js for each sheet it names.
// --write raises GOLDEN_V[sheet] for a sheet whose rects moved, and the check fails until LAYOUT_V[sheet] matches it,
// so a move cannot ship without a bump (section 7.4).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CONSTANTS_FILE = path.resolve(HERE, '../../clothes-story/studio/constants.js');
export const DEFAULT_BASE = 'http://localhost:5310/clothes-story/';
export const VIEWPORTS = [[360, 640], [794, 1122], [1280, 800]];
export const LANGS = ['vi', 'en'];
export const MEDIA = ['screen', 'print'];
export const TOLERANCE_PX = 0.5;

// Puts a freshly loaded packet into measuring state, the same state targets.build() measures in.
const ENTER_PAPER = `(async () => {
  document.documentElement.classList.add('paper');
  document.querySelector('.book').classList.add('measure');
  await document.fonts.load('700 18px "Nunito Paper"', 'Hello');
})()`;

const MEASURE = `(() => {
  const rects = {}, sheets = {};
  for (const s of document.querySelectorAll('.sheet[data-sheet]')) {
    const o = s.getBoundingClientRect();
    sheets[s.dataset.sheet] = [o.width, o.height];
    for (const el of s.querySelectorAll('[data-f],[data-box]')) {
      const r = el.getBoundingClientRect();
      rects[el.dataset.box || el.dataset.f] = { sheet: Number(s.dataset.sheet), rect: [r.left - o.left, r.top - o.top, r.width, r.height].map(v => Math.round(v * 100) / 100) };
    }
  }
  return { rects, sheets };
})()`;

export async function enterPaper(page, base = DEFAULT_BASE, lang = 'vi') {
  await page.goto(`${base}?nostudio=1&lang=${lang}`);
  await page.eval(ENTER_PAPER);
}

export const measure = page => page.eval(MEASURE);

export async function loadConstants() {
  return import(`${pathToFileURL(CONSTANTS_FILE).href}?t=${Date.now()}`);
}

const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= TOLERANCE_PX);

// Differences between one measurement and GOLDEN, as readable lines.
export function compare({ rects, sheets }, GOLDEN, { SHEET_W, SHEET_H }) {
  const out = [];
  for (const [n, [w, h]] of Object.entries(sheets)) {
    if (Math.abs(w - SHEET_W) > TOLERANCE_PX || Math.abs(h - SHEET_H) > TOLERANCE_PX) out.push(`sheet ${n} is ${w}x${h}, expected ${SHEET_W}x${SHEET_H}`);
  }
  for (const [id, want] of Object.entries(GOLDEN)) {
    if (!rects[id]) out.push(`${id}: not in the page`);
    else if (!close(rects[id].rect, want)) out.push(`${id}: measured [${rects[id].rect}], golden [${want}]`);
  }
  for (const id of Object.keys(rects)) if (!GOLDEN[id]) out.push(`${id}: not in GOLDEN`);
  return out;
}

// Every sheet whose LAYOUT_V has not caught up with the moves --write recorded.
export function bumpProblems({ LAYOUT_V, GOLDEN_V, SHEETS }) {
  return SHEETS.filter(n => LAYOUT_V[n] !== GOLDEN_V[n]).map(n => `sheet ${n}: rects moved, so LAYOUT_V[${n}] must be ${GOLDEN_V[n]}, it is ${LAYOUT_V[n]}`);
}

// The full matrix. Returns a list of { where, problems }, empty problems meaning that combination passed.
export async function checkAll(page, base = DEFAULT_BASE) {
  const constants = await loadConstants();
  const results = [];
  for (const [width, height] of VIEWPORTS) {
    await page.setViewport({ width, height });
    await enterPaper(page, base, 'vi');
    for (const lang of LANGS) {
      await page.setLang(lang);
      for (const media of MEDIA) {
        await page.setMedia({ media: media === 'print' ? 'print' : '' });
        results.push({ where: `${width}px ${lang} ${media}`, problems: compare(await measure(page), constants.GOLDEN, constants) });
      }
    }
    await page.setMedia({ media: '' });
  }
  return results;
}

function formatGolden(rects) {
  const ids = Object.keys(rects).sort((a, b) => rects[a].sheet - rects[b].sheet);
  const lines = ids.map(id => `  '${id}':[${rects[id].rect.map(v => Math.round(v * 10) / 10).join(',')}],`);
  return `export const GOLDEN = {\n${lines.join('\n')}\n};`;
}

const formatV = v => `export const GOLDEN_V = {${Object.entries(v).map(([k, n]) => `${k}:${n}`).join(', ')}};`;

async function write(page, base) {
  const constants = await loadConstants();
  await page.setViewport({ width: 794, height: 1122 });
  await enterPaper(page, base, 'vi');
  const vi = await measure(page);
  await page.setLang('en');
  const en = await measure(page);
  const notInvariant = Object.keys(vi.rects).filter(id => !en.rects[id] || !close(vi.rects[id].rect, en.rects[id].rect));
  if (notInvariant.length) {
    console.error(`Not writing: these rects differ between vi and en, fix paper.css first: ${notInvariant.join(', ')}`);
    return 1;
  }
  const moved = new Map();
  const next = {};
  for (const [id, { sheet, rect }] of Object.entries(vi.rects)) {
    const old = constants.GOLDEN[id];
    if (old && close(rect, old)) { next[id] = { sheet, rect: old }; continue; } // no churn inside the tolerance
    next[id] = { sheet, rect };
    if (!moved.has(sheet)) moved.set(sheet, []);
    moved.get(sheet).push(`${id}: [${old ?? 'new'}] -> [${rect.map(v => Math.round(v * 10) / 10)}]`);
  }
  for (const id of Object.keys(constants.GOLDEN)) {
    if (next[id]) continue;
    const sheet = Number(id[1]);
    if (!moved.has(sheet)) moved.set(sheet, []);
    moved.get(sheet).push(`${id}: removed`);
  }
  if (!moved.size) { console.log('GOLDEN already matches. Nothing written.'); return 0; }
  const goldenV = { ...constants.GOLDEN_V };
  for (const sheet of moved.keys()) goldenV[sheet] = Math.max(constants.LAYOUT_V[sheet], constants.GOLDEN_V[sheet] + 1);
  const source = fs.readFileSync(CONSTANTS_FILE, 'utf8');
  const updated = source
    .replace(/export const GOLDEN = \{[\s\S]*?\n?\};/, () => formatGolden(next))
    .replace(/export const GOLDEN_V = \{[^}]*\};/, () => formatV(goldenV));
  fs.writeFileSync(CONSTANTS_FILE, updated);
  for (const [sheet, lines] of [...moved].sort((a, b) => a[0] - b[0])) {
    console.log(`Sheet ${sheet} moved, review:\n  ${lines.join('\n  ')}`);
    if (constants.LAYOUT_V[sheet] !== goldenV[sheet]) console.log(`  Now set LAYOUT_V[${sheet}] to ${goldenV[sheet]} in constants.js. The check fails until you do.`);
  }
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = name => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const base = opt('base') || DEFAULT_BASE;
  const page = await launch({ browser: opt('browser') || 'chrome', profileDir: opt('profile') });
  try {
    if (args.includes('--write')) return await write(page, base);
    const constants = await loadConstants();
    const results = await checkAll(page, base);
    let failed = 0;
    for (const { where, problems } of results) {
      if (problems.length) failed++;
      console.log(`${problems.length ? 'FAIL' : 'ok  '} ${where}`);
      for (const p of problems) console.log(`     ${p}`);
    }
    const bumps = bumpProblems(constants);
    for (const b of bumps) console.log(`FAIL ${b}`);
    const errors = page.consoleErrors();
    if (errors.length) console.log(`note console errors:\n  ${errors.join('\n  ')}`);
    console.log(failed || bumps.length ? `\n${failed} of ${results.length} combinations failed, ${bumps.length} missing bump(s)` : `\nall ${results.length} combinations match GOLDEN within ${TOLERANCE_PX}px`);
    return failed || bumps.length ? 1 : 0;
  } finally {
    await page.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exit(await main());
