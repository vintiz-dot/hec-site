/*
 * language.js
 *
 * This script detects the user's preferred language, persists it in localStorage,
 * ensures that the correct language version of each page is displayed, and
 * provides helper functions for toggling languages. It should be loaded
 * before any other page scripts to allow immediate redirects.
 */
(function () {
  // Determine or recall the preferred language. Default to English unless
  // the browser language suggests Vietnamese. Persist the choice.
  let lang = localStorage.getItem('language');
  if (!lang) {
    const navLang = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
    lang = navLang.toLowerCase().startsWith('vi') ? 'vn' : 'en';
    localStorage.setItem('language', lang);
  }

  // Inspect the current file name to see if it ends with '-vn'. If the
  // language indicated by the file does not match the preferred language,
  // construct a new path to the correct file and redirect immediately.
  const path = window.location.pathname;
  const filename = path.substring(path.lastIndexOf('/') + 1);
  // Match base name, optional language suffix, and extension
  const match = filename.match(/^(.*?)(-vn)?(\.[^.]+)$/);
  if (match) {
    const base = match[1];
    const hasVnSuffix = !!match[2];
    const ext = match[3];
    const currentLang = hasVnSuffix ? 'vn' : 'en';
    if (currentLang !== lang) {
      const newName = lang === 'vn' ? `${base}-vn${ext}` : `${base}${ext}`;
      const newPath = path.replace(filename, newName);
      window.location.replace(newPath);
    }
  }
})();