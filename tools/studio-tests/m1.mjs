// m1.mjs: milestone 1, a real drawing surface, driven the way a child and a parent would, with real input.
//   node tools/studio-tests/m1.mjs <scratch dir> [phone,land,tablet,laptop]
// Server: BASE env, default http://localhost:5310. Screenshots and PDFs land in <scratch dir>/m1. Exit code is the fail count.
import path from 'node:path';
import fs from 'node:fs';
import { launch, sleep, pngDiff } from './cdp.mjs';

const OUT = path.join(process.argv[2] || '.', 'm1');
const ONLY = (process.argv[3] || 'phone,land,tablet,laptop').split(',');
const URL0 = (process.env.BASE || 'http://localhost:5310') + '/clothes-story/?test=1&noguide=1';
const DEVICES = {
  phone: { width: 360, height: 640, dsf: 2, mobile: true, touch: true, layout: 'phone-p' },
  land: { width: 640, height: 360, dsf: 2, mobile: true, touch: true, layout: 'phone-l' },
  tablet: { width: 768, height: 1024, dsf: 1, mobile: true, touch: true, layout: 'tablet-p' },
  laptop: { width: 1280, height: 800, dsf: 1, mobile: false, touch: false, layout: 'wide' },
};
let passed = 0, failed = 0;
const fails = [];
fs.mkdirSync(OUT, { recursive: true });

const INK = `(()=>{const p=window.__studio.engine.paintCanvas();const c=document.createElement('canvas');c.width=p.width>>2;c.height=p.height>>2;
  const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(p,0,0,c.width,c.height);const d=x.getImageData(0,0,c.width,c.height).data;
  let n=0,h=0;for(let i=0;i<d.length;i+=4){if(d[i+3]>12){n++;h=(h*31+(d[i]>>3)+(d[i+1]>>3)*7+(d[i+3]>>4)*3+i)>>>0}}return {n,h}})()`;

// Every control that must be reachable, tested for size, for staying on screen and for overlap.
const AUDIT = `(()=>{
  const vis=e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};
  const sel='.st-tool,.st-dot,.st-size,.st-pal-btn,.st-menu-btn,.st-undo,.st-star,#studio-dock .st-page,.st-page-one';
  const els=[...document.querySelectorAll('#studio-dock '+sel.split(',').join(',#studio-dock '))].filter(vis);
  const name=e=>e.dataset.tool||e.dataset.sw||e.dataset.page||e.className;
  const small=[],off=[],hit=[];
  const rs=els.map(e=>({e,r:e.getBoundingClientRect()}));
  for(const {e,r} of rs){
    if(r.width<43.5||r.height<43.5)small.push(name(e)+' '+Math.round(r.width)+'x'+Math.round(r.height));
    if(r.left<-.5||r.top<-.5||r.right>innerWidth+.5||r.bottom>innerHeight+.5)off.push(name(e));
  }
  for(let i=0;i<rs.length;i++)for(let j=i+1;j<rs.length;j++){const a=rs[i].r,b=rs[j].r;
    const w=Math.min(a.right,b.right)-Math.max(a.left,b.left),h=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
    if(w>1&&h>1&&!rs[i].e.contains(rs[j].e)&&!rs[j].e.contains(rs[i].e))hit.push(name(rs[i].e)+'/'+name(rs[j].e))}
  const row=document.querySelector('.st-tools');
  return {small,off,hit,labels:[...document.querySelectorAll('.st-tool-label')].filter(e=>!e.textContent.trim()).length,
    menu:document.querySelector('.st-menu-tx')?.textContent,scrollRow:/auto|scroll/.test(getComputedStyle(row).overflowX+getComputedStyle(row).overflowY)||[...row.children].some(t=>{const r=t.getBoundingClientRect(),q=row.getBoundingClientRect();return r.left<q.left-1||r.right>q.right+1||r.top<q.top-1||r.bottom>q.bottom+1}),
    docX:document.documentElement.scrollWidth>innerWidth,docY:document.documentElement.scrollHeight>innerHeight,layout:document.getElementById('studio-ui').dataset.layout,tools:els.filter(e=>e.dataset.tool).length,dots:els.filter(e=>e.dataset.sw).length}})()`;

async function flow(name, d) {
  const prefix = name + ': ';
  const check = (what, ok, extra = '') => {
    if (ok) { passed++; return; }
    failed++; fails.push(prefix + what + (extra ? ' -> ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 260) : ''));
  };
  const profileDir = path.join(OUT, 'prof-' + name + '-' + Date.now());
  const page = await launch({ browser: 'chrome', profileDir, width: d.width, height: d.height, dsf: d.dsf, mobile: d.mobile, touch: d.touch });
  const shot = f => page.screenshot(path.join(OUT, name + '-' + f + '.png'));
  const tap = async (x, y) => {
    if (d.touch) { await page.touchStart({ x, y }); await sleep(35); await page.touchEnd(); }
    else { await page.mouseMove(x, y); await page.mouseDown(x, y); await sleep(30); await page.mouseUp(x, y); }
    await sleep(170);
  };
  const pos = sel => page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView?.({block:'nearest'});const r=e.getBoundingClientRect();if(!r.width)return null;return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
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
  // A rectangle of drawable paper on screen: the first draw box, clipped to the free area.
  const drawArea = () => page.eval(`(()=>{const s=getComputedStyle(document.documentElement);const v=k=>parseFloat(s.getPropertyValue('--ins-'+k))||0;
    const f={l:v('l'),t:v('t'),r:innerWidth-v('r'),b:innerHeight-v('b')};
    const box=document.querySelector('.sheet.on .draw[data-box]')||document.querySelector('.sheet.on');const q=box.getBoundingClientRect();
    const l=Math.max(q.left,f.l)+24,t=Math.max(q.top,f.t)+64,r=Math.min(q.right,f.r)-24,b=Math.min(q.bottom,f.b)-20;return {l,t,r,b,w:r-l,h:b-t}})()`);
  const wave = (a, fy, amp = 14, n = 34) => Array.from({ length: n }, (_, i) => [a.l + a.w * i / (n - 1), a.t + a.h * fy + Math.sin(i / 3) * amp]);
  const goPage = async n => {
    if (await pos('#studio-dock .st-page-one')) {
      await tapSel('#studio-dock .st-page-one');
      await tapSel(`.st-pages-pop .st-page[data-page="${n}"]`);
    } else await tapSel(`#studio-dock .st-page[data-page="${n}"]`);
    const shown = await page.waitFor(`window.__studio.state.get('page')===${n}&&window.__studio.engine.activeSheet()===${n}`, { timeoutMs: 6000 }).then(() => true, () => false);
    check(`page tile ${n} works`, shown, await page.eval(`JSON.stringify({p:window.__studio.state.get('page'),a:window.__studio.engine.activeSheet(),raf:window.__raf,anims:document.getAnimations().map(a=>(a.animationName||a.transitionProperty||'wa')+':'+(a.effect.target?.className||a.effect.target?.id)).slice(0,8),diag:window.__studio.diag.entries?.().slice(-6)})`));
    await sleep(350);
  };
  const leaveBox = async () => { if (await st('box')) { await tapSel('.st-chip-whole'); await sleep(450); } };
  const tool = async id => {
    if (['marker', 'paint', 'stitch'].includes(id)) { await tapSel('.st-tool[data-tool="more"]'); await tapSel(`.st-drawer-tool[data-tool="${id}"]`); }
    else await tapSel(`.st-tool[data-tool="${id}"]`);
    check(`tool ${id} selected`, await st('tool') === id, await st('tool'));
  };
  const openMenuItem = async act => {
    await tapSel('.st-menu-btn');
    await sleep(150);
    await tapSel(`.st-item[data-act="${act}"]`);
  };

  try {
    // ---- reading view, untouched ----
    await page.goto(URL0);
    await page.waitFor('document.getElementById("studio-reading-cta")');
    await page.eval('document.fonts.ready.then(()=>1)');
    await sleep(500);
    const scrollTo = Math.min(240, await page.eval('document.documentElement.scrollHeight-innerHeight'));
    await page.eval(`window.scrollTo(0,${scrollTo})`);
    await sleep(150);
    await shot('0-reading');
    const geom = () => page.eval(`JSON.stringify([...document.querySelectorAll('.sheet,.book,.part,.draw')].map(e=>{const r=e.getBoundingClientRect();return [+r.left.toFixed(1),+(r.top+scrollY).toFixed(1),+r.width.toFixed(1),+r.height.toFixed(1)]}))`);
    const geom0 = await geom();
    const y0 = await page.eval('scrollY');
    if (name === 'laptop') {
      const ov = await page.eval(`(()=>{const c=document.getElementById('studio-reading-cta').getBoundingClientRect();const h=[...document.querySelectorAll('h1,h2,.sheet.on h1')];return c.left>innerWidth/2})()`);
      check('CTA sits right of the centred heading on a laptop', ov);
    }

    // ---- enter and leave at once: the reading view must not notice ----
    await page.eval(`document.getElementById('studio-reading-cta').style.visibility='hidden'`);
    await page.send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync(path.join(OUT, name + '-0a.png'), Buffer.from(r.data, 'base64')));
    await page.eval(`document.getElementById('studio-reading-cta').style.visibility=''`);
    await tapSel('#studio-reading-cta');
    await ready();
    await sleep(600);
    await tapSel('.st-menu-btn');
    await tapSel('.st-item[data-act="exit"]');
    await page.waitFor(`!document.documentElement.classList.contains('paper')&&!document.getElementById('studio-ui')`, { timeoutMs: 6000 }).catch(async () => { await shot('z-exit'); console.log(name, await page.eval(`JSON.stringify({menu:!document.querySelector('.st-menu')?.hidden,diag:window.__studio.diag.entries().slice(-5)})`)); });
    await sleep(300);
    check('enter+exit: scroll restored', Math.abs(await page.eval('scrollY') - y0) < 2, [y0, await page.eval('scrollY')]);
    const geomA = await geom();
    if (geomA !== geom0) { fs.writeFileSync(path.join(OUT, name + '-geom.json'), geom0 + '|' + geomA); }
    check('enter+exit: geometry identical', geomA === geom0);
    await page.eval(`document.getElementById('studio-reading-cta').style.visibility='hidden'`);
    await page.send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync(path.join(OUT, name + '-0b.png'), Buffer.from(r.data, 'base64')));
    await page.eval(`document.getElementById('studio-reading-cta').style.visibility=''`);
    const pd = pngDiff(path.join(OUT, name + '-0a.png'), path.join(OUT, name + '-0b.png'), { tolerance: 72 });
    check('enter+exit: reading looks identical (text antialiasing aside)', pd.same || pd.diffPixels < pd.width * pd.height * .02, pd);

    // ---- enter ----
    await tapSel('#studio-reading-cta');
    await ready();
    check('html.paper on', await page.eval('document.documentElement.classList.contains("paper")'));
    await sleep(name === 'phone' || name === 'land' ? 1700 : 500);
    const a = await page.eval(AUDIT);
    check('layout ' + d.layout, a.layout === d.layout, a.layout);
    check('all controls at least 44px', !a.small.length, a.small);
    check('nothing off screen', !a.off.length, a.off);
    check('no overlap', !a.hit.length, a.hit);
    check('tool row does not scroll', !a.scrollRow);
    check('page does not scroll', !a.docX && !a.docY);
    check('six tools shown', a.tools === 6, a.tools);
    check('tool labels filled', !a.labels, a.labels);
    check('menu says Bố mẹ', a.menu === 'Bố mẹ', a.menu);
    await sleep(1800); // the ghost crayon fades
    await shot('1-entered');

    // ---- crayon, pencil, marker ----
    if (process.env.M1DEBUG) await page.eval(`window.__raf={};{const R=requestAnimationFrame;window.requestAnimationFrame=f=>{const k=(new Error().stack.split(String.fromCharCode(10))[2]||'').trim().slice(-48);window.__raf[k]=(window.__raf[k]||0)+1;return R(f)}};window.__tlog=[];const T0=performance.now();for(const t of ['pointerdown','pointerup','pointercancel','click'])document.addEventListener(t,e=>{window.__tlog.push(t[7]+':'+String(e.target.className?.baseVal??e.target.className??e.target.id).slice(0,14)+' '+Math.round(performance.now()-T0))},true);0`);
    let area = await drawArea();
    if (area.h < 120 && await pos('.st-chip-zoom:not([hidden])')) { await tapSel('.st-chip-zoom:not([hidden])'); await sleep(500); area = await drawArea(); }
    check('drawable area big enough', area.w > 80 && area.h > 80, area);
    check('starts on crayon, red', await st('tool') === 'crayon' && await st('swatch') === 'red');
    const blank = await ink();
    check('starts blank', blank.n === 0, blank);
    await draw(wave(area, .15));
    const i1 = await ink();
    check('crayon leaves ink', i1.n > 20, i1);
    await tool('pencil');
    check('first pencil is graphite', await st('swatch') === 'navy', await st('swatch'));
    await draw(wave(area, .35, 8));
    const i2 = await ink();
    check('pencil leaves ink', i2.n > i1.n, [i1, i2]);
    await tool('crayon');
    check('crayon gets its colour back', await st('swatch') === 'red', await st('swatch'));
    await tool('pencil');
    await tapSel('.st-dot[data-sw="blue"]');
    await tool('crayon');
    await tool('pencil');
    check('pencil remembers its own colour', await st('swatch') === 'blue', await st('swatch'));
    await tapSel('.st-dot[data-sw="navy"]');
    await tool('marker');
    check('marker wears the crayon colour', await st('swatch') === 'red', await st('swatch'));
    await tapSel('.st-dot[data-sw="green"]');
    check('colour tap picks green', await st('swatch') === 'green');
    const size0 = await st('size');
    await tapSel('.st-size');
    check('size button cycles', await st('size') !== size0);
    await draw(wave(area, .55));
    const i3 = await ink();
    check('marker leaves ink', i3.n > i2.n, [i2, i3]);
    await shot('2-marks');

    // ---- overlays: each stays on screen, leaves the dock alone, and closes on an outside tap and on Back ----
    const inView = sel => page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e||e.hidden)return 'closed';const r=e.getBoundingClientRect();if(r.left<-1||r.top<-1||r.right>innerWidth+1||r.bottom>innerHeight+1)return 'off '+[r.left,r.top,r.right,r.bottom].map(Math.round);return e.scrollWidth>e.clientWidth+1?'wide':'ok'})()`);
    const toolBefore = await st('tool'), boxBefore = await st('box');
    for (const [nm, opener, sel] of [['menu', '.st-menu-btn', '.st-menu'], ['palette', '.st-pal-btn', '.st-palette'], ['drawer', '.st-tool[data-tool="more"]', '.st-drawer'], ['stickers', '.st-tool[data-tool="stickers"]', '.st-tray']]) {
      await tapSel(opener);
      await sleep(250);
      check(`${nm} on screen`, await inView(sel) === 'ok', await inView(sel));
      await shot('2-' + nm);
      const before = await ink();
      const out = await page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();const s=getComputedStyle(document.documentElement);const v=k=>parseFloat(s.getPropertyValue('--ins-'+k))||0;
        const l=v('l')+24,t=v('t')+24,r=innerWidth-v('r')-24,b=innerHeight-v('b')-24;const mid=(t+b)/2;for(const [x,y] of [[l,t],[r,t],[l,b],[r,b],[(l+r)/2,t],[(l+r)/2,b],[v('l')+3,mid],[innerWidth-v('r')-3,mid]]){if(x<e.left-1||x>e.right+1||x>e.right+4||y<e.top-1||y>e.bottom+1){const hit=document.elementFromPoint(x,y);if(!hit.closest('#studio-chips button'))return {x,y}}}return null})()`);
      if (out) {
        await tap(out.x, out.y); await sleep(200);
        check(`${nm} closes on outside tap`, await inView(sel) === 'closed', await inView(sel));
        check(`${nm}: closing tap leaves no ink`, (await ink()).h === before.h);
      } else if (name !== 'land') check(`${nm} leaves room for an outside tap`, false);
      if (await inView(sel) !== 'closed') { await page.eval('history.back()'); await sleep(200); }
      await tapSel(opener); await sleep(200);
      await page.eval('history.back()'); await sleep(350);
      check(`${nm} closes on Back`, await inView(sel) === 'closed', await inView(sel));
      check(`${nm}: Back stays in Studio`, await page.eval(`document.documentElement.classList.contains('paper')`));
      check(`${nm}: outside tap and Back keep Box Mode`, await st('box') === boxBefore, [boxBefore, await st('box')]);
    }
    await tool(toolBefore === 'stickers' ? 'crayon' : toolBefore);

    // ---- eraser, undo, redo ----
    await tool('eraser');
    await draw(wave(area, .15, 2, 22));
    const i4 = await ink();
    if (i4.n >= i3.n) await shot('z-eraser');
    check('eraser removes ink', i4.n < i3.n, [i3, i4, await st('tool'), await st('box'), area]);
    await tapSel('.st-undo');
    await sleep(350);
    const i5 = await ink();
    check('undo brings the erased ink back', i5.h === i3.h, [i3, i5]);
    check('redo appears after undo', !!(await pos('.st-redo')));
    await tapSel('.st-redo');
    await sleep(350);
    const i6 = await ink();
    check('redo erases again', i6.h === i4.h, [i4, i6]);
    if (!d.touch) {
      await page.key('z', { ctrl: true }); await sleep(300);
      check('Ctrl+Z undoes', (await ink()).h === i3.h);
      await page.key('y', { ctrl: true }); await sleep(300);
      check('Ctrl+Y redoes', (await ink()).h === i4.h);
    }
    await tapSel('.st-undo'); await sleep(300);
    await tool('crayon');
    await tapSel('.st-dot[data-sw="red"]');
    // Holding undo repeats, and an empty undo dims but stays.
    const undoAt = await pos('.st-undo');
    if (d.touch) { await page.touchStart({ x: undoAt.x, y: undoAt.y }); await sleep(1500); await page.touchEnd(); }
    else { await page.mouseMove(undoAt.x, undoAt.y); await page.mouseDown(undoAt.x, undoAt.y); await sleep(1500); await page.mouseUp(undoAt.x, undoAt.y); }
    await sleep(350);
    check('hold undo empties to blank', (await ink()).n === 0, await ink());
    check('empty undo dims and stays', await page.eval(`(()=>{const u=document.querySelector('.st-undo');return u.classList.contains('st-dim')&&u.getBoundingClientRect().width>0})()`));
    await tapSel('.st-redo'); await sleep(200);
    check('redo after hold works', (await ink()).n > 0);
    await tool('crayon');
    await draw(wave({ ...area, w: area.w * .7 }, .75));
    const i7 = await ink();
    check('new stroke after undo', i7.n > 0);
    check('redo leaves on a new stroke', !(await pos('.st-redo')));

    // ---- gestures: nothing here may leave ink ----
    if (d.touch) {
      await sleep(100);
      const cx = area.l + area.w / 2, cy = area.t + area.h / 2, z0 = await st('z');
      await page.touchStart({ x: cx - 20, y: cy });
      await sleep(40);
      await page.touchStart({ id: 1, x: cx + 20, y: cy });
      for (let k = 1; k <= 12; k++) { await page.touchMove([{ id: 0, x: cx - 20 - k * 4, y: cy }, { id: 1, x: cx + 20 + k * 4, y: cy }]); await sleep(14); }
      await page.touchEnd(1);
      for (let k = 1; k <= 8; k++) { await page.touchMove([{ id: 0, x: cx - 68 + k * 6, y: cy + k * 3 }]); await sleep(12); }
      await page.touchEnd();
      await sleep(300);
      check('pinch zooms', (await st('z')) > z0 * 1.05, [z0, await st('z')]);
      check('pinch, lift one, move: no line', (await ink()).h === i7.h);
      await page.touchStart({ x: cx - 80, y: cy - 30 });
      await page.touchStart({ id: 1, x: cx + 80, y: cy - 30 });
      for (let k = 1; k <= 14; k++) { await page.touchMove([{ id: 0, x: cx - 80 + k * 5, y: cy - 30 }, { id: 1, x: cx + 80 - k * 5, y: cy - 30 }]); await sleep(14); }
      await page.touchEnd();
      await sleep(450);
      check('pinch back leaves no ink', (await ink()).h === i7.h);
      // A touch from the very edge is a system swipe.
      await page.touchStart({ x: 4, y: cy });
      for (let k = 1; k <= 10; k++) { await page.touchMove([{ id: 0, x: 4 + k * 12, y: cy }]); await sleep(10); }
      await page.touchEnd();
      await sleep(200);
      check('edge swipe leaves no ink', (await ink()).h === i7.h);
      // Quick two-finger landing, 100ms apart: first finger's ink is discarded.
      await page.touchStart({ x: cx - 30, y: cy + 20 }); await sleep(60);
      await page.touchMove([{ id: 0, x: cx - 24, y: cy + 26 }]); await sleep(40);
      await page.touchStart({ id: 1, x: cx + 40, y: cy + 20 }); await sleep(60);
      await page.touchEnd(); await sleep(250);
      check('two fingers 100ms apart: no ink', (await ink()).h === i7.h);
    } else {
      const cx = area.l + area.w / 2, cy = area.t + area.h / 2, z0 = await st('z');
      await page.wheel(cx, cy, 0, -240, { ctrl: true }); await sleep(350);
      check('Ctrl+wheel zooms', (await st('z')) > z0, [z0, await st('z')]);
      const panBefore = await page.eval(`document.querySelector('.book').style.transform`);
      await page.keyDown(' '); await sleep(40);
      await page.mouseMove(cx, cy); await page.mouseDown(cx, cy);
      for (let k = 1; k <= 8; k++) { await page.mouseMove(cx + k * 6, cy + k * 5); await sleep(10); }
      await page.mouseUp(cx + 48, cy + 40); await page.keyUp(' '); await sleep(200);
      check('Space+drag pans', await page.eval(`document.querySelector('.book').style.transform`) !== panBefore);
      check('Space+drag leaves no ink', (await ink()).h === i7.h);
      await page.wheel(cx, cy, 0, 240, { ctrl: true }); await sleep(600);
      await page.wheel(cx, cy, 0, 900); await sleep(200);
      check('wheel scrolls, no ink', (await ink()).h === i7.h);
      await page.wheel(cx, cy, 0, -2000); await sleep(200);
    }

    // ---- pages ----
    await leaveBox();
    const a1 = await ink();
    await goPage(2);
    check('page 2 showing', await st('page') === 2 && await page.eval('window.__studio.engine.activeSheet()') === 2);
    check('page 2 blank', (await ink()).n === 0, await ink());
    check('one paint and one live canvas only', await page.eval(`document.querySelectorAll('#st-paint').length===1&&document.querySelectorAll('#st-live').length===1&&document.querySelectorAll('canvas#st-paint,canvas#st-live').length===2`));
    check('one ink img per sheet at most', await page.eval(`[...document.querySelectorAll('.sheet')].every(s=>s.querySelectorAll(':scope>img.ink').length<=1)`));
    const marks = { 2: null, 3: null, 4: null };
    for (const n of [2, 3, 4]) {
      if (n > 2) await goPage(n);
      const ar = await drawArea();
      await tool('crayon');
      await draw(wave(ar, .5, 18));
      marks[n] = await ink();
      check(`page ${n} takes ink`, marks[n].n > 0, marks[n]);
      await shot(`3-page${n}`);
    }
    await goPage(1);
    const back = await ink();
    check('page 1 comes back the same', back.n === a1.n, [a1, back]);
    await goPage(3);
    const back3 = await ink();
    check('page 3 comes back the same', back3.n === marks[3].n, [marks[3], back3]);
    await goPage(1);
    await sleep(200);
    await shot('3-back-to-1');

    // ---- a typed name, which every print must carry ----
    const blank1 = await pos('.sheet.on [data-f="p1-name"]');
    await tap(blank1.x, blank1.y);
    await page.waitFor('document.querySelector("#studio-card:not([hidden])")', { timeoutMs: 4000 }).catch(() => {});
    await sleep(300);
    check('blank opens the Card', !!(await pos('#studio-card')));
    if (!(await pos('textarea.c-text'))) await tapSel('.c-tab-type,[data-tab="type"]');
    if (await pos('textarea.c-text')) {
      await tapSel('textarea.c-text');
      await page.send('Input.insertText', { text: 'Minh Anh' });
      await sleep(200);
      await tapSel('.c-close');
      await sleep(350);
      check('name lands on the page', (await page.eval(`document.querySelector('[data-f="p1-name"] .ans')?.textContent`)) === 'Minh Anh', await page.eval(`document.querySelector('[data-f="p1-name"] .ans')?.textContent`));
    } else check('textarea reachable', false);
    await shot('3-named');

    // ---- autosave, reload ----
    await page.waitFor(`document.querySelector('.st-save')?.dataset.state==='saved'`, { timeoutMs: 8000 }).catch(() => {});
    check('saved tick shows', await page.eval(`document.querySelector('.st-save')?.dataset.state==='saved'&&!document.querySelector('.st-save').hidden`));
    check('has-work flag', await page.eval(`localStorage.getItem('hec-clothes-has-work')==='1'`));
    await sleep(5200 - 4000 > 0 ? 3000 : 0); // past the crash guard
    await page.reload();
    await ready();
    await sleep(1500);
    check('reload returns to Studio', await page.eval(`document.documentElement.classList.contains('paper')`));
    check('reload keeps page 1', await st('page') === 1, await st('page'));
    const r1 = await ink();
    check('reload keeps the ink', Math.abs(r1.n - back.n) <= back.n * .02 + 4, [back, r1]);
    await shot('4-reloaded');
    await goPage(4);
    const r4 = await ink();
    check('reload keeps page 4', Math.abs(r4.n - marks[4].n) <= marks[4].n * .02 + 4, [marks[4], r4]);
    await goPage(1);

    // ---- print from Studio: through the menu, and Ctrl+P ----
    await page.eval(`window.__printed=0;window.print=()=>{window.__printed++}`);
    await openMenuItem('print');
    await page.waitFor('window.__printed>0', { timeoutMs: 8000 }).catch(() => {});
    check('menu print calls window.print', await page.eval('window.__printed') === 1, await page.eval('window.__printed'));
    check('all sheets with ink have a decoded img', await page.eval(`[...document.querySelectorAll('.sheet>img.ink')].every(i=>i.complete&&i.naturalWidth>0)&&document.querySelectorAll('.sheet>img.ink').length>=4`), await page.eval(`document.querySelectorAll('.sheet>img.ink').length`));
    const pdf1 = await page.printPDF(path.join(OUT, name + '-print-studio.pdf'));
    check('Studio print is 4 pages', pdf1.pages === 4, pdf1.pages);
    // Ctrl+P cannot wait: a stroke made just before it must already be in the image that prints.
    await sleep(200);
    if (await pos('.st-menu .st-item')) await tapSel('.st-menu-close');
    await sleep(150);
    const late = await drawArea();
    await draw(wave({ ...late, w: late.w * .6 }, .4));
    const pdf1b = await page.printPDF(path.join(OUT, name + '-print-ctrlp.pdf'));
    check('Ctrl+P print is 4 pages', pdf1b.pages === 4, pdf1b.pages);
    const imgN = await page.eval(`(async()=>{const i=document.querySelector('.sheet.on>img.ink');for(let t=0;t<5;t++){try{await i.decode();break}catch{await new Promise(r=>setTimeout(r,300))}}const c=document.createElement('canvas');const p=window.__studio.engine.paintCanvas();c.width=p.width>>2;c.height=p.height>>2;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(i,0,0,c.width,c.height);const d=x.getImageData(0,0,c.width,c.height).data;let n=0;for(let k=3;k<d.length;k+=4)if(d[k]>12)n++;return n})()`);
    const paintN = (await ink()).n;
    check('Ctrl+P prints the very last stroke', imgN >= paintN * .97, [imgN, paintN]);
    await sleep(200);
    await shot('5-after-print');
    await page.key?.('Escape').catch?.(() => {});

    // ---- exit ----
    await sleep(300);
    const menuStillOpen = await pos('.st-menu .st-item');
    if (!menuStillOpen) await tapSel('.st-menu-btn');
    await sleep(150);
    await tapSel('.st-item[data-act="exit"]');
    await page.waitFor(`!document.documentElement.classList.contains('paper')&&!document.getElementById('studio-ui')`, { timeoutMs: 6000 }).catch(() => {});
    check('exit: html.paper gone', await page.eval(`!document.documentElement.classList.contains('paper')`));
    check('exit: studio-ui gone', await page.eval(`!document.getElementById('studio-ui')`));
    await sleep(350);
    const y1 = await page.eval('scrollY');
    check('exit: hash gone', await page.eval('location.hash') === '');
    check('exit: scroll restored', Math.abs(y1 - y0) < 2, [y0, y1]);
    const geom1 = await geom();
    if (geom1 !== geom0) fs.writeFileSync(path.join(OUT, name + '-geom2.json'), geom0 + '|' + geom1);
    check('exit: reading geometry identical', geom1 === geom0);
    check('exit: no ink or answers on screen', await page.eval(`[...document.querySelectorAll('.sheet>img.ink,.ans')].every(e=>getComputedStyle(e).display==='none')`));
    check('exit: no canvases left', await page.eval(`!document.querySelector('#st-paint,#st-live')`));
    check('exit: CTA says Vẽ tiếp', (await page.eval(`document.querySelector('#studio-reading-cta b').textContent`)) === 'Vẽ tiếp');
    await shot('6-exited');
    const hide = `const s=document.createElement('style');s.textContent='#studio-reading-cta{visibility:hidden!important}';s.id='m1hide';document.head.append(s)`;
    await page.eval(hide);
    await sleep(100);
    await shot('6-exited-nocta');
    await page.eval(`document.getElementById('m1hide').remove()`);

    // ---- reading-view print, straight after exit ----
    const pdf2 = await page.printPDF(path.join(OUT, name + '-print-reading-exit.pdf'));
    check('reading print after exit is 4 pages', pdf2.pages === 4, pdf2.pages);
    check('reading print leaves reading view', await page.eval(`!document.documentElement.classList.contains('paper')`));
    // ---- and from a fresh load ----
    await page.goto(URL0 + '&x=' + Date.now());
    await page.waitFor('document.getElementById("studio-reading-cta")');
    await page.waitFor(`document.querySelectorAll('.sheet>img.ink').length>=4`, { timeoutMs: 6000 }).catch(() => {});
    check('fresh load finds the ink', await page.eval(`document.querySelectorAll('.sheet>img.ink').length`) === 4, await page.eval(`document.querySelectorAll('.sheet>img.ink').length`));
    const geom2 = await page.eval(`JSON.stringify(document.querySelector('.sheet').getBoundingClientRect().width)`);
    const pdf3 = await page.printPDF(path.join(OUT, name + '-print-reading-fresh.pdf'));
    check('reading print from fresh load is 4 pages', pdf3.pages === 4, pdf3.pages);
    check('reading print carries the name', (await page.eval(`document.querySelector('[data-f="p1-name"] .ans')?.textContent`)) === 'Minh Anh');
    check('fresh load: no paper mode after print', await page.eval(`!document.documentElement.classList.contains('paper')`));
    check('fresh load: sheet width stable', geom2 === await page.eval(`JSON.stringify(document.querySelector('.sheet').getBoundingClientRect().width)`));
    const errs = page.consoleErrors();
    check('no console errors', !errs.length, errs);

    // ---- first run on a clean profile: the hint stays with its box, and Back leaves ----
    await page.eval(`(async()=>{localStorage.clear();sessionStorage.clear();await new Promise(r=>{const q=indexedDB.deleteDatabase('hec-clothes-studio');q.onsuccess=q.onerror=q.onblocked=r})})()`);
    await page.goto(URL0 + '&y=' + Date.now());
    await page.waitFor('document.getElementById("studio-reading-cta")');
    await sleep(400);
    await tapSel('#studio-reading-cta');
    await ready();
    await sleep(2300);
    await shot('7-first-run');
    if (name === 'phone' || name === 'land') check('first run opens in Box Mode', await st('box') === 'p1-uniform', await st('box'));
    else check('first run stays at the whole page', !(await st('box')));
    await goPage(3);
    await sleep(200);
    check('hint is gone on page 3', await page.eval(`!document.querySelector('.st-box-hint')||document.querySelector('.st-box-hint').hidden`));
    await page.eval('history.back()');
    await page.waitFor(`!document.documentElement.classList.contains('paper')`, { timeoutMs: 6000 }).catch(() => {});
    check('Back leaves Studio', await page.eval(`!document.documentElement.classList.contains('paper')&&!document.getElementById('studio-ui')`));

    // ---- a stylus, on the touch devices: it draws, and for a while a resting hand does not ----
    if (d.touch && name === 'tablet') {
      await tapSel('#studio-reading-cta');
      await ready();
      await sleep(600);
      const area = await drawArea();
      await draw(wave({ ...area, w: area.w * .7 }, .3));
      const before = await ink();
      const y = area.t + area.h * .9;
      await page.penDown(area.l + 10, y, { force: .3 });
      for (let k = 1; k <= 20; k++) { await page.penMove(area.l + 10 + k * (area.w - 20) / 20, y + Math.sin(k) * 3, { force: .2 + k * .03 }); await sleep(9); }
      await page.penUp(area.l + area.w - 10, y);
      await sleep(200);
      const after = await ink();
      check('pen draws', after.n > before.n, [before, after]);
      check('pen mode on', await st('penMode') === true);
      await draw(wave({ ...area, w: area.w * .5 }, .5));
      check('finger after a pen does not ink', (await ink()).h === after.h);
      await tapSel('.st-undo');
      await sleep(300);
      check('undo removes the pen stroke', (await ink()).h === before.h);
    }

    // ---- invariant 6: a module that will not load leaves today's page, from the button and from a reload ----
    if (name === 'laptop') {
      const plain = URL0.replace('?test=1&noguide=1', '?z=' + Date.now());
      await page.send('Network.enable');
      await page.send('Network.setBlockedURLs', { urls: ['*studio/shell.js*', '*studio/engine.js*'] });
      await page.goto(plain);
      await page.waitFor('document.getElementById("studio-reading-cta")');
      await tapSel('#studio-reading-cta');
      await sleep(1200);
      check('refused module: no paper mode', await page.eval(`!document.documentElement.classList.contains('paper')`));
      check('refused module: the note shows', await page.eval(`!!document.getElementById('studio-reading-note')?.textContent`));
      await shot('8-refused');
      await page.send('Network.setBlockedURLs', { urls: [] });
    }
  } catch (e) {
    failed++; fails.push(prefix + 'threw ' + e.message.slice(0, 300));
    await shot('z-threw').catch(() => {});
  } finally {
    await page.close();
  }
}

for (const n of ONLY) {
  const before = failed;
  await flow(n, DEVICES[n]);
  console.log(`${n}: ${failed === before ? 'ok' : (failed - before) + ' failed'}`);
}
for (const f of fails) console.log('FAIL ' + f);
console.log(`m1: ${passed} passed, ${failed} failed`);
process.exit(failed);
