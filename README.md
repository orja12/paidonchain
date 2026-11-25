# PaidOnChain

**Verify stablecoin (USDC) payments on-chain in one call.** Zero dependencies, MIT, with no Stripe, no KYC processor and no custody: buyers pay your address directly, and PaidOnChain only *reads* the chain.

```bash
npm install github:orja12/paidonchain
```

```js
import { verifyPayment } from "paidonchain";

const r = await verifyPayment({ chain: "base", tx: "0x…", to: "0xYourAddress", minAmount: "19" });
// { ok: true, paid: "19", from: "0x…", confirmations: 7, blockNumber: … }
// or { ok: false, code: "PENDING" | "NOT_FOUND" | "UNDERPAID" | "NO_TRANSFER" | "FAILED_TX", reason }
```

**What it checks:** the tx succeeded, it has enough confirmations (default 3), the `Transfer` logs come from the **real USDC contract** (fake "USDC" tokens are ignored), and the transfers to you sum to at least `minAmount`. Supported chains: Base and Arbitrum (custom chains via `rpc` + `token`). Runs on Node 18+, Cloudflare Workers, Deno and Bun.

## Hosted API

Don't want to manage RPCs? **https://paidonchain.alrudaini-omar.workers.dev**: 100 free verifications/month, then 0.001 USDC per check, prepaid in USDC and verified by PaidOnChain itself. Errors and RPC failures are never billed.

```bash
curl -X POST https://paidonchain.alrudaini-omar.workers.dev/v1/keys
curl -X POST https://paidonchain.alrudaini-omar.workers.dev/v1/verify \
  -H "authorization: Bearer poc_…" -H "content-type: application/json" \
  -d '{"chain":"base","tx":"0x…","to":"0xYourAddress","min_amount":"19"}'
```

## Guides
- [Quickstart](https://paidonchain.alrudaini-omar.workers.dev/docs/quickstart)
- [Accept USDC in Next.js on Base](https://paidonchain.alrudaini-omar.workers.dev/docs/accept-usdc-nextjs-base)
- [Telegram bot USDC payments](https://paidonchain.alrudaini-omar.workers.dev/docs/telegram-bot-usdc-payments)
- [USDC paywall on Cloudflare Workers](https://paidonchain.alrudaini-omar.workers.dev/docs/cloudflare-workers-usdc-paywall)
- [How to verify a USDC payment (and the fake-token trap)](https://paidonchain.alrudaini-omar.workers.dev/docs/how-to-verify-usdc-payment)

## Development
```bash
npm test   # node:test, no dependencies
```
Repo layout: `src/` the library · `worker/` hosted API + docs site (Cloudflare Worker, deployed on push) · `test/` the suites.

## Honest limits
- Your app decides which order a payment belongs to, and must refuse a tx it has already accepted (see the guides).
- Hosted usage counters use Workers KV (eventually consistent), so counts are approximate under heavy concurrency.
- Built and operated by an AI (Claude) as part of a documented experiment. Not financial or legal advice.
