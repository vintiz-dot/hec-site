/**
 * yt-lite.js — click-to-load YouTube for .yt-lite players.
 * The YouTube player (~1 MB of scripts) loads only when a visitor presses
 * play, so pages with several videos stay fast on phones.
 */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.yt-lite button[data-yt]');
  if (!btn) return;
  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube-nocookie.com/embed/${btn.dataset.yt}?autoplay=1&rel=0`;
  iframe.title = btn.getAttribute('aria-label') || 'YouTube video';
  iframe.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture';
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  btn.replaceWith(iframe);
});
