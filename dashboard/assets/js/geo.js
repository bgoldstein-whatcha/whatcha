/* ============================================================
   Whatcha HQ — store geocoding (look an address up ONCE, save the coordinates)

   The public Find Whatcha map used to look every address up in the visitor's
   browser, one per second — slow, and rude to the free geocoder. Instead the
   dashboard resolves each active store's address once (OpenStreetMap Nominatim,
   ≤1 request/sec) and saves lat/lng on the account. The public map then draws
   pins instantly and can load whatever is in view as you pan.

   Geo.fill() is safe to call any time: it only touches active stores that have
   a street address + city and are missing coordinates (or whose address changed
   since they were looked up). It runs on sign-in and after saves/imports.
   ============================================================ */
const Geo = {
  busy: false,
  _key(s) { return [s.address, s.city, s.state].map((x) => String(x || "").trim().toLowerCase()).join("|"); },
  needs(s) {
    if (s.status !== "active" || !(s.address || "").trim() || !(s.city || "").trim()) return false;
    return s.lat == null || s.lng == null || s.geo_for !== this._key(s);
  },
  _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); },
  async _query(q) {
    try {
      const res = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=" + encodeURIComponent(q), { signal: AbortSignal.timeout(9000) });
      const g = await res.json(); return g && g[0] ? { lat: +g[0].lat, lng: +g[0].lon, label: g[0].display_name } : null;
    } catch (e) { return null; }
  },
  // Full address first; then without unit numbers / street-number ranges ("1140-42 South Ave" → "1140 South Ave").
  async lookup(s) {
    const full = [s.address, s.city, s.state].filter(Boolean).join(", ");
    let hit = await this._query(full);
    if (!hit) {
      const simple = [String(s.address).replace(/\s*(#|unit|ste|suite|apt)\.?\s*\S+/gi, "").replace(/(\d+)\s*-\s*\d+/, "$1"), s.city, s.state].filter(Boolean).join(", ");
      if (simple !== full) { await this._sleep(1100); hit = await this._query(simple); }
    }
    return hit;
  },
  // Process everything that needs it, slowly and politely. Returns {done, failed:[names]}.
  async fill(opts = {}) {
    if (this.busy || typeof DB === "undefined") return { done: 0, failed: [], skipped: true };
    this.busy = true;
    const failed = []; let done = 0;
    try {
      const todo = DB.stores().filter((s) => this.needs(s));
      if (todo.length && opts.toast !== false && window.App && App.toast) App.toast(`Locating ${todo.length} store${todo.length === 1 ? "" : "s"} for the map…`);
      for (const s0 of todo) {
        const s = DB.store(s0.id); if (!s || !this.needs(s)) continue; // may have changed while waiting
        const hit = await this.lookup(s);
        if (hit) { DB.update("stores", s.id, { lat: +hit.lat.toFixed(6), lng: +hit.lng.toFixed(6), geo_for: this._key(s) }); done++; }
        else failed.push(s.name);
        await this._sleep(1100);
      }
      if (failed.length && window.App && App.toast) App.toast(`Couldn't find ${failed.length} address${failed.length === 1 ? "" : "es"} on the map: ${failed.slice(0, 2).join(", ")}${failed.length > 2 ? "…" : ""}`, "err");
    } finally { this.busy = false; }
    return { done, failed };
  },
};
window.Geo = Geo;
