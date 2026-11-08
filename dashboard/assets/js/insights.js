/* ============================================================
   Whatcha HQ — order-trend insights engine (pure logic, no DOM)

   Turns the orders in the dashboard (mostly distributor-report imports)
   into plain-English findings: momentum, who's due to reorder, who's gone
   quiet, biggest movers, where you sell, and whether distributor data is stale.

   Everything is measured against the LATEST date in the data — not today —
   because distributor reports lag. Judging "overdue" against today would
   make every account look dead the moment a report is a few weeks old.
   ============================================================ */
const Insights = {
  PERIODS: [["30", "Last 30 days"], ["90", "Last 90 days"], ["180", "Last 6 months"], ["365", "Last 12 months"], ["all", "All time"]],

  _t(iso) { return Date.parse(iso + "T12:00:00Z"); },
  _add(iso, d) { return new Date(this._t(iso) + d * 86400000).toISOString().slice(0, 10); },
  _days(a, b) { return Math.round((this._t(b) - this._t(a)) / 86400000); },
  _weekStart(iso) { const dow = (new Date(this._t(iso)).getUTCDay() + 6) % 7; return this._add(iso, -dow); }, // Monday
  _median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; },
  _pct(a, b) { return b ? ((a - b) / b) * 100 : null; },
  fc(n) { n = Math.round((n || 0) * 10) / 10; return n.toLocaleString("en-US"); },
  fd(iso) { return iso ? new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—"; },

  compute(opts = {}) {
    const dist = opts.dist || "all", period = String(opts.period || "90");
    const all = DB.pricedOrders().filter((o) => dist === "all" || o.distributor_id === dist);
    if (!all.length) return { empty: true };
    const sum = (arr, f) => arr.reduce((a, o) => a + f(o), 0);

    const dates = all.map((o) => o.date).sort();
    const first = dates[0], asOf = dates[dates.length - 1];
    const days = period === "all" ? Math.max(this._days(first, asOf) + 1, 1) : +period;
    const curStart = period === "all" ? first : this._add(asOf, -(days - 1));
    const prevEnd = this._add(curStart, -1), prevStart = this._add(curStart, -days);
    const hasPrev = period !== "all" && first <= prevEnd;
    const inCur = (o) => o.date >= curStart && o.date <= asOf;
    const cur = all.filter(inCur);
    const prev = hasPrev ? all.filter((o) => o.date >= prevStart && o.date <= prevEnd) : [];

    /* ---- headline numbers ---- */
    const k = {
      cases: sum(cur, (o) => o.cases), prevCases: sum(prev, (o) => o.cases),
      revenue: sum(cur, (o) => o.total), prevRevenue: sum(prev, (o) => o.total),
      orders: cur.length, prevOrders: prev.length,
      stores: new Set(cur.map((o) => o.store_id)).size, prevStores: new Set(prev.map((o) => o.store_id)).size,
    };
    k.avgOrder = k.orders ? k.cases / k.orders : 0; k.prevAvgOrder = k.prevOrders ? k.prevCases / k.prevOrders : 0;

    /* ---- trend series ---- */
    const useMonths = days > 200;
    const keyOf = (d) => (useMonths ? d.slice(0, 7) : this._weekStart(d));
    const trendMap = new Map();
    if (useMonths) { for (let d = curStart.slice(0, 7) + "-01"; d.slice(0, 7) <= asOf.slice(0, 7); d = this._add(d.slice(0, 7) + "-28", 4).slice(0, 7) + "-01") trendMap.set(d.slice(0, 7), 0); }
    else { for (let d = this._weekStart(curStart); d <= asOf; d = this._add(d, 7)) trendMap.set(d, 0); }
    cur.forEach((o) => { const kk = keyOf(o.date); trendMap.set(kk, (trendMap.get(kk) || 0) + o.cases); });
    const trend = [...trendMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value }));

    // flavor mix by month (up to the last 12 months in the window)
    const prodNames = [...new Set(cur.flatMap((o) => o.lines.map((l) => l.product_name)))];
    const monthMap = new Map();
    cur.forEach((o) => { const m = o.date.slice(0, 7); const e = monthMap.get(m) || {}; o.lines.forEach((l) => { e[l.product_name] = (e[l.product_name] || 0) + (l.cases || 0); }); monthMap.set(m, e); });
    const flavorByMonth = [...monthMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12).map(([label, values]) => ({ label, values }));

    const mixOf = (arr) => { const m = {}; let t = 0; arr.forEach((o) => o.lines.forEach((l) => { m[l.product_name] = (m[l.product_name] || 0) + (l.cases || 0); t += l.cases || 0; })); return { m, t }; };
    const mixCur = mixOf(cur), mixPrev = mixOf(prev);
    const productMix = prodNames.map((n) => ({ name: n, cases: mixCur.m[n] || 0, share: mixCur.t ? (mixCur.m[n] || 0) / mixCur.t : 0, prevShare: mixPrev.t ? (mixPrev.m[n] || 0) / mixPrev.t : null })).sort((a, b) => b.cases - a.cases);

    /* ---- per-account rhythm ---- */
    // Each distributor's report ends on a different date. Judge an account against ITS
    // distributor's cutoff — otherwise one stale report makes healthy stores look dead.
    const distAsOf = new Map();
    all.forEach((o) => { const d = o.distributor_id || "_"; if (!distAsOf.has(d) || o.date > distAsOf.get(d)) distAsOf.set(d, o.date); });
    const byStore = new Map();
    all.forEach((o) => { let s = byStore.get(o.store_id); if (!s) byStore.set(o.store_id, (s = { id: o.store_id, name: o.store_name, state: o.state, orders: [] })); s.orders.push(o); });
    const accts = [];
    byStore.forEach((s) => {
      const ds = [...new Set(s.orders.map((o) => o.date))].sort(); const n = ds.length;
      const gaps = []; for (let i = 1; i < n; i++) gaps.push(this._days(ds[i - 1], ds[i]));
      const med = gaps.length ? Math.max(this._median(gaps), 7) : null;
      const total = sum(s.orders, (o) => o.cases), last = ds[n - 1], firstD = ds[0];
      const curC = sum(s.orders.filter(inCur), (o) => o.cases);
      const prevC = hasPrev ? sum(s.orders.filter((o) => o.date >= prevStart && o.date <= prevEnd), (o) => o.cases) : 0;
      const lastOrder = s.orders.reduce((a, b) => (a.date >= b.date ? a : b));
      const acctAsOf = distAsOf.get(lastOrder.distributor_id || "_") || asOf;
      const stale = this._days(acctAsOf, asOf) > 35; // their distributor's data stopped a while ago
      const daysSince = this._days(last, acctAsOf), avgOrder = total / n;
      let status = "ontrack", ratio = null;
      if (stale) status = "stale";
      else if (n >= 2) { ratio = daysSince / med; status = ratio < 0.85 ? "ontrack" : ratio < 1.3 ? "due" : ratio < 2 ? "overdue" : "quiet"; }
      else status = daysSince <= 45 ? "new" : daysSince <= 120 ? "noreorder" : "quiet";
      const st = DB.store(s.id);
      accts.push({ id: s.id, name: s.name, city: st ? st.city : "", state: s.state, accountStatus: st ? st.status : "", n, first: firstD, last, daysSince, med, ratio, expected: med ? this._add(last, Math.round(med)) : null, total, avgOrder, curC, prevC, delta: curC - prevC, status, stale, asOf: acctAsOf });
    });
    const rank = { overdue: 0, due: 1, quiet: 2, noreorder: 3 };
    const watch = accts.filter((a) => a.status in rank && a.accountStatus !== "inactive").sort((a, b) => rank[a.status] - rank[b.status] || b.avgOrder - a.avgOrder);
    const gainers = hasPrev ? accts.filter((a) => a.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 6) : [];
    const decliners = hasPrev ? accts.filter((a) => a.delta < 0 && a.prevC > 0 && !a.stale).sort((a, b) => a.delta - b.delta).slice(0, 6) : [];
    const staleAccts = accts.filter((a) => a.stale).length;
    const firstSeen = accts.filter((a) => a.first >= curStart && hasPrev).sort((a, b) => b.curC - a.curC);

    /* ---- where it sells ---- */
    const stMap = new Map(), cityMap = new Map();
    cur.forEach((o) => {
      const s = DB.store(o.store_id), city = s && s.city ? s.city + ", " + o.state : o.state;
      let e = stMap.get(o.state); if (!e) stMap.set(o.state, (e = { label: o.state, cases: 0, stores: new Set(), prev: 0 })); e.cases += o.cases; e.stores.add(o.store_id);
      let c = cityMap.get(city); if (!c) cityMap.set(city, (c = { label: city, cases: 0, stores: new Set() })); c.cases += o.cases; c.stores.add(o.store_id);
    });
    prev.forEach((o) => { const e = stMap.get(o.state); if (e) e.prev += o.cases; else stMap.set(o.state, { label: o.state, cases: 0, stores: new Set(), prev: o.cases }); });
    const byState = [...stMap.values()].map((e) => ({ label: e.label, cases: e.cases, stores: e.stores.size, prev: e.prev, change: this._pct(e.cases, e.prev) })).sort((a, b) => b.cases - a.cases);
    const byCity = [...cityMap.values()].map((c) => ({ label: c.label, cases: c.cases, stores: c.stores.size })).sort((a, b) => b.cases - a.cases).slice(0, 10);

    /* ---- distributor scorecard (always for the whole book so you can compare) ---- */
    const todayIso = new Date().toISOString().slice(0, 10);
    const everyOrder = DB.pricedOrders();
    const distributors = DB.distributors().map((d) => {
      const mine = everyOrder.filter((o) => o.distributor_id === d.id); if (!mine.length) return { id: d.id, name: d.name, empty: true };
      const dAsOf = mine.map((o) => o.date).sort().pop();
      const c = mine.filter((o) => o.date >= curStart && o.date <= asOf), p = hasPrev ? mine.filter((o) => o.date >= prevStart && o.date <= prevEnd) : [];
      return { id: d.id, name: d.name, state: d.state, cases: sum(c, (o) => o.cases), prev: sum(p, (o) => o.cases), stores: new Set(c.map((o) => o.store_id)).size, orders: c.length, avg: c.length ? sum(c, (o) => o.cases) / c.length : 0, last: dAsOf, stale: this._days(dAsOf, todayIso) };
    });

    const sorted = cur.length ? [...new Map(cur.map((o) => [o.store_id, 0])).keys()] : [];
    const caseByStore = new Map(); cur.forEach((o) => caseByStore.set(o.store_id, (caseByStore.get(o.store_id) || 0) + o.cases));
    const topStores = [...caseByStore.entries()].map(([id, c]) => ({ id, name: (DB.store(id) || {}).name || "—", cases: c })).sort((a, b) => b.cases - a.cases);
    const top3Share = k.cases ? topStores.slice(0, 3).reduce((a, s) => a + s.cases, 0) / k.cases : 0;

    const r = { empty: false, dist, period, days, first, asOf, curStart, hasPrev, staleAccts, k, trend, trendUnit: useMonths ? "month" : "week", flavorByMonth, productMix, accts, watch, gainers, decliners, firstSeen, byState, byCity, distributors, topStores, top3Share, storesEver: byStore.size };
    r.stories = this.stories(r);
    return r;
  },

  /* ---------------- plain-English findings ---------------- */
  stories(r) {
    const S = [], fc = (n) => this.fc(n), k = r.k, nm = (a) => a.name;
    const lead = (arr, n = 3) => arr.slice(0, n).map(nm).join(", ");
    const ch = this._pct(k.cases, k.prevCases);

    const staleD = r.distributors.filter((d) => !d.empty && this._days(d.last, r.asOf) > 35);
    const undercount = staleD.length ? ` Heads up: ${staleD.map((d) => d.name + "'s data ends " + this.fd(d.last)).join(" and ")}, so this likely undercounts.` : "";
    if (r.hasPrev && k.prevCases > 0) {
      const up = ch >= 0, big = Math.abs(ch) >= 10;
      S.push({ ico: up ? "📈" : "📉", tone: !big ? "info" : up ? "good" : "warn", title: `Cases ${up ? "up" : "down"} ${Math.abs(Math.round(ch))}%`,
        text: `${fc(k.cases)} cases in the last ${r.days} days vs ${fc(k.prevCases)} in the ${r.days} before.${undercount}` });
    } else if (r.period === "all") {
      S.push({ ico: "📦", tone: "info", title: `${fc(k.cases)} cases to date`, text: `Since ${this.fd(r.first)} across ${r.storesEver} stores and ${k.orders} orders.` });
    } else {
      S.push({ ico: "📦", tone: "info", title: `${fc(k.cases)} cases`, text: `In the last ${r.days} days. There isn't enough earlier history yet to compare against.` });
    }

    const overdue = r.watch.filter((a) => a.status === "overdue" || a.status === "due");
    if (overdue.length) S.push({ ico: "⏰", tone: "warn", title: `${overdue.length} ${overdue.length === 1 ? "account is" : "accounts are"} due to reorder`, text: `Past their usual rhythm: ${lead(overdue)}${overdue.length > 3 ? " and " + (overdue.length - 3) + " more" : ""}. A quick check-in now beats a lost reorder.`, go: "watch" });
    const quiet = r.watch.filter((a) => a.status === "quiet");
    if (quiet.length) S.push({ ico: "🌙", tone: "warn", title: `${quiet.length} ${quiet.length === 1 ? "store has" : "stores have"} gone quiet`, text: `Ordered before, but it's been 2×+ their normal gap: ${lead(quiet)}${quiet.length > 3 ? "…" : ""}.`, go: "watch" });
    const one = r.watch.filter((a) => a.status === "noreorder");
    if (one.length) S.push({ ico: "🔁", tone: "info", title: `${one.length} ${one.length === 1 ? "store hasn't" : "stores haven't"} reordered yet`, text: `Placed one order and nothing since — the first reorder is the one that proves it's selling: ${lead(one)}${one.length > 3 ? "…" : ""}.`, go: "watch" });

    if (r.firstSeen.length) S.push({ ico: "🆕", tone: "good", title: `${r.firstSeen.length} new ${r.firstSeen.length === 1 ? "store" : "stores"} this period`, text: `First orders from ${lead(r.firstSeen)}${r.firstSeen.length > 3 ? " and " + (r.firstSeen.length - 3) + " more" : ""}.` });
    if (r.gainers.length) S.push({ ico: "🚀", tone: "good", title: `Biggest gainer: ${r.gainers[0].name}`, text: `+${fc(r.gainers[0].delta)} cases vs the prior period (${fc(r.gainers[0].prevC)} → ${fc(r.gainers[0].curC)}).` });
    if (r.decliners.length) S.push({ ico: "🔻", tone: "warn", title: `Biggest slowdown: ${r.decliners[0].name}`, text: `${fc(r.decliners[0].delta)} cases vs the prior period (${fc(r.decliners[0].prevC)} → ${fc(r.decliners[0].curC)}).` });

    if (r.productMix.length > 1) {
      const t = r.productMix[0], pts = t.prevShare != null ? Math.round((t.share - t.prevShare) * 100) : null;
      S.push({ ico: "🍹", tone: "info", title: `${t.name.replace("Spiked ", "")} leads at ${Math.round(t.share * 100)}%`, text: `${fc(t.cases)} of ${fc(k.cases)} cases${pts != null && Math.abs(pts) >= 2 ? `, ${pts > 0 ? "up" : "down"} ${Math.abs(pts)} pts from the prior period` : ""}.` });
    }
    if (r.topStores.length >= 4 && k.cases) S.push({ ico: r.top3Share > 0.5 ? "⚠️" : "🧩", tone: r.top3Share > 0.5 ? "warn" : "info", title: `Top 3 accounts = ${Math.round(r.top3Share * 100)}% of cases`, text: r.top3Share > 0.5 ? `That's concentrated — losing one would sting. ${lead(r.topStores)}.` : `Healthy spread. Leaders: ${lead(r.topStores)}.` });

    const grow = r.byState.filter((s) => s.change != null && s.prev >= 5).sort((a, b) => b.change - a.change)[0];
    if (grow && grow.change > 15) S.push({ ico: "🗺️", tone: "good", title: `${grow.label} is heating up`, text: `+${Math.round(grow.change)}% cases (${fc(grow.prev)} → ${fc(grow.cases)}) across ${grow.stores} stores.` });

    if (r.k.prevOrders && Math.abs(k.avgOrder - k.prevAvgOrder) / (k.prevAvgOrder || 1) >= 0.15) {
      const up = k.avgOrder > k.prevAvgOrder;
      S.push({ ico: up ? "📦" : "🪶", tone: up ? "good" : "info", title: `Average order ${up ? "growing" : "shrinking"}`, text: `${fc(k.avgOrder)} cases per order vs ${fc(k.prevAvgOrder)} before.` });
    }
    r.distributors.filter((d) => !d.empty && d.stale > 35).forEach((d) => S.push({ ico: "📅", tone: "warn", title: `${d.name}'s data is ${d.stale} days old`, text: `Latest order on file is ${this.fd(d.last)}. Upload their newest report so these numbers stay current.`, go: "import" }));
    return S;
  },
};
window.Insights = Insights;
