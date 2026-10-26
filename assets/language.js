/**
 * language.js — i18n Engine for HEC
 *
 * Responsibilities:
 *  1. Decide the page language: pages published once per language
 *     (index-vn.html, courses/*.html and courses/*-vn.html) always show their
 *     own language; the other pages show the visitor's saved choice, falling
 *     back to navigator.language
 *  2. Apply translations to any element with a [data-i18n] attribute
 *  3. Handle placeholder translations for form inputs via [data-i18n-placeholder]
 *     and meta tags via [data-i18n-content]
 *  4. Point links at the same-language version of bilingual pages
 *  5. Provide toggleLanguage() for the navbar switcher: it opens the other
 *     language's URL where there is one, otherwise translates in place
 *
 * Nothing here redirects on page load. Every URL serves its own content, so
 * search engines index the Vietnamese pages as they are. index-vn.html is
 * generated from index.html by tools/build-vi.mjs.
 *
 * Pages that use [data-i18n] load this script AFTER translations.js so that
 * HEC_TRANSLATIONS is available. Course pages load it without translations.js,
 * for the toggle and the links only.
 */

const HEC_I18N = (function () {

  // Site root, taken from this script's own URL (…/assets/language.js), so
  // paths resolve the same on hanoienglish.com and on a local server
  const ROOT = new URL('..', document.currentScript.src);

  /* ── Bilingual pages ─────────────────────────────────────── */
  // The homepage and the course pages exist once per language:
  // index.html / index-vn.html, courses/mars.html / courses/mars-vn.html.
  // Every other page is a single file translated in place.

  // Site-relative path of a URL ('index.html' for the root), null if off-site
  function sitePath(url) {
    const u = new URL(url, location.href);
    if (u.origin !== ROOT.origin || !u.pathname.startsWith(ROOT.pathname)) return null;
    return u.pathname.slice(ROOT.pathname.length) || 'index.html';
  }

  // Path of the `lang` version of a bilingual page, null for single-file pages
  function counterpart(path, lang) {
    const suffix = lang === 'vi' ? '-vn' : '';
    if (path === 'index.html' || path === 'index-vn.html') return 'index' + suffix + '.html';
    const m = path.match(/^courses\/([\w-]+?)(?:-vn)?\.html$/);
    return m ? 'courses/' + m[1] + suffix + '.html' : null;
  }

  function pathLang(path) {
    return path.endsWith('-vn.html') ? 'vi' : 'en';
  }

  /* ── Determine language ──────────────────────────────────── */
  function storedLang() {
    try {
      const lang = localStorage.getItem('hec_lang');
      return lang === 'vi' || lang === 'en' ? lang : null;
    } catch (e) { return null; }
  }

  function remember(lang) {
    try {
      localStorage.setItem('hec_lang', lang);
      // Also set the old key for backward compat with course pages
      localStorage.setItem('language', lang === 'vi' ? 'vn' : 'en');
    } catch (e) { /* storage blocked: the choice is just not remembered */ }
  }

  function browserLang() {
    const nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
    return nav.toLowerCase().startsWith('vi') ? 'vi' : 'en';
  }

  // The language this URL is published in, or null if it follows the visitor.
  // index.html is the exception among bilingual pages: it is the site root,
  // where most visitors land, so Vietnamese visitors still see it in
  // Vietnamese. Crawlers have no saved choice and an English browser, so they
  // read English there and Vietnamese on index-vn.html.
  function pageLang() {
    const path = sitePath(location.href);
    if (!path || path === 'index.html' || !counterpart(path, 'en')) return null;
    return pathLang(path);
  }

  // The language on screen, as declared by <html lang>
  function currentLang() {
    return document.documentElement.lang.toLowerCase().startsWith('vi') ? 'vi' : 'en';
  }

  /* ── Same-language links ─────────────────────────────────── */
  // Rewrites links to bilingual pages so they open the `lang` version: the
  // shared navbar on index-vn.html points to index-vn.html#programs, and
  // courses/mars-vn.html links home to ../index-vn.html.
  function localizeLinks(lang) {
    const here = sitePath(location.href);
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      const path = sitePath(href);
      if (!path || path === here || pathLang(path) === lang) return;
      const target = counterpart(path, lang);
      if (!target) return;
      // Swap the file name only, keeping the link's directory, query and hash
      const [, dir = '', , rest] = href.match(/^([^?#]*\/)?([^/?#]*)(.*)$/);
      a.setAttribute('href', dir + target.slice(target.lastIndexOf('/') + 1) + rest);
    });
  }

  /* ── Apply translations ──────────────────────────────────── */
  function applyTranslations(lang) {
    lang = lang || currentLang();
    localizeLinks(lang);
    if (typeof HEC_TRANSLATIONS === 'undefined') return;

    // Text content
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const entry = HEC_TRANSLATIONS[key];
      if (entry && entry[lang]) {
        // Support newlines via \n → <br> only for specific elements
        if (el.tagName === 'H1' || el.tagName === 'H2' || el.tagName === 'P') {
          el.innerHTML = entry[lang].replace(/\n/g, '<br>');
        } else {
          el.textContent = entry[lang];
        }
      }
    });

    // Placeholders (inputs, textareas)
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const entry = HEC_TRANSLATIONS[key];
      if (entry && entry[lang]) {
        el.placeholder = entry[lang];
      }
    });

    // Meta tags (description, og:title, …)
    document.querySelectorAll('[data-i18n-content]').forEach(el => {
      const key = el.getAttribute('data-i18n-content');
      const entry = HEC_TRANSLATIONS[key];
      if (entry && entry[lang]) {
        el.setAttribute('content', entry[lang]);
      }
    });

    // Update <html lang> for SEO / screen readers
    document.documentElement.lang = lang === 'vi' ? 'vi' : 'en';

    // Update the toggle button to show the OTHER language
    const toggleBtns = document.querySelectorAll('.lang-toggle');
    toggleBtns.forEach(btn => {
      if (lang === 'en') {
        btn.innerHTML = '<span class="fi fi-vn"></span> VN';
      } else {
        btn.innerHTML = '<span class="fi fi-us"></span> EN';
      }
    });
  }

  /* ── Toggle ──────────────────────────────────────────────── */
  function toggleLanguage() {
    const next = currentLang() === 'en' ? 'vi' : 'en';
    remember(next);

    // On a bilingual page, open the other language's URL at the same section
    const path = sitePath(location.href);
    const target = path && pathLang(path) !== next && counterpart(path, next);
    if (target) {
      window.location.href = new URL(target, ROOT).href + window.location.hash;
    } else {
      applyTranslations(next);
    }
  }

  /* ── Init ─────────────────────────────────────────────────── */
  function init() {
    const lang = pageLang() || storedLang() || browserLang();
    remember(lang);
    applyTranslations(lang);
  }

  /* ── Public API ──────────────────────────────────────────── */
  return {
    init: init,
    toggle: toggleLanguage,
    getLang: currentLang,
    apply: applyTranslations
  };

})();

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', HEC_I18N.init);
} else {
  HEC_I18N.init();
}
