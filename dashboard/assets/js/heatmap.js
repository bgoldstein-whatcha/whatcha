/* ============================================================
   Whatcha HQ — Website heatmaps (Website → Heatmap tab)

   assets/w.js sends one small "heat" event per page view: where people
   clicked, where the cursor rested, and which sections stayed on screen —
   each position stored relative to the ELEMENT it was on. Here we load the
   real page into a frame (same origin as the dashboard), find those elements,
   and paint the data back on top, at desktop / tablet / phone widths.

   Layers: Clicks · Hover · Attention (time on screen) · Scroll depth
   ============================================================ */
(function () {
  if (typeof App === "undefined" || typeof WA === "undefined") return;
  const H = (s) => esc(s);
  const n0 = (n) => (n || 0).toLocaleString("en-US");

  const DEVICES = [
    { id: "desktop", label: "💻 Desktop", ref: 1280, test: (vw) => vw >= 1024 },
    { id: "tablet", label: "📲 Tablet", ref: 820, test: (vw) => vw >= 640 && vw < 1024 },
    { id: "mobile", label: "📱 Phone", ref: 390, test: (vw) => vw < 640 },
  ];
  const LAYERS = [
    { id: "clicks", label: "👆 Clicks", hint: "Every click or tap. Hot spots are where people press most." },
    { id: "hover", label: "🖱️ Hover", hint: "Where the cursor rested (desktop only) — a good proxy for what people read and consider." },
    { id: "attention", label: "⏱️ Time on screen", hint: "How long each section was actually on screen, per visit. Darker = more time." },
    { id: "scroll", label: "📜 Scroll depth", hint: "How far down people get. The page gets darker where fewer people reach." },
  ];
  const devOf = (vw) => (DEVICES.find((d) => d.test(vw)) || DEVICES[0]).id;

  const HM = (WA.hm = {
    page: null, device: null, layer: "clicks",
    pages: null, pagesKey: "",
    rows: [], rowsKey: "",
    loading: false, error: "",
    siteOrigin: "", // override for testing; blank = same origin as the dashboard
  });

  /* ---------------- data ---------------- */
  WA.heatRangeKey = function () { return this.range + "|" + (this.range === "custom" ? this.custom.from + "|" + this.custom.to : ""); };

  async function loadPages() {
    const key = WA.heatRangeKey();
    if (HM.pages && HM.pagesKey === key) return;
    const sb = WA.sb();
    const out = [];
    for (let from = 0; from < 60000; from += 1000) {
      let q = sb.from("wa_events").select("path,is_bot,props->>vw").eq("name", "heat").gte("ts", WA.since().toISOString());
      if (WA.range === "custom" && WA.custom.to) q = q.lte("ts", WA.until().toISOString());
      const { data, error } = await q.order("ts", { ascending: false }).range(from, from + 999);
      if (error) throw error;
      out.push(...data);
      if (data.length < 1000) break;
    }
    const by = {};
    out.forEach((r) => {
      if (!WA.includeBots && r.is_bot) return;
      const p = r.path || "/";
      const o = by[p] || (by[p] = { path: p, n: 0, dev: { desktop: 0, tablet: 0, mobile: 0 } });
      o.n++; o.dev[devOf(+(r.vw || r["props->>vw"] || 1280))]++;
    });
    HM.pages = Object.values(by).sort((a, b) => b.n - a.n);
    HM.pagesKey = key;
  }

  async function loadRows() {
    const key = WA.heatRangeKey() + "|" + HM.page;
    if (HM.rowsKey === key) return;
    const sb = WA.sb();
    const out = [];
    for (let from = 0; from < 3000; from += 500) {
      let q = sb.from("wa_events").select("props,is_bot,ts").eq("name", "heat").eq("path", HM.page).gte("ts", WA.since().toISOString());
      if (WA.range === "custom" && WA.custom.to) q = q.lte("ts", WA.until().toISOString());
      const { data, error } = await q.order("ts", { ascending: false }).range(from, from + 499);
      if (error) throw error;
      out.push(...data);
      if (data.length < 500) break;
    }
    HM.rows = out.filter((r) => (WA.includeBots || !r.is_bot) && r.props && r.props.v === 1);
    HM.rowsKey = key;
  }

  /* ---------------- tab shell ---------------- */
  WA.heatPane = function () {
    return `<div class="hm" id="hm-root"><div class="t-empty" style="padding:30px">Loading heatmap data…</div></div>`;
  };
  WA.heatPost = async function () {
    const root = $("#hm-root"); if (!root) return;
    try {
      HM.error = "";
      await loadPages();
      if (!HM.pages.length) {
        root.innerHTML = `<div class="panel"><h3 style="margin-bottom:6px">No heatmap data yet</h3><p class="muted" style="margin:0">Click, hover and time-on-screen data is collected from real visitors (not you) starting with the latest website update. Once people browse the site it'll fill in here. Try a wider date range if you expected data.</p></div>`;
        return;
      }
      if (!HM.page || !HM.pages.find((p) => p.path === HM.page)) HM.page = HM.pages[0].path;
      await loadRows();
      const pg = HM.pages.find((p) => p.path === HM.page);
      if (!HM.device || !pg.dev[HM.device]) HM.device = DEVICES.map((d) => d.id).sort((a, b) => pg.dev[b] - pg.dev[a])[0];
      renderShell(root);
      await drawStage();
    } catch (e) {
      const m = (e && e.message) || String(e);
      root.innerHTML = `<div class="panel"><h3 style="margin-bottom:6px">Couldn't load the heatmap</h3><p class="muted" style="margin:0">${H(m)}</p></div>`;
    }
  };
  WA.heatSet = function (k, v) {
    HM[k] = v;
    if (k === "page") { HM.rowsKey = ""; HM.device = null; }
    this.heatPost();
  };

  function renderShell(root) {
    const pg = HM.pages.find((p) => p.path === HM.page);
    const lay = LAYERS.find((l) => l.id === HM.layer);
    root.innerHTML = `
      <div class="hm-bar">
        <label class="hm-pick"><span>Page</span>
          <select onchange="WA.heatSet('page', this.value)">${HM.pages.map((p) => `<option value="${H(p.path)}" ${p.path === HM.page ? "selected" : ""}>${H(p.path)} — ${n0(p.n)} view${p.n === 1 ? "" : "s"}</option>`).join("")}</select>
        </label>
        <div class="hm-pills" role="group" aria-label="Screen size">${DEVICES.map((d) => `<button class="${d.id === HM.device ? "on" : ""}" ${pg.dev[d.id] ? "" : "disabled"} onclick="WA.heatSet('device','${d.id}')">${d.label}<small>${n0(pg.dev[d.id])}</small></button>`).join("")}</div>
      </div>
      <div class="hm-pills hm-layers" role="group" aria-label="Heatmap layer">${LAYERS.map((l) => `<button class="${l.id === HM.layer ? "on" : ""}" onclick="WA.heatSet('layer','${l.id}')">${l.label}</button>`).join("")}</div>
      <p class="muted hm-hint">${H(lay.hint)}</p>
      <div class="hm-wrap">
        <div class="hm-stagebox" id="hm-box"><div class="t-empty" id="hm-loading" style="padding:30px">Loading the page…</div></div>
        <aside class="hm-side" id="hm-side"></aside>
      </div>`;
  }

  /* ---------------- stage: live page + canvas ---------------- */
  function resolve(doc, path) {
    let el = doc.body;
    if (path === "" || path == null) return el;
    for (const i of String(path).split(".")) {
      el = el && el.children[+i];
      if (!el) return null;
    }
    return el;
  }
  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  function labelOf(el) {
    if (!el) return "(removed element)";
    const act = el.closest && el.closest("a,button,[role=button]");
    const clean = (t) => (t || "").replace(/\s+/g, " ").trim();
    if (act) return clean(act.getAttribute("aria-label") || act.textContent).slice(0, 48) || (act.tagName === "A" ? "link" : "button");
    const img = el.tagName === "IMG" ? el : el.querySelector && el.querySelector("img[alt]");
    if (el.tagName === "IMG") return "image: " + (clean(el.alt).slice(0, 40) || "(no alt)");
    const hd = el.querySelector && el.querySelector("h1,h2,h3");
    if (hd) return "section: " + clean(hd.textContent).slice(0, 44);
    const t = clean(el.textContent).slice(0, 44);
    if (t) return t;
    return (el.tagName || "").toLowerCase() + (img ? " (image)" : "");
  }

  const PALETTE = (() => {
    const c = document.createElement("canvas"); c.width = 1; c.height = 256;
    const g = c.getContext("2d"), gr = g.createLinearGradient(0, 0, 0, 256);
    [[0, "rgba(5,38,197,0)"], [0.18, "rgba(5,38,197,0.55)"], [0.4, "rgba(39,186,173,0.8)"], [0.62, "rgba(255,232,8,0.88)"], [0.82, "rgba(243,120,71,0.93)"], [1, "rgba(214,30,60,0.97)"]].forEach(([o, col]) => gr.addColorStop(o, col));
    g.fillStyle = gr; g.fillRect(0, 0, 1, 256);
    return g.getImageData(0, 0, 1, 256).data;
  })();

  function paintHeat(canvas, W, H_, pts, radius) {
    const RES = 0.5, w = Math.max(1, Math.round(W * RES)), h = Math.max(1, Math.round(H_ * RES));
    canvas.width = w; canvas.height = h;
    canvas.style.width = W + "px"; canvas.style.height = H_ + "px";
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    if (!pts.length) return;
    const r = radius * RES;
    pts.forEach((p) => {
      const g = ctx.createRadialGradient(p.x * RES, p.y * RES, 0, p.x * RES, p.y * RES, r);
      const a = Math.min(1, p.w * 0.22);
      g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.fillRect(p.x * RES - r, p.y * RES - r, r * 2, r * 2);
    });
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    let max = 1; for (let i = 3; i < d.length; i += 4) if (d[i] > max) max = d[i];
    const scale = 255 / Math.max(max, 60); // never over-amplify a single faint touch
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3]; if (!a) continue;
      const k = Math.min(255, Math.round(a * scale)) * 4;
      d[i] = PALETTE[k]; d[i + 1] = PALETTE[k + 1]; d[i + 2] = PALETTE[k + 2]; d[i + 3] = PALETTE[k + 3];
    }
    ctx.putImageData(img, 0, 0);
  }

  let _frameToken = 0;
  async function drawStage() {
    const box = $("#hm-box"); if (!box) return;
    const token = ++_frameToken;
    const dev = DEVICES.find((d) => d.id === HM.device);
    const rows = HM.rows.filter((r) => devOf(+r.props.vw || 1280) === HM.device);
    const refW = dev.ref;
    const availW = Math.max(280, box.clientWidth - 2);
    const scale = Math.min(1, availW / refW);

    // the real page, at this screen size
    const frame = document.createElement("iframe");
    frame.className = "hm-frame";
    frame.setAttribute("tabindex", "-1");
    frame.setAttribute("aria-label", "Page preview");
    frame.style.width = refW + "px"; frame.style.height = "1400px";
    const url = (HM.siteOrigin || location.origin) + HM.page + (HM.page.includes("?") ? "&" : "?") + "wa_heat=1";
    const loaded = new Promise((res) => { frame.onload = () => res(true); frame.onerror = () => res(false); setTimeout(() => res(false), 15000); });
    const holder = document.createElement("div");
    holder.className = "hm-holder";
    holder.style.width = refW * scale + "px";
    holder.innerHTML = `<div class="hm-scaler" style="width:${refW}px;transform:scale(${scale});transform-origin:0 0"></div>`;
    const scaler = holder.firstChild;
    scaler.appendChild(frame);
    frame.src = url; // set BEFORE inserting, so the only load event is the real page (not about:blank)
    box.innerHTML = ""; box.appendChild(holder);
    const ok = await loaded;
    if (token !== _frameToken) return;
    let doc = null;
    try { doc = frame.contentDocument; if (!doc || !doc.body) doc = null; } catch (e) { doc = null; }
    if (!ok || !doc) {
      box.innerHTML = `<div class="panel"><h3 style="margin-bottom:6px">Can't preview this page here</h3><p class="muted" style="margin:0">The page preview only works from the live dashboard at whatchadrinking.com/dashboard.</p></div>`;
      return;
    }

    // hide the age gate / popups and let the page lay out at full height
    const st = doc.createElement("style");
    st.textContent = "[data-age-gate],.age-gate,#cookie-banner{display:none!important} html,body{overflow:visible!important;height:auto!important} *{animation-play-state:paused!important;scroll-behavior:auto!important} .locator-hq-login,.locator-back{display:none!important}";
    doc.head.appendChild(st);
    doc.querySelectorAll("img[loading=lazy]").forEach((i) => { i.loading = "eager"; });
    const measure = () => Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
    // wait for the page to finish laying out (images, fonts, scripts) — height stops changing
    let last = -1, same = 0;
    for (let i = 0; i < 30 && same < 3; i++) {
      const m = measure();
      frame.style.height = Math.max(m, 800) + "px";
      same = m === last && m > 600 ? same + 1 : 0;
      last = m;
      await new Promise((r) => setTimeout(r, 400));
      if (token !== _frameToken) return;
    }
    const sizeTo = () => { const m = Math.max(measure(), 400); frame.style.height = m + "px"; holder.style.height = m * scale + "px"; return m; };
    let docH = sizeTo();

    const canvas = document.createElement("canvas");
    canvas.className = "hm-canvas";
    scaler.appendChild(canvas);
    const overlay = document.createElement("div");
    overlay.className = "hm-overlay";
    scaler.appendChild(overlay);

    const paint = () => { drawLayer(doc, canvas, overlay, refW, docH, rows, scale); renderSide(doc, rows, overlay); };
    paint();
    // if the page grows/shrinks after this (late images, fonts), re-fit and repaint
    try {
      let t = null;
      const ro = new frame.contentWindow.ResizeObserver(() => {
        clearTimeout(t);
        t = setTimeout(() => { if (token !== _frameToken) { ro.disconnect(); return; } const m = Math.max(measure(), 400); if (Math.abs(m - docH) > 8) { docH = sizeTo(); paint(); } }, 400);
      });
      ro.observe(doc.body);
    } catch (e) {}
  }

  // Where a stored [fx,fy] inside element `path` lands on this render of the page
  function place(doc, path, fx, fy, cache) {
    let r = cache[path];
    if (r === undefined) { const el = resolve(doc, path); r = cache[path] = el ? Object.assign({ el }, rectOf(el)) : null; }
    if (!r || !r.w || !r.h) return null;
    return { x: r.x + (fx / 100) * r.w, y: r.y + (fy / 100) * r.h };
  }

  function drawLayer(doc, canvas, overlay, W, Hh, rows, scale) {
    overlay.innerHTML = "";
    canvas.style.display = "";
    const cache = {};
    const mobile = HM.device === "mobile";
    if (HM.layer === "clicks" || HM.layer === "hover") {
      const pts = [];
      rows.forEach((r) => {
        const s = r.props.s || [];
        if (HM.layer === "clicks") (r.props.c || []).forEach(([si, fx, fy]) => { const p = place(doc, s[si], fx, fy, cache); if (p) pts.push({ x: p.x, y: p.y, w: 1 }); });
        else (r.props.h || []).forEach(([si, gx, gy, n]) => { const p = place(doc, s[si], gx * 10 + 5, gy * 10 + 5, cache); if (p) pts.push({ x: p.x, y: p.y, w: Math.min(3, n / 4) }); });
      });
      paintHeat(canvas, W, Hh, pts, HM.layer === "clicks" ? (mobile ? 34 : 48) : (mobile ? 50 : 80));
      if (!pts.length) overlay.innerHTML = `<div class="hm-none">${HM.layer === "hover" && mobile ? "Phones have no hover — switch to Clicks or Time on screen." : "No " + HM.layer + " data for this page and screen size yet."}</div>`;
    } else if (HM.layer === "attention") {
      canvas.style.display = "none";
      const tot = {}; let views = 0;
      rows.forEach((r) => { const s = r.props.s || []; let any = false; (r.props.a || []).forEach(([si, half]) => { tot[s[si]] = (tot[s[si]] || 0) + half / 2; any = true; }); if (any) views++; });
      const list = Object.keys(tot).map((p) => { const el = resolve(doc, p); return el ? { p, el, rect: rectOf(el), avg: tot[p] / Math.max(1, views) } : null; }).filter((x) => x && x.rect.h > 20)
        // nested sections: keep the smallest elements that carry the signal, but drop ones that wrap another listed element
        .filter((x, _, all) => !all.some((o) => o !== x && x.el.contains(o.el)));
      const max = Math.max(0.1, ...list.map((x) => x.avg / (x.rect.h / 800))); // seconds per screenful, so tall sections don't win just by being tall
      list.forEach((x) => {
        const k = Math.min(1, (x.avg / (x.rect.h / 800)) / max);
        const i = Math.round(k * 255) * 4;
        const d = document.createElement("div");
        d.className = "hm-band";
        d.style.cssText = `left:${x.rect.x}px;top:${x.rect.y}px;width:${x.rect.w}px;height:${x.rect.h}px;background:rgba(${PALETTE[i]},${PALETTE[i + 1]},${PALETTE[i + 2]},${0.18 + 0.5 * k})`;
        d.innerHTML = `<span>${x.avg.toFixed(1)}s per visit</span>`;
        overlay.appendChild(d);
      });
      if (!list.length) overlay.innerHTML = `<div class="hm-none">No time-on-screen data for this page and screen size yet.</div>`;
    } else if (HM.layer === "scroll") {
      canvas.style.display = "none";
      const pv = (WA.rows || []).filter((r) => r.kind === "pageview" && !r._refresh && r.path === HM.page && (WA.includeBots || !r.is_bot) && devOf(+(String(r.viewport || "1280x0").split("x")[0]) || 1280) === HM.device);
      if (!pv.length) { overlay.innerHTML = `<div class="hm-none">No page views recorded for this page and screen size in this range.</div>`; return; }
      const vh = HM.device === "mobile" ? 760 : HM.device === "tablet" ? 900 : 760;
      const reach = (yPx) => { // share of visits whose scroll reached this depth
        const f = Math.max(0, Math.min(1, (yPx - vh) / Math.max(1, Hh - vh)));
        return pv.filter((r) => (r.scroll_pct || 0) >= f * 100 - 0.5).length / pv.length;
      };
      const STEP = 40;
      for (let y = 0; y < Hh; y += STEP) {
        const k = reach(y + STEP / 2);
        const i = Math.round((1 - k) * 255) * 4;
        const d = document.createElement("div");
        d.className = "hm-band hm-band--thin";
        d.style.cssText = `left:0;top:${y}px;width:${W}px;height:${STEP}px;background:rgba(${PALETTE[i]},${PALETTE[i + 1]},${PALETTE[i + 2]},${0.12 + 0.4 * (1 - k)})`;
        overlay.appendChild(d);
      }
      [25, 50, 75, 90].forEach((pc) => {
        const y = vh + (Hh - vh) * (pc / 100);
        const share = Math.round(pv.filter((r) => (r.scroll_pct || 0) >= pc).length / pv.length * 100);
        const d = document.createElement("div");
        d.className = "hm-line";
        d.style.top = y + "px";
        d.innerHTML = `<span>${share}% of visitors scroll this far</span>`;
        overlay.appendChild(d);
      });
    }
  }

  /* ---------------- side panel: ranked lists + insights ---------------- */
  function renderSide(doc, rows, overlay) {
    const side = $("#hm-side"); if (!side) return;
    const cache = {};
    const views = rows.length;
    // clicks grouped by the link/button (or element) they landed on
    const byEl = new Map(); let totalClicks = 0;
    rows.forEach((r) => (r.props.c || []).forEach(([si]) => {
      const el = resolve(doc, (r.props.s || [])[si]);
      const key = el ? (el.closest("a,button,[role=button]") || el) : null;
      totalClicks++;
      byEl.set(key, (byEl.get(key) || 0) + 1);
    }));
    const ranked = [...byEl.entries()].map(([el, n]) => ({ el, n, label: labelOf(el) })).sort((a, b) => b.n - a.n);
    // time on screen by section
    const tot = {}; let aViews = 0;
    rows.forEach((r) => { const s = r.props.s || []; let any = false; (r.props.a || []).forEach(([si, half]) => { tot[s[si]] = (tot[s[si]] || 0) + half / 2; any = true; }); if (any) aViews++; });
    const secs = Object.keys(tot).map((p) => ({ el: resolve(doc, p), avg: tot[p] / Math.max(1, aViews) })).filter((x) => x.el && x.el.getBoundingClientRect().height > 60)
      .filter((x, _, all) => !all.some((o) => o !== x && x.el.contains(o.el))).sort((a, b) => b.avg - a.avg);
    // buttons / links nobody pressed
    const clicked = [...byEl.keys()].filter(Boolean);
    const ignored = [...doc.querySelectorAll("a.btn, button.btn, .btn")].filter((b) => {
      const r = b.getBoundingClientRect(); if (r.width < 20 || r.height < 14) return false;
      const cs = doc.defaultView.getComputedStyle(b); if (cs.display === "none" || cs.visibility === "hidden") return false;
      return !clicked.some((c) => c === b || b.contains(c) || c.contains(b));
    }).map((b) => labelOf(b)).filter((v, i, a) => a.indexOf(v) === i).slice(0, 6);

    const bar = (n, max) => `<span class="hm-bar-i"><i style="width:${Math.max(4, (n / Math.max(1, max)) * 100)}%"></i></span>`;
    const locate = (i, kind) => `onmouseenter="WA.heatHl(${i},'${kind}')" onmouseleave="WA.heatHl(-1)" onclick="WA.heatGo(${i},'${kind}')"`;
    window.__hmTargets = { c: ranked.map((x) => x.el), a: secs.map((x) => x.el) };
    side.innerHTML = `
      <div class="hm-kpis">
        <div><b>${n0(views)}</b><span>visits with data</span></div>
        <div><b>${n0(totalClicks)}</b><span>clicks &amp; taps</span></div>
        <div><b>${views ? (totalClicks / views).toFixed(1) : "0"}</b><span>clicks per visit</span></div>
      </div>
      <h4>Most clicked</h4>
      ${ranked.length ? `<div class="hm-list">${ranked.slice(0, 8).map((x, i) => `<div class="hm-row" ${locate(i, "c")}><div class="hm-row__t">${H(x.label)}</div><div class="hm-row__n">${n0(x.n)} <small>${Math.round((x.n / totalClicks) * 100)}%</small></div>${bar(x.n, ranked[0].n)}</div>`).join("")}</div>` : `<p class="muted hm-small">No clicks recorded yet.</p>`}
      <h4>Most time on screen</h4>
      ${secs.length ? `<div class="hm-list">${secs.slice(0, 6).map((x, i) => `<div class="hm-row" ${locate(i, "a")}><div class="hm-row__t">${H(labelOf(x.el))}</div><div class="hm-row__n">${x.avg.toFixed(1)}s</div>${bar(x.avg, secs[0].avg)}</div>`).join("")}</div>` : `<p class="muted hm-small">No time-on-screen data yet.</p>`}
      ${views >= 5 ? `<h4>Buttons nobody pressed</h4>${ignored.length ? `<ul class="hm-ign">${ignored.map((t) => `<li>${H(t)}</li>`).join("")}</ul>` : `<p class="muted hm-small">Every button on this page got at least one click.</p>`}` : `<p class="muted hm-small" style="margin-top:14px">Insights sharpen after about 5+ visits with data on a page.</p>`}
      <p class="muted hm-small" style="margin-top:14px">Positions are tied to the page's elements, so the picture stays accurate across screen sizes. If the site layout changes, older data may drift — narrow the date range to compare before and after.</p>`;
  }
  WA.heatHl = function (i, kind) {
    const ov = $(".hm-overlay"); if (!ov) return;
    ov.querySelectorAll(".hm-hl").forEach((n) => n.remove());
    if (i < 0) return;
    const el = (window.__hmTargets || {})[kind] && window.__hmTargets[kind][i]; if (!el) return;
    const r = el.getBoundingClientRect();
    const d = document.createElement("div"); d.className = "hm-hl";
    d.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    ov.appendChild(d);
  };
  WA.heatGo = function (i, kind) {
    const el = (window.__hmTargets || {})[kind] && window.__hmTargets[kind][i]; if (!el) return;
    const r = el.getBoundingClientRect(), box = $("#hm-box"); if (!box) return;
    const scale = box.querySelector(".hm-holder").clientWidth / box.querySelector(".hm-scaler").offsetWidth;
    const top = box.getBoundingClientRect().top + window.scrollY + r.top * scale - 90;
    const main = $(".main");
    if (main && main.scrollHeight > main.clientHeight) main.scrollTo({ top: main.scrollTop + (box.getBoundingClientRect().top + r.top * scale - 90), behavior: "smooth" });
    else window.scrollTo({ top, behavior: "smooth" });
  };
})();
