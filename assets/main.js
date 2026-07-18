// Whatcha Drinking? — shared site behavior: age gate, mobile nav, forms.
(function () {
  var AGE_KEY = "whatcha_age_verified";

  // ════════════════════════════════════════════════
  //  Form delivery — each form on the site submits to its own Formspree
  //  endpoint (set via data-form-endpoint on the <form> itself), so
  //  submissions land in the right Formspree dashboard/inbox per form.
  // ════════════════════════════════════════════════

  function initAgeGate() {
    var gate = document.querySelector("[data-age-gate]");
    if (!gate) return;
    var verified = sessionStorage.getItem(AGE_KEY) === "true";
    if (verified) {
      gate.hidden = true;
      return;
    }
    document.body.style.overflow = "hidden";
    gate.querySelectorAll("[data-age-yes]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        sessionStorage.setItem(AGE_KEY, "true");
        gate.hidden = true;
        document.body.style.overflow = "";
      });
    });
    gate.querySelectorAll("[data-age-no]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        window.location.href = "https://www.responsibility.org/";
      });
    });
  }

  function initNavToggle() {
    var toggle = document.querySelector("[data-nav-toggle]");
    var links = document.querySelector("[data-nav-links]");
    if (!toggle || !links) return;
    toggle.addEventListener("click", function () {
      var open = links.getAttribute("data-open") === "true";
      links.setAttribute("data-open", String(!open));
      toggle.setAttribute("aria-expanded", String(!open));
    });
    links.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        links.setAttribute("data-open", "false");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  function initForms() {
    document.querySelectorAll("form[data-form]").forEach(function (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        // the status <p> isn't always a form descendant (it's a sibling on the
        // homepage signup form), so look within the form's parent, not the form itself
        var status = form.parentElement.querySelector("[data-form-status]");
        var submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
        if (status) status.textContent = "Sending…";

        var data = new FormData(form);
        data.append("_subject", "New " + (form.getAttribute("aria-label") || "Whatcha site") + " submission");

        fetch(form.getAttribute("data-form-endpoint"), {
          method: "POST",
          headers: { Accept: "application/json" },
          body: data
        }).then(function (res) {
          if (res.ok) {
            if (status) status.textContent = "Thanks — we've got it. We'll be in touch soon!";
            form.reset();
          } else {
            if (status) status.textContent = "Something went wrong — please email hello@whatchadrinking.com directly.";
          }
        }).catch(function () {
          if (status) status.textContent = "Something went wrong — please email hello@whatchadrinking.com directly.";
        }).finally(function () {
          if (submitBtn) submitBtn.disabled = false;
        });
      });
    });
  }

  function initPouchParallax() {
    var stage = document.querySelector("[data-parallax]");
    var pouches = stage && stage.querySelectorAll(".pouch");
    if (!stage || !pouches || !pouches.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(hover: none)").matches) return;

    var current = { x: 0, y: 0 };
    var target = { x: 0, y: 0 };
    var raf = null;

    function apply() {
      current.x += (target.x - current.x) * 0.08;
      current.y += (target.y - current.y) * 0.08;
      pouches.forEach(function (pouch, i) {
        var depth = i === 0 ? 1 : 1.15;
        pouch.style.setProperty("--tilt-x", (current.x * 1.75 * depth).toFixed(2) + "deg");
        pouch.style.setProperty("--tilt-x-px", (current.x * 3 * depth).toFixed(1) + "px");
        pouch.style.setProperty("--tilt-y", (current.y * -4 * depth).toFixed(1) + "px");
      });
      if (Math.abs(target.x - current.x) > 0.001 || Math.abs(target.y - current.y) > 0.001) {
        raf = requestAnimationFrame(apply);
      } else {
        raf = null;
      }
    }

    function startLoop() {
      if (!raf) raf = requestAnimationFrame(apply);
    }

    stage.addEventListener("mousemove", function (e) {
      var rect = stage.getBoundingClientRect();
      target.x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      target.y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      startLoop();
    });
    stage.addEventListener("mouseleave", function () {
      target.x = 0;
      target.y = 0;
      startLoop();
    });
  }

  function initLocatorMap() {
    var el = document.getElementById("locator-map");
    if (!el || typeof L === "undefined") return;
    var venue = [41.1744, -73.1887]; // Hartford HealthCare Amphitheater, Bridgeport, CT
    var map = L.map(el, { scrollWheelZoom: false }).setView(venue, 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 18
    }).addTo(map);
    L.marker(venue).addTo(map).bindPopup("<strong>Hartford HealthCare Amphitheater</strong><br>Bridgeport, CT — launch venue").openPopup();
  }

  function initMarquee() {
    var track = document.querySelector("[data-marquee]");
    if (!track) return;
    var baseItems = Array.prototype.slice.call(track.children);
    if (!baseItems.length) return;
    var PX_PER_SECOND = 55; // fixed visual speed so it never looks "fast" or "slow" by accident

    function build() {
      // restart the animation cleanly so a rebuild never leaves it mid-cycle
      track.style.animation = "none";
      track.innerHTML = "";
      baseItems.forEach(function (item) { track.appendChild(item.cloneNode(true)); });
      var minWidth = Math.max(window.innerWidth, 1600) * 2.5;
      // repeat the base cycle until comfortably wider than any viewport
      var guard = 0;
      while (track.scrollWidth < minWidth && guard < 40) {
        baseItems.forEach(function (item) { track.appendChild(item.cloneNode(true)); });
        guard++;
      }
      // duplicate the whole block once more so translateX(-50%) is an exact,
      // seamless whole-cycle shift no matter how many repeats were needed
      var built = Array.prototype.slice.call(track.children);
      built.forEach(function (item) { track.appendChild(item.cloneNode(true)); });

      // duration scales with the actual content width so speed (px/sec) stays
      // constant no matter how wide the viewport or how many repeats it took
      var halfWidth = track.scrollWidth / 2;
      var duration = (halfWidth / PX_PER_SECOND).toFixed(2);
      // force reflow so the "none" above actually takes effect before re-enabling
      void track.offsetWidth;
      track.style.animation = "marquee " + duration + "s linear infinite";
    }

    build();
    var resizeTimer;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(build, 200);
    });
    // if the page is restored from bfcache (browser back/forward), rebuild so
    // the animation duration/content always matches the current layout
    window.addEventListener("pageshow", function (e) {
      if (e.persisted) build();
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initAgeGate();
    initNavToggle();
    initForms();
    initPouchParallax();
    initLocatorMap();
    initMarquee();
  });
})();
