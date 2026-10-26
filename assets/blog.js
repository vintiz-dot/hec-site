/**
 * blog.js — HEC blog pages
 *  1. YouTube facade: the player (~1 MB of scripts) loads only when the
 *     reader clicks, so the article stays fast on phones.
 *  2. Copyright year.
 */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.yt button[data-yt]').forEach(btn => {
    btn.addEventListener('click', () => {
      const iframe = document.createElement('iframe');
      iframe.src = `https://www.youtube-nocookie.com/embed/${btn.dataset.yt}?autoplay=1&rel=0`;
      iframe.title = btn.getAttribute('aria-label') || 'YouTube video';
      iframe.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture';
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      btn.replaceWith(iframe);
    }, { once: true });
  });

  document.querySelectorAll('.js-year').forEach(el => { el.textContent = new Date().getFullYear(); });
});
