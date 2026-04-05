/**
 * includes.js — Runtime utilities for HEC
 *
 * Responsibilities:
 *  1. Bind the language toggle to HEC_I18N.toggle()
 *  2. Scroll-reveal observer for .reveal elements
 *  3. Navbar scroll shadow
 *  4. Countdown timer for the scarcity section
 *  5. Copyright year
 */

document.addEventListener('DOMContentLoaded', () => {

  /* ── Load Partials ────────────────────────────────────────── */
  const loadPartials = async () => {
    const navPh = document.getElementById('nav-placeholder');
    const footPh = document.getElementById('footer-placeholder');

    if (navPh) {
      try {
        const response = await fetch('assets/partials/navbar.html');
        if (response.ok) navPh.innerHTML = await response.text();
      } catch (err) { console.error('Error loading navbar', err); }
    }

    if (footPh) {
      try {
        const response = await fetch('assets/partials/footer.html');
        if (response.ok) footPh.innerHTML = await response.text();
      } catch (err) { console.error('Error loading footer', err); }
    }
  };

  loadPartials().then(() => {
    /* ── Language toggle ──────────────────────────────────────── */
    document.querySelectorAll('.lang-toggle').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        if (typeof HEC_I18N !== 'undefined') {
          HEC_I18N.toggle();
        }
      });
    });

    // Make sure dynamically loaded data-i18n tags get processed immediately
    if (typeof HEC_I18N !== 'undefined') {
      HEC_I18N.apply();
    }
  });

  /* ── Scroll reveal ────────────────────────────────────────── */
  const revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    revealEls.forEach(el => observer.observe(el));
  } else {
    // Fallback: just show everything
    revealEls.forEach(el => el.classList.add('visible'));
  }

  /* ── Navbar scroll effect ─────────────────────────────────── */
  const navbar = document.querySelector('.navbar');
  if (navbar) {
    const onScroll = () => {
      navbar.classList.toggle('scrolled', window.scrollY > 30);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ── Countdown timer ──────────────────────────────────────── */
  const countdownEl = document.getElementById('countdown');
  if (countdownEl) {
    // Target: May 15, 2026 (configurable)
    const target = new Date('2026-05-15T23:59:59+07:00').getTime();

    function updateCountdown() {
      const now = Date.now();
      const diff = Math.max(0, target - now);

      const days    = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours   = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      const daysEl    = document.getElementById('cd-days');
      const hoursEl   = document.getElementById('cd-hours');
      const minutesEl = document.getElementById('cd-minutes');
      const secondsEl = document.getElementById('cd-seconds');

      if (daysEl)    daysEl.textContent = String(days).padStart(2, '0');
      if (hoursEl)   hoursEl.textContent = String(hours).padStart(2, '0');
      if (minutesEl) minutesEl.textContent = String(minutes).padStart(2, '0');
      if (secondsEl) secondsEl.textContent = String(seconds).padStart(2, '0');
    }

    updateCountdown();
    setInterval(updateCountdown, 1000);
  }

  /* ── Seat bar animation ───────────────────────────────────── */
  document.querySelectorAll('.seat-bar-fill').forEach(bar => {
    const pct = bar.getAttribute('data-fill');
    if (pct) {
      // Trigger after a brief delay for visual effect
      setTimeout(() => { bar.style.width = pct + '%'; }, 300);
    }
  });

  /* ── Copyright year ───────────────────────────────────────── */
  const yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  /* ── Smooth scroll for anchor links ───────────────────────── */
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Close mobile nav if open
        const navCollapse = document.getElementById('nav');
        if (navCollapse && navCollapse.classList.contains('show')) {
          const toggler = document.querySelector('.navbar-toggler');
          if (toggler) toggler.click();
        }
      }
    });
  });

});