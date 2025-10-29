document.addEventListener('DOMContentLoaded', async () => {
  const nodes = document.querySelectorAll('[data-include]');
  await Promise.all([...nodes].map(async el => {
    const src = el.getAttribute('data-include');
    try {
      const res = await fetch(src, {cache:'no-cache'});
      if (!res.ok) throw new Error(src);
      el.innerHTML = await res.text();
      if (src.includes('nav.html') && window.bootstrap) {
        document.querySelectorAll('[data-bs-toggle="dropdown"]').forEach(t => new bootstrap.Dropdown(t));
      }
    } catch (e) { el.outerHTML = `<!-- include failed: ${src} -->`; }
  }));
});



/*
 * includes.js
 *
 * This script controls the language toggle and updates the copyright year
 * in the footer. Navigation markup is embedded directly into each HTML
 * document so there is no need to fetch external partials. The
 * language toggle reads a stored preference from localStorage and
 * displays the opposite language (EN/VN) so users know which version
 * they can switch to. Clicking the toggle flips the preference and
 * redirects the user to the appropriate file (adding or removing the
 * `-vn` suffix as needed).
 */

// Set the toggle text based on the current language. The toggle always
// shows the target language (EN when viewing Vietnamese, VN when viewing
// English). If no language is stored, default to English.
function updateLangToggle() {
  const lang = localStorage.getItem('language') || 'en';
  const toggle = document.querySelector('.lang-toggle');
  if (toggle) {
    toggle.textContent = lang === 'en' ? 'VN' : 'EN';
  }
}

// Bind a click handler to the language toggle. When clicked, the handler
// flips the language preference in localStorage and navigates to the
// corresponding version of the current page. The page names follow the
// convention `<basename>.html` for English and `<basename>-vn.html` for
// Vietnamese. For example, clicking the toggle on `mars.html` will
// navigate to `mars-vn.html`, and vice versa.
function bindLangToggle() {
  const toggle = document.querySelector('.lang-toggle');
  if (!toggle) return;
  toggle.addEventListener('click', function (event) {
    event.preventDefault();
    const currentLang = localStorage.getItem('language') || 'en';
    const newLang = currentLang === 'en' ? 'vn' : 'en';
    localStorage.setItem('language', newLang);
    const path = window.location.pathname;
    const filename = path.substring(path.lastIndexOf('/') + 1);
    const match = filename.match(/^(.*?)(-vn)?(\.[^.]+)$/);
    if (match) {
      const base = match[1];
      const ext = match[3];
      const newName = newLang === 'vn' ? `${base}-vn${ext}` : `${base}${ext}`;
      const newPath = path.replace(filename, newName);
      window.location.replace(newPath);
    }
  });
}

// When the document is ready, update the language toggle text, bind the
// toggle click handler, and update the copyright year in the footer.
document.addEventListener('DOMContentLoaded', () => {
  updateLangToggle();
  bindLangToggle();
  const yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
});