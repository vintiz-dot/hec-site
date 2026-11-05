/* Language switch for the My Clothes Story pages. Vietnamese is the default.
   Loaded in <head> so the page never flashes the wrong language.
   A ?lang=en or ?lang=vi link wins over the choice saved on this device. */
(function () {
  "use strict";
  var KEY = "hec-clothes-lang";

  function saved() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function apply(lang) {
    var root = document.documentElement;
    root.setAttribute("data-lang", lang);
    root.setAttribute("lang", lang);
    var buttons = document.querySelectorAll("[data-set-lang]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-pressed", String(buttons[i].getAttribute("data-set-lang") === lang));
    }
  }

  var fromUrl = new URLSearchParams(location.search).get("lang");
  var start = fromUrl === "en" || fromUrl === "vi" ? fromUrl : saved() === "en" ? "en" : "vi";
  apply(start);

  document.addEventListener("DOMContentLoaded", function () {
    apply(document.documentElement.getAttribute("data-lang"));
    document.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-set-lang]") : null;
      if (!btn) return;
      var lang = btn.getAttribute("data-set-lang");
      apply(lang);
      try { localStorage.setItem(KEY, lang); } catch (err) { /* private window: the switch still works */ }
    });
  });
})();
