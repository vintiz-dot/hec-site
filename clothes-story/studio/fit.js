// Answers on the sheets: the .ans span inside a .blank, .line or .write, and the tick state of a list row.
// Imports nothing, because reading-ink.js uses it in the reading view without loading the rest of Studio.
// Text is only ever set through textContent, and handwriting must be a PNG data URL: both come from storage.

const START_PX = 22;   // LIMITS.shrinkStartPx
const FLOOR_PX = 11;   // LIMITS.shrinkFloorPx
const LAST_PX = 8;     // only for text that still spills out of the blank after wrapping at the floor
const GUTTER = '0 1px'; // handwriting glyphs overhang their advance width, and .ans clips
const SAFE_SRC = 'data:image/png;base64,';

export const isSafeInk = src => typeof src === 'string' && src.startsWith(SAFE_SRC);

const ansOf = el => el.querySelector(':scope>.ans');

function clearFit(style) {
  style.fontSize = style.whiteSpace = style.lineHeight = style.textAlign = style.overflowWrap = '';
  style.justifyContent = style.alignItems = style.padding = '';
}

function wrapAtFloor(ans, style) {
  style.whiteSpace = 'normal';
  style.lineHeight = '1';
  style.textAlign = 'center';
  style.overflowWrap = 'anywhere';
  style.alignItems = 'flex-start'; // bottom aligned, the overflow would be out of reach of scrollHeight
  for (let px = FLOOR_PX; px > LAST_PX && ans.scrollHeight > ans.clientHeight; px -= .5) style.fontSize = px - .5 + 'px';
  style.alignItems = '';
}

// Shrink to fit. Needs layout, so inside a display:none sheet it does nothing and returns false;
// callers fit such a sheet under .book.measure. Nothing outside the absolutely placed .ans ever moves.
export function fitAnswer(el) {
  const ans = el && ansOf(el);
  if (!ans || ans.firstElementChild) return true;
  if (!ans.clientWidth) return false;
  const style = ans.style;
  clearFit(style);
  style.padding = GUTTER;
  style.justifyContent = 'flex-start'; // centred, half of any overflow would be out of reach of scrollWidth
  const room = ans.clientWidth;        // scrollWidth is never below this, so a fit reads as equal
  const fits = px => {
    style.fontSize = px + 'px';
    return ans.scrollWidth <= room;
  };
  if (!fits(START_PX)) {
    if (fits(FLOOR_PX)) {
      let lo = FLOOR_PX, hi = START_PX; // lo fits, hi does not
      while (hi - lo > .5) {
        const mid = Math.round(lo + hi) / 2;
        if (fits(mid)) lo = mid; else hi = mid;
      }
      style.fontSize = lo + 'px';
    } else {
      wrapAtFloor(ans, style);
    }
  }
  style.justifyContent = '';
  return true;
}

function showInk(ans, src) {
  clearFit(ans.style);
  let img = ans.firstElementChild;
  if (!img || img.tagName !== 'IMG') {
    ans.textContent = '';
    img = document.createElement('img');
    img.alt = '';
    ans.append(img);
  }
  if (img.getAttribute('src') !== src) img.src = src;
}

// value is a FieldValue or null. Inserts, updates or removes the .ans span; a row of a tick list toggles .on.
export function renderAnswer(el, value) {
  if (!el) return;
  if (el.tagName === 'LI') {
    el.classList.toggle('on', value?.kind === 'tick' && !!value.on);
    return;
  }
  const kind = value?.kind;
  const src = kind === 'ink' && isSafeInk(value.src) ? value.src : '';
  const text = (kind === 'text' || kind === 'chip') && typeof value.text === 'string' ? value.text : '';
  let ans = ansOf(el);
  if (!src && !text) {
    ans?.remove();
    return;
  }
  if (!ans) {
    ans = document.createElement('span');
    ans.className = 'ans';
    el.append(ans);
  }
  if (src) {
    showInk(ans, src);
    return;
  }
  if (ans.firstElementChild || ans.textContent !== text) ans.textContent = text;
  fitAnswer(el);
}

// ---- uniform spaces on the cover, shared by the Studio and the reading view's print ----
const CELLS = {
  1: [[0, 0, 1, 1]],
  2: [[0, 0, 1, .5], [0, .5, 1, .5]],
  3: [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, 1, .5]],
  4: [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]],
  5: [[0, 0, .5, 1 / 3], [.5, 0, .5, 1 / 3], [0, 1 / 3, .5, 1 / 3], [.5, 1 / 3, .5, 1 / 3], [0, 2 / 3, 1, 1 / 3]],
  6: [[0, 0, .5, 1 / 3], [.5, 0, .5, 1 / 3], [0, 1 / 3, .5, 1 / 3], [.5, 1 / 3, .5, 1 / 3], [0, 2 / 3, .5, 1 / 3], [.5, 2 / 3, .5, 1 / 3]],
};

export function cellRects(rect, n) {
  return (CELLS[n] ?? []).map(([x, y, w, h]) => ({ x: rect.x + x * rect.w, y: rect.y + y * rect.h, w: w * rect.w, h: h * rect.h }));
}

function caption(u, i, n) {
  if (!u) return n > 1 ? `Uniform ${i}` : '';
  const top = [u.topColor, u.top].filter(Boolean).join(' ');
  const bottom = [u.bottomColor, u.bottom].filter(Boolean).join(' ');
  const extras = (u.extras ?? []).map(e => e.replace(/^an? /, ''));
  const wear = [top, bottom, ...extras].filter(Boolean).join(', ');
  const name = u.name || (n > 1 ? `Uniform ${i}` : '');
  return name && wear ? `${name}: ${wear}` : name || wear;
}

export function renderCells(coach) {
  const host = document.querySelector('.draw[data-box="p1-uniform"]');
  if (!host) return;
  host.querySelector('.st-cells')?.remove();
  const n = Math.min(6, Number(coach?.count) || 0);
  host.classList.toggle('st-split', n > 1);
  if (!n) return;
  const box = document.createElement('div');
  box.className = 'st-cells';
  (CELLS[n] ?? []).forEach(([x, y, w, h], k) => {
    const cell = document.createElement('div');
    cell.className = 'st-cell';
    cell.style.cssText = `left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%`;
    if (n > 1) {
      const num = document.createElement('b');
      num.textContent = String(k + 1);
      cell.append(num);
    }
    const text = caption(coach.u?.[k], k + 1, n);
    if (text) {
      const cap = document.createElement('span');
      cap.textContent = text;
      cell.append(cap);
    }
    box.append(cell);
  });
  host.append(box);
}
