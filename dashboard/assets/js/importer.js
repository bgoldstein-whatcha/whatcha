/* ============================================================
   Whatcha HQ — distributor report importer (logic only, no DOM)

   Reads a distributor's sales spreadsheet (CSV / XLSX / XLS), works out
   what's in it, and turns it into orders + account updates:

     readFile → detectHeaderRow → guessMapping → parseRows
              → buildPlan  (match stores, dedupe, reconcile)  → apply

   Design rules:
   • Re-uploading the same (or a cumulative / corrected) report is SAFE —
     every order line gets a fingerprint, so nothing is ever double-counted.
   • Orders Ben already logged by hand are RECONCILED with the distributor's
     fulfilment line instead of being counted twice.
   • Nothing is written until the user reviews the plan and confirms.
   • Every import is logged and can be undone.
   ============================================================ */
const Importer = {
  /* ---------------- constants ---------------- */
  STATE_NAMES: "alabama:AL,alaska:AK,arizona:AZ,arkansas:AR,california:CA,colorado:CO,connecticut:CT,delaware:DE,district of columbia:DC,florida:FL,georgia:GA,hawaii:HI,idaho:ID,illinois:IL,indiana:IN,iowa:IA,kansas:KS,kentucky:KY,louisiana:LA,maine:ME,maryland:MD,massachusetts:MA,michigan:MI,minnesota:MN,mississippi:MS,missouri:MO,montana:MT,nebraska:NE,nevada:NV,new hampshire:NH,new jersey:NJ,new mexico:NM,new york:NY,north carolina:NC,north dakota:ND,ohio:OH,oklahoma:OK,oregon:OR,pennsylvania:PA,rhode island:RI,south carolina:SC,south dakota:SD,tennessee:TN,texas:TX,utah:UT,vermont:VT,virginia:VA,washington:WA,west virginia:WV,wisconsin:WI,wyoming:WY",
  STOP: new Set(["the", "and", "of", "inc", "llc", "ltd", "corp", "co", "company", "dba", "n", "a"]),
  // words too common to prove two names are the same store on their own
  GENERIC: new Set(["wine", "liquor", "spirit", "market", "package", "store", "shop", "bar", "grill", "restaurant", "deli", "tavern", "pub", "cafe", "pizza", "mart", "food", "beverage", "discount", "fine", "express", "super", "supermarket", "grocery", "convenience", "news", "gas", "bottle", "cellar", "wharf"]),
  ABBR: { mkt: "market", mrkt: "market", pkg: "package", pkge: "package", pkgs: "package", bev: "beverage", liq: "liquor", liqs: "liquor", lqr: "liquor", ws: "wine", wn: "wine", sp: "spirit" },

  _stateMap: null,
  // US state from a ZIP code's first three digits (for reports that have a ZIP but no state column).
  ZIP3: [[10, 27, "MA"], [28, 29, "RI"], [30, 38, "NH"], [39, 49, "ME"], [50, 54, "VT"], [56, 59, "VT"], [60, 69, "CT"], [70, 89, "NJ"], [100, 149, "NY"], [150, 196, "PA"], [197, 199, "DE"], [200, 205, "DC"], [206, 212, "MD"], [214, 219, "MD"], [220, 246, "VA"], [247, 268, "WV"], [270, 289, "NC"], [290, 299, "SC"], [300, 319, "GA"], [398, 399, "GA"], [320, 339, "FL"], [341, 341, "FL"], [344, 344, "FL"], [346, 347, "FL"], [349, 349, "FL"], [350, 369, "AL"], [370, 385, "TN"], [386, 397, "MS"], [400, 427, "KY"], [430, 459, "OH"], [460, 479, "IN"], [480, 499, "MI"], [500, 528, "IA"], [530, 549, "WI"], [550, 567, "MN"], [570, 577, "SD"], [580, 588, "ND"], [590, 599, "MT"], [600, 629, "IL"], [630, 658, "MO"], [660, 679, "KS"], [680, 693, "NE"], [700, 714, "LA"], [716, 729, "AR"], [730, 749, "OK"], [750, 799, "TX"], [800, 816, "CO"], [820, 831, "WY"], [832, 838, "ID"], [840, 847, "UT"], [850, 865, "AZ"], [870, 884, "NM"], [889, 898, "NV"], [900, 961, "CA"], [967, 968, "HI"], [970, 979, "OR"], [980, 994, "WA"], [995, 999, "AK"]],
  stateFromZip(zip) {
    const z = String(zip || "").replace(/\D/g, ""); if (z.length < 3) return "";
    const p = +(z.length === 4 ? "0" + z : z).slice(0, 3);
    const hit = this.ZIP3.find(([lo, hi]) => p >= lo && p <= hi); return hit ? hit[2] : "";
  },
  stateCode(v) {
    const s = String(v == null ? "" : v).trim(); if (!s) return "";
    if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
    if (!this._stateMap) { this._stateMap = {}; this.STATE_NAMES.split(",").forEach((p) => { const [n, c] = p.split(":"); this._stateMap[n] = c; }); }
    return this._stateMap[s.toLowerCase()] || "";
  },

  /* ---------------- value parsing ---------------- */
  num(v) {
    if (typeof v === "number") return isFinite(v) ? v : NaN;
    let s = String(v == null ? "" : v).trim(); if (!s) return NaN;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[$,\s]/g, "");
    if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
    if (!/^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(s)) return NaN;
    const n = parseFloat(s); return isNaN(n) ? NaN : (neg ? -Math.abs(n) : n);
  },
  _monthNum(w) {
    const i = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(String(w).slice(0, 3).toLowerCase());
    return i < 0 ? 0 : i + 1;
  },
  _iso(y, m, d) {
    if (m > 12 && d >= 1 && d <= 12) { const t = m; m = d; d = t; } // tolerate d/m/y
    const maxY = new Date().getFullYear() + 1;
    if (!(y >= 2015 && y <= maxY && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const dt = new Date(Date.UTC(y, m - 1, d)); if (dt.getUTCMonth() !== m - 1) return null;
    return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  },
  parseDate(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) { if (isNaN(v)) return null; const d = new Date(v.getTime() + 12 * 3600e3); return this._iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
    if (typeof v === "number") {
      if (v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400e3)); return this._iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
      return null;
    }
    const s = String(v).trim(); if (!s) return null;
    if (/^\d{5}(\.\d+)?$/.test(s)) return this.parseDate(parseFloat(s));
    let m;
    if ((m = s.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/))) return this._iso(+m[1], +m[2], +m[3]);
    if ((m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/))) { let y = +m[3]; if (y < 100) y += 2000; return this._iso(y, +m[1], +m[2]); }
    if ((m = s.match(/^(\d{1,2})[\/\-](\d{4})$/))) return this._iso(+m[2], +m[1], 1);
    if ((m = s.match(/^(\d{4})[-\/](\d{1,2})$/))) return this._iso(+m[1], +m[2], 1);
    if ((m = s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/))) { const mo = this._monthNum(m[1]); if (mo) return this._iso(+m[3], mo, +m[2]); }
    if ((m = s.match(/^([A-Za-z]{3,9})\.?[\s\-]+'?(\d{2})$/))) { const mo = this._monthNum(m[1]); if (mo) return this._iso(2000 + (+m[2]), mo, 1); }
    if ((m = s.match(/^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/))) { const mo = this._monthNum(m[1]); if (mo) return this._iso(+m[2], mo, 1); }
    return null;
  },
  looksLikeDate(v) { return v instanceof Date || (typeof v === "string" && this.parseDate(v) != null && /[\/\-.]|[A-Za-z]{3}/.test(v)); },
  zip5(v) { const d = String(v == null ? "" : v).replace(/\D/g, ""); if (!d) return ""; return d.length === 4 ? "0" + d : d.slice(0, 5); },

  /* ---------------- name / address normalization ---------------- */
  _stem(w) { return w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w; },
  nameTokens(s) {
    const t = String(s || "").toLowerCase().replace(/&/g, " and ").replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    if (!t) return [];
    return t.split(" ").filter((w) => w && !this.STOP.has(w)).map((w) => this.ABBR[w] || w).map((w) => this._stem(w));
  },
  nameScore(a, b) {
    const A = new Set(a), B = new Set(b); if (!A.size || !B.size) return 0;
    let inter = 0, distinct = 0;
    A.forEach((t) => { if (B.has(t)) { inter++; if (!this.GENERIC.has(t)) distinct++; } });
    if (!distinct) return 0; // sharing only "wine"/"market"/… proves nothing
    const union = A.size + B.size - inter;
    return Math.max(inter / union, 0.85 * inter / Math.min(A.size, B.size));
  },
  normAddr(s) {
    const map = { street: "st", avenue: "ave", road: "rd", boulevard: "blvd", drive: "dr", lane: "ln", court: "ct", highway: "hwy", place: "pl", turnpike: "tpke", parkway: "pkwy", square: "sq", north: "n", south: "s", east: "e", west: "w" };
    const t = String(s || "").toLowerCase().replace(/[.,#]/g, " ").replace(/\b(unit|ste|suite|apt|apartment|fl|floor|rm|room)\b\s*\w*/g, " ");
    return t.split(/\s+/).filter(Boolean).map((w) => map[w] || w).join(" ");
  },
  normCity(s) { return String(s || "").toLowerCase().replace(/^(town|city) of /, "").replace(/[^a-z0-9]+/g, " ").trim(); },
  titleCase(s) {
    const small = new Set(["and", "of", "the", "at", "in", "on", "for", "a", "an", "to", "by"]);
    const keep = { bbq: "BBQ", llc: "LLC", abc: "ABC", nyc: "NYC", usa: "USA", ii: "II", iii: "III", iv: "IV", ct: "CT", ny: "NY", ma: "MA", ri: "RI", nj: "NJ", pa: "PA", vt: "VT", nh: "NH", me: "ME", tj: "TJ", jb: "JB" };
    let first = true;
    return String(s).toLowerCase().split(/(\s+)/).map((p) => {
      if (/^\s+$/.test(p) || !p) return p;
      // "A2Z", "7UP", "24PK" stay upper; ordinals ("7th") stay lower
      if (/\d/.test(p) && /[a-z]/.test(p)) { first = false; return /^\d+(st|nd|rd|th)$/.test(p) ? p : p.toUpperCase(); }
      const bare = p.replace(/[^a-z]/g, "");
      if (keep[bare]) { first = false; return p.replace(bare, keep[bare]); }
      if (!first && small.has(bare)) return p;
      first = false;
      return p.replace(/(^|[-\/(])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b([od])'([a-z])/g, (m, a, b) => a.toUpperCase() + "'" + b.toUpperCase());
    }).join("");
  },
  // Tidy a distributor-style store name: strip LLC/INC, de-shout ALL CAPS.
  tidyName(s) {
    let t = String(s || "").replace(/\s+/g, " ").trim();
    t = t.replace(/\s-(?=\S)/g, " - ").replace(/(\S)-\s/g, "$1 - "); // "WINE ANTHOLOGY -SCOTCH PLAINS" → "… - …"
    t = t.replace(/[,\s]+(llc|l\.l\.c\.?|inc\.?|incorporated|corp\.?|co\.?|ltd\.?)$/i, "").trim();
    const letters = t.replace(/[^A-Za-z]/g, "");
    if (letters && (letters === letters.toUpperCase() || letters === letters.toLowerCase())) t = this.titleCase(t);
    return t;
  },
  // Internal accounting lines that show up as "customers" in distributor reports.
  NON_STORE: /\b(fifo|adjustments?|inventory|breakage|samples?|promo(tion(al)?)?|marketing|damaged?|write.?offs?|voids?|house account|unassigned|no customer|returns?)\b/i,
  tidyAddr(s) { const t = String(s || "").replace(/\s+/g, " ").trim(); const letters = t.replace(/[^A-Za-z]/g, ""); return letters && letters === letters.toUpperCase() ? this.titleCase(t).replace(/\b(Po)\b/, "PO") : t; },
  guessType(name) {
    const n = String(name || "").toLowerCase();
    if (/\b(liquor|wine|spirits?|package|bottle|cellar|vino|beverage|bev)\b/.test(n)) return "Liquor Store";
    if (/\b(bar|pub|tavern|grill|restaurant|lounge|cafe|bistro|brew|brewing|kitchen|taproom|saloon|club|eatery|steakhouse|pizzeria|diner|social|speakeasy|alehouse|cantina)\b/.test(n)) return "Bar/Restaurant";
    if (/\b(market|grocery|deli|mart|foods?|super|bodega|convenience|farms?)\b/.test(n)) return "Grocery";
    return "Retail";
  },

  /* ---------------- reading the file ---------------- */
  async readFile(file) {
    if (!window.XLSX) throw new Error("The spreadsheet reader didn't load — check your connection and refresh the page.");
    const nm = (file.name || "").toLowerCase();
    const isText = /\.(csv|tsv|txt)$/.test(nm);
    const buf = await file.arrayBuffer();
    // Text files keep every cell as text (so zip codes keep leading zeros); I parse numbers/dates myself.
    const wb = isText
      ? XLSX.read(new TextDecoder("utf-8").decode(buf), { type: "string", raw: true })
      : XLSX.read(buf, { type: "array", cellDates: true });
    const sheets = wb.SheetNames.map((name) => ({
      // blankrows:true keeps row numbers identical to what you see in Excel (so "header row 5" means row 5)
      name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: true, blankrows: true }),
    })).filter((s) => s.rows.filter((r) => r.some((c) => c !== "" && c != null)).length > 1);
    if (!sheets.length) throw new Error("That file looks empty — I couldn't find any rows.");
    return sheets;
  },

  _cellText(v) { return v == null ? "" : (v instanceof Date ? "" : String(v).trim()); },
  // Older normalization — kept so layouts saved before the camelCase fix still match.
  _normLegacy(h) { return String(h == null ? "" : h).toLowerCase().replace(/[^a-z0-9#$%]+/g, " ").trim(); },
  // ERP exports run words together: "CusKey" → "cus key", "ShipAdr2" → "ship adr 2".
  _norm(h) {
    return String(h == null ? "" : h).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2").replace(/(\d)([A-Za-z])/g, "$1 $2")
      .toLowerCase().replace(/[^a-z0-9#$%]+/g, " ").trim();
  },

  // Find the header row. Rows that contain several header-ish words ("Customer",
  // "Qty", "Date"…) win outright; otherwise fall back to the first text-heavy row.
  detectHeaderRow(rows) {
    const kw = /customer|account|store|outlet|retailer|licensee|item|product|sku|qty|quantity|cases|case|date|amount|sales|address|city|state|zip|description|invoice|units|brand/i;
    const max = Math.min(rows.length - 1, 40);
    let kwBest = -1, kwScore = 1;
    for (let i = 0; i < max; i++) {
      const cells = (rows[i] || []).map((c) => this._cellText(c)).filter(Boolean);
      if (cells.length < 3) continue;
      const k = cells.filter((c) => c.length < 40 && kw.test(c) && isNaN(this.num(c))).length;
      if (k > kwScore) { kwBest = i; kwScore = k; }
    }
    if (kwBest >= 0) return kwBest;
    let best = 0, bestScore = -1;
    for (let i = 0; i < max; i++) {
      const cells = (rows[i] || []).map((c) => this._cellText(c)).filter(Boolean);
      if (cells.length < 3) continue;
      const textish = cells.filter((c) => isNaN(this.num(c)) && !this.looksLikeDate(c)).length;
      const nextFilled = (rows[i + 1] || []).filter((c) => this._cellText(c)).length;
      if (nextFilled < 2) continue;
      const score = cells.length * (textish / cells.length) + cells.filter((c) => kw.test(c)).length * 3;
      if (score > bestScore) { best = i; bestScore = score; }
    }
    return best;
  },

  /* ---------------- column mapping ---------------- */
  FIELDS: [
    { key: "store", label: "Store / customer name", req: true,
      good: [/^(customer|cust|cus|account|acct|retailer|store|outlet|licensee|premise|buyer|ship to|sold to|dba)( name| nm)?$/, /(customer|cust|cus|account|retailer|outlet|licensee|premise|store|ship to|sold to|dba) name$/],
      ok: [/customer|account|retailer|outlet|licensee|premise|store|ship to|sold to|dba|\bcus\b|\bcust\b/], bad: /number|^no | no$|#|\bid\b|\bkey\b|code|addr|\badr\b|street|city|state|zip|postal|phone|rep|salesman|route|class|\btype\b|chain|group|category|sales/ },
    { key: "date", label: "Date", req: false,
      good: [/^(date|invoice date|inv date|ship date|order date|delivery date|delivered|sale date|sales date|transaction date|trans date|period|month|week ending|week of|invoice dt|ship dt|date shipped|delivery dt)$/],
      ok: [/date|\bdt$|period|month|week/], bad: /updated|created|due|expir|birth|modified/ },
    { key: "qty", label: "Quantity", req: true,
      good: [/^(qty|quantity|cases|case qty|cs|case|case count|volume|units|unit qty|qty sold|quantity sold|cases sold|total cases|ext qty|shipped qty|qty shipped|physical cases|cs qty|units sold|item qty|item quantity)$/],
      ok: [/\bqty\b|quantity|\bcases?\b|\bcs\b|\bunits?\b|volume|\bpieces?\b|\bbottles?\b|\bpouches\b|\bpacks?\b|\beach\b/], bad: /price|amount|\$|cost|value|per |%|avg|average|inventory|on hand|\boh$/ },
    { key: "product", label: "Product / item", req: false,
      good: [/^(item|item description|item desc|product|product name|product description|description|desc|brand|brand name|sku description|item name|flavor|material description|package)$/, /description|desc|item name/],
      ok: [/item|product|description|brand|material|flavor/], bad: /number|^no | no$|#|\bid\b|code|group|category|upc/ },
    { key: "sku", label: "SKU / item code (optional)", req: false,
      good: [/^(sku|item (no|number|nbr|#|code|id)|product (no|number|code|id)|upc|upc code|material (no|number)|item code)$/],
      ok: [/^item$/, /\bsku\b|upc/], bad: /description|desc|name/ },
    { key: "acctno", label: "Account # (optional)", req: false,
      good: [/^(customer|cust|cus|account|acct|retailer|store|outlet|ship to|license|licensee) ?(no|number|num|nbr|id|code|key|#)$/],
      ok: [/(customer|cust|cus|account|acct|retailer|outlet|ship to|license).*(no|number|num|nbr|id|code|key|#)$/, /^(cust|acct|cus) ?#$/], bad: /name|address/ },
    { key: "address", label: "Street address", req: false,
      good: [/^(address|street address|address ?1|addr|addr ?1|street|address line 1|physical address|ship to address|store address|ship (adr|addr|address)( ?\d)?)$/], ok: [/address|addr|\badr\b|street/], bad: /email|\bip\b|mail|city|zip|state/ },
    { key: "city", label: "City", req: false, good: [/^(city|town|ship to city|ship city|municipality|city name)$/], ok: [/city|town/], bad: /state|zip|county/ },
    { key: "state", label: "State", req: false, good: [/^(state|st|state code|ship to state|ship state|ship st|province|state abbr)$/], ok: [/\bstate\b/], bad: /status|statement/ },
    { key: "zip", label: "ZIP", req: false, good: [/^(zip|zip code|zipcode|postal code|postal|zip5|ship zip|ship postal)$/], ok: [/zip|postal/], bad: /\+/ },
    { key: "uom", label: "Unit of measure (optional)", req: false, good: [/^(uom|unit of measure|u m|um|unit type)$/], ok: [], bad: /./ },
    { key: "amount", label: "Dollar amount (optional)", req: false,
      good: [/^(amount|sales|sales amount|extended|ext amount|ext sales|extended amount|total sales|revenue|net sales|sales \$|dollars|net amount|ext price|extended price|invoice amount)$/],
      ok: [/amount|sales|extended|revenue|dollars|\$/], bad: /qty|case|unit price|price per|avg|average/ },
  ],
  _scoreHeader(f, h) {
    if (!h) return -99;
    if (f.bad && f.bad.test(h) && !(f.good && f.good.some((r) => r.test(h)))) return -99;
    let s = 0;
    if (f.good) f.good.forEach((r, i) => { if (r.test(h)) s = Math.max(s, 10 + (i ? 1 : 0)); });
    if (!s && f.ok) f.ok.forEach((r) => { if (r.test(h)) s = Math.max(s, 4); });
    return s || -99;
  },
  // What do a column's values actually look like? (used to sanity-check header guesses)
  _colStats(sample, i) {
    let n = 0, num = 0, dt = 0;
    for (const r of sample) {
      const v = (r || [])[i]; if (this._cellText(v) === "" && !(v instanceof Date)) continue;
      n++; if (!isNaN(this.num(v))) num++; if (this.looksLikeDate(v)) dt++;
    }
    return { n, numShare: n ? num / n : 0, dateShare: n ? dt / n : 0 };
  },
  // sample = a few dozen data rows. A column called "Account" that's all numbers is an
  // account number, not a store name — the content decides, not just the header.
  guessMapping(headers, sample) {
    const H = headers.map((h) => this._norm(h));
    const S = sample && sample.length ? headers.map((h, i) => this._colStats(sample, i)) : null;
    const contentOK = (key, i) => {
      if (!S) return true; const c = S[i]; if (!c.n) return key !== "qty" && key !== "date" && key !== "store";
      if (key === "store" || key === "product") return c.numShare < 0.6;
      if (key === "qty" || key === "amount") return c.numShare >= 0.5;
      if (key === "date") return c.dateShare >= 0.4 || c.numShare >= 0.9; // real dates or Excel serials
      return true;
    };
    const used = new Set(); const m = {};
    const order = ["store", "date", "qty", "product", "sku", "acctno", "address", "city", "state", "zip", "uom", "amount"];
    order.forEach((key) => {
      const f = this.FIELDS.find((x) => x.key === key);
      let bi = -1, bs = 3;
      H.forEach((h, i) => {
        if (used.has(i)) return;
        let s = this._scoreHeader(f, h);
        // "Cases 2025" vs "Cases 2026" side by side → prefer the most recent year
        if (key === "qty" && s > 0) { const y = h.match(/\b(20\d\d)\b/); if (y) s += (+y[1] - 2000) / 1000; }
        // a bare "Account"/"Customer" column full of numbers is the account number
        if (key === "acctno" && s < 0 && S && /^(account|customer|cust|acct|retailer|store|outlet)$/.test(h) && S[i].numShare >= 0.6) s = 6;
        if (s > bs && contentOK(key, i)) { bs = s; bi = i; }
      });
      m[key] = bi; if (bi >= 0) used.add(bi);
    });
    // Would the quantity column be individual units (pouches) rather than cases?
    const qh = m.qty >= 0 ? H[m.qty] : "";
    const units = /\bunits?\b|\beach\b|\bea\b|\bbtls?\b|bottle|pouch|\bpacks?\b|\bpcs\b|piece/.test(qh) && !/\bcases?\b|\bcs\b/.test(qh) ? "units" : "cases";
    return { mapping: m, units };
  },
  // Spreadsheets laid out with one column per product ("Peach Lemonade" | "Tropical Punch")
  guessWide(headers, products) {
    const out = {};
    headers.forEach((h, i) => { const pid = this.guessProduct(h, products); if (pid !== "ignore" && !out[pid]) out[pid] = i; });
    return out;
  },
  // Is ONE column carrying both customer names and the products under them?
  detectHierarchy(headers, mapping, dataRows, products) {
    if (mapping.store < 0 || mapping.product >= 0) return false;
    const vals = dataRows.map((r) => this._cellText((r || [])[mapping.store])).filter(Boolean);
    if (vals.length < 3) return false;
    const hits = vals.filter((v) => this.guessProduct(v, products) !== "ignore").length;
    const h = this._norm(headers[mapping.store]);
    const headerSaysBoth = /customer|store|account|retailer|outlet/.test(h) && /product|item|brand/.test(h);
    return headerSaysBoth || hits / vals.length >= 0.25;
  },
  // Clues about WHAT the numbers cover, from places other than the data itself:
  // a "Filters"/"Parameters" sheet ("Year to Date From: 1/1/2026 To: 11/3/2026"), a year in the
  // quantity header ("Cases 2026"), or the file name ("..._20261105_...").
  metaHints(sheets, fileName, qtyHeader) {
    const h = { asOf: null, from: null, year: null, ytd: false, asOfSource: "" };
    for (const sh of sheets) {
      for (const r of sh.rows.slice(0, 80)) {
        const t = r.map((c) => this._cellText(c)).join(" ").replace(/<br\s*\/?>/gi, " ");
        const m = t.match(/from:?\s*([0-9][0-9\/\-.]*)\s*to:?\s*([0-9][0-9\/\-.]*)/i);
        if (m) {
          const a = this.parseDate(m[1]), b = this.parseDate(m[2]);
          if (b && (!h.asOf || b > h.asOf)) { h.asOf = b; h.from = a; h.asOfSource = "the report's own Period filter"; }
          if (/year\s*to\s*date|\bytd\b/i.test(t)) h.ytd = true;
        }
      }
    }
    const fy = String(qtyHeader || "").match(/\b(20\d\d)\b/);
    if (fy) h.year = +fy[1];
    if (!h.asOf) { const fm = String(fileName || "").match(/(20\d\d)[-_.]?(\d\d)[-_.]?(\d\d)/); if (fm) { const d = this._iso(+fm[1], +fm[2], +fm[3]); if (d) { h.asOf = d; h.asOfSource = "the file name"; } } }
    if (!h.year && h.asOf) h.year = +h.asOf.slice(0, 4);
    if (/ytd|year.?to.?date/i.test(String(qtyHeader || ""))) h.ytd = true;
    return h;
  },

  /* ---------------- product matching ---------------- */
  _prodWords(p) { return String(p.name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w && !["spiked", "whatcha", "drinking", "the", "and", "with"].includes(w)); },
  // Distributors abbreviate: "PCH LEM" = peach lemonade, "TROP" = tropical. Derive likely
  // abbreviations from the product's own words (prefixes + consonant skeleton) rather than
  // hard-coding any one distributor's spelling: peach→pch, lemonade→lem/lemo/lmnd, tropical→trop/tro.
  _wordAliases(w) {
    const a = new Set([w]);
    if (w.length >= 6) a.add(w.slice(0, 4));
    if (w.length >= 7) a.add(w.slice(0, 3));
    const sk = w[0] + w.slice(1).replace(/[aeiouy]/g, ""); if (sk.length >= 3 && sk !== w) a.add(sk);
    return [...a];
  },
  guessProduct(text, products) {
    const t = " " + String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
    if (!t.trim()) return "ignore";
    const whatcha = / whatcha | what drink(ing)? /.test(t); // "WHAT DRINK" = Whatcha Drinking, as some ERPs truncate it
    const toks = new Set(t.trim().split(" "));
    let best = null, bestScore = 0, tie = false;
    for (const p of products) {
      let sc = this._prodWords(p).filter((w) => t.includes(" " + w) || this._wordAliases(w).some((a) => toks.has(a))).length;
      const sku = String(p.sku || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (sku && t.includes(" " + sku + " ")) sc += 5;
      if (sc > bestScore) { best = p; bestScore = sc; tie = false; } else if (sc === bestScore && sc > 0) tie = true;
    }
    if (!best || tie) return "ignore";
    return (bestScore >= 2 || (whatcha && bestScore >= 1)) ? best.id : "ignore";
  },

  /* ---------------- turning sheet rows into clean rows ---------------- */
  // cfg: { headerRow, mapping, wideCols:{productId:colIdx}|null, singleProduct:string }
  parseRows(aoa, cfg) {
    const m = cfg.mapping, wide = cfg.wideCols && Object.keys(cfg.wideCols).length ? cfg.wideCols : null;
    const rows = [], skipped = { blank: 0, noStore: 0, noQty: 0, noProduct: 0, totals: 0, groupHeaders: 0 };
    const productTexts = new Map();
    const get = (r, i) => (i >= 0 && i < r.length ? r[i] : "");
    const txt = (v) => this._cellText(v);
    const totalRx = /^(grand\s+total|sub-?\s?total|report\s+total|total\s+for|total\s*[:\-]|totals?)\b\s*$|^(grand\s+total|sub-?\s?total|report\s+total|total\s+for|total\s*[:\-])/i;
    let ctx = { store: "", acct: "", address: "", city: "", state: "", zip: "", date: null };

    // "Shared column" layout (e.g. Mancini): ONE column holds both customer names and the
    // products listed beneath each one. A line is a product if it's a recognizable Whatcha
    // product, or if the same text shows up more than once (products repeat under every
    // customer; customer names don't). Everything else is a customer heading.
    let isProd = null;
    if (cfg.hierarchy && m.store >= 0) {
      const counts = new Map(), prods = cfg.products || DB.products(), cache = new Map();
      for (let ri = cfg.headerRow + 1; ri < aoa.length; ri++) { const t = txt(get(aoa[ri] || [], m.store)); if (t) counts.set(t, (counts.get(t) || 0) + 1); }
      isProd = (t) => { if (!cache.has(t)) cache.set(t, this.guessProduct(t, prods) !== "ignore" || (counts.get(t) || 0) >= 2); return cache.get(t); };
    }

    for (let ri = cfg.headerRow + 1; ri < aoa.length; ri++) {
      const r = aoa[ri] || [];
      if (r.every((c) => this._cellText(c) === "")) { skipped.blank++; continue; }
      const storeCell = txt(get(r, m.store)), prodCell = m.product >= 0 ? txt(get(r, m.product)) : "", skuCell = m.sku >= 0 ? txt(get(r, m.sku)) : "";
      if (totalRx.test(storeCell) || totalRx.test(prodCell) || (!storeCell && r.some((c) => typeof c === "string" && /^\s*(grand\s+)?totals?\s*:?\s*$/i.test(c)))) { skipped.totals++; continue; }

      const dateParsed = m.date >= 0 ? this.parseDate(get(r, m.date)) : null;
      const cellsFor = () => ({ acct: m.acctno >= 0 ? txt(get(r, m.acctno)) : "", address: m.address >= 0 ? txt(get(r, m.address)) : "", city: m.city >= 0 ? txt(get(r, m.city)) : "", state: m.state >= 0 ? this.stateCode(get(r, m.state)) : "", zip: m.zip >= 0 ? this.zip5(get(r, m.zip)) : "" });

      if (isProd) {
        if (!storeCell) { skipped.noStore++; continue; }
        if (!isProd(storeCell)) { ctx = Object.assign({ store: storeCell, date: dateParsed }, cellsFor()); skipped.groupHeaders++; continue; } // a customer heading — its own subtotal is ignored
        const qty = this.num(get(r, m.qty));
        if (!ctx.store) { skipped.noStore++; continue; }
        if (isNaN(qty)) { skipped.noQty++; continue; }
        productTexts.set(storeCell, (productTexts.get(storeCell) || 0) + 1);
        rows.push({ ri: ri + 1, store: ctx.store, acct: ctx.acct, address: ctx.address, city: ctx.city, state: ctx.state, zip: ctx.zip, date: dateParsed || ctx.date || null,
          amount: m.amount >= 0 ? this.num(get(r, m.amount)) : NaN, uom: m.uom >= 0 ? txt(get(r, m.uom)) : "", pid: null, productText: storeCell, skuText: "", qty });
        continue;
      }

      const qtyVals = wide ? Object.entries(wide).map(([pid, ci]) => [pid, this.num(get(r, ci))]) : [[null, this.num(get(r, m.qty))]];
      const hasQty = qtyVals.some(([, q]) => !isNaN(q));

      if (storeCell) { ctx = Object.assign({ store: storeCell, date: dateParsed }, cellsFor()); }
      if (!hasQty) {
        // "Customer name" lines in grouped reports: remember the customer, then read the item lines below it.
        if (storeCell && !prodCell && !skuCell) { skipped.groupHeaders++; continue; }
        skipped.noQty++; continue;
      }
      if (!ctx.store) { skipped.noStore++; continue; }
      const date = dateParsed || ctx.date || null;
      if (dateParsed) ctx.date = dateParsed; // continuation rows inherit the last date they saw

      const base = {
        ri: ri + 1, store: ctx.store, acct: ctx.acct, address: ctx.address, city: ctx.city, state: ctx.state, zip: ctx.zip, date,
        amount: m.amount >= 0 ? this.num(get(r, m.amount)) : NaN,
        uom: m.uom >= 0 ? txt(get(r, m.uom)) : "",
      };
      for (const [pid, qty] of qtyVals) {
        if (isNaN(qty)) continue;
        if (wide) { rows.push({ ...base, pid, productText: "(column)", skuText: "", qty }); continue; }
        if (cfg.singleProduct && m.product < 0) { rows.push({ ...base, pid: cfg.singleProduct, productText: "(all rows)", skuText: "", qty }); continue; }
        const pt = prodCell || skuCell;
        if (!pt) { skipped.noProduct++; continue; }
        productTexts.set(pt, (productTexts.get(pt) || 0) + 1);
        rows.push({ ...base, pid: null, productText: pt, skuText: skuCell, qty });
      }
    }
    // No state column? The ZIP code tells us (07094 → NJ), which also drives pricing + geography.
    rows.forEach((r) => { if (!r.state && r.zip) r.state = this.stateFromZip(r.zip); });
    return { rows, skipped, productTexts };
  },

  /* ---------------- matching report stores to your accounts ---------------- */
  _match(rs, stores, ix, dist) {
    const rTok = this.nameTokens(rs.name), rKey = rTok.join(" ");
    const rAddr = this.normAddr(rs.address), rCity = this.normCity(rs.city), rState = (rs.state || "").toUpperCase();
    const cands = [];
    for (const s of stores) {
      const sState = (s.state || "").toUpperCase();
      if (rState && sState && rState !== sState) continue;
      if (rs.acct && s.dist_ids && s.dist_ids[dist.id] === rs.acct) { cands.push({ store: s, score: 1.2, type: "acct" }); continue; }
      const sCity = ix.city.get(s.id);
      if (rCity && sCity && rCity !== sCity) continue; // same name in a different town = different store
      const sAddr = ix.addr.get(s.id);
      if (rAddr && sAddr && rAddr === sAddr && /\d/.test(rAddr)) { cands.push({ store: s, score: 1.1, type: "address" }); continue; }
      const sTok = ix.tok.get(s.id);
      if (sTok.length && sTok.join(" ") === rKey) { cands.push({ store: s, score: 1, type: "exact" }); continue; }
      const sc = this.nameScore(rTok, sTok);
      if (sc >= 0.6) cands.push({ store: s, score: sc, type: sc >= 0.85 ? "likely" : "possible" });
    }
    cands.sort((a, b) => b.score - a.score);
    return { best: cands[0] || null, candidates: cands.slice(0, 5) };
  },

  /* ---------------- the plan: everything that WOULD happen ---------------- */
  // inp: { rows, distributor, productMap, units, fallbackDate, options, overrides }
  buildPlan(inp) {
    const dist = inp.distributor;
    const O = Object.assign({ createNew: true, publishNew: true, reconcile: true, skipRepeats: false }, inp.options);
    const overrides = inp.overrides || {};
    const products = DB.products(); const prodById = new Map(products.map((p) => [p.id, p]));
    const stores = DB.stores();
    const ix = { tok: new Map(), addr: new Map(), city: new Map() };
    stores.forEach((s) => { ix.tok.set(s.id, this.nameTokens(s.name)); ix.addr.set(s.id, this.normAddr(s.address)); ix.city.set(s.id, this.normCity(s.city)); });
    const stats = { rowsRead: inp.rows.length, ignoredProduct: 0, noDate: 0, credits: 0 };

    /* 1 · usable lines + the distinct stores they mention */
    const rsMap = new Map(), lines = [];
    for (const r of inp.rows) {
      const pid = r.pid || inp.productMap[r.productText];
      const prod = pid && pid !== "ignore" ? prodById.get(pid) : null;
      if (!prod) { stats.ignoredProduct++; continue; }
      // Running-total reports have no per-order dates — everything is "as of" the report date.
      const date = inp.cumulative ? inp.cumulative.asOf : (r.date || inp.fallbackDate || null);
      if (!date) { stats.noDate++; continue; }
      const u = /^(cs|case|cases|ca)$/i.test(r.uom) ? "cases" : /^(ea|each|unit|units|btl|bottle|pouch|pk)$/i.test(r.uom) ? "units" : inp.units;
      const cases = u === "units" ? r.qty / (prod.units_per_case || 24) : r.qty;
      const key = r.acct ? "a:" + r.acct : "n:" + this.nameTokens(r.store).join(" ") + "|" + (r.zip || this.normCity(r.city));
      let rs = rsMap.get(key);
      if (!rs) { rs = { key, name: r.store, acct: r.acct, address: r.address, city: r.city, state: r.state || dist.state || "", zip: r.zip, rowCount: 0, cases: 0, firstDate: date }; rsMap.set(key, rs); }
      if (!rs.address && r.address) rs.address = r.address; if (!rs.city && r.city) rs.city = r.city; if (!rs.zip && r.zip) rs.zip = r.zip;
      rs.rowCount++; rs.cases += cases; if (date < rs.firstDate) rs.firstDate = date;
      lines.push({ rs, date, pid: prod.id, cases, amount: isNaN(r.amount) ? 0 : r.amount });
    }

    /* 2 · decide each store: matched / new / skipped */
    const rsArr = [...rsMap.values()];
    // Names you've told me to skip before (e.g. an internal "adjustment" account) stay skipped.
    const skipSet = new Set(((DB.kvGet("import_skips", {}) || {})[dist.id]) || []);
    for (const rs of rsArr) {
      rs.match = this._match(rs, stores, ix, dist);
      rs.nameKey = this.nameTokens(rs.name).join(" ");
      const best = rs.match.best, ov = overrides[rs.key] && overrides[rs.key] !== "auto" ? overrides[rs.key] : null;
      rs.confidence = !best ? "new" : ["acct", "address", "exact"].includes(best.type) ? "sure" : best.type === "likely" ? "check" : "review";
      rs.autoSkip = !ov ? (skipSet.has(rs.nameKey) ? "you skipped this one before" : this.NON_STORE.test(rs.name) ? "looks like an internal adjustment, not a store" : "") : "";
      if (ov === "skip" || rs.autoSkip) { rs.decision = "skip"; }
      else if (ov === "new") { rs.decision = O.createNew ? "new" : "skip"; }
      else if (ov && DB.store(ov)) { rs.decision = "match"; rs.store = DB.store(ov); }
      else if (best && best.type !== "possible") { rs.decision = "match"; rs.store = best.store; }
      else { rs.decision = O.createNew ? "new" : "skip"; }
      if (rs.decision === "new") {
        const addr = this.tidyAddr(rs.address), city = this.tidyName(rs.city), name = this.tidyName(rs.name);
        const ns = {
          id: uid("str"), name, city, state: rs.state || "", address: addr, zip: rs.zip || "", type: this.guessType(name), status: "active",
          distributor_id: dist.id, contact_name: "", phone: "", email: "", notes: "", created_at: rs.firstDate, source: "import",
          dist_ids: rs.acct ? { [dist.id]: rs.acct } : {}, show_on_map: !!(O.publishNew && addr && city),
        };
        rs.newStore = ns; rs.sid = ns.id; // only created later, if it turns out to have real activity
      } else if (rs.decision === "match") { rs.sid = rs.store.id; }
    }

    /* 3 · collapse lines to one per (store, date, product); credits net out */
    const agg = new Map();
    for (const ln of lines) {
      if (ln.rs.decision === "skip") continue;
      const k = ln.rs.sid + "|" + ln.date + "|" + ln.pid;
      const a = agg.get(k) || { sid: ln.rs.sid, rs: ln.rs, date: ln.date, pid: ln.pid, cases: 0, amount: 0, neg: false };
      a.cases += ln.cases; a.amount += ln.amount; if (ln.cases < 0) a.neg = true; agg.set(k, a);
    }

    /* 4 · compare with what's already in the system */
    const allOrders = DB.orders();
    const keyMap = new Map();
    allOrders.forEach((o) => (o.line_keys || []).forEach((k) => keyMap.set(k, o)));
    const manualByStore = new Map();
    if (O.reconcile) allOrders.forEach((o) => { if (o.source !== "import") { let a = manualByStore.get(o.store_id); if (!a) manualByStore.set(o.store_id, (a = [])); a.push(o); } });
    const work = new Map();
    const touch = (o) => {
      let w = work.get(o.id);
      if (!w) { w = { prev: { items: o.items, line_keys: o.line_keys, confirmed_date: o.confirmed_date, confirmed_import: o.confirmed_import }, cur: { ...o, items: (o.items || []).map((i) => ({ ...i })), line_keys: (o.line_keys || []).slice() }, kind: "changed", dirty: false }; work.set(o.id, w); }
      return w.cur;
    };
    const r2 = (n) => Math.round(n * 100) / 100;
    const newOrdMap = new Map();
    const counts = { duplicates: 0, changed: 0, reconciled: 0, newLines: 0, repeats: 0 };
    const reconciled = [], changedLines = [], repeatLines = [], confirmedSids = new Set();
    // Reports with no date column ("New Placement – 90 Day") get dated by the file, so a store that a
    // rolling window re-lists next week would look new. Spot "same store + product + qty, ≤90 days apart".
    const importedBySP = new Map();
    if (inp.undated && !inp.cumulative) allOrders.forEach((o) => {
      if (o.source !== "import" || o.adjustment || (o.distributor_id && o.distributor_id !== dist.id)) return;
      (o.items || []).forEach((it) => { const k = o.store_id + "|" + it.product_id; let a = importedBySP.get(k); if (!a) importedBySP.set(k, (a = [])); a.push({ date: o.date, cases: it.cases }); });
    });
    const repeatOf = (sid, pid, cases, date) => (importedBySP.get(sid + "|" + pid) || []).find((e) => e.date !== date && Math.abs(e.cases - cases) < 0.005 && Math.abs(Date.parse(date) - Date.parse(e.date)) <= 90 * 86400000);

    /* RUNNING TOTALS ("Cases 2026" = everything since Jan 1). The report gives a total per store &
       product, not individual orders — so the only safe thing to record is what's NEW since last time:
       new total − what's already on the books for that store/product this year. Hand-logged orders
       count toward the total (up to what the report confirms); a total that FALLS creates an
       adjustment. Re-uploading the same report therefore adds nothing. */
    let cumInfo = null;
    if (inp.cumulative) {
      const cum = inp.cumulative, y0 = cum.year + "-01-01", y1 = cum.year + "-12-31";
      const hasSnapshot = allOrders.some((o) => o.ytd_year === cum.year && o.distributor_id === dist.id);
      const exImp = new Map(), exHand = new Map();
      allOrders.forEach((o) => {
        if (o.date < y0 || o.date > y1) return;
        if (o.distributor_id && o.distributor_id !== dist.id) return;
        const into = o.source === "import" ? exImp : exHand;
        (o.items || []).forEach((it) => { const k = o.store_id + "|" + it.product_id; into.set(k, (into.get(k) || 0) + (it.cases || 0)); });
      });
      let alreadyCounted = 0;
      for (const a of agg.values()) {
        const T = r2(a.cases), k = a.sid + "|" + a.pid;
        const imp = exImp.get(k) || 0, hand = exHand.get(k) || 0, remaining = T - imp;
        if (T > 0.0001) confirmedSids.add(a.sid);
        let delta;
        if (remaining <= 0) delta = remaining; // the distributor's total fell (or matches) — never touch hand-logged orders
        else { const used = Math.min(hand, remaining); delta = remaining - used; alreadyCounted += used; }
        delta = r2(delta);
        if (Math.abs(delta) < 0.005) { if (T > 0.0001) counts.duplicates++; else stats.zeroLines = (stats.zeroLines || 0) + 1; continue; }
        const kind = delta < 0 ? "adjust" : hasSnapshot ? "delta" : "baseline";
        const ok = a.sid + "|" + kind; let no = newOrdMap.get(ok);
        if (!no) {
          no = { id: uid("ord"), store_id: a.sid, distributor_id: dist.id, date: cum.asOf, items: [], export_state: { [dist.id]: "exported" }, created_at: cum.asOf, source: "import", line_keys: [], reported_amount: 0,
            ytd_year: cum.year, ytd_asof: cum.asOf, ytd_baseline: kind === "baseline", adjustment: kind === "adjust" };
          newOrdMap.set(ok, no);
        }
        no.items.push({ product_id: a.pid, cases: delta }); no.line_keys.push(dist.id + "|" + a.sid + "|ytd" + cum.year + "@" + cum.asOf + "|" + a.pid);
        counts.newLines++; if (kind === "adjust") counts.adjustments = (counts.adjustments || 0) + 1;
      }
      cumInfo = { year: cum.year, asOf: cum.asOf, baseline: !hasSnapshot, alreadyCounted: r2(alreadyCounted) };
    }

    // Oldest first, so the earliest delivery claims the earliest hand-logged order.
    for (const a of (inp.cumulative ? [] : [...agg.values()].sort((x, y) => x.date.localeCompare(y.date)))) {
      if (a.cases <= 0.0001) { if (a.neg) stats.credits++; else stats.zeroLines = (stats.zeroLines || 0) + 1; continue; } // returns net out; zeros are skipped
      const cases = r2(a.cases);
      const key = dist.id + "|" + a.sid + "|" + a.date + "|" + a.pid;
      confirmedSids.add(a.sid);
      const eo = keyMap.get(key);
      if (eo) {
        const cur = touch(eo); const it = cur.items.find((i) => i.product_id === a.pid);
        if (it && Math.abs((it.cases || 0) - cases) < 0.005) { counts.duplicates++; continue; } // same line seen before — nothing to do
        if (it) { changedLines.push({ store: a.rs.name, date: a.date, from: it.cases, to: cases }); it.cases = cases; } else cur.items.push({ product_id: a.pid, cases });
        work.get(eo.id).dirty = true; counts.changed++; continue;
      }
      // Did Ben already log this sale by hand? Then confirm it instead of double-counting.
      if (O.reconcile && a.rs.decision === "match") {
        const cands = (manualByStore.get(a.sid) || []).map((o) => (work.get(o.id) ? work.get(o.id).cur : o)).filter((o) => {
          const it = (o.items || []).find((i) => i.product_id === a.pid); if (!it) return false;
          if ((o.line_keys || []).some((k) => k.endsWith("|" + a.pid))) return false;
          if (Math.abs(it.cases - cases) > Math.max(1, 0.25 * Math.max(it.cases, cases))) return false;
          // A distributor fulfils a field order within a few weeks. Anything older is a different sale.
          const dd = (Date.parse(a.date) - Date.parse(o.date)) / 86400000; return dd >= -3 && dd <= 35;
        }).sort((x, y) => Math.abs(Date.parse(a.date) - Date.parse(x.date)) - Math.abs(Date.parse(a.date) - Date.parse(y.date)));
        if (cands.length) {
          const o = cands[0]; const cur = touch(o); const w = work.get(o.id); w.kind = "reconciled"; w.dirty = true;
          const it = cur.items.find((i) => i.product_id === a.pid);
          reconciled.push({ store: a.rs.name, handDate: o.date, handCases: it.cases, reportDate: a.date, reportCases: cases });
          if (Math.abs(it.cases - cases) > 0.005) it.cases = cases;
          cur.line_keys.push(key); cur.confirmed_date = a.date; counts.reconciled++; continue;
        }
      }
      // looks like the same placement re-listed by an overlapping report?
      if (inp.undated) {
        const rep = repeatOf(a.sid, a.pid, cases, a.date);
        if (rep) { repeatLines.push({ store: a.rs.name, date: a.date, cases, earlier: rep.date }); if (O.skipRepeats) { counts.repeats++; continue; } }
      }
      // genuinely new
      const ok = a.sid + "|" + a.date;
      let no = newOrdMap.get(ok);
      if (!no) {
        no = { id: uid("ord"), store_id: a.sid, distributor_id: dist.id, date: a.date, items: [], export_state: { [dist.id]: "exported" }, created_at: a.date, source: "import", line_keys: [], reported_amount: 0 };
        newOrdMap.set(ok, no);
      }
      no.items.push({ product_id: a.pid, cases }); no.line_keys.push(key); no.reported_amount = r2(no.reported_amount + a.amount); counts.newLines++;
    }
    const newOrders = [...newOrdMap.values()];
    const orderUpdates = [...work.values()].filter((w) => w.dirty).map((w) => ({ id: w.cur.id, cur: w.cur, prev: w.prev, kind: w.kind }));

    // Only create accounts for stores that actually have activity (a row of zeros isn't a customer).
    const newStores = rsArr.filter((rs) => rs.decision === "new" && confirmedSids.has(rs.sid)).map((rs) => rs.newStore);
    rsArr.forEach((rs) => { if (rs.decision === "new" && !confirmedSids.has(rs.sid)) { rs.decision = "none"; rs.noActivity = true; } });

    /* 5 · keep accounts current: they're ordering, so they're active */
    const upd = new Map();
    for (const rs of rsArr) {
      if (rs.decision !== "match" || !confirmedSids.has(rs.sid)) continue;
      const s = rs.store; const e = upd.get(s.id) || { id: s.id, patch: {}, prev: {}, name: s.name };
      const setP = (k, v) => { if (v == null || v === "" || e.patch[k] !== undefined) return; if (JSON.stringify(s[k]) !== JSON.stringify(v)) { e.patch[k] = v; e.prev[k] = s[k]; } };
      if (s.status !== "active") setP("status", "active");
      if (!s.address) setP("address", this.tidyAddr(rs.address));
      if (!s.city) setP("city", this.tidyName(rs.city));
      if (!s.state) setP("state", rs.state);
      if (!s.zip) setP("zip", rs.zip);
      if (!s.distributor_id) setP("distributor_id", dist.id);
      if (rs.acct && !(s.dist_ids && s.dist_ids[dist.id] === rs.acct)) setP("dist_ids", { ...(s.dist_ids || {}), [dist.id]: rs.acct });
      if (Object.keys(e.patch).length) upd.set(s.id, e);
    }
    const storeUpdates = [...upd.values()];
    const activated = storeUpdates.filter((u) => u.patch.status === "active").length;

    /* 6 · leads you were chasing that just became accounts */
    const leadWins = [];
    const winners = [...newStores.map((s) => ({ s, tok: this.nameTokens(s.name) })), ...storeUpdates.filter((u) => u.patch.status === "active").map((u) => ({ s: DB.store(u.id), tok: ix.tok.get(u.id) }))];
    const openLeads = DB.leads().filter((l) => l.status === "to_visit" || l.status === "contacted");
    openLeads.forEach((l) => {
      const lt = this.nameTokens(l.name), lc = this.normCity(l.city);
      const w = winners.find(({ s, tok }) => { const sc = this.normCity(s.city); if (lc && sc && lc !== sc) return false; return tok.join(" ") === lt.join(" ") || this.nameScore(lt, tok) >= 0.85; });
      if (w) leadWins.push({ leadId: l.id, leadName: l.name, storeName: w.s.name, storeId: w.s.id, prevStatus: l.status });
    });

    const newCases = r2(newOrders.reduce((a, o) => a + o.items.reduce((x, i) => x + i.cases, 0), 0));
    const dates = [...agg.values()].map((a) => a.date).sort();
    rsArr.sort((a, b) => ({ review: 0, check: 1, new: 2, sure: 3 }[a.confidence] - { review: 0, check: 1, new: 2, sure: 3 }[b.confidence]) || b.cases - a.cases);

    const baselineCases = r2(newOrders.filter((o) => o.ytd_baseline).reduce((a, o) => a + o.items.reduce((x, i) => x + i.cases, 0), 0));
    // Which "skip this store" choices to remember for next time (and which to forget).
    const skipRemember = {
      add: rsArr.filter((rs) => overrides[rs.key] === "skip").map((rs) => rs.nameKey),
      remove: rsArr.filter((rs) => overrides[rs.key] && overrides[rs.key] !== "skip" && overrides[rs.key] !== "auto" && skipSet.has(rs.nameKey)).map((rs) => rs.nameKey),
    };

    // Revenue is priced per state — warn if a state in this report has no case price yet.
    const priced = new Set(DB.pricing().filter((x) => +x.case_price > 0).map((x) => x.state));
    const missingPricing = [...new Set(rsArr.filter((rs) => (rs.decision === "new" || rs.decision === "match") && confirmedSids.has(rs.sid)).map((rs) => (rs.decision === "new" ? rs.newStore.state : (rs.store.state || rs.state)) || "").filter((s) => s && !priced.has(s)))];

    return {
      stats, counts, reportStores: rsArr, newStores, storeUpdates, newOrders, orderUpdates, leadWins, reconciled, changedLines, repeatLines, cumulative: cumInfo, skipRemember,
      undated: !!inp.undated, warnings: { missingPricing },
      totals: { newCases, baselineCases, orders: newOrders.length, newAccounts: newStores.length, activated, filled: storeUpdates.length - activated, storesInReport: rsArr.length, range: dates.length ? [dates[0], dates[dates.length - 1]] : null,
        newAccountsNoMap: newStores.filter((s) => !s.show_on_map).length, newAccountsNoAddr: newStores.filter((s) => !s.address || !s.city).length },
      options: O, distributor: dist,
    };
  },

  /* ---------------- commit + undo ---------------- */
  async apply(plan, meta) {
    const importId = uid("imp"), at = new Date().toISOString();
    plan.newStores.forEach((s) => { s.import_id = importId; });
    const newOrders = plan.newOrders.map((o) => ({ ...o, import_id: importId, import_name: meta.fileName, import_at: at }));
    const orderRows = plan.orderUpdates.map((u) => (u.kind === "reconciled" ? { ...u.cur, confirmed_import: importId } : u.cur));
    const storeUpdRows = plan.storeUpdates.map((u) => ({ ...DB.store(u.id), ...u.patch }));
    const leadRows = plan.leadWins.map((w) => ({ ...DB.lead(w.leadId), status: "won", won_account_id: w.storeId }));

    await DB.upsertMany("stores", [...plan.newStores, ...storeUpdRows]);
    await DB.upsertMany("orders", [...newOrders, ...orderRows]);
    if (leadRows.length) await DB.upsertMany("leads", leadRows);

    const entry = {
      id: importId, at, fileName: meta.fileName, distributor_id: plan.distributor.id, distributor_name: plan.distributor.name,
      rows: plan.stats.rowsRead, orders: newOrders.length, cases: plan.totals.newCases, newStores: plan.newStores.length,
      activated: plan.totals.activated, filled: plan.totals.filled, reconciled: plan.counts.reconciled, duplicates: plan.counts.duplicates,
      changed: plan.counts.changed, leadsWon: leadRows.length, range: plan.totals.range,
      newOrderIds: newOrders.map((o) => o.id), newStoreIds: plan.newStores.map((s) => s.id),
      storeUpdates: plan.storeUpdates.map((u) => ({ id: u.id, prev: u.prev })),
      orderUpdates: plan.orderUpdates.map((u) => ({ id: u.id, prev: u.prev })),
      leadUpdates: plan.leadWins.map((w) => ({ id: w.leadId, prevStatus: w.prevStatus })),
      ytd: plan.cumulative ? { ...plan.cumulative, baselineCases: plan.totals.baselineCases } : null,
    };
    // remember "always skip this one" choices for this distributor
    const sr = plan.skipRemember;
    if (sr && (sr.add.length || sr.remove.length)) {
      const all = DB.kvGet("import_skips", {}) || {}, set = new Set(all[plan.distributor.id] || []);
      sr.add.forEach((k) => set.add(k)); sr.remove.forEach((k) => set.delete(k));
      all[plan.distributor.id] = [...set]; DB.kvSet("import_skips", all);
    }
    DB.kvSet("import_log", [entry, ...DB.kvGet("import_log", [])].slice(0, 60));
    return entry;
  },

  async undo(logId) {
    const log = DB.kvGet("import_log", []); const e = log.find((x) => x.id === logId);
    if (!e) throw new Error("That import isn't in the history anymore.");
    // restore changed hand-logged / previously imported orders, drop the orders this import added
    const restore = e.orderUpdates.map((u) => { const o = DB.orders().find((x) => x.id === u.id); return o ? { ...o, ...u.prev } : null; }).filter(Boolean);
    if (restore.length) await DB.upsertMany("orders", restore);
    await DB.removeMany("orders", e.newOrderIds);
    // restore store fields; remove stores this import created unless something else now uses them
    const used = new Set(DB.orders().map((o) => o.store_id));
    const stRestore = e.storeUpdates.map((u) => { const s = DB.store(u.id); return s ? { ...s, ...u.prev } : null; }).filter(Boolean);
    if (stRestore.length) await DB.upsertMany("stores", stRestore);
    const dropStores = e.newStoreIds.filter((id) => !used.has(id));
    if (dropStores.length) await DB.removeMany("stores", dropStores);
    const leadRows = (e.leadUpdates || []).map((u) => { const l = DB.lead(u.id); return l ? { ...l, status: u.prevStatus, won_account_id: undefined } : null; }).filter(Boolean);
    if (leadRows.length) await DB.upsertMany("leads", leadRows);
    DB.kvSet("import_log", log.filter((x) => x.id !== logId));
    return { removedOrders: e.newOrderIds.length, keptStores: e.newStoreIds.length - dropStores.length, removedStores: dropStores.length };
  },

  /* ---------------- remembered mappings (per distributor) ---------------- */
  saveMapping(distId, s) {
    const all = DB.kvGet("import_maps", {});
    all[distId] = s; DB.kvSet("import_maps", all);
  },
  loadMapping(distId, headers) {
    const saved = (DB.kvGet("import_maps", {}) || {})[distId]; if (!saved || !saved.fieldHeaders) return null;
    // Layouts saved by an older version used a simpler header normalization — accept either.
    const H = headers.map((h) => this._norm(h)), HL = headers.map((h) => this._normLegacy(h)), mapping = {};
    for (const f of this.FIELDS) {
      const want = saved.fieldHeaders[f.key];
      mapping[f.key] = want ? (H.indexOf(want) >= 0 ? H.indexOf(want) : HL.indexOf(want)) : -1;
      if (f.req && want && mapping[f.key] < 0) return null; // the report's layout changed — re-guess instead
    }
    return { mapping, units: saved.units || "cases", productMap: saved.productMap || {}, hier: !!saved.hier, cumulative: !!saved.cumulative, skipRepeats: !!saved.skipRepeats };
  },
  // Which distributor sent this file? A layout you've imported before is the strongest clue;
  // otherwise a distinctive word from the distributor's name in the file name.
  detectDistributor(headers, fileName) {
    const H = new Set(headers.map((h) => this._norm(h)).filter(Boolean)), HL = new Set(headers.map((h) => this._normLegacy(h)).filter(Boolean));
    const maps = DB.kvGet("import_maps", {}) || {}, dists = DB.distributors();
    const byLayout = dists.filter((d) => { const fh = (maps[d.id] || {}).fieldHeaders; if (!fh) return false; const need = Object.values(fh).filter(Boolean); return need.length >= 2 && need.every((w) => H.has(w) || HL.has(w)); });
    if (byLayout.length === 1) return { dist: byLayout[0], why: "column layout you've imported before" };
    const fn = " " + this._normLegacy(fileName) + " ", generic = new Set(["beverage", "beverages", "distributor", "distributors", "distributing", "company", "wine", "spirits", "inc", "llc", "the", "and", "northeast"]);
    const byName = dists.filter((d) => this._normLegacy(d.name).split(" ").some((w) => w.length >= 4 && !generic.has(w) && fn.includes(" " + w)));
    if (byName.length === 1) return { dist: byName[0], why: "file name" };
    return null;
  },
};
window.Importer = Importer;
