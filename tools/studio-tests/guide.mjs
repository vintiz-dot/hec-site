// guide.mjs: name to keyboard, uniform count, spaces, movable stickers, Think, going over the speech, print.
//   node tools/studio-tests/guide.mjs <scratch dir> phone|laptop
import fs from 'node:fs';

import { launch, sleep } from './cdp.mjs';
const OUT = process.argv[2];
const SIZE = process.argv[3] === 'laptop'
  ? { n: 'laptop', width: 1280, height: 800, dsf: 1, mobile: false, touch: false }
  : { n: 'phone', width: 390, height: 780, dsf: 1, mobile: true, touch: true };
fs.rmSync(`${OUT}/prof-g-${SIZE.n}`, { recursive: true, force: true });
const page = await launch({ browser: 'chrome', profileDir: `${OUT}/prof-g-${SIZE.n}`, ...SIZE });
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) pass++; else { fail++; console.log('FAIL', name, extra); } };
const tap = async (x, y) => {
  if (SIZE.touch) { await page.touchStart({ x, y }); await sleep(30); await page.touchEnd(); } else { await page.mouseDown(x, y); await sleep(25); await page.mouseUp(x, y); }
  await sleep(160);
};
const drag = async (x0, y0, x1, y1) => {
  const n = 10;
  if (SIZE.touch) {
    await page.touchStart({ x: x0, y: y0 });
    for (let i = 1; i <= n; i++) { await page.touchMove([{ id: 0, x: x0 + (x1 - x0) * i / n, y: y0 + (y1 - y0) * i / n }]); await sleep(12); }
    await page.touchEnd();
  } else {
    await page.mouseDown(x0, y0);
    for (let i = 1; i <= n; i++) { await page.mouseMove(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n); await sleep(12); }
    await page.mouseUp(x1, y1);
  }
  await sleep(200);
};
const rect = sel => page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; e.scrollIntoView({block:'nearest'}); const b=e.getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2,w:b.width,h:b.height}})()`);
const tapSel = async sel => { const r = await rect(sel); if (!r) { console.log('no element', sel); return false; } await tap(r.x, r.y); return true; };
const tapText = async (sel, text) => {
  const r = await page.eval(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(k=>k.textContent.includes(${JSON.stringify(text)})); if(!e) return null; e.scrollIntoView({block:'nearest'}); const b=e.getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2}})()`);
  if (!r) { console.log('no text', text); return false; }
  await tap(r.x, r.y);
  return true;
};
const shot = name => page.screenshot(`${OUT}/g-${SIZE.n}-${name}.png`);
const objs = () => page.eval(`JSON.stringify([...document.querySelectorAll('.sheet>img.st-obj')].map(e=>e.style.transform))`);
try {
  await page.goto('http://localhost:5310/clothes-story/?test=1');
  await sleep(800);
  await tapSel('#studio-reading-cta');
  for (let i = 0; i < 40 && !(await page.eval(`!!document.querySelector(".c-text")`)); i++) await sleep(200);
  await sleep(300);
  // 1. the name opens straight to the keyboard
  const focus = await page.eval(`document.activeElement?.className`);
  check('name card focused the text field', /c-text/.test(focus || ''), focus);
  await shot('1-name');
  await page.send('Input.insertText', { text: 'Minh Anh' });
  await sleep(200);
  await page.eval(`document.activeElement.blur()`);
  await sleep(200);
  await page.eval(`window.__studio.card.close()`);
  await sleep(700);
  // 2. how many uniforms
  check('count question shows', await page.eval(`document.querySelector('#st-coach')?.dataset.kind`) === 'count');
  const both = await page.eval(`document.querySelector('.co-q').textContent`);
  check('asked in both languages', /How many different school uniforms/.test(both) && /bao nhiêu bộ đồng phục/.test(both), both);
  await tapText('.co-num', '3');
  await sleep(200);
  await shot('2-count');
  check('three spaces on the page', await page.eval(`document.querySelectorAll('.st-cell').length`) === 3);
  await tapSel('.co-next');
  await sleep(400);
  // 3. details for uniform 1
  check('uniform 1 name step', await page.eval(`document.querySelector('#st-coach')?.dataset.kind`) === 'u1:name');
  await tapText('.co-chip', 'P.E. uniform');
  await tapSel('.co-next');
  await sleep(300);
  await tapText('.co-chip', 'T-shirt');
  await tapText('.co-chip', 'blue');
  await shot('3-top');
  await tapSel('.co-next');
  await sleep(300);
  await tapText('.co-chip', 'shorts');
  await tapText('.co-chip', 'navy');
  await tapSel('.co-next');
  await sleep(300);
  await tapText('.co-chip', 'socks');
  await tapText('.co-chip', 'shoes');
  await tapSel('.co-next');
  await sleep(1200);
  // 4. draw step: one tap makes the blue T-shirt, then it can be dragged
  check('draw strip shows', !!(await rect('#st-coach-strip')));
  await tapText('.co-mini', 'blue T-shirt');
  await sleep(1100);
  check('sticker object exists', JSON.parse(await objs()).length === 1);
  await shot('4-sticker');
  const pos0 = await page.eval(`(()=>{const o=document.querySelector('.sheet>img.st-obj').getBoundingClientRect();return {x:o.x+o.width/2,y:o.y+o.height/2,w:o.width}})()`);
  await drag(pos0.x, pos0.y, pos0.x + 24, pos0.y + 30);
  const pos1 = await page.eval(`(()=>{const o=document.querySelector('.sheet>img.st-obj').getBoundingClientRect();return {x:o.x+o.width/2,y:o.y+o.height/2}})()`);
  check('selected sticker drags', Math.abs(pos1.x - pos0.x - 24) < 4 && Math.abs(pos1.y - pos0.y - 30) < 4, JSON.stringify([pos0, pos1]));
  // tap elsewhere puts it down, tap on it picks it up again, then drag again after "dropping"
  const free = { x: pos1.x + pos0.w * .62, y: pos1.y - pos0.w * .05 };
  await tap(free.x, free.y);
  check('tap elsewhere deselects', !(await page.eval(`!!document.querySelector('#st-sel')?.isConnected`)));
  await tap(pos1.x, pos1.y);
  check('tap selects again', await page.eval(`!!document.querySelector('#st-sel')?.isConnected`));
  await drag(pos1.x, pos1.y, pos1.x - 18, pos1.y - 14);
  const pos2 = await page.eval(`(()=>{const o=document.querySelector('.sheet>img.st-obj').getBoundingClientRect();return {x:o.x+o.width/2,y:o.y+o.height/2}})()`);
  check('drag after dropping', Math.abs(pos2.x - pos1.x + 18) < 4 && Math.abs(pos2.y - pos1.y + 14) < 4, JSON.stringify([pos1, pos2]));
  await shot('5-selected');
  // undo walks the moves back
  await page.eval(`window.__studio.undo.undo()`);
  await sleep(300);
  const pos3 = await page.eval(`(()=>{const o=document.querySelector('.sheet>img.st-obj').getBoundingClientRect();return {x:o.x+o.width/2,y:o.y+o.height/2}})()`);
  check('undo moves it back', Math.abs(pos3.x - pos1.x) < 4 && Math.abs(pos3.y - pos1.y) < 4, JSON.stringify([pos1, pos3]));
  // draw on the sticker with the crayon: deselect first, then a stroke that starts on it
  await tap(free.x, free.y);
  await sleep(100);
  const before = await page.eval(`document.querySelector('.sheet>img.st-obj').src.length`);
  await drag(pos3.x - 10, pos3.y, pos3.x + 12, pos3.y + 6);
  await sleep(400);
  const after = await page.eval(`document.querySelector('.sheet>img.st-obj').src.length`);
  check('a stroke on a sticker lands on the sticker', after !== before, `${before} ${after}`);
  await sleep(2000);
  // persistence
  await page.send('Page.reload', {});
  await sleep(6000);
  check('sticker comes back after reload', JSON.parse(await objs()).length === 1);
  check('cells come back after reload', await page.eval(`document.querySelectorAll('.st-cell').length`) === 3);
  const cap = await page.eval(`document.querySelector('.st-cell>span')?.textContent`);
  check('caption built from answers', /P\.E\. uniform: blue T-shirt, navy shorts, socks, shoes/.test(cap || ''), cap);
  await shot('6-reloaded');
  // rehearsal before the camera
  await page.eval(`window.__studio.shell.goRecord()`);
  await sleep(500);
  const text = await page.eval(`document.querySelector('#st-coach .co-body')?.textContent`);
  check('rehearsal lists the uniform line', /My P\.E\. uniform has a blue T-shirt and navy shorts/.test(text || ''), (text || '').slice(0, 200));
  check('rehearsal stays on the page, no navigation', /clothes-story\/\?test=1/.test(await page.eval('location.href')));
  check('name is in the speech', /My name is Minh Anh/.test(text || ''), (text || '').slice(0, 200));
  await shot('7-rehearse');
  await page.eval(`window.__studio.shell.note && 0; document.querySelector('#st-coach .co-x').click()`);
  await sleep(200);
  const pdf = await page.printPDF(`${OUT}/g-${SIZE.n}.pdf`, { printBackground: true });
  check('print is 4 pages', pdf.pages === 4, String(pdf.pages));
  // the Think step sits on top of the Card, right before the thinking blanks
  await page.eval(`window.__studio.fields.open('p3-uniform-is')`);
  await sleep(900);
  check('Think step opens', await page.eval(`document.querySelector('#st-coach')?.dataset.kind`) === 'think');
  await shot('8-think');
  await tapSel('#st-coach .co-next');
  await sleep(300);
  check('Card is still there after Think', await page.eval(`window.__studio.card.isOpen()`));
  await page.eval(`window.__studio.card.close()`);
  await sleep(500);
  await page.eval(`document.querySelector('#st-coach .co-x')?.click()`);
  // the record link in the reading view goes through the speech first
  await page.eval(`window.__studio.shell.exit()`);
  await sleep(1500);
  await page.eval(`document.querySelector('a[href*="record.html"]').click()`);
  for (let i = 0; i < 30 && !(await page.eval(`!!document.querySelector('#st-coach')`)); i++) await sleep(200);
  check('record link opens the speech', await page.eval(`document.querySelector('#st-coach')?.dataset.kind`) === 'rehearse');
  check('record link did not leave the page', !/record.html/.test(await page.eval('location.href')));
  const errs = page.consoleErrors();
  check('no console errors', !errs.length, JSON.stringify(errs).slice(0, 500));
} catch (e) { fail++; console.log('THREW', e.stack); await shot('error').catch(() => {}); }
finally { console.log(`${SIZE.n}: ${pass} passed, ${fail} failed`); await page.close(); }
