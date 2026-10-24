/* ============================================================
   Whatcha HQ — Website analytics (first-party, replaces GA)
   Reads wa_events / wa_identities from Supabase (admin-only RLS).
   Plugs into App as a "Website" nav item without touching app.js.
   ============================================================ */
(function () {
  if (typeof App === "undefined") return;

  /* ---------------- helpers ---------------- */
  const H = (s) => esc(s);
  const n0 = (n) => (n || 0).toLocaleString("en-US");
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const dur = (ms) => {
    ms = Math.max(0, ms || 0);
    const s = Math.round(ms / 1000);
    if (s < 60) return s + "s";
    const m = Math.floor(s / 60), r = s % 60;
    if (m < 60) return m + "m " + String(r).padStart(2, "0") + "s";
    return Math.floor(m / 60) + "h " + (m % 60) + "m";
  };
  const ago = (iso) => {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 45) return "just now";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  };
  const when = (iso) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const flag = (cc) => (cc && /^[A-Z]{2}$/.test(cc)) ? String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0))) : "🌐";
  const COUNTRY = (() => { try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch (e) { return null; } })();
  const countryName = (cc) => { if (!cc) return "Unknown"; try { return (COUNTRY && COUNTRY.of(cc)) || cc; } catch (e) { return cc; } };
  const place = (r) => [r.city, r.region, r.country && r.country !== "US" ? countryName(r.country) : (r.country ? "" : "")].filter(Boolean).join(", ") || "Unknown location";
  const devIco = (d) => d === "mobile" ? "📱" : d === "tablet" ? "📲" : "💻";

  /* ---------------- channel classification ---------------- */
  const SOCIAL = /(^|\.)(instagram\.com|facebook\.com|fb\.com|fb\.me|messenger\.com|t\.co|x\.com|twitter\.com|tiktok\.com|linkedin\.com|lnkd\.in|reddit\.com|pinterest\.[a-z.]+|pin\.it|snapchat\.com|youtube\.com|youtu\.be|threads\.net|bsky\.app|discord\.com|whatsapp\.com|tumblr\.com|linktr\.ee|beacons\.ai)$/;
  const SOCIAL_SRC = /^(ig|insta|instagram|fb|facebook|meta|tiktok|tt|twitter|x|linkedin|li|reddit|pinterest|snapchat|snap|youtube|yt|threads|linktree|linkinbio|bio)$/;
  const SEARCH = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|yahoo\.com|ecosia\.org|search\.brave\.com|baidu\.com|yandex\.[a-z]+|startpage\.com|qwant\.com|aol\.com)$/;
  const AI = /(^|\.)(chatgpt\.com|chat\.openai\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|bard\.google\.com|copilot\.microsoft\.com|you\.com|poe\.com|meta\.ai|phind\.com|kagi\.com)$/;
  const EMAIL_D = /(^|\.)(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|mail\.yahoo\.com|mail\.aol\.com|klaviyo|mailchimp|list-manage\.com|substack\.com|beehiiv\.com)/;

  function channel(r) {
    const src = (r.utm_source || "").toLowerCase(), med = (r.utm_medium || "").toLowerCase();
    const d = (r.s_ref_domain || "").toLowerCase(), cid = r.click_id_type || "";
    const inApp = /\(in-app\)/.test(r.browser || "");
    const socialish = SOCIAL.test(d) || SOCIAL_SRC.test(src) || /instagram|facebook|tiktok|snap|linkedin|twitter|reddit|youtube|pinterest/.test(src);
    if (med === "qr" || /(^|[_-])qr([_-]|$)/.test(src) || src === "qr" || src === "pouch" || src === "packaging" || (!d && !src && /^\/whatchalookinat/.test(r.s_landing || ""))) return "QR / Pouch";
    if (/^(cpc|ppc|paid|paidsearch|paid_search|paid-search|sem)$/.test(med) || ["gclid", "gbraid", "wbraid", "msclkid", "dclid"].includes(cid)) return socialish ? "Paid Social" : "Paid Search";
    if (/paid|cpm|cpv|display|ads?$/.test(med) || ["ttclid", "twclid", "li_fat_id", "sccid", "rdt_cid", "epik"].includes(cid)) return socialish || cid ? "Paid Social" : "Display / Ads";
    if (/e-?mail|newsletter/.test(med) || /e-?mail|newsletter|klaviyo|mailchimp/.test(src) || EMAIL_D.test(d) || cid === "mc_cid") return "Email";
    if (/influencer|creator|ambassador|affiliate/.test(med + " " + src)) return "Influencer / Ambassador";
    if (/social|^sm$|story|reel|bio/.test(med) || socialish || (inApp && !d)) return "Social";
    if (AI.test(d) || /chatgpt|openai|perplexity|claude|gemini|copilot/.test(src)) return "AI Assistants";
    if (SEARCH.test(d)) return "Organic Search";
    if (d) return "Referral";
    if (src) return "Campaign (other)";
    return "Direct";
  }
  function sourceLabel(r) {
    if (r.utm_source) return r.utm_source;
    if (r.s_ref_domain) return r.s_ref_domain;
    if (/\(in-app\)/.test(r.browser || "")) return r.browser.replace(" (in-app)", "") + " app";
    if (/^\/whatchalookinat/.test(r.s_landing || "")) return "QR code (pouch)";
    return "(direct)";
  }
  const CH_COLORS = { "Direct": "#6b6b86", "Social": "#f37847", "Paid Social": "#d9622f", "Organic Search": "#0526c5", "Paid Search": "#041b8a", "Referral": "#27baad", "AI Assistants": "#9b5de5", "Email": "#e6cf00", "QR / Pouch": "#f47563", "Influencer / Ambassador": "#75d0f7", "Display / Ads": "#c8dfb8", "Campaign (other)": "#ffe808" };

  /* ---------------- state ---------------- */
  const RANGES = [
    { id: "today", label: "Today" }, { id: "24h", label: "24h" }, { id: "7d", label: "7 days" },
    { id: "30d", label: "30 days" }, { id: "90d", label: "90 days" }, { id: "365d", label: "12 months" },
  ];
  const FILTER_LABELS = { channel: "Channel", source: "Source", s_ref_domain: "Referrer", utm_source: "UTM source", utm_medium: "UTM medium", utm_campaign: "Campaign", utm_term: "UTM term", utm_content: "UTM content", click_id_type: "Ad click", country: "Country", region: "Region", city: "City", path: "Page", s_landing: "Landing page", device: "Device", browser: "Browser", os: "OS", org: "Network / Org", vid: "Visitor", lang: "Language", name: "Event" };

  const WA = {
    range: (() => { try { return localStorage.getItem("wa_dash_range") || "7d"; } catch (e) { return "7d"; } })(),
    filters: {},
    includeBots: false,
    rows: [],
    ids: {},
    loadedKey: "",
    loading: false,
    error: "",
    liveTimer: null,
    refreshTimer: null,
    map: null,
    liveMap: null,
    liveLayer: null,
    sessionsShown: 60,
    sessionSearch: "",
    agg: null,
  };
  window.WA = WA;

  WA.since = function () {
    const now = new Date();
    if (this.range === "today") { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; }
    const h = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30, "90d": 24 * 90, "365d": 24 * 365 }[this.range] || 24 * 7;
    return new Date(now.getTime() - h * 3600 * 1000);
  };
  WA.prevSince = function () { const s = this.since(); return new Date(s.getTime() - (Date.now() - s.getTime())); };

  /* ---------------- data ---------------- */
  WA.sb = function () { return window.WA_DEMO_CLIENT || App.sb; };

  WA.fetchAll = async function (fromIso) {
    const sb = this.sb();
    const out = [];
    const PAGE = 1000, CAP = 80000;
    for (let from = 0; from < CAP; from += PAGE) {
      const { data, error } = await sb.from("wa_events").select("*").gte("ts", fromIso).order("ts", { ascending: true }).range(from, from + PAGE - 1);
      if (error) throw error;
      out.push(...data);
      if (data.length < PAGE) break;
    }
    return out;
  };

  WA.load = async function (force) {
    const key = this.range;
    if (!force && this.loadedKey === key && this.rows.length) return;
    this.loading = true; this.error = "";
    try {
      // pull 2× the window so we can show change vs the previous period
      const rows = await this.fetchAll(this.prevSince().toISOString());
      const { data: ids, error: idErr } = await this.sb().from("wa_identities").select("*");
      if (idErr) throw idErr;
      rows.forEach((r) => { r.channel = channel(r); r.source = sourceLabel(r); r._t = new Date(r.ts).getTime(); });
      this.rows = rows;
      this.ids = {};
      (ids || []).forEach((i) => { this.ids[i.vid] = i; });
      this.loadedKey = key;
    } catch (e) {
      const m = (e && e.message) || String(e);
      this.error = /wa_events|schema cache|does not exist|PGRST205|relation/i.test(m)
        ? "Analytics tables aren't set up yet — run supabase-site-analytics.sql in Supabase → SQL Editor, then hit Refresh."
        : "Couldn't load website data: " + m;
      this.rows = [];
    }
    this.loading = false;
  };

  /* ---------------- aggregation ---------------- */
  WA.passes = function (r) {
    if (!this.includeBots && r.is_bot) return false;
    for (const k in this.filters) {
      const v = this.filters[k];
      const rv = k === "s_landing" ? r.s_landing : r[k];
      if (k === "name") { if (r.kind === "event" && r.name !== v) return false; continue; }
      if (String(rv == null || rv === "" ? "(none)" : rv) !== v) return false;
    }
    return true;
  };

  function summarize(rows) {
    const pvs = rows.filter((r) => r.kind === "pageview");
    const evs = rows.filter((r) => r.kind === "event");
    const sessions = new Map();
    for (const r of pvs) {
      let s = sessions.get(r.sid);
      if (!s) { s = { sid: r.sid, vid: r.vid, first: r, last: r, pvs: [], evs: [], engaged: 0, start: r._t, end: r._t }; sessions.set(r.sid, s); }
      s.pvs.push(r);
      s.engaged += r.engaged_ms || 0;
      if (r._t < s.start) { s.start = r._t; s.first = r; }
      const endT = new Date(r.last_seen).getTime();
      if (endT >= s.end) { s.end = endT; s.last = r; }
    }
    for (const e of evs) { const s = sessions.get(e.sid); if (s) s.evs.push(e); }
    const sess = [...sessions.values()];
    sess.forEach((s) => {
      s.landing = s.first.is_landing ? s.first : s.pvs.find((p) => p.is_landing) || s.first;
      s.bounce = s.pvs.length === 1 && s.engaged < 10000;
      s.converted = s.evs.some((e) => e.name === "form_submit" || e.name === "form_submit_success");
    });
    const visitors = new Set(pvs.map((r) => r.vid));
    const conv = sess.filter((s) => s.converted).length;
    const engagedTotal = sess.reduce((a, s) => a + s.engaged, 0);
    return {
      pvs, evs, sess,
      visitors: visitors.size,
      sessions: sess.length,
      pageviews: pvs.length,
      avgEngaged: sess.length ? engagedTotal / sess.length : 0,
      bounce: pct(sess.filter((s) => s.bounce).length, sess.length),
      pps: sess.length ? pvs.length / sess.length : 0,
      newVisitors: sess.filter((s) => (s.first.visit_num || 1) === 1).length,
      conversions: conv,
      convRate: sess.length ? (conv / sess.length) * 100 : 0,
    };
  }

  WA.aggregate = function () {
    const since = this.since().getTime(), prev = this.prevSince().getTime();
    const cur = [], old = [];
    for (const r of this.rows) {
      if (!this.passes(r)) continue;
      if (r._t >= since) cur.push(r); else if (r._t >= prev) old.push(r);
    }
    const A = summarize(cur);
    A.prev = summarize(old);
    this.agg = A;
    return A;
  };

  // generic group-by over sessions or pageviews
  function groupSessions(sess, keyFn) {
    const m = new Map();
    for (const s of sess) {
      const k = keyFn(s);
      const key = k == null || k === "" ? "(none)" : String(k);
      let g = m.get(key);
      if (!g) { g = { key, sessions: 0, visitors: new Set(), pageviews: 0, engaged: 0, bounces: 0, conv: 0, sample: s }; m.set(key, g); }
      g.sessions++; g.visitors.add(s.vid); g.pageviews += s.pvs.length; g.engaged += s.engaged; if (s.bounce) g.bounces++; if (s.converted) g.conv++;
    }
    return [...m.values()].map((g) => ({ ...g, visitors: g.visitors.size })).sort((a, b) => b.visitors - a.visitors || b.sessions - a.sessions);
  }
  function groupPageviews(pvs, keyFn) {
    const m = new Map();
    for (const r of pvs) {
      const key = keyFn(r) || "(none)";
      let g = m.get(key);
      if (!g) { g = { key, views: 0, visitors: new Set(), engaged: 0, scroll: 0, title: r.title }; m.set(key, g); }
      g.views++; g.visitors.add(r.vid); g.engaged += r.engaged_ms || 0; g.scroll += r.scroll_pct || 0;
    }
    return [...m.values()].map((g) => ({ ...g, visitors: g.visitors.size, avgEngaged: g.engaged / g.views, avgScroll: Math.round(g.scroll / g.views) })).sort((a, b) => b.views - a.views);
  }

  /* ---------------- rendering ---------------- */
  function delta(cur, prev, invert) {
    if (!prev) return cur ? `<span class="wa-up">new</span>` : `<span class="muted">—</span>`;
    const d = ((cur - prev) / prev) * 100;
    if (!isFinite(d)) return "";
    const good = invert ? d < 0 : d > 0;
    return `<span class="${Math.abs(d) < 0.5 ? "muted" : good ? "wa-up" : "wa-down"}">${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(0)}%</span>`;
  }
  function kpi(label, value, sub, cls = "") { return `<div class="kpi ${cls}"><div class="kpi__label">${label}</div><div class="kpi__value">${value}</div><div class="kpi__sub">${sub}</div></div>`; }

  // horizontal "share bar" table — every row clickable to filter
  function rankTable(rows, opts) {
    const { field, label, cols, max = 10, keyFmt, id } = opts;
    if (!rows.length) return `<div class="t-empty">No data yet</div>`;
    const top = rows[0][cols[0].k] || 1;
    const showAll = WA._expanded && WA._expanded[id];
    const list = showAll ? rows : rows.slice(0, max);
    const body = list.map((r) => {
      const w = Math.max(2, Math.round(((r[cols[0].k] || 0) / top) * 100));
      const keyHtml = keyFmt ? keyFmt(r) : H(r.key);
      const clickable = field ? `class="clickable" onclick="WA.addFilter('${field}', ${H(JSON.stringify(r.key))})" title="Filter to this"` : "";
      return `<tr ${clickable}><td class="wa-key"><div class="wa-bar" style="width:${w}%"></div><span>${keyHtml}</span></td>${cols.map((c) => `<td class="num mono">${c.fmt ? c.fmt(r[c.k], r) : n0(r[c.k])}</td>`).join("")}</tr>`;
    }).join("");
    const more = rows.length > max ? `<button class="wa-more" onclick="WA.toggleExpand('${id}')">${showAll ? "Show less" : "Show all " + rows.length}</button>` : "";
    return `<div class="table-wrap"><table class="data wa-tbl"><thead><tr><th class="no-sort">${label}</th>${cols.map((c) => `<th class="no-sort num">${c.label}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>${more}`;
  }
  WA._expanded = {};
  WA.toggleExpand = function (id) { this._expanded[id] = !this._expanded[id]; this.renderBody(); };

  function panel(title, sub, inner, extra = "") {
    return `<div class="panel ${extra}"><div class="panel__head"><h3>${title}</h3><span class="spacer"></span>${sub ? `<span class="muted" style="font-size:12px">${sub}</span>` : ""}</div>${inner}</div>`;
  }

  // multi-series line chart (visitors + pageviews) — inline SVG
  function trendChart(buckets) {
    if (!buckets.length) return `<div class="t-empty">No data yet</div>`;
    const W = 760, Hh = 230, pl = 40, pr = 10, pt = 12, pb = 30;
    const max = Math.max(1, ...buckets.map((b) => Math.max(b.pv, b.v)));
    const x = (i) => pl + (buckets.length === 1 ? (W - pl - pr) / 2 : (i / (buckets.length - 1)) * (W - pl - pr));
    const y = (v) => pt + (1 - v / max) * (Hh - pt - pb);
    let grid = "";
    for (let i = 0; i <= 4; i++) { const gv = Math.round((max / 4) * i); grid += `<line x1="${pl}" x2="${W - pr}" y1="${y(gv)}" y2="${y(gv)}" stroke="#e7e6f2"/><text x="${pl - 6}" y="${y(gv) + 4}" text-anchor="end" font-size="10" fill="#6b6b86">${gv}</text>`; }
    const path = (k) => buckets.map((b, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(b[k]).toFixed(1)).join(" ");
    const area = `${path("v")} L ${x(buckets.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`;
    const step = Math.max(1, Math.ceil(buckets.length / 8));
    const labels = buckets.map((b, i) => i % step === 0 || i === buckets.length - 1 ? `<text x="${x(i)}" y="${Hh - 10}" text-anchor="${i === 0 ? "start" : i === buckets.length - 1 ? "end" : "middle"}" font-size="10" fill="#6b6b86">${H(b.label)}</text>` : "").join("");
    const dots = buckets.map((b, i) => `<g class="wa-pt"><rect x="${x(i) - (W / buckets.length) / 2}" y="${pt}" width="${W / buckets.length}" height="${Hh - pt - pb}" fill="transparent"/><circle cx="${x(i)}" cy="${y(b.v)}" r="3" fill="#f37847"/><title>${H(b.full)}\n${b.v} visitors · ${b.pv} pageviews</title></g>`).join("");
    return `<div class="wa-legend"><span><i style="background:#0526c5"></i>Pageviews</span><span><i style="background:#f37847"></i>Visitors</span></div>
      <svg viewBox="0 0 ${W} ${Hh}" width="100%" style="display:block">${grid}
        <path d="${area}" fill="rgba(243,120,71,.12)"/>
        <path d="${path("pv")}" fill="none" stroke="#0526c5" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="${path("v")}" fill="none" stroke="#f37847" stroke-width="2.5" stroke-linejoin="round"/>
        ${dots}${labels}</svg>`;
  }
  function buildBuckets(A) {
    const hourly = this.range === "today" || this.range === "24h";
    const since = this.since();
    const out = [];
    const start = new Date(since);
    if (hourly) start.setMinutes(0, 0, 0); else start.setHours(0, 0, 0, 0);
    const stepMs = hourly ? 3600e3 : 86400e3;
    const idx = new Map();
    for (let t = start.getTime(); t <= Date.now(); t += stepMs) {
      const d = new Date(t);
      const b = { t, label: hourly ? d.toLocaleTimeString("en-US", { hour: "numeric" }) : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), full: hourly ? d.toLocaleString("en-US", { weekday: "short", hour: "numeric" }) : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }), pv: 0, vset: new Set() };
      out.push(b);
      idx.set(t, b);
    }
    for (const r of A.pvs) {
      const d = new Date(r._t);
      if (hourly) d.setMinutes(0, 0, 0); else d.setHours(0, 0, 0, 0);
      const b = idx.get(d.getTime());
      if (b) { b.pv++; b.vset.add(r.vid); }
    }
    return out.map((b) => ({ ...b, v: b.vset.size }));
  }

  function heatmap(A) {
    const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (const r of A.pvs) { const d = new Date(r._t); grid[d.getDay()][d.getHours()]++; }
    const max = Math.max(1, ...grid.flat());
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let html = `<div class="wa-heat"><div></div>${Array.from({ length: 24 }, (_, h) => `<div class="wa-heat__h">${h % 3 === 0 ? (h === 0 ? "12a" : h < 12 ? h + "a" : h === 12 ? "12p" : h - 12 + "p") : ""}</div>`).join("")}`;
    grid.forEach((row, di) => {
      html += `<div class="wa-heat__d">${days[di]}</div>` + row.map((v, h) => `<div class="wa-heat__c" style="background:${v ? `rgba(5,38,197,${(0.12 + 0.88 * v / max).toFixed(2)})` : "#f1f0f8"}" title="${days[di]} ${h}:00 — ${v} pageviews"></div>`).join("");
    });
    return html + `</div><div class="muted" style="font-size:12px;margin-top:8px">Pageviews by local time (your browser's timezone)</div>`;
  }

  function donut(rows, colors) {
    const total = rows.reduce((a, r) => a + r.value, 0) || 1;
    let acc = 0;
    const R = 60, C = 2 * Math.PI * R;
    const segs = rows.map((r, i) => {
      const len = (r.value / total) * C;
      const seg = `<circle r="${R}" cx="80" cy="80" fill="none" stroke="${colors[i] || PALETTE[i % PALETTE.length]}" stroke-width="26" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-acc}" transform="rotate(-90 80 80)"><title>${H(r.label)}: ${r.value}</title></circle>`;
      acc += len; return seg;
    }).join("");
    const legend = rows.map((r, i) => `<div class="wa-dl" onclick="WA.addFilter('device', ${H(JSON.stringify(r.label))})"><i style="background:${colors[i] || PALETTE[i % PALETTE.length]}"></i>${H(r.label)}<b>${pct(r.value, total)}%</b></div>`).join("");
    return `<div class="wa-donut"><svg viewBox="0 0 160 160" width="150" height="150">${segs}</svg><div>${legend}</div></div>`;
  }


  /* ---------------- extra panels ---------------- */
  const HIGH_INTENT_PATHS = /^\/(store-locator|sell-whatcha|contact|join-the-team|brand-ambassador)/;
  function funnel(A) {
    const steps = [
      { label: "Landed on the site", test: () => true },
      { label: "Got past the age gate", test: (s) => !s.evs.some((e) => e.name === "age_gate_confirm" && e.props && e.props.result === "no") && (s.evs.some((e) => e.name === "age_gate_confirm") || s.pvs.length > 1 || s.engaged >= 5000) },
      { label: "Engaged (2+ pages, 30s+, or scrolled half)", test: (s) => s.pvs.length > 1 || s.engaged >= 30000 || s.pvs.some((p) => (p.scroll_pct || 0) >= 50) },
      { label: "Showed buying / selling intent", hint: "store locator, sell-Whatcha, contact, IG/TikTok click", test: (s) => s.pvs.some((p) => HIGH_INTENT_PATHS.test(p.path || "")) || s.evs.some((e) => e.name === "store_locator_search" || (e.name === "outbound_click" && /instagram|tiktok/.test((e.props && e.props.domain) || ""))) },
      { label: "Submitted a form", test: (s) => s.converted },
    ];
    let pool = A.sess;
    const rows = steps.map((st) => { pool = pool.filter(st.test); return { ...st, n: pool.length }; });
    const top = rows[0].n || 1;
    const under = A.sess.filter((s) => s.evs.some((e) => e.name === "age_gate_confirm" && e.props && e.props.result === "no")).length;
    return `<div class="wa-funnel">${rows.map((r, i) => {
      const prev = i ? rows[i - 1].n : r.n;
      return `<div class="wa-fstep"><div class="wa-fstep__lab"><b>${H(r.label)}</b>${r.hint ? `<span class="muted"> · ${H(r.hint)}</span>` : ""}</div>
        <div class="wa-fstep__bar"><div style="width:${Math.max(1.5, (r.n / top) * 100)}%;background:${["#0526c5", "#27baad", "#75d0f7", "#f37847", "#1f9d6b"][i]}"></div></div>
        <div class="wa-fstep__n"><b>${n0(r.n)}</b> <span class="muted">${pct(r.n, top)}%</span>${i ? `<span class="wa-fdrop">${prev ? "−" + (100 - pct(r.n, prev)) + "% from previous step" : ""}</span>` : ""}</div></div>`;
    }).join("")}</div>${under ? `<div class="muted" style="font-size:12px;margin-top:10px">🔞 ${n0(under)} session${under > 1 ? "s" : ""} answered “Not yet” at the age gate (${pct(under, A.sessions)}%).</div>` : ""}`;
  }

  function storeSearches(A) {
    const m = new Map();
    A.evs.filter((e) => e.name === "store_locator_search").forEach((e) => {
      const q = ((e.props && e.props.query) || "(blank)").toUpperCase();
      let g = m.get(q); if (!g) { g = { key: q, count: 0, visitors: new Set(), from: new Map() }; m.set(q, g); }
      g.count++; g.visitors.add(e.vid);
      const pv = A.sess.find((s) => s.sid === e.sid); const c = pv && pv.first.city ? pv.first.city + (pv.first.region ? ", " + pv.first.region : "") : "";
      if (c) g.from.set(c, (g.from.get(c) || 0) + 1);
    });
    const rows = [...m.values()].map((g) => ({ ...g, visitors: g.visitors.size, fromTop: [...g.from.entries()].sort((a, b) => b[1] - a[1])[0] })).sort((a, b) => b.count - a.count);
    if (!rows.length) return `<div class="t-empty">No searches yet. Every ZIP typed into the store locator lands here.</div>`;
    return rankTable(rows, { id: "zips", label: "Searched ZIP / place", cols: [{ k: "count", label: "Searches" }, { k: "visitors", label: "People" }], keyFmt: (r) => `<b>${H(r.key)}</b>${r.fromTop ? `<span class="muted"> · from ${H(r.fromTop[0])}</span>` : ""}` });
  }

  function rageClicks(A) {
    const m = new Map();
    A.evs.filter((e) => e.name === "rage_click").forEach((e) => { const k = (((e.props && e.props.text) || "(unlabeled " + ((e.props && e.props.tag) || "element") + ")") + " · " + e.path); m.set(k, (m.get(k) || 0) + 1); });
    const rows = [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
    if (!rows.length) return `<div class="t-empty">No rage clicks 🎉 — nothing on the site is frustrating people.</div>`;
    return rankTable(rows, { id: "rage", label: "Element · page", cols: [{ k: "count", label: "Rage clicks" }] });
  }

  const p75 = (arr) => { const a = arr.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * 0.75))] : null; };
  const GRADE = { lcp: [2500, 4000], inp: [200, 500], cls: [0.1, 0.25], ttfb: [800, 1800] };
  function grade(metric, v) {
    if (v == null) return `<span class="muted">—</span>`;
    const [g, p] = GRADE[metric];
    const cls = v <= g ? "good" : v <= p ? "ok" : "poor";
    const txt = metric === "cls" ? v.toFixed(2) : v >= 1000 ? (v / 1000).toFixed(1) + "s" : Math.round(v) + "ms";
    return `<span class="wa-vital wa-vital--${cls}">${txt}</span>`;
  }
  function speed(A) {
    const v = A.evs.filter((e) => e.name === "web_vitals" && e.props);
    if (!v.length) return `<div class="t-empty">Collecting… page-speed numbers arrive as real visitors leave each page.</div>`;
    const by = (keyFn) => {
      const m = new Map();
      v.forEach((e) => { const k = keyFn(e) || "(none)"; if (!m.has(k)) m.set(k, []); m.get(k).push(e.props); });
      return [...m.entries()].map(([key, ps]) => ({ key, n: ps.length, lcp: p75(ps.map((p) => p.lcp)), inp: p75(ps.map((p) => p.inp)), cls: p75(ps.map((p) => p.cls)), ttfb: p75(ps.map((p) => p.ttfb)) })).sort((a, b) => b.n - a.n);
    };
    const all = by(() => "All visits")[0];
    const dev = by((e) => e.device);
    const pages = by((e) => e.path).slice(0, 12);
    const row = (r) => `<tr><td>${H(r.key)}</td><td class="num">${grade("lcp", r.lcp)}</td><td class="num">${grade("inp", r.inp)}</td><td class="num">${grade("cls", r.cls)}</td><td class="num">${grade("ttfb", r.ttfb)}</td><td class="num mono muted">${r.n}</td></tr>`;
    return `<div class="wa-vitals-sum">
        <div><span>Loading (LCP)</span>${grade("lcp", all.lcp)}<small>main content visible · good &lt; 2.5s</small></div>
        <div><span>Responsiveness (INP)</span>${grade("inp", all.inp)}<small>tap → reaction · good &lt; 200ms</small></div>
        <div><span>Stability (CLS)</span>${grade("cls", all.cls)}<small>layout jumping · good &lt; 0.1</small></div>
        <div><span>Server (TTFB)</span>${grade("ttfb", all.ttfb)}<small>first byte · good &lt; 0.8s</small></div>
      </div>
      <div class="table-wrap"><table class="data wa-tbl"><thead><tr><th class="no-sort">Page / device</th><th class="no-sort num">LCP</th><th class="no-sort num">INP</th><th class="no-sort num">CLS</th><th class="no-sort num">TTFB</th><th class="no-sort num">Samples</th></tr></thead>
      <tbody>${dev.map((r) => row({ ...r, key: devIco(r.key) + " " + r.key })).join("")}${pages.map(row).join("")}</tbody></table></div>`;
  }

  function errorsPanel(A) {
    const m = new Map();
    A.evs.filter((e) => e.name === "js_error").forEach((e) => {
      const p = e.props || {}; const k = (p.message || "?") + " ␟ " + (p.source || "") + ":" + (p.line || "");
      let g = m.get(k); if (!g) { g = { key: k, count: 0, pages: new Set(), browsers: new Set() }; m.set(k, g); }
      g.count++; g.pages.add(e.path); g.browsers.add(e.browser);
    });
    const rows = [...m.values()].sort((a, b) => b.count - a.count);
    if (!rows.length) return "";
    return panel("Site errors", "JavaScript errors real visitors hit", `<div class="table-wrap"><table class="data wa-tbl"><thead><tr><th class="no-sort">Error</th><th class="no-sort">Where</th><th class="no-sort">Browsers</th><th class="no-sort num">Count</th></tr></thead><tbody>${rows.slice(0, 15).map((g) => { const [msg, src] = g.key.split(" ␟ "); return `<tr><td><b>${H(msg)}</b><div class="muted mono" style="font-size:11px">${H(src)}</div></td><td>${H([...g.pages].slice(0, 3).join(", "))}</td><td class="muted">${H([...g.browsers].filter(Boolean).slice(0, 3).join(", "))}</td><td class="num mono">${g.count}</td></tr>`; }).join("")}</tbody></table></div>`);
  }

  /* ---------------- campaign link + QR builder ---------------- */
  const LB_PAGES = [["/", "Homepage"], ["/whatchalookinat", "Pouch QR page"], ["/store-locator/store-locator", "Store locator"], ["/sell-whatcha", "Wanna sell Whatcha?"], ["/about", "About"], ["/brand-ambassador", "Brand ambassador"], ["/join-the-team", "Join the team"]];
  const LB_PRESETS = [["instagram", "social", "Instagram bio / story"], ["tiktok", "social", "TikTok bio"], ["qr", "qr", "Printed QR (pouch, sign, cart)"], ["newsletter", "email", "Email"], ["influencer", "influencer", "Influencer / ambassador"], ["linkedin", "social", "LinkedIn"], ["retailer", "referral", "Retail partner"]];
  function linkBuilder() {
    const st = WA._lb || (WA._lb = { page: "/", source: "instagram", medium: "social", campaign: "", content: "" });
    return `<div class="wa-lb">
      <div class="wa-lb__form">
        <label>Page<select onchange="WA.lbSet('page',this.value)">${LB_PAGES.map(([v, l]) => `<option value="${v}" ${st.page === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label>Where it's posted<select onchange="const [s,m]=this.value.split('|');WA.lbSet('source',s,true);WA.lbSet('medium',m)">${LB_PRESETS.map(([s, m, l]) => `<option value="${s}|${m}" ${st.source === s ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label>Campaign<input value="${H(st.campaign)}" placeholder="e.g. fall_launch, uconn_tailgate" oninput="WA.lbSet('campaign',this.value,true)" onchange="WA.lbSet('campaign',this.value)"></label>
        <label>Variant (optional)<input value="${H(st.content)}" placeholder="e.g. reel_1, cart_sign_b" oninput="WA.lbSet('content',this.value,true)" onchange="WA.lbSet('content',this.value)"></label>
      </div>
      <div class="wa-lb__out">
        <div class="wa-lb__url" id="wa-lb-url"></div>
        <div class="btn-row"><button class="btn btn--sm btn--primary" onclick="WA.lbCopy()">Copy link</button><button class="btn btn--sm btn--ghost" onclick="WA.lbQR(true)">⬇ QR code (PNG)</button></div>
        <div id="wa-lb-qr" class="wa-lb__qr"></div>
      </div></div>`;
  }
  WA.lbUrl = function () {
    const st = this._lb, slug = (x) => (x || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const q = new URLSearchParams({ utm_source: st.source, utm_medium: st.medium });
    if (slug(st.campaign)) q.set("utm_campaign", slug(st.campaign));
    if (slug(st.content)) q.set("utm_content", slug(st.content));
    return "https://www.whatchadrinking.com" + st.page + "?" + q.toString();
  };
  WA.lbSet = function (k, v, quiet) { this._lb[k] = v; const el = $("#wa-lb-url"); if (el) el.textContent = this.lbUrl(); if (!quiet) this.lbQR(false); };
  WA.lbCopy = function () { const u = this.lbUrl(); (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => App.toast("Link copied"), () => App.toast(u)); };
  let qrP = null;
  function loadQR() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    return qrP || (qrP = new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"; s.onload = () => res(window.qrcode); s.onerror = rej; document.head.appendChild(s); }));
  }
  WA.lbQR = async function (download) {
    const el = $("#wa-lb-url"); if (el) el.textContent = this.lbUrl();
    const box = $("#wa-lb-qr"); if (!box) return;
    try {
      const qrcode = await loadQR();
      const qr = qrcode(0, "M"); qr.addData(this.lbUrl()); qr.make();
      const n = qr.getModuleCount(), cell = 10, pad = 4 * cell, size = n * cell + pad * 2;
      const c = document.createElement("canvas"); c.width = c.height = size;
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, size, size); g.fillStyle = "#0526c5";
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) g.fillRect(pad + k * cell, pad + r * cell, cell, cell);
      box.innerHTML = ""; c.style.width = "150px"; c.style.height = "150px"; box.appendChild(c);
      if (download) { const a = document.createElement("a"); a.href = c.toDataURL("image/png"); a.download = "whatcha-qr-" + (this._lb.source + "-" + (this._lb.campaign || "link")).replace(/[^a-z0-9-]+/gi, "_") + ".png"; a.click(); }
    } catch (e) { box.innerHTML = `<span class="muted">QR generator couldn't load.</span>`; }
  };

  /* ---------------- shell ---------------- */
  WA.render = async function () {
    this.excludeThisDevice(true);
    const view = $("#view");
    if (!this.sb()) {
      view.innerHTML = `<div class="panel"><h3>Website analytics needs live mode</h3><p class="muted">Set <code>backend: "supabase"</code> in config.js and sign in — visitor data lives in your Supabase project.</p></div>`;
      return;
    }
    view.innerHTML = `
      <div class="wa-toolbar">
        <div class="wa-pills">${RANGES.map((r) => `<button class="wa-pill ${r.id === this.range ? "on" : ""}" onclick="WA.setRange('${r.id}')">${r.label}</button>`).join("")}</div>
        <span class="spacer"></span>
        <label class="wa-check"><input type="checkbox" ${this.includeBots ? "checked" : ""} onchange="WA.includeBots=this.checked;WA.renderBody()"> Include bots</label>
        <button class="btn btn--ghost btn--sm" onclick="WA.refresh()">↻ Refresh</button>
        <button class="btn btn--ghost btn--sm" onclick="WA.exportCSV()">⬇ CSV</button>
      </div>
      <div id="wa-filters"></div>
      <div id="wa-live"></div>
      <div id="wa-body"><div class="panel"><div class="t-empty">Loading visitor data…</div></div></div>`;
    this.startLive();
    await this.load();
    if (App.view !== "website") return;
    this.renderBody();
    clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => { if (App.view === "website" && !document.hidden) this.refresh(true); }, 60000);
  };

  WA.stop = function () {
    clearInterval(this.liveTimer); this.liveTimer = null;
    clearInterval(this.refreshTimer); this.refreshTimer = null;
    if (this.map) { this.map.remove(); this.map = null; }
    if (this.liveMap) { this.liveMap.remove(); this.liveMap = null; }
  };

  WA.setRange = function (id) {
    this.range = id;
    try { localStorage.setItem("wa_dash_range", id); } catch (e) {}
    this.stop();
    this.render();
  };
  WA.refresh = async function (quiet) {
    await this.load(true);
    if (App.view === "website") this.renderBody();
    if (!quiet) App.toast("Updated");
  };
  WA.addFilter = function (field, value) { this.filters[field] = value; this.sessionsShown = 60; this.renderBody(); window.scrollTo(0, 0); $(".main") && ($(".main").scrollTop = 0); };
  WA.removeFilter = function (field) { delete this.filters[field]; this.renderBody(); };
  WA.clearFilters = function () { this.filters = {}; this.renderBody(); };

  WA.renderFilters = function () {
    const keys = Object.keys(this.filters);
    $("#wa-filters").innerHTML = keys.length ? `<div class="wa-filterbar"><span class="muted">Filtered:</span>${keys.map((k) => `<span class="chip wa-fchip">${H(FILTER_LABELS[k] || k)}: <b>${H(k === "country" ? countryName(this.filters[k]) : k === "vid" ? (this.ids[this.filters[k]] && (this.ids[this.filters[k]].name || this.ids[this.filters[k]].email)) || "visitor " + this.filters[k].slice(0, 6) : this.filters[k])}</b><button onclick="WA.removeFilter('${k}')" aria-label="Remove">✕</button></span>`).join("")}<button class="wa-more" onclick="WA.clearFilters()">Clear all</button></div>` : "";
  };

  WA.renderBody = function () {
    const body = $("#wa-body");
    if (!body) return;
    this.renderFilters();
    if (this.error) { body.innerHTML = `<div class="panel"><h3 style="margin-bottom:6px">Not connected yet</h3><p class="muted" style="margin:0">${H(this.error)}</p></div>`; return; }
    const A = this.aggregate();
    const P = A.prev;
    const rangeLabel = (RANGES.find((r) => r.id === this.range) || {}).label;

    if (!this.rows.length) {
      body.innerHTML = `<div class="panel"><h3 style="margin-bottom:6px">Waiting for your first visitor</h3><p class="muted" style="margin:0">Tracking is installed on whatchadrinking.com. As soon as someone (other than you) loads a page it'll show up here — usually within a few seconds.</p></div>`;
      return;
    }

    // ---- groupings ----
    const channels = groupSessions(A.sess, (s) => s.first.channel);
    const sources = groupSessions(A.sess, (s) => s.first.source);
    const refs = groupSessions(A.sess.filter((s) => s.first.s_ref_domain), (s) => s.first.s_ref_domain);
    const refUrls = groupSessions(A.sess.filter((s) => s.first.s_referrer), (s) => s.first.s_referrer.replace(/^https?:\/\//, "").replace(/\/$/, ""));
    const camp = groupSessions(A.sess.filter((s) => s.first.utm_source || s.first.utm_medium || s.first.utm_campaign), (s) => [s.first.utm_source || "—", s.first.utm_medium || "—", s.first.utm_campaign || "—", s.first.utm_term || "", s.first.utm_content || ""].join(" ␟ "));
    const clicks = groupSessions(A.sess.filter((s) => s.first.click_id_type), (s) => s.first.click_id_type);
    const pages = groupPageviews(A.pvs, (r) => r.path);
    const landings = groupSessions(A.sess, (s) => s.landing.path);
    const exits = groupSessions(A.sess, (s) => s.last.path);
    const countries = groupSessions(A.sess, (s) => s.first.country);
    const regions = groupSessions(A.sess, (s) => s.first.region ? `${s.first.region}${s.first.country && s.first.country !== "US" ? " · " + s.first.country : ""}` : null);
    const cities = groupSessions(A.sess, (s) => s.first.city);
    const postals = groupSessions(A.sess.filter((s) => s.first.postal), (s) => s.first.postal + (s.first.city ? " · " + s.first.city : ""));
    const devices = groupSessions(A.sess, (s) => s.first.device);
    const browsers = groupSessions(A.sess, (s) => s.first.browser);
    const oses = groupSessions(A.sess, (s) => s.first.os);
    const screens = groupSessions(A.sess, (s) => s.first.screen);
    const langs = groupSessions(A.sess, (s) => s.first.lang);
    const orgs = groupSessions(A.sess.filter((s) => s.first.org), (s) => s.first.org);
    const newRet = [{ label: "New", value: A.newVisitors }, { label: "Returning", value: A.sessions - A.newVisitors }];

    // events
    const evMap = new Map();
    for (const e of A.evs) {
      if (e.name === "web_vitals" || e.name === "js_error") continue;
      let g = evMap.get(e.name); if (!g) { g = { key: e.name, count: 0, visitors: new Set() }; evMap.set(e.name, g); }
      g.count++; g.visitors.add(e.vid);
    }
    const events = [...evMap.values()].map((g) => ({ ...g, visitors: g.visitors.size })).sort((a, b) => b.count - a.count);
    const outMap = new Map();
    A.evs.filter((e) => e.name === "outbound_click").forEach((e) => { const k = (e.props && e.props.domain) || "?"; outMap.set(k, (outMap.get(k) || 0) + 1); });
    const outbound = [...outMap.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
    const ctaMap = new Map();
    A.evs.filter((e) => e.name === "cta_click" || e.name === "button_click").forEach((e) => { const k = ((e.props && e.props.text) || "?") + " · " + e.path; ctaMap.set(k, (ctaMap.get(k) || 0) + 1); });
    const ctas = [...ctaMap.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);

    // identified people in range
    const people = [];
    const seenV = new Set();
    for (const s of A.sess) { if (this.ids[s.vid] && !seenV.has(s.vid)) { seenV.add(s.vid); people.push(s.vid); } }

    const sessCols = [{ k: "visitors", label: "Visitors" }, { k: "sessions", label: "Sessions" }, { k: "conv", label: "Conv." }];
    const geoCols = [{ k: "visitors", label: "Visitors" }, { k: "sessions", label: "Sessions" }, { k: "engaged", label: "Avg time", fmt: (v, r) => dur(v / r.sessions) }];

    body.innerHTML = `
      <div class="kpi-grid wa-kpis">
        ${kpi("Visitors", n0(A.visitors), delta(A.visitors, P.visitors) + ` vs prev ${H(rangeLabel)}`, "kpi--accent")}
        ${kpi("Sessions", n0(A.sessions), delta(A.sessions, P.sessions) + ` · ${pct(A.newVisitors, A.sessions)}% new`)}
        ${kpi("Pageviews", n0(A.pageviews), delta(A.pageviews, P.pageviews) + ` · ${A.pps.toFixed(1)} / session`, "kpi--teal")}
        ${kpi("Avg engaged time", dur(A.avgEngaged), delta(A.avgEngaged, P.avgEngaged) + " per session")}
        ${kpi("Bounce rate", A.bounce + "%", delta(A.bounce, P.bounce, true) + " · 1 page &lt;10s")}
        ${kpi("Form submits", n0(A.conversions), A.convRate.toFixed(1) + "% of sessions convert", "kpi--coral")}
      </div>

      ${panel("Traffic", this.range === "today" || this.range === "24h" ? "by hour" : "by day", trendChart(buildBuckets.call(this, A)))}

      ${panel("Conversion funnel", "sessions that made it to each step", funnel(A))}

      <div class="panel">
        <div class="panel__head"><h3>Where visitors are</h3><span class="spacer"></span><span class="muted" style="font-size:12px">${n0(new Set(A.sess.map((s) => s.first.city).filter(Boolean)).size)} cities · ${n0(new Set(A.sess.map((s) => s.first.region).filter(Boolean)).size)} regions · ${n0(new Set(A.sess.map((s) => s.first.country).filter(Boolean)).size)} countries</span></div>
        <div class="wa-mapwrap"><div id="wa-map" class="wa-map"></div>
          <div class="wa-maptabs">
            <div class="wa-tabs" id="wa-geo-tabs">${["Cities", "Regions", "Countries", "ZIP"].map((t, i) => `<button class="${i === (this._geoTab || 0) ? "on" : ""}" onclick="WA._geoTab=${i};WA.renderBody()">${t}</button>`).join("")}</div>
            ${[
              () => rankTable(cities, { id: "cities", field: "city", label: "City", cols: geoCols, max: 12, keyFmt: (r) => r.key === "(none)" ? "Unknown" : `${flag(r.sample.first.country)} ${H(r.key)}<span class="muted">${r.sample.first.region ? ", " + H(r.sample.first.region) : ""}</span>` }),
              () => rankTable(regions, { id: "regions", field: "region", label: "Region / State", cols: geoCols, max: 12, keyFmt: (r) => r.key === "(none)" ? "Unknown" : `${flag(r.sample.first.country)} ${H(r.key)}` }),
              () => rankTable(countries, { id: "countries", field: "country", label: "Country", cols: geoCols, max: 12, keyFmt: (r) => r.key === "(none)" ? "Unknown" : `${flag(r.key)} ${H(countryName(r.key))}` }),
              () => rankTable(postals, { id: "postals", label: "ZIP / postal", cols: geoCols, max: 12 }),
            ][this._geoTab || 0]()}
          </div>
        </div>
      </div>

      <div class="grid-2">
        ${panel("Channels", "how they found you", rankTable(channels, { id: "ch", field: "channel", label: "Channel", cols: sessCols, keyFmt: (r) => `<i class="wa-dot" style="background:${CH_COLORS[r.key] || "#999"}"></i>${H(r.key)}` }))}
        ${panel("Sources", "utm_source → referrer → app", rankTable(sources, { id: "src", field: "source", label: "Source", cols: sessCols }))}
      </div>

      <div class="grid-2">
        ${panel("Referring domains", "", rankTable(refs, { id: "refs", field: "s_ref_domain", label: "Domain", cols: sessCols, keyFmt: (r) => `<img class="wa-fav" src="https://icons.duckduckgo.com/ip3/${encodeURIComponent(r.key)}.ico" alt="" loading="lazy" onerror="this.remove()">${H(r.key)}` }))}
        ${panel("Referring URLs", "full link they came from", rankTable(refUrls, { id: "refurls", label: "URL", cols: [{ k: "sessions", label: "Sessions" }], keyFmt: (r) => `<a href="https://${H(r.key)}" target="_blank" rel="noopener noreferrer" class="wa-url" onclick="event.stopPropagation()">${H(r.key)}</a>` }))}
      </div>

      ${panel("UTM campaigns", "source / medium / campaign / term / content", camp.length ? `<div class="table-wrap"><table class="data wa-tbl"><thead><tr><th class="no-sort">Source</th><th class="no-sort">Medium</th><th class="no-sort">Campaign</th><th class="no-sort">Term</th><th class="no-sort">Content</th><th class="no-sort num">Visitors</th><th class="no-sort num">Sessions</th><th class="no-sort num">Bounce</th><th class="no-sort num">Conv.</th></tr></thead><tbody>${camp.slice(0, this._expanded.camp ? 999 : 15).map((g) => { const [s, m, c, t, ct] = g.key.split(" ␟ "); return `<tr class="clickable" onclick="WA.addFilter('utm_campaign', ${H(JSON.stringify(c === "—" ? "(none)" : c))})"><td>${H(s)}</td><td>${H(m)}</td><td><b>${H(c)}</b></td><td class="muted">${H(t)}</td><td class="muted">${H(ct)}</td><td class="num mono">${g.visitors}</td><td class="num mono">${g.sessions}</td><td class="num mono">${pct(g.bounces, g.sessions)}%</td><td class="num mono">${g.conv}</td></tr>`; }).join("")}</tbody></table></div>${camp.length > 15 ? `<button class="wa-more" onclick="WA.toggleExpand('camp')">${this._expanded.camp ? "Show less" : "Show all " + camp.length}</button>` : ""}` : `<div class="t-empty">No tagged links yet. Add <code>?utm_source=instagram&amp;utm_medium=social&amp;utm_campaign=launch</code> to links you post and they'll show up here.</div>`)}

      ${clicks.length ? panel("Ad click IDs", "gclid / fbclid / ttclid …", rankTable(clicks, { id: "clk", field: "click_id_type", label: "Click ID", cols: sessCols, keyFmt: (r) => H(({ gclid: "Google Ads (gclid)", gbraid: "Google Ads iOS (gbraid)", wbraid: "Google Ads (wbraid)", fbclid: "Meta / Instagram (fbclid)", ttclid: "TikTok Ads (ttclid)", msclkid: "Microsoft Ads (msclkid)", li_fat_id: "LinkedIn (li_fat_id)", twclid: "X / Twitter (twclid)", sccid: "Snapchat (sccid)", rdt_cid: "Reddit (rdt_cid)", igshid: "Instagram share (igshid)", mc_cid: "Mailchimp (mc_cid)", epik: "Pinterest (epik)", dclid: "Google Display (dclid)" })[r.key] || r.key) })) : ""}

      <div class="grid-2">
        ${panel("Top pages", "", rankTable(pages, { id: "pages", field: "path", label: "Page", cols: [{ k: "views", label: "Views" }, { k: "visitors", label: "Visitors" }, { k: "avgEngaged", label: "Avg time", fmt: (v) => dur(v) }, { k: "avgScroll", label: "Scroll", fmt: (v) => v + "%" }], keyFmt: (r) => `${H(r.key)}` }))}
        ${panel("Landing pages", "where sessions start", rankTable(landings, { id: "land", field: "s_landing", label: "Landing page", cols: [{ k: "sessions", label: "Sessions" }, { k: "bounces", label: "Bounce", fmt: (v, r) => pct(v, r.sessions) + "%" }, { k: "conv", label: "Conv." }] }))}
      </div>

      <div class="grid-2">
        ${panel("Exit pages", "last page seen", rankTable(exits, { id: "exit", label: "Page", cols: [{ k: "sessions", label: "Exits" }] }))}
        ${panel("Events & clicks", "auto-tracked + gtag events", rankTable(events, { id: "ev", field: "name", label: "Event", cols: [{ k: "count", label: "Count" }, { k: "visitors", label: "Visitors" }], keyFmt: (r) => H(({ form_submit: "📝 Form submit", form_submit_success: "✅ Form submit (confirmed)", outbound_click: "↗️ Outbound click", cta_click: "👆 CTA click", button_click: "👆 Button click", email_click: "✉️ Email link", phone_click: "📞 Phone link", age_gate_confirm: "🔞 Age gate answered", store_locator_search: "📍 Store locator search", download: "⬇️ Download" })[r.key] || r.key) }))}
      </div>

      <div class="grid-2">
        ${panel("Outbound clicks", "where they leave to", rankTable(outbound, { id: "out", label: "Destination", cols: [{ k: "count", label: "Clicks" }] }))}
        ${panel("Buttons & CTAs", "what they tap", rankTable(ctas, { id: "cta", label: "Button · page", cols: [{ k: "count", label: "Clicks" }] }))}
      </div>

      <div class="grid-2">
        ${panel("Devices", "", donut(devices.map((d) => ({ label: d.key, value: d.sessions })), devices.map((d) => ({ mobile: "#f37847", desktop: "#0526c5", tablet: "#27baad" })[d.key] || "#999")) + `<div class="wa-nr">${newRet.map((x) => `<span><b>${pct(x.value, A.sessions)}%</b> ${x.label}</span>`).join("")}</div>`)}
        ${panel("Browsers & apps", "in-app = opened inside IG/TikTok/etc.", rankTable(browsers, { id: "br", field: "browser", label: "Browser", cols: sessCols.slice(0, 2) }))}
      </div>

      <div class="grid-2">
        ${panel("Operating systems", "", rankTable(oses, { id: "os", field: "os", label: "OS", cols: sessCols.slice(0, 2) }))}
        ${panel("Screen sizes", "", rankTable(screens, { id: "scr", label: "Screen", cols: sessCols.slice(0, 2) }))}
      </div>

      <div class="grid-2">
        ${panel("Languages", "", rankTable(langs, { id: "lang", field: "lang", label: "Language", cols: sessCols.slice(0, 2) }))}
        ${panel("Network / company", "ISP or org behind the IP", orgs.length ? rankTable(orgs, { id: "org", field: "org", label: "Network", cols: sessCols.slice(0, 2) }) : `<div class="t-empty">Add a free <b>IPINFO_TOKEN</b> in Vercel → Settings → Environment Variables to see the ISP / company behind each visit (e.g. "Yale University", "Comcast").</div>`)}
      </div>

      ${panel("When they visit", "", heatmap(A))}

      <div class="grid-2">
        ${panel("Store locator searches", "where people want Whatcha — sell there next", storeSearches(A))}
        ${panel("Frustration", "rage clicks = 3 fast taps on something that didn't respond", rageClicks(A))}
      </div>

      ${panel("Page speed", "real visitors · 75th percentile · Google's Core Web Vitals", speed(A))}

      ${errorsPanel(A)}

      ${panel("Campaign link + QR builder", "tag every link you post so it shows up above", linkBuilder())}

      ${people.length ? panel("Identified visitors", "people who've submitted a form — every visit, before and after", `<div class="table-wrap"><table class="data wa-tbl"><thead><tr><th class="no-sort">Person</th><th class="no-sort">Location</th><th class="no-sort">First source</th><th class="no-sort num">Sessions</th><th class="no-sort num">Last seen</th></tr></thead><tbody>${people.map((v) => { const p = this.ids[v]; const ss = A.sess.filter((s) => s.vid === v); const f = ss[0].first; const last = Math.max(...ss.map((s) => s.end)); return `<tr class="clickable" onclick="WA.visitorModal('${H(v)}')"><td><b>${H(p.name || "")}</b> <span class="muted">${H(p.email || "")}</span></td><td>${flag(f.country)} ${H(place(f))}</td><td>${H(f.source)}</td><td class="num mono">${ss.length}</td><td class="num mono">${ago(new Date(last).toISOString())}</td></tr>`; }).join("")}</tbody></table></div>`) : ""}

      <div class="panel">
        <div class="panel__head"><h3>Every visit</h3><span class="spacer"></span>
          <input class="wa-search" id="wa-sess-search" type="search" placeholder="Search city, IP, source, page, email…" value="${H(this.sessionSearch)}" oninput="WA.sessionSearch=this.value;WA.renderSessions()">
        </div>
        <div id="wa-sessions"></div>
      </div>

      <div class="wa-foot muted">Tracking on whatchadrinking.com via <code>/assets/w.js</code> → edge <code>/api/w</code>. ${this.deviceExcluded() ? `This device is <b>excluded</b> from tracking. <button class="wa-more" onclick="WA.excludeThisDevice(false, true)">Track this device</button>` : `This device <b>is</b> being tracked. <button class="wa-more" onclick="WA.excludeThisDevice(true, true)">Exclude this device</button>`}</div>`;

    this.renderSessions();
    this.drawMap(A);
    this.lbQR(false);
  };

  /* ---------------- session list + visitor profile ---------------- */
  WA.renderSessions = function () {
    const el = $("#wa-sessions");
    if (!el || !this.agg) return;
    const q = this.sessionSearch.trim().toLowerCase();
    let list = this.agg.sess.slice().sort((a, b) => b.end - a.end);
    if (q) {
      list = list.filter((s) => {
        const f = s.first, id = this.ids[s.vid] || {};
        return [f.city, f.region, f.country, countryName(f.country), f.ip, f.source, f.channel, f.s_referrer, f.utm_campaign, f.browser, f.os, f.org, f.postal, id.email, id.name, ...s.pvs.map((p) => p.path)].filter(Boolean).join(" ").toLowerCase().includes(q);
      });
    }
    const shown = list.slice(0, this.sessionsShown);
    el.innerHTML = shown.length ? `<div class="wa-sessions">${shown.map((s) => {
      const f = s.first, id = this.ids[s.vid];
      const live = Date.now() - s.end < 90000;
      return `<button class="wa-sess" onclick="WA.visitorModal('${H(s.vid)}','${H(s.sid)}')">
        <div class="wa-sess__top"><span class="wa-sess__loc">${flag(f.country)} ${H(place(f))}</span>${live ? `<span class="wa-livepill">● LIVE</span>` : ""}<span class="spacer"></span><span class="muted">${ago(new Date(s.end).toISOString())}</span></div>
        <div class="wa-sess__who">${id ? `<b>${H(id.name || id.email)}</b> · ` : ""}${devIco(f.device)} ${H(f.browser || "")} · ${H(f.os || "")}${(f.visit_num || 1) > 1 ? ` · visit #${f.visit_num}` : " · new"}${f.org ? " · " + H(f.org) : ""}</div>
        <div class="wa-sess__path"><span class="chip chip--sm" style="background:${CH_COLORS[f.channel] || "#fff"};${/Direct|Organic Search|Paid Search/.test(f.channel) ? "color:#fff" : ""}">${H(f.channel)}</span> <span class="muted">${H(f.source)}</span> → ${s.pvs.slice().sort((a, b) => a._t - b._t).map((p) => H(p.path)).slice(0, 6).join(" → ")}${s.pvs.length > 6 ? " …" : ""}</div>
        <div class="wa-sess__meta muted">${s.pvs.length} page${s.pvs.length > 1 ? "s" : ""} · ${dur(s.engaged)} engaged${s.converted ? ` · <b style="color:var(--ok)">submitted form</b>` : ""}${s.evs.length ? ` · ${s.evs.length} event${s.evs.length > 1 ? "s" : ""}` : ""}</div>
      </button>`;
    }).join("")}</div>${list.length > shown.length ? `<button class="btn btn--ghost btn--sm" style="margin-top:12px" onclick="WA.sessionsShown+=60;WA.renderSessions()">Show more (${list.length - shown.length} left)</button>` : ""}` : `<div class="t-empty">No visits match.</div>`;
  };

  WA.visitorModal = function (vid, focusSid) {
    const rows = this.rows.filter((r) => r.vid === vid).sort((a, b) => a._t - b._t);
    if (!rows.length) return;
    const id = this.ids[vid];
    const pvsOnly = rows.filter((r) => r.kind === "pageview");
    const last = pvsOnly[pvsOnly.length - 1] || rows[rows.length - 1];
    const firstPv = pvsOnly[0] || rows[0];
    const bySess = new Map();
    rows.forEach((r) => { if (!bySess.has(r.sid)) bySess.set(r.sid, []); bySess.get(r.sid).push(r); });
    const sessHtml = [...bySess.entries()].reverse().map(([sid, rs]) => {
      const f = rs.find((r) => r.kind === "pageview") || rs[0];
      const eng = rs.filter((r) => r.kind === "pageview").reduce((a, r) => a + (r.engaged_ms || 0), 0);
      return `<div class="wa-tl ${sid === focusSid ? "wa-tl--focus" : ""}">
        <div class="wa-tl__head"><b>${when(f.ts)}</b> · ${H(f.channel)} · ${H(f.source)}${f.utm_campaign ? ` · campaign <b>${H(f.utm_campaign)}</b>` : ""} · ${dur(eng)} engaged</div>
        ${f.s_referrer ? `<div class="muted wa-tl__ref">from <a href="${H(f.s_referrer)}" target="_blank" rel="noopener noreferrer">${H(f.s_referrer)}</a></div>` : ""}
        <ol>${rs.map((r) => r.kind === "pageview"
          ? `<li><span class="mono muted">${new Date(r.ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span> 📄 <b>${H(r.path)}</b>${r.query ? `<span class="muted">${H(r.query)}</span>` : ""} <span class="muted">· ${dur(r.engaged_ms)} · scrolled ${r.scroll_pct}%</span></li>`
          : `<li><span class="mono muted">${new Date(r.ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span> ⚡ ${H(r.name)} <span class="muted">${H(Object.entries(r.props || {}).map(([k, v]) => k + ": " + v).join(" · "))}</span></li>`).join("")}</ol>
      </div>`;
    }).join("");
    const kv = (k, v) => v || v === 0 ? `<div class="wa-kv"><span>${k}</span><b>${v}</b></div>` : "";
    const mapsLink = last.lat != null ? `<a href="https://www.google.com/maps?q=${last.lat},${last.lon}" target="_blank" rel="noopener">${(+last.lat).toFixed(3)}, ${(+last.lon).toFixed(3)} ↗</a>` : "";
    App.modal({
      title: id ? (id.name || id.email) : `Visitor ${vid.slice(0, 8)}`,
      wide: true,
      cancelLabel: "Close",
      extraFoot: `<button class="btn btn--ghost" style="margin-right:auto" onclick="App.closeModal();WA.addFilter('vid','${H(vid)}')">Filter dashboard to this visitor</button>`,
      bodyHTML: `
        <div class="wa-prof">
          <div>
            <div class="section-title" style="margin-top:0">Who</div>
            ${id ? kv("Name", H(id.name)) + kv("Email", id.email ? `<a href="mailto:${H(id.email)}">${H(id.email)}</a>` : "") + kv("Identified via", H(id.source)) : kv("Identity", "Anonymous — becomes known if they submit a form")}
            ${kv("Visitor ID", `<span class="mono">${H(vid)}</span>`)}
            ${kv("First seen", when(firstPv.ts))}
            ${kv("Last seen", when(last.last_seen || last.ts) + " (" + ago(last.last_seen || last.ts) + ")")}
            ${kv("Sessions in range", bySess.size)}
            ${kv("Lifetime visits", last.visit_num)}
            <div class="section-title">Where</div>
            ${kv("Location", flag(last.country) + " " + H(place(last)))}
            ${kv("ZIP / postal", H(last.postal))}
            ${kv("Coordinates", mapsLink)}
            ${kv("IP timezone", H(last.timezone))}
            ${kv("IP address", `<span class="mono">${H(last.ip)}</span>`)}
            ${kv("Network / org", H([last.org, last.asn].filter(Boolean).join(" · ")))}
            ${kv("Vercel edge", H(last.edge_region))}
          </div>
          <div>
            <div class="section-title" style="margin-top:0">How they found you</div>
            ${kv("First channel", H(firstPv.channel))}
            ${kv("First source", H(firstPv.source))}
            ${kv("First referrer", firstPv.s_referrer ? `<a href="${H(firstPv.s_referrer)}" target="_blank" rel="noopener noreferrer">${H(firstPv.s_referrer)}</a>` : "")}
            ${kv("UTMs", H([firstPv.utm_source, firstPv.utm_medium, firstPv.utm_campaign, firstPv.utm_term, firstPv.utm_content].filter(Boolean).join(" / ")))}
            ${kv("Ad click", firstPv.click_id_type ? H(firstPv.click_id_type) + ` <span class="mono muted">${H((firstPv.click_id || "").slice(0, 24))}…</span>` : "")}
            ${kv("Landing page", H(firstPv.s_landing))}
            <div class="section-title">Device</div>
            ${kv("Device", devIco(last.device) + " " + H(last.device))}
            ${kv("Browser", H([last.browser, last.browser_version].filter(Boolean).join(" ")))}
            ${kv("OS", H([last.os, last.os_version].filter(Boolean).join(" ")))}
            ${kv("Screen", H(last.screen) + (last.dpr ? ` @${last.dpr}x` : ""))}
            ${kv("Viewport", H(last.viewport))}
            ${kv("Language", H(last.languages || last.lang))}
            ${kv("Browser timezone", H(last.tz))}
            ${kv("Connection", H(last.connection))}
            ${kv("Theme", H(last.color_scheme))}
            ${last.is_bot ? kv("Bot", "⚠️ flagged as bot / automation") : ""}
            <details class="wa-ua"><summary>User agent</summary><code>${H(last.ua)}</code></details>
          </div>
        </div>
        <div class="section-title">Visit timeline</div>
        ${sessHtml}`,
    });
  };

  /* ---------------- maps (Leaflet, lazy-loaded) ---------------- */
  let leafletP = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletP) return leafletP;
    leafletP = new Promise((res, rej) => {
      const css = document.createElement("link"); css.rel = "stylesheet"; css.href = window.WA_LEAFLET_CSS || "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; document.head.appendChild(css);
      const s = document.createElement("script"); s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"; s.onload = () => res(window.L); s.onerror = rej; document.head.appendChild(s);
    });
    return leafletP;
  }
  function baseMap(el, opts = {}) {
    const map = L.map(el, { scrollWheelZoom: false, worldCopyJump: true, zoomControl: true, attributionControl: true, ...opts });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { attribution: "&copy; OpenStreetMap &copy; CARTO", maxZoom: 18, subdomains: "abcd" }).addTo(map);
    return map;
  }
  function cityPoints(sessions) {
    const m = new Map();
    for (const s of sessions) {
      const f = s.first;
      if (f.lat == null || f.lon == null) continue;
      const key = (f.city || "") + "|" + (f.region || "") + "|" + (f.country || "") + "|" + (+f.lat).toFixed(1) + "," + (+f.lon).toFixed(1);
      let g = m.get(key);
      if (!g) { g = { lat: +f.lat, lon: +f.lon, label: place(f), country: f.country, visitors: new Set(), sessions: 0, pv: 0, channels: {} }; m.set(key, g); }
      g.visitors.add(s.vid); g.sessions++; g.pv += s.pvs.length; g.channels[f.channel] = (g.channels[f.channel] || 0) + 1;
    }
    return [...m.values()].map((g) => ({ ...g, visitors: g.visitors.size }));
  }
  WA.drawMap = async function (A) {
    const el = $("#wa-map");
    if (!el) return;
    try { await loadLeaflet(); } catch (e) { el.innerHTML = `<div class="t-empty">Map couldn't load.</div>`; return; }
    if (!document.body.contains(el)) return;
    if (this.map) { this.map.remove(); this.map = null; }
    const pts = cityPoints(A.sess);
    this.map = baseMap(el);
    const max = Math.max(1, ...pts.map((p) => p.visitors));
    const bounds = [];
    pts.sort((a, b) => b.visitors - a.visitors).forEach((p) => {
      const r = 6 + Math.sqrt(p.visitors / max) * 22;
      const top = Object.entries(p.channels).sort((a, b) => b[1] - a[1])[0];
      L.circleMarker([p.lat, p.lon], { radius: r, color: "#0526c5", weight: 2, fillColor: CH_COLORS[top && top[0]] || "#f37847", fillOpacity: 0.65 })
        .bindPopup(`<b>${flag(p.country)} ${H(p.label)}</b><br>${p.visitors} visitor${p.visitors > 1 ? "s" : ""} · ${p.sessions} session${p.sessions > 1 ? "s" : ""} · ${p.pv} pageviews<br><span style="color:#6b6b86">${Object.entries(p.channels).sort((a, b) => b[1] - a[1]).map(([k, v]) => H(k) + " " + v).join(" · ")}</span>`)
        .addTo(this.map);
      bounds.push([p.lat, p.lon]);
    });
    if (bounds.length === 1) this.map.setView(bounds[0], 8);
    else if (bounds.length) this.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 9 });
    else this.map.setView([39.5, -98.35], 3);
    setTimeout(() => this.map && this.map.invalidateSize(), 50);
  };

  /* ---------------- live: who's on the site right now ---------------- */
  WA.startLive = function () {
    clearInterval(this.liveTimer);
    this.pollLive();
    this.liveTimer = setInterval(() => { if (App.view === "website" && !document.hidden) this.pollLive(); }, 10000);
  };
  WA.pollLive = async function () {
    const el = $("#wa-live");
    if (!el) return;
    let rows = [];
    try {
      const { data, error } = await this.sb().from("wa_events").select("*").eq("kind", "pageview").gte("last_seen", new Date(Date.now() - 120000).toISOString()).order("last_seen", { ascending: false }).limit(500);
      if (error) throw error;
      rows = data || [];
    } catch (e) { el.innerHTML = ""; return; }
    rows.forEach((r) => { r.channel = channel(r); r.source = sourceLabel(r); });
    if (!this.includeBots) rows = rows.filter((r) => !r.is_bot);
    // one card per session: most recent page they're on
    const bySid = new Map();
    for (const r of rows) if (!bySid.has(r.sid)) bySid.set(r.sid, r);
    const live = [...bySid.values()].filter((r) => Date.now() - new Date(r.last_seen).getTime() < 75000);
    // session start time + pages in session (from the loaded window if we have it)
    const sessInfo = (sid) => { const pv = this.rows.filter((x) => x.sid === sid && x.kind === "pageview"); return { pages: pv.length, start: pv.length ? Math.min(...pv.map((x) => x._t)) : null }; };
    const was = this._liveCount;
    this._liveCount = live.length;
    el.innerHTML = `
      <div class="panel wa-livepanel">
        <div class="panel__head"><h3><span class="wa-pulse ${live.length ? "on" : ""}"></span>${live.length} on the site right now</h3><span class="spacer"></span><span class="muted" style="font-size:12px">updates every 10s</span></div>
        ${live.length ? `<div class="wa-livegrid"><div id="wa-livemap" class="wa-livemap"></div><div class="wa-livelist">${live.map((r) => {
          const id = this.ids[r.vid]; const si = sessInfo(r.sid);
          return `<button class="wa-livecard" onclick="WA.visitorModal('${H(r.vid)}','${H(r.sid)}')">
            <div><b>${flag(r.country)} ${H(place(r))}</b>${id ? ` · <span style="color:var(--coral-deep)">${H(id.name || id.email)}</span>` : ""}</div>
            <div class="muted">on <b style="color:var(--ink)">${H(r.path)}</b>${si.pages > 1 ? ` · ${si.pages} pages` : ""} · ${dur(Date.now() - Math.min(si.start || Infinity, new Date(r.ts).getTime()))} on site</div>
            <div class="muted">${devIco(r.device)} ${H(r.browser)} · ${H(r.os)} · via <b style="color:var(--ink)">${H(r.source)}</b>${(r.visit_num || 1) > 1 ? ` · visit #${r.visit_num}` : " · first visit"}</div>
          </button>`;
        }).join("")}</div></div>` : `<div class="muted" style="font-size:14px">Nobody's on whatchadrinking.com this minute. ${this.deviceExcluded() ? "(Your own visits from this device are excluded.)" : ""}</div>`}
      </div>`;
    if (live.length) {
      try {
        await loadLeaflet();
        const mEl = $("#wa-livemap");
        if (!mEl) return;
        if (this.liveMap) { this.liveMap.remove(); this.liveMap = null; }
        this.liveMap = baseMap(mEl, { zoomControl: false });
        const b = [];
        live.forEach((r) => { if (r.lat == null) return; b.push([r.lat, r.lon]); L.circleMarker([r.lat, r.lon], { radius: 9, color: "#fff", weight: 3, fillColor: "#f37847", fillOpacity: 1 }).bindTooltip(`${H(place(r))} · ${H(r.path)}`).addTo(this.liveMap); });
        if (b.length === 1) this.liveMap.setView(b[0], 6); else if (b.length) this.liveMap.fitBounds(b, { padding: [24, 24], maxZoom: 7 }); else this.liveMap.setView([39.5, -98.35], 3);
      } catch (e) {}
    }
    if (was != null && live.length > was && App.view === "website") App.toast(`👀 ${live.length} live on the site`);
  };

  /* ---------------- export ---------------- */
  WA.exportCSV = function () {
    const since = this.since().getTime();
    const rows = this.rows.filter((r) => r._t >= since && this.passes(r));
    if (!rows.length) return App.toast("Nothing to export", "err");
    const cols = ["ts", "kind", "name", "channel", "source", "path", "query", "title", "referrer", "s_referrer", "s_ref_domain", "s_landing", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "click_id_type", "click_id", "city", "region", "postal", "country", "lat", "lon", "timezone", "ip", "org", "asn", "device", "browser", "browser_version", "os", "os_version", "screen", "viewport", "lang", "tz", "engaged_ms", "scroll_pct", "visit_num", "is_landing", "is_bot", "vid", "sid", "email", "person", "props"];
    const q = (v) => { if (v == null) return ""; const s = typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [cols.join(",")].concat(rows.map((r) => { const id = this.ids[r.vid] || {}; const x = { ...r, email: id.email, person: id.name }; return cols.map((c) => q(x[c])).join(","); }));
    App.saveFile(`whatcha-website-${this.range}-${new Date().toISOString().slice(0, 10)}.csv`, lines.join("\n"), "text/csv");
  };

  /* ---------------- exclude Ben's own devices ---------------- */
  WA.deviceExcluded = function () { try { return localStorage.getItem("wa_ignore") === "1"; } catch (e) { return false; } };
  WA.excludeThisDevice = function (on, manual) {
    try {
      if (manual) localStorage.setItem("wa_ignore_auto", on ? "on" : "off");
      if (!manual && localStorage.getItem("wa_ignore_auto") === "off") return;
      if (on) localStorage.setItem("wa_ignore", "1"); else localStorage.removeItem("wa_ignore");
    } catch (e) {}
    if (manual) { App.toast(on ? "This device won't be tracked" : "This device will be tracked"); this.renderBody(); }
  };

  /* ---------------- wire into the app ---------------- */
  App.NAV.splice(1, 0, { id: "website", label: "Website", ico: "🌐" });
  const origGo = App.go;
  App.go = function (view) {
    if (view !== "website") { WA.stop(); return origGo.call(this, view); }
    this.view = view;
    if (location.hash !== "#website") location.hash = "website";
    this.renderNav();
    $("#topbar-title").textContent = "Website Analytics";
    this.closeMobileNav && this.closeMobileNav();
    WA.render();
    const main = $(".main"); if (main) main.scrollTop = 0; window.scrollTo(0, 0);
  };
  const origShow = App.showApp;
  App.showApp = function () { WA.excludeThisDevice(true); return origShow.apply(this, arguments); };
})();
