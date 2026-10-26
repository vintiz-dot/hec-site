/**
 * build-vi.mjs — generates index-vn.html, the Vietnamese homepage
 *
 * index.html is the only hand-edited homepage. This script copies it and
 * renders every [data-i18n], [data-i18n-placeholder] and [data-i18n-content]
 * string in Vietnamese from assets/translations.js, the same substitution
 * language.js makes in the browser, so search engines read Vietnamese without
 * running JavaScript. It also sets <html lang="vi">, points the canonical
 * and og:url at index-vn.html, and links the program cards to the Vietnamese
 * course pages.
 *
 * Re-run it after editing index.html or assets/translations.js:
 *
 *     node tools/build-vi.mjs           write index-vn.html
 *     node tools/build-vi.mjs --check   exit 1 if index-vn.html is out of date
 *
 * Text marked data-i18n lives in two places: the English in index.html (read
 * by crawlers) and the "en" string in translations.js (what language.js shows
 * in the browser). The script warns when the two disagree.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const SITE = 'https://hanoienglish.com/';
const ROOT = new URL('..', import.meta.url);

const BANNER = `<!-- GENERATED FILE, do not edit: index.html rendered in Vietnamese by
     tools/build-vi.mjs. Edit index.html or assets/translations.js instead,
     then run: node tools/build-vi.mjs -->`;

// Attribute text inside a tag, stepping over quoted values that contain '>'
const ATTRS = `(?:[^>"']|"[^"]*"|'[^']*')*`;
const TAG = new RegExp(`<[a-zA-Z]${ATTRS}>`, 'g');
const ATTR_HOOKS = [['data-i18n-placeholder', 'placeholder'], ['data-i18n-content', 'content']];

const attrValue = (tag, name) => (tag.match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1];
const escapeText = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = s => escapeText(s).replace(/"/g, '&quot;');

// Plain wording of an HTML string, ignoring markup and spacing
const wording = s => s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function read(path) {
  return readFileSync(new URL(path, ROOT), 'utf8').replace(/^﻿/, '');
}

// HEC_TRANSLATIONS, obtained by running translations.js as the browser does
export function loadTranslations(source) {
  return vm.runInNewContext(source + '\n;HEC_TRANSLATIONS', {});
}

// Offset of the </tag> closing the element whose content starts at `from`
function findClose(html, tag, from) {
  const re = new RegExp(`<(/?)${tag}\\b${ATTRS}>`, 'gi');
  re.lastIndex = from;
  let depth = 1, m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index;
  }
  throw new Error(`No closing </${tag}> after offset ${from}`);
}

// Each [data-i18n] element: its key, tag name and the offsets of its content
function* i18nElements(html) {
  const open = new RegExp(`<([a-zA-Z][\\w-]*)(${ATTRS})>`, 'g');
  let m;
  while ((m = open.exec(html))) {
    const key = attrValue(m[2], 'data-i18n');
    if (!key) continue;
    const tag = m[1].toLowerCase();
    const start = m.index + m[0].length;
    yield { key, tag, start, end: findClose(html, tag, start) };
  }
}

/**
 * Renders the data-i18n strings of `html` in `lang`, mirroring
 * applyTranslations() in language.js: H1, H2 and P take the string as HTML
 * (\n becomes <br>), other elements take it as plain text in place of their
 * content. Keys with no string for `lang` are left as they are and listed in
 * `missing`.
 */
export function renderLanguage(html, translations, lang) {
  const missing = new Set();
  let count = 0;
  const lookup = key => {
    const entry = translations[key];
    if (entry && entry[lang]) { count++; return entry[lang]; }
    missing.add(key);
    return null;
  };

  // [data-i18n-placeholder] → placeholder="", [data-i18n-content] → content=""
  html = html.replace(TAG, tag => {
    for (const [hook, attr] of ATTR_HOOKS) {
      const key = attrValue(tag, hook);
      const value = key && lookup(key);
      if (!value) continue;
      if (attrValue(tag, attr) === undefined) throw new Error(`${hook}="${key}" on a tag without ${attr}="": ${tag}`);
      tag = tag.replace(new RegExp(`(\\s${attr}=")[^"]*"`), (_, before) => before + escapeAttr(value) + '"');
    }
    return tag;
  });

  // [data-i18n] → element content
  let out = '', pos = 0;
  for (const { key, tag, start, end } of i18nElements(html)) {
    if (start < pos) continue;   // inside an element already replaced, as in the browser
    const value = lookup(key);
    if (!value) continue;
    out += html.slice(pos, start) +
      (/^(h1|h2|p)$/.test(tag) ? value.replace(/\n/g, '<br>') : escapeText(value));
    pos = end;
  }
  return { html: out + html.slice(pos), count, missing: [...missing] };
}

/**
 * Keys whose English in `html` says something other than their "en" string.
 * language.js swaps in the "en" string, so browsers show translations.js while
 * crawlers read index.html: an edit made in only one of them is half lost.
 */
export function englishDrift(html, translations) {
  const drift = new Set();
  const compare = (key, text) => {
    const en = translations[key] && translations[key].en;
    if (en && wording(text) !== wording(en)) drift.add(key);
  };
  for (const { key, start, end } of i18nElements(html)) compare(key, html.slice(start, end));
  for (const tag of html.match(TAG)) {
    for (const [hook, attr] of ATTR_HOOKS) {
      const key = attrValue(tag, hook);
      if (key) compare(key, attrValue(tag, attr) || '');
    }
  }
  return [...drift];
}

function replaceOnce(html, from, to) {
  const at = html.indexOf(from);
  if (at < 0 || html.indexOf(from, at + 1) >= 0) {
    throw new Error(`Expected exactly one ${from} in index.html`);
  }
  return html.slice(0, at) + to + html.slice(at + from.length);
}

export function buildVietnamese(indexHtml, translations) {
  const page = renderLanguage(indexHtml, translations, 'vi');
  let html = page.html;
  html = replaceOnce(html, '<html lang="en">', '<html lang="vi">');
  html = replaceOnce(html, `<link rel="canonical" href="${SITE}">`,
                           `<link rel="canonical" href="${SITE}index-vn.html">`);
  html = replaceOnce(html, `<meta property="og:url" content="${SITE}">`,
                           `<meta property="og:url" content="${SITE}index-vn.html">`);
  // Links to bilingual pages (program cards, …) open their Vietnamese version
  html = html.replace(/(<a\b[^>]*?\shref=")(index|courses\/[\w-]+?)(\.html[^"]*")/g,
    (link, before, page, after) => page.endsWith('-vn') ? link : before + page + '-vn' + after);
  const eol = html.includes('\r\n') ? '\r\n' : '\n';
  html = html.replace(/^<!doctype html>\r?\n/i, doctype => doctype + BANNER.replace(/\n/g, eol) + eol);
  if (!html.includes(BANNER.slice(0, 20))) throw new Error('index.html must start with <!doctype html>');
  return { html, count: page.count, missing: page.missing };
}

function main() {
  const translations = loadTranslations(read('assets/translations.js'));
  const indexHtml = read('index.html');
  const { html, count, missing } = buildVietnamese(indexHtml, translations);
  for (const key of missing) {
    console.warn(translations[key] ? `No Vietnamese for "${key}", left in English`
                                   : `Unknown key "${key}" (not in translations.js)`);
  }
  for (const key of englishDrift(indexHtml, translations)) {
    console.warn(`English for "${key}" differs between index.html and translations.js ` +
                 `(browsers show translations.js, crawlers index.html): make them match`);
  }
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = read('index-vn.html'); } catch (e) { /* missing counts as stale */ }
    if (current !== html) {
      console.error('index-vn.html is out of date: run node tools/build-vi.mjs');
      process.exit(1);
    }
    console.log('index-vn.html is up to date.');
    return;
  }
  writeFileSync(new URL('index-vn.html', ROOT), html);
  console.log(`Wrote index-vn.html (${count} strings in Vietnamese).`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main();
}
