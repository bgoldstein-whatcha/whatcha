/* Whatcha Instagram feed (Behold JSON): 4 posts, videos autoplay muted, carousels rotate. */
(function () {
  var box = document.getElementById("ig-feed"), grid = document.getElementById("ig-grid");
  if (!box || !grid) return;
  var started = false;
  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function ok(u) { try { return new URL(u).protocol === "https:"; } catch (e) { return false; } }
  function igLink(u) { try { var x = new URL(u); return x.protocol === "https:" && /(^|\.)instagram\.com$/.test(x.hostname); } catch (e) { return false; } }
  function pick(sz) { var b = sz && (sz.medium || sz.large || sz.small); return b && ok(b.mediaUrl) ? b : null; }
  function mkImg(b, alt, eager) {
    var img = document.createElement("img");
    img.alt = alt; img.decoding = "async"; img.width = b.width || 4; img.height = b.height || 5;
    var sz = ["small", "medium", "large"];
    if (eager) img.src = b.mediaUrl; else img.setAttribute("data-src", b.mediaUrl);
    return img;
  }
  function tile(p) {
    if (!igLink(p.permalink)) return null;
    var cap = (p.prunedCaption || p.caption || "").replace(/\s+/g, " ").trim();
    var alt = cap ? cap.slice(0, 120) : "Whatcha Instagram post";
    var a = document.createElement("a");
    a.className = "wla-ig__tile"; a.href = p.permalink; a.target = "_blank"; a.rel = "noopener";
    a.setAttribute("aria-label", "Whatcha on Instagram" + (cap ? ": " + cap.slice(0, 100) : ""));
    var cover = pick(p.sizes);
    var slides = [];
    if (p.mediaType === "CAROUSEL_ALBUM" && p.children && p.children.length) {
      p.children.slice(0, 6).forEach(function (c) { var b = pick(c.sizes); if (b && c.mediaType !== "VIDEO") slides.push(b); });
    }
    if (slides.length < 2 && cover) slides = [cover];
    if (!slides.length) return null;
    slides.forEach(function (b, i) { var im = mkImg(b, i ? "" : alt, i === 0); im.className = "wla-ig__slide" + (i ? "" : " is-on"); a.appendChild(im); });
    a.__slides = a.querySelectorAll(".wla-ig__slide");
    if (slides.length > 1) {
      var dots = document.createElement("span"); dots.className = "wla-ig__dots"; dots.setAttribute("aria-hidden", "true");
      slides.forEach(function (_, i) { var d = document.createElement("i"); if (!i) d.className = "is-on"; dots.appendChild(d); });
      a.appendChild(dots); a.__dots = dots.children; a.__rotate = true;
    }
    if (p.mediaType === "VIDEO" && ok(p.mediaUrl) && !still) {
      var v = document.createElement("video");
      v.className = "wla-ig__video"; v.muted = true; v.defaultMuted = true; v.volume = 0; v.loop = true; v.playsInline = true;
      v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("aria-hidden", "true");
      v.preload = "none"; v.tabIndex = -1; v.setAttribute("data-src", p.mediaUrl);
      v.addEventListener("error", function () { if (v.parentNode) v.parentNode.removeChild(v); });
      a.appendChild(v); a.__video = v;
    }
    if (cap) { var c = document.createElement("span"); c.className = "wla-ig__cap"; c.textContent = cap; a.appendChild(c); }
    return a;
  }
  function animate(tiles) {
    var offset = 0;
    tiles.forEach(function (t) {
      var cur = 0, timer = null, loaded = false;
      function show(n) {
        var s = t.__slides; if (!s) return;
        s[cur].classList.remove("is-on"); if (t.__dots) t.__dots[cur].classList.remove("is-on");
        cur = n % s.length;
        s[cur].classList.add("is-on"); if (t.__dots) t.__dots[cur].classList.add("is-on");
      }
      function load() {
        if (loaded) return; loaded = true;
        Array.prototype.forEach.call(t.__slides, function (im) { var d = im.getAttribute("data-src"); if (d) { im.src = d; im.removeAttribute("data-src"); } });
        if (t.__video) { t.__video.src = t.__video.getAttribute("data-src"); }
      }
      function play() {
        if (still) return;
        if (t.__video) { t.__video.muted = true; t.__video.volume = 0; var pr = t.__video.play(); if (pr && pr.then) pr.then(function () { t.classList.add("is-playing"); }, function () {}); }
        if (t.__rotate && !timer) timer = setInterval(function () { show(cur + 1); }, 2600);
      }
      function pause() {
        if (t.__video) { t.__video.pause(); }
        if (timer) { clearInterval(timer); timer = null; }
      }
      if (!("IntersectionObserver" in window)) { load(); return; }
      var delay = (offset++) * 500;
      new IntersectionObserver(function (e) {
        if (e[0].isIntersecting) { load(); setTimeout(function () { if (e[0].target.__vis) play(); }, delay); e[0].target.__vis = true; }
        else { e[0].target.__vis = false; pause(); }
      }, { threshold: 0.35, rootMargin: "200px 0px" }).observe(t);
    });
  }
  function load() {
    if (started) return; started = true;
    fetch(box.getAttribute("data-feed")).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (d) {
      var tiles = (d.posts || []).slice(0, 4).map(tile).filter(Boolean);
      if (!tiles.length) throw 0;
      grid.textContent = "";
      tiles.forEach(function (t) { grid.appendChild(t); });
      animate(tiles);
    }).catch(function () { if (grid.parentNode) grid.parentNode.removeChild(grid); });
  }
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (e, o) { if (e[0].isIntersecting) { o.disconnect(); load(); } }, { rootMargin: "600px" }).observe(box);
  } else load();
})();
