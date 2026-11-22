/* ============================================================
   Whatcha HQ — Store map insights (Website → Store map tab)

   Reads the events the public Find Whatcha map sends:
     store_select      – someone tapped a store (card or pin)
     store_directions  – someone tapped "Get directions" (left the site for Apple/Google Maps)
     store_locator_search / store_locator_near_me – how they looked
   Turns them into: the most popular stores, how often interest becomes a
   directions tap, where the demand is coming from, and plain-English insights.
   ============================================================ */
(function () {
  if (typeof App === "undefined" || typeof WA === "undefined" || !WA.ui) return;
  const H = (s) => esc(s);
  const n0 = (n) => (n || 0).toLocaleString("en-US");
  const { panel, kpi, rankTable } = WA.ui;
  const miles = (a, b, c, d) => {
    const R = 3958.8, r = Math.PI / 180, dLat = (c - a) * r, dLng = (d - b) * r;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  };
  const DAY = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
  const place = (e) => [e.city, e.region].filter(Boolean).join(", ");

  function roster() {
    try { return DB.stores().filter((s) => s.status === "active" && s.show_on_map !== false); } catch (e) { return []; }
  }

  WA.storePane = function (A) {
    const evs = A.evs || [];
    const sel = evs.filter((e) => e.name === "store_select" && e.props && e.props.store);
    const dirAll = evs.filter((e) => e.name === "store_directions");
    const dirs = dirAll.filter((e) => e.props && e.props.store);
    const legacy = dirAll.length - dirs.length;
    const searches = evs.filter((e) => e.name === "store_locator_search");
    const nearMe = evs.filter((e) => e.name === "store_locator_near_me");
    const stores = roster();
    const byName = new Map(stores.map((s) => [norm(s.name), s]));

    // ---- per store ----
    const m = new Map();
    const row = (name, city, state) => {
      const k = norm(name);
      let g = m.get(k);
      if (!g) { const s = byName.get(k); g = { key: name, city: city || (s && s.city) || "", state: state || (s && s.state) || "", selects: 0, dirs: 0, people: new Set(), apple: 0, google: 0, last: 0, store: s || null }; m.set(k, g); }
      return g;
    };
    stores.forEach((s) => row(s.name, s.city, s.state));
    sel.forEach((e) => { row(e.props.store, e.props.city, e.props.state).selects++; });
    dirs.forEach((e) => {
      const g = row(e.props.store, e.props.city, e.props.state);
      g.dirs++; g.people.add(e.vid);
      if (e.props.maps === "apple") g.apple++; else g.google++;
      g.last = Math.max(g.last, e._t || new Date(e.ts).getTime());
    });
    const list = [...m.values()].map((g) => ({ ...g, people: g.people.size, rate: g.selects ? Math.min(100, Math.round((g.dirs / g.selects) * 100)) : null }));
    const ranked = list.filter((g) => g.dirs || g.selects).sort((a, b) => (b.dirs - a.dirs) || (b.selects - a.selects));
    const quiet = list.filter((g) => !g.dirs && !g.selects && g.store);

    const totalDirs = dirs.length;
    const people = new Set(dirs.map((e) => e.vid)).size;
    const selPeople = new Set(sel.map((e) => e.vid)).size;
    const conv = sel.length ? Math.min(100, Math.round((dirs.length / sel.length) * 100)) : 0;

    if (!totalDirs && !sel.length && !legacy) {
      return `${panel("No store-map activity yet", "", `<p class="muted" style="margin:0">As people use the Find Whatcha map, this tab fills in with which stores they tap, who asks for directions (that's the moment they leave the site for Apple or Google Maps), and what it means. Tracking starts with the latest website update — your own visits are excluded.${searches.length || nearMe.length ? ` So far there ${searches.length + nearMe.length === 1 ? "has been 1 search" : "have been " + (searches.length + nearMe.length) + " searches"}.` : ""}</p>`)}`;
    }

    // ---- insights ----
    const ins = [];
    const top = ranked.find((g) => g.dirs);
    if (top) ins.push(`<b>${H(top.key)}</b>${top.city ? ` (${H(top.city)})` : ""} is your most-wanted store: ${plural(top.dirs, "direction request")}${totalDirs ? `, ${Math.round((top.dirs / totalDirs) * 100)}% of all of them` : ""}.`);
    // towns
    const towns = new Map();
    dirs.forEach((e) => { const c = e.props.city; if (c) towns.set(c, (towns.get(c) || 0) + 1); });
    const topTown = [...towns.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topTown && towns.size > 1) ins.push(`Most directions requests are for stores in <b>${H(topTown[0])}</b> (${topTown[1]} of ${totalDirs}).`);
    // converters
    const conv3 = ranked.filter((g) => g.selects >= 3 && g.rate != null);
    const best = [...conv3].sort((a, b) => b.rate - a.rate)[0];
    if (best && best.rate >= 40) ins.push(`<b>${H(best.key)}</b> turns interest into action best — ${best.rate}% of people who look at it ask for directions.`);
    const leaky = conv3.filter((g) => g.selects >= 5 && g.rate < 20).sort((a, b) => b.selects - a.selects)[0];
    if (leaky) ins.push(`<b>${H(leaky.key)}</b> gets looked at (${leaky.selects}×) but rarely navigated to (${leaky.rate}%). Worth checking its address and that it still looks open and easy to find.`);
    // quiet stores
    if (quiet.length && stores.length) ins.push(`<b>${quiet.length} of your ${stores.length} mapped stores</b> haven't been tapped at all${quiet.length <= 6 ? ": " + quiet.slice(0, 6).map((g) => H(g.key)).join(", ") : ""}. Those are the ones to give shelf signage, a QR sticker or an ambassador visit.`);
    // distance
    const dist = [];
    dirs.forEach((e) => {
      const s = byName.get(norm(e.props.store)); if (!s || s.lat == null || e.lat == null || e.lon == null) return;
      dist.push(miles(e.lat, e.lon, +s.lat, +s.lng));
    });
    if (dist.length >= 3) {
      dist.sort((a, b) => a - b);
      const med = dist[Math.floor(dist.length / 2)], near = dist.filter((d) => d <= 15).length;
      ins.push(`Half of direction requests are for a store within <b>${Math.round(med)} miles</b> of the person asking; ${Math.round((near / dist.length) * 100)}% are within 15 miles${med <= 25 ? " — they're finding something local." : " — people are travelling for it."}`);
      const far = dist.filter((d) => d > 60).length;
      if (far >= 2) ins.push(`${plural(far, "request")} came from people over 60 miles away (travelers or visitors checking from home) — a sign people go out of their way for Whatcha.`);
    }
    // untapped demand: locator users far from every store
    const withGeo = stores.filter((s) => s.lat != null);
    if (withGeo.length) {
      const far = new Map();
      [...searches, ...nearMe, ...sel].forEach((e) => {
        if (e.lat == null || e.lon == null || !e.city) return;
        const d = Math.min(...withGeo.map((s) => miles(e.lat, e.lon, +s.lat, +s.lng)));
        if (d > 40) { const k = place(e); const g = far.get(k) || { n: 0, d }; g.n++; g.d = Math.min(g.d, d); far.set(k, g); }
      });
      const farList = [...far.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 4);
      if (farList.length) ins.push(`<b>Demand without a store nearby:</b> people used the map from ${farList.map(([k, g]) => `${H(k)} (~${Math.round(g.d)} mi from the closest stockist)`).join("; ")}. Strong places to open next.`);
    }
    // timing
    if (dirs.length >= 5) {
      const byDay = Array(7).fill(0); let eve = 0;
      dirs.forEach((e) => { const d = new Date(e.ts); byDay[d.getDay()]++; if (d.getHours() >= 17) eve++; });
      const bd = byDay.indexOf(Math.max(...byDay));
      ins.push(`People ask for directions most on <b>${DAY[bd]}</b>; ${Math.round((eve / dirs.length) * 100)}% do it after 5pm — they're planning the stop on the way.`);
    }
    // device
    if (dirs.length >= 5) {
      const mob = dirs.filter((e) => e.device === "mobile").length;
      const ap = dirs.filter((e) => e.props.maps === "apple").length;
      ins.push(`${Math.round((mob / dirs.length) * 100)}% of direction requests come from phones; ${Math.round((ap / dirs.length) * 100)}% open in Apple Maps, the rest in Google Maps.`);
    }
    // search demand
    if (selPeople && people) ins.push(`${Math.round((people / selPeople) * 100)}% of people who looked at a store went on to ask for directions.`);

    // ---- tables ----
    const via = (v) => dirs.filter((e) => e.props.via === v).length;
    const popular = rankTable(
      ranked.map((g) => ({ ...g, count: g.dirs })),
      { id: "stm", label: "Store", cols: [{ k: "dirs", label: "Directions" }, { k: "people", label: "People" }, { k: "selects", label: "Looked at" }, { k: "rate", label: "Taps → dir.", fmt: (v) => (v == null ? "—" : v + "%") }], max: 12,
        keyFmt: (r) => `<b>${H(r.key)}</b>${r.city ? `<span class="muted"> · ${H(r.city)}${r.state ? ", " + H(r.state) : ""}</span>` : ""}` });
    const townRows = [...towns.entries()].map(([k, n]) => ({ key: k, count: n })).sort((a, b) => b.count - a.count);
    const recent = dirs.slice().sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 12);
    const devIco = (d) => (d === "mobile" ? "📱" : d === "tablet" ? "📲" : "💻");
    const recentHtml = recent.length
      ? `<div class="table-wrap"><table class="data wa-tbl"><thead><tr><th class="no-sort">When</th><th class="no-sort">Store</th><th class="no-sort">From</th><th class="no-sort">Opened in</th></tr></thead><tbody>${recent.map((e) => `<tr><td class="mono">${new Date(e.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td><td><b>${H(e.props.store)}</b></td><td>${devIco(e.device)} ${H(place(e) || "Unknown")}</td><td>${e.props.maps === "apple" ? "Apple Maps" : "Google Maps"}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="t-empty">No directions requests with a store attached yet.</div>`;
    const quietHtml = quiet.length
      ? `<div class="hm-ign-wrap"><ul class="hm-ign">${quiet.slice(0, 20).map((g) => `<li>${H(g.key)}${g.city ? ` <span class="muted">· ${H(g.city)}</span>` : ""}</li>`).join("")}</ul></div>`
      : `<div class="t-empty">Every mapped store has been tapped at least once.</div>`;

    return `
      <div class="kpi-grid wa-kpis">
        ${kpi("Directions taps", n0(totalDirs), legacy ? `+${legacy} earlier (store unknown)` : "left for Apple / Google Maps", "kpi--accent", "", "Times someone tapped Get directions on a store — the moment they leave the site to go to it.")}
        ${kpi("People asking", n0(people), "unique visitors", "", "", "Different people who asked for directions.")}
        ${kpi("Stores looked at", n0(sel.length), `${n0(selPeople)} people`, "kpi--teal", "", "Taps on a store card or pin.")}
        ${kpi("Look → directions", conv + "%", "of store taps lead to directions", "", "", "Store taps that turned into a directions request.")}
        ${kpi("Searches", n0(searches.length + nearMe.length), `${n0(nearMe.length)} used Near me`, "", "", "ZIP searches plus Near me taps on the map.")}
      </div>

      ${panel("What this tells you", "plain-English takeaways", ins.length ? `<ul class="stm-ins">${ins.map((t) => `<li>${t}</li>`).join("")}</ul>` : `<p class="muted" style="margin:0">Takeaways appear once a few people have used the map.</p>`)}

      <div class="grid-2">
        ${panel("Most popular stores", "ranked by directions requests", popular)}
        ${panel("Popular towns", "directions requests by town", rankTable(townRows, { id: "stmt", label: "Town", cols: [{ k: "count", label: "Directions" }] }))}
      </div>

      <div class="grid-2">
        ${panel("Latest directions requests", "newest first", recentHtml)}
        ${panel("Mapped but not tapped yet", `${quiet.length} of ${stores.length} stores`, quietHtml)}
      </div>
      <p class="muted" style="font-size:12px;margin:6px 4px 0">A "directions request" is a tap on Get directions (or a second tap on a selected store): ${via("button")} via the list button, ${via("popup")} via the map pin popup, ${via("card")} via the card. Per-store tracking started with the latest website update.</p>`;
  };
})();
