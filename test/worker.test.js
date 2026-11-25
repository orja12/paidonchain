import test from "node:test";
import assert from "node:assert/strict";
import W, { TREASURY, FREE_PER_MONTH } from "../worker/index.js";
import { DOCS } from "../worker/site.js";
import { CHAINS, TRANSFER_TOPIC } from "../src/index.js";

const pad = a => "0x" + a.toLowerCase().slice(2).padStart(64, "0");
const amt = n => "0x" + BigInt(n).toString(16).padStart(64, "0");
const SELLER = "0x2222222222222222222222222222222222222222";
const receipts = {};
const rc = (to, units) => ({ status: "0x1", blockNumber: "0x64", logs: [{ address: CHAINS.base.usdc, topics: [TRANSFER_TOPIC, pad("0x1111111111111111111111111111111111111111"), pad(to)], data: amt(units) }] });
receipts["0x" + "aa".repeat(32)] = rc(SELLER, 19e6);          // a customer's sale
receipts["0x" + "bb".repeat(32)] = rc(TREASURY, 10e6);        // credit purchase 10 USDC
receipts["0x" + "cc".repeat(32)] = rc(TREASURY, 1e6);         // too small purchase
let rpcDown = false;
globalThis.fetch = async (_u, o) => { if (rpcDown) return new Response("x", { status: 503 }); const b = JSON.parse(o.body); return new Response(JSON.stringify({ result: b.method === "eth_blockNumber" ? "0x70" : receipts[b.params[0]] ?? null })); };
const store = new Map(); const env = { KV: { get: async k => store.get(k) ?? null, put: async (k, v) => store.set(k, v) } };
const call = async (method, path, { body, key, ip = "1.2.3.4" } = {}) => {
  const h = { "content-type": "application/json", "cf-connecting-ip": ip }; if (key) h.authorization = "Bearer " + key;
  const r = await W.fetch(new Request("https://x" + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env);
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return [r.status, j];
};
const verifyBody = { chain: "base", tx: "0x" + "aa".repeat(32), to: SELLER, min_amount: "19" };

test("full billing lifecycle", async () => {
  const [s1, k] = await call("POST", "/v1/keys"); assert.equal(s1, 200); const key = k.api_key; assert.match(key, /^poc_[0-9a-f]{48}$/);
  assert.equal((await call("POST", "/v1/verify", { body: verifyBody }))[0], 401);          // no key
  const [s2, v] = await call("POST", "/v1/verify", { body: verifyBody, key }); assert.equal(s2, 200); assert.equal(v.ok, true); assert.equal(v.billed, "free"); assert.equal(v.usage.free_used, 1);
  // bad input not billed
  const [s3, bad] = await call("POST", "/v1/verify", { body: { ...verifyBody, tx: "0x12" }, key }); assert.equal(s3, 400); assert.match(bad.error, /not billed/);
  rpcDown = true; assert.equal((await call("POST", "/v1/verify", { body: verifyBody, key }))[0], 502); rpcDown = false;
  assert.equal((await call("GET", "/v1/usage", { key }))[1].free_used, 1);
  // exhaust free tier
  const acctKey = [...store.keys()].find(x => x.includes("acct:")); const a = JSON.parse(store.get(acctKey)); a.freeUsed = FREE_PER_MONTH; store.set(acctKey, JSON.stringify(a));
  const [s4, q] = await call("POST", "/v1/verify", { body: verifyBody, key }); assert.equal(s4, 402); assert.equal(q.code, "QUOTA_EXCEEDED");
  // too-small purchase rejected
  const [s5, small] = await call("POST", "/v1/credits", { body: { chain: "base", tx: "0x" + "cc".repeat(32) }, key }); assert.equal(s5, 402); assert.equal(small.code, "UNDERPAID");
  // purchase 10 USDC -> 10,000 credits
  const [s6, buy] = await call("POST", "/v1/credits", { body: { chain: "base", tx: "0x" + "bb".repeat(32) }, key }); assert.equal(s6, 200); assert.equal(buy.credits_added, 10000);
  // reuse blocked
  assert.equal((await call("POST", "/v1/credits", { body: { chain: "base", tx: "0x" + "bb".repeat(32) }, key }))[0], 409);
  // now billed from credits
  const [s7, v2] = await call("POST", "/v1/verify", { body: verifyBody, key }); assert.equal(s7, 200); assert.equal(v2.billed, "credit"); assert.equal(v2.usage.credits, 9999);
  // using a customer's sale tx (to SELLER) for credits fails
  const [s8, wrong] = await call("POST", "/v1/credits", { body: { chain: "base", tx: "0x" + "aa".repeat(32) }, key }); assert.equal(s8, 402); assert.equal(wrong.code, "NO_TRANSFER");
});
test("key creation rate limit per IP", async () => {
  for (let i = 0; i < 3; i++) assert.equal((await call("POST", "/v1/keys", { ip: "9.9.9.9" }))[0], 200);
  assert.equal((await call("POST", "/v1/keys", { ip: "9.9.9.9" }))[0], 429);
});
test("site pages render", async () => {
  const [s, home] = await call("GET", "/"); assert.equal(s, 200); assert.match(home, /Verify USDC payments/);
  for (const d of DOCS) { const [sd, p] = await call("GET", "/docs/" + d.slug); assert.equal(sd, 200, d.slug); assert.ok(p.includes("<h1"), d.slug); assert.ok(!p.includes("```"), d.slug + " unrendered fence"); }
  assert.equal((await call("GET", "/docs/nope"))[0], 404);
  const [ss, sm] = await call("GET", "/sitemap.xml"); assert.equal(ss, 200); assert.equal((sm.match(/<loc>/g) || []).length, DOCS.length + 1);
});
