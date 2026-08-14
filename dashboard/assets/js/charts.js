/* ============================================================
   Whatcha Dashboard — tiny inline-SVG charts (no dependencies)
   Brand palette hard-coded to match dashboard.css tokens.
   ============================================================ */
const PALETTE = ["#0526c5", "#f37847", "#27baad", "#ffe808", "#75d0f7", "#f47563", "#c8dfb8", "#e6cf00"];
const fmtMoney = (n) =>
  "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtMoney2 = (n) =>
  "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const Charts = {
  // Vertical bar / column chart from [{label, value}]
  bars(data, opts = {}) {
    const { height = 220, money = true, colors = null } = opts;
    const colFor = (i) => (colors && colors[i]) ? colors[i] : PALETTE[i % PALETTE.length];
    if (!data.length) return `<div class="t-empty">No data yet</div>`;
    const W = 640, H = height, padL = 46, padB = 34, padT = 12, padR = 8;
    const max = Math.max(...data.map((d) => d.value), 1);
    const bw = (W - padL - padR) / data.length;
    const y = (v) => padT + (1 - v / max) * (H - padT - padB);
    const fmt = money ? fmtMoney : (n) => n.toLocaleString();

    let grid = "";
    for (let i = 0; i <= 4; i++) {
      const gv = (max / 4) * i;
      const gy = y(gv);
      grid += `<line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" stroke="#e7e6f2" stroke-width="1"/>
               <text x="${padL - 6}" y="${gy + 4}" text-anchor="end" font-size="10" fill="#6b6b86">${fmt(gv)}</text>`;
    }
    const bars = data.map((d, i) => {
      const x = padL + i * bw + bw * 0.16;
      const w = bw * 0.68;
      const barH = (d.value / max) * (H - padT - padB);
      const yy = H - padB - barH;
      const label = d.label.length > 9 ? d.label.slice(0, 8) + "…" : d.label;
      return `<g>
        <rect x="${x}" y="${yy}" width="${w}" height="${Math.max(barH, 0)}" rx="4" fill="${colFor(i)}" stroke="#12123a" stroke-width="1.5"/>
        <text x="${x + w / 2}" y="${yy - 5}" text-anchor="middle" font-size="10" font-weight="700" fill="#12123a">${money ? fmtMoney(d.value) : d.value}</text>
        <text x="${x + w / 2}" y="${H - padB + 15}" text-anchor="middle" font-size="10" fill="#6b6b86">${label}</text>
      </g>`;
    }).join("");
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">${grid}${bars}</svg>`;
  },

  // Line chart (trend) from [{label, value}]
  line(data, opts = {}) {
    const { height = 220, money = true } = opts;
    if (data.length < 1) return `<div class="t-empty">No data yet</div>`;
    if (data.length === 1) return this.bars(data, opts);
    const W = 640, H = height, padL = 48, padB = 30, padT = 14, padR = 12;
    const max = Math.max(...data.map((d) => d.value), 1);
    const stepX = (W - padL - padR) / (data.length - 1);
    const x = (i) => padL + i * stepX;
    const y = (v) => padT + (1 - v / max) * (H - padT - padB);
    const fmt = money ? fmtMoney : (n) => n.toLocaleString();

    let grid = "";
    for (let i = 0; i <= 4; i++) {
      const gv = (max / 4) * i, gy = y(gv);
      grid += `<line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" stroke="#e7e6f2"/>
               <text x="${padL - 6}" y="${gy + 4}" text-anchor="end" font-size="10" fill="#6b6b86">${fmt(gv)}</text>`;
    }
    const pts = data.map((d, i) => [x(i), y(d.value)]);
    const path = pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(" ");
    const area = `M${pts[0][0]} ${H - padB} ` + pts.map((p) => "L" + p[0] + " " + p[1]).join(" ") + ` L${pts[pts.length - 1][0]} ${H - padB} Z`;
    const dots = pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="#fffaf0" stroke="#0526c5" stroke-width="2"><title>${data[i].label}: ${fmt(data[i].value)}</title></circle>`).join("");
    const labels = data.map((d, i) => (i % Math.ceil(data.length / 8 || 1) === 0 || i === data.length - 1)
      ? `<text x="${x(i)}" y="${H - padB + 15}" text-anchor="middle" font-size="10" fill="#6b6b86">${d.label.slice(5)}</text>` : "").join("");
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
      ${grid}
      <path d="${area}" fill="rgba(5,38,197,0.08)"/>
      <path d="${path}" fill="none" stroke="#0526c5" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}${labels}
    </svg>`;
  },

  // Donut from [{label, value}]
  donut(data, opts = {}) {
    const { size = 200, colors = null, money = true, unit = "" } = opts;
    const colFor = (i) => (colors && colors[i]) ? colors[i] : PALETTE[i % PALETTE.length];
    const fmtVal = (v) => money ? fmtMoney(v) : v.toLocaleString() + (unit ? " " + unit : "");
    const total = data.reduce((a, d) => a + d.value, 0);
    if (!total) return `<div class="t-empty">No data yet</div>`;
    const r = size / 2, cx = r, cy = r, inner = r * 0.58;
    let a0 = -Math.PI / 2;
    const arcs = data.map((d, i) => {
      const frac = d.value / total;
      const a1 = a0 + frac * Math.PI * 2;
      const large = frac > 0.5 ? 1 : 0;
      const p = (ang, rad) => [cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad];
      const [x0, y0] = p(a0, r), [x1, y1] = p(a1, r);
      const [x2, y2] = p(a1, inner), [x3, y3] = p(a0, inner);
      a0 = a1;
      return `<path d="M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${inner} ${inner} 0 ${large} 0 ${x3} ${y3} Z" fill="${colFor(i)}" stroke="#12123a" stroke-width="1.5"><title>${d.label}: ${fmtVal(d.value)}</title></path>`;
    }).join("");
    const legend = data.map((d, i) => `<span><span class="dot" style="background:${colFor(i)}"></span>${d.label} · ${Math.round((d.value / total) * 100)}% <span class="muted">(${fmtVal(d.value)})</span></span>`).join("");
    return `<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">${arcs}</svg>
      <div class="bar-legend" style="flex-direction:column;gap:7px">${legend}</div>
    </div>`;
  },

  colorFor(i) { return PALETTE[i % PALETTE.length]; },
};

window.Charts = Charts;
window.fmtMoney = fmtMoney;
window.fmtMoney2 = fmtMoney2;
