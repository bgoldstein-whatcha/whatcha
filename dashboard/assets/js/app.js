/* ============================================================
   Whatcha Dashboard — app controller
   ============================================================ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (d) => d ? new Date(d + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const US_STATES = ["CT", "NY", "MA", "RI", "NJ", "PA", "VT", "NH", "ME", "FL", "CA", "TX"];

const App = {
  view: "dashboard",
  search: "",
  leadFilter: "",
  _topPoi: null,
  sb: null,

  /* ---------------- AUTH GATE ---------------- */
  async initAuth() {
    if (DB.mode === "supabase") {
      if (!window.supabase || !(window.WHATCHA_CONFIG && window.WHATCHA_CONFIG.supabaseUrl)) {
        return this.fatalGate("Live mode isn't configured — check config.js and your connection.");
      }
      this.sb = window.supabase.createClient(window.WHATCHA_CONFIG.supabaseUrl, window.WHATCHA_CONFIG.supabaseAnonKey);
      SupabaseBackend.init(this.sb);
      DB.backend = SupabaseBackend;
      try {
        const { data } = await this.sb.auth.getSession();
        if (data && data.session) { await this.enterApp(); return; }
      } catch (e) { /* fall through to gate */ }
      this.showGate();
    } else {
      const authed = sessionStorage.getItem("whatcha_authed") === "1";
      if (authed) this.showApp(); else this.showGate();
    }
  },
  showGate() {
    $("#gate").classList.remove("hidden");
    $("#app").classList.add("hidden");
    const modeEl = $(".gate__mode");
    if (modeEl) modeEl.innerHTML = DB.mode === "supabase"
      ? `Whatcha HQ — sign in with your account.`
      : `Running in <strong>demo mode</strong> — type anything to explore.`;
    const form = $("#gate-form");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const email = $("#gate-email").value.trim();
      const pass = $("#gate-pass").value.trim();
      const msg = $("#gate-msg");
      if (DB.mode === "supabase") {
        if (!email || !pass) { msg.textContent = "Enter your email and password."; msg.className = "gate__msg err"; return; }
        const btn = form.querySelector("button[type=submit]");
        msg.textContent = "Signing in…"; msg.className = "gate__msg"; if (btn) btn.disabled = true;
        const { error } = await this.sb.auth.signInWithPassword({ email, password: pass });
        if (btn) btn.disabled = false;
        if (error) { msg.textContent = error.message || "Sign-in failed."; msg.className = "gate__msg err"; return; }
        msg.textContent = "Loading your data…"; msg.className = "gate__msg";
        try { await this.enterApp(); }
        catch (err) { msg.textContent = this._hydrateErr(err); msg.className = "gate__msg err"; }
      } else {
        if (!email || !pass) { msg.textContent = "Enter anything to explore the demo."; msg.className = "gate__msg err"; return; }
        sessionStorage.setItem("whatcha_authed", "1");
        this.showApp();
      }
    };
  },
  _hydrateErr(err) {
    const m = (err && err.message) || "";
    if (/schema cache|does not exist|PGRST205|relation|not find the table/i.test(m)) return "Database not set up yet — run supabase-schema.sql in Supabase, then try again.";
    return "Couldn't load your data: " + m;
  },
  async enterApp() {
    await SupabaseBackend.hydrate();
    this.showApp();
  },
  showApp() {
    $("#gate").classList.add("hidden");
    $("#app").classList.remove("hidden");
    this.renderNav();
    this.go(location.hash.replace("#", "") || "dashboard");
  },
  async logout() {
    if (DB.mode === "supabase" && this.sb) { try { await this.sb.auth.signOut(); } catch (e) {} }
    sessionStorage.removeItem("whatcha_authed");
    location.hash = "";
    this.showGate();
  },
  fatalGate(text) {
    $("#gate").classList.remove("hidden"); $("#app").classList.add("hidden");
    const msg = $("#gate-msg"); if (msg) { msg.textContent = text; msg.className = "gate__msg err"; }
  },

  /* ---------------- NAV / ROUTER ---------------- */
  NAV: [
    { id: "dashboard", label: "Dashboard", ico: "📊" },
    { id: "orders", label: "Orders", ico: "🧾" },
    { id: "accounts", label: "Accounts", ico: "🏪" },
    { id: "leads", label: "Leads", ico: "🎯" },
    { id: "distributors", label: "Distributors", ico: "🚚" },
    { id: "pricing", label: "Pricing", ico: "🏷️" },
    { id: "settings", label: "Settings", ico: "⚙️" },
  ],
  renderNav() {
    $("#nav").innerHTML = this.NAV.map((n) =>
      `<button class="nav-item ${n.id === this.view ? "active" : ""}" data-nav="${n.id}"><span class="ico">${n.ico}</span>${n.label}</button>`
    ).join("");
    $$("[data-nav]").forEach((b) => b.onclick = () => { this.go(b.dataset.nav); this.closeMobileNav(); });
  },
  go(view) {
    this.view = view; location.hash = view;
    this.renderNav();
    const titles = { dashboard: "Dashboard", orders: "Orders", accounts: "Accounts & Customers", leads: "Leads & Recommendations", distributors: "Distributors & Exports", pricing: "State Pricing", settings: "Settings" };
    $("#topbar-title").textContent = titles[view] || "Dashboard";
    const map = { dashboard: "renderDashboard", orders: "renderOrders", accounts: "renderAccounts", leads: "renderLeads", distributors: "renderDistributors", pricing: "renderPricing", settings: "renderSettings" };
    this[map[view]] ? this[map[view]]() : this.renderDashboard();
    $(".main").scrollTop = 0; window.scrollTo(0, 0);
  },
  toggleMobileNav() { $("#app").classList.toggle("nav-open"); },
  closeMobileNav() { $("#app").classList.remove("nav-open"); },

  /* ---------------- PRODUCT COLORS ---------------- */
  // Brand rule: Peach Lemonade = orange (coral), Tropical Punch = teal.
  PROD_COLORS: { peach: "#f37847", punch: "#27baad" },
  productColors(labels) {
    return labels.map((l) => /peach/i.test(l) ? this.PROD_COLORS.peach : /punch|tropical/i.test(l) ? this.PROD_COLORS.punch : "#0526c5");
  },

  /* ---------------- DASHBOARD ---------------- */
  renderDashboard() {
    const a = DB.analytics();
    const geo = DB.geography();
    const thisMonth = new Date().toISOString().slice(0, 7);
    const monthCases = a.casesByMonth.find((m) => m.label === thisMonth);
    const prevC = a.casesByMonth[a.casesByMonth.length - 2];
    const curC = a.casesByMonth[a.casesByMonth.length - 1];
    let momPct = null;
    if (prevC && curC && prevC.value) momPct = ((curC.value - prevC.value) / prevC.value) * 100;

    const html = `
      <div class="quick-hero">
        <div>
          <div class="quick-hero__k">On the ground?</div>
          <div class="quick-hero__t">Log a store &amp; its first order in one go.</div>
        </div>
        <button class="btn btn--primary" onclick="App.quickSaleModal()" style="font-size:15px">＋ New sale</button>
      </div>

      <div class="kpi-grid">
        <div class="kpi kpi--accent">
          <div class="kpi__label">Cases Sold</div>
          <div class="kpi__value">${a.cases.toLocaleString()}</div>
          <div class="kpi__sub">${a.units.toLocaleString()} pouches · all time</div>
        </div>
        <div class="kpi kpi--teal">
          <div class="kpi__label">Avg Order Size</div>
          <div class="kpi__value">${a.aovCases.toFixed(1)} <span style="font-size:16px">cases</span></div>
          <div class="kpi__sub">${a.orderCount} orders placed</div>
        </div>
        <div class="kpi">
          <div class="kpi__label">Cases This Month</div>
          <div class="kpi__value">${(monthCases ? monthCases.value : 0).toLocaleString()}</div>
          <div class="kpi__sub ${momPct > 0 ? "up" : momPct < 0 ? "down" : ""}">${momPct == null ? "—" : (momPct >= 0 ? "▲ " : "▼ ") + Math.abs(momPct).toFixed(0) + "% vs last month"}</div>
        </div>
        <div class="kpi kpi--coral">
          <div class="kpi__label">Total Accounts</div>
          <div class="kpi__value">${geo.total}</div>
          <div class="kpi__sub">${geo.active} active · ${geo.leads} in pipeline · ${geo.stateCount} states</div>
        </div>
      </div>

      <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))">
        <div class="kpi" style="box-shadow:none;background:#fff">
          <div class="kpi__label">Total Revenue</div>
          <div class="kpi__value" style="font-size:24px">${fmtMoney(a.revenue)}</div>
          <div class="kpi__sub">avg ${fmtMoney(a.aov)} / order</div>
        </div>
        <div class="kpi" style="box-shadow:none;background:#fff">
          <div class="kpi__label">Active Markets</div>
          <div class="kpi__value" style="font-size:24px">${geo.stateCount} states</div>
          <div class="kpi__sub">${geo.byState.slice(0, 4).map((s) => s.label + " (" + s.value + ")").join(" · ")}</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel__head"><h3>Cases sold</h3><span class="spacer"></span><span class="muted" style="font-size:12px">by month</span></div>
        ${Charts.line(a.casesByMonth, { money: false })}
      </div>

      <div class="grid-2">
        <div class="panel">
          <div class="panel__head"><h3>Where your accounts are</h3><span class="spacer"></span><span class="muted" style="font-size:12px">stores by state</span></div>
          ${Charts.bars(geo.byState, { money: false })}
        </div>
        <div class="panel">
          <div class="panel__head"><h3>Product mix</h3><span class="spacer"></span><span class="muted" style="font-size:12px">by cases</span></div>
          ${Charts.donut(a.byProductCases, { colors: this.productColors(a.byProductCases.map((d) => d.label)), money: false, unit: "cases" })}
        </div>
      </div>

      <div class="grid-2">
        <div class="panel">
          <div class="panel__head"><h3>Cases by state</h3></div>
          ${Charts.bars(a.byState.map((s) => ({ label: s.label, value: (a.orders.filter((o) => o.state === s.label).reduce((x, o) => x + o.cases, 0)) })), { money: false })}
        </div>
        <div class="panel">
          <div class="panel__head"><h3>Top accounts</h3><span class="spacer"></span><span class="muted" style="font-size:12px">by cases</span></div>
          <div class="table-wrap"><table class="data">
            <thead><tr><th class="no-sort">Account</th><th class="no-sort num">Cases</th><th class="no-sort num">Revenue</th></tr></thead>
            <tbody>${a.topAccountsCases.map((t) => { const rev = (a.topAccounts.find((x) => x.label === t.label) || {}).value || 0; return `<tr><td>${esc(t.label)}</td><td class="num mono">${t.value}</td><td class="num mono muted">${fmtMoney(rev)}</td></tr>`; }).join("") || `<tr><td colspan="3" class="t-empty">No orders yet</td></tr>`}</tbody>
          </table></div>
        </div>
      </div>

      <div class="panel">
        <div class="panel__head"><h3>Revenue</h3><span class="spacer"></span><span class="muted" style="font-size:12px">by month</span></div>
        ${Charts.line(a.byMonth)}
      </div>`;
    $("#view").innerHTML = html;
  },

  /* ---------------- ORDERS ---------------- */
  ordersSort: { key: "date", dir: -1 },
  renderOrders() {
    let ords = DB.pricedOrders();
    const q = this.search.toLowerCase();
    if (q) ords = ords.filter((o) => o.store_name.toLowerCase().includes(q) || o.state.toLowerCase().includes(q));
    const { key, dir } = this.ordersSort;
    ords.sort((a, b) => {
      let va = a[key], vb = b[key];
      if (typeof va === "string") return va.localeCompare(vb) * dir;
      return (va - vb) * dir;
    });

    const head = [
      ["date", "Date"], ["store_name", "Account"], ["state", "State"],
      ["cases", "Cases", "num"], ["total", "Total", "num"],
    ];
    const html = `
      <div class="btn-row" style="margin-bottom:18px">
        <button class="btn btn--coral" onclick="App.quickSaleModal()">＋ New sale (store + order)</button>
        <button class="btn btn--ghost" onclick="App.orderModal()">Order for existing store</button>
        <span class="spacer" style="flex:1"></span>
        <button class="btn btn--ghost" onclick="App.exportSalesModal()">⬇ Export sales (CSV)</button>
      </div>
      <div class="panel">
        <div class="panel__head"><h3>${ords.length} order${ords.length === 1 ? "" : "s"}</h3></div>
        <div class="table-wrap"><table class="data">
          <thead><tr>
            ${head.map(([k, l, cls]) => `<th class="${cls || ""}" data-sort="${k}">${l} ${this.ordersSort.key === k ? `<span class="arrow">${dir > 0 ? "▲" : "▼"}</span>` : ""}</th>`).join("")}
            <th class="no-sort">Products</th><th class="no-sort"></th>
          </tr></thead>
          <tbody>
          ${ords.map((o) => `
            <tr class="clickable" onclick="App.orderModal('${o.id}')">
              <td>${fmtDate(o.date)}</td>
              <td>${esc(o.store_name)}${o.hasMissing ? ' <span class="chip chip--sm" style="background:#ffe0e0">no price</span>' : ""}</td>
              <td><span class="chip chip--sm">${o.state}</span></td>
              <td class="num mono">${o.cases}</td>
              <td class="num mono">${fmtMoney2(o.total)}</td>
              <td class="muted" style="font-size:12px">${o.lines.map((l) => `${l.cases}× ${l.product_name.replace("Spiked ", "")}`).join(", ")}</td>
              <td class="right"><button class="btn btn--ghost btn--sm" onclick="event.stopPropagation();App.deleteOrder('${o.id}')">Delete</button></td>
            </tr>`).join("") || `<tr><td colspan="7" class="t-empty">No orders yet — add your first one.</td></tr>`}
          </tbody>
        </table></div>
      </div>`;
    $("#view").innerHTML = html;
    $$("[data-sort]").forEach((th) => th.onclick = () => {
      const k = th.dataset.sort;
      if (this.ordersSort.key === k) this.ordersSort.dir *= -1; else this.ordersSort = { key: k, dir: 1 };
      this.renderOrders();
    });
  },

  deleteOrder(id) {
    if (!confirm("Delete this order? This can't be undone.")) return;
    DB.remove("orders", id); this.toast("Order deleted"); this.renderOrders();
  },

  // Order add/edit modal with live line-item pricing
  orderModal(id) {
    const editing = id ? DB.priceOrder(DB.orders().find((o) => o.id === id)) : null;
    const stores = DB.stores().sort((a, b) => a.name.localeCompare(b.name));
    const products = DB.products();
    const state = { store_id: editing ? editing.store_id : (stores[0] && stores[0].id), date: editing ? editing.date : new Date().toISOString().slice(0, 10),
      items: editing ? editing.items.map((i) => ({ ...i })) : [{ product_id: products[0].id, cases: 1 }] };

    const body = () => {
      const store = DB.store(state.store_id);
      const st = store ? store.state : "—";
      let total = 0;
      const rows = state.items.map((it, idx) => {
        const { price, resolved } = DB.casePrice(st, it.product_id);
        const lt = price * (it.cases || 0); total += lt;
        return `<div class="lineitem">
          <select data-li-prod="${idx}">${products.map((p) => `<option value="${p.id}" ${p.id === it.product_id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
          <input type="number" min="0" step="1" value="${it.cases}" data-li-cases="${idx}">
          <span class="li-total">${resolved === "missing" ? '<span class="chip chip--sm" style="background:#ffe0e0">no price</span>' : fmtMoney2(lt)}</span>
          <button class="li-del" data-li-del="${idx}" ${state.items.length === 1 ? "disabled" : ""}>✕</button>
        </div>`;
      }).join("");
      return `
        <div class="field--row">
          <div class="field"><label>Account</label>
            <select id="o-store">${stores.map((s) => `<option value="${s.id}" ${s.id === state.store_id ? "selected" : ""}>${esc(s.name)} — ${s.state}</option>`).join("")}</select>
          </div>
          <div class="field"><label>Order date</label><input type="date" id="o-date" value="${state.date}"></div>
        </div>
        <div class="field">
          <label>Line items <span class="muted" style="font-weight:normal">· priced at <strong>${st}</strong> rates</span></label>
          <div class="li-head"><span>Product</span><span>Cases</span><span style="text-align:right">Line total</span><span></span></div>
          <div class="lineitems">${rows}</div>
          <button class="btn btn--ghost btn--sm" id="o-additem" style="margin-top:10px">＋ Add line</button>
        </div>
        <div style="text-align:right;font-family:var(--font-ui);font-size:20px;margin-top:8px">Order total: <strong>${fmtMoney2(total)}</strong></div>`;
    };

    const rebind = () => {
      $("#o-store").onchange = (e) => { state.store_id = e.target.value; refresh(); };
      $("#o-date").onchange = (e) => { state.date = e.target.value; };
      $("#o-additem").onclick = () => { state.items.push({ product_id: products[0].id, cases: 1 }); refresh(); };
      $$("[data-li-prod]").forEach((el) => el.onchange = (e) => { state.items[+el.dataset.liProd].product_id = e.target.value; refresh(); });
      $$("[data-li-cases]").forEach((el) => el.onchange = el.oninput = (e) => { state.items[+el.dataset.liCases].cases = +e.target.value; refresh(); });
      $$("[data-li-del]").forEach((el) => el.onclick = () => { state.items.splice(+el.dataset.liDel, 1); refresh(); });
    };
    const refresh = () => { $("#modal-body").innerHTML = body(); rebind(); };

    this.modal({
      title: editing ? "Edit order" : "New order",
      bodyHTML: body(),
      onOpen: rebind,
      saveLabel: editing ? "Save changes" : "Add order",
      onSave: () => {
        const store = DB.store(state.store_id);
        const payload = { store_id: state.store_id, distributor_id: store ? store.distributor_id : null, date: state.date, items: state.items.filter((i) => i.cases > 0) };
        if (!payload.items.length) { this.toast("Add at least one line with cases > 0", "err"); return false; }
        if (editing) { DB.update("orders", id, payload); this.toast("Order updated"); }
        else { payload.export_state = {}; payload.created_at = state.date; DB.insert("orders", payload); this.toast("Order added"); }
        this.renderOrders(); return true;
      },
    });
  },

  /* ---------------- QUICK SALE (new store + first order in one shot) ---------------- */
  distributorForState(state) {
    const d = DB.distributors().find((x) => x.state === state);
    return d ? d.id : "";
  },
  quickSaleModal() {
    const products = DB.products();
    const stores = DB.stores().sort((a, b) => a.name.localeCompare(b.name));
    const dists = DB.distributors();
    const types = ["Retail", "Bar/Restaurant", "Venue", "Grocery", "Liquor Store", "Other"];
    // mode: 'new' (create store) or 'existing' (reorder against a known store)
    let mode = stores.length ? "new" : "new";
    let items = [{ product_id: products[0].id, cases: 1 }];

    const currentState = () => {
      if (mode === "existing") { const s = DB.store($("#qs-store") ? $("#qs-store").value : null); return s ? s.state : "—"; }
      return $("#qs-state") ? $("#qs-state").value : "CT";
    };

    const linesHTML = () => {
      const st = currentState();
      return items.map((it, idx) => {
        const { price, resolved } = DB.casePrice(st, it.product_id);
        const lt = price * (it.cases || 0);
        return `<div class="lineitem">
          <select data-qsli-prod="${idx}">${products.map((p) => `<option value="${p.id}" ${p.id === it.product_id ? "selected" : ""}>${esc(p.name.replace("Spiked ", ""))}</option>`).join("")}</select>
          <input type="number" min="0" step="1" inputmode="numeric" value="${it.cases}" data-qsli-cases="${idx}">
          <span class="li-total" data-qsli-total="${idx}">${resolved === "missing" ? '<span class="chip chip--sm" style="background:#ffe0e0">set price</span>' : fmtMoney2(lt)}</span>
          <button class="li-del" data-qsli-del="${idx}" ${items.length === 1 ? "disabled" : ""}>✕</button>
        </div>`;
      }).join("");
    };

    const accountSection = () => {
      if (mode === "existing") {
        return `<div class="field"><label>Store</label>
          <select id="qs-store">${stores.map((s) => `<option value="${s.id}">${esc(s.name)} — ${s.state}</option>`).join("")}</select>
          <div class="hint">Priced automatically from this store's state.</div></div>`;
      }
      return `
        <div class="field"><label>Store name *</label><input id="qs-name" placeholder="e.g. Seaside Market & Wine" autocomplete="off"></div>
        <div class="field--row">
          <div class="field"><label>City</label><input id="qs-city" placeholder="Bridgeport"></div>
          <div class="field"><label>State *</label><select id="qs-state">${US_STATES.map((s) => `<option ${s === "CT" ? "selected" : ""}>${s}</option>`).join("")}</select></div>
        </div>
        <div class="field--row">
          <div class="field"><label>Type</label><select id="qs-type">${types.map((t) => `<option>${t}</option>`).join("")}</select></div>
          <div class="field"><label>Distributor</label><select id="qs-dist"><option value="">— none —</option>${dists.map((d) => `<option value="${d.id}">${esc(d.name)} (${d.state})</option>`).join("")}</select></div>
        </div>
        <details class="qs-more"><summary style="cursor:pointer;font-family:var(--font-ui);font-size:13px;color:var(--muted);margin-bottom:10px">＋ Contact details (optional)</summary>
          <div class="field--row">
            <div class="field"><label>Contact name</label><input id="qs-contact"></div>
            <div class="field"><label>Phone</label><input id="qs-phone" inputmode="tel"></div>
          </div>
        </details>`;
    };

    const body = () => `
      <div class="pill-filter" style="margin-bottom:16px">
        <button type="button" class="${mode === "new" ? "active" : ""}" data-qs-mode="new">🆕 New store</button>
        <button type="button" class="${mode === "existing" ? "active" : ""} ${stores.length ? "" : "hidden"}" data-qs-mode="existing">🔁 Existing store</button>
      </div>
      <div id="qs-account">${accountSection()}</div>
      <div class="section-title" style="margin-top:18px">The order</div>
      <div class="field" style="max-width:220px"><label>Order date</label><input type="date" id="qs-date" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div class="field">
        <label>Products <span class="muted" style="font-weight:normal">· priced at <strong id="qs-rate">${currentState()}</strong> rates</span></label>
        <div class="li-head"><span>Product</span><span>Cases</span><span style="text-align:right">Total</span><span></span></div>
        <div class="lineitems" id="qs-lines">${linesHTML()}</div>
        <button type="button" class="btn btn--ghost btn--sm" id="qs-addline" style="margin-top:10px">＋ Add product</button>
      </div>
      <div style="text-align:right;font-family:var(--font-ui);font-size:22px;margin:10px 0 4px">Order total: <strong id="qs-total">${fmtMoney2(0)}</strong></div>
      <div class="field" style="margin-top:14px">
        <label>Add a note <span class="muted" style="font-weight:normal">· optional, timestamped to this account</span></label>
        <textarea id="qs-note" placeholder="How'd the visit go? e.g. &quot;Owner loved the Tropical Punch — start with a small order, wants to reorder if it moves.&quot;"></textarea>
      </div>`;

    const recalc = () => {
      const st = currentState();
      const rate = $("#qs-rate"); if (rate) rate.textContent = st;
      let total = 0;
      $$("[data-qsli-cases]").forEach((el) => {
        const idx = +el.dataset.qsliCases;
        const prodSel = $(`[data-qsli-prod="${idx}"]`);
        const pid = prodSel ? prodSel.value : items[idx].product_id;
        const cases = +el.value || 0;
        items[idx] = { product_id: pid, cases };
        const { price, resolved } = DB.casePrice(st, pid);
        const lt = price * cases; total += lt;
        const tspan = $(`[data-qsli-total="${idx}"]`);
        if (tspan) tspan.innerHTML = resolved === "missing" ? '<span class="chip chip--sm" style="background:#ffe0e0">set price</span>' : fmtMoney2(lt);
      });
      const tot = $("#qs-total"); if (tot) tot.textContent = fmtMoney2(total);
    };
    const renderLines = () => { $("#qs-lines").innerHTML = linesHTML(); bindLines(); recalc(); };
    const bindLines = () => {
      $$("[data-qsli-prod]").forEach((el) => el.onchange = () => { items[+el.dataset.qsliProd].product_id = el.value; recalc(); });
      $$("[data-qsli-cases]").forEach((el) => el.oninput = () => recalc());
      $$("[data-qsli-del]").forEach((el) => el.onclick = () => { items.splice(+el.dataset.qsliDel, 1); renderLines(); });
    };
    const bindAccount = () => {
      if (mode === "new") {
        const stSel = $("#qs-state");
        if (stSel) stSel.onchange = () => { const d = this.distributorForState(stSel.value); const dd = $("#qs-dist"); if (dd && d) dd.value = d; recalc(); };
      } else {
        const stoSel = $("#qs-store"); if (stoSel) stoSel.onchange = () => recalc();
      }
    };
    const bindAll = () => {
      $$("[data-qs-mode]").forEach((b) => b.onclick = () => {
        mode = b.dataset.qsMode;
        $("#qs-account").innerHTML = accountSection();
        $$("[data-qs-mode]").forEach((x) => x.classList.toggle("active", x.dataset.qsMode === mode));
        bindAccount(); renderLines();
        if (mode === "new") { const n = $("#qs-name"); if (n) n.focus(); }
      });
      $("#qs-addline").onclick = () => { items.push({ product_id: products[0].id, cases: 1 }); renderLines(); };
      bindAccount(); bindLines(); recalc();
      const n = $("#qs-name"); if (n) n.focus();
    };

    const doSave = () => {
      let store_id, storeState, distributor_id;
      if (mode === "new") {
        const name = $("#qs-name").value.trim();
        if (!name) { this.toast("Store name is required", "err"); $("#qs-name").focus(); return null; }
        storeState = $("#qs-state").value;
        distributor_id = $("#qs-dist").value || null;
        const newStore = DB.insert("stores", {
          name, city: $("#qs-city").value.trim(), state: storeState,
          type: $("#qs-type").value, status: "active", distributor_id,
          contact_name: ($("#qs-contact") || {}).value ? $("#qs-contact").value.trim() : "",
          phone: ($("#qs-phone") || {}).value ? $("#qs-phone").value.trim() : "",
          created_at: new Date().toISOString().slice(0, 10),
        });
        store_id = newStore.id;
      } else {
        store_id = $("#qs-store").value;
        const s = DB.store(store_id); storeState = s.state; distributor_id = s.distributor_id;
      }
      recalc();
      const cleanItems = items.filter((i) => i.cases > 0);
      if (!cleanItems.length) { this.toast("Add at least one product with cases", "err"); return null; }
      const order = DB.insert("orders", { store_id, distributor_id, date: $("#qs-date").value, items: cleanItems, export_state: {}, created_at: $("#qs-date").value });
      // log the note (if any) to the account's timestamped activity log
      const noteEl = $("#qs-note");
      if (noteEl && noteEl.value.trim()) DB.addNote(store_id, noteEl.value.trim());
      const priced = DB.priceOrder(order);
      return { store_id, total: priced.total, isNew: mode === "new" };
    };

    this.modal({
      title: "New sale",
      bodyHTML: body(),
      onOpen: bindAll,
      saveLabel: "✓ Save sale",
      onSave: () => {
        const res = doSave();
        if (!res) return false;
        this.toast(`Sale logged · ${fmtMoney2(res.total)}${res.isNew ? " · new store added" : ""}`);
        if (["dashboard", "orders", "accounts", "distributors"].includes(this.view)) this.go(this.view);
        return true;
      },
      extraFoot: `<button class="btn btn--coral btn--sm" style="margin-right:auto" id="qs-save-another">Save &amp; add another</button>`,
    });
    // wire the "save & add another" button (keeps you in the flow for a multi-store day)
    const sa = $("#qs-save-another");
    if (sa) sa.onclick = () => {
      const res = doSave();
      if (!res) return;
      this.toast(`Saved · ${fmtMoney2(res.total)} · next one →`);
      this.closeModal();
      this.quickSaleModal();
    };
  },

  /* ---------------- ACCOUNTS ---------------- */
  acctFilter: "all",
  renderAccounts() {
    const filters = [["all", "All"], ["active", "Active"], ["prospect", "Prospects"], ["lead", "Leads"], ["inactive", "Inactive"]];
    let stores = DB.stores();
    const q = this.search.toLowerCase();
    if (this.acctFilter !== "all") stores = stores.filter((s) => s.status === this.acctFilter);
    if (q) stores = stores.filter((s) => s.name.toLowerCase().includes(q) || (s.city || "").toLowerCase().includes(q) || s.state.toLowerCase().includes(q));
    stores = stores.map((s) => ({ ...s, _stats: DB.storeStats(s.id) })).sort((a, b) => b._stats.revenue - a._stats.revenue);

    const geo = DB.geography();
    const html = `
      <div class="btn-row" style="margin-bottom:16px">
        <button class="btn btn--primary" onclick="App.accountModal()">＋ New account</button>
        <span class="spacer" style="flex:1"></span>
        <button class="btn btn--ghost" onclick="App.exportStoresModal()">⬇ Export stores (CSV)</button>
        <button class="btn btn--coral" onclick="App.locatorExportModal()">🗺️ For website locator</button>
      </div>

      <div class="kpi-grid">
        <div class="kpi kpi--accent"><div class="kpi__label">Total Accounts</div><div class="kpi__value">${geo.total}</div><div class="kpi__sub">${geo.byStatus.active || 0} active · ${geo.leads} in pipeline</div></div>
        <div class="kpi kpi--teal"><div class="kpi__label">States</div><div class="kpi__value">${geo.stateCount}</div><div class="kpi__sub">${geo.byState.slice(0, 4).map((s) => s.label).join(" · ")}</div></div>
        <div class="kpi kpi--coral"><div class="kpi__label">Cities / Towns</div><div class="kpi__value">${geo.byCity.length}</div><div class="kpi__sub">${geo.byCity.slice(0, 2).map((c) => c.label).join(" · ")}</div></div>
      </div>

      <div class="grid-2">
        <div class="panel">
          <div class="panel__head"><h3>Accounts by state</h3></div>
          ${Charts.bars(geo.byState, { money: false, height: 200 })}
        </div>
        <div class="panel">
          <div class="panel__head"><h3>By city / town</h3></div>
          <div class="table-wrap"><table class="data" style="min-width:auto">
            <thead><tr><th class="no-sort">City</th><th class="no-sort num">Accounts</th></tr></thead>
            <tbody>${geo.byCity.map((c) => `<tr><td>${esc(c.label)}</td><td class="num mono">${c.value}</td></tr>`).join("") || `<tr><td colspan="2" class="t-empty">No accounts yet</td></tr>`}</tbody>
          </table></div>
        </div>
      </div>

      <div class="pill-filter">
        ${filters.map(([k, l]) => `<button class="${this.acctFilter === k ? "active" : ""}" onclick="App.acctFilter='${k}';App.renderAccounts()">${l}</button>`).join("")}
      </div>
      <div class="panel">
        <div class="panel__head"><h3>${stores.length} account${stores.length === 1 ? "" : "s"}</h3></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th class="no-sort">Account</th><th class="no-sort">Location</th><th class="no-sort">Distributor</th><th class="no-sort">Status</th><th class="no-sort num">Cases</th><th class="no-sort num">Orders</th><th class="no-sort num">Revenue</th><th class="no-sort"></th></tr></thead>
          <tbody>
          ${stores.map((s) => {
            const d = DB.distributor(s.distributor_id);
            return `<tr class="clickable" onclick="App.accountDetail('${s.id}')">
              <td><strong>${esc(s.name)}</strong>${(s.notes_log || []).length ? ` <span class="chip chip--sm" title="${(s.notes_log || []).length} note(s)">📝 ${(s.notes_log || []).length}</span>` : ""}<div class="muted" style="font-size:12px">${esc(s.type || "")}</div></td>
              <td>${esc(s.city || "")}, ${s.state}</td>
              <td>${d ? esc(d.name) : '<span class="muted">— none —</span>'}</td>
              <td><span class="chip chip--${s.status}">${s.status}</span></td>
              <td class="num mono">${s._stats.cases}</td>
              <td class="num mono">${s._stats.count}</td>
              <td class="num mono muted">${fmtMoney(s._stats.revenue)}</td>
              <td class="right"><button class="btn btn--ghost btn--sm" onclick="event.stopPropagation();App.accountModal('${s.id}')">Edit</button></td>
            </tr>`;
          }).join("") || `<tr><td colspan="8" class="t-empty">No accounts match.</td></tr>`}
          </tbody>
        </table></div>
      </div>`;
    $("#view").innerHTML = html;
  },

  // Confirm + explain the website-locator export before downloading.
  locatorExportModal() {
    const geo = DB.geography();
    const active = DB.stores().filter((s) => s.status === "active");
    this.modal({
      title: "Export for website store locator",
      bodyHTML: `
        <p style="margin-top:0">This creates a <code>stores.json</code> file in the exact format your website's store locator reads — name, full address, hours, phone.</p>
        <p>By default it includes only your <strong>${active.length} active</strong> account${active.length === 1 ? "" : "s"} (the ones customers can actually buy from). Leads and prospects are left off the public map.</p>
        <div class="field" style="margin-top:16px"><label><input type="checkbox" id="loc-all" style="width:auto;margin-right:8px">Include every account (all ${geo.total}), not just active</label></div>
        <p class="muted" style="font-size:13px">Next step: drop the downloaded <code>stores.json</code> into <code>store-locator/</code> on the website and redeploy. The map geocodes each address automatically — no coordinates needed.</p>`,
      saveLabel: "⬇ Download stores.json",
      onSave: () => { this.exportLocatorJSON($("#loc-all") && $("#loc-all").checked); return true; },
    });
  },

  accountDetail(id) {
    const s = DB.store(id); if (!s) return;
    const d = DB.distributor(s.distributor_id);
    const st = DB.storeStats(id);
    this.modal({
      title: s.name, wide: true,
      bodyHTML: `
        <div class="kpi-grid" style="margin-bottom:18px">
          <div class="kpi"><div class="kpi__label">Revenue</div><div class="kpi__value">${fmtMoney(st.revenue)}</div></div>
          <div class="kpi"><div class="kpi__label">Cases</div><div class="kpi__value">${st.cases}</div></div>
          <div class="kpi"><div class="kpi__label">Orders</div><div class="kpi__value">${st.count}</div></div>
        </div>
        <p style="margin:0 0 6px"><span class="chip chip--${s.status}">${s.status}</span> &nbsp;<span class="muted">${esc(s.type || "")}</span></p>
        <p style="margin:4px 0"><strong>Location:</strong> ${esc(s.address ? s.address + ", " : "")}${esc(s.city || "")}, ${s.state}</p>
        <p style="margin:4px 0"><strong>Distributor:</strong> ${d ? esc(d.name) : "— none assigned —"}</p>
        ${s.contact_name || s.email || s.phone ? `<p style="margin:4px 0"><strong>Contact:</strong> ${esc(s.contact_name || "")} ${s.email ? "· " + esc(s.email) : ""} ${s.phone ? "· " + esc(s.phone) : ""}</p>` : ""}
        ${s.notes ? `<p style="margin:8px 0" class="muted">📝 ${esc(s.notes)}</p>` : ""}

        <div class="section-title">Notes &amp; activity</div>
        <div class="note-add">
          <textarea id="note-input" placeholder="Log a visit, call, or follow-up… (e.g. &quot;Stopped by 8/13 — buyer wants 5 more cases next week&quot;)"></textarea>
          <button class="btn btn--primary btn--sm" onclick="App.addAccountNote('${id}')">＋ Add note</button>
        </div>
        <div class="note-log">
          ${(s.notes_log || []).map((n) => `
            <div class="note-item">
              <div class="note-item__meta">${new Date(n.at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                <button class="note-del" title="Delete note" onclick="App.deleteAccountNote('${id}','${n.id}')">✕</button>
              </div>
              <div class="note-item__text">${esc(n.text)}</div>
            </div>`).join("") || `<p class="muted" style="font-size:13px;margin:4px 0">No notes yet — add your first above.</p>`}
        </div>

        <div class="section-title">Order history</div>
        <div class="table-wrap"><table class="data" style="min-width:auto">
          <thead><tr><th class="no-sort">Date</th><th class="no-sort">Products</th><th class="no-sort num">Cases</th><th class="no-sort num">Total</th></tr></thead>
          <tbody>${st.orders.slice().reverse().map((o) => `<tr><td>${fmtDate(o.date)}</td><td class="muted" style="font-size:12px">${o.lines.map((l) => `${l.cases}× ${l.product_name.replace("Spiked ", "")}`).join(", ")}</td><td class="num mono">${o.cases}</td><td class="num mono">${fmtMoney2(o.total)}</td></tr>`).join("") || `<tr><td colspan="4" class="t-empty">No orders yet</td></tr>`}</tbody>
        </table></div>`,
      saveLabel: "Edit account",
      onSave: () => { this.closeModal(); this.accountModal(id); return true; },
      cancelLabel: "Close",
    });
  },
  addAccountNote(id) {
    const el = $("#note-input"); if (!el) return;
    const text = el.value.trim();
    if (!text) { this.toast("Type a note first", "err"); el.focus(); return; }
    DB.addNote(id, text);
    this.toast("Note added");
    this.accountDetail(id); // re-render with the new note
    if (this.view === "accounts") this.renderAccounts();
  },
  deleteAccountNote(id, noteId) {
    DB.deleteNote(id, noteId);
    this.accountDetail(id);
    if (this.view === "accounts") this.renderAccounts();
  },

  accountModal(id) {
    const s = id ? DB.store(id) : null;
    const dists = DB.distributors();
    const statuses = ["lead", "prospect", "active", "inactive"];
    const types = ["Retail", "Bar/Restaurant", "Venue", "Grocery", "Liquor Store", "Other"];
    const v = (k, d = "") => s ? (s[k] != null ? s[k] : d) : d;
    this.modal({
      title: s ? "Edit account" : "New account",
      bodyHTML: `
        <div class="field"><label>Business name *</label><input id="a-name" value="${esc(v("name"))}" placeholder="Seaside Market & Wine"></div>
        <div class="field--row">
          <div class="field"><label>City</label><input id="a-city" value="${esc(v("city"))}"></div>
          <div class="field"><label>State *</label><select id="a-state">${US_STATES.map((st) => `<option ${v("state", "CT") === st ? "selected" : ""}>${st}</option>`).join("")}</select></div>
        </div>
        <div class="field"><label>Street address</label><input id="a-address" value="${esc(v("address"))}"></div>
        <div class="field--row">
          <div class="field"><label>Status</label><select id="a-status">${statuses.map((st) => `<option ${v("status", "lead") === st ? "selected" : ""}>${st}</option>`).join("")}</select></div>
          <div class="field"><label>Type</label><select id="a-type">${types.map((t) => `<option ${v("type", "Retail") === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        </div>
        <div class="field"><label>Distributor</label><select id="a-dist"><option value="">— none —</option>${dists.map((d) => `<option value="${d.id}" ${v("distributor_id") === d.id ? "selected" : ""}>${esc(d.name)} (${d.state})</option>`).join("")}</select></div>
        <div class="field--row">
          <div class="field"><label>Contact name</label><input id="a-contact" value="${esc(v("contact_name"))}"></div>
          <div class="field"><label>Phone</label><input id="a-phone" value="${esc(v("phone"))}"></div>
        </div>
        <div class="field"><label>Email</label><input id="a-email" value="${esc(v("email"))}"></div>
        <div class="field"><label>Notes</label><textarea id="a-notes" placeholder="Buyer prefers Tuesday deliveries…">${esc(v("notes"))}</textarea></div>
        <div class="field"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="a-onmap" style="width:auto" ${v("show_on_map", true) === false ? "" : "checked"}> Show on the public "Find Whatcha" map <span class="muted" style="font-weight:normal">(active accounts only)</span></label><div class="hint">Only the store name + address are ever shown publicly.</div></div>`,
      saveLabel: s ? "Save changes" : "Add account",
      onSave: () => {
        const name = $("#a-name").value.trim();
        if (!name) { this.toast("Name is required", "err"); return false; }
        const payload = {
          name, city: $("#a-city").value.trim(), state: $("#a-state").value, address: $("#a-address").value.trim(),
          status: $("#a-status").value, type: $("#a-type").value, distributor_id: $("#a-dist").value || null,
          contact_name: $("#a-contact").value.trim(), phone: $("#a-phone").value.trim(), email: $("#a-email").value.trim(), notes: $("#a-notes").value.trim(),
          show_on_map: $("#a-onmap").checked,
        };
        if (s) { DB.update("stores", id, payload); this.toast("Account updated"); }
        else { payload.created_at = new Date().toISOString().slice(0, 10); DB.insert("stores", payload); this.toast("Account added"); }
        this.renderAccounts(); return true;
      },
      extraFoot: s ? `<button class="btn btn--ghost btn--sm" style="margin-right:auto" onclick="App.deleteAccount('${id}')">Delete</button>` : "",
    });
  },
  deleteAccount(id) {
    const st = DB.storeStats(id);
    if (st.count > 0) { this.toast("Can't delete — account has orders. Set to Inactive instead.", "err"); return; }
    if (!confirm("Delete this account?")) return;
    DB.remove("stores", id); this.closeModal(); this.toast("Account deleted"); this.renderAccounts();
  },

  /* ---------------- LEADS & RECOMMENDATIONS ---------------- */
  POI_ICON: { university: "🎓", arena: "🏟️", venue: "🎪", casino: "🎰", nightlife: "🍸", tourist: "🏖️", city: "🏙️" },
  LEAD_STATUS: { to_visit: "To visit", contacted: "Contacted", won: "Won", passed: "Passed" },

  renderLeads() {
    this._topPoi = null; // panel reloads for the top/filtered zone after render
    const recs = DB.recommendations();
    const leads = DB.leads();
    const openLeads = leads.filter((l) => l.status === "to_visit" || l.status === "contacted");
    const closedLeads = leads.filter((l) => l.status === "won" || l.status === "passed");

    const recCard = (r) => {
      const p = r.poi;
      return `<div class="rec-card" data-poi="${p.id}" data-loc="${esc((p.city + " " + p.state + " " + (r.county || "") + " " + p.name).toLowerCase())}">
        <div class="rec-card__score rec-${r.tier}">
          <div class="rec-card__num">${r.score}</div>
          <div class="rec-card__tier">${r.tier === "high" ? "HIGH" : r.tier === "medium" ? "MED" : "WATCH"}</div>
        </div>
        <div class="rec-card__body">
          <div class="rec-card__head">
            <h3>${this.POI_ICON[p.type] || "📍"} ${esc(p.name)}</h3>
            <span class="chip chip--sm">${esc(p.city)}, ${p.state}</span>
            ${r.covering ? `<span class="chip chip--sm chip--exported" title="${esc(this.coverageLabelSafe(r))}">🚚 ${esc(r.covering.name)}</span>` : ""}
          </div>
          <ul class="rec-reasons">${r.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
          <div class="rec-factors">${r.factors.map((f) => `<span class="rec-factor ${f.value < 0 ? "neg" : ""}">${esc(f.label)} ${f.value >= 0 ? "+" : ""}${f.value}</span>`).join("")}</div>
          <div class="btn-row" style="margin-top:12px">
            <button class="btn btn--coral btn--sm" onclick="App.showZoneStores('${p.id}')">🔍 Show stores here</button>
            ${r.saved ? `<span class="chip chip--active">✓ zone in leads</span>` : `<button class="btn btn--ghost btn--sm" onclick="App.addLeadFromRec('${p.id}')">Save zone</button>`}
            <button class="btn btn--ghost btn--sm" onclick="App.dismissRec('${p.id}')">Dismiss</button>
          </div>
        </div>
      </div>`;
    };

    const leadRow = (l) => {
      const cov = l.state ? DB.coverageForCounty(l.state, DB.countyForCity(l.city, l.state)) : null;
      const outside = l.city && l.state && !cov;
      return `<tr data-loc="${esc(((l.city || "") + " " + (l.state || "") + " " + l.name).toLowerCase())}">
        <td><strong>${esc(l.name)}</strong>${l.source === "engine" ? ' <span class="chip chip--sm chip--exported">rec</span>' : ""}<div class="muted" style="font-size:12px">${esc(l.type || "")}</div></td>
        <td>${esc(l.city || "")}${l.city ? ", " : ""}${l.state || ""}${outside ? ' <span class="chip chip--sm" style="background:#ffe0e0" title="No distributor covers this area">no dist.</span>' : ""}</td>
        <td><span class="chip chip--sm chip--${l.priority}">${l.priority || "—"}</span></td>
        <td>
          <select class="lead-status" onchange="App.setLeadStatus('${l.id}', this.value)">
            ${Object.entries(this.LEAD_STATUS).map(([k, v]) => `<option value="${k}" ${l.status === k ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </td>
        <td class="muted" style="font-size:12px;max-width:220px">${esc(l.note || "")}</td>
        <td class="right" style="white-space:nowrap"><a class="btn btn--ghost btn--sm" href="${this.leadMapsUrl(l)}" target="_blank" rel="noopener" title="Navigate in Apple Maps">🧭</a> <button class="btn btn--ghost btn--sm" onclick="App.leadModal('${l.id}')">Edit</button></td>
      </tr>`;
    };

    const html = `
      <p class="muted" style="margin-top:0;max-width:760px">Real <strong>stores to walk into</strong> — liquor stores, bottle shops, bars & markets — pulled live from OpenStreetMap and ranked for you, <strong>inside your distributors' coverage only</strong>. Scores use crowd-sourced signals that track the young-adult crowd (cocktail bars, breweries, nightclubs, late-night hours) plus proximity to campuses, arenas & nightlife districts, your whitespace, and nearby momentum. Filter by city/state below; everything re-ranks as you add accounts.</p>

      <div class="btn-row" style="margin-bottom:14px">
        <button class="btn btn--primary" onclick="App.scoutAddressModal()">🔍 Scout stores near an address</button>
        <button class="btn btn--coral" onclick="App.leadModal()">＋ Add my own lead</button>
        ${DB.dismissedRecs().length ? `<button class="btn btn--ghost btn--sm" onclick="App.restoreRecs()">Restore ${DB.dismissedRecs().length} dismissed</button>` : ""}
      </div>

      <div class="lead-filter-bar">
        <span aria-hidden="true">🔎</span>
        <input id="lead-filter" type="search" placeholder="Filter areas by city or state… (e.g. New Haven, Boston, or NY)" value="${esc(this.leadFilter || "")}">
        <button class="lead-filter-clear ${this.leadFilter ? "" : "hidden"}" id="lead-filter-clear" title="Clear">✕</button>
        <span id="lead-filter-count" class="muted"></span>
      </div>

      <div class="panel top-stores" id="top-stores-panel">
        <div class="panel__head"><h3 id="top-stores-title">🔥 Stores to hit</h3><span class="spacer"></span><span class="muted" id="top-stores-sub" style="font-size:12px"></span></div>
        <div id="top-stores"><div class="empty-state" style="padding:24px"><div class="big">🛰️</div>Loading real stores…</div></div>
      </div>

      <div class="section-title">🎯 Opportunity zones ${recs.eligible.length ? `<span class="muted">· ${recs.eligible.length} in your footprint · pick one to see its stores</span>` : ""}</div>
      <div class="rec-grid">
        ${recs.eligible.map(recCard).join("") || `<div class="empty-state"><div class="big">🎯</div>No recommendations in your current coverage. Add a distributor or expand coverage to unlock more.</div>`}
      </div>
      <div id="rec-empty" class="empty-state hidden"><div class="big">🔎</div>No opportunity zones match that location. Try a different city or state — or Scout an address above.</div>

      ${recs.outside.length ? `
      <details class="outside-foot">
        <summary>🚫 ${recs.outside.length} strong anchors <em>outside</em> your distribution — you'd need coverage first</summary>
        <div class="table-wrap" style="margin-top:12px"><table class="data" style="min-width:auto">
          <thead><tr><th class="no-sort">Anchor</th><th class="no-sort">Location</th><th class="no-sort">Why it's blocked</th></tr></thead>
          <tbody>${recs.outside.map((r) => `<tr data-loc="${esc((r.poi.city + " " + r.poi.state + " " + r.poi.name).toLowerCase())}"><td>${this.POI_ICON[r.poi.type] || "📍"} ${esc(r.poi.name)}</td><td>${esc(r.poi.city)}, ${r.poi.state}</td><td class="muted" style="font-size:12px">${esc(r.blockedReason)}</td></tr>`).join("")}</tbody>
        </table></div>
      </details>` : ""}

      <div class="section-title" style="margin-top:28px">📋 My leads ${openLeads.length ? `<span class="muted">· ${openLeads.length} open</span>` : ""}</div>
      <div class="panel">
        <div class="table-wrap"><table class="data">
          <thead><tr><th class="no-sort">Lead</th><th class="no-sort">Location</th><th class="no-sort">Priority</th><th class="no-sort">Status</th><th class="no-sort">Note</th><th class="no-sort"></th></tr></thead>
          <tbody>${(openLeads.length ? openLeads : []).map(leadRow).join("") || `<tr><td colspan="6" class="t-empty">No open leads. Add one, or promote a recommendation above.</td></tr>`}</tbody>
        </table></div>
      </div>

      ${closedLeads.length ? `
      <details>
        <summary style="cursor:pointer;font-family:var(--font-ui);color:var(--muted);margin-bottom:10px">Closed leads (${closedLeads.length}) — won & passed</summary>
        <div class="panel"><div class="table-wrap"><table class="data">
          <thead><tr><th class="no-sort">Lead</th><th class="no-sort">Location</th><th class="no-sort">Priority</th><th class="no-sort">Status</th><th class="no-sort">Note</th><th class="no-sort"></th></tr></thead>
          <tbody>${closedLeads.map(leadRow).join("")}</tbody>
        </table></div></div>
      </details>` : ""}`;
    $("#view").innerHTML = html;
    const lf = $("#lead-filter");
    if (lf) {
      lf.oninput = () => { this.leadFilter = lf.value; this.applyLeadFilter(); };
      $("#lead-filter-clear").onclick = () => { this.leadFilter = ""; lf.value = ""; lf.focus(); this.applyLeadFilter(); };
      this.applyLeadFilter();
    }
  },
  applyLeadFilter() {
    const q = (this.leadFilter || "").trim().toLowerCase();
    let recShown = 0, firstVisiblePoi = null;
    $$("[data-loc]").forEach((el) => {
      const match = !q || el.dataset.loc.includes(q);
      el.classList.toggle("hidden", !match);
      if (match && el.classList.contains("rec-card")) { recShown++; if (!firstVisiblePoi) firstVisiblePoi = el.dataset.poi; }
    });
    const empty = $("#rec-empty");
    const anyRec = $(".rec-grid .rec-card");
    if (empty) empty.classList.toggle("hidden", !(q && anyRec && recShown === 0));
    const clr = $("#lead-filter-clear"); if (clr) clr.classList.toggle("hidden", !q);
    const cnt = $("#lead-filter-count");
    if (cnt) cnt.textContent = q ? `${recShown} zone${recShown === 1 ? "" : "s"} match` : "";
    // Prominent stores panel follows the top visible zone.
    if (firstVisiblePoi && firstVisiblePoi !== this._topPoi) this.loadTopStores(firstVisiblePoi);
    else if (!firstVisiblePoi && $("#top-stores")) { this._topPoi = null; $("#top-stores").innerHTML = `<div class="empty-state" style="padding:24px">No zones match — try another city/state, or Scout an address.</div>`; }
  },
  coverageLabelSafe(r) { return r.covering ? DB.coverageLabel(r.covering, r.poi.state) : ""; },

  addLeadFromRec(poi_id) {
    const lead = DB.promoteRecToLead(poi_id);
    if (!lead) { this.toast("Already in your leads", "err"); return; }
    this.toast("Added to your leads");
    this.renderLeads();
  },
  dismissRec(poi_id) { DB.dismissRec(poi_id); this.toast("Dismissed"); this.renderLeads(); },
  restoreRecs() { DB.clearDismissed(); this.toast("Recommendations restored"); this.renderLeads(); },
  setLeadStatus(id, status) {
    DB.update("leads", id, { status });
    const lead = DB.lead(id);
    if (status === "won") this.toast(`Marked won — log the sale with ＋ New sale to add ${lead.city || "the store"} as an account`);
    else this.toast("Lead updated");
    this.renderLeads();
  },
  leadModal(id) {
    const l = id ? DB.lead(id) : null;
    const types = ["Retail", "Bar/Restaurant", "Venue", "Grocery", "Liquor Store", "Venue / Bar", "Retail / Bar", "Other"];
    const prios = ["high", "medium", "low"];
    const v = (k, d = "") => l ? (l[k] != null ? l[k] : d) : d;
    this.modal({
      title: l ? "Edit lead" : "New lead",
      bodyHTML: `
        <div class="field"><label>Lead name *</label><input id="l-name" value="${esc(v("name"))}" placeholder="e.g. Package store near the arena"></div>
        <div class="field--row">
          <div class="field"><label>City</label><input id="l-city" value="${esc(v("city"))}"></div>
          <div class="field"><label>State</label><select id="l-state">${US_STATES.map((s) => `<option ${v("state", "CT") === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
        </div>
        <div class="field--row">
          <div class="field"><label>Type</label><select id="l-type">${types.map((t) => `<option ${v("type", "Retail") === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
          <div class="field"><label>Priority</label><select id="l-prio">${prios.map((p) => `<option ${v("priority", "high") === p ? "selected" : ""}>${p}</option>`).join("")}</select></div>
        </div>
        <div class="field"><label>Status</label><select id="l-status">${Object.entries(this.LEAD_STATUS).map(([k, vv]) => `<option value="${k}" ${v("status", "to_visit") === k ? "selected" : ""}>${vv}</option>`).join("")}</select></div>
        <div class="field"><label>Note</label><textarea id="l-note" placeholder="Why this one, who to ask for, when to go…">${esc(v("note"))}</textarea></div>
        ${l ? "" : `<p class="hint" id="l-cov" style="margin-top:-4px"></p>`}`,
      onOpen: () => {
        const showCov = () => {
          const el = $("#l-cov"); if (!el) return;
          const city = $("#l-city").value, st = $("#l-state").value;
          const county = DB.countyForCity(city, st);
          const cov = county ? DB.coverageForCounty(st, county) : null;
          el.innerHTML = !city ? "" : cov ? `✓ In ${cov.name}'s territory (${esc(DB.coverageLabel(cov, st))}).` : `⚠️ No distributor covers ${county ? county + " County, " : ""}${st} yet.`;
          el.style.color = cov ? "var(--ok)" : "var(--warn)";
        };
        if ($("#l-city")) { $("#l-city").oninput = showCov; $("#l-state").onchange = showCov; showCov(); }
      },
      saveLabel: l ? "Save" : "Add lead",
      onSave: () => {
        const name = $("#l-name").value.trim();
        if (!name) { this.toast("Lead name is required", "err"); return false; }
        const payload = { name, city: $("#l-city").value.trim(), state: $("#l-state").value, type: $("#l-type").value, priority: $("#l-prio").value, status: $("#l-status").value, note: $("#l-note").value.trim() };
        if (l) { DB.update("leads", id, payload); this.toast("Lead updated"); }
        else { payload.source = "manual"; payload.created_at = new Date().toISOString().slice(0, 10); DB.insert("leads", payload); this.toast("Lead added"); }
        this.renderLeads(); return true;
      },
      extraFoot: l ? `<button class="btn btn--ghost btn--sm" style="margin-right:auto" onclick="App.deleteLead('${id}')">Delete</button>` : "",
    });
  },
  deleteLead(id) {
    if (!confirm("Delete this lead?")) return;
    DB.remove("leads", id); this.closeModal(); this.toast("Lead deleted"); this.renderLeads();
  },

  /* ---------------- STORE SCOUT (real nearby businesses via OpenStreetMap) ---------------- */
  _scoutCache: {},
  _scoutCtx: null,
  STATE_NAME: { Connecticut: "CT", "New York": "NY", Massachusetts: "MA", "Rhode Island": "RI", "New Jersey": "NJ", Pennsylvania: "PA", Vermont: "VT", "New Hampshire": "NH", Maine: "ME" },
  SCOUT_TYPE: {
    alcohol: { t: 5, label: "Liquor / package store", lead: "Liquor Store" },
    wine: { t: 5, label: "Wine shop", lead: "Liquor Store" },
    convenience: { t: 3, label: "Convenience / bodega", lead: "Grocery" },
    bar: { t: 4, label: "Bar", lead: "Bar/Restaurant" },
    pub: { t: 4, label: "Pub", lead: "Bar/Restaurant" },
    nightclub: { t: 4, label: "Nightclub", lead: "Bar/Restaurant" },
    restaurant: { t: 2, label: "Restaurant", lead: "Bar/Restaurant" },
  },
  // Apple Maps deep link — uses coordinates when we have them (always
  // reliable), otherwise a name+city+state search. Opens Apple Maps on
  // Ben's Mac/iPhone; tap "Directions" to navigate.
  appleMapsUrl(lat, lng, name) {
    if (lat != null && lng != null) return `https://maps.apple.com/?q=${encodeURIComponent(name || "Store")}&ll=${lat},${lng}`;
    return `https://maps.apple.com/?q=${encodeURIComponent(name || "")}`;
  },
  leadMapsUrl(l) {
    if (l.lat != null && l.lng != null) return this.appleMapsUrl(l.lat, l.lng, l.name);
    const q = [l.name, l.address, l.city, l.state].filter(Boolean).join(" ");
    return `https://maps.apple.com/?q=${encodeURIComponent(q)}`;
  },
  haversineMi(la1, lo1, la2, lo2) {
    const R = 3958.8, dLa = (la2 - la1) * Math.PI / 180, dLo = (lo2 - lo1) * Math.PI / 180;
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },
  OVERPASS_ENDPOINTS: ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"],
  // Iconic, verified college bars per university anchor. Used to guarantee
  // the key student spots appear even if the map query misses them — their
  // real coordinates are geocoded (never guessed), and chain/too-far matches
  // are rejected.
  KNOWN_COLLEGE_BARS: {
    poi_yale: ["Toad's Place", "Three Sheets"],
    poi_newhaven_night: ["Toad's Place", "Elm City Social", "Ordinary"],
    poi_shu: ["The Seagrape Cafe"],
    poi_fairfieldu: ["The Seagrape Cafe"],
    poi_bu: ["White Horse Tavern", "Cornwall's"],
    poi_northeastern: ["Punter's Pub"],
    poi_harvard_mit: ["Charlie's Kitchen", "Grendel's Den"],
    poi_fenway: ["Bleacher Bar", "Cask 'n Flagon"],
    poi_columbia: ["1020 Bar"],
  },
  async nominatimSearch(q) {
    try {
      const res = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=" + encodeURIComponent(q), { signal: AbortSignal.timeout(9000) });
      const g = await res.json();
      return g && g.length ? g[0] : null;
    } catch (e) { return null; }
  },
  // Ensure the key college bars are present + pinned to the top.
  async augmentKnownBars(poiId, stores, ll, ctx) {
    const known = this.KNOWN_COLLEGE_BARS[poiId] || [];
    if (!known.length) return stores;
    const out = stores.slice();
    const nk = (s) => this._normName(s);
    for (const bar of known) {
      const bn = nk(bar);
      const hit = out.find((s) => { const sn = nk(s.name); return sn.includes(bn) || bn.includes(sn); });
      if (hit) {
        hit.isKnownBar = true; hit.score += 60;
        hit.signals = hit.signals || [];
        if (!hit.signals.some((x) => x.includes("college"))) hit.signals.unshift("🎓 Key college bar");
        continue;
      }
      const core = bar.replace(/^the\s+/i, "").trim(); // "The Seagrape Cafe" -> "Seagrape Cafe"
      const coreToken = nk(core).split(" ").sort((a, b) => b.length - a.length)[0] || nk(core); // most distinctive word
      let g = await this.nominatimSearch(`${bar}, ${ctx.city} ${ctx.state}`);
      if (!g) g = await this.nominatimSearch(`${core}, ${ctx.city} ${ctx.state}`);
      if (!g) continue;
      const lat = +g.lat, lon = +g.lon, distMi = this.haversineMi(ll[0], ll[1], lat, lon);
      const nameOk = nk(g.display_name || "").includes(coreToken); // sanity check the match on the distinctive word
      if (distMi > 3 || !nameOk || this.isChain(bar, {})) continue;
      const fit = this.ANCHOR_FIT[ctx.anchorType];
      out.push({ name: bar, kind: "bar", typeLabel: "Bar", leadType: "Bar/Restaurant", lat, lon, distMi, addr: "", city: ctx.city || "", already: false, score: 900 - distMi, signals: ["🎓 Key college bar", fit && fit.tag].filter(Boolean), website: "", isKnownBar: true });
    }
    return out.sort((a, b) => (b.isKnownBar ? 1 : 0) - (a.isKnownBar ? 1 : 0) || b.score - a.score).slice(0, 30);
  },
  async overpassNearby(lat, lng, radius = 1600) {
    const kinds = [`nwr["shop"="alcohol"]`, `nwr["shop"="wine"]`, `nwr["shop"="convenience"]`, `nwr["amenity"="bar"]`, `nwr["amenity"="pub"]`, `nwr["amenity"="nightclub"]`, `nwr["amenity"="restaurant"]`];
    const q = `[out:json][timeout:25];(${kinds.map((k) => `${k}(around:${radius},${lat},${lng});`).join("")});out center 90;`;
    let lastErr;
    for (const url of this.OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(url, { method: "POST", body: q, signal: AbortSignal.timeout(12000) });
        if (!res.ok) { lastErr = new Error("overpass " + res.status); continue; }
        const data = await res.json();
        return data.elements || [];
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("overpass unavailable");
  },
  // Major chains to exclude — Ben sells to independents, not corporate accounts.
  // Multiword entries match anywhere in the name; single words match as a
  // whole word only (so "shell" won't knock out "Seashell Wines").
  // Distinctive chain names (generic gas/grocery brand words like "shell",
  // "giant" are intentionally omitted — OSM's brand tag catches those without
  // false-flagging a local "Shell Bar"). Stored pre-normalized (lowercase,
  // spaces, no punctuation).
  CHAINS: [
    // convenience
    "7 eleven", "seven eleven", "circle k", "cumberland farms", "wawa", "sheetz", "quickchek", "quick chek", "royal farms", "stewarts", "xtramart",
    // liquor / wine chains
    "total wine", "bevmo", "specs", "binnys", "abc fine wine", "abc liquors", "bottle king", "liquor barn", "total beverage", "wine chateau",
    // pharmacy
    "cvs", "walgreens", "rite aid", "duane reade",
    // grocery / big box
    "walmart", "costco", "sams club", "bjs", "stop shop", "stop and shop", "whole foods", "trader joes", "big y", "shoprite", "price chopper", "market basket", "hannaford", "wegmans", "aldi", "kroger", "safeway", "food lion", "star market", "roche bros", "harris teeter", "publix",
    // franchise bars / restaurants
    "applebees", "chilis", "buffalo wild wings", "tgi fridays", "olive garden", "hooters", "dave and busters", "texas roadhouse", "outback steakhouse", "red lobster", "cheesecake factory", "yard house", "hard rock cafe", "mcdonalds", "burger king", "wendys", "dunkin", "starbucks", "chipotle", "panera", "taco bell", "popeyes", "five guys", "shake shack", "cracker barrel", "chuck e cheese",
  ],
  _normName(s) { return (s || "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(); },
  isChain(name, tags) {
    if (tags && (tags["brand:wikidata"] || tags["brand:wikipedia"])) return true; // national/regional chains carry this; indies don't
    const norm = this._normName(name);
    if (!norm) return false;
    const words = new Set(norm.split(" "));
    const brandNorm = this._normName(tags && tags.brand ? tags.brand : "");
    for (const c of this.CHAINS) {
      if (c.includes(" ")) { if (norm.includes(c) || (brandNorm && brandNorm.includes(c))) return true; }
      else { if (words.has(c) || brandNorm === c) return true; }
    }
    return false;
  },

  // Young-adult / "hot spot" context from the anchor the search is centered on.
  ANCHOR_FIT: { university: { pts: 8, tag: "By campus" }, nightlife: { pts: 8, tag: "Bar district" }, arena: { pts: 6, tag: "By the arena" }, venue: { pts: 6, tag: "By the venue" }, casino: { pts: 5, tag: "Casino traffic" }, tourist: { pts: 5, tag: "Tourist zone" }, city: { pts: 3, tag: "Downtown" } },
  rankScoutStores(elements, anchorLL, ctx) {
    const accountNames = new Set(DB.stores().map((s) => s.name.trim().toLowerCase()));
    const anchorFit = (ctx && this.ANCHOR_FIT[ctx.anchorType]) || null;
    const seen = new Set(), out = [];
    elements.forEach((el) => {
      const t = el.tags || {}; const name = t.name; if (!name) return;
      if (this.isChain(name, t)) return; // independents only — skip national chains
      const lat = el.lat != null ? el.lat : (el.center && el.center.lat);
      const lon = el.lon != null ? el.lon : (el.center && el.center.lon);
      if (lat == null) return;
      const kind = t.shop || t.amenity; const info = this.SCOUT_TYPE[kind]; if (!info) return;
      const key = name.toLowerCase() + "|" + Math.round(lat * 2000) + "," + Math.round(lon * 2000);
      if (seen.has(key)) return; seen.add(key);
      const distMi = this.haversineMi(anchorLL[0], anchorLL[1], lat, lon);
      const already = accountNames.has(name.trim().toLowerCase());
      const addr = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");

      // real crowd-sourced signals from the map tags that track a younger, social crowd
      const signals = []; let signalPts = 0;
      const flag = (cond, pts, label) => { if (cond) { signalPts += pts; signals.push(label); } };
      flag(kind === "nightclub", 8, "Nightclub");
      flag(t.cocktails === "yes", 6, "Cocktail bar");
      flag(t.microbrewery === "yes" || t.brewery === "yes" || t.craft_beer === "yes", 5, "Craft / brewery");
      flag(t.live_music === "yes" || t.music === "live", 4, "Live music");
      flag(/0[2-4]:00|late/.test(t.opening_hours || ""), 4, "Late-night");
      flag(t.rooftop === "yes" || t.outdoor_seating === "yes", 2, "Patio / rooftop");
      flag(t.craft === "yes", 2, "Craft focus");
      const isBarKind = kind === "bar" || kind === "pub" || kind === "nightclub";
      flag(isBarKind && ctx && ctx.anchorType === "university", 6, "Student bar");
      if (anchorFit) { signalPts += anchorFit.pts; signals.push(anchorFit.tag); }

      const score = info.t * 10 + signalPts + Math.max(0, 12 - distMi * 6) - (already ? 100 : 0);
      out.push({ name, kind, typeLabel: info.label, leadType: info.lead, lat, lon, distMi, addr, city: t["addr:city"] || "", already, score, signals: signals.slice(0, 4), website: t.website || t["contact:website"] || "" });
    });
    return out.filter((s) => !s.already).sort((a, b) => b.score - a.score).slice(0, 30);
  },

  scoutArea(poi_id) {
    const poi = POIS.find((p) => p.id === poi_id); const ll = POI_COORDS[poi_id];
    if (!poi || !ll) return;
    this._openScout(`Stores near ${poi.name}`, `${poi.city}, ${poi.state} · real nearby businesses from OpenStreetMap`, "poi:" + poi_id, ll, { name: poi.name, city: poi.city, state: poi.state, anchorType: poi.type, poiId: poi_id });
  },
  scoutAddressModal() {
    this.modal({
      title: "Scout stores near an address",
      bodyHTML: `
        <p class="muted" style="margin-top:0">Type any street, neighborhood, or landmark. I'll pull the real liquor stores, bottle shops, bars, and markets around it.</p>
        <div class="field"><label>Address or place</label><input id="scout-addr" placeholder="e.g. 100 Bedford St, Stamford CT" autocomplete="off"></div>`,
      onOpen: () => { const el = $("#scout-addr"); if (el) el.focus(); },
      saveLabel: "🔍 Scout",
      onSave: () => {
        const addr = $("#scout-addr").value.trim();
        if (!addr) { this.toast("Enter an address", "err"); return false; }
        this._scoutByAddress(addr); return true;
      },
    });
  },
  async _scoutByAddress(addr) {
    this._openScout(`Stores near “${addr}”`, "Looking up the location…", "addr:" + addr, null, null);
    try {
      const res = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=" + encodeURIComponent(addr));
      const g = await res.json();
      if (!g.length) { const b = $("#scout-body"); if (b) b.innerHTML = `<div class="empty-state"><div class="big">🗺️</div>Couldn't find that address. Try adding the city and state.</div>`; return; }
      const ll = [parseFloat(g[0].lat), parseFloat(g[0].lon)];
      const parts = (g[0].display_name || "").split(",").map((x) => x.trim());
      let stateCode = ""; for (const p of parts) { if (this.STATE_NAME[p]) { stateCode = this.STATE_NAME[p]; break; } }
      const city = parts.length >= 3 ? parts[parts.length === 3 ? 0 : parts.length - 4] : "";
      this._scoutCtx = { title: `Stores near “${addr}”`, cacheKey: "addr:" + addr, ll, ctx: { name: addr, city, state: stateCode } };
      const sub = $("#scout-body") ? null : null;
      const subEl = document.querySelector(".modal__body .muted"); if (subEl) subEl.textContent = `Around ${g[0].display_name.split(",").slice(0, 3).join(", ")} · real nearby businesses from OpenStreetMap`;
      this._loadScout();
    } catch (e) {
      const b = $("#scout-body"); if (b) b.innerHTML = this._scoutErrHTML();
    }
  },
  _openScout(title, subtitle, cacheKey, ll, ctx) {
    this._scoutCtx = { title, cacheKey, ll, ctx };
    this.modal({
      title, wide: true,
      bodyHTML: `<p class="muted" style="margin-top:0">${esc(subtitle)}</p><div id="scout-body"><div class="empty-state"><div class="big">🛰️</div>Scanning the area…</div></div>`,
      cancelLabel: "Close",
    });
    if (ll) this._loadScout();
  },
  _scoutErrHTML() {
    return `<div class="empty-state"><div class="big">📡</div>Couldn't reach the map service just now — it's rate-limited or briefly offline.<br>This works on your live site; try again in a moment.<div style="margin-top:12px"><button class="btn btn--ghost btn--sm" onclick="App._loadScout(true)">Retry</button></div></div>`;
  },
  async _loadScout(force) {
    const { cacheKey, ll, ctx } = this._scoutCtx || {};
    if (!ll) return;
    const b = $("#scout-body"); if (b && force) b.innerHTML = `<div class="empty-state"><div class="big">🛰️</div>Scanning the area…</div>`;
    try {
      let stores = force ? null : this._scoutCache[cacheKey];
      if (!stores) { const els = await this.overpassNearby(ll[0], ll[1]); stores = this.rankScoutStores(els, ll, ctx); if (ctx && ctx.poiId) stores = await this.augmentKnownBars(ctx.poiId, stores, ll, ctx); this._scoutCache[cacheKey] = stores; }
      this._renderScoutBody(stores, ctx);
    } catch (e) {
      const bb = $("#scout-body"); if (bb) bb.innerHTML = this._scoutErrHTML();
    }
  },
  _renderScoutBody(stores, ctx) {
    const b = $("#scout-body"); if (!b) return;
    if (!stores.length) { b.innerHTML = `<div class="empty-state"><div class="big">🔦</div>No named stores found here in OpenStreetMap (coverage varies by area). Try a nearby address.</div>`; return; }
    const covNote = ctx && ctx.state ? (() => { const cov = DB.coverageForCounty(ctx.state, DB.countyForCity(ctx.city, ctx.state)); return cov ? `<span class="chip chip--sm chip--exported">🚚 ${esc(cov.name)}</span>` : (ctx.state ? `<span class="chip chip--sm" style="background:#ffe0e0">no distributor here</span>` : ""); })() : "";
    b.innerHTML = `
      <p style="margin:0 0 10px">${stores.length} real stores nearby ${covNote} <span class="muted">· ranked by fit + distance, ones you already carry removed</span></p>
      <div class="table-wrap"><table class="data" style="min-width:auto">
        <thead><tr><th class="no-sort">Store</th><th class="no-sort">Type</th><th class="no-sort num">Dist.</th><th class="no-sort"></th></tr></thead>
        <tbody>${stores.map((s, i) => `<tr>
          <td><strong>${esc(s.name)}</strong>${s.website ? ` <a href="${esc(s.website)}" target="_blank" rel="noopener" title="Website" onclick="event.stopPropagation()">↗</a>` : ""}${s.addr ? `<div class="muted" style="font-size:12px">${esc(s.addr)}</div>` : ""}${(s.signals && s.signals.length) ? `<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${s.signals.map((sig) => `<span class="chip chip--sm chip--lead">${esc(sig)}</span>`).join("")}</div>` : ""}</td>
          <td><span class="chip chip--sm">${esc(s.typeLabel)}</span></td>
          <td class="num mono">${s.distMi.toFixed(1)} mi</td>
          <td class="right" style="white-space:nowrap"><a class="btn btn--ghost btn--sm" href="${this.appleMapsUrl(s.lat, s.lon, s.name)}" target="_blank" rel="noopener">🧭 Maps</a> <button class="btn btn--primary btn--sm" id="scout-add-${i}" onclick="App.addScoutLead(${i})">＋ Lead</button></td>
        </tr>`).join("")}</tbody>
      </table></div>`;
  },
  _makeStoreLead(store, ctx, idx) {
    const city = store.city || (ctx && ctx.city) || "";
    const state = (ctx && ctx.state) || "";
    if (DB.leads().some((l) => l.name.toLowerCase() === store.name.toLowerCase() && (l.city || "") === city)) { this.toast("Already in your leads", "err"); return false; }
    const cov = state ? DB.coverageForCounty(state, DB.countyForCity(city, state)) : null;
    const sig = (store.signals && store.signals.length) ? " [" + store.signals.join(", ") + "]" : "";
    DB.insert("leads", {
      id: "lead_" + Date.now().toString(36) + idx, name: store.name, type: store.leadType,
      city, state, status: "to_visit", priority: "high", address: store.addr || "",
      lat: store.lat, lng: store.lon,
      note: `${store.typeLabel}${ctx && ctx.name ? " · ~" + store.distMi.toFixed(1) + " mi from " + ctx.name : ""}.${store.addr ? " " + store.addr + "." : ""}${sig}`,
      source: "scout", distributor_id: cov ? cov.id : null, created_at: new Date().toISOString().slice(0, 10),
    });
    this.toast(`${store.name} added to leads`);
    return true;
  },
  addScoutLead(idx) {
    const { cacheKey, ctx } = this._scoutCtx || {};
    const store = (this._scoutCache[cacheKey] || [])[idx]; if (!store) return;
    if (this._makeStoreLead(store, ctx, idx)) { const btn = $(`#scout-add-${idx}`); if (btn) { btn.textContent = "✓ Added"; btn.disabled = true; } }
  },

  /* ---- prominent inline "stores to hit" panel (follows the top / filtered zone) ---- */
  showZoneStores(poi_id) {
    this._topPoi = poi_id;
    this.loadTopStores(poi_id);
    const p = $("#top-stores-panel"); if (p) p.scrollIntoView({ behavior: "smooth", block: "start" });
  },
  async loadTopStores(poi_id) {
    const poi = POIS.find((p) => p.id === poi_id); const ll = poi ? POI_COORDS[poi_id] : null;
    const title = $("#top-stores-title"), sub = $("#top-stores-sub"), body = $("#top-stores");
    if (!poi || !ll || !body) { if (body) body.innerHTML = `<div class="empty-state" style="padding:24px">Pick an opportunity zone below to see real stores there.</div>`; return; }
    this._topPoi = poi_id;
    if (title) title.textContent = `🔥 Stores to hit near ${poi.name}`;
    if (sub) sub.textContent = `${poi.city}, ${poi.state}`;
    body.innerHTML = `<div class="empty-state" style="padding:24px"><div class="big">🛰️</div>Pulling real stores near ${esc(poi.name)}…</div>`;
    const ctx = { name: poi.name, city: poi.city, state: poi.state, anchorType: poi.type, poiId: poi_id };
    const cacheKey = "poi:" + poi_id;
    try {
      let stores = this._scoutCache[cacheKey];
      if (!stores) { const els = await this.overpassNearby(ll[0], ll[1]); stores = this.rankScoutStores(els, ll, ctx); stores = await this.augmentKnownBars(poi_id, stores, ll, ctx); this._scoutCache[cacheKey] = stores; }
      if (this._topPoi !== poi_id) return; // a newer selection won
      this._renderTopStores(stores, ctx);
    } catch (e) {
      if (this._topPoi !== poi_id) return;
      body.innerHTML = `<div class="empty-state" style="padding:24px"><div class="big">📡</div>Couldn't reach the map service just now. Works on your live site — <button class="btn btn--ghost btn--sm" onclick="App.loadTopStores('${poi_id}')">retry</button></div>`;
    }
  },
  _renderTopStores(stores, ctx) {
    const body = $("#top-stores"); if (!body) return;
    if (!stores.length) { body.innerHTML = `<div class="empty-state" style="padding:24px">No named stores mapped right here yet. Try another zone or Scout an address.</div>`; return; }
    const cov = ctx.state ? DB.coverageForCounty(ctx.state, DB.countyForCity(ctx.city, ctx.state)) : null;
    body.innerHTML = `
      <p class="muted" style="margin:0 0 12px">${stores.length} real stores nearby ${cov ? `<span class="chip chip--sm chip--exported">🚚 ${esc(cov.name)}</span>` : ""} · ranked by fit + distance, ones you already carry removed</p>
      <div class="store-list">
        ${stores.slice(0, 10).map((s, i) => `
          <div class="store-tile">
            <div class="store-tile__rank">${i + 1}</div>
            <div class="store-tile__main">
              <div class="store-tile__name">${esc(s.name)}${s.website ? ` <a href="${esc(s.website)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">↗</a>` : ""}</div>
              <div class="store-tile__meta"><span class="chip chip--sm">${esc(s.typeLabel)}</span> <span class="muted">${s.distMi.toFixed(1)} mi${s.addr ? " · " + esc(s.addr) : ""}</span></div>
              ${(s.signals && s.signals.length) ? `<div class="store-tile__sigs">${s.signals.map((sig) => `<span class="chip chip--sm chip--lead">${esc(sig)}</span>`).join("")}</div>` : ""}
            </div>
            <div class="store-tile__act">
              <a class="btn btn--ghost btn--sm" href="${this.appleMapsUrl(s.lat, s.lon, s.name)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">🧭 Maps</a>
              <button class="btn btn--primary btn--sm" id="top-add-${i}" onclick="App.addTopLead(${i})">＋ Lead</button>
            </div>
          </div>`).join("")}
      </div>`;
  },
  addTopLead(idx) {
    const poi = POIS.find((p) => p.id === this._topPoi); if (!poi) return;
    const store = (this._scoutCache["poi:" + this._topPoi] || [])[idx]; if (!store) return;
    const ctx = { name: poi.name, city: poi.city, state: poi.state };
    if (this._makeStoreLead(store, ctx, idx)) { const btn = $(`#top-add-${idx}`); if (btn) { btn.textContent = "✓ Added"; btn.disabled = true; } this.renderLeadsListOnly(); }
  },
  renderLeadsListOnly() { /* placeholder — full re-render happens on nav; keep panel stable */ },

  /* ---------------- DISTRIBUTORS & EXPORTS ---------------- */
  renderDistributors() {
    const dists = DB.distributors();
    const html = `
      <div class="btn-row" style="margin-bottom:18px">
        <button class="btn btn--primary" onclick="App.distModal()">＋ New distributor</button>
      </div>
      <p class="muted" style="margin:-4px 0 18px;max-width:640px">Each export sends only the orders that are <strong>new since your last send</strong> to that distributor — so you never re-download everything. The badge shows how many are waiting.</p>
      ${dists.map((d) => {
        const pending = DB.pendingForDistributor(d.id);
        const last = DB.lastExportFor(d.id);
        const stores = DB.stores().filter((s) => s.distributor_id === d.id);
        const pendTotal = pending.reduce((a, o) => a + o.total, 0);
        return `<div class="panel">
          <div class="panel__head">
            <div>
              <h3>${esc(d.name)} <span class="chip chip--sm">${d.state}</span></h3>
              <div class="coverage-note ${d.coverage_type === "partial" ? "partial" : ""}">${d.coverage_type === "partial" ? "◱ Partial: " + esc(d.coverage_note || (d.counties || []).join(", ")) : "▦ " + d.state + " statewide"}</div>
            </div>
            <span class="spacer"></span>
            <button class="btn btn--ghost btn--sm" onclick="App.distModal('${d.id}')">Edit</button>
            <button class="btn btn--ghost btn--sm" onclick="App.deleteDistributor('${d.id}')">Delete</button>
          </div>
          <div style="display:flex;gap:26px;flex-wrap:wrap;align-items:center">
            <div><div class="kpi__label">Accounts</div><div style="font-family:var(--font-ui);font-size:22px">${stores.length}</div></div>
            <div><div class="kpi__label">Waiting to export</div><div style="font-family:var(--font-ui);font-size:22px;color:${pending.length ? "var(--coral-deep)" : "var(--muted)"}">${pending.length} <span style="font-size:13px;color:var(--muted)">(${fmtMoney(pendTotal)})</span></div></div>
            <div><div class="kpi__label">Last export</div><div style="font-family:var(--font-ui);font-size:15px">${last ? new Date(last.run_at).toLocaleDateString() + " · " + last.count + " orders" : "never"}</div></div>
            <span class="spacer" style="flex:1"></span>
            <div class="btn-row">
              <button class="btn ${pending.length ? "btn--coral" : ""}" ${pending.length ? "" : "disabled"} onclick="App.exportModal('${d.id}','new')">Export new (${pending.length})</button>
              <button class="btn btn--ghost" onclick="App.exportModal('${d.id}','all')">Export all</button>
            </div>
          </div>
          ${d.contact_name || d.email ? `<div class="muted" style="font-size:13px;margin-top:12px">Send to: ${esc(d.contact_name || "")} ${d.email ? "· " + esc(d.email) : ""} ${d.phone ? "· " + esc(d.phone) : ""}</div>` : ""}
        </div>`;
      }).join("")}`;
    $("#view").innerHTML = html;
  },

  exportModal(distId, scope) {
    const d = DB.distributor(distId);
    const rows = scope === "new" ? DB.pendingForDistributor(distId)
      : DB.pricedOrders().filter((o) => o.distributor_id === distId).sort((a, b) => a.date.localeCompare(b.date));
    if (!rows.length) { this.toast("Nothing to export.", "err"); return; }
    const total = rows.reduce((a, o) => a + o.total, 0);
    const cases = rows.reduce((a, o) => a + o.cases, 0);

    this.modal({
      title: `Export → ${d.name}`, wide: true,
      bodyHTML: `
        <p class="muted" style="margin-top:0">${scope === "new" ? "<strong>New orders only</strong> — not sent to this distributor before." : "<strong>All orders</strong> for this distributor."} ${rows.length} orders · ${cases} cases · <strong>${fmtMoney2(total)}</strong></p>
        <div class="table-wrap"><table class="data" style="min-width:auto">
          <thead><tr><th class="no-sort">Date</th><th class="no-sort">Store</th><th class="no-sort">Products</th><th class="no-sort num">Cases</th><th class="no-sort num">Amount</th></tr></thead>
          <tbody>${rows.map((o) => `<tr><td>${fmtDate(o.date)}</td><td>${esc(o.store_name)}</td><td class="muted" style="font-size:12px">${o.lines.map((l) => `${l.cases}× ${l.product_name.replace("Spiked ", "")}`).join(", ")}</td><td class="num mono">${o.cases}</td><td class="num mono">${fmtMoney2(o.total)}</td></tr>`).join("")}</tbody>
          <tfoot><tr><td colspan="3" class="right"><strong>Total</strong></td><td class="num mono"><strong>${cases}</strong></td><td class="num mono"><strong>${fmtMoney2(total)}</strong></td></tr></tfoot>
        </table></div>`,
      saveLabel: "⬇ Download CSV" + (scope === "new" ? " & mark sent" : ""),
      onSave: () => {
        this.downloadCSV(d, rows);
        if (scope === "new") { DB.markExported(distId, rows.map((o) => o.id)); this.toast(`Exported ${rows.length} orders & marked sent`); }
        else { this.toast(`Downloaded ${rows.length} orders`); }
        this.renderDistributors(); return true;
      },
      extraFoot: `<span class="muted" style="margin-right:auto;font-size:12px;align-self:center">CSV opens in Excel / Sheets</span>`,
    });
  },

  downloadCSV(dist, rows) {
    const header = ["Order Date", "Store", "City", "State", "Product", "SKU", "Cases", "Case Price", "Line Total", "Order ID"];
    const lines = [header.join(",")];
    rows.forEach((o) => {
      const store = DB.store(o.store_id);
      o.lines.forEach((l) => {
        const prod = DB.product(l.product_id);
        lines.push([
          o.date, `"${(o.store_name || "").replace(/"/g, '""')}"`, `"${store ? store.city : ""}"`, o.state,
          `"${l.product_name}"`, prod ? prod.sku : "", l.cases, l.case_price.toFixed(2), l.line_total.toFixed(2), o.id,
        ].join(","));
      });
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url; a.download = `whatcha_${dist.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}_${stamp}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  },

  /* ---------------- GENERIC EXPORTS (sales, stores, website locator) ---------------- */
  saveFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  },
  csvCell(v) { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; },
  csvRows(header, rows) { return [header.map((h) => this.csvCell(h)).join(","), ...rows.map((r) => r.map((c) => this.csvCell(c)).join(","))].join("\n"); },
  stamp() { return new Date().toISOString().slice(0, 10); },

  // Orders within an optional [from, to] date window (inclusive), optionally
  // narrowed to specific states and/or distributors (empty/omitted = all).
  salesInRange(from, to, states, distIds) {
    return DB.pricedOrders()
      .filter((o) => (!from || o.date >= from) && (!to || o.date <= to))
      .filter((o) => !states || !states.length || states.includes(o.state))
      .filter((o) => !distIds || !distIds.length || distIds.includes(o.distributor_id))
      .sort((a, b) => a.date.localeCompare(b.date));
  },
  // Every order in range, one row per line item — the full sales export.
  exportAllSales(from, to, states, distIds) {
    const rows = [];
    this.salesInRange(from, to, states, distIds).forEach((o) => {
      const store = DB.store(o.store_id); const dist = DB.distributor(o.distributor_id);
      o.lines.forEach((l) => {
        const prod = DB.product(l.product_id);
        rows.push([o.date, o.store_name, store ? store.city : "", o.state, dist ? dist.name : "", l.product_name, prod ? prod.sku : "", l.cases, l.case_price.toFixed(2), l.line_total.toFixed(2), o.id]);
      });
    });
    if (!rows.length) return this.toast("No sales match those filters", "err");
    const tag = from || to ? `${from || "start"}_to_${to || this.stamp()}` : this.stamp();
    this.saveFile(`whatcha_sales_${tag}.csv`,
      this.csvRows(["Date", "Store", "City", "State", "Distributor", "Product", "SKU", "Cases", "Case Price", "Line Total", "Order ID"], rows), "text/csv");
    this.toast(`Exported ${rows.length} sale lines`);
  },

  // Date-range picker before downloading sales.
  exportSalesModal() {
    const ords = DB.pricedOrders().map((o) => o.date).sort();
    const minD = ords[0] || this.stamp();
    const maxD = this.stamp();
    const monthStart = maxD.slice(0, 8) + "01";
    const d30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const allStates = [...new Set(DB.stores().map((s) => s.state))].sort();
    const dists = DB.distributors();

    const selectedStates = () => $$("#exp-states button.active").map((b) => b.dataset.v);
    const selectedDists = () => $$("#exp-dists button.active").map((b) => b.dataset.v);

    const summary = () => {
      const from = $("#exp-from").value, to = $("#exp-to").value;
      const rows = this.salesInRange(from, to, selectedStates(), selectedDists());
      const cases = rows.reduce((a, o) => a + o.cases, 0);
      const total = rows.reduce((a, o) => a + o.total, 0);
      $("#exp-summary").innerHTML = `<strong>${rows.length}</strong> orders · <strong>${cases}</strong> cases · <strong>${fmtMoney2(total)}</strong>`;
    };
    const preset = (from, to) => { $("#exp-from").value = from; $("#exp-to").value = to; summary(); };
    const togglePill = (el) => { el.classList.toggle("active"); summary(); };

    this.modal({
      title: "Export sales",
      bodyHTML: `
        <p style="margin-top:0" class="muted">Pick the date range to download. Great for sending a distributor just this month's orders, or pulling a quarter for your books.</p>
        <div class="pill-filter" style="margin-bottom:14px">
          <button type="button" onclick="App._expPreset('all')">All time</button>
          <button type="button" onclick="App._expPreset('month')">This month</button>
          <button type="button" onclick="App._expPreset('30')">Last 30 days</button>
        </div>
        <div class="field--row">
          <div class="field"><label>From</label><input type="date" id="exp-from" value="${minD}" min="${minD}" max="${maxD}" onchange="App._expSummary()"></div>
          <div class="field"><label>To</label><input type="date" id="exp-to" value="${maxD}" min="${minD}" max="${maxD}" onchange="App._expSummary()"></div>
        </div>
        ${allStates.length ? `<div class="field"><label>States <span class="muted" style="font-weight:normal">· none selected = every state</span></label>
          <div class="pill-filter" id="exp-states">${allStates.map((st) => `<button type="button" data-v="${st}" onclick="App._expToggle(this)">${st}</button>`).join("")}</div>
        </div>` : ""}
        ${dists.length ? `<div class="field"><label>Distributors <span class="muted" style="font-weight:normal">· none selected = every distributor</span></label>
          <div class="pill-filter" id="exp-dists">${dists.map((d) => `<button type="button" data-v="${d.id}" onclick="App._expToggle(this)">${esc(d.name)}</button>`).join("")}</div>
        </div>` : ""}
        <div class="panel" style="box-shadow:none;margin:0"><div id="exp-summary" class="muted">—</div></div>`,
      onOpen: () => {
        this._expSummary = summary;
        this._expPreset = (k) => { if (k === "all") preset(minD, maxD); else if (k === "month") preset(monthStart, maxD); else preset(d30, maxD); };
        this._expToggle = togglePill;
        summary();
      },
      saveLabel: "⬇ Download CSV",
      onSave: () => { this.exportAllSales($("#exp-from").value, $("#exp-to").value, selectedStates(), selectedDists()); return true; },
    });
  },

  // Every account/store — the full store list with geography + status.
  // Optionally narrowed to specific states and/or distributors.
  exportStores(states, distIds) {
    const rows = DB.stores()
      .filter((s) => !states || !states.length || states.includes(s.state))
      .filter((s) => !distIds || !distIds.length || distIds.includes(s.distributor_id))
      .map((s) => {
        const d = DB.distributor(s.distributor_id); const st = DB.storeStats(s.id);
        return [s.name, s.type || "", s.address || "", s.city || "", s.state, s.status, d ? d.name : "", s.contact_name || "", s.phone || "", s.email || "", st.count, st.cases, st.revenue.toFixed(2), s.created_at || "", (s.notes || "").replace(/\n/g, " ")];
      });
    if (!rows.length) return this.toast("No accounts match those filters", "err");
    this.saveFile(`whatcha_stores_${this.stamp()}.csv`,
      this.csvRows(["Store", "Type", "Address", "City", "State", "Status", "Distributor", "Contact", "Phone", "Email", "Orders", "Cases", "Revenue", "Added", "Notes"], rows), "text/csv");
    this.toast(`Exported ${rows.length} accounts`);
  },
  exportStoresModal() {
    const allStates = [...new Set(DB.stores().map((s) => s.state))].sort();
    const dists = DB.distributors();
    const selectedStates = () => $$("#exps-states button.active").map((b) => b.dataset.v);
    const selectedDists = () => $$("#exps-dists button.active").map((b) => b.dataset.v);
    const matchCount = () => DB.stores()
      .filter((s) => !selectedStates().length || selectedStates().includes(s.state))
      .filter((s) => !selectedDists().length || selectedDists().includes(s.distributor_id)).length;
    const summary = () => { const n = matchCount(); $("#exps-summary").innerHTML = `<strong>${n}</strong> account${n === 1 ? "" : "s"} will be exported`; };
    const togglePill = (el) => { el.classList.toggle("active"); summary(); };

    this.modal({
      title: "Export accounts",
      bodyHTML: `
        <p style="margin-top:0" class="muted">Leave everything unselected to export every account, or narrow it down to specific states or distributors.</p>
        ${allStates.length ? `<div class="field"><label>States <span class="muted" style="font-weight:normal">· none selected = every state</span></label>
          <div class="pill-filter" id="exps-states">${allStates.map((st) => `<button type="button" data-v="${st}" onclick="App._expsToggle(this)">${st}</button>`).join("")}</div>
        </div>` : ""}
        ${dists.length ? `<div class="field"><label>Distributors <span class="muted" style="font-weight:normal">· none selected = every distributor</span></label>
          <div class="pill-filter" id="exps-dists">${dists.map((d) => `<button type="button" data-v="${d.id}" onclick="App._expsToggle(this)">${esc(d.name)}</button>`).join("")}</div>
        </div>` : ""}
        <div class="panel" style="box-shadow:none;margin:0"><div id="exps-summary" class="muted">—</div></div>`,
      onOpen: () => { this._expsToggle = togglePill; summary(); },
      saveLabel: "⬇ Download CSV",
      onSave: () => { this.exportStores(selectedStates(), selectedDists()); return true; },
    });
  },

  // Website store-locator feed: matches store-locator/stores.json exactly
  // ({name, address, hours, phone}). Active accounts only by default —
  // these are the ones customers can actually buy from.
  exportLocatorJSON(includeAll = false) {
    const stores = DB.stores().filter((s) => includeAll || s.status === "active");
    if (!stores.length) return this.toast(includeAll ? "No accounts to export" : "No active accounts yet", "err");
    const data = stores.map((s) => ({
      name: s.name,
      address: [s.address, s.city, s.state].filter(Boolean).join(", "),
      hours: s.hours || "",
      phone: s.phone || "",
    }));
    this.saveFile("stores.json", JSON.stringify(data, null, 2), "application/json");
    this.toast(`Exported ${data.length} ${includeAll ? "" : "active "}stores for the website`);
  },

  distModal(id) {
    const d = id ? DB.distributor(id) : null;
    const v = (k) => d ? (d[k] || "") : "";
    this.modal({
      title: d ? "Edit distributor" : "New distributor",
      bodyHTML: `
        <div class="field"><label>Name *</label><input id="d-name" value="${esc(v("name"))}"></div>
        <div class="field"><label>State / market</label><select id="d-state">${US_STATES.map((st) => `<option ${(v("state") || "CT") === st ? "selected" : ""}>${st}</option>`).join("")}</select></div>
        <div class="field"><label>Coverage</label>
          <select id="d-covtype"><option value="statewide" ${v("coverage_type") === "statewide" ? "selected" : ""}>Whole state</option><option value="partial" ${(v("coverage_type") || "partial") === "partial" ? "selected" : ""}>Part of the state only</option></select>
          <div class="hint">Recommendations only appear in areas a distributor covers.</div>
        </div>
        <div class="field" id="d-cov-partial"><label>Counties covered <span class="muted" style="font-weight:normal">· comma-separated</span></label>
          <input id="d-counties" value="${esc((d && d.counties || []).join(", "))}" placeholder="Fairfield, New Haven, Hartford">
          <input id="d-covnote" value="${esc(v("coverage_note"))}" placeholder="Short description (optional), e.g. Greater Boston" style="margin-top:8px">
        </div>
        <div class="field--row">
          <div class="field"><label>Contact name</label><input id="d-contact" value="${esc(v("contact_name"))}"></div>
          <div class="field"><label>Phone</label><input id="d-phone" value="${esc(v("phone"))}"></div>
        </div>
        <div class="field"><label>Order email</label><input id="d-email" value="${esc(v("email"))}"></div>`,
      onOpen: () => {
        const toggle = () => { const partial = $("#d-covtype").value === "partial"; $("#d-cov-partial").style.display = partial ? "" : "none"; };
        $("#d-covtype").onchange = toggle; toggle();
      },
      saveLabel: d ? "Save" : "Add distributor",
      onSave: () => {
        const name = $("#d-name").value.trim();
        if (!name) { this.toast("Name required", "err"); return false; }
        const coverage_type = $("#d-covtype").value;
        const counties = coverage_type === "partial" ? $("#d-counties").value.split(",").map((c) => c.trim()).filter(Boolean) : [];
        const payload = { name, state: $("#d-state").value, coverage_type, counties, coverage_note: $("#d-covnote").value.trim(), contact_name: $("#d-contact").value.trim(), phone: $("#d-phone").value.trim(), email: $("#d-email").value.trim() };
        if (d) { DB.update("distributors", id, payload); this.toast("Distributor updated"); }
        else { DB.insert("distributors", payload); this.toast("Distributor added"); }
        this.renderDistributors(); return true;
      },
    });
  },

  deleteDistributor(id) {
    const d = DB.distributor(id);
    if (!d) return;
    const linked = DB.stores().filter((s) => s.distributor_id === id).length;
    this.modal({
      title: `Delete ${d.name}?`,
      bodyHTML: `<p style="margin-top:0">This permanently removes the distributor <strong>${esc(d.name)}</strong> (${d.state}).${linked ? ` <strong>${linked}</strong> account${linked > 1 ? "s" : ""} linked to it will be set to <em>no distributor</em> — you can reassign ${linked > 1 ? "them" : "it"} anytime.` : ""} Exports already sent are unaffected.</p>`,
      saveLabel: "Delete distributor",
      onSave: () => {
        DB.stores().filter((s) => s.distributor_id === id).forEach((s) => DB.update("stores", s.id, { distributor_id: null }));
        DB.remove("distributors", id);
        this.toast("Distributor deleted");
        this.renderDistributors(); return true;
      },
    });
  },

  /* ---------------- PRICING ---------------- */
  renderPricing() {
    const products = DB.products();
    const px = DB.pricing();
    // States shown are driven by your data — every state you've added prices
    // for. Add/remove them with the buttons; nothing is hard-coded, so a state
    // you remove stays gone.
    const states = [...new Set(px.map((p) => p.state))].sort();
    const cell = (st, prod) => {
      const found = px.find((p) => p.state === st && p.product_id === prod.id);
      return `<input type="number" step="0.01" min="0" style="width:96px;padding:6px 8px" value="${found && found.case_price != null ? found.case_price : ""}" placeholder="—" data-px-state="${st}" data-px-prod="${prod.id}">`;
    };
    const colspan = products.length + 3;
    const rows = states.length
      ? states.map((st) => `<tr><td><strong>${st}</strong></td>${products.map((p) => `<td class="num">${cell(st, p)}</td>`).join("")}<td class="num muted">${products[0].units_per_case}</td><td class="num"><button class="btn btn--ghost btn--sm" title="Remove ${st}" aria-label="Remove ${st}" onclick="App.removeState('${st}')">✕</button></td></tr>`).join("")
      : `<tr><td colspan="${colspan}" class="muted" style="text-align:center;padding:20px">No states yet. Click <strong>＋ Add state</strong> to add the states you sell in.</td></tr>`;
    const html = `
      <p class="muted" style="margin-top:0;max-width:660px">Set the <strong>price per case</strong> for each product in each state. Every order is automatically priced from this table based on the account's state — change a number here and all the math updates.</p>
      <div class="panel">
        <div class="panel__head"><h3>Price per case ($)</h3><span class="spacer"></span><button class="btn btn--ghost btn--sm" onclick="App.addState()">＋ Add state</button></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th class="no-sort">State</th>${products.map((p) => `<th class="no-sort num">${esc(p.name.replace("Spiked ", ""))}</th>`).join("")}<th class="no-sort num">Units/case</th><th class="no-sort"></th></tr></thead>
          <tbody>
          ${rows}
          </tbody>
        </table></div>
        <div class="btn-row" style="margin-top:16px"><button class="btn btn--primary" onclick="App.savePricing()">Save pricing</button></div>
      </div>
      <div class="panel">
        <div class="panel__head"><h3>Products</h3></div>
        <div class="table-wrap"><table class="data" style="min-width:auto">
          <thead><tr><th class="no-sort">Product</th><th class="no-sort">SKU</th><th class="no-sort num">Units / case</th></tr></thead>
          <tbody>${products.map((p) => `<tr><td>${esc(p.name)}</td><td class="mono">${p.sku}</td><td class="num mono">${p.units_per_case}</td></tr>`).join("")}</tbody>
        </table></div>
      </div>`;
    $("#view").innerHTML = html;
  },
  addState() {
    const have = new Set(DB.pricing().map((p) => p.state));
    const options = US_STATES.map((st) => `<option value="${st}" ${have.has(st) ? "disabled" : ""}>${st}${have.has(st) ? " — already added" : ""}</option>`).join("");
    this.modal({
      title: "Add a state",
      bodyHTML: `<div class="field"><label>State</label><select id="ps-state">${options}</select><div class="hint">Pick a state you sell in — you'll set its per-case prices next.</div></div>`,
      saveLabel: "Add state",
      onSave: () => {
        const code = $("#ps-state").value;
        if (!code) { this.toast("Pick a state", "err"); return false; }
        if (DB.pricing().some((p) => p.state === code)) { this.toast(`${code} is already in the table`, "err"); return false; }
        DB.products().forEach((p) => DB.setPrice(code, p.id, 0));
        this.toast(`Added ${code} — set its prices`); this.renderPricing(); return true;
      },
    });
  },
  removeState(code) {
    this.modal({
      title: `Remove ${code}?`,
      bodyHTML: `<p style="margin-top:0">This removes <strong>${code}</strong> and its per-case prices from the table. Orders you've already saved keep their prices, and you can add ${code} back anytime.</p>`,
      saveLabel: "Remove state",
      onSave: () => {
        DB.pricing().filter((p) => p.state === code).forEach((p) => DB.remove("pricing", p.id));
        this.toast(`Removed ${code}`); this.renderPricing(); return true;
      },
    });
  },
  savePricing() {
    let n = 0;
    $$("[data-px-state]").forEach((el) => {
      const val = el.value.trim();
      if (val === "") return;
      DB.setPrice(el.dataset.pxState, el.dataset.pxProd, parseFloat(val)); n++;
    });
    this.toast(`Saved ${n} price points`); this.renderPricing();
  },

  /* ---------------- SETTINGS ---------------- */
  renderSettings() {
    const counts = { stores: DB.stores().length, orders: DB.orders().length, distributors: DB.distributors().length };
    $("#view").innerHTML = `
      <div class="panel">
        <div class="panel__head"><h3>Data mode</h3></div>
        <p style="margin-top:0">Currently running in <strong style="color:var(--coral-deep)">${DB.mode === "local" ? "DEMO mode" : "LIVE (Supabase)"}</strong>.</p>
        ${DB.mode === "local" ? `<p class="muted">Data is saved in this browser only. To sync across your phone + laptop and go live, connect Supabase — see <code>README.md</code> in the project (about 5 minutes). Then I flip one setting and your login + live database turn on.</p>` : ""}
        <p class="muted">Accounts: ${counts.stores} · Orders: ${counts.orders} · Distributors: ${counts.distributors}</p>
      </div>
      <div class="panel">
        <div class="panel__head"><h3>Exports</h3></div>
        <p class="muted" style="margin-top:0">Share these with distributors, your accountant, or your website.</p>
        <div class="btn-row">
          <button class="btn btn--coral" onclick="App.exportSalesModal()">⬇ Sales by date (CSV)</button>
          <button class="btn btn--ghost" onclick="App.exportStoresModal()">⬇ All stores (CSV)</button>
          <button class="btn btn--ghost" onclick="App.locatorExportModal()">🗺️ Website locator (stores.json)</button>
        </div>
      </div>
      <div class="panel">
        <div class="panel__head"><h3>Backup & restore</h3></div>
        <div class="btn-row">
          <button class="btn btn--ghost" onclick="App.exportJSON()">⬇ Download all data (JSON)</button>
          <button class="btn btn--ghost" onclick="document.getElementById('import-file').click()">⬆ Import data</button>
          <input type="file" id="import-file" accept="application/json" class="hidden" onchange="App.importJSON(event)">
        </div>
      </div>
      ${DB.mode === "local" ? `<div class="panel">
        <div class="panel__head"><h3>Demo data</h3></div>
        <p class="muted" style="margin-top:0">Reset back to the sample Whatcha data (removes anything you've added in demo mode).</p>
        <button class="btn btn--coral" onclick="App.resetDemo()">Reset demo data</button>
      </div>` : `<div class="panel">
        <div class="panel__head"><h3>Account</h3></div>
        <p class="muted" style="margin-top:0">You're signed in to your live Whatcha HQ account. Your data syncs across every device.</p>
        <button class="btn btn--ghost" onclick="App.logout()">Sign out</button>
      </div>`}`;
  },
  exportJSON() {
    const data = { products: DB.products(), pricing: DB.pricing(), distributors: DB.distributors(), stores: DB.stores(), orders: DB.orders(), exports: DB.exports() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `whatcha_dashboard_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    this.toast("Backup downloaded");
  },
  importJSON(ev) {
    const f = ev.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        ["products", "pricing", "distributors", "stores", "orders", "exports"].forEach((c) => { if (data[c]) DB.backend.replaceAll(c, data[c]); });
        this.toast("Data imported"); this.go(this.view);
      } catch { this.toast("Invalid file", "err"); }
    };
    r.readAsText(f);
  },
  resetDemo() {
    if (!confirm("Reset to demo data? Removes your changes.")) return;
    DB.reset(); this.toast("Demo data reset"); this.go("dashboard");
  },

  /* ---------------- MODAL + TOAST ---------------- */
  _modalSave: null,
  modal({ title, bodyHTML, onSave, onOpen, saveLabel = "Save", cancelLabel = "Cancel", wide, extraFoot = "" }) {
    const host = $("#modal-host");
    host.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal" style="${wide ? "width:min(760px,100%)" : ""}" role="dialog" aria-modal="true">
          <div class="modal__head"><h3>${esc(title)}</h3><button class="modal__close" onclick="App.closeModal()">✕</button></div>
          <div class="modal__body" id="modal-body">${bodyHTML}</div>
          <div class="modal__foot">${extraFoot}<button class="btn btn--ghost" onclick="App.closeModal()">${cancelLabel}</button>${onSave ? `<button class="btn btn--primary" id="modal-save">${saveLabel}</button>` : ""}</div>
        </div>
      </div>`;
    $("#modal-overlay").onclick = (e) => { if (e.target.id === "modal-overlay") this.closeModal(); };
    if (onSave) $("#modal-save").onclick = () => { const ok = onSave(); if (ok !== false) this.closeModal(); };
    if (onOpen) onOpen();
    document.body.style.overflow = "hidden";
  },
  closeModal() { $("#modal-host").innerHTML = ""; document.body.style.overflow = ""; },

  toast(msg, type = "ok") {
    const wrap = $("#toast-wrap");
    const el = document.createElement("div");
    el.className = "toast " + (type === "err" ? "err" : "ok");
    el.textContent = msg; wrap.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; setTimeout(() => el.remove(), 300); }, 2600);
  },
};

/* ---------------- boot ---------------- */
window.addEventListener("DOMContentLoaded", () => {
  $("#hamburger").onclick = () => App.toggleMobileNav();
  $("#scrim").onclick = () => App.closeMobileNav();
  $("#logout-btn").onclick = () => App.logout();
  $("#new-sale-btn").onclick = () => App.quickSaleModal();
  const searchEl = $("#search-input");
  if (searchEl) searchEl.oninput = (e) => { App.search = e.target.value; if (["orders", "accounts"].includes(App.view)) App.go(App.view); };
  window.addEventListener("hashchange", () => { const h = location.hash.replace("#", ""); const appVisible = !document.getElementById("app").classList.contains("hidden"); if (h && h !== App.view && appVisible) App.go(h); });
  App.initAuth();
});
window.App = App;
