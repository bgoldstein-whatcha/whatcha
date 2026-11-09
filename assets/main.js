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

    // CSS default state is "closed" (opacity 0, card scaled down); add
    // is-open a frame after first paint so the browser actually renders
    // the closed state first and the materialize transition has something
    // to animate from, instead of jumping straight to open.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        gate.classList.add("is-open");
      });
    });

    function closeGate() {
      gate.classList.remove("is-open");
      document.body.style.overflow = "";
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        gate.hidden = true;
        gate.removeEventListener("transitionend", finish);
      }
      gate.addEventListener("transitionend", finish);
      // fallback in case the transition never fires (e.g. reduced motion
      // dropped it to an instant change, or the event is otherwise missed)
      setTimeout(finish, 400);
    }

    gate.querySelectorAll("[data-age-yes]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        sessionStorage.setItem(AGE_KEY, "true");
        closeGate();
        if (typeof gtag === "function") gtag("event", "age_gate_confirm", { result: "yes" });
      });
    });
    gate.querySelectorAll("[data-age-no]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (typeof gtag === "function") gtag("event", "age_gate_confirm", { result: "no" });
        window.location.href = "https://www.responsibility.org/";
      });
    });
  }

  function initNavToggle() {
    var toggle = document.querySelector("[data-nav-toggle]");
    var links = document.querySelector("[data-nav-links]");
    var scrim = document.querySelector("[data-nav-scrim]");
    if (!toggle || !links) return;

    function setOpen(open) {
      links.setAttribute("data-open", String(open));
      toggle.setAttribute("aria-expanded", String(open));
      if (scrim) scrim.setAttribute("data-open", String(open));
    }

    toggle.addEventListener("click", function () {
      setOpen(links.getAttribute("data-open") !== "true");
    });
    links.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () { setOpen(false); });
    });
    // dims the page, so tapping it should feel the same as tapping a nav link
    if (scrim) scrim.addEventListener("click", function () { setOpen(false); });
  }

  function initFaqAccordion() {
    document.querySelectorAll(".faq__item").forEach(function (item) {
      var summary = item.querySelector("summary");
      if (!summary) return;
      summary.addEventListener("click", function (e) {
        // only the close direction needs help — opening already animates
        // smoothly via the grid-template-rows transition in style.css
        if (!item.open || item.classList.contains("is-closing")) return;
        e.preventDefault();
        item.classList.add("is-closing");
        item.style.gridTemplateRows = "auto 0fr";
        var done = false;
        function finish() {
          if (done) return;
          done = true;
          item.open = false;
          item.classList.remove("is-closing");
          item.style.gridTemplateRows = "";
          item.removeEventListener("transitionend", finish);
        }
        item.addEventListener("transitionend", finish);
        setTimeout(finish, 400);
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
        // fades in on the same frame the text is set, rather than popping
        // into the layout — see .form-status.is-shown in style.css
        function setStatus(text) {
          if (!status) return;
          status.textContent = text;
          status.classList.remove("is-shown");
          requestAnimationFrame(function () {
            requestAnimationFrame(function () { status.classList.add("is-shown"); });
          });
        }
        setStatus("Sending…");

        // Google Forms submissions (data-form-google) POST straight to that
        // form's own /formResponse endpoint with entry.NNNNNNN field names.
        // That's cross-origin and Google doesn't send CORS headers back, so
        // the response is opaque — mode:"no-cors" is required just to avoid
        // the browser blocking the request outright, and it means we can't
        // actually read success/failure from the response. A resolved fetch
        // promise here only proves the request went out, not that Google
        // accepted it; a real network failure still rejects and hits catch.
        var isGoogleForm = form.hasAttribute("data-form-google");

        var body, headers;
        if (isGoogleForm) {
          body = new URLSearchParams(new FormData(form));
          headers = { "Content-Type": "application/x-www-form-urlencoded" };
        } else {
          body = new FormData(form);
          body.append("_subject", "New " + (form.getAttribute("aria-label") || "Whatcha site") + " submission");
          headers = { Accept: "application/json" };
        }

        fetch(form.getAttribute("data-form-endpoint"), {
          method: "POST",
          mode: isGoogleForm ? "no-cors" : "cors",
          headers: headers,
          body: body
        }).then(function (res) {
          if (isGoogleForm || res.ok) {
            setStatus("Thanks — we've got it. We'll be in touch soon!");
            if (typeof gtag === "function") {
              gtag("event", "form_submit_success", {
                form_id: form.id || null,
                form_name: form.getAttribute("aria-label") || "Whatcha site"
              });
            }
            form.reset();
          } else {
            setStatus("Something went wrong — please email hello@whatchadrinking.com directly.");
          }
        }).catch(function () {
          setStatus("Something went wrong — please email hello@whatchadrinking.com directly.");
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

  // Leaflet is only needed once the homepage map is close to the viewport, so
  // it's fetched on demand instead of blocking the first paint.
  function loadLeaflet(done) {
    if (window.L) { done(); return; }
    var css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/assets/vendor/leaflet/leaflet.css";
    document.head.appendChild(css);
    var js = document.createElement("script");
    js.src = "/assets/vendor/leaflet/leaflet.js";
    js.onload = done;
    document.head.appendChild(js);
  }

  function initLocatorMap() {
    var el = document.getElementById("locator-map");
    if (!el) return;
    var started = false;
    function start() {
      if (started) return;
      started = true;
      loadLeaflet(buildLocatorMap);
    }
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) { io.disconnect(); start(); }
      }, { rootMargin: "700px 0px" });
      io.observe(el);
    } else {
      start();
    }
  }

  // Same OpenFreeMap vector style as the full Find Whatcha map, so the homepage preview matches it.
  function loadScript(src, done) {
    var js = document.createElement("script");
    js.src = src; js.onload = function () { done(true); }; js.onerror = function () { done(false); };
    document.head.appendChild(js);
  }
  function addBasemap(map, done) {
    function fallback() {
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap contributors", maxZoom: 19 }).addTo(map);
      done();
    }
    var css = document.createElement("link");
    css.rel = "stylesheet"; css.href = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";
    document.head.appendChild(css);
    loadScript("https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js", function (ok) {
      if (!ok) return fallback();
      loadScript("https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.0.22/leaflet-maplibre-gl.js", function (ok2) {
        if (!ok2 || !L.maplibreGL) return fallback();
        try {
          L.maplibreGL({ style: "https://tiles.openfreemap.org/styles/liberty", attribution: '&copy; <a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
          done();
        } catch (e) { fallback(); }
      });
    });
  }

  function buildLocatorMap() {
    var el = document.getElementById("locator-map");
    if (!el || typeof L === "undefined") return;
    var map = L.map(el, { scrollWheelZoom: false });
    // framed on the Northeast until the live stores load; the "Where's Whatcha?" button leads to the full locator
    var DEFAULT = [[38.6, -79.8], [44.6, -69.0]];
    map.fitBounds(DEFAULT);
    addBasemap(map, function () {});
    // live stores: same public feed as the Find Whatcha page (name, address and coordinates of active stores only)
    var URL_ = "https://ivvoyzehxpdqtqmfsoxb.supabase.co/rest/v1/public_map_stores?select=name,address,lat,lng";
    var KEY = "sb_publishable_-_LLFYYSC5ctBmDL27gtdQ_P9343TDy";
    fetch(URL_, { headers: { apikey: KEY, Authorization: "Bearer " + KEY } })
      .then(function (r) { if (!r.ok) throw new Error("feed " + r.status); return r.json(); })
      .then(function (rows) {
        var pts = [];
        (rows || []).forEach(function (r) {
          if (r.lat == null || r.lng == null || !r.name) return;
          var icon = L.divIcon({ className: "", html: '<div class="locator__pin"></div>', iconSize: [34, 34], iconAnchor: [17, 34], popupAnchor: [0, -34] });
          var m = L.marker([r.lat, r.lng], { icon: icon, title: r.name }).addTo(map);
          var box = document.createElement("div");
          box.className = "store-popup";
          var h = document.createElement("h3"); h.textContent = r.name; box.appendChild(h);
          var pa = document.createElement("p"); pa.textContent = r.address || ""; box.appendChild(pa);
          var a = document.createElement("a"); a.href = "/store-locator"; a.textContent = "Find Whatcha near you →"; a.style.fontWeight = "700"; box.appendChild(a);
          m.bindPopup(box);
          pts.push([r.lat, r.lng]);
        });
        if (pts.length > 1) map.fitBounds(pts, { padding: [30, 30] });
        else if (pts.length === 1) map.setView(pts[0], 12);
      })
      .catch(function () { /* map stays on the generic Northeast view */ });
  }

  function initMarquee() {
    var tracks = document.querySelectorAll("[data-marquee]");
    if (!tracks.length) return;
    var PX_PER_SECOND = 34; // fixed visual speed so it never looks "fast" or "slow" by accident

    Array.prototype.forEach.call(tracks, function (track) {
      var baseItems = Array.prototype.slice.call(track.children);
      if (!baseItems.length) return;

      function build() {
        // restart the animation cleanly so a rebuild never leaves it mid-cycle
        track.style.animation = "none";
        track.innerHTML = "";
        baseItems.forEach(function (item) { track.appendChild(item.cloneNode(true)); });
        var minWidth = Math.max(window.innerWidth, 480) * 1.5; // kept modest: very wide animated layers flicker in iOS Safari
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
      var resizeTimer, lastWidth = window.innerWidth;
      window.addEventListener("resize", function () {
        // phones fire resize (height only) as the URL bar slides away while
        // scrolling; rebuilding then restarts the bar mid-scroll, so only
        // rebuild when the width actually changed (rotation / window resize)
        if (window.innerWidth === lastWidth) return;
        lastWidth = window.innerWidth;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(build, 200);
      });
      // if the page is restored from bfcache (browser back/forward), rebuild so
      // the animation duration/content always matches the current layout
      window.addEventListener("pageshow", function (e) {
        if (e.persisted) build();
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initAgeGate();
    initNavToggle();
    initFaqAccordion();
    initForms();
    initPouchParallax();
    initLocatorMap();
    initMarquee();
  });
})();
