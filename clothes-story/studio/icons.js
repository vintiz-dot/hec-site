// Every picture in the Studio UI: original paper-cut art supplies and glyphs, inline SVG, no image files.
// Art rules (section 2.2, 8.4): 3-unit navy outline on a 96-unit grid, round joins, one gold stitched hem.
// Anything meant to show the current swatch has class "tip" (fill) or "tips" (stroke); dock.js paints those.
const NAVY = '#16224A', HEM = '#FFC21A', SUN = '#FFE500', PAPER = '#FFFEFB', TIN = '#D9E1F2', WOOD = '#F3D3A3', DENIM = '#2C4F8F';
const TIP = 'class="tip" fill="#F2594B"';
const hem = (d, dash = '6.5 6') => `<path d="${d}" stroke="${HEM}" stroke-dasharray="${dash}"/>`;

// The line is the same on screen whatever the grid: 2.25px at slot size, which is a sticker's 3 units at 72px.
const linePx = size => Math.min(3, Math.max(2.25, size * .04));
const svgOpen = (box, w, h, stroke) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" width="${w}" height="${h}" aria-hidden="true" focusable="false" overflow="visible" fill="none" stroke="${NAVY}" stroke-width="${stroke.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">`;
const frame = (vw, vh, size, body) => `${svgOpen(`0 0 ${vw} ${vh}`, size, Math.round(size * vh / vw), linePx(size) * vw / size)}${body}</svg>`;
// Sticks are 36 units wide in a 96 grid. Cropping to the 72 units that hold art lets them fill a slot.
const STICK_X = 12, STICK_W = 72, STICK_H = 176;
const stickFrame = (size, body) => `${svgOpen(`${STICK_X} 0 ${STICK_W} ${STICK_H}`, size, Math.round(size * STICK_H / STICK_W), linePx(size) * STICK_W / size)}${body}</svg>`;

// Tall tools stand in the tray on a 96x176 grid, tip at the top. The tray hides their lower part until they lift.
const STICKS = {
  crayon: `<path ${TIP} d="M38 48C40 34 44.5 16 46.5 11Q48 7.5 49.5 11C51.5 16 56 34 58 48Z"/>
    <path d="M44.5 21 42 41" stroke="#fff" stroke-opacity=".6" stroke-width="3.5"/>
    <rect ${TIP} x="30" y="48" width="36" height="17" rx="3.5"/>
    <path fill="${PAPER}" d="M30 65H66V176H30Z"/>
    ${hem('M35.5 73.5H61')}
    <path d="M37 91C40 86 43 96 47 91S54 86 59 91"/>
    <path ${TIP} d="M30 112H66V176H30Z"/>`,

  pencil: `<path fill="${SUN}" stroke="none" d="M30 64Q36 57 41 64Q48 57 55 64Q60 57 66 64V176H30Z"/>
    <path fill="#FFF394" stroke="none" d="M41 64Q48 57 55 64V176H41Z"/>
    <path fill="#F0BE12" stroke="none" d="M55 64Q60 57 66 64V176H55Z"/>
    <path fill="${WOOD}" d="M30 64 44.3 21H51.7L66 64Q60 57 55 64Q48 57 41 64Q36 57 30 64Z"/>
    <path ${TIP} d="M42.8 26 46.6 10Q48 6.5 49.4 10L53.2 26Q48 31 42.8 26Z"/>
    <path d="M30 64V176H66V64"/>`,

  marker: `<path ${TIP} d="M41.5 40 43 20Q48 7 53 20L54.5 40Z"/>
    <path fill="${TIN}" d="M37 40H59L65 60H31Z"/>
    <rect fill="${PAPER}" x="28" y="60" width="40" height="124" rx="5"/>
    <rect ${TIP} x="28" y="69" width="40" height="24"/>
    ${hem('M33.5 102.5H63')}`,

  paint: `<path ${TIP} d="M48 5C60 21 63 37 58 54H38C33 37 36 21 48 5Z"/>
    <path d="M45.5 19C43 27 42 35 43 45" stroke="#fff" stroke-opacity=".6" stroke-width="3.5"/>
    <path fill="${TIN}" d="M38 54H58L56 82H40Z"/>
    <path d="M39.5 63H56.5"/>
    <path fill="#E8A95B" d="M40 82H56L53.5 180H42.5Z"/>
    <path ${TIP} d="M73 16C77.5 23.5 81 28 81 33A8 8 0 0 1 65 33C65 28 68.5 23.5 73 16Z"/>`,

  stitch: `<path d="M34 64C70 58 86 74 72 88S24 96 32 120 74 132 66 176" stroke-width="5.5" stroke-dasharray="11 9" stroke-opacity=".28" transform="translate(1 2)"/>
    <path class="tips" stroke="#F2594B" stroke-width="5.5" stroke-dasharray="11 9" d="M34 64C70 58 86 74 72 88S24 96 32 120 74 132 66 176"/>
    <g transform="rotate(16 48 40)"><path fill="#E9EEF8" d="M48 3C50.5 22 53 46 53 66Q53 78 48 78Q43 78 43 66C43 46 45.5 22 48 3Z"/>
    <ellipse cx="48" cy="65" rx="1.6" ry="6.5" fill="${NAVY}" stroke="none"/></g>`,
};

// Things that do not stand up sit in the tray on a 96x96 grid.
const OBJECTS = {
  fill: `<path ${TIP} d="M18.5 46C9 57 12.5 66 11 77C9.5 90 29 92 29 78C29 68 24.5 62 27 53Z"/>
    <g transform="rotate(-28 52 48)"><path d="M28 28C28 4 76 4 76 28"/>
    <path fill="${TIN}" d="M26 30 33 82Q52 90 71 82L78 30Z"/>
    <ellipse ${TIP} cx="52" cy="30" rx="26" ry="8.5"/>
    ${hem('M32 70Q52 79 72 70')}</g>
    <path fill="${SUN}" d="M82 6Q83.5 15 92 17Q83.5 19 82 28Q80.5 19 72 17Q80.5 15 82 6Z"/>`,

  stickers: `<g transform="rotate(-7 48 48)"><path fill="${PAPER}" d="M19 8H77Q86 8 86 17V66L61 90H19Q10 90 10 81V17Q10 8 19 8Z"/>
    ${hem('M19 83V16H77V58', '6 5.5')}
    <path ${TIP} d="M35.5 25 44 21Q48 26 52 21L60.5 25 71 37 63 43.5 59 39.5V67H37V39.5L33 43.5 25 37Z"/>
    <path fill="#C7D1E8" d="M86 66 61 90Q62 69 86 66Z"/></g>`,

  eraser: `<g transform="rotate(24 48 46)"><path fill="#F9AFC0" d="M31 6H65Q72 6 72 13V46H24V13Q24 6 31 6Z"/>
    <path fill="#8DB8EC" d="M24 46H72V80Q72 87 65 87H31Q24 87 24 80Z"/>
    ${hem('M30 55H67')}
    <path d="M32 14 31 34" stroke="#fff" stroke-opacity=".7" stroke-width="3.5"/></g>
    <path fill="${NAVY}" stroke="none" d="M72 83a2.5 2.5 0 1 0 .01 0ZM83 76a2 2 0 1 0 .01 0ZM81 88a2 2 0 1 0 .01 0Z"/>`,
};

const POUCH = `<path fill="${DENIM}" d="M11 49Q11 39 21 39H75Q85 39 85 49V78Q85 91 72 91H24Q11 91 11 78Z"/>
  <path d="M18 55H78" stroke="${HEM}" stroke-width="3.5" stroke-dasharray="4.5 4.5"/>
  ${hem('M20 83H76')}
  <path fill="${SUN}" d="M71 53H80V69Q75.5 74 71 69Z"/>`;

const PEEKS = {
  // All three peeking out of the closed pouch: a marker, a brush and a needle.
  all: `<path fill="${TIN}" d="M21 40V24H37V40Z"/><path fill="#F2594B" d="M24 24 25.5 13Q29 5 32.5 13L34 24Z"/>
    <path fill="#E8A95B" d="M43 40V22H53V40Z"/><path fill="#2A5BD7" d="M48 3C55 12 56 18 53.5 22H42.5C40 18 41 12 48 3Z"/>
    <path fill="#E9EEF8" d="M66 3C68 14 69 26 69 40H63C63 26 64 14 66 3Z"/>`,
  marker: `<path fill="${TIN}" d="M36 40 38 22H58L60 40Z"/><path ${TIP} d="M41 22 43 8Q48 -4 53 8L55 22Z"/>`,
  paint: `<path fill="${TIN}" d="M39 40V24H57V40Z"/><path ${TIP} d="M48 -3C58 8 60 16 57 24H39C36 16 38 8 48 -3Z"/>`,
  stitch: `<path fill="#E9EEF8" d="M48 -2C51 12 52 26 52 40H44C44 26 45 12 48 -2Z"/>
    <path class="tips" stroke="#F2594B" stroke-width="5" stroke-dasharray="9 7" d="M46 26C66 16 86 22 80 40"/>`,
};

const TOUCH = 'fill="none" stroke-width="3"';
// UI glyphs, 32-unit grid, drawn at 24 to 32px so the line matches the tool art on screen.
const GLYPHS = {
  undo: `<path ${TOUCH} d="M12 7 5 14l7 7M6 14h13.5a7 7 0 0 1 0 14H13"/>`,
  redo: `<path ${TOUCH} d="M20 7l7 7-7 7M26 14H12.5a7 7 0 0 0 0 14H19"/>`,
  zoom: `<circle cx="14" cy="14" r="9.5" fill="${PAPER}"/><path d="M21.5 21.5 28.5 28.5M14 9.5v9M9.5 14h9"/>`,
  whole: `<path fill="${PAPER}" d="M8 5H20L25 10V27H8Z"/><path d="M20 5V10H25M12 15H21M12 20H21"/>`,
  mirror: `<path d="M16 2V30" stroke="#C99A1E" stroke-dasharray="3.5 4"/>
    <path fill="#FFC21A" d="M12.5 7 8 8 2.5 14 6 17.5 8 15.5V26H12.5Z"/>
    <path fill="${PAPER}" d="M19.5 7 24 8 29.5 14 26 17.5 24 15.5V26H19.5Z"/>`,
  peg: `<path fill="${WOOD}" d="M10.5 2H21.5L20.5 13Q24 16.5 20.5 20L19.5 30H16.8L16 20.5 15.2 30H12.5L11.5 20Q8 16.5 11.5 13Z"/><circle cx="16" cy="16.5" r="2.8" fill="#FFC21A"/>`,
  speaker: `<path fill="${PAPER}" d="M4 12.5V19.5H9L16 25.5V6.5L9 12.5Z"/><path d="M20.5 12a5.5 5.5 0 0 1 0 8M24.5 8.5a11 11 0 0 1 0 15"/>`,
  stop: `<rect x="7" y="7" width="18" height="18" rx="3.5" fill="#F2594B"/>`,
  close: `<path d="M8 8 24 24M24 8 8 24"/>`,
  check: `<path d="M6 17.5 13 24.5 26.5 8.5"/>`,
  warn: `<path d="M16 6V19M16 26V26.1" stroke-width="4"/>`,
  pages: `<path fill="${PAPER}" d="M12 3H24L28 7V24H12Z"/><path fill="${PAPER}" d="M5 9H17V29H5Z"/>`,
  trash: `<path d="M6 9H26M12.5 9V5H19.5V9"/><path d="M8.5 9 10 28H22L23.5 9"/>`,
};

const PALETTE = `<path fill="#F6DDB4" d="M24 4C11.5 4 3 13 3 24S11.5 44 22 44C26.5 44 27.5 40.5 26.2 37.5C25 34.5 27 31.5 31 31.5H37C42 31.5 45 28 45 23C45 13 36 4 24 4Z"/>
  <circle cx="14" cy="17" r="4.2" fill="#F2594B" stroke-width="2"/><circle cx="25" cy="12" r="4.2" fill="#FFE500" stroke-width="2"/>
  <circle cx="35.5" cy="18.5" r="4.2" fill="#3FA34D" stroke-width="2"/><circle cx="11.5" cy="29" r="4.2" fill="#2A5BD7" stroke-width="2"/>
  <circle cx="19" cy="37" r="2.2" fill="${PAPER}" stroke-width="2" opacity="0"/>`;

const STAR = 'M12 1.8l3 6.6 7.2.7-5.4 4.8 1.6 7.1L12 17.3 5.6 21l1.6-7.1L1.8 9.1 9 8.4z';

// Tiny maps of the four sheets, so a page button looks like the page it opens. Ink sits under them.
const PAGES = {
  1: `<rect x="0" y="0" width="46" height="11" fill="${NAVY}" stroke="none"/><path d="M6 16.5H40" stroke-dasharray="1.5 3"/>
    <rect x="5" y="23" width="16.5" height="24" rx="1" stroke-dasharray="3 2.5"/><rect x="24.5" y="23" width="16.5" height="24" rx="1" stroke-dasharray="3 2.5"/>
    <rect x="5" y="51" width="36" height="8" rx="1" fill="${NAVY}" stroke="none"/>`,
  2: `<circle cx="9.5" cy="11" r="4" fill="${NAVY}" stroke="none"/><path d="M17 8H40M17 13H36"/>
    <circle cx="9.5" cy="29" r="4" fill="${NAVY}" stroke="none"/><path d="M17 26H40M17 31H34"/>
    <circle cx="9.5" cy="47" r="4" fill="${NAVY}" stroke="none"/><path d="M17 44H40M17 49H38"/>`,
  3: `<path d="M6 8H32"/><path d="M6 16H16M28 16H40"/><path d="M16 16H28" stroke-dasharray="1.5 3" stroke="#C99A1E"/>
    <path d="M6 24H24M34 24H40"/><path d="M24 24H34" stroke-dasharray="1.5 3" stroke="#C99A1E"/>
    <path d="M6 32H12M26 32H40"/><path d="M12 32H26" stroke-dasharray="1.5 3" stroke="#C99A1E"/>
    <path d="M6 40H30"/><path d="M30 40H40" stroke-dasharray="1.5 3" stroke="#C99A1E"/><path d="M6 48H18M30 48H40"/><path d="M18 48H30" stroke-dasharray="1.5 3" stroke="#C99A1E"/>`,
  4: `<path d="M6 7H40M6 12H40M6 17H40"/><circle cx="13" cy="28" r="6.5" fill="${NAVY}" stroke="none"/><path d="M23 25H40M23 30H36"/>
    <rect x="5" y="39" width="36" height="20" rx="1"/><path d="M10 45H36M10 50H30"/>`,
};

export const STICK_TOOLS = Object.keys(STICKS);

// ---- Swatches: what a tip, a dot and a pinked card are made of ----

const star5 = (x, y, r) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, k = i % 2 ? r * .45 : r;
    pts.push(`${(x + k * Math.cos(a)).toFixed(1)} ${(y + k * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
};
const petals = (x, y, r, fill) => [0, 1, 2, 3, 4].map(i => {
  const a = -Math.PI / 2 + i * 2 * Math.PI / 5;
  return `<circle cx="${(x + r * Math.cos(a)).toFixed(1)}" cy="${(y + r * Math.sin(a)).toFixed(1)}" r="${(r * .72).toFixed(1)}" fill="${fill}"/>`;
}).join('');

// Used when textures.previewTile has nothing to give, so the dock never shows a hole. On a 24-unit tile.
const VECTOR_TILE = {
  denim: `<rect width="24" height="24" fill="#2C4F8F"/><path d="M-6 6 6-6M0 12 12 0M6 18 18 6M12 24 24 12M18 30 30 18" stroke="#5E82C4" stroke-width="1.5"/>`,
  stripe: `<rect width="24" height="24" fill="#FFFEFB"/><rect width="24" height="12" fill="#16224A"/>`,
  gingham: `<rect width="24" height="24" fill="#FFFEFB"/><rect width="12" height="24" fill="#F2594B" opacity=".55"/><rect width="24" height="12" fill="#F2594B" opacity=".55"/>`,
  polka: `<rect width="24" height="24" fill="#18A3D0"/><circle cx="6" cy="6" r="3.4" fill="#fff"/><circle cx="18" cy="18" r="3.4" fill="#fff"/>`,
  stars: `<rect width="24" height="24" fill="#16224A"/><path d="${star5(6, 6.5, 5)}${star5(18, 18.5, 5)}" fill="#FFE500"/>`,
  flower: `<rect width="24" height="24" fill="#FBD3E0"/>${petals(12, 12, 4.4, '#E0457B')}<circle cx="12" cy="12" r="2.2" fill="#FFE500"/>`,
};
const RAINBOW = ['#F2594B', '#F98F1D', '#FFD60A', '#3FA34D', '#18A3D0', '#3B4BA8', '#7C55C7'];

// One tile in three user spaces: the 96 grid of tool art, the 40 grid of dots, and CSS px on palette cards.
const SPACES = { i: 64, d: 44, c: 62 };

function fabricPatterns(id, url) {
  return Object.entries(SPACES).map(([space, s]) => `<pattern id="st-fab-${space}-${id}" patternUnits="userSpaceOnUse" width="${s}" height="${s}">`
    + (url ? `<image href="${url}" width="${s}" height="${s}" preserveAspectRatio="none"/>` : `<g transform="scale(${s / 24})">${VECTOR_TILE[id]}</g>`)
    + '</pattern>').join('');
}

function glitterPatterns(id, hex) {
  const dark = 'rgba(22,34,74,.45)', light = 'rgba(255,255,255,.9)';
  const body = `<rect width="24" height="24" fill="${hex}"/><path d="M3 4h2v2H3zM13 2h2v2h-2zM20 9h2v2h-2zM7 12h2v2H7zM16 15h2v2h-2zM2 19h2v2H2zM11 20h2v2h-2z" fill="${dark}"/>`
    + `<path d="M8 3h2v2H8zM18 3h2v2h-2zM12 9h2v2h-2zM3 11h1.500v1.500H3zM21 17h2v2h-2zM7 18h2v2H7z" fill="${light}"/>`
    + `<path d="M15 5.500q.4 2.600 3 3-2.600.4-3 3-.4-2.600-3-3 2.600-.4 3-3Z" fill="#fff"/>`;
  return Object.entries(SPACES).map(([space, s]) => `<pattern id="st-glit-${space}-${id}" patternUnits="userSpaceOnUse" width="${s * .7}" height="${s * .7}"><g transform="scale(${s * .7 / 24})">${body}</g></pattern>`).join('');
}

// The shared <defs>. tileOf(fabricId) gives a data URL or something falsy; swatches is the list from constants.js.
export function swatchDefs(tileOf, swatches) {
  let body = `<linearGradient id="st-rainbow" x1="0" y1="0" x2="0" y2="1">${RAINBOW.map((c, i) => `<stop offset="${i / 7}" stop-color="${c}"/><stop offset="${(i + 1) / 7}" stop-color="${c}"/>`).join('')}</linearGradient>`;
  for (const sw of swatches) {
    if (sw.kind === 'fabric') body += fabricPatterns(sw.fabric, tileOf(sw.fabric));
    if (sw.kind === 'glitter') body += glitterPatterns(sw.id, sw.hex);
  }
  return `<svg class="st-defs" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute"><defs>${body}</defs></svg>`;
}

// What goes in a fill attribute. space: 'i' tool art, 'd' dot, 'c' card.
export function swatchPaint(sw, space = 'i') {
  if (sw.kind === 'fabric') return `url(#st-fab-${space}-${sw.fabric})`;
  if (sw.kind === 'rainbow') return 'url(#st-rainbow)';
  if (sw.kind === 'glitter') return `url(#st-glit-${space}-${sw.id})`;
  return sw.hex;
}

// A zigzag circle, as pinking shears cut it.
function pinkedCircle(cx, cy, r, teeth, depth) {
  const pts = [];
  for (let i = 0; i < teeth * 2; i++) {
    const a = i * Math.PI / teeth, k = i % 2 ? r - depth : r;
    pts.push(`${(cx + k * Math.cos(a)).toFixed(2)} ${(cy + k * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

// A zigzag rectangle. Teeth are fitted to each side so the corners come out the same.
function pinkedRect(w, h, tooth, inset = 1.5) {
  const pts = [];
  const out = tooth * .42;
  const side = (x0, y0, x1, y1) => {
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(2, Math.round(len / tooth));
    const nx = (y1 - y0) / len, ny = -(x1 - x0) / len;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + .5) / n;
      pts.push(`${(x0 + (x1 - x0) * t0).toFixed(1)} ${(y0 + (y1 - y0) * t0).toFixed(1)}`);
      pts.push(`${(x0 + (x1 - x0) * t1 + nx * out).toFixed(1)} ${(y0 + (y1 - y0) * t1 + ny * out).toFixed(1)}`);
    }
  };
  const a = inset + out, b = w - a, c = h - a;
  side(a, a, b, a);
  side(b, a, b, c);
  side(b, c, a, c);
  side(a, c, a, a);
  return `M${pts.join('L')}Z`;
}

// A color dot on a 40 grid, with a 34 unit disc. Cloth is cut with pinking shears, and magic gets a sparkle.
export function swatchDot(sw, size = 40) {
  const stroke = `stroke="${NAVY}" stroke-width="${(linePx(size) * 40 / size).toFixed(2)}" stroke-linejoin="round"`;
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true" focusable="false">`;
  const paint = swatchPaint(sw, 'd');
  if (sw.kind === 'fabric') return `${open}<path d="${pinkedCircle(20, 20, 19.5, 18, 2.6)}" fill="${paint}" ${stroke}/></svg>`;
  const sparkle = sw.kind === 'glitter' ? `<path d="M27 7q.9 5.100 6 6-5.100.9-6 6-.9-5.100-6-6 5.100-.9 6-6Z" fill="#fff" stroke="${NAVY}" stroke-width="1"/>` : '';
  return `${open}<circle cx="20" cy="20" r="17" fill="${paint}" ${stroke}/>${sparkle}</svg>`;
}

// A palette card: a piece of cloth with pinked edges, in CSS px.
export function swatchCard(sw, w, h) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" focusable="false">`
    + `<path d="${pinkedRect(w, h, 8)}" fill="${swatchPaint(sw, 'c')}" stroke="${NAVY}" stroke-width="2.25" stroke-linejoin="round"/></svg>`;
}

export function icon(name, size = 32) {
  if (STICKS[name]) return stickFrame(size, STICKS[name]);
  if (OBJECTS[name]) return frame(96, 96, size, OBJECTS[name]);
  if (name === 'more') return frame(96, 96, size, PEEKS.all + POUCH);
  if (name.startsWith('more:')) return frame(96, 96, size, (PEEKS[name.slice(5)] ?? PEEKS.all) + POUCH);
  if (GLYPHS[name]) return frame(32, 32, size, GLYPHS[name]);
  if (name === 'palette') return frame(48, 48, size, PALETTE);
  if (name === 'star') {
    return frame(24, 24, size, `<path d="${STAR}" stroke="${PAPER}" stroke-width="3.4"/><path d="${STAR}" fill="${SUN}" stroke-width="1.2"/>`);
  }
  if (name.startsWith('page')) {
    const body = PAGES[name.slice(4)];
    if (body) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 46 65" aria-hidden="true" focusable="false" fill="none" stroke="#AEB5CB" stroke-width="1.5" stroke-linecap="round">${body}</svg>`;
  }
  return '';
}
