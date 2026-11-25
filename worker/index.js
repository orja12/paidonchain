// PaidOnChain hosted API + docs site (Cloudflare Worker). Billing runs on PaidOnChain itself.
import { verifyPayment, paymentURI, PaidOnChainError, CHAINS } from "../src/index.js";
import { renderDocsPage, renderHome, DOCS } from "./site.js";

export const TREASURY = "0xB1a65c3a55Cb23B230b3e11C1Ea08504a3099c8e"; // receives credit purchases
export const FREE_PER_MONTH = 100;
export const CHECKS_PER_USDC = 1000;     // 0.001 USDC per check
export const MIN_PURCHASE_USDC = "5";
const KEYS_PER_IP_PER_DAY = 3;
const P = "poc:"; // KV key prefix
// Public IndexNow ownership key (not a secret: search engines fetch it from /<key>.txt)
const INDEXNOW_KEY = "782ff3c97f920dcafa173369221aed48";

const json = (o, s = 200) => new Response(JSON.stringify(o, null, 2), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" } });
const err = (code, message, s) => json({ ok: false, code, error: message }, s);
const month = () => new Date().toISOString().slice(0, 7);
const day = () => new Date().toISOString().slice(0, 10);

async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function newKey() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return "poc_" + [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function getAccount(env, req) {
  const m = (req.headers.get("authorization") || "").match(/^Bearer\s+(poc_[0-9a-f]{48})$/);
  if (!m) return null;
  const id = await sha256(m[1]);
  const raw = await env.KV.get(P + "acct:" + id);
  return raw ? { id, ...JSON.parse(raw) } : null;
}
const saveAccount = (env, a) => { const { id, ...rest } = a; return env.KV.put(P + "acct:" + id, JSON.stringify(rest)); };

// Spend one check: monthly free allowance first, then prepaid credits.
export function consume(acct) {
  const m = month();
  if (acct.month !== m) { acct.month = m; acct.freeUsed = 0; }
  if (acct.freeUsed < FREE_PER_MONTH) { acct.freeUsed++; return "free"; }
  if (acct.credits > 0) { acct.credits--; return "credit"; }
  return null;
}
const usage = a => ({ month: a.month, free_used: a.freeUsed, free_limit: FREE_PER_MONTH, credits: a.credits, total_verifications: a.total || 0 });

async function body(req) { try { return await req.json(); } catch { return null; } }

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname;
    if (req.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST" } });

    // ---- site ----
    if (req.method === "GET" && path === "/") return html(renderHome({ TREASURY, FREE_PER_MONTH, CHECKS_PER_USDC, MIN_PURCHASE_USDC }));
    if (req.method === "GET" && path.startsWith("/docs/")) {
      const page = renderDocsPage(path.slice(6).replace(/\/$/, ""));
      return page ? html(page) : html(renderDocsPage("404") || "Not found", 404);
    }
    if (req.method === "GET" && path === "/sitemap.xml") {
      const u = [url.origin + "/", ...DOCS.map(d => `${url.origin}/docs/${d.slug}`)];
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${u.map(x => `<url><loc>${x}</loc></url>`).join("")}</urlset>`, { headers: { "content-type": "application/xml" } });
    }
    if (req.method === "GET" && path === "/" + INDEXNOW_KEY + ".txt") return new Response(INDEXNOW_KEY, { headers: { "content-type": "text/plain" } });
    if (req.method === "GET" && path === "/robots.txt") return new Response(`User-agent: *\nAllow: /\nSitemap: ${url.origin}/sitemap.xml\n`);

    // ---- API ----
    if (req.method === "GET" && path === "/v1/health") return json({ ok: true, chains: Object.keys(CHAINS), treasury: TREASURY });

    if (req.method === "POST" && path === "/v1/keys") {
      const ip = req.headers.get("cf-connecting-ip") || "unknown";
      const ipKey = P + "ip:" + day() + ":" + await sha256(ip);
      const n = Number(await env.KV.get(ipKey) || 0);
      if (n >= KEYS_PER_IP_PER_DAY) return err("RATE_LIMITED", "Too many keys created from this network today.", 429);
      const key = newKey(), id = await sha256(key);
      await env.KV.put(P + "acct:" + id, JSON.stringify({ created: Date.now(), month: month(), freeUsed: 0, credits: 0, total: 0 }));
      await env.KV.put(ipKey, String(n + 1), { expirationTtl: 172800 });
      return json({ ok: true, api_key: key, note: "Store this key now. It cannot be shown again.", free_per_month: FREE_PER_MONTH });
    }

    if (path.startsWith("/v1/")) {
      const acct = await getAccount(env, req);
      if (!acct) return err("UNAUTHORIZED", "Missing or invalid API key. Create one with POST /v1/keys.", 401);

      if (req.method === "GET" && path === "/v1/usage") { consumeMonthRollover(acct); return json({ ok: true, ...usage(acct) }); }

      if (req.method === "POST" && path === "/v1/verify") {
        const b = await body(req);
        if (!b) return err("BAD_REQUEST", "JSON body required", 400);
        const spent = consume(acct);
        if (!spent) return err("QUOTA_EXCEEDED", `Free allowance used up. Buy credits: send >= ${MIN_PURCHASE_USDC} USDC to ${TREASURY} and POST /v1/credits.`, 402);
        try {
          const r = await verifyPayment({ chain: b.chain, tx: b.tx, to: b.to, minAmount: b.min_amount ?? b.minAmount, minConfirmations: Math.min(Math.max(Number(b.min_confirmations ?? 3), 1), 64) });
          acct.total = (acct.total || 0) + 1; await saveAccount(env, acct);
          return json({ ...r, billed: spent, usage: usage(acct) });
        } catch (e) {
          refund(acct, spent); await saveAccount(env, acct);   // inputs/RPC errors are not billed
          if (e instanceof PaidOnChainError && e.code.startsWith("RPC")) return err(e.code, "Upstream RPC failed; not billed. Retry.", 502);
          if (e instanceof PaidOnChainError) return err(e.code, e.message + " (not billed)", 400);
          return err("INTERNAL", "Unexpected error; not billed.", 500);
        }
      }

      if (req.method === "POST" && path === "/v1/credits") {
        const b = await body(req);
        if (!b) return err("BAD_REQUEST", "JSON body required", 400);
        const chain = String(b.chain || "base"), tx = String(b.tx || "").toLowerCase();
        const lock = P + "credit-tx:" + chain + ":" + tx;
        if (await env.KV.get(lock)) return err("TX_USED", "This transaction was already redeemed for credits.", 409);
        let r;
        try { r = await verifyPayment({ chain, tx, to: TREASURY, minAmount: MIN_PURCHASE_USDC }); }
        catch (e) { return err(e.code || "INTERNAL", e.message, e.code?.startsWith("RPC") ? 502 : 400); }
        if (!r.ok) return json({ ...r, hint: r.code === "UNDERPAID" ? `Minimum purchase is ${MIN_PURCHASE_USDC} USDC.` : undefined }, 402);
        const add = Math.floor(Number(r.paid) * CHECKS_PER_USDC);
        await env.KV.put(lock, JSON.stringify({ acct: acct.id, paid: r.paid, at: Date.now() }));
        acct.credits = (acct.credits || 0) + add; await saveAccount(env, acct);
        return json({ ok: true, paid_usdc: r.paid, credits_added: add, usage: usage(acct) });
      }

      if (req.method === "GET" && path === "/v1/payment-uri") {
        try { return json({ ok: true, uri: paymentURI({ chain: url.searchParams.get("chain") || "base", to: url.searchParams.get("to"), amount: url.searchParams.get("amount") || undefined }) }); }
        catch (e) { return err(e.code || "BAD_REQUEST", e.message, 400); }
      }
    }
    return err("NOT_FOUND", "No such route. See /docs/quickstart", 404);
  },
};
function consumeMonthRollover(a) { const m = month(); if (a.month !== m) { a.month = m; a.freeUsed = 0; } }
function refund(a, spent) { if (spent === "free") a.freeUsed--; else if (spent === "credit") a.credits++; }
function html(s, status = 200) { return new Response(s, { status, headers: { "content-type": "text/html;charset=utf-8" } }); }
