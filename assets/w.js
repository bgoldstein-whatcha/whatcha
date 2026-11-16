/* ============================================================
   Whatcha first-party analytics — browser beacon
   Sends pageviews, engagement, clicks, form submits and every gtag() event
   to /api/w (Vercel Edge), which adds IP + geo and stores it in Supabase.
   Shows up in Whatcha HQ → Website.

   Public API:  whatcha.track("event_name", { any: "props" })
                whatcha.identify("email@x.com", "Name")
   Skip your own visits (first-party AND Google Analytics): open any page with ?wa_ignore=1  (undo: ?wa_ignore=0)
   — logging into /dashboard on a device does this automatically.
   ============================================================ */
(function () {
  "use strict";
  var w = window, d = document, nav = navigator, loc = location;
  if (w.__whatchaWA) return;
  w.__whatchaWA = true;

  var ENDPOINT = "/api/w";
  var SESSION_MS = 30 * 60 * 1000;
  var PING_MS = 15000;
  var IDLE_MS = 60000;
  var MAX_PING_MS = 45 * 60 * 1000;

  // ---------- storage helpers (never throw) ----------
  function lsGet(k) { try { return w.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { w.localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { w.localStorage.removeItem(k); } catch (e) {} }

  var qs;
  try { qs = new URLSearchParams(loc.search); } catch (e) { qs = { get: function () { return null; } }; }
  if (qs.get("wa_ignore") === "1") lsSet("wa_ignore", "1");
  if (qs.get("wa_ignore") === "0") lsDel("wa_ignore");

  var noop = function () {};
  w.whatcha = { track: noop, identify: noop };
  try { if (w.top !== w.self) return; } catch (e) { return; }   // never count previews/embeds (e.g. the HQ heatmap frame)
  if (lsGet("wa_ignore") === "1") {
    // excluded device: also switch off Google Analytics for this browser (gtag.js loads after window load, so this lands first)
    w["ga-disable-G-2ZN64HZ3Q2"] = true;
    return;
  }
  if (/^\/dashboard(\/|$)/.test(loc.pathname)) return;

  function uuid() {
    try { if (w.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    var b = new Uint8Array(16);
    try { crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  function domainOf(u) {
    if (!u) return "";
    try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch (e) { return ""; }
  }
  function clip(s, n) { s = s == null ? "" : String(s); return s.length > n ? s.slice(0, n) : s; }

  var ownHost = loc.hostname.replace(/^www\./, "").toLowerCase();
  var now = Date.now();

  // ---------- visitor ----------
  var vid = lsGet("wa_vid");
  var newVisitor = false;
  if (!vid) { vid = uuid(); lsSet("wa_vid", vid); lsSet("wa_first", String(now)); newVisitor = true; }

  // ---------- campaign / referrer for this hit ----------
  var UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
  var CLICK_IDS = ["gclid", "gbraid", "wbraid", "dclid", "fbclid", "ttclid", "msclkid", "li_fat_id", "twclid", "epik", "sccid", "rdt_cid", "igshid", "mc_cid"];
  var hitUtm = {}, hasUtm = false;
  UTM.forEach(function (k) { var v = qs.get(k); if (v) { hitUtm[k] = clip(v, 200); hasUtm = true; } });
  // common shorthand: ?ref=xyz / ?src=xyz / ?source=xyz
  if (!hitUtm.utm_source) { var alt = qs.get("ref") || qs.get("src") || qs.get("source"); if (alt) { hitUtm.utm_source = clip(alt, 200); hasUtm = true; } }
  var clickType = "", clickId = "";
  for (var i = 0; i < CLICK_IDS.length; i++) { var cv = qs.get(CLICK_IDS[i]); if (cv) { clickType = CLICK_IDS[i]; clickId = clip(cv, 200); break; } }

  var referrer = d.referrer || "";
  var refDomain = domainOf(referrer);
  var external = refDomain && refDomain !== ownHost;

  // ---------- session ----------
  var sess = null;
  try { sess = JSON.parse(lsGet("wa_sess") || "null"); } catch (e) {}
  var startNew = !sess || !sess.id || (now - (sess.last || 0)) > SESSION_MS ||
    (hasUtm && (hitUtm.utm_source !== sess.utm_source || hitUtm.utm_campaign !== sess.utm_campaign)) ||
    (clickId && clickId !== sess.click_id) ||
    (external && refDomain !== sess.ref_domain);
  if (startNew) {
    var visits = (parseInt(lsGet("wa_visits") || "0", 10) || 0) + 1;
    lsSet("wa_visits", String(visits));
    sess = {
      id: uuid(), start: now, last: now, n: visits, pv: 0,
      referrer: external ? clip(referrer, 1000) : "",
      ref_domain: external ? refDomain : "",
      landing: loc.pathname,
      utm_source: hitUtm.utm_source || "", utm_medium: hitUtm.utm_medium || "", utm_campaign: hitUtm.utm_campaign || "",
      utm_term: hitUtm.utm_term || "", utm_content: hitUtm.utm_content || "",
      click_id_type: clickType, click_id: clickId,
    };
  }
  sess.pv = (sess.pv || 0) + 1;
  sess.last = now;
  lsSet("wa_sess", JSON.stringify(sess));

  // ---------- device context ----------
  function ctx() {
    var conn = nav.connection || nav.mozConnection || nav.webkitConnection;
    var scheme = "";
    try { scheme = w.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch (e) {}
    var tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
    return {
      lang: nav.language || "",
      languages: (nav.languages || []).slice(0, 5).join(","),
      screen: (w.screen ? screen.width + "x" + screen.height : ""),
      viewport: (w.innerWidth || 0) + "x" + (w.innerHeight || 0),
      dpr: w.devicePixelRatio || 1,
      tz: tz,
      connection: conn ? [conn.effectiveType, conn.type].filter(Boolean).join("/") : "",
      color_scheme: scheme,
    };
  }
  var clientBot = !!nav.webdriver || /HeadlessChrome|Lighthouse|PhantomJS|bot|crawl|spider/i.test(nav.userAgent || "");

  function base(kind) {
    var o = {
      k: kind, vid: vid, sid: sess.id, visit_num: sess.n,
      host: loc.hostname, path: loc.pathname, query: clip(loc.search, 1000), title: clip(d.title, 300),
      referrer: clip(referrer, 1000), ref_domain: refDomain,
      s_referrer: sess.referrer, s_ref_domain: sess.ref_domain, s_landing: sess.landing,
      utm_source: sess.utm_source, utm_medium: sess.utm_medium, utm_campaign: sess.utm_campaign,
      utm_term: sess.utm_term, utm_content: sess.utm_content,
      click_id_type: sess.click_id_type, click_id: sess.click_id,
      is_bot: clientBot,
    };
    var c = ctx();
    for (var k in c) o[k] = c[k];
    return o;
  }

  // ---------- transport ----------
  var queue = [];
  var flushTimer = null;
  function send(items) {
    if (!items.length) return;
    var body = JSON.stringify({ items: items });
    try {
      if (nav.sendBeacon && nav.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain" }))) return;
    } catch (e) {}
    try { fetch(ENDPOINT, { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "text/plain" } }); } catch (e) {}
  }
  function flush() { clearTimeout(flushTimer); flushTimer = null; var items = queue.splice(0, 30); send(items); if (queue.length) flush(); }
  function enqueue(item, immediate) {
    queue.push(item);
    if (immediate) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, 1500);
  }

  // ---------- pageview ----------
  var pvId = uuid();
  var pv = base("pageview");
  pv.id = pvId;
  pv.is_landing = sess.pv === 1;
  pv.props = { new_visitor: newVisitor, session_pv: sess.pv };
  if (w.performance && performance.getEntriesByType) {
    try {
      var navEntry = performance.getEntriesByType("navigation")[0];
      if (navEntry) pv.props.nav_type = navEntry.type;
    } catch (e) {}
  }
  enqueue(pv, true);

  // ---------- engagement + scroll ----------
  var engaged = 0, lastTick = Date.now(), lastActive = Date.now(), maxScroll = 0;
  var startedAt = Date.now();
  function visible() { return d.visibilityState === "visible"; }
  function tick() {
    var t = Date.now();
    if (visible() && t - lastActive < IDLE_MS) engaged += Math.min(t - lastTick, PING_MS + 5000);
    lastTick = t;
  }
  function measureScroll() {
    var el = d.documentElement, b = d.body;
    var h = Math.max(el.scrollHeight, b ? b.scrollHeight : 0) - (w.innerHeight || el.clientHeight);
    var y = w.pageYOffset || el.scrollTop || 0;
    var pct = h <= 0 ? 100 : Math.round((y / h) * 100);
    if (pct > maxScroll) maxScroll = Math.min(100, pct);
  }
  ["mousemove", "keydown", "scroll", "touchstart", "click", "wheel"].forEach(function (ev) {
    w.addEventListener(ev, function () { tick(); lastActive = Date.now(); if (ev === "scroll") measureScroll(); }, { passive: true, capture: true });
  });
  function ping(final) {
    tick();
    var item = { k: "ping", id: pvId, engaged_ms: engaged, scroll_pct: maxScroll };
    if (visible()) { sess.last = Date.now(); lsSet("wa_sess", JSON.stringify(sess)); }
    if (final) send([item]); else enqueue(item, true);
  }
  var pingTimer = setInterval(function () {
    if (Date.now() - startedAt > MAX_PING_MS) { clearInterval(pingTimer); return; }
    if (visible()) ping(false);
  }, PING_MS);
  d.addEventListener("visibilitychange", function () {
    if (visible()) { lastTick = Date.now(); lastActive = Date.now(); }
    else { flush(); ping(true); }
  });
  w.addEventListener("pagehide", function () { flush(); ping(true); });
  setTimeout(measureScroll, 1200);

  // ---------- custom events ----------
  function track(name, props, now) {
    if (!name) return;
    var e = base("event");
    e.id = uuid();
    e.pv_id = pvId;
    e.name = clip(name, 80);
    var p = {};
    if (props && typeof props === "object") {
      for (var k in props) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
        var v = props[k];
        if (v == null || typeof v === "function") continue;
        p[clip(k, 60)] = typeof v === "object" ? clip(JSON.stringify(v), 300) : (typeof v === "string" ? clip(v, 300) : v);
      }
    }
    e.props = p;
    enqueue(e, !!now);
  }
  function identify(email, name, source) {
    email = clip((email || "").trim().toLowerCase(), 200);
    name = clip((name || "").trim(), 200);
    if (!email && !name) return;
    enqueue({ k: "identify", vid: vid, email: email, name: name, source: clip(source || "", 80) }, true);
  }
  w.whatcha = { track: function (n, p) { track(n, p, true); }, identify: identify };

  // forward every gtag('event', …) the site already fires (age gate, forms, locator…)
  function wrapGtag() {
    var g = w.gtag;
    if (typeof g !== "function" || g.__wa) return;
    var wrapped = function () {
      try {
        if (arguments[0] === "event" && arguments[1]) {
          var nm = String(arguments[1]), pr = arguments[2] || {};
          // store locator: capture WHAT they searched — demand signal for where to sell
          if (nm === "store_locator_search") { var zi = d.getElementById("zip-input"); if (zi && zi.value) { pr = Object.assign({}, pr, { query: clip(zi.value.trim(), 40) }); } }
          track(nm, pr, nm === "age_gate_confirm" && pr && pr.result === "no");
        }
      } catch (e) {}
      return g.apply(this, arguments);
    };
    wrapped.__wa = true;
    w.gtag = wrapped;
  }
  wrapGtag();
  d.addEventListener("DOMContentLoaded", wrapGtag);

  // ---------- auto-tracked clicks ----------
  d.addEventListener("click", function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var a = t.closest("a[href]");
    var label = function (el) { return clip((el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim(), 80); };
    if (a) {
      var href = a.getAttribute("href") || "";
      if (/^mailto:/i.test(href)) return track("email_click", { to: href.replace(/^mailto:/i, "").split("?")[0], text: label(a) }, true);
      if (/^tel:/i.test(href)) return track("phone_click", { to: href.replace(/^tel:/i, ""), text: label(a) }, true);
      var dom = domainOf(a.href);
      if (dom && dom !== ownHost) return track("outbound_click", { url: clip(a.href, 300), domain: dom, text: label(a) }, true);
      if (/\.(pdf|zip|png|jpe?g|svg|ai|eps|mp4|mov)(\?|$)/i.test(href)) return track("download", { file: clip(href, 300), text: label(a) }, true);
      if (a.classList.contains("btn") || a.closest(".btn")) return track("cta_click", { text: label(a), href: clip(href, 300) });
      return;
    }
    var btn = t.closest("button, [role=button]");
    if (btn && !btn.closest("form")) track("button_click", { text: label(btn) });
  }, true);

  // ---------- forms: conversion + who they are ----------
  d.addEventListener("submit", function (ev) {
    var f = ev.target;
    if (!f || f.tagName !== "FORM") return;
    var formName = f.getAttribute("aria-label") || f.id || f.getAttribute("name") || "form";
    var email = "", name = "", first = "", last = "";
    Array.prototype.forEach.call(f.querySelectorAll("input"), function (inp) {
      var type = (inp.type || "").toLowerCase();
      if (type === "password" || type === "hidden") return;
      var hint = [inp.name, inp.id, inp.autocomplete, inp.placeholder, inp.getAttribute("aria-label")].join(" ").toLowerCase();
      var lab = inp.id && d.querySelector('label[for="' + inp.id + '"]');
      if (lab) hint += " " + lab.textContent.toLowerCase();
      var v = (inp.value || "").trim();
      if (!v) return;
      if (!email && (type === "email" || /e-?mail/.test(hint)) && /@/.test(v)) email = v;
      else if (/first/.test(hint) && /name/.test(hint)) first = v;
      else if (/last/.test(hint) && /name/.test(hint)) last = v;
      else if (!name && /name/.test(hint) && !/company|business|store|venue/.test(hint)) name = v;
    });
    if (!name && (first || last)) name = (first + " " + last).trim();
    track("form_submit", { form: formName, form_id: f.id || "", has_email: !!email });
    if (email || name) identify(email, name, formName);
    flush();
  }, true);

  // ---------- rage clicks (3+ clicks on the same spot within 1s = frustration) ----------
  var clicks = [];
  d.addEventListener("click", function (ev) {
    var t = Date.now();
    clicks = clicks.filter(function (c) { return t - c.t < 1000; });
    clicks.push({ t: t, x: ev.clientX, y: ev.clientY });
    var near = clicks.filter(function (c) { return Math.abs(c.x - ev.clientX) < 30 && Math.abs(c.y - ev.clientY) < 30; });
    if (near.length === 3) {
      var el = ev.target;
      track("rage_click", { text: clip(((el && (el.getAttribute && el.getAttribute("aria-label"))) || (el && el.textContent) || "").replace(/\s+/g, " ").trim(), 80), tag: el && el.tagName ? el.tagName.toLowerCase() : "" });
    }
  }, true);

  // ---------- JavaScript errors on the site (max 5 per page) ----------
  var errCount = 0;
  w.addEventListener("error", function (e) {
    if (errCount >= 5 || !e || !e.message) return;
    errCount++;
    track("js_error", { message: clip(e.message, 200), source: clip((e.filename || "").replace(loc.origin, "").split("?")[0], 150), line: e.lineno || 0 });
  });

  // ---------- page speed (Core Web Vitals), sent once when the page is left ----------
  var vit = {};
  try {
    var navT = performance.getEntriesByType("navigation")[0];
    if (navT) { vit.ttfb = Math.round(navT.responseStart); }
    var po = function (type, cb) { try { new PerformanceObserver(function (l) { l.getEntries().forEach(cb); }).observe({ type: type, buffered: true }); } catch (e) {} };
    po("largest-contentful-paint", function (en) { vit.lcp = Math.round(en.startTime); });
    po("layout-shift", function (en) { if (!en.hadRecentInput) vit.cls = Math.round(((vit.cls || 0) + en.value) * 1000) / 1000; });
    po("event", function (en) { if (en.interactionId && (!vit.inp || en.duration > vit.inp)) vit.inp = Math.round(en.duration); });
    po("first-input", function (en) { if (!vit.inp) vit.inp = Math.round(en.processingStart - en.startTime); });
  } catch (e) {}
  var vitalsSent = false;
  function sendVitals() {
    if (vitalsSent) return;
    try { var n2 = performance.getEntriesByType("navigation")[0]; if (n2 && n2.loadEventEnd) vit.load = Math.round(n2.loadEventEnd); } catch (e) {}
    if (vit.lcp == null && vit.ttfb == null) return;
    vitalsSent = true;
    track("web_vitals", vit, true);
  }
  d.addEventListener("visibilitychange", function () { if (!visible()) sendVitals(); });
  w.addEventListener("pagehide", sendVitals);

  // ---------- heatmap data: where people click, hover and spend their time ----------
  // Positions are stored RELATIVE TO THE ELEMENT they were on (path of child indexes from <body> + % across/down
  // that element), so the dashboard can paint them onto the live page at any screen width. One compact
  // "heat" event per page view is sent when the visitor leaves (~1-3 KB).
  var heat = { sel: [], idx: {}, c: [], h: {}, a: {} };
  var heatLast = { x: -1, y: -1, t: 0 };
  function heatReset() { heat = { sel: [], idx: {}, c: [], h: {}, a: {} }; }
  function heatNode(el) {
    var chain = [], n = el;
    while (n && n !== d.body && n.parentElement) { chain.push(n); n = n.parentElement; }
    if (n !== d.body) return null;
    chain.reverse();
    if (chain.length > 8) chain.length = 8;
    var path = [], cur = d.body;
    for (var i = 0; i < chain.length; i++) {
      path.push(Array.prototype.indexOf.call(cur.children, chain[i]));
      cur = chain[i];
    }
    return { el: chain.length ? chain[chain.length - 1] : d.body, path: path.join(".") };
  }
  function heatSel(path) {
    if (heat.idx[path] == null) {
      if (heat.sel.length >= 40) return -1;
      heat.idx[path] = heat.sel.length; heat.sel.push(path);
    }
    return heat.idx[path];
  }
  function fracOf(el, x, y) {
    var r = el.getBoundingClientRect();
    var fx = r.width ? Math.round((x - r.left) / r.width * 100) : 50;
    var fy = r.height ? Math.round((y - r.top) / r.height * 100) : 50;
    return [Math.max(0, Math.min(100, fx)), Math.max(0, Math.min(100, fy))];
  }
  d.addEventListener("click", function (ev) {
    try {
      if (heat.c.length >= 30 || !ev.target || ev.target.nodeType !== 1) return;
      var nd = heatNode(ev.target); if (!nd) return;
      var si = heatSel(nd.path); if (si < 0) return;
      var f = fracOf(nd.el, ev.clientX, ev.clientY);
      heat.c.push([si, f[0], f[1]]);
    } catch (e) {}
  }, true);
  var canHover = false;
  try { canHover = w.matchMedia("(hover: hover)").matches; } catch (e) {}
  if (canHover) w.addEventListener("mousemove", function (ev) { heatLast.x = ev.clientX; heatLast.y = ev.clientY; heatLast.t = Date.now(); }, { passive: true, capture: true });
  var ATTN_SEL = "header, footer, section, main > *";
  setInterval(function () {
    try {
      if (!visible() || Date.now() - lastActive > IDLE_MS) return;
      var t = Date.now(), vh = w.innerHeight || 0;
      // hover: what the cursor is resting on (only while the mouse has moved in the last 8s)
      if (canHover && heatLast.x >= 0 && t - heatLast.t < 8000) {
        var under = d.elementFromPoint(heatLast.x, heatLast.y);
        if (under && under !== d.documentElement) {
          var nd = heatNode(under);
          if (nd) {
            var si = heatSel(nd.path);
            if (si >= 0) {
              var f = fracOf(nd.el, heatLast.x, heatLast.y);
              var key = si + "." + Math.min(9, Math.floor(f[0] / 10)) + "." + Math.min(9, Math.floor(f[1] / 10));
              if (heat.h[key] != null || Object.keys(heat.h).length < 60) heat.h[key] = (heat.h[key] || 0) + 1;
            }
          }
        }
      }
      // attention: which sections are on screen (at least half of the section, or half the screen, visible)
      var els = d.querySelectorAll(ATTN_SEL);
      for (var i = 0; i < els.length && i < 60; i++) {
        var r = els[i].getBoundingClientRect();
        if (r.height < 30) continue;
        var overlap = Math.min(r.bottom, vh) - Math.max(r.top, 0);
        if (overlap >= Math.min(r.height, vh) * 0.5) {
          var n2 = heatNode(els[i]); if (!n2 || n2.el !== els[i]) continue;
          var sj = heatSel(n2.path); if (sj < 0) continue;
          heat.a[sj] = (heat.a[sj] || 0) + 1; // 1 = half a second
        }
      }
    } catch (e) {}
  }, 500);
  function sendHeat() {
    try {
      var hh = Object.keys(heat.h).map(function (k) { var p = k.split("."); return [+p[0], +p[1], +p[2], heat.h[k]]; }).sort(function (a, b) { return b[3] - a[3]; }).slice(0, 50);
      var aa = Object.keys(heat.a).map(function (k) { return [+k, heat.a[k]]; }).filter(function (x) { return x[1] >= 2; });
      if (!heat.c.length && !hh.length && !aa.length) return;
      var de = d.documentElement, bd = d.body;
      var props = {
        v: 1, vw: w.innerWidth || 0,
        dw: Math.max(de.scrollWidth, bd ? bd.scrollWidth : 0),
        dh: Math.max(de.scrollHeight, bd ? bd.scrollHeight : 0),
        s: heat.sel, c: heat.c, h: hh, a: aa,
      };
      while (JSON.stringify(props).length > 3600 && (props.h.length > 5 || props.c.length > 5)) {
        if (props.h.length > 5) props.h.length = Math.ceil(props.h.length * 0.7); else props.c.length = Math.ceil(props.c.length * 0.7);
      }
      var e = base("event");
      e.id = uuid(); e.pv_id = pvId; e.name = "heat"; e.props = props;
      heatReset();
      send([e]);
    } catch (er) {}
  }
  d.addEventListener("visibilitychange", function () { if (!visible()) sendHeat(); });
  w.addEventListener("pagehide", sendHeat);

  // bfcache restore → count it as a new view
  w.addEventListener("pageshow", function (e) {
    if (!e.persisted) return;
    pvId = uuid();
    var again = base("pageview");
    again.id = pvId; again.is_landing = false; again.props = { bfcache: true };
    engaged = 0; maxScroll = 0; lastTick = Date.now(); startedAt = Date.now();
    enqueue(again, true);
  });
})();
