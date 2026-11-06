// m2.mjs: milestone 2, the reaction, driven the way a child and a parent would, with real input.
//   node tools/studio-tests/m2.mjs <scratch dir> [phone,tablet,laptop]
// Server: BASE env, default http://localhost:5310. Screenshots land in <scratch dir>/m2. Exit code is the fail count.
import path from 'node:path';
import fs from 'node:fs';
import { launch, sleep } from './cdp.mjs';

const OUT = path.join(process.argv[2] || '.', 'm2');
const ONLY = (process.argv[3] || 'phone,tablet,laptop').split(',');
const URL0 = (process.env.BASE || 'http://localhost:5310') + '/clothes-story/?test=1&noguide=1';
const DEVICES = {
  phone: { width: 360, height: 640, dsf: 2, mobile: true, touch: true },
  tablet: { width: 768, height: 1024, dsf: 1, mobile: true, touch: true },
  laptop: { width: 1280, height: 800, dsf: 1, mobile: false, touch: false },
  land: { width: 640, height: 360, dsf: 2, mobile: true, touch: true },
};
let passed = 0, failed = 0;
const fails = [];
fs.mkdirSync(OUT, { recursive: true });

// Ink of the live page, read through a small copy (never getImageData on the paint canvas).
const INK = `(()=>{const p=window.__studio.engine.paintCanvas();const c=document.createElement('canvas');c.width=p.width>>2;c.height=p.height>>2;
  const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(p,0,0,c.width,c.height);window.__studio.objects.drawInto(x,{x:0,y:0},c.width/794);const d=x.getImageData(0,0,c.width,c.height).data;
  let n=0,h=0;for(let i=0;i<d.length;i+=4){if(d[i+3]>12){n++;h=(h*31+(d[i]>>3)+(d[i+1]>>3)*7+(d[i+3]>>4)*3+i)>>>0}}return {n,h}})()`;
// Ink in a sheet rect: count, left and right halves, distinct colour buckets.
const INKIN = r => `(()=>{const p=window.__studio.engine.paintCanvas(),S=p.width/794,r=${JSON.stringify(r)};const c=document.createElement('canvas');c.width=Math.ceil(r.w/2);c.height=Math.ceil(r.h/2);
  const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(p,r.x*S,r.y*S,r.w*S,r.h*S,0,0,c.width,c.height);window.__studio.objects.drawInto(x,{x:r.x,y:r.y},c.width/r.w);const d=x.getImageData(0,0,c.width,c.height).data;
  let n=0,L=0,R=0;const cols=new Set();for(let i=0;i<d.length;i+=4){if(d[i+3]>40){n++;const px=(i/4)%c.width;if(px<c.width/2)L++;else R++;cols.add((d[i]>>4)<<8|(d[i+1]>>4)<<4|(d[i+2]>>4))}}return {n,L,R,cols:cols.size}})()`;
const GHOST = `(()=>{const e=document.querySelector('.st-ghost');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height}})()`;

async function flow(name, d) {
  const prefix = name + ': ';
  const check = (what, ok, extra = '') => {
    if (ok) { passed++; return; }
    failed++; fails.push(prefix + what + (extra !== '' ? ' -> ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 260) : ''));
  };
  const page = await launch({ browser: 'chrome', profileDir: path.join(OUT, `prof-${name}-${Date.now()}`), width: d.width, height: d.height, dsf: d.dsf, mobile: d.mobile, touch: d.touch });
  const shot = f => page.screenshot(path.join(OUT, `${name}-${f}.png`));
  const tap = async (x, y) => {
    if (d.touch) { await page.touchStart({ x, y }); await sleep(35); await page.touchEnd(); }
    else { await page.mouseMove(x, y); await page.mouseDown(x, y); await sleep(30); await page.mouseUp(x, y); }
    await sleep(170);
  };
  const pos = sel => page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e||e.hidden)return null;if(e.closest('.st-scroll'))e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return r.width?{x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height}:null})()`);
  const tapSel = async sel => { const c = await pos(sel); check('present ' + sel, !!c); if (c) await tap(c.x, c.y); return !!c; };
  const draw = async pts => {
    if (d.touch) {
      await page.touchStart({ x: pts[0][0], y: pts[0][1] });
      for (const p of pts.slice(1)) { await page.touchMove([{ id: 0, x: p[0], y: p[1] }]); await sleep(9); }
      await page.touchEnd();
    } else {
      await page.mouseMove(pts[0][0], pts[0][1]); await page.mouseDown(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) { await page.mouseMove(p[0], p[1]); await sleep(9); }
      await page.mouseUp(pts.at(-1)[0], pts.at(-1)[1]);
    }
    await sleep(170);
  };
  const ink = () => page.eval(INK);
  const st = k => page.eval(`window.__studio.state.get(${JSON.stringify(k)})`);
  const ready = () => page.waitFor('window.__studio?.engine?.activeSheet?.()>0&&document.querySelector(".st-tools")&&!document.querySelector(".st-loader")', { timeoutMs: 20000 });
  // A box in sheet px and on screen, clipped to the free area.
  const boxOf = id => page.eval(`(()=>{const S=window.__studio;const c=S.constants.BOXES[${JSON.stringify(id)}].rect;const v=S.viewport;const a=v.toClient(c.x,c.y),b=v.toClient(c.x+c.w,c.y+c.h);
    const f=document.querySelector('.page').getBoundingClientRect();const l=Math.max(a.x,f.left),t=Math.max(a.y,f.top),r=Math.min(b.x,f.right),bt=Math.min(b.y,f.bottom);return {sheet:c,l,t,r,b:bt,w:r-l,h:bt-t,full:{l:a.x,t:a.y,r:b.x,b:b.y}}})()`);
  const tool = async id => {
    if (['marker', 'paint', 'stitch'].includes(id)) { await tapSel('.st-tool[data-tool="more"]'); await tapSel(`.st-drawer-tool[data-tool="${id}"]`); }
    else await tapSel(`.st-tool[data-tool="${id}"]`);
    check(`tool ${id} selected`, await st('tool') === id, await st('tool'));
  };
  const swatch = async id => {
    await tapSel('.st-pal-btn'); await sleep(200);
    await tapSel(`.st-palette [data-sw="${id}"]`); await sleep(200);
    check(`palette gives ${id}`, await st('swatch') === id, await st('swatch'));
  };
  const leaveBox = async () => { if (await st('box')) { await tapSel('.st-chip-whole'); await sleep(550); } };
  const waveIn = (b, fy, n = 26, amp = 8, fx0 = .15, fx1 = .85) => Array.from({ length: n }, (_, i) => [b.l + b.w * (fx0 + (fx1 - fx0) * i / (n - 1)), b.t + b.h * fy + Math.sin(i / 2) * amp]);

  try {
    // ---- first run: the intro ----
    await page.goto(URL0);
    await page.waitFor('document.getElementById("studio-reading-cta")');
    await sleep(400);
    await tapSel('#studio-reading-cta');
    await ready();
    await sleep(2500);
    await shot('01-open');
    const zoomed = await st('box');
    if (name === 'phone') check('phone zooms into first box', zoomed === 'p1-uniform', zoomed);
    else {
      check('big screen stays at fit page', !zoomed, zoomed);
      check('gold hint on first box', !!await pos('.st-box-hint'));
    }
    const lure = await pos('.st-chip-lure');
    check('T-shirt waits in the empty box', !!lure);
    check('T-shirt big enough', lure && lure.w >= 60 && lure.h >= 60, lure);
    check('tool on opening is crayon', await st('tool') === 'crayon');
    check('swatch on opening is red', await st('swatch') === 'red');

    // ---- the gasp: exactly two taps from opening ----
    const before = await ink();
    check('page blank at start', before.n === 0, before);
    await tap(lure.x, lure.y);
    await sleep(500);
    check('T-shirt arms a sticker', await page.eval('window.__studio.stickers.isPlacing()'));
    check('card has gone', !await pos('.st-chip-lure'));
    await shot('02-armed');
    const denim = await pos('.st-dot[data-sw="denim"]');
    check('denim dot on screen', !!denim && denim.y < d.height && denim.x < d.width, denim);
    await page.eval(`(()=>{window.__rev=0;window.__commits=[];const t0=performance.now();let on=1;const f=()=>{if(!on)return;window.__rev++;requestAnimationFrame(f)};window.__stopRev=()=>{on=0};window.__studio.bus.on('object:added',()=>window.__commits.push(Math.round(performance.now()-t0)));window.__studio.bus.on('object:poured',()=>{window.__commits.push(Math.round(performance.now()-t0));setTimeout(()=>{window.__revealing=[...document.querySelectorAll('img.st-obj')].some(i=>i.style.clipPath)},200)});requestAnimationFrame(f);return 1})()`);
    await tap(denim.x, denim.y);
    await page.waitFor('window.__commits.length>=2', { timeoutMs: 4000 }).catch(() => {});
    const commits = await page.eval('window.__commits');
    await page.eval('window.__stopRev()');
    const frames = await page.eval('window.__rev');
    check('sticker then pour commit', commits.length >= 2, commits);
    await sleep(260);
    check('pour plays, not cut short', await page.eval('!!window.__revealing'));
    await sleep(500);
    await shot('03-denim');
    const b1 = await boxOf('p1-uniform');
    const cloth = await page.eval(INKIN(b1.sheet));
    check('cloth landed with texture and stitching', cloth.n > 1500 && cloth.cols >= 3, cloth);
    check('no sticker tool left in hand', await st('tool') !== 'stickers', await st('tool'));
    check('swatch is denim', await st('swatch') === 'denim');
    check('no console errors at gasp', page.consoleErrors().length === 0, page.consoleErrors());

    // try another colour on the same shirt: a re-pour, not a second layer
    const redDot = await pos('.st-dot[data-sw="red"]');
    await tap(redDot.x, redDot.y); await sleep(1000);
    await shot('04-tryon');
    const inkRed = await page.eval(INKIN(b1.sheet));
    check('another colour re-pours', Math.abs(inkRed.n - cloth.n) < cloth.n * .12, { inkRed, cloth });
    await tapSel('.st-undo'); await sleep(350);
    check('undo keeps the shirt', (await ink()).n > 0);
    for (let i = 0; i < 2; i++) { await tapSel('.st-undo'); await sleep(300); }
    const empty = await ink();
    check('undo all the way to blank', empty.n === 0, empty);

    // ---- stickers: tray, drag, commit ----
    await tool('stickers');
    await sleep(250);
    const tray = await page.eval(`document.querySelectorAll('.st-tray [data-sticker]').length`);
    check('16 stickers in tray', tray === 16, tray);
    await shot('05-tray');
    await tapSel('.st-tray [data-sticker="dress"]');
    await sleep(500);
    check('sticker in hand', await page.eval('window.__studio.stickers.isPlacing()'));
    const g = await page.eval(GHOST);
    check('ghost on screen', !!g, g);
    if (g) {
      const to = { x: g.x + 20, y: g.y - 26 };
      await draw(Array.from({ length: 8 }, (_, i) => [g.x + (to.x - g.x) * i / 7, g.y + (to.y - g.y) * i / 7]));
      const g2 = await page.eval(GHOST);
      check('sticker follows a drag', g2 && Math.hypot(g2.x - to.x, g2.y - to.y) < 14, { g2, to });
      await shot('06-placing');
      // the corner handle scales it, with the finger
      const h = await page.eval(`(()=>{const c=document.querySelector('.st-ghost g circle');const r=c.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
      await draw(Array.from({ length: 8 }, (_, i) => [h.x - 40 * i / 7, h.y - 40 * i / 7]));
      const g3 = await page.eval(GHOST);
      check('corner handle scales the sticker', g3 && g3.w < g2.w - 20, { g2, g3 });
    }
    await tool('crayon');
    check('other action commits the sticker', !await page.eval('window.__studio.stickers.isPlacing()'));
    await sleep(250);
    const stuck = await ink();
    check('sticker became ink', stuck.n > 0, stuck);
    await tapSel('.st-undo'); await sleep(350);

    // tray closes on an outside tap, leaving the last draw tool
    await tool('stickers'); await sleep(200);
    // a point clear of the tray: on a phone it covers most of the box
    const clear = await page.eval(`(()=>{const f=document.querySelector('.page').getBoundingClientRect(),t=document.querySelector('.st-tray').getBoundingClientRect();
      const y=t.top-f.top>30?f.top+(t.top-f.top)/2:(t.bottom+f.bottom)/2;const x=t.left-f.left>40?f.left+(t.left-f.left)/2:(f.left+f.right)/2;return {x,y:t.top-f.top>30||t.left-f.left<=40?y:f.top+30}})()`);
    await tap(clear.x, clear.y); await sleep(250);
    check('tray closed on outside tap', !await pos('.st-tray'));
    check('outside tap inked nothing', (await ink()).n === 0);
    check('tool back to a drawing tool', await st('tool') !== 'stickers', await st('tool'));

    // ---- swatches: fabric, rainbow, glitter as strokes ----
    await tool('crayon');
    const area = await boxOf('p1-uniform');
    const ys = { denim: .2, gingham: .34, rainbow: .48, glitter: .62 };
    const look = {};
    for (const id of Object.keys(ys)) {
      await swatch(id);
      await draw(waveIn(area, ys[id]));
      await sleep(150);
      // the stroke's own band, in sheet px; on a laptop the box runs past the fold, so go through the screen
      const k = area.sheet.h / (area.full.b - area.full.t), sy = area.sheet.y + (area.t + area.h * ys[id] - area.full.t) * k;
      look[id] = await page.eval(INKIN({ x: area.sheet.x, y: sy - 16 * k, w: area.sheet.w, h: 32 * k }));
    }
    await shot('07-swatches');
    for (const id of Object.keys(look)) check(`${id} stroke lands`, look[id].n > 40, look[id]);
    if (look.rainbow) check('rainbow has many colours', look.rainbow.cols >= 6, look);
    check('no console errors after swatches', page.consoleErrors().length === 0, page.consoleErrors());
    // Eraser, then a swatch pick, returns to the drawing tool
    await tool('eraser');
    const yellow = await pos('.st-dot[data-sw="yellow"]');
    await tap(yellow.x, yellow.y);
    check('swatch pick leaves eraser', await st('tool') === 'crayon', await st('tool'));
    for (let i = 0; i < 4; i++) { await tapSel('.st-undo'); await sleep(200); }
    await sleep(300);
    const cleaned = await ink();
    check('undo clears strokes', cleaned.n === 0, cleaned);

    // ---- Box Mode and Mirror ----
    await leaveBox();
    const zoomChip = await pos('.st-chip-zoom:not([hidden])');
    check('zoom chip present', !!zoomChip);
    await tap(zoomChip.x, zoomChip.y);
    await sleep(700);
    check('zoom chip enters Box Mode', await st('box') === 'p1-uniform', await st('box'));
    check('mirror chip shown', !!await pos('.st-chip-mirror'));
    await tapSel('.st-chip-mirror'); await sleep(200);
    check('mirror on', await st('mirror') === true);
    check('axis on screen', !!await pos('.st-axis'));
    const m = await boxOf('p1-uniform');
    const mid = (m.full.l + m.full.r) / 2;
    const yy = m.t + m.h * .4;
    await page.eval(`window.__studio.state.set('swatch','navy')`);
    await draw(Array.from({ length: 20 }, (_, i) => [mid - 20 - Math.min(m.w * .35, 110) * i / 19, yy + Math.sin(i / 3) * 10]));
    await sleep(200);
    const ms = await page.eval(INKIN(m.sheet));
    check('one sleeve draws two', ms.L > 40 && ms.R > 40 && Math.abs(ms.L - ms.R) < Math.max(ms.L, ms.R) * .25, ms);
    await shot('08-mirror');
    // a stroke off the box edge stays inside
    await tapSel('.st-chip-mirror'); await sleep(150);
    check('mirror off', await st('mirror') === false, await st('mirror'));
    await page.eval(`window.__studio.state.set('swatch','red')`);
    await draw(Array.from({ length: 18 }, (_, i) => [m.l + m.w * .5, m.t + m.h * .6 + (m.h * .4 - 2) * i / 17]));
    const below = await page.eval(INKIN({ x: m.sheet.x, y: m.sheet.y + m.sheet.h + 2, w: m.sheet.w, h: 40 }));
    check('Box Mode clips the stroke', below.n === 0, below);
    await tapSel('.st-chip-mirror'); await sleep(150);
    await leaveBox();
    check('leaving box clears mirror', !await st('mirror'), await st('mirror'));
    check('mirror chip gone', !await pos('.st-chip-mirror'));

    // ---- Magic Fill: closed crayon shape, then the dark panel ----
    await tool('crayon');
    await page.eval(`window.__studio.state.set('swatch','navy')`);
    const f0 = await boxOf('p1-weekend');
    const cx = f0.l + f0.w / 2, cy = f0.t + f0.h * .5, rr = Math.min(f0.w, f0.h) * .28;
    await draw(Array.from({ length: 50 }, (_, i) => [cx + Math.cos(i / 46 * 6.283) * rr, cy + Math.sin(i / 46 * 6.283) * rr]));
    await tool('fill');
    const beforeFill = await page.eval(INKIN(f0.sheet));
    await page.eval(`window.__studio.state.set('swatch','gingham')`);
    await tap(cx, cy); await sleep(1100);
    const afterFill = await page.eval(INKIN(f0.sheet));
    check('Magic Fill fills the closed shape', afterFill.n > beforeFill.n * 1.5, { beforeFill, afterFill });
    await shot('09-fill');
    await page.eval(`window.__results=[];window.__studio.bus.on('fill:result',r=>window.__results.push(r.result));1`);
    if (name === 'laptop') { await page.wheel(640, 500, 0, 300); await sleep(350); }
    const panel = await page.eval(`(()=>{const S=window.__studio;const f=document.querySelector('.page').getBoundingClientRect();for(const d of S.targets.dark(1)){const a=S.viewport.toClient(d.x,d.y),b=S.viewport.toClient(d.x+d.w,d.y+d.h);if(a.y>f.top&&b.y<f.bottom)return {l:a.x,t:a.y,r:b.x,b:b.y,vis:true,sheet:d}}return null})()`);
    check('a dark panel is on screen', !!panel?.vis);
    const inkA = await ink();
    if (panel?.vis) {
      await tap((panel.l + panel.r) / 2, (panel.t + panel.b) / 2); await sleep(350);
      const res = await page.eval('window.__results');
      check('fill on a dark panel is a miss', res.includes('miss'), res);
      check('dark panel saves nothing', (await ink()).h === inkA.h);
      // ---- dead zone: a stroke across it sparkles ----
      await tool('crayon');
      await page.eval(`(()=>{window.__spark=0;const c=document.querySelector('#studio-fx canvas')||document.querySelector('canvas#studio-fx');window.__fxCanvas=!!c;return 1})()`);
      const from = await ink();
      const pts = Array.from({ length: 20 }, (_, i) => [panel.l + 12 + (panel.r - panel.l - 24) * i / 19, (panel.t + panel.b) / 2 + Math.sin(i) * 5]);
      if (d.touch) {
        await page.touchStart({ x: pts[0][0], y: pts[0][1] });
        for (const p of pts.slice(1)) { await page.touchMove([{ id: 0, x: p[0], y: p[1] }]); await sleep(9); }
        await shot('10-sparkle');
        await page.touchEnd();
      } else {
        await page.mouseMove(pts[0][0], pts[0][1]); await page.mouseDown(pts[0][0], pts[0][1]);
        for (const p of pts.slice(1)) { await page.mouseMove(p[0], p[1]); await sleep(9); }
        await shot('10-sparkle');
        await page.mouseUp(pts.at(-1)[0], pts.at(-1)[1]);
      }
      await sleep(300);
      check('a stroke over the dark panel raises no error', page.consoleErrors().length === 0, page.consoleErrors());
      // The stroke stays wholly over the panel, so the canvas must not change at all.
      check('sparkle stroke saves nothing', (await ink()).h === from.h);
    }

    // ---- washing line ----
    await leaveBox();
    const peg = await pos('.st-chip-peg:not([hidden])');
    check('peg chip appears on an inked box', !!peg);
    const inkLine = await ink();
    await page.eval(`(()=>{window.__dl=[];const oc=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__dl.push({name:this.download,href:this.href});return}return oc.call(this)};navigator.canShare=()=>false;return 1})()`);
    await tap(peg.x, peg.y);
    await page.waitFor(`document.querySelector('.st-line-btn')`, { timeoutMs: 8000 }).catch(() => {});
    await sleep(1400);
    await shot('11-line');
    const texts = await page.eval(`({q:document.querySelector('.st-line-prompt')?.textContent,btns:[...document.querySelectorAll('.st-line-btn')].map(b=>b.textContent)})`);
    check('line opens with the packet prompt', /khác nhau/.test(texts.q || ''), texts);
    check('line has two Vietnamese buttons', texts.btns.length === 2 && /Gỡ/.test(texts.btns[0]) && /Lưu/.test(texts.btns[1]), texts);
    const lc = await page.eval(`(()=>{const c=document.querySelector('#studio-line canvas')||document.querySelector('.st-line-sky');if(!c)return null;const r=c.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height}})()`);
    check('line covers the width', lc && lc.w >= d.width - 1, lc);
    if (lc) {
      await draw(Array.from({ length: 12 }, (_, i) => [d.width * .3 + i * 7, lc.y + lc.h * .28 + i * 3]));
      await sleep(200);
      await shot('12-tug');
    }
    check('tug raises no error', page.consoleErrors().length === 0, page.consoleErrors());
    await tapSel('.st-line-btn.is-main');
    await page.waitFor('window.__dl?.length>0', { timeoutMs: 10000 }).catch(() => {});
    const dl = await page.eval('window.__dl');
    check('My Two Looks hands over a file', dl.length === 1 && /\.png$/i.test(dl[0].name), dl);
    if (dl.length) {
      const b64 = await page.eval(`fetch(${JSON.stringify(dl[0].href)}).then(r=>r.arrayBuffer()).then(a=>{let s='';const u=new Uint8Array(a);for(let i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s)})`);
      const buf = Buffer.from(b64, 'base64');
      check('picture is 1200x900 PNG', buf.readUInt32BE(16) === 1200 && buf.readUInt32BE(20) === 900, [buf.readUInt32BE(16), buf.readUInt32BE(20)]);
      fs.writeFileSync(path.join(OUT, `${name}-two-looks.png`), buf);
    }
    await tapSel('.st-line-btn:not(.is-main)');
    await sleep(1000);
    check('Gỡ xuống closes the line', !await pos('.st-line-btn'));
    check('ink unchanged by the line', (await ink()).h === inkLine.h);
    await shot('13-after-line');

    // ---- peg must leave the drawing room ----
    const pegR = await pos('.st-chip-peg:not([hidden])');
    const pegBox = await boxOf('p1-uniform');
    if (pegR) check('peg leaves most of the box free', pegR.w * pegR.h < pegBox.w * pegBox.h * .2, { pegR, pegBox });

    // ---- return visit: no intro, no card ----
    await sleep(6000); // the crash guard needs 5 s
    await page.send('Page.reload');
    await sleep(800);
    await ready();
    await sleep(1800);
    check('return visit: no card', !await pos('.st-chip-lure'));
    check('return visit: no hint box', !await pos('.st-box-hint'));
    check('return visit keeps ink', (await ink()).n > 0);
    await shot('14-return');
    check('no console errors overall', page.consoleErrors().length === 0, page.consoleErrors());
  } catch (err) {
    failed++; fails.push(prefix + 'threw: ' + err.message);
    await shot('zz-threw').catch(() => {});
  } finally { await page.close(); }
}

// A fresh child who draws instead: the wordless hints, each once. Then a phone that asks for reduced motion.
async function hints(name, d) {
  const prefix = name + ' hints: ';
  const check = (what, ok, extra = '') => {
    if (ok) { passed++; return; }
    failed++; fails.push(prefix + what + (extra !== '' ? ' -> ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 240) : ''));
  };
  const page = await launch({ browser: 'chrome', profileDir: path.join(OUT, `prof-h-${name}-${Date.now()}`), width: d.width, height: d.height, dsf: d.dsf, mobile: d.mobile, touch: d.touch });
  const tapOn = async (p, x, y) => {
    if (d.touch) { await p.touchStart({ x, y }); await sleep(35); await p.touchEnd(); }
    else { await p.mouseMove(x, y); await p.mouseDown(x, y); await sleep(30); await p.mouseUp(x, y); }
    await sleep(170);
  };
  const stroke = async (x, y) => {
    const pts = Array.from({ length: 16 }, (_, i) => [x + i * 7, y + Math.sin(i / 2) * 9]);
    if (d.touch) { await page.touchStart({ x: pts[0][0], y: pts[0][1] }); for (const p of pts.slice(1)) { await page.touchMove([{ id: 0, x: p[0], y: p[1] }]); await sleep(9); } await page.touchEnd(); }
    else { await page.mouseMove(pts[0][0], pts[0][1]); await page.mouseDown(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) { await page.mouseMove(p[0], p[1]); await sleep(9); } await page.mouseUp(pts.at(-1)[0], pts.at(-1)[1]); }
  };
  const posOn = (p, sel) => p.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e||e.hidden)return null;const r=e.getBoundingClientRect();return r.width?{x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height}:null})()`);
  const openOn = async p => {
    await p.goto(URL0);
    await p.waitFor('document.getElementById("studio-reading-cta")');
    await sleep(400);
    const c = await posOn(p, '#studio-reading-cta'); await tapOn(p, c.x, c.y);
    await p.waitFor('window.__studio?.engine?.activeSheet?.()>0&&document.querySelector(".st-tools")&&!document.querySelector(".st-loader")', { timeoutMs: 20000 });
  };
  try {
    await openOn(page);
    await page.eval(`(()=>{window.__seen={};new MutationObserver(ms=>{for(const m of ms){const e=m.target,c=e.classList;for(const k of ['st-ripple','st-wiggle','st-pulse','st-beckon'])if(c&&c.contains(k)){const n=k+':'+(e.dataset.tool||e.dataset.sw||e.className.split(' ')[0]);window.__seen[n]=(window.__seen[n]||0)+1}}}).observe(document.getElementById('studio-ui'),{subtree:true,attributes:true,attributeFilter:['class']});return 1})()`);
    await sleep(2600);
    const b = await page.eval(`(()=>{const S=window.__studio;const c=S.constants.BOXES['p1-uniform'].rect;return S.viewport.toClient(c.x+c.w*.2,c.y+c.h*.25)})()`);
    await stroke(b.x, b.y); await sleep(350);
    const seen1 = await page.eval('window.__seen');
    check('first pen-up ripples the dots', Object.keys(seen1).some(k => k.startsWith('st-ripple')), seen1);
    check('card goes with the first ink in the box', !await posOn(page, '.st-chip-lure'));
    await stroke(b.x, b.y + 30); await sleep(250);
    await stroke(b.x, b.y + 60); await sleep(350);
    const seen3 = await page.eval('window.__seen');
    check('third stroke wiggles Stickers', !!seen3['st-wiggle:stickers'], seen3);
    await sleep(8600);
    const seen4 = await page.eval('window.__seen');
    check('8 s idle pulses the Star', Object.keys(seen4).some(k => k.startsWith('st-pulse')), seen4);
    check('no console errors', page.consoleErrors().length === 0, page.consoleErrors());
  } catch (err) {
    failed++; fails.push(prefix + 'threw: ' + err.message);
  } finally { await page.close(); }

  const rm = await launch({ browser: 'chrome', profileDir: path.join(OUT, `prof-r-${name}-${Date.now()}`), width: d.width, height: d.height, dsf: d.dsf, mobile: d.mobile, touch: d.touch });
  try {
    await rm.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await openOn(rm);
    await sleep(1500);
    const c1 = await posOn(rm, '.st-chip-lure');
    check('reduced motion: card waits', !!c1);
    if (c1) await tapOn(rm, c1.x, c1.y);
    await sleep(300);
    const c2 = await posOn(rm, '.st-dot[data-sw="denim"]');
    await tapOn(rm, c2.x, c2.y);
    await sleep(350);
    const n = await rm.eval(INK);
    check('reduced motion: pour lands at once', n.n > 200, n);
    check('reduced motion: no errors', rm.consoleErrors().length === 0, rm.consoleErrors());
  } catch (err) {
    failed++; fails.push(prefix + 'reduced threw: ' + err.message);
  } finally { await rm.close(); }
}

// The whole story as a child lives it: T-shirt, denim, hang it, empty card, second outfit, both on the line, picture.
async function story(name, d) {
  const prefix = name + ' story: ';
  const check = (what, ok, extra = '') => {
    if (ok) { passed++; return; }
    failed++; fails.push(prefix + what + (extra !== '' ? ' -> ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 240) : ''));
  };
  const page = await launch({ browser: 'chrome', profileDir: path.join(OUT, `prof-s-${name}-${Date.now()}`), width: d.width, height: d.height, dsf: d.dsf, mobile: d.mobile, touch: d.touch });
  const shot = f => page.screenshot(path.join(OUT, `${name}-s${f}.png`));
  const tap = async (x, y) => {
    if (d.touch) { await page.touchStart({ x, y }); await sleep(35); await page.touchEnd(); }
    else { await page.mouseMove(x, y); await page.mouseDown(x, y); await sleep(30); await page.mouseUp(x, y); }
    await sleep(170);
  };
  const pos = sel => page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e||e.hidden)return null;const r=e.getBoundingClientRect();return r.width?{x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height}:null})()`);
  const tapSel = async sel => { const c = await pos(sel); check('present ' + sel, !!c); if (c) await tap(c.x, c.y); return c; };
  const st = k => page.eval(`window.__studio.state.get(${JSON.stringify(k)})`);
  try {
    await page.goto(URL0);
    await page.waitFor('document.getElementById("studio-reading-cta")');
    await page.eval(`(()=>{window.__said=[];const sp=speechSynthesis.speak.bind(speechSynthesis);speechSynthesis.speak=u=>{window.__said.push(u.text);return sp(u)};window.__dl=[];const oc=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__dl.push({name:this.download,href:this.href});return}return oc.call(this)};navigator.canShare=()=>false;return 1})()`);
    await sleep(400);
    await tapSel('#studio-reading-cta');
    await page.waitFor('window.__studio?.engine?.activeSheet?.()>0&&document.querySelector(".st-tools")&&!document.querySelector(".st-loader")', { timeoutMs: 20000 });
    await sleep(2300);
    await shot('1-open');
    await tapSel('.st-chip-lure');
    await sleep(350);
    await tapSel('.st-dot[data-sw="denim"]');
    await sleep(1200);
    const said = await page.eval('window.__said');
    check('T-shirt and denim are spoken in English', said.includes('T-shirt') && said.some(t => /denim/i.test(t)), said);
    await shot('2-gasp');
    // A stroke that starts on the peg must not open the line
    const peg0 = await pos('.st-chip-peg:not([hidden])');
    check('peg chip after the pour', !!peg0);
    if (d.touch) {
      await page.touchStart({ x: peg0.x, y: peg0.y });
      for (let i = 1; i < 10; i++) { await page.touchMove([{ id: 0, x: peg0.x - i * 8, y: peg0.y - i * 8 }]); await sleep(9); }
      await page.touchEnd();
    } else {
      await page.mouseMove(peg0.x, peg0.y); await page.mouseDown(peg0.x, peg0.y);
      for (let i = 1; i < 10; i++) { await page.mouseMove(peg0.x - i * 8, peg0.y - i * 8); await sleep(9); }
      await page.mouseUp(peg0.x - 72, peg0.y - 72);
    }
    await sleep(500);
    check('dragging off the peg does not hang', !await pos('.st-line-btn'));

    await tap(peg0.x, peg0.y);
    await page.waitFor(`document.querySelector('.st-line-btn')`, { timeoutMs: 9000 }).catch(() => {});
    await sleep(1500);
    await shot('3-one-on-line');
    check('page still 1 and line open', !!await pos('.st-line-btn'));
    // the empty card: read its place off the scene, in the empty half of the line
    const before = await st('box');
    const lineBox = await page.eval(`(()=>{const c=document.querySelector('#studio-line')||document.body;const r=c.getBoundingClientRect();const b=document.querySelector('.st-line-panel').getBoundingClientRect();return {w:r.width,top:r.top,panelTop:b.top}})()`);
    await tap(lineBox.w * .74, lineBox.top + lineBox.panelTop * .32);
    await sleep(1500);
    await shot('4-after-card');
    check('empty card returns to the empty box', !await pos('.st-line-btn') && await st('box') === 'p1-weekend', { box: await st('box'), before, lineBox });
    if (await st('box') !== 'p1-weekend') {
      const down = await pos('.st-line-btn:not(.is-main)');
      if (down) await tap(down.x, down.y);
    } else {
      await tapSel('.st-tool[data-tool="stickers"]');
      await sleep(300);
      await tapSel('.st-tray [data-sticker="shorts"]');
      await sleep(400);
      await tapSel('.st-pal-btn'); await sleep(200);
      await tapSel('.st-palette [data-sw="gingham"]');
      await sleep(1300);
      await shot('5-second');
      check('second outfit poured', await st('swatch') === 'gingham');
      const peg1 = await pos('.st-chip-peg:not([hidden])');
      check('peg on the second outfit', !!peg1);
      if (peg1) await tap(peg1.x, peg1.y);
      await page.waitFor(`document.querySelector('.st-line-btn')`, { timeoutMs: 9000 }).catch(() => {});
      await sleep(1500);
      await shot('6-both');
      await tapSel('.st-line-say');
      await sleep(350);
      const said2 = await page.eval('window.__said');
      check('speaker says the English question', said2.some(t => /different/i.test(t)), said2);
      await tapSel('.st-line-btn.is-main');
      await page.waitFor('window.__dl?.length>0', { timeoutMs: 10000 }).catch(() => {});
      const dl = await page.eval('window.__dl');
      check('picture handed over', dl.length === 1, dl);
      if (dl.length) {
        const b64 = await page.eval(`fetch(${JSON.stringify(dl[0].href)}).then(r=>r.arrayBuffer()).then(a=>{let s='';const u=new Uint8Array(a);for(let i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s)})`);
        fs.writeFileSync(path.join(OUT, `${name}-s7-two-looks.png`), Buffer.from(b64, 'base64'));
      }
      await sleep(500);
      await shot('8-saved');
      await tapSel('.st-line-btn:not(.is-main)');
      await sleep(900);
    }
    check('no console errors', page.consoleErrors().length === 0, page.consoleErrors());
  } catch (err) {
    failed++; fails.push(prefix + 'threw: ' + err.message);
    await shot('z-threw').catch(() => {});
  } finally { await page.close(); }
}

const STORY_ONLY = process.env.STORY === '1';
for (const name of ONLY) {
  await story(name, DEVICES[name]);
  if (STORY_ONLY) continue;
  const before = passed + failed;
  await flow(name, DEVICES[name]);
  await hints(name, DEVICES[name]);
  console.log(`${name}: ${passed + failed - before} checks run`);
}
console.log(`m2: ${passed} passed, ${failed} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(failed);
