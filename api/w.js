// ============================================================
// Whatcha first-party analytics — Vercel Edge Function  (POST /api/w)
//
// The browser (assets/w.js) beacons pageviews/events here. This runs on
// Vercel's edge, so it sees what the browser can't: the visitor's IP and
// Vercel's geo lookup (country, region, city, postal, lat/lon, timezone).
// It enriches each item, strips anything the client shouldn't be able to set,
// and hands the batch to Supabase's wa_ingest() function.
//
// Optional env vars (Vercel → Project → Settings → Environment Variables):
//   IPINFO_TOKEN   free token from ipinfo.io → adds ISP / company + ASN
//   SUPABASE_URL / SUPABASE_KEY   override the defaults below
// ============================================================

export const config = { runtime: "edge" };

const SUPABASE_URL = (typeof process !== "undefined" && process.env && process.env.SUPABASE_URL) || "https://ivvoyzehxpdqtqmfsoxb.supabase.co";
// Publishable (public) key — it can only call wa_ingest(); it cannot read analytics.
const SUPABASE_KEY = (typeof process !== "undefined" && process.env && process.env.SUPABASE_KEY) || "sb_publishable_-_LLFYYSC5ctBmDL27gtdQ_P9343TDy";
const IPINFO_TOKEN = (typeof process !== "undefined" && process.env && process.env.IPINFO_TOKEN) || "";

const ALLOWED_HOSTS = /(^|\.)whatchadrinking\.com$|\.vercel\.app$|^localhost$|^127\.0\.0\.1$/i;

// Fields the browser is allowed to send. Everything server-derived (ip, geo,
// ua parsing, org) is set here and can't be spoofed through the payload.
const CLIENT_FIELDS = [
  "k", "id", "name", "pv_id", "vid", "sid", "visit_num", "is_landing", "host", "path", "query", "title",
  "referrer", "ref_domain", "s_referrer", "s_ref_domain", "s_landing",
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "click_id_type", "click_id",
  "lang", "languages", "screen", "viewport", "dpr", "tz", "connection", "color_scheme",
  "engaged_ms", "scroll_pct", "props", "is_bot", "email", "source",
];

const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|meta-externalagent|embedly|quora link|outbrain|pinterest|vkshare|w3c_validator|whatsapp|telegrambot|discordbot|slackbot|twitterbot|linkedinbot|skypeuripreview|applebot|bingpreview|headless|phantom|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|python-requests|curl\/|wget|go-http|okhttp|axios|node-fetch|httpclient|scrapy|ahrefs|semrush|mj12|dotbot|petalbot|bytespider|gptbot|chatgpt-user|oai-searchbot|claudebot|claude-web|anthropic-ai|perplexity|ccbot|amazonbot|yandex|baiduspider|duckduckbot|sogou|exabot|seznam/i;

function clip(v, n) {
  if (v == null) return null;
  const s = String(v);
  return s.length > n ? s.slice(0, n) : s;
}

function hdr(req, name) {
  const v = req.headers.get(name);
  if (!v) return null;
  try { return decodeURIComponent(v); } catch (e) { return v; }
}

function parseUA(ua) {
  ua = ua || "";
  const out = { browser: "Other", browser_version: null, os: "Other", os_version: null, device: "desktop" };
  let m;
  // Browser (order matters — most specific first)
  if ((m = ua.match(/Instagram[ /]([\d.]+)/))) { out.browser = "Instagram (in-app)"; out.browser_version = m[1]; }
  else if (/FBAN|FBAV|FB_IAB/.test(ua)) { out.browser = "Facebook (in-app)"; m = ua.match(/FBAV\/([\d.]+)/); out.browser_version = m && m[1]; }
  else if ((m = ua.match(/(?:musical_ly|TikTok|BytedanceWebview)[ _/]?([\d.]+)?/i))) { out.browser = "TikTok (in-app)"; out.browser_version = m[1] || null; }
  else if ((m = ua.match(/Snapchat\/([\d.]+)/))) { out.browser = "Snapchat (in-app)"; out.browser_version = m[1]; }
  else if ((m = ua.match(/LinkedInApp\/([\d.]+)?/))) { out.browser = "LinkedIn (in-app)"; out.browser_version = m[1] || null; }
  else if (/\bGSA\//.test(ua)) { out.browser = "Google App"; m = ua.match(/GSA\/([\d.]+)/); out.browser_version = m && m[1]; }
  else if ((m = ua.match(/Edg(?:A|iOS)?\/([\d.]+)/))) { out.browser = "Edge"; out.browser_version = m[1]; }
  else if ((m = ua.match(/(?:OPR|Opera)\/([\d.]+)/))) { out.browser = "Opera"; out.browser_version = m[1]; }
  else if ((m = ua.match(/SamsungBrowser\/([\d.]+)/))) { out.browser = "Samsung Internet"; out.browser_version = m[1]; }
  else if ((m = ua.match(/DuckDuckGo\/([\d.]+)/))) { out.browser = "DuckDuckGo"; out.browser_version = m[1]; }
  else if ((m = ua.match(/(?:Firefox|FxiOS)\/([\d.]+)/))) { out.browser = "Firefox"; out.browser_version = m[1]; }
  else if ((m = ua.match(/(?:Chrome|CriOS)\/([\d.]+)/))) { out.browser = "Chrome"; out.browser_version = m[1]; }
  else if (/Safari\//.test(ua) && (m = ua.match(/Version\/([\d.]+)/))) { out.browser = "Safari"; out.browser_version = m[1]; }
  else if (/AppleWebKit/.test(ua) && /iPhone|iPad|iPod/.test(ua)) { out.browser = "iOS WebView"; }

  // OS
  if ((m = ua.match(/(?:iPhone|iPod).*?OS (\d+[_\d]*)/))) { out.os = "iOS"; out.os_version = m[1].replace(/_/g, "."); }
  else if ((m = ua.match(/iPad.*?OS (\d+[_\d]*)/))) { out.os = "iPadOS"; out.os_version = m[1].replace(/_/g, "."); }
  else if ((m = ua.match(/Android (\d+(?:\.\d+)*)/))) { out.os = "Android"; out.os_version = m[1]; }
  else if ((m = ua.match(/Mac OS X (\d+[_.\d]*)/))) { out.os = "macOS"; out.os_version = m[1].replace(/_/g, "."); }
  else if ((m = ua.match(/Windows NT (\d+\.\d+)/))) { out.os = "Windows"; out.os_version = ({ "10.0": "10/11", "6.3": "8.1", "6.2": "8", "6.1": "7" })[m[1]] || m[1]; }
  else if (/CrOS/.test(ua)) out.os = "ChromeOS";
  else if (/Linux/.test(ua)) out.os = "Linux";

  // Device
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) out.device = "tablet";
  else if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) out.device = "mobile";
  return out;
}

async function lookupOrg(ip) {
  if (!IPINFO_TOKEN || !ip) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 900);
    const r = await fetch(`https://api.ipinfo.io/lite/${encodeURIComponent(ip)}?token=${IPINFO_TOKEN}`, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    return { org: j.as_name || null, asn: j.asn || null };
  } catch (e) { return null; }
}

function empty(status = 204) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return empty(204);
  if (req.method !== "POST") return new Response("ok", { status: 200, headers: { "Cache-Control": "no-store" } });

  // Only accept beacons from our own pages.
  const src = req.headers.get("origin") || req.headers.get("referer") || "";
  let srcHost = "";
  try { srcHost = new URL(src).hostname; } catch (e) {}
  if (!ALLOWED_HOSTS.test(srcHost)) return empty(204);

  let body;
  try { body = JSON.parse(await req.text()); } catch (e) { return empty(204); }
  const raw = Array.isArray(body) ? body : (body && Array.isArray(body.items) ? body.items : []);
  if (!raw.length) return empty(204);

  const ua = req.headers.get("user-agent") || "";
  const uaInfo = parseUA(ua);
  const ip = (req.headers.get("x-real-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0] || "").trim() || null;
  const vercelId = req.headers.get("x-vercel-id") || "";
  const lat = parseFloat(req.headers.get("x-vercel-ip-latitude"));
  const lon = parseFloat(req.headers.get("x-vercel-ip-longitude"));

  const server = {
    ip,
    country: hdr(req, "x-vercel-ip-country"),
    region: hdr(req, "x-vercel-ip-country-region"),
    city: hdr(req, "x-vercel-ip-city"),
    postal: hdr(req, "x-vercel-ip-postal-code"),
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    timezone: hdr(req, "x-vercel-ip-timezone"),
    continent: hdr(req, "x-vercel-ip-continent"),
    edge_region: vercelId.split("::")[0] || null,
    ua: clip(ua, 500),
    browser: uaInfo.browser,
    browser_version: uaInfo.browser_version,
    os: uaInfo.os,
    os_version: uaInfo.os_version,
    device: uaInfo.device,
  };
  const uaIsBot = BOT_RE.test(ua) || !ua;

  // ISP / company lookup only once per session (on the landing pageview).
  const needsOrg = raw.some((it) => it && it.k === "pageview" && it.is_landing);
  const orgInfo = needsOrg ? await lookupOrg(ip) : null;

  const items = [];
  for (const it of raw.slice(0, 40)) {
    if (!it || typeof it !== "object") continue;
    const clean = {};
    for (const f of CLIENT_FIELDS) if (it[f] !== undefined) clean[f] = it[f];
    for (const f of Object.keys(clean)) if (typeof clean[f] === "string") clean[f] = clip(clean[f], f === "referrer" || f === "s_referrer" || f === "query" ? 1000 : 300);
    if (clean.props && (typeof clean.props !== "object" || JSON.stringify(clean.props).length > 4000)) clean.props = {};

    if (clean.k === "pageview" || clean.k === "event") {
      Object.assign(clean, server);
      clean.is_bot = uaIsBot || clean.is_bot === true;
      if (orgInfo) { clean.org = orgInfo.org; clean.asn = orgInfo.asn; }
    }
    items.push(clean);
  }

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/wa_ingest`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
  } catch (e) { /* never surface errors to the page */ }

  return empty(204);
}
