// cdp-smoke.mjs: proves cdp.mjs against real browsers. Writes only into the scratch folder given as the argument.
//   node tools/studio-tests/cdp-smoke.mjs <scratch dir> [--browser=chrome|edge] [--base=http://localhost:5310/clothes-story/]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launch, pngDiff, readPng, sleep } from './cdp.mjs';

const args = process.argv.slice(2);
const opt = name => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const scratch = args.find(a => !a.startsWith('--'));
if (!scratch) { console.error('usage: node cdp-smoke.mjs <scratch dir> [--browser=chrome|edge]'); process.exit(2); }
const BASE = opt('base') || 'http://localhost:5310/clothes-story/';
const browsers = opt('browser') ? [opt('browser')] : ['chrome', 'edge'];

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
};

const RECORDER = 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html style="touch-action:none;height:100%"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;height:100%">
<input id="t" style="position:fixed;left:0;top:0;width:60px;height:30px">
<div style="height:3000px"></div><script>
window.rec = [];
for (const t of ['pointerdown','pointermove','pointerup','pointercancel','wheel','keydown','keyup','contextmenu'])
  addEventListener(t, e => rec.push({ t, id: e.pointerId, ty: e.pointerType, x: e.clientX, y: e.clientY, p: e.pressure, b: e.buttons, btn: e.button, prim: e.isPrimary,
    ctrl: e.ctrlKey, dy: e.deltaY, key: e.key, code: e.code, tilt: e.tiltX }), { capture: true, passive: false });
addEventListener('wheel', e => e.preventDefault(), { passive: false });
addEventListener('contextmenu', e => e.preventDefault());
window.drain = () => rec.splice(0);
</script></body></html>`);

const drain = page => page.eval('drain()');
const kinds = list => list.map(e => e.t);

async function run(browser) {
  console.log(`\n=== ${browser}`);
  const dir = path.join(scratch, 'smoke-' + browser);
  const page = await launch({ browser, profileDir: path.join(dir, 'profile'), width: 600, height: 500, dsf: 2, mobile: true, touch: true });
  const pid = page.browser.child.pid;
  try {
    await page.goto(RECORDER);
    check('eval returns values', await page.eval('1 + 2') === 3);
    check('eval awaits promises', await page.eval('Promise.resolve({ a: [1, 2] })').then(v => v.a[1] === 2));
    check('eval takes a function with args', await page.eval((a, b) => a * b, 6, 7) === 42);
    const err = await page.eval('nope.nope').catch(e => e.message);
    check('eval errors are clear', /ReferenceError: nope is not defined/.test(err) && /nope\.nope/.test(err));

    const media = await page.eval(`({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, tp: navigator.maxTouchPoints,
      coarse: matchMedia('(pointer:coarse)').matches, noHover: matchMedia('(hover:none)').matches })`);
    check('viewport and touch emulation', media.w === 600 && media.h === 500 && media.dpr === 2 && media.tp >= 5, JSON.stringify(media));
    check('coarse pointer media', media.coarse && media.noHover);

    // Two fingers: land, move, lift one, the other keeps going.
    await drain(page);
    await page.touchStart({ x: 100, y: 200 });
    await page.touchStart({ id: 1, x: 300, y: 200 });
    await page.touchMove([{ id: 0, x: 90, y: 200 }, { id: 1, x: 320, y: 210 }]);
    await page.touchEnd(1);
    await page.touchMove({ id: 0, x: 80, y: 220 });
    await page.touchEnd();
    await sleep(50);
    let log = await drain(page);
    const seq = kinds(log).join(' ');
    const down = log.filter(e => e.t === 'pointerdown');
    const up = log.filter(e => e.t === 'pointerup');
    check('two fingers give two pointerdowns, type touch', down.length === 2 && down.every(e => e.ty === 'touch') && down[0].id !== down[1].id, seq);
    check('first finger is primary, second is not', down[0]?.prim === true && down[1]?.prim === false);
    check('lifting one finger leaves the other down', up.length === 2 && up[0].id === down[1]?.id && up[1].id === down[0]?.id &&
      log.some((e, i) => e.t === 'pointermove' && e.id === down[0]?.id && i > log.indexOf(up[0])));

    await page.touchStart({ x: 50, y: 60 });
    await page.touchCancel();
    await sleep(50);
    log = await drain(page);
    check('touchCancel makes a real pointercancel', log.some(e => e.t === 'pointercancel' && e.ty === 'touch'), kinds(log).join(' '));

    // Pen: pressure comes from force.
    await page.penHover(100, 100);
    await page.penDown(110, 100, { force: 0.3, tiltX: 20 });
    await page.penMove(130, 110, { force: 0.8 });
    await page.penUp(130, 110);
    await sleep(50);
    log = await drain(page);
    const penDown = log.find(e => e.t === 'pointerdown');
    const penMove = log.filter(e => e.t === 'pointermove').at(-1);
    check('pen down has type pen, pressure, tilt', penDown?.ty === 'pen' && Math.abs(penDown.p - 0.3) < 0.01 && penDown.tilt === 20 && penDown.b === 1, JSON.stringify(penDown));
    check('pen move carries pressure and buttons', penMove?.ty === 'pen' && Math.abs(penMove.p - 0.8) < 0.01 && penMove.b === 1, JSON.stringify(penMove));
    check('pen up arrives', log.some(e => e.t === 'pointerup' && e.ty === 'pen'));
    check('pen hover before down has no buttons', log[0]?.t === 'pointermove' && log[0]?.b === 0, JSON.stringify(log[0]));

    await page.penDown(110, 100, { force: 0.5, buttons: 32 });
    await page.penUp(110, 100);
    await sleep(50);
    log = await drain(page);
    const barrel = log.find(e => e.t === 'pointerdown');
    console.log(`  note pen buttons:32 through CDP arrives as buttons=${barrel?.b}, button=${barrel?.btn}`);
    await page.synthPointer('html', 'pointerdown', { pointerType: 'pen', buttons: 32, button: 5, clientX: 5, clientY: 6, pressure: 0.5 });
    log = await drain(page);
    check('synthPointer can make a barrel press', log[0]?.b === 32 && log[0]?.btn === 5 && log[0]?.ty === 'pen', JSON.stringify(log[0]));

    // Mouse, wheel, keys.
    await page.mouseMove(10, 10);
    await page.mouseDown(10, 10);
    await page.mouseMove(40, 40);
    await page.mouseUp(40, 40);
    await page.mouseDown(50, 50, { button: 'right' });
    await page.mouseUp(50, 50, { button: 'right' });
    await sleep(50);
    log = await drain(page);
    check('mouse down, drag and up', log.some(e => e.t === 'pointerdown' && e.ty === 'mouse' && e.btn === 0) && log.some(e => e.t === 'pointermove' && e.b === 1 && e.x === 40));
    check('right button arrives as button 2', log.some(e => e.t === 'pointerdown' && e.btn === 2 && e.b === 2));

    await page.wheel(200, 200, 0, 120, { ctrl: true });
    await page.wheel(200, 200, 0, 60);
    await sleep(100);
    log = await drain(page);
    const wheels = log.filter(e => e.t === 'wheel');
    check('wheel with and without ctrl', wheels.length === 2 && wheels[0].ctrl && wheels[0].dy === 120 && !wheels[1].ctrl && wheels[1].dy === 60, JSON.stringify(wheels.map(w => [w.ctrl, w.dy])));

    await page.key('z', { ctrl: true });
    await page.key(' ');
    await page.keyDown('a');
    await page.keyUp('a');
    await page.key('Enter');
    log = await drain(page);
    const keydowns = log.filter(e => e.t === 'keydown');
    check('keys with modifiers', keydowns[0]?.key === 'z' && keydowns[0]?.ctrl && keydowns[0]?.code === 'KeyZ', JSON.stringify(keydowns[0]));
    check('space, letter and enter', keydowns.map(e => e.code).join() === 'KeyZ,Space,KeyA,Enter', keydowns.map(e => e.code).join());

    // Screenshot and pixel diff.
    const a = await page.screenshot(path.join(dir, 'a.png'));
    const b = await page.screenshot(path.join(dir, 'b.png'));
    const png = readPng(a);
    check('screenshot is a PNG at device pixels', png.width === 1200 && png.height === 1000, `${png.width}x${png.height}`);
    check('pngDiff says identical shots are the same', pngDiff(a, b).same);
    await page.eval(`document.body.style.background = '#f00'`);
    const c = await page.screenshot(path.join(dir, 'c.png'));
    const d = pngDiff(a, c);
    check('pngDiff sees a change', !d.same && d.diffPixels > 1000, `${d.diffPixels} px`);

    // Rotation, then back.
    await page.setViewport({ width: 500, height: 300, dsf: 1, mobile: false, orientation: 'landscape' });
    check('setViewport applies', await page.eval('innerWidth + "x" + innerHeight + "@" + devicePixelRatio') === '500x300@1');
    await page.setViewport({ width: 794, height: 1122 });

    // Console capture: thrown, console.error, 404.
    page.clearConsole();
    await page.eval(`console.error('smoke-error'); setTimeout(() => { throw new Error('smoke-throw'); }); fetch(${JSON.stringify(BASE + 'no-such-file.xyz')}).catch(() => {}); 0`);
    await sleep(400);
    const errs = page.consoleErrors();
    check('consoleErrors has console.error', errs.some(e => e.includes('smoke-error')));
    check('consoleErrors has thrown errors', errs.some(e => e.includes('smoke-throw')));
    page.clearConsole();

    // The real page: language switch, print, cache disabled.
    await page.goto(BASE + '?lang=vi');
    check('goto loads the packet', await page.eval(`document.querySelectorAll('.sheet').length`) === 4);
    await page.setLang('en');
    check('setLang goes through lang.js', await page.eval(`[document.documentElement.dataset.lang, document.querySelector('[data-set-lang="en"]').getAttribute('aria-pressed')].join()`) === 'en,true');
    await page.setLang('vi');
    const cached = await page.eval(`performance.getEntriesByType('navigation')[0].transferSize > 0`);
    check('cache off: document came over the network', cached);
    const pdf = await page.printPDF(path.join(dir, 'plain.pdf'));
    check('printPDF writes a PDF and counts pages', pdf.bytes > 1000 && pdf.pages >= 4 && fs.readFileSync(pdf.path).subarray(0, 4).toString() === '%PDF', `pages=${pdf.pages} bytes=${pdf.bytes}`);

    await page.setMedia({ media: 'print' });
    check('setMedia print', await page.eval(`matchMedia('print').matches`));
    await page.setMedia({ media: '', features: { 'prefers-reduced-motion': 'reduce' } });
    check('setMedia reduced motion, print off', await page.eval(`matchMedia('(prefers-reduced-motion:reduce)').matches && !matchMedia('print').matches`));

    // Throttle: a spin of the same work takes longer.
    const spin = `(() => { const t = performance.now(); let s = 0; for (let i = 0; i < 2e7; i++) s += i % 7; return performance.now() - t; })()`;
    const fast = await page.eval(spin);
    await page.throttle(6);
    const slow = await page.eval(spin);
    await page.throttle(1);
    check('throttle slows the page', slow > fast * 2, `${fast.toFixed(0)}ms -> ${slow.toFixed(0)}ms`);

    // Second tab, shared storage, rAF alive in both.
    const tab = await page.newPage();
    await tab.goto(BASE + '?lang=vi');
    await page.eval(`localStorage.setItem('smoke', 'shared')`);
    check('newPage shares the profile', await tab.eval(`localStorage.getItem('smoke')`) === 'shared');
    check('rAF runs in both tabs', await tab.frames(2) === true && await page.frames(2) === true);
    await tab.close();
    check('browser survives closing the second tab', await page.eval('1') === 1);

    // A crashed tab reports it, and a new navigation brings it back.
    const crash = await page.send('Page.crash', {}, { timeoutMs: 3000 }).then(() => 'replied', e => e.message);
    check('Page.crash is reported', page.crashed || /crash|no reply/.test(crash), crash);
    await page.goto(BASE + '?lang=vi');
    check('goto recovers after a crash', await page.eval('document.querySelectorAll(".sheet").length') === 4);
  } finally {
    await page.close();
  }
  await sleep(200);
  const stillThere = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8' }).stdout.includes(String(pid));
  check('close() ended our own process', !stillThere, `pid ${pid}`);

  // Same profile again, so tests can relaunch into saved data.
  const again = await launch({ browser, profileDir: path.join(dir, 'profile'), width: 400, height: 300 });
  try {
    await again.goto(BASE + '?lang=vi');
    check('relaunch keeps the profile', await again.eval(`localStorage.getItem('smoke')`) === 'shared');
  } finally { await again.close(); }

  const refused = await launch({ browser, profileDir: 'C:/Users/x/AppData/Local/Google/Chrome/User Data' }).then(() => null, e => e.message);
  check('the real profile is refused', /refusing/.test(refused ?? ''));
}

for (const b of browsers) await run(b);
console.log(failures ? `\n${failures} check(s) failed` : '\nall smoke checks passed');
process.exit(failures ? 1 : 0);
