/**
 * language.js — i18n Engine for HEC
 *
 * Responsibilities:
 *  1. Detect the user's preferred language from localStorage or navigator.language
 *  2. Apply translations to any element with a [data-i18n] attribute
 *  3. Handle placeholder translations for form inputs via [data-i18n-placeholder]
 *  4. Provide toggleLanguage() for the navbar switcher
 *  5. Redirect legacy -vn.html pages to the unified index.html
 *
 * This script should be loaded AFTER translations.js so that HEC_TRANSLATIONS
 * is available. Both are loaded at the end of <body> (not in <head>) so no
 * blocking redirect flicker occurs.
 */

const HEC_I18N = (function () {

  /* ── Determine language ──────────────────────────────────── */
  function detectLanguage() {
    let lang = localStorage.getItem('hec_lang');
    if (!lang) {
      const nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
      lang = nav.toLowerCase().startsWith('vi') ? 'vi' : 'en';
      localStorage.setItem('hec_lang', lang);
    }
    return lang;
  }

  /* ── Apply translations ──────────────────────────────────── */
  function applyTranslations(lang) {
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
    const current = localStorage.getItem('hec_lang') || 'en';
    const next = current === 'en' ? 'vi' : 'en';
    localStorage.setItem('hec_lang', next);
    // Also set the old key for backward compat with course pages
    localStorage.setItem('language', next === 'vi' ? 'vn' : 'en');
    
    // Redirect if we are on a dual-file course page
    const path = window.location.pathname;
    if (document.body.getAttribute('data-page') === 'course') {
      if (next === 'vi' && !path.endsWith('-vn.html')) {
        window.location.href = path.replace('.html', '-vn.html');
      } else if (next === 'en' && path.endsWith('-vn.html')) {
        window.location.href = path.replace('-vn.html', '.html');
      }
    } else {
      applyTranslations(next);
    }
  }

  /* ── Legacy redirect handler ─────────────────────────────── */
  // If someone lands on index-vn.html, redirect them to index.html
  // after storing the language preference
  function handleLegacyRedirect() {
    const path = window.location.pathname;
    const filename = path.substring(path.lastIndexOf('/') + 1);
    // Only redirect the index page; course pages still use dual-file
    if (filename === 'index-vn.html') {
      localStorage.setItem('hec_lang', 'vi');
      localStorage.setItem('language', 'vn');
      window.location.replace(path.replace('index-vn.html', 'index.html'));
      return true;
    }
    return false;
  }

  /* ── Init ─────────────────────────────────────────────────── */
  function init() {
    // Handle legacy redirects before anything else
    if (handleLegacyRedirect()) return;

    const lang = detectLanguage();
    // Sync the old key for backward compat with course pages
    localStorage.setItem('language', lang === 'vi' ? 'vn' : 'en');
    
    // Handle course page dual-file initial load routing
    const path = window.location.pathname;
    if (document.body.getAttribute('data-page') === 'course') {
      const isViUrl = path.endsWith('-vn.html');
      if (lang === 'vi' && !isViUrl) {
        window.location.replace(path.replace('.html', '-vn.html'));
        return;
      } else if (lang === 'en' && isViUrl) {
        window.location.replace(path.replace('-vn.html', '.html'));
        return;
      }
    }

    applyTranslations(lang);
  }

  /* ── Public API ──────────────────────────────────────────── */
  return {
    init: init,
    toggle: toggleLanguage,
    getLang: () => localStorage.getItem('hec_lang') || 'en',
    apply: applyTranslations
  };

})();

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', HEC_I18N.init);
} else {
  HEC_I18N.init();
}