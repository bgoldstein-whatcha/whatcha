/* ============================================================
   Whatcha Dashboard — data layer
   - Pricing engine (state-specific price points)
   - LocalBackend (localStorage, demo mode)  <-- active now
   - SupabaseBackend stub                    <-- flip on later
   - Analytics helpers
   All UI talks to `DB` only, so the backend can be swapped
   without touching app.js.
   ============================================================ */

const CONFIG = {
  // Flip to 'supabase' once keys are wired in config.js (see README).
  backend: (window.WHATCHA_CONFIG && window.WHATCHA_CONFIG.backend) || "local",
};

const uid = (p = "id") =>
  p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const todayISO = () => new Date().toISOString().slice(0, 10);

/* ---------- Seed data (realistic Whatcha demo) ---------- */
function seedData() {
  const products = [
    { id: "prd_peach", name: "Spiked Peach Lemonade", sku: "WH-PL-200", units_per_case: 24, active: true },
    { id: "prd_punch", name: "Spiked Tropical Punch", sku: "WH-TP-200", units_per_case: 24, active: true },
  ];

  // Price points = price PER CASE, by state + product. This is the
  // rate table the accounting math reads from.
  const pricing = [
    // Connecticut (home market — launch)
    { id: uid("px"), state: "CT", product_id: "prd_peach", case_price: 42.0 },
    { id: uid("px"), state: "CT", product_id: "prd_punch", case_price: 42.0 },
    // New York (higher price point)
    { id: uid("px"), state: "NY", product_id: "prd_peach", case_price: 46.5 },
    { id: uid("px"), state: "NY", product_id: "prd_punch", case_price: 46.5 },
    // Massachusetts
    { id: uid("px"), state: "MA", product_id: "prd_peach", case_price: 44.0 },
    { id: uid("px"), state: "MA", product_id: "prd_punch", case_price: 44.0 },
    // Rhode Island
    { id: uid("px"), state: "RI", product_id: "prd_peach", case_price: 43.0 },
    { id: uid("px"), state: "RI", product_id: "prd_punch", case_price: 43.0 },
  ];

  // coverage_type: 'statewide' covers every county in its state;
  // 'partial' covers only the listed counties (some distributors only
  // work part of a state). Recommendations are gated on this.
  const distributors = [
    { id: "dst_hartford", name: "Hartford Beverage Co.", state: "CT", contact_name: "Maria Colón", email: "orders@hartfordbev.example", phone: "(860) 555-0142",
      coverage_type: "partial", counties: ["Fairfield", "New Haven", "Hartford"], coverage_note: "Fairfield, New Haven & Hartford counties (not eastern/northwest CT)" },
    { id: "dst_empire", name: "Empire Craft Distributors", state: "NY", contact_name: "Devon Pryor", email: "buyers@empirecraft.example", phone: "(212) 555-0197",
      coverage_type: "partial", counties: ["New York", "Kings", "Queens", "Westchester"], coverage_note: "NYC — Manhattan, Brooklyn, Queens — plus Westchester" },
    { id: "dst_baystate", name: "Bay State Beverage", state: "MA", contact_name: "Kelly Nguyen", email: "purchasing@baystatebev.example", phone: "(617) 555-0123",
      coverage_type: "partial", counties: ["Suffolk", "Middlesex", "Norfolk", "Barnstable"], coverage_note: "Greater Boston + Cape Cod" },
  ];

  const S = (name, city, state, distributor_id, status, type, extra = {}) => ({
    id: uid("str"), name, city, state, distributor_id, status, type,
    contact_name: extra.contact_name || "", email: extra.email || "", phone: extra.phone || "",
    address: extra.address || "", notes: extra.notes || "", created_at: extra.created_at || todayISO(),
  });

  const stores = [
    S("Seaside Market & Wine", "Bridgeport", "CT", "dst_hartford", "active", "Retail", { contact_name: "Rob Alvarez", created_at: "2026-05-02" }),
    S("The Cabana Bar", "Bridgeport", "CT", "dst_hartford", "active", "Bar/Restaurant", { contact_name: "Tasha Bell", created_at: "2026-05-06" }),
    S("Fairfield Fine Wines", "Fairfield", "CT", "dst_hartford", "active", "Retail", { contact_name: "Greg Moon", created_at: "2026-05-19" }),
    S("Amphitheater Concessions", "Bridgeport", "CT", "dst_hartford", "active", "Venue", { contact_name: "Events Team", created_at: "2026-06-01", notes: "Launch venue — Hartford HealthCare Amphitheater." }),
    S("Shoreline Package Store", "New Haven", "CT", "dst_hartford", "active", "Retail", { created_at: "2026-06-10" }),
    S("Downtown Bottle Shop", "Stamford", "CT", "dst_hartford", "prospect", "Retail", { created_at: "2026-07-01" }),
    S("Village Craft Beer & Wine", "Brooklyn", "NY", "dst_empire", "active", "Retail", { contact_name: "Priya S.", created_at: "2026-06-15" }),
    S("Rooftop 88 Lounge", "New York", "NY", "dst_empire", "active", "Bar/Restaurant", { created_at: "2026-06-22" }),
    S("Hudson Provisions", "Hudson", "NY", "dst_empire", "lead", "Retail", { created_at: "2026-07-20" }),
    S("Back Bay Bottle", "Boston", "MA", "dst_baystate", "active", "Retail", { contact_name: "Liam O.", created_at: "2026-06-28" }),
    S("Cape Cod Beach Club", "Hyannis", "MA", "dst_baystate", "prospect", "Venue", { created_at: "2026-07-25" }),
    S("Ocean State Spirits", "Providence", "RI", "dst_hartford", "lead", "Retail", { created_at: "2026-08-01", notes: "No RI distributor yet — needs one assigned." }),
  ];

  // A couple of demo notes so the account activity log is self-explanatory
  stores[3].notes_log = [{ id: uid("note"), at: "2026-06-05T14:10:00Z", text: "Locked in the launch order — 20 cases each flavor for opening weekend. Events team handles reorders through Hartford Beverage." }];
  stores[5].notes_log = [{ id: uid("note"), at: "2026-07-01T16:30:00Z", text: "Manager liked the Tropical Punch. Wants a pricing sheet emailed before committing — follow up next week." }];

  // Orders (line items reference product + case qty; price resolved from state)
  const O = (store_id, date, items, distributor_id) => ({
    id: uid("ord"), store_id, distributor_id, date,
    items, // [{product_id, cases}]
    export_state: {}, // { distributorSyncId: 'exported' } — filled by export runs
    created_at: date,
  });
  const byId = (id) => stores.find((s) => s.id === id);
  const D = (s) => s.distributor_id;

  const orders = [
    O(stores[0].id, "2026-05-05", [{ product_id: "prd_peach", cases: 8 }, { product_id: "prd_punch", cases: 6 }], D(stores[0])),
    O(stores[1].id, "2026-05-09", [{ product_id: "prd_punch", cases: 10 }], D(stores[1])),
    O(stores[2].id, "2026-05-22", [{ product_id: "prd_peach", cases: 5 }, { product_id: "prd_punch", cases: 5 }], D(stores[2])),
    O(stores[0].id, "2026-06-02", [{ product_id: "prd_peach", cases: 6 }], D(stores[0])),
    O(stores[3].id, "2026-06-05", [{ product_id: "prd_peach", cases: 20 }, { product_id: "prd_punch", cases: 20 }], D(stores[3])),
    O(stores[4].id, "2026-06-14", [{ product_id: "prd_punch", cases: 7 }], D(stores[4])),
    O(stores[6].id, "2026-06-20", [{ product_id: "prd_peach", cases: 9 }, { product_id: "prd_punch", cases: 9 }], D(stores[6])),
    O(stores[1].id, "2026-06-24", [{ product_id: "prd_punch", cases: 12 }], D(stores[1])),
    O(stores[7].id, "2026-06-27", [{ product_id: "prd_peach", cases: 6 }], D(stores[7])),
    O(stores[9].id, "2026-07-01", [{ product_id: "prd_peach", cases: 8 }, { product_id: "prd_punch", cases: 8 }], D(stores[9])),
    O(stores[3].id, "2026-07-06", [{ product_id: "prd_peach", cases: 24 }, { product_id: "prd_punch", cases: 24 }], D(stores[3])),
    O(stores[0].id, "2026-07-12", [{ product_id: "prd_punch", cases: 10 }], D(stores[0])),
    O(stores[2].id, "2026-07-18", [{ product_id: "prd_peach", cases: 7 }, { product_id: "prd_punch", cases: 4 }], D(stores[2])),
    O(stores[6].id, "2026-07-21", [{ product_id: "prd_punch", cases: 11 }], D(stores[6])),
    O(stores[9].id, "2026-07-29", [{ product_id: "prd_peach", cases: 10 }], D(stores[9])),
    O(stores[4].id, "2026-08-02", [{ product_id: "prd_peach", cases: 6 }, { product_id: "prd_punch", cases: 6 }], D(stores[4])),
    O(stores[1].id, "2026-08-05", [{ product_id: "prd_punch", cases: 14 }], D(stores[1])),
    O(stores[3].id, "2026-08-08", [{ product_id: "prd_peach", cases: 18 }, { product_id: "prd_punch", cases: 18 }], D(stores[3])),
    O(stores[7].id, "2026-08-10", [{ product_id: "prd_peach", cases: 8 }], D(stores[7])),
  ];

  // Export log: each distributor export run records which orders went out & when.
  const exports = [];

  // Ben's own lead worklist (manual targets + saved recommendations).
  const leads = [
    { id: uid("lead"), name: "Downtown Stamford wine shop (scouting)", type: "Retail", city: "Stamford", state: "CT", status: "to_visit", priority: "high", note: "Foot traffic near the train-station bars looked strong. Walk in with samples.", source: "manual", created_at: "2026-08-08" },
    { id: uid("lead"), name: "Seaside beach club", type: "Venue", city: "Hyannis", state: "MA", status: "contacted", priority: "medium", note: "GM asked for a sample case before committing.", source: "manual", created_at: "2026-08-03" },
  ];

  return { products, pricing, distributors, stores, orders, exports, leads, dismissed_recs: [], meta: { seeded_at: new Date().toISOString() } };
}

/* ============================================================
   Recommendation knowledge base
   - COUNTY_BY_CITY resolves an account/POI city to its county so
     coverage + proximity can be reasoned about without lat/lng.
   - POIS: real demand anchors (universities, arenas, venues,
     nightlife, tourist draws) the engine scores opportunities around.
   ============================================================ */
const COUNTY_BY_CITY = {
  // CT
  "bridgeport|CT": "Fairfield", "fairfield|CT": "Fairfield", "stamford|CT": "Fairfield", "norwalk|CT": "Fairfield", "danbury|CT": "Fairfield", "greenwich|CT": "Fairfield", "westport|CT": "Fairfield",
  "new haven|CT": "New Haven", "west haven|CT": "New Haven", "hamden|CT": "New Haven", "milford|CT": "New Haven", "waterbury|CT": "New Haven",
  "hartford|CT": "Hartford", "new britain|CT": "Hartford", "west hartford|CT": "Hartford",
  "storrs|CT": "Tolland", "uncasville|CT": "New London", "mashantucket|CT": "New London", "new london|CT": "New London",
  // NY
  "new york|NY": "New York", "manhattan|NY": "New York", "brooklyn|NY": "Kings", "queens|NY": "Queens", "bronx|NY": "Bronx",
  "purchase|NY": "Westchester", "white plains|NY": "Westchester", "yonkers|NY": "Westchester", "hudson|NY": "Columbia", "albany|NY": "Albany",
  // MA
  "boston|MA": "Suffolk", "cambridge|MA": "Middlesex", "somerville|MA": "Middlesex", "brookline|MA": "Norfolk", "hyannis|MA": "Barnstable",
  // RI
  "providence|RI": "Providence", "kingston|RI": "Washington",
};

const POIS = [
  // Connecticut — Fairfield County (covered)
  { id: "poi_shu", name: "Sacred Heart University", type: "university", city: "Fairfield", state: "CT", audience: "~9,000 students" },
  { id: "poi_fairfieldu", name: "Fairfield University", type: "university", city: "Fairfield", state: "CT", audience: "~5,900 students" },
  { id: "poi_ubridge", name: "University of Bridgeport", type: "university", city: "Bridgeport", state: "CT", audience: "~5,000 students" },
  { id: "poi_totalmtg", name: "Total Mortgage Arena", type: "arena", city: "Bridgeport", state: "CT", audience: "10,000-seat arena — concerts & hockey" },
  { id: "poi_amp", name: "Hartford HealthCare Amphitheater", type: "venue", city: "Bridgeport", state: "CT", audience: "5,500-cap summer concert venue (your launch site)" },
  { id: "poi_stamford_night", name: "Downtown Stamford nightlife", type: "nightlife", city: "Stamford", state: "CT", audience: "Bedford St. bar & restaurant district" },
  // CT — New Haven County (covered)
  { id: "poi_yale", name: "Yale University", type: "university", city: "New Haven", state: "CT", audience: "~14,500 students" },
  { id: "poi_unewhaven", name: "University of New Haven", type: "university", city: "West Haven", state: "CT", audience: "~6,900 students" },
  { id: "poi_quinnipiac", name: "Quinnipiac University", type: "university", city: "Hamden", state: "CT", audience: "~9,000 students" },
  { id: "poi_newhaven_night", name: "Downtown New Haven (Crown St.)", type: "nightlife", city: "New Haven", state: "CT", audience: "Dense student bar & music district" },
  // CT — Hartford County (covered)
  { id: "poi_trinity", name: "Trinity College", type: "university", city: "Hartford", state: "CT", audience: "~2,200 students" },
  { id: "poi_xl", name: "PeoplesBank Arena", type: "arena", city: "Hartford", state: "CT", audience: "~15,000-seat downtown arena" },
  // CT — NOT covered (outside footprint — great anchors, no distribution)
  { id: "poi_uconn", name: "UConn (main campus)", type: "university", city: "Storrs", state: "CT", audience: "~27,000 students" },
  { id: "poi_mohegan", name: "Mohegan Sun", type: "casino", city: "Uncasville", state: "CT", audience: "Casino + 10,000-seat arena" },
  { id: "poi_foxwoods", name: "Foxwoods Resort Casino", type: "casino", city: "Mashantucket", state: "CT", audience: "Largest casino in the Northeast" },
  // New York — covered (NYC + Westchester)
  { id: "poi_nyu", name: "New York University", type: "university", city: "New York", state: "NY", audience: "~52,000 students" },
  { id: "poi_columbia", name: "Columbia University", type: "university", city: "New York", state: "NY", audience: "~36,000 students" },
  { id: "poi_msg", name: "Madison Square Garden", type: "arena", city: "New York", state: "NY", audience: "World's busiest arena" },
  { id: "poi_barclays", name: "Barclays Center", type: "arena", city: "Brooklyn", state: "NY", audience: "19,000-seat arena, Brooklyn" },
  { id: "poi_williamsburg", name: "Williamsburg nightlife", type: "nightlife", city: "Brooklyn", state: "NY", audience: "Bedford Ave bar & rooftop district" },
  { id: "poi_purchase", name: "SUNY Purchase", type: "university", city: "Purchase", state: "NY", audience: "~4,000 students" },
  // NY — NOT covered
  { id: "poi_fordham", name: "Fordham University", type: "university", city: "Bronx", state: "NY", audience: "~16,000 students (Bronx — outside coverage)" },
  // Massachusetts — covered (Greater Boston + Cape)
  { id: "poi_bu", name: "Boston University", type: "university", city: "Boston", state: "MA", audience: "~34,000 students" },
  { id: "poi_northeastern", name: "Northeastern University", type: "university", city: "Boston", state: "MA", audience: "~30,000 students" },
  { id: "poi_harvard_mit", name: "Harvard & MIT", type: "university", city: "Cambridge", state: "MA", audience: "~34,000 students combined" },
  { id: "poi_tdgarden", name: "TD Garden", type: "arena", city: "Boston", state: "MA", audience: "Celtics/Bruins — ~19,000 seats" },
  { id: "poi_fenway", name: "Fenway Park", type: "arena", city: "Boston", state: "MA", audience: "37,000-seat ballpark + Lansdowne St. bars" },
  { id: "poi_cape", name: "Cape Cod beaches (Hyannis)", type: "tourist", city: "Hyannis", state: "MA", audience: "Peak summer tourist traffic" },
  // Rhode Island — NO distributor at all yet
  { id: "poi_brown", name: "Brown University", type: "university", city: "Providence", state: "RI", audience: "~10,000 students (no RI distributor yet)" },
  { id: "poi_pvd_night", name: "Providence nightlife (Federal Hill)", type: "nightlife", city: "Providence", state: "RI", audience: "Dense bar & dining district" },
];

// Approx coordinates for each anchor — used to query real nearby
// businesses (OpenStreetMap) for specific store recommendations.
const POI_COORDS = {
  poi_shu: [41.223, -73.246], poi_fairfieldu: [41.163, -73.257], poi_ubridge: [41.164, -73.192],
  poi_totalmtg: [41.178, -73.188], poi_amp: [41.170, -73.190], poi_stamford_night: [41.052, -73.539],
  poi_yale: [41.311, -72.926], poi_unewhaven: [41.293, -72.962], poi_quinnipiac: [41.419, -72.896],
  poi_newhaven_night: [41.305, -72.928], poi_trinity: [41.745, -72.690], poi_xl: [41.767, -72.685],
  poi_uconn: [41.808, -72.250], poi_mohegan: [41.491, -72.090], poi_foxwoods: [41.474, -71.960],
  poi_nyu: [40.729, -73.996], poi_columbia: [40.807, -73.964], poi_msg: [40.750, -73.993],
  poi_barclays: [40.683, -73.976], poi_williamsburg: [40.714, -73.957], poi_purchase: [41.043, -73.703],
  poi_fordham: [40.861, -73.885], poi_bu: [42.350, -71.105], poi_northeastern: [42.340, -71.088],
  poi_harvard_mit: [42.373, -71.109], poi_tdgarden: [42.366, -71.062], poi_fenway: [42.346, -71.097],
  poi_cape: [41.653, -70.288], poi_brown: [41.826, -71.403], poi_pvd_night: [41.823, -71.412],
};

// Scoring metadata by anchor type: anchor pull + demographic fit for a
// 10% ABV ready-to-drink cocktail (skews young-adult / social).
const POI_TYPE_META = {
  university: { anchor: 40, demo: 30, label: "Student population" },
  arena:      { anchor: 34, demo: 26, label: "Event traffic" },
  venue:      { anchor: 32, demo: 26, label: "Live-event crowd" },
  casino:     { anchor: 30, demo: 22, label: "Destination traffic" },
  nightlife:  { anchor: 26, demo: 30, label: "Bar district" },
  tourist:    { anchor: 24, demo: 26, label: "Tourist traffic" },
  city:       { anchor: 22, demo: 22, label: "Urban density" },
};

/* ============================================================
   LocalBackend — persists to localStorage
   ============================================================ */
const LS_KEY = "whatcha_dashboard_v1";

const LocalBackend = {
  _state: null,
  _load() {
    if (this._state) return this._state;
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      try { this._state = JSON.parse(raw); } catch { this._state = seedData(); }
    } else {
      this._state = seedData();
      this._save();
    }
    return this._state;
  },
  _save() { localStorage.setItem(LS_KEY, JSON.stringify(this._state)); },
  reset() { this._state = seedData(); this._save(); },

  all(coll) { return JSON.parse(JSON.stringify(this._load()[coll] || [])); },
  raw(coll) { return this._load()[coll] || []; },

  insert(coll, row) {
    const s = this._load();
    if (!row.id) row.id = uid(coll.slice(0, 3));
    s[coll].push(row); this._save(); return row;
  },
  update(coll, id, patch) {
    const s = this._load();
    const i = s[coll].findIndex((r) => r.id === id);
    if (i >= 0) { s[coll][i] = { ...s[coll][i], ...patch }; this._save(); return s[coll][i]; }
    return null;
  },
  remove(coll, id) {
    const s = this._load();
    s[coll] = s[coll].filter((r) => r.id !== id); this._save();
  },
  replaceAll(coll, rows) { const s = this._load(); s[coll] = rows; this._save(); },
};

/* ============================================================
   SupabaseBackend — live cloud storage.
   Keeps the whole app synchronous by mirroring the user's rows in an
   in-memory cache (hydrated once at login). Reads are sync from the
   cache; writes update the cache immediately (optimistic) and persist
   to Supabase in the background. Same method surface as LocalBackend.
   ============================================================ */
const SupabaseBackend = {
  sb: null,
  _state: null,
  ready: false,
  COLLS: ["products", "pricing", "distributors", "stores", "orders", "exports", "leads"],

  init(client) { this.sb = client; },

  // Pull all of the logged-in user's rows into the cache. Seeds a minimal
  // starter set (products + CT pricing) the very first time.
  async hydrate() {
    const state = {};
    for (const c of this.COLLS) {
      const { data, error } = await this.sb.from(c).select("id,data");
      if (error) throw error;
      state[c] = (data || []).map((r) => ({ ...r.data, id: r.id }));
    }
    const kv = await this.sb.from("app_kv").select("value").eq("key", "dismissed_recs").maybeSingle();
    state.dismissed_recs = (kv.data && kv.data.value) || [];
    this._state = state;
    this.ready = true;
    if (!state.products.length) await this._seedInitial();
    return state;
  },

  async _seedInitial() {
    const seed = seedData();
    for (const row of seed.products) { this._state.products.push(row); await this._put("products", row); }
    for (const row of seed.pricing) { this._state.pricing.push(row); await this._put("pricing", row); }
  },

  async _put(coll, row) {
    const { error } = await this.sb.from(coll).upsert({ id: row.id, data: row });
    if (error) this._warn(error);
  },
  _warn(e) { try { window.App && App.toast && App.toast("Cloud save issue — check connection", "err"); } catch (x) {} console.warn("[supabase]", e); },

  _load() { return this._state; },
  _save() {
    // Only app-level kv (dismissed recs) needs a blanket save; rows persist per-write.
    if (!this._state) return;
    this.sb.from("app_kv").upsert({ key: "dismissed_recs", value: this._state.dismissed_recs || [] }).then(({ error }) => { if (error) this._warn(error); });
  },

  all(coll) { return JSON.parse(JSON.stringify(this._state[coll] || [])); },
  raw(coll) { return this._state[coll] || []; },

  insert(coll, row) {
    if (!row.id) row.id = uid(coll.slice(0, 3));
    this._state[coll].push(row);
    this._put(coll, row);
    return row;
  },
  update(coll, id, patch) {
    const i = this._state[coll].findIndex((r) => r.id === id);
    if (i < 0) return null;
    this._state[coll][i] = { ...this._state[coll][i], ...patch };
    this._put(coll, this._state[coll][i]);
    return this._state[coll][i];
  },
  remove(coll, id) {
    this._state[coll] = this._state[coll].filter((r) => r.id !== id);
    this.sb.from(coll).delete().eq("id", id).then(({ error }) => { if (error) this._warn(error); });
  },
  replaceAll(coll, rows) {
    this._state[coll] = rows;
    if (this.COLLS.includes(coll)) this.sb.from(coll).upsert(rows.map((r) => ({ id: r.id, data: r }))).then(({ error }) => { if (error) this._warn(error); });
  },
  reset() { this._warn({ message: "Reset is disabled in live mode." }); },
};

/* ============================================================
   DB facade + domain logic (pricing engine, analytics)
   ============================================================ */
const DB = {
  backend: CONFIG.backend === "supabase" ? SupabaseBackend : LocalBackend,
  mode: CONFIG.backend,

  // ---- passthrough collections ----
  products() { return this.backend.all("products"); },
  pricing() { return this.backend.all("pricing"); },
  distributors() { return this.backend.all("distributors"); },
  stores() { return this.backend.all("stores"); },
  orders() { return this.backend.all("orders"); },
  exports() { return this.backend.all("exports"); },

  product(id) { return this.products().find((p) => p.id === id); },
  distributor(id) { return this.distributors().find((d) => d.id === id); },
  store(id) { return this.stores().find((s) => s.id === id); },

  insert(c, r) { return this.backend.insert(c, r); },
  update(c, id, p) { return this.backend.update(c, id, p); },
  remove(c, id) { return this.backend.remove(c, id); },
  reset() { this.backend.reset(); },

  /* ---------- PRICING ENGINE ---------- */
  // Resolve case price for a (state, product). Falls back to any
  // price set for that product if the exact state isn't configured.
  casePrice(state, product_id) {
    const px = this.pricing();
    const exact = px.find((p) => p.state === state && p.product_id === product_id);
    if (exact) return { price: exact.case_price, resolved: "exact" };
    const anyForProduct = px.find((p) => p.product_id === product_id);
    if (anyForProduct) return { price: anyForProduct.case_price, resolved: "fallback" };
    return { price: 0, resolved: "missing" };
  },
  setPrice(state, product_id, case_price) {
    const existing = this.backend.raw("pricing").find((p) => p.state === state && p.product_id === product_id);
    if (existing) return this.update("pricing", existing.id, { case_price });
    return this.insert("pricing", { id: uid("px"), state, product_id, case_price });
  },

  // Compute a fully-priced order: line totals + grand total, using the
  // store's state to look up the rate table.
  priceOrder(order) {
    const store = this.store(order.store_id);
    const state = store ? store.state : "—";
    let total = 0, cases = 0, units = 0, hasMissing = false;
    const lines = (order.items || []).map((it) => {
      const prod = this.product(it.product_id);
      const { price, resolved } = this.casePrice(state, it.product_id);
      const lineTotal = price * (it.cases || 0);
      total += lineTotal; cases += it.cases || 0;
      units += (it.cases || 0) * (prod ? prod.units_per_case : 0);
      if (resolved === "missing") hasMissing = true;
      return { ...it, product_name: prod ? prod.name : "—", case_price: price, line_total: lineTotal, price_resolved: resolved };
    });
    return { ...order, store_name: store ? store.name : "—", state, lines, cases, units, total, hasMissing };
  },

  pricedOrders() { return this.orders().map((o) => this.priceOrder(o)); },

  /* ---------- ANALYTICS ---------- */
  analytics(opts = {}) {
    const { state = "all", distributor_id = "all", from = null, to = null } = opts;
    let ords = this.pricedOrders();
    if (state !== "all") ords = ords.filter((o) => o.state === state);
    if (distributor_id !== "all") ords = ords.filter((o) => o.distributor_id === distributor_id);
    if (from) ords = ords.filter((o) => o.date >= from);
    if (to) ords = ords.filter((o) => o.date <= to);

    const revenue = ords.reduce((a, o) => a + o.total, 0);
    const cases = ords.reduce((a, o) => a + o.cases, 0);
    const units = ords.reduce((a, o) => a + o.units, 0);
    const orderCount = ords.length;
    const aov = orderCount ? revenue / orderCount : 0;
    const aovCases = orderCount ? cases / orderCount : 0;

    // by month (revenue + cases)
    const monthMap = {}, monthCaseMap = {};
    ords.forEach((o) => { const m = o.date.slice(0, 7); monthMap[m] = (monthMap[m] || 0) + o.total; monthCaseMap[m] = (monthCaseMap[m] || 0) + o.cases; });
    const byMonth = Object.keys(monthMap).sort().map((m) => ({ label: m, value: monthMap[m] }));
    const casesByMonth = Object.keys(monthCaseMap).sort().map((m) => ({ label: m, value: monthCaseMap[m] }));

    // cases by product (for product mix emphasis)
    const prCaseMap = {};
    ords.forEach((o) => o.lines.forEach((l) => { prCaseMap[l.product_name] = (prCaseMap[l.product_name] || 0) + (l.cases || 0); }));
    const byProductCases = Object.entries(prCaseMap).map(([k, v]) => ({ label: k, value: v })).sort((a, b) => b.value - a.value);

    // by state
    const stMap = {};
    ords.forEach((o) => { stMap[o.state] = (stMap[o.state] || 0) + o.total; });
    const byState = Object.entries(stMap).map(([k, v]) => ({ label: k, value: v })).sort((a, b) => b.value - a.value);

    // by product
    const prMap = {};
    ords.forEach((o) => o.lines.forEach((l) => { prMap[l.product_name] = (prMap[l.product_name] || 0) + l.line_total; }));
    const byProduct = Object.entries(prMap).map(([k, v]) => ({ label: k, value: v })).sort((a, b) => b.value - a.value);

    // by distributor
    const dsMap = {};
    ords.forEach((o) => { const d = this.distributor(o.distributor_id); const n = d ? d.name : "Unassigned"; dsMap[n] = (dsMap[n] || 0) + o.total; });
    const byDistributor = Object.entries(dsMap).map(([k, v]) => ({ label: k, value: v })).sort((a, b) => b.value - a.value);

    // top accounts
    const acctMap = {};
    ords.forEach((o) => { acctMap[o.store_name] = (acctMap[o.store_name] || 0) + o.total; });
    const topAccounts = Object.entries(acctMap).map(([k, v]) => ({ label: k, value: v })).sort((a, b) => b.value - a.value).slice(0, 8);

    // top accounts by cases (emphasis on cases)
    const acctCaseMap = {};
    ords.forEach((o) => { acctCaseMap[o.store_name] = (acctCaseMap[o.store_name] || 0) + o.cases; });
    const topAccountsCases = Object.entries(acctCaseMap).map(([k, v]) => ({ label: k, value: v })).sort((a, b) => b.value - a.value).slice(0, 8);

    return { revenue, cases, units, orderCount, aov, aovCases, byMonth, casesByMonth, byState, byProduct, byProductCases, byDistributor, topAccounts, topAccountsCases, orders: ords };
  },

  // Account geography & counts — independent of the order filter.
  geography() {
    const stores = this.stores();
    const total = stores.length;
    const active = stores.filter((s) => s.status === "active").length;
    const leads = stores.filter((s) => s.status === "lead" || s.status === "prospect").length;
    const byStateMap = {}, byCityMap = {}, activeByStateMap = {};
    stores.forEach((s) => {
      byStateMap[s.state] = (byStateMap[s.state] || 0) + 1;
      if (s.status === "active") activeByStateMap[s.state] = (activeByStateMap[s.state] || 0) + 1;
      const city = (s.city || "—") + ", " + s.state;
      byCityMap[city] = (byCityMap[city] || 0) + 1;
    });
    const byState = Object.entries(byStateMap).map(([k, v]) => ({ label: k, value: v, active: activeByStateMap[k] || 0 })).sort((a, b) => b.value - a.value);
    const byCity = Object.entries(byCityMap).map(([k, v]) => ({ label: k, value: v })).sort((a, b) => b.value - a.value);
    const statusMap = {};
    stores.forEach((s) => { statusMap[s.status] = (statusMap[s.status] || 0) + 1; });
    return { total, active, leads, byState, byCity, byStatus: statusMap, stateCount: byState.length };
  },

  storeStats(store_id) {
    const ords = this.pricedOrders().filter((o) => o.store_id === store_id).sort((a, b) => a.date.localeCompare(b.date));
    const revenue = ords.reduce((a, o) => a + o.total, 0);
    const cases = ords.reduce((a, o) => a + o.cases, 0);
    return { orders: ords, revenue, cases, count: ords.length, last: ords.length ? ords[ords.length - 1].date : null };
  },

  /* ---------- ACCOUNT NOTES (timestamped log) ---------- */
  addNote(store_id, text) {
    const s = this.store(store_id); if (!s) return null;
    const log = (s.notes_log || []).slice();
    log.unshift({ id: uid("note"), at: new Date().toISOString(), text });
    return this.update("stores", store_id, { notes_log: log });
  },
  deleteNote(store_id, note_id) {
    const s = this.store(store_id); if (!s) return null;
    const log = (s.notes_log || []).filter((n) => n.id !== note_id);
    return this.update("stores", store_id, { notes_log: log });
  },

  /* ---------- LEADS ---------- */
  leads() { return this.backend.all("leads"); },
  lead(id) { return this.leads().find((l) => l.id === id); },

  /* ---------- COVERAGE ---------- */
  countyForCity(city, state) {
    if (!city || !state) return null;
    return COUNTY_BY_CITY[(city.trim().toLowerCase() + "|" + state)] || null;
  },
  // Which distributor (if any) covers a given county in a state.
  coverageForCounty(state, county) {
    return this.distributors().find((d) =>
      d.state === state && (d.coverage_type === "statewide" || (d.counties || []).includes(county))
    ) || null;
  },
  coverageLabel(dist, state) {
    if (!dist) return "";
    return dist.coverage_type === "statewide" ? state + " statewide" : (dist.coverage_note || (dist.counties || []).join(", "));
  },

  /* ---------- RECOMMENDATION ENGINE ---------- */
  // Scores real demand anchors (POIS) that sit inside your distributors'
  // coverage, using anchor strength, demographic fit, whitespace (gaps you
  // haven't filled) and momentum (nearby accounts already reordering).
  // Recomputes from live accounts every call, so it shifts as you add stores.
  recommendations() {
    const stores = this.stores();
    // Index active accounts by city and county.
    const activeByCity = {}, activeByCounty = {}, acctByCounty = {};
    stores.forEach((s) => {
      if (s.status !== "active") return;
      const ck = (s.city || "").trim().toLowerCase() + "|" + s.state;
      activeByCity[ck] = (activeByCity[ck] || 0) + 1;
      const county = this.countyForCity(s.city, s.state);
      if (county) {
        const key = s.state + "|" + county;
        activeByCounty[key] = (activeByCounty[key] || 0) + 1;
        (acctByCounty[key] = acctByCounty[key] || []).push(s);
      }
    });
    const dismissed = this.dismissedRecs();
    const savedPoi = new Set(this.leads().filter((l) => l.poi_id).map((l) => l.poi_id));

    const scored = POIS.filter((p) => !dismissed.includes(p.id)).map((poi) => {
      const county = this.countyForCity(poi.city, poi.state);
      const covering = county ? this.coverageForCounty(poi.state, county) : null;
      const meta = POI_TYPE_META[poi.type] || POI_TYPE_META.city;
      const cityKey = (poi.city || "").trim().toLowerCase() + "|" + poi.state;
      const countyKey = poi.state + "|" + county;
      const cityActive = activeByCity[cityKey] || 0;
      const countyActive = activeByCounty[countyKey] || 0;

      // score components
      const base = (meta.anchor + meta.demo) * 0.7;                 // anchor + demographic fit (~max 49)
      const whitespace = cityActive === 0 ? 22 : cityActive === 1 ? 10 : 3;
      const momentum = countyActive >= 2 ? 12 : countyActive === 1 ? 8 : 0;
      const saturation = cityActive >= 3 ? -12 : 0;
      const score = Math.max(5, Math.min(99, Math.round(base + whitespace + momentum + saturation)));
      const tier = score >= 72 ? "high" : score >= 52 ? "medium" : "watch";

      // proximity: an active account in the same county (prefers same city)
      const nearby = (acctByCounty[countyKey] || []);
      const nearest = nearby.find((s) => (s.city || "").toLowerCase() === (poi.city || "").toLowerCase()) || nearby[0] || null;

      // rationale
      const reasons = [];
      reasons.push(`${meta.label}: ${poi.audience}. This crowd skews to the 21–34 social drinkers that drive RTD cocktail sales.`);
      if (covering) reasons.push(`In ${covering.name}'s territory (${this.coverageLabel(covering, poi.state)}).`);
      if (cityActive === 0) reasons.push(`Whitespace — you have no active accounts in ${poi.city} yet.`);
      else reasons.push(`You already have ${cityActive} active account${cityActive > 1 ? "s" : ""} in ${poi.city} — room to add venues around this anchor.`);
      if (countyActive >= 1 && cityActive === 0) reasons.push(`Proven nearby: ${countyActive} active account${countyActive > 1 ? "s" : ""} in ${county} County already reordering.`);
      if (nearest && nearest.city && nearest.city.toLowerCase() !== poi.city.toLowerCase()) reasons.push(`Closest account: ${nearest.name} (${nearest.city}).`);

      const factors = [
        { label: "Anchor + fit", value: Math.round(base) },
        { label: "Whitespace", value: whitespace },
        { label: "Momentum", value: momentum },
      ];
      if (saturation) factors.push({ label: "Saturation", value: saturation });

      return {
        poi, county, covering, eligible: !!covering, score, tier, reasons, factors,
        cityActive, countyActive, saved: savedPoi.has(poi.id),
        blockedReason: covering ? null : (county ? `No distributor covers ${county} County (${poi.state}) yet — you'd need distribution here first.` : `${poi.state} isn't in your distribution footprint yet.`),
      };
    });

    const eligible = scored.filter((r) => r.eligible).sort((a, b) => b.score - a.score);
    const outside = scored.filter((r) => !r.eligible).sort((a, b) => (b.poi.type === "university") - (a.poi.type === "university"));
    return { eligible, outside };
  },
  dismissedRecs() { return this.backend._load().dismissed_recs || []; },
  dismissRec(poi_id) {
    const s = this.backend._load();
    s.dismissed_recs = s.dismissed_recs || [];
    if (!s.dismissed_recs.includes(poi_id)) s.dismissed_recs.push(poi_id);
    this.backend._save();
  },
  clearDismissed() { const s = this.backend._load(); s.dismissed_recs = []; this.backend._save(); },
  // Turn a recommendation into a saved lead in the worklist.
  promoteRecToLead(poi_id) {
    const poi = POIS.find((p) => p.id === poi_id); if (!poi) return null;
    if (this.leads().some((l) => l.poi_id === poi_id)) return null; // no dup
    const county = this.countyForCity(poi.city, poi.state);
    const covering = county ? this.coverageForCounty(poi.state, county) : null;
    return this.insert("leads", {
      id: uid("lead"), name: `Prospect near ${poi.name}`, type: poi.type === "university" ? "Retail / Bar" : "Venue / Bar",
      city: poi.city, state: poi.state, status: "to_visit", priority: "high",
      note: `Recommended opportunity zone. ${poi.audience}.`, source: "engine", poi_id: poi.id,
      distributor_id: covering ? covering.id : null, created_at: new Date().toISOString().slice(0, 10),
    });
  },

  /* ---------- INCREMENTAL DISTRIBUTOR EXPORT ---------- */
  // Which orders for a distributor have NOT been exported yet
  // (or changed since last export). Signature feature.
  pendingForDistributor(distributor_id) {
    return this.pricedOrders()
      .filter((o) => o.distributor_id === distributor_id)
      .filter((o) => !o.export_state || !o.export_state[distributor_id])
      .sort((a, b) => a.date.localeCompare(b.date));
  },
  lastExportFor(distributor_id) {
    const runs = this.exports().filter((e) => e.distributor_id === distributor_id).sort((a, b) => b.run_at.localeCompare(a.run_at));
    return runs[0] || null;
  },
  markExported(distributor_id, orderIds) {
    orderIds.forEach((oid) => {
      const o = this.backend.raw("orders").find((r) => r.id === oid);
      const es = Object.assign({}, o && o.export_state); es[distributor_id] = "exported";
      this.update("orders", oid, { export_state: es }); // routes through backend → persists per row
    });
    return this.insert("exports", {
      id: uid("exp"), distributor_id, run_at: new Date().toISOString(),
      order_ids: orderIds, count: orderIds.length,
    });
  },
};

window.DB = DB;
window.SupabaseBackend = SupabaseBackend;
window.POIS = POIS;
window.POI_COORDS = POI_COORDS;
window.POI_TYPE_META = POI_TYPE_META;
