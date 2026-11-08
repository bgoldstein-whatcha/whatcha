/* ============================================================
   Whatcha HQ — "Import" + "Insights" screens
   Plugs into App as two nav items without touching app.js
   (same pattern as the Website analytics module).

   Import:   upload a distributor report → check how I read it →
             review exactly what will change → confirm → done (undoable).
   Insights: order trends, reorder watch, movers, where you sell.
   ============================================================ */
(function () {
  if (typeof App === "undefined" || typeof Importer === "undefined") return;
  const E = (s) => esc(s);
  const fc = (n) => Insights.fc(n);
  const fd = (iso) => Insights.fd(iso);
  const ago = (iso) => { const d = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000)); return d === 0 ? "today" : d === 1 ? "yesterday" : d + " days ago"; };
  const plural = (n, a, b) => (n === 1 ? a : b);

  /* =====================================================================
     IMPORT
     ===================================================================== */
  const fresh = () => ({
    step: 1, distId: "", fileName: "", fileSize: 0, sheets: [], sheetIdx: 0, headerRow: 0, headers: [], sample: [],
    mapping: {}, units: "cases", wide: false, wideCols: {}, single: "", fallbackDate: "", savedProducts: null,
    parsed: null, productTexts: [], productMap: {}, options: { createNew: true, publishNew: true, reconcile: true },
    overrides: {}, plan: null, result: null, busy: "", error: "",
  });
  let S = fresh();
  const dist = () => DB.distributor(S.distId);
  const cellText = (v) => (v == null || v instanceof Date ? "" : String(v).trim());

  /* ---------- loading + analysing a file ---------- */
  function bestSheet(sheets) {
    let bi = 0, bs = -1;
    sheets.forEach((sh, i) => {
      const hr = Importer.detectHeaderRow(sh.rows), hits = (sh.rows[hr] || []).filter((c) => /customer|account|store|retailer|qty|quantity|cases|date|item|product/i.test(cellText(c))).length;
      const score = hits * 1000 + sh.rows.length; if (score > bs) { bs = score; bi = i; }
    });
    return bi;
  }
  async function loadFile(file) {
    if (!file) return;
    if (!S.distId) { App.toast("Pick the distributor first", "err"); return; }
    S.busy = "Reading " + file.name + "…"; S.error = ""; renderImport();
    try {
      const sheets = await Importer.readFile(file);
      const keepDist = S.distId; S = fresh(); S.distId = keepDist;
      S.fileName = file.name; S.fileSize = file.size; S.sheets = sheets; S.sheetIdx = bestSheet(sheets);
      analyze({ redetect: true });
      S.step = 2;
    } catch (e) { S.error = (e && e.message) || String(e); S.busy = ""; if (!S.sheets.length) S.step = 1; }
    S.busy = ""; renderImport();
  }
  function analyze(o) {
    const rows = S.sheets[S.sheetIdx].rows;
    if (o.redetect) S.headerRow = Importer.detectHeaderRow(rows);
    S.headerRow = Math.min(Math.max(S.headerRow, 0), rows.length - 2);
    S.headers = (rows[S.headerRow] || []).map(cellText);
    S.sample = rows.slice(S.headerRow + 1, S.headerRow + 41);
    const saved = Importer.loadMapping(S.distId, S.headers);
    if (saved) { S.mapping = saved.mapping; S.units = saved.units; S.savedProducts = saved.productMap; S.usedSaved = true; }
    else { const g = Importer.guessMapping(S.headers, S.sample); S.mapping = g.mapping; S.units = g.units; S.savedProducts = null; S.usedSaved = false; }
    S.wide = false; S.wideCols = {}; S.single = ""; S.productMap = {};
    if (S.mapping.product < 0 && S.mapping.sku < 0) {
      const w = Importer.guessWide(S.headers, DB.products());
      if (Object.keys(w).length) { S.wide = true; S.wideCols = w; }
    }
    reparse();
  }
  function reparse() {
    const rows = S.sheets[S.sheetIdx].rows;
    S.parsed = Importer.parseRows(rows, { headerRow: S.headerRow, mapping: S.mapping, wideCols: S.wide ? S.wideCols : null, singleProduct: S.single });
    const prods = DB.products();
    S.productTexts = [...S.parsed.productTexts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
    S.productTexts.forEach((t) => { if (S.productMap[t] === undefined) S.productMap[t] = (S.savedProducts && S.savedProducts[t]) || Importer.guessProduct(t, prods); });
    S.plan = null;
  }
  function issues() {
    const m = S.mapping, out = [];
    if (m.store < 0) out.push("Choose the column that has the store / customer names.");
    if (S.wide ? !Object.keys(S.wideCols).length : m.qty < 0) out.push(S.wide ? "Choose a column for at least one flavor." : "Choose the column that has the quantity.");
    if (!S.wide && m.product < 0 && m.sku < 0 && !S.single) out.push("Tell me which product this report is for (or pick the product column).");
    if (m.date < 0 && !S.fallbackDate) out.push("This report has no date column — enter the date it covers.");
    if (S.parsed && !S.parsed.rows.length && !out.length) out.push("I couldn't read any sales rows with these settings — check the header row and columns.");
    return out;
  }
  function buildPlan() {
    S.plan = Importer.buildPlan({ rows: S.parsed.rows, distributor: dist(), productMap: S.productMap, units: S.units, fallbackDate: S.fallbackDate, options: S.options, overrides: S.overrides });
  }
  async function commit() {
    const p = S.plan; if (!p) return;
    S.busy = DB.mode === "supabase" ? "Saving to the cloud…" : "Saving…"; S.error = ""; renderImport();
    try {
      const entry = await Importer.apply(p, { fileName: S.fileName });
      const fieldHeaders = {}; Importer.FIELDS.forEach((f) => { fieldHeaders[f.key] = S.mapping[f.key] >= 0 ? Importer._norm(S.headers[S.mapping[f.key]]) : ""; });
      const prevSaved = ((DB.kvGet("import_maps", {}) || {})[S.distId] || {}).productMap || {};
      Importer.saveMapping(S.distId, { fieldHeaders, units: S.units, productMap: { ...prevSaved, ...S.productMap }, at: new Date().toISOString() });
      S.result = entry; S.step = 4;
    } catch (e) { S.error = "Something went wrong while saving: " + ((e && e.message) || e) + " — re-uploading the same file is safe; it won't double-count."; }
    S.busy = ""; renderImport();
  }

  /* ---------- small view helpers ---------- */
  const sampleOf = (i) => { const out = []; for (const r of S.sample) { const t = cellText((r || [])[i]) || ((r || [])[i] instanceof Date ? Importer.parseDate(r[i]) : ""); if (t) out.push(t); if (out.length >= 3) break; } return out.join(" · "); };
  const colSelect = (key) => `<select onchange="App.impSetMap('${key}', this.value)">
      <option value="-1" ${S.mapping[key] < 0 ? "selected" : ""}>— none —</option>
      ${S.headers.map((h, i) => `<option value="${i}" ${S.mapping[key] === i ? "selected" : ""}>${E(h || "Column " + (i + 1))}</option>`).join("")}</select>`;
  const prodSelect = (val, handler) => `<select onchange="${handler}">
      ${DB.products().map((p) => `<option value="${p.id}" ${val === p.id ? "selected" : ""}>${E(p.name)}</option>`).join("")}
      <option value="ignore" ${val === "ignore" ? "selected" : ""}>Ignore (not Whatcha)</option></select>`;
  const prodName = (pid) => { const p = DB.product(pid); return p ? p.name.replace("Spiked ", "") : "—"; };
  const steps = () => ["Upload", "Check columns", "Review", "Done"].map((t, i) => `<div class="imp-step ${S.step === i + 1 ? "is-on" : S.step > i + 1 ? "is-done" : ""}"><span>${S.step > i + 1 ? "✓" : i + 1}</span>${t}</div>`).join("");

  /* ---------- the screen ---------- */
  function renderImport() {
    const v = $("#view"); if (!v) return;
    const dists = DB.distributors();
    if (!S.distId && dists.length) S.distId = dists[0].id;
    let h = `<p class="muted" style="margin-top:0;max-width:760px">Drop in the sales reports your distributors send you. I'll read them, log the orders, add any stores you don't have yet, and keep your accounts up to date. Uploading the same report twice — or a newer one that includes older months — never double-counts.</p>
      <div class="imp-steps">${steps()}</div>`;
    if (S.busy) h += `<div class="panel imp-busy"><div class="imp-spin"></div><div>${E(S.busy)}</div></div>`;
    if (S.error) h += `<div class="panel imp-error"><strong>Heads up:</strong> ${E(S.error)}</div>`;

    if (!dists.length) {
      h += `<div class="panel"><div class="empty-state"><div class="big">🚚</div>Add a distributor first — reports are imported per distributor so I know who the sales belong to.<div style="margin-top:12px"><button class="btn btn--primary" onclick="App.go('distributors')">Go to Distributors</button></div></div></div>`;
    } else if (!S.busy) {
      h += uploadPanel(dists);
      if (S.step === 2) h += mapPanel();
      if (S.step === 3) h += reviewPanel();
      if (S.step === 4) h += donePanel();
    }
    h += historyPanel();
    v.innerHTML = h; wire();
  }

  function uploadPanel(dists) {
    const loaded = S.step >= 2 && S.fileName;
    return `<div class="panel">
      <div class="imp-uprow">
        <div class="field" style="margin:0;min-width:240px"><label>Which distributor is this report from?</label>
          <select onchange="App.impSetDist(this.value)">${dists.map((d) => `<option value="${d.id}" ${S.distId === d.id ? "selected" : ""}>${E(d.name)} (${d.state})</option>`).join("")}</select></div>
        ${loaded ? `<div class="imp-file"><span class="imp-file__ico">📄</span><div><strong>${E(S.fileName)}</strong><div class="muted" style="font-size:12px">${S.parsed ? S.parsed.rows.length + " sales rows read" : ""}${S.sheets.length > 1 ? " · sheet “" + E(S.sheets[S.sheetIdx].name) + "”" : ""}</div></div>
          <label class="btn btn--ghost btn--sm" for="imp-file2">Use a different file</label><input id="imp-file2" type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm" hidden></div>` : ""}
      </div>
      ${loaded ? "" : `<label class="imp-drop" id="imp-drop" for="imp-file"><div class="imp-drop__ico">📥</div><div class="imp-drop__t">Drop a distributor report here</div><div class="imp-drop__s">CSV or Excel (.xlsx / .xls) — or click to choose a file</div></label><input id="imp-file" type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm" hidden>
      <p class="muted" style="font-size:12px;margin:10px 2px 0">Got a PDF? Ask the distributor for the Excel/CSV version of the same report — or send it to me in chat and I'll convert it.</p>`}
    </div>`;
  }

  function mapPanel() {
    const m = S.mapping, p = S.parsed, sk = p.skipped, prods = DB.products();
    const fields = Importer.FIELDS.filter((f) => !(S.wide && ["qty", "product", "sku", "uom"].includes(f.key)));
    const rows = fields.map((f) => `<tr><td><strong>${E(f.label)}</strong>${f.req ? ' <span class="imp-req">needed</span>' : ""}</td><td>${colSelect(f.key)}</td><td class="muted imp-sample">${m[f.key] >= 0 ? E(sampleOf(m[f.key])) : ""}</td></tr>`).join("");
    const wideRows = S.wide ? prods.map((pr) => `<tr><td><strong>${E(pr.name.replace("Spiked ", ""))}</strong> <span class="imp-req">cases column</span></td><td><select onchange="App.impSetWideCol('${pr.id}', this.value)"><option value="-1">— none —</option>${S.headers.map((hh, i) => `<option value="${i}" ${S.wideCols[pr.id] === i ? "selected" : ""}>${E(hh || "Column " + (i + 1))}</option>`).join("")}</select></td><td class="muted imp-sample">${S.wideCols[pr.id] >= 0 ? E(sampleOf(S.wideCols[pr.id])) : ""}</td></tr>`).join("") : "";
    const needProduct = !S.wide && m.product < 0 && m.sku < 0;
    const prodTable = !S.wide && !needProduct && S.productTexts.length ? `<div class="section-title" style="margin-top:20px">Which of these products are Whatcha?</div>
      <div class="table-wrap"><table class="data" style="min-width:auto"><thead><tr><th class="no-sort">Product in the report</th><th class="no-sort num">Rows</th><th class="no-sort">Count it as</th></tr></thead><tbody>
      ${S.productTexts.slice(0, 60).map((t, i) => `<tr><td>${E(t)}</td><td class="num mono">${p.productTexts.get(t)}</td><td>${prodSelect(S.productMap[t], `App.impSetProduct(${i}, this.value)`)}</td></tr>`).join("")}</tbody></table></div>
      ${S.productTexts.length > 60 ? `<p class="muted" style="font-size:12px">Showing the 60 most common of ${S.productTexts.length}. Others are ignored.</p>` : ""}` : "";
    const preview = p.rows.slice(0, 8).map((r) => {
      const pid = r.pid || S.productMap[r.productText]; const date = r.date || S.fallbackDate;
      const prod = pid && pid !== "ignore" ? DB.product(pid) : null;
      const cs = prod ? (S.units === "units" ? r.qty / (prod.units_per_case || 24) : r.qty) : null;
      return `<tr><td>${E(r.store)}</td><td>${E(r.city || "")}${r.state ? ", " + E(r.state) : ""}</td><td>${date ? fd(date) : '<span class="muted">no date</span>'}</td><td>${prod ? E(prodName(pid)) : '<span class="muted">ignored</span>'}</td><td class="num mono">${cs == null ? "—" : fc(cs)}</td></tr>`;
    }).join("");
    const skipBits = [sk.totals && `${sk.totals} total ${plural(sk.totals, "row", "rows")}`, sk.noQty && `${sk.noQty} ${plural(sk.noQty, "row", "rows")} with no quantity`, sk.groupHeaders && `${sk.groupHeaders} customer heading ${plural(sk.groupHeaders, "line", "lines")} (used to group the items under them)`, sk.noStore && `${sk.noStore} with no store name`, sk.noProduct && `${sk.noProduct} with no product`].filter(Boolean);
    const problems = issues();
    return `<div class="panel">
      <div class="panel__head"><h3>2 · Check that I read it right</h3><span class="spacer"></span>${S.usedSaved ? '<span class="chip chip--sm chip--exported">✓ using your saved layout for this distributor</span>' : '<span class="chip chip--sm chip--lead">best guess — adjust anything that looks off</span>'}</div>
      <div class="imp-opts">
        ${S.sheets.length > 1 ? `<div class="field"><label>Sheet</label><select onchange="App.impSetSheet(this.value)">${S.sheets.map((sh, i) => `<option value="${i}" ${i === S.sheetIdx ? "selected" : ""}>${E(sh.name)} (${sh.rows.length} rows)</option>`).join("")}</select></div>` : ""}
        <div class="field"><label>Header row <span class="muted" style="font-weight:normal">(the row with column names)</span></label><input type="number" min="1" value="${S.headerRow + 1}" style="width:90px" onchange="App.impSetHeader(this.value)"></div>
        <div class="field"><label>Quantity is counted in</label><select onchange="App.impSetUnits(this.value)"><option value="cases" ${S.units === "cases" ? "selected" : ""}>Cases</option><option value="units" ${S.units === "units" ? "selected" : ""}>Individual pouches (÷ ${prods[0] ? prods[0].units_per_case : 24} per case)</option></select></div>
        <div class="field"><label>${m.date < 0 ? "Date this report covers" : "Date for rows that don’t have one"}</label><input type="date" value="${S.fallbackDate}" onchange="App.impSetFallback(this.value)"></div>
      </div>
      <div class="field" style="margin:4px 0 12px"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" style="width:auto" ${S.wide ? "checked" : ""} onchange="App.impSetWide(this.checked)"> Each flavor has its own column (instead of one product column)</label></div>
      <div class="table-wrap"><table class="data imp-map" style="min-width:auto"><thead><tr><th class="no-sort">What I need</th><th class="no-sort">Column in your file</th><th class="no-sort">Example values</th></tr></thead><tbody>${rows}${wideRows}</tbody></table></div>
      ${needProduct ? `<div class="field" style="margin-top:14px"><label>Every row in this report is for:</label>${`<select onchange="App.impSetSingle(this.value)"><option value="">— choose a product —</option>${prods.map((pr) => `<option value="${pr.id}" ${S.single === pr.id ? "selected" : ""}>${E(pr.name)}</option>`).join("")}</select>`}</div>` : ""}
      ${prodTable}
      <div class="section-title" style="margin-top:20px">Here’s how I’m reading your first rows</div>
      ${p.rows.length ? `<div class="table-wrap"><table class="data" style="min-width:auto"><thead><tr><th class="no-sort">Store</th><th class="no-sort">Location</th><th class="no-sort">Date</th><th class="no-sort">Product</th><th class="no-sort num">Cases</th></tr></thead><tbody>${preview}</tbody></table></div>` : `<div class="empty-state" style="padding:18px">No sales rows yet — adjust the columns above.</div>`}
      ${skipBits.length ? `<p class="muted" style="font-size:12px;margin:8px 2px 0">Not counted as sales: ${skipBits.join(" · ")}.</p>` : ""}
      <div class="imp-actions">${problems.length ? `<div class="imp-problems">${problems.map((x) => "• " + E(x)).join("<br>")}</div>` : "<span></span>"}
        <button class="btn btn--primary" ${problems.length ? "disabled" : ""} onclick="App.impReview()">Review what will change →</button></div>
    </div>`;
  }

  /* ---------- step 3: exactly what will happen ---------- */
  const confChip = (rs) => ({ sure: '<span class="chip chip--sm chip--sure">✓ matched</span>', check: '<span class="chip chip--sm chip--check">≈ likely match</span>', review: '<span class="chip chip--sm chip--review">? possible match</span>', new: '<span class="chip chip--sm chip--new">＋ new store</span>' }[rs.confidence]);
  function matchSelect(rs, i) {
    const cur = S.overrides[rs.key] || "auto";
    const autoLabel = rs.decision === "match" && cur === "auto" ? "✓ " + rs.store.name : rs.decision === "skip" && cur === "auto" ? "⛔ Skipped" : "＋ Create new account";
    const autoId = rs.decision === "match" && cur === "auto" ? rs.store.id : null;
    const cands = rs.match.candidates.filter((c) => c.store.id !== autoId).map((c) => `<option value="${c.store.id}" ${cur === c.store.id ? "selected" : ""}>Match: ${E(c.store.name)}${c.store.city ? " — " + E(c.store.city) : ""}</option>`).join("");
    return `<select class="imp-match" onchange="App.impSetOverride(${i}, this.value)"><option value="auto" ${cur === "auto" ? "selected" : ""}>${E(autoLabel)}</option>${cands}<option value="new" ${cur === "new" ? "selected" : ""}>＋ Create new account</option><option value="skip" ${cur === "skip" ? "selected" : ""}>⛔ Skip this store</option></select>`;
  }
  function reviewPanel() {
    const p = S.plan; if (!p) return "";
    const t = p.totals, c = p.counts, st = p.stats, O = p.options;
    const nothing = !t.orders && !p.storeUpdates.length && !p.orderUpdates.length && !p.newStores.length;
    const tile = (cls, label, val, sub) => `<div class="kpi ${cls || ""}"><div class="kpi__label">${label}</div><div class="kpi__value">${val}</div><div class="kpi__sub">${sub || ""}</div></div>`;
    const tiles = [
      tile("kpi--accent", "New orders", t.orders, `${fc(t.newCases)} ${plural(t.newCases, "case", "cases")}${t.range ? " · " + fd(t.range[0]) + " – " + fd(t.range[1]) : ""}`),
      tile("kpi--teal", "New accounts", t.newAccounts, t.newAccountsNoMap ? `${t.newAccountsNoMap} without a street address won’t show on the public map yet` : "added as active stores"),
      tile("kpi--coral", "Accounts updated", t.activated + t.filled, `${t.activated} marked active · ${t.filled} missing details filled in`),
      c.reconciled ? tile("", "Matched to your orders", c.reconciled, "confirmed — not counted twice") : "",
      c.duplicates ? tile("", "Already imported", c.duplicates, "lines I’ve seen before — skipped") : "",
      c.changed ? tile("", "Corrections", c.changed, "quantities changed since last time") : "",
      p.leadWins.length ? tile("", "Leads won 🎉", p.leadWins.length, "now accounts") : "",
    ].join("");
    const needs = p.reportStores.map((rs, i) => ({ rs, i })).filter(({ rs }) => rs.confidence !== "sure");
    const sure = p.reportStores.map((rs, i) => ({ rs, i })).filter(({ rs }) => rs.confidence === "sure");
    const storeRow = ({ rs, i }) => `<tr><td><strong>${E(Importer.tidyName(rs.name))}</strong><div class="muted" style="font-size:12px">${E([rs.address, rs.city, rs.state].filter(Boolean).join(", "))}${rs.acct ? " · acct " + E(rs.acct) : ""}</div></td><td class="num mono">${fc(rs.cases)}</td><td>${confChip(rs)}</td><td>${matchSelect(rs, i)}</td></tr>`;
    const storeTable = (arr) => `<div class="table-wrap imp-scroll"><table class="data" style="min-width:560px"><thead><tr><th class="no-sort">Store in the report</th><th class="no-sort num">Cases</th><th class="no-sort">Status</th><th class="no-sort">What I’ll do</th></tr></thead><tbody>${arr.map(storeRow).join("")}</tbody></table></div>`;
    const skipBits = [st.ignoredProduct && `${st.ignoredProduct} ${plural(st.ignoredProduct, "line", "lines")} for other products`, st.credits && `${st.credits} ${plural(st.credits, "return netted", "returns netted")} to zero`, st.zeroLines && `${st.zeroLines} zero-quantity ${plural(st.zeroLines, "line", "lines")}`, st.noDate && `${st.noDate} ${plural(st.noDate, "line", "lines")} with no date`].filter(Boolean);
    return `<div class="panel">
      <div class="panel__head"><h3>3 · Review — nothing is saved until you confirm</h3></div>
      <div class="kpi-grid imp-kpis">${tiles}</div>
      <div class="imp-optrow">
        <label><input type="checkbox" ${O.createNew ? "checked" : ""} onchange="App.impSetOpt('createNew', this.checked)"> Add stores I don’t have yet as new active accounts</label>
        <label><input type="checkbox" ${O.publishNew ? "checked" : ""} onchange="App.impSetOpt('publishNew', this.checked)"> Show new stores that have a full address on the public map</label>
        <label><input type="checkbox" ${O.reconcile ? "checked" : ""} onchange="App.impSetOpt('reconcile', this.checked)"> Match against orders I logged by hand (so they’re not counted twice)</label>
      </div>
      ${needs.length ? `<div class="section-title">Take a look at these (${needs.length})</div>${storeTable(needs)}` : ""}
      ${sure.length ? `<details class="imp-sure"><summary>${sure.length} ${plural(sure.length, "store", "stores")} matched to your accounts automatically</summary>${storeTable(sure)}</details>` : ""}
      ${p.reconciled.length ? `<div class="section-title">Matched to orders you logged by hand</div><div class="table-wrap"><table class="data" style="min-width:auto"><thead><tr><th class="no-sort">Store</th><th class="no-sort">You logged</th><th class="no-sort">Distributor shipped</th></tr></thead><tbody>${p.reconciled.map((r) => `<tr><td>${E(Importer.tidyName(r.store))}</td><td>${fc(r.handCases)} cases · ${fd(r.handDate)}</td><td>${fc(r.reportCases)} cases · ${fd(r.reportDate)}${Math.abs(r.handCases - r.reportCases) > 0.01 ? ' <span class="chip chip--sm chip--check">qty differs</span>' : ""}</td></tr>`).join("")}</tbody></table></div><p class="muted" style="font-size:12px;margin:6px 2px 0">I use the distributor’s numbers as the truth and count each sale once.</p>` : ""}
      ${p.changedLines.length ? `<div class="section-title">Corrections to earlier imports</div><div class="table-wrap"><table class="data" style="min-width:auto"><tbody>${p.changedLines.slice(0, 20).map((r) => `<tr><td>${E(Importer.tidyName(r.store))}</td><td>${fd(r.date)}</td><td>${fc(r.from)} → <strong>${fc(r.to)}</strong> cases</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${p.leadWins.length ? `<div class="section-title">Leads that just became accounts 🎉</div><p style="margin:4px 0">${p.leadWins.map((w) => E(w.leadName)).join(", ")} — I’ll mark ${plural(p.leadWins.length, "it", "them")} as won.</p>` : ""}
      ${skipBits.length ? `<p class="muted" style="font-size:12px;margin:12px 2px 0">Also in the file but not counted: ${skipBits.join(" · ")}.</p>` : ""}
      <div class="imp-actions"><button class="btn btn--ghost" onclick="App.impBack()">← Back</button>
        ${nothing ? '<div class="imp-problems" style="color:var(--ok)">✓ Everything in this report is already in your dashboard — nothing new to add.</div>' : ""}
        <button class="btn btn--coral" ${nothing ? "disabled" : ""} onclick="App.impCommit()">✓ Import ${t.orders} ${plural(t.orders, "order", "orders")}${t.newAccounts ? " + " + t.newAccounts + " new " + plural(t.newAccounts, "account", "accounts") : ""}</button></div>
    </div>`;
  }

  function donePanel() {
    const r = S.result; if (!r) return "";
    const bits = [
      `<strong>${r.orders}</strong> ${plural(r.orders, "order", "orders")} added (${fc(r.cases)} cases)`, r.newStores && `<strong>${r.newStores}</strong> new ${plural(r.newStores, "account", "accounts")}`,
      r.activated && `<strong>${r.activated}</strong> ${plural(r.activated, "account", "accounts")} marked active`, r.reconciled && `<strong>${r.reconciled}</strong> matched to orders you’d logged`,
      r.changed && `<strong>${r.changed}</strong> ${plural(r.changed, "correction", "corrections")}`, r.leadsWon && `<strong>${r.leadsWon}</strong> ${plural(r.leadsWon, "lead", "leads")} won`,
    ].filter(Boolean);
    return `<div class="panel imp-done"><div class="imp-done__ico">🎉</div><h3>Imported ${E(r.fileName)}</h3>
      <p style="margin:6px 0 14px">${bits.join(" · ")}.</p>
      <div class="btn-row" style="justify-content:center"><button class="btn btn--primary" onclick="App.go('insights')">💡 See what the data says</button><button class="btn btn--ghost" onclick="App.go('accounts')">View accounts</button><button class="btn btn--ghost" onclick="App.impReset()">Import another report</button><button class="btn btn--ghost" onclick="App.impUndo('${r.id}')">Undo this import</button></div></div>`;
  }

  function historyPanel() {
    const log = DB.kvGet("import_log", []);
    if (!log.length) return "";
    return `<div class="panel"><div class="panel__head"><h3>Import history</h3></div><div class="table-wrap"><table class="data" style="min-width:560px"><thead><tr><th class="no-sort">When</th><th class="no-sort">File</th><th class="no-sort">Distributor</th><th class="no-sort">What changed</th><th class="no-sort"></th></tr></thead><tbody>
      ${log.map((e) => `<tr><td>${new Date(e.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}<div class="muted" style="font-size:12px">${ago(e.at)}</div></td><td>${E(e.fileName)}${e.range ? `<div class="muted" style="font-size:12px">${fd(e.range[0])} – ${fd(e.range[1])}</div>` : ""}</td><td>${E(e.distributor_name || "")}</td>
      <td style="font-size:13px">${e.orders} ${plural(e.orders, "order", "orders")} · ${fc(e.cases)} cases${e.newStores ? " · " + e.newStores + " new " + plural(e.newStores, "account", "accounts") : ""}${e.duplicates ? ' <span class="muted">· ' + e.duplicates + " already had</span>" : ""}</td>
      <td class="right"><button class="btn btn--ghost btn--sm" onclick="App.impUndo('${e.id}')">Undo</button></td></tr>`).join("")}</tbody></table></div></div>`;
  }

  /* ---------- wiring ---------- */
  function wire() {
    ["imp-file", "imp-file2"].forEach((id) => { const f = document.getElementById(id); if (f) f.onchange = () => { const file = f.files && f.files[0]; f.value = ""; loadFile(file); }; });
    const drop = document.getElementById("imp-drop");
    if (drop) {
      ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
      ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("is-over"); }));
      drop.addEventListener("drop", (e) => { const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) loadFile(f); });
    }
  }
  Object.assign(App, {
    impLoadFile: loadFile,
    impSetDist(id) { S.distId = id; S.plan = null; if (S.step === 3) S.step = 2; renderImport(); },
    impSetMap(key, v) { S.mapping[key] = +v; if (key === "product" && +v >= 0) { S.wide = false; S.wideCols = {}; } reparse(); renderImport(); },
    impSetSheet(i) { S.sheetIdx = +i; analyze({ redetect: true }); renderImport(); },
    impSetHeader(n) { S.headerRow = Math.max(0, (+n || 1) - 1); analyze({ redetect: false }); renderImport(); },
    impSetUnits(u) { S.units = u; S.plan = null; renderImport(); },
    impSetFallback(d) { S.fallbackDate = d; S.plan = null; renderImport(); },
    impSetWide(on) { S.wide = !!on; S.wideCols = on ? Importer.guessWide(S.headers, DB.products()) : {}; if (on) { S.mapping.product = -1; S.mapping.sku = -1; } reparse(); renderImport(); },
    impSetWideCol(pid, i) { if (+i >= 0) S.wideCols[pid] = +i; else delete S.wideCols[pid]; reparse(); renderImport(); },
    impSetSingle(pid) { S.single = pid; reparse(); renderImport(); },
    impSetProduct(i, v) { S.productMap[S.productTexts[i]] = v; S.plan = null; renderImport(); },
    impReview() { if (issues().length) return; try { buildPlan(); S.step = 3; S.error = ""; } catch (e) { S.error = "I couldn't build the review: " + ((e && e.message) || e); console.error(e); } renderImport(); window.scrollTo(0, 0); const m = $(".main"); if (m) m.scrollTop = 0; },
    impBack() { S.step = 2; renderImport(); },
    impSetOpt(k, v) { S.options[k] = !!v; buildPlan(); renderImport(); },
    impSetOverride(i, v) { const rs = S.plan.reportStores[i]; if (!rs) return; if (v === "auto") delete S.overrides[rs.key]; else S.overrides[rs.key] = v; buildPlan(); renderImport(); },
    impCommit: commit,
    impReset() { const d = S.distId; S = fresh(); S.distId = d; renderImport(); },
    async impUndo(id) {
      const e = DB.kvGet("import_log", []).find((x) => x.id === id); if (!e) return;
      if (!confirm(`Undo "${e.fileName}"?\n\nThis removes the ${e.orders} order${e.orders === 1 ? "" : "s"} it added${e.newStores ? " and the " + e.newStores + " account" + (e.newStores === 1 ? "" : "s") + " it created" : ""}, and puts everything it changed back the way it was.`)) return;
      try { const r = await Importer.undo(id); App.toast(`Undone — ${r.removedOrders} order${r.removedOrders === 1 ? "" : "s"} removed`); if (S.result && S.result.id === id) { const d = S.distId; S = fresh(); S.distId = d; } }
      catch (err) { App.toast("Couldn't undo: " + ((err && err.message) || err), "err"); }
      renderImport();
    },
  });

  /* =====================================================================
     INSIGHTS
     ===================================================================== */
  const IS = { dist: "all", period: "90", watchAll: false };
  const stat = (a) => ({ due: ["Due about now", "chip--lead"], overdue: ["Overdue", "chip--new"], quiet: ["Gone quiet", "chip--inactive"], noreorder: ["No reorder yet", "chip--prospect"] }[a.status]);
  const delta = (cur, prev) => { if (prev == null || !prev) return ""; const p = ((cur - prev) / prev) * 100; return `<span class="ins-delta ${p >= 0 ? "up" : "down"}">${p >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(p))}%</span>`; };

  function renderInsights() {
    const v = $("#view"); if (!v) return;
    const dists = DB.distributors();
    const r = Insights.compute({ dist: IS.dist, period: IS.period });
    const filters = `<div class="ins-filters"><div class="pill-filter" style="margin:0">${Insights.PERIODS.map(([k, l]) => `<button class="${IS.period === k ? "active" : ""}" onclick="App.insSet('period','${k}')">${l}</button>`).join("")}</div>
      ${dists.length > 1 ? `<select onchange="App.insSet('dist', this.value)"><option value="all">All distributors</option>${dists.map((d) => `<option value="${d.id}" ${IS.dist === d.id ? "selected" : ""}>${E(d.name)}</option>`).join("")}</select>` : ""}</div>`;
    if (r.empty) {
      v.innerHTML = `${filters}<div class="panel"><div class="empty-state"><div class="big">💡</div>No orders yet — insights appear as soon as there’s sales data.<div style="margin-top:12px"><button class="btn btn--primary" onclick="App.go('import')">📥 Import a distributor report</button></div></div></div>`; return;
    }
    const k = r.k;
    const kpi = (cls, label, val, sub) => `<div class="kpi ${cls}"><div class="kpi__label">${label}</div><div class="kpi__value">${val}</div><div class="kpi__sub">${sub}</div></div>`;
    const stories = r.stories.map((s) => `<div class="ins-story ins-${s.tone}"><div class="ins-story__ico">${s.ico}</div><div><div class="ins-story__t">${E(s.title)}</div><div class="ins-story__x">${E(s.text)}</div>${s.go === "import" ? `<a class="ins-link" href="#import" onclick="App.go('import');return false">Upload a report →</a>` : s.go === "watch" ? `<a class="ins-link" href="#ins-watch" onclick="document.getElementById('ins-watch').scrollIntoView({behavior:'smooth'});return false">See the list →</a>` : ""}</div></div>`).join("");
    const series = r.productMix.map((p) => ({ name: p.name, color: App.productColors([p.name])[0] }));
    const watch = IS.watchAll ? r.watch : r.watch.slice(0, 12);
    const mover = (a, sign) => `<tr class="clickable" onclick="App.accountDetail('${a.id}')"><td>${E(a.name)}<div class="muted" style="font-size:12px">${E(a.city || "")}${a.city ? ", " : ""}${E(a.state || "")}</div></td><td class="num mono">${fc(a.prevC)} → ${fc(a.curC)}</td><td class="num mono ${sign > 0 ? "ins-up" : "ins-down"}">${sign > 0 ? "+" : ""}${fc(a.delta)}</td></tr>`;
    v.innerHTML = `${filters}
      <div class="ins-asof">Data through <strong>${fd(r.asOf)}</strong> · showing ${IS.period === "all" ? "everything since " + fd(r.first) : "the last " + r.days + " days"}${r.hasPrev ? " vs the " + r.days + " before" : ""}</div>
      <div class="panel ins-stories"><div class="panel__head"><h3>What stands out</h3></div><div class="ins-grid">${stories || '<div class="muted">Nothing notable yet — more data will sharpen this.</div>'}</div></div>
      <div class="kpi-grid">
        ${kpi("kpi--accent", "Cases", fc(k.cases), r.hasPrev ? delta(k.cases, k.prevCases) + " vs prior" : "this period")}
        ${kpi("kpi--teal", "Active stores", k.stores, r.hasPrev ? delta(k.stores, k.prevStores) + " vs prior" : "ordered this period")}
        ${kpi("", "Orders", k.orders, r.hasPrev ? delta(k.orders, k.prevOrders) + " vs prior" : "")}
        ${kpi("kpi--coral", "Avg order", fc(k.avgOrder) + " <span style='font-size:16px'>cases</span>", r.hasPrev && k.prevAvgOrder ? delta(k.avgOrder, k.prevAvgOrder) + " vs prior" : "")}
      </div>
      <div class="grid-2">
        <div class="panel"><div class="panel__head"><h3>Cases by ${r.trendUnit}</h3></div>${Charts.line(r.trend, { money: false })}</div>
        <div class="panel"><div class="panel__head"><h3>Flavor mix by month</h3></div>${Charts.stacked(r.flavorByMonth, series)}</div>
      </div>
      <div class="panel" id="ins-watch"><div class="panel__head"><h3>⏰ Reorder watch</h3><span class="spacer"></span><span class="muted" style="font-size:12px">compared to each store’s own rhythm</span></div>
        ${r.watch.length ? `<div class="table-wrap"><table class="data"><thead><tr><th class="no-sort">Account</th><th class="no-sort">Last order</th><th class="no-sort">Usual rhythm</th><th class="no-sort">Status</th><th class="no-sort num">Typical order</th></tr></thead><tbody>
          ${watch.map((a) => { const [lbl, cls] = stat(a); return `<tr class="clickable" onclick="App.accountDetail('${a.id}')"><td><strong>${E(a.name)}</strong><div class="muted" style="font-size:12px">${E(a.city || "")}${a.city ? ", " : ""}${E(a.state || "")}</div></td><td>${fd(a.last)}<div class="muted" style="font-size:12px">${a.daysSince} days before the data ends</div></td><td>${a.med ? "every ~" + Math.round(a.med) + " days" : '<span class="muted">1 order so far</span>'}${a.expected ? `<div class="muted" style="font-size:12px">expected ~${fd(a.expected)}</div>` : ""}</td><td><span class="chip chip--sm ${cls}">${lbl}</span></td><td class="num mono">${fc(a.avgOrder)} cs</td></tr>`; }).join("")}</tbody></table></div>
          ${r.watch.length > 12 ? `<div style="margin-top:10px"><button class="btn btn--ghost btn--sm" onclick="App.insSet('watchAll', ${!IS.watchAll})">${IS.watchAll ? "Show fewer" : "Show all " + r.watch.length}</button></div>` : ""}` : '<div class="empty-state" style="padding:20px">✓ Every account is ordering on its usual rhythm.</div>'}
      </div>
      ${r.hasPrev ? `<div class="grid-2">
        <div class="panel"><div class="panel__head"><h3>🚀 Biggest gainers</h3></div>${r.gainers.length ? `<div class="table-wrap"><table class="data" style="min-width:auto"><tbody>${r.gainers.map((a) => mover(a, 1)).join("")}</tbody></table></div>` : '<div class="muted">No gainers yet.</div>'}</div>
        <div class="panel"><div class="panel__head"><h3>🔻 Biggest slowdowns</h3></div>${r.decliners.length ? `<div class="table-wrap"><table class="data" style="min-width:auto"><tbody>${r.decliners.map((a) => mover(a, -1)).join("")}</tbody></table></div>` : '<div class="muted">Nobody’s slowing down. 🎉</div>'}</div>
      </div>` : ""}
      <div class="grid-2">
        <div class="panel"><div class="panel__head"><h3>Where it’s selling</h3></div>${Charts.bars(r.byState.map((s) => ({ label: s.label, value: s.cases })), { money: false, height: 200 })}
          <div class="table-wrap" style="margin-top:10px"><table class="data" style="min-width:auto"><thead><tr><th class="no-sort">State</th><th class="no-sort num">Cases</th><th class="no-sort num">Stores</th><th class="no-sort num">vs prior</th></tr></thead><tbody>${r.byState.map((s) => `<tr><td>${E(s.label)}</td><td class="num mono">${fc(s.cases)}</td><td class="num mono">${s.stores}</td><td class="num">${s.change == null ? '<span class="muted">—</span>' : delta(s.cases, s.prev)}</td></tr>`).join("")}</tbody></table></div></div>
        <div class="panel"><div class="panel__head"><h3>Top towns</h3></div><div class="table-wrap"><table class="data" style="min-width:auto"><thead><tr><th class="no-sort">Town</th><th class="no-sort num">Cases</th><th class="no-sort num">Stores</th></tr></thead><tbody>${r.byCity.map((c) => `<tr><td>${E(c.label)}</td><td class="num mono">${fc(c.cases)}</td><td class="num mono">${c.stores}</td></tr>`).join("")}</tbody></table></div></div>
      </div>
      <div class="panel"><div class="panel__head"><h3>🚚 Distributors</h3></div><div class="table-wrap"><table class="data"><thead><tr><th class="no-sort">Distributor</th><th class="no-sort num">Cases</th><th class="no-sort num">Stores</th><th class="no-sort num">Avg order</th><th class="no-sort">Latest data</th></tr></thead><tbody>
        ${r.distributors.map((d) => d.empty ? `<tr><td>${E(d.name)}</td><td colspan="4" class="muted">No orders yet — <a href="#import" onclick="App.go('import');return false">import their first report</a></td></tr>` : `<tr><td><strong>${E(d.name)}</strong></td><td class="num mono">${fc(d.cases)} ${r.hasPrev ? delta(d.cases, d.prev) : ""}</td><td class="num mono">${d.stores}</td><td class="num mono">${fc(d.avg)}</td><td>${fd(d.last)}<div class="${d.stale > 35 ? "ins-down" : "muted"}" style="font-size:12px">${d.stale > 35 ? "⚠ " : ""}${d.stale} days old</div></td></tr>`).join("")}</tbody></table></div></div>`;
  }
  Object.assign(App, { insSet(k, v) { IS[k] = v; renderInsights(); } });

  /* =====================================================================
     Dashboard nudge: "time for a fresh report?"
     ===================================================================== */
  function freshStrip() {
    const dists = DB.distributors(); if (!dists.length) return "";
    const last = new Map();
    DB.pricedOrders().forEach((o) => { if (!o.distributor_id) return; const c = last.get(o.distributor_id); if (!c || o.date > c) last.set(o.distributor_id, o.date); });
    const today = new Date().toISOString().slice(0, 10);
    const needs = dists.map((d) => { const l = last.get(d.id); return { d, last: l, age: l ? Insights._days(l, today) : null }; }).filter((r) => r.age == null || r.age > 21);
    if (!needs.length) return "";
    const msg = needs.map((r) => (r.last ? `<strong>${E(r.d.name)}</strong> — data through ${fd(r.last)} (${r.age} days ago)` : `<strong>${E(r.d.name)}</strong> — no report imported yet`)).join(" &nbsp;·&nbsp; ");
    return `<div class="panel imp-fresh"><div class="imp-fresh__ico">📥</div><div class="imp-fresh__body"><div class="imp-fresh__t">Time for a fresh distributor report?</div><div class="imp-fresh__x">${msg}</div></div><button class="btn btn--primary btn--sm" onclick="App.go('import')">Import a report</button></div>`;
  }
  const origDash = App.renderDashboard;
  if (origDash) App.renderDashboard = function () {
    origDash.apply(this, arguments);
    try { const s = freshStrip(); if (s) $("#view").insertAdjacentHTML("afterbegin", s); } catch (e) { /* never block the dashboard */ }
  };

  /* =====================================================================
     wire into the app (same pattern as the Website analytics module)
     ===================================================================== */
  const at = App.NAV.findIndex((n) => n.id === "orders");
  App.NAV.splice(at < 0 ? 1 : at + 1, 0, { id: "import", label: "Import", ico: "📥" }, { id: "insights", label: "Insights", ico: "💡" });
  const origGo = App.go;
  App.go = function (view) {
    if (view !== "import" && view !== "insights") return origGo.call(this, view);
    try { if (window.WA && WA.stop) WA.stop(); } catch (e) { /* stop the website module's polling */ }
    this.view = view;
    if (location.hash !== "#" + view) location.hash = view;
    this.renderNav();
    $("#topbar-title").textContent = view === "import" ? "Import Distributor Reports" : "Insights";
    this.closeMobileNav && this.closeMobileNav();
    if (view === "import") renderImport(); else renderInsights();
    const main = $(".main"); if (main) main.scrollTop = 0; window.scrollTo(0, 0);
  };
})();
