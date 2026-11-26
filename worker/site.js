// Docs + landing page. Markdown-lite renderer (headings, paragraphs, lists, code, links, inline code, bold).
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function inline(s) {
  return esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, h) => `<a href="${h}">${t}</a>`);
}
export function md(src) {
  const out = [], lines = src.trim().split("\n"); let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith("```")) { const lang = l.slice(3).trim(); const buf = []; i++; while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]); i++; out.push(`<pre data-lang="${esc(lang)}"><button class="cp" type="button">Copy</button><code>${esc(buf.join("\n"))}</code></pre>`); continue; }
    if (/^#{1,3} /.test(l)) { const n = l.match(/^#+/)[0].length; const t = l.slice(n + 1); const id = t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); out.push(`<h${n} id="${id}">${inline(t)}</h${n}>`); i++; continue; }
    if (/^(- |\d+\. )/.test(l)) { const ord = /^\d+\. /.test(l); const items = []; while (i < lines.length && /^(- |\d+\. )/.test(lines[i])) items.push(lines[i++].replace(/^(- |\d+\. )/, "")); out.push(`<${ord ? "ol" : "ul"}>${items.map(x => `<li>${inline(x)}</li>`).join("")}</${ord ? "ol" : "ul"}>`); continue; }
    if (!l.trim()) { i++; continue; }
    const buf = []; while (i < lines.length && lines[i].trim() && !/^(#{1,3} |- |\d+\. |```)/.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

const API = "https://paidonchain.alrudaini-omar.workers.dev";
export const DOCS = [
{ slug: "quickstart", title: "Quickstart: verify a USDC payment in one call", desc: "Verify USDC payments on Base and Arbitrum with the free open-source library or the hosted API. No Stripe, no custody.", body: `
# Quickstart

PaidOnChain answers one question reliably: **did this transaction really pay this address at least this much USDC?** Use the free MIT library, or the hosted API if you don't want to manage RPCs.

## Option A: the library (free forever)

\`\`\`bash
npm install paidonchain
\`\`\`

\`\`\`js
import { verifyPayment } from "paidonchain";

const r = await verifyPayment({
  chain: "base",                       // or "arbitrum"
  tx: "0x…",                           // the buyer's transaction hash
  to: "0xYourAddress",
  minAmount: "19",                     // USDC
});
if (r.ok) unlockOrder();               // r.paid, r.from, r.confirmations
else console.log(r.code, r.reason);    // NOT_FOUND, PENDING, UNDERPAID, NO_TRANSFER, FAILED_TX
\`\`\`

It runs in Node 18+, Cloudflare Workers, Deno and Bun, with zero dependencies.

## Option B: the hosted API

\`\`\`bash
# 1. get a key (100 free verifications every month)
curl -X POST ${API}/v1/keys

# 2. verify
curl -X POST ${API}/v1/verify \\
  -H "authorization: Bearer poc_…" -H "content-type: application/json" \\
  -d '{"chain":"base","tx":"0x…","to":"0xYourAddress","min_amount":"19"}'
\`\`\`

The response is the same object as the library returns, plus \`billed\` and \`usage\`. Bad input and upstream RPC failures are **never billed**.

## What gets checked

1. The transaction succeeded (status 1).
2. It has enough confirmations (default 3).
3. The \`Transfer\` events come from the **real USDC contract**. Fake tokens named "USDC" are ignored.
4. The recipient topic equals your address, and the transfers to you sum to at least \`minAmount\`.

Your own code still decides **which order** a payment belongs to, and must refuse to accept the same tx twice. See [Accept USDC in Next.js](/docs/accept-usdc-nextjs-base) for the full pattern.
`},
{ slug: "accept-usdc-nextjs-base", title: "Accept USDC payments in Next.js on Base (no Stripe)", desc: "Step-by-step: accept USDC on Base in a Next.js app, verify the payment server-side and prevent replay. No KYC payment processor needed.", body: `
# Accept USDC payments in Next.js on Base

This is the pattern: show the buyer your address and price, they pay from any wallet, they paste (or your frontend submits) the tx hash, and a **server route** verifies it before fulfilling the order.

## 1. Install

\`\`\`bash
npm install paidonchain
\`\`\`

## 2. Server route: app/api/claim/route.js

\`\`\`js
import { verifyPayment } from "paidonchain";
import { db } from "@/lib/db"; // your database

const PAY_TO = process.env.PAY_TO; // your receiving address

export async function POST(req) {
  const { orderId, tx } = await req.json();
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order || order.paid) return Response.json({ error: "invalid order" }, { status: 400 });

  // replay protection: one tx can only ever pay one order
  if (await db.order.findFirst({ where: { txHash: tx.toLowerCase() } }))
    return Response.json({ error: "tx already used" }, { status: 409 });

  const r = await verifyPayment({ chain: "base", tx, to: PAY_TO, minAmount: order.priceUsdc });
  if (!r.ok) return Response.json(r, { status: r.code === "PENDING" ? 202 : 402 });

  await db.order.update({ where: { id: orderId }, data: { paid: true, txHash: tx.toLowerCase(), payer: r.from } });
  return Response.json({ ok: true });
}
\`\`\`

## 3. Payment link / QR for the buyer

\`\`\`js
import { paymentURI } from "paidonchain";
const uri = paymentURI({ chain: "base", to: PAY_TO, amount: order.priceUsdc });
// render as a QR code; MetaMask, Coinbase Wallet and Rainbow open it directly
\`\`\`

## Gotchas

- **Unique amounts help matching.** If many buyers pay the same price, ask for the tx hash, or charge e.g. 19.0037 so each order's amount is unique.
- **PENDING isn't failure.** Base blocks are fast. Retry after a few seconds.
- **Never trust the client.** The verify call must run server-side.
- Need more than a few hundred checks a day without running RPC infrastructure? Use the [hosted API](/docs/quickstart).
`},
{ slug: "telegram-bot-usdc-payments", title: "Telegram bot USDC payments: verify on-chain, deliver automatically", desc: "Sell access or files from a Telegram bot for USDC on Base or Arbitrum. Verify the tx on-chain and deliver automatically.", body: `
# Telegram bot USDC payments

Telegram sellers often can't use Stripe. Here's a minimal flow where the bot quotes a price, the user pays USDC and sends the tx hash, and the bot verifies it and delivers.

## Flow

1. User sends \`/buy\`. The bot replies with your address, the price and a payment link from \`paymentURI()\`.
2. User pays from their wallet and sends the tx hash to the bot.
3. The bot calls \`verifyPayment()\`. On success it sends the invite link or file and records the tx so it can't be reused.

## Code (grammY, Node)

\`\`\`js
import { Bot } from "grammy";
import { verifyPayment, paymentURI } from "paidonchain";

const bot = new Bot(process.env.BOT_TOKEN);
const PAY_TO = process.env.PAY_TO, PRICE = "10";
const used = new Set(); // use a real database in production

bot.command("buy", ctx => ctx.reply(
  \`Send \${PRICE} USDC on Base to:\\n\${PAY_TO}\\n\\nWallet link: \${paymentURI({ to: PAY_TO, amount: PRICE })}\\n\\nThen paste your transaction hash here.\`));

bot.hears(/^0x[0-9a-fA-F]{64}$/, async ctx => {
  const tx = ctx.message.text.toLowerCase();
  if (used.has(tx)) return ctx.reply("That transaction was already used.");
  const r = await verifyPayment({ chain: "base", tx, to: PAY_TO, minAmount: PRICE });
  if (r.code === "PENDING") return ctx.reply("Almost there. Send the hash again in ~10 seconds.");
  if (!r.ok) return ctx.reply("Payment not verified: " + r.reason);
  used.add(tx);
  await ctx.reply("Paid ✓ Here's your access: " + process.env.INVITE_LINK);
});

bot.start();
\`\`\`

## Notes

- Persist \`used\` in a database. An in-memory Set is lost on restart.
- Generate a **single-use** invite link per buyer if you're selling group access.
- Running many bots? The [hosted API](/docs/quickstart) saves you running RPC infrastructure.
`},
{ slug: "cloudflare-workers-usdc-paywall", title: "Build a USDC paywall on Cloudflare Workers (free tier)", desc: "Sell digital downloads for USDC on Cloudflare Workers: server-side on-chain verification, KV replay protection, expiring download tokens.", body: `
# USDC paywall on Cloudflare Workers

A Worker plus one KV namespace is enough to sell a file for USDC, all on the free tier.

## The Worker

\`\`\`js
import { verifyPayment } from "paidonchain";
const PAY_TO = "0xYourAddress", PRICE = "19";

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/claim") {
      const { chain = "base", tx } = await req.json();
      const lock = \`tx:\${chain}:\${String(tx).toLowerCase()}\`;
      if (await env.SALES.get(lock)) return Response.json({ error: "tx already used" }, { status: 409 });
      const r = await verifyPayment({ chain, tx, to: PAY_TO, minAmount: PRICE });
      if (!r.ok) return Response.json(r, { status: 402 });
      const token = crypto.randomUUID();
      await env.SALES.put(lock, "1");
      await env.SALES.put("tok:" + token, "1", { expirationTtl: 7 * 86400 });
      return Response.json({ download: "/download/" + token });
    }
    const m = url.pathname.match(/^\\/download\\/([\\w-]+)$/);
    if (m && await env.SALES.get("tok:" + m[1])) return env.ASSETS.fetch(new Request(url.origin + "/product.zip"));
    return new Response("Not found", { status: 404 });
  },
};
\`\`\`

## Why server-side matters

A static page that "checks" payments in the browser can be bypassed in seconds. Here the file is only served after the Worker has read the receipt from the chain itself.

## Known limits

- KV is eventually consistent: two claims of the same tx in the same instant from different regions could both pass. Use a Durable Object if you need strict once-only.
- Some free public RPCs block Worker traffic (we hit this with a Polygon RPC). Base and Arbitrum's official RPCs work.

Want a ready-made version with a sales page? See the [No-Bank Checkout Kit](https://nobank-checkout.alrudaini-omar.workers.dev/).
`},
{ slug: "how-to-verify-usdc-payment", title: "How to verify a USDC payment on-chain (and the fake-token trap)", desc: "How USDC payment verification works: transaction receipts, Transfer event logs, confirmations, and why you must check the token contract address.", body: `
# How to verify a USDC payment on-chain

Showing a wallet address and trusting a screenshot isn't verification. Here is what a correct check looks like, and the mistake most DIY checkers make.

## 1. Fetch the receipt

\`eth_getTransactionReceipt(txHash)\` on the right chain. No receipt means the tx isn't mined yet (or it's on another chain).

## 2. Require success

\`receipt.status === "0x1"\`. Reverted transactions still have receipts.

## 3. Require confirmations

\`head - receipt.blockNumber + 1 >= N\`. On Base and Arbitrum, 3 is a sensible default for digital goods.

## 4. Read the Transfer logs, from the right contract

An ERC-20 transfer emits \`Transfer(from, to, value)\` with topic0 = \`0xddf252ad…b3ef\`. For each log:

- **log.address must equal the real USDC contract** on that chain (Base: \`0x8335…2913\`, Arbitrum: \`0xaf88…5831\`).
- topics[2] is the recipient (left-padded to 32 bytes).
- data is the amount (6 decimals for USDC).

## The fake-token trap

Anyone can deploy a token named "USDC" and emit a perfectly valid-looking \`Transfer\` to your address for any amount. If your checker only looks at the event signature and recipient, **it accepts worthless tokens**. Always compare \`log.address\` with the canonical contract.

## 5. Sum, then compare

One tx can contain several transfers (e.g. through a router). Sum the ones to your address, then compare with the price.

## Or skip all of this

\`\`\`js
import { verifyPayment } from "paidonchain";
await verifyPayment({ chain: "base", tx, to: PAY_TO, minAmount: "19" });
\`\`\`

The library is open source (MIT) and has a test suite covering these cases, including the fake-token attack. [Quickstart →](/docs/quickstart)
`},
];

const CSS = `:root{color-scheme:light dark;--bg:light-dark(#fbfbf8,#0e1111);--ink:light-dark(#14181a,#e9eeec);--mut:light-dark(#5b6669,#93a19d);--line:light-dark(#e3e6e2,#253032);--acc:light-dark(#0b7a53,#3fd69a);--card:light-dark(#fff,#151b1c);--code:light-dark(#f2f4f1,#111617)}
:root[data-theme=light]{color-scheme:light}:root[data-theme=dark]{color-scheme:dark}
*{box-sizing:border-box;min-width:0}body{margin:0;background:var(--bg);color:var(--ink);font:16.5px/1.65 "Inter",system-ui,-apple-system,Segoe UI,sans-serif;overflow-x:clip}
a{color:var(--acc)}header{display:flex;gap:18px;align-items:center;flex-wrap:wrap;padding:16px max(5vw,16px);border-bottom:1px solid var(--line)}header b{font-size:18px;color:var(--ink)}header nav{display:flex;gap:16px;flex-wrap:wrap;font-size:15px}header a{text-decoration:none}
main{max-width:820px;margin:0 auto;padding:36px max(4vw,16px) 80px}h1{font-size:clamp(30px,5vw,44px);line-height:1.08;text-wrap:balance;margin:.2em 0 .5em}h2{margin-top:2em;font-size:24px}h3{font-size:19px}
pre{position:relative;background:var(--code);border:1px solid var(--line);border-radius:10px;padding:16px;overflow-x:auto;font:13.5px/1.55 ui-monospace,Consolas,monospace}code{font-family:ui-monospace,Consolas,monospace;font-size:.92em;overflow-wrap:anywhere}p code,li code{background:var(--code);padding:1px 5px;border-radius:4px}
.cp{position:absolute;top:8px;right:8px;font:12px system-ui;padding:4px 10px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer;min-height:30px}
footer{border-top:1px solid var(--line);padding:24px max(5vw,16px);color:var(--mut);font-size:14px}.mut{color:var(--mut)}
.hero{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:32px;align-items:center}@media(max-width:760px){.hero{grid-template-columns:1fr}}
.tiers{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:18px 0}.tier{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px}.tier .p{font-size:28px;font-weight:800}
.docs{display:grid;gap:10px;padding:0;list-style:none}.docs a{display:block;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px;text-decoration:none;color:var(--ink)}.docs a span{display:block;color:var(--mut);font-size:14px}`;
const COPYJS = `<script>{document.querySelectorAll('.cp').forEach(b=>b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(b.nextElementSibling.textContent);b.textContent='Copied';setTimeout(()=>b.textContent='Copy',1200)}catch(e){b.textContent='Select & copy'}}))}</script>`;

function layout({ title, desc, content, path }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · PaidOnChain</title><meta name="google-site-verification" content="If7w0aQpztlZIafLmAhRgHqRGwtSgjyGRg53bMRwB5o"><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${API}${path}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<style>${CSS}</style></head><body>
<header><b>PaidOnChain</b><nav><a href="/">Home</a><a href="/docs/quickstart">Quickstart</a><a href="/docs/how-to-verify-usdc-payment">How it works</a><a href="https://github.com/orja12/paidonchain">GitHub</a></nav></header>
<main>${content}</main>
<footer>PaidOnChain verifies payments; it never holds funds. Open source (MIT). Built and run by an AI (Claude) as part of a documented experiment. Not financial or legal advice.</footer>${COPYJS}</body></html>`;
}

export function renderDocsPage(slug) {
  const d = DOCS.find(x => x.slug === slug);
  if (!d) return slug === "404" ? layout({ title: "Page not found", desc: "", path: "/", content: `<h1>Page not found</h1><p><a href="/docs/quickstart">Go to the quickstart →</a></p>` }) : null;
  const others = DOCS.filter(x => x !== d).map(x => `<li><a href="/docs/${x.slug}">${esc(x.title)}</a></li>`).join("");
  return layout({ title: d.title, desc: d.desc, path: "/docs/" + d.slug, content: md(d.body) + `<h2>More guides</h2><ul>${others}</ul>` });
}

export function renderHome({ TREASURY, FREE_PER_MONTH, CHECKS_PER_USDC, MIN_PURCHASE_USDC }) {
  const content = `<div class="hero"><div><h1>Verify USDC payments on-chain in one call.</h1>
<p class="mut">An open-source library and hosted API that checks a transaction really paid your address. It reads the real USDC contract, counts confirmations and sums the transfers. No Stripe, no KYC processor, no custody: buyers pay you directly.</p>
<p><a href="/docs/quickstart"><b>Quickstart →</b></a> · <a href="https://github.com/orja12/paidonchain">GitHub (MIT)</a></p></div>
${md("```js\nimport { verifyPayment } from \"paidonchain\";\n\nconst r = await verifyPayment({\n  chain: \"base\",\n  tx: \"0x…\",\n  to: \"0xYourAddress\",\n  minAmount: \"19\",\n});\n// { ok: true, paid: \"19\", from: \"0x…\", confirmations: 7 }\n```")}</div>
<h2>Pricing</h2><div class="tiers">
<div class="tier"><div class="p">Free</div><p>The MIT library, forever. Self-host on Node, Workers, Deno or Bun.</p></div>
<div class="tier"><div class="p">${FREE_PER_MONTH}/mo free</div><p>Hosted API: <code>POST /v1/keys</code> for a key, no signup form. Errors and RPC failures are never billed.</p></div>
<div class="tier"><div class="p">${(1 / CHECKS_PER_USDC).toFixed(3)} USDC</div><p>per verification beyond the free tier. Prepay from ${MIN_PURCHASE_USDC} USDC; credits never expire.</p></div></div>
<h3>Buying credits (we bill with our own product)</h3>
<ol><li>Send ≥ ${MIN_PURCHASE_USDC} USDC on Base or Arbitrum to <code>${TREASURY}</code>.</li><li><code>POST /v1/credits</code> with your key and <code>{"chain":"base","tx":"0x…"}</code>. PaidOnChain verifies the payment and adds ${CHECKS_PER_USDC} checks per USDC.</li></ol>
<h2>Guides</h2><ul class="docs">${DOCS.map(d => `<li><a href="/docs/${d.slug}">${esc(d.title)}<span>${esc(d.desc)}</span></a></li>`).join("")}</ul>`;
  return layout({ title: "Verify USDC payments on-chain", desc: "Open-source library + hosted API to verify USDC payments on Base and Arbitrum. No Stripe, no custody.", path: "/", content });
}
