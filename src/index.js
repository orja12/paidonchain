// paidonchain: verify stablecoin payments on-chain. Zero dependencies. MIT.
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const CHAINS = {
  base:     { id: 8453,  name: "Base",     rpc: "https://mainnet.base.org",     usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", explorer: "https://basescan.org/tx/" },
  arbitrum: { id: 42161, name: "Arbitrum", rpc: "https://arb1.arbitrum.io/rpc", usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", explorer: "https://arbiscan.io/tx/" },
};

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const TXH = /^0x[0-9a-fA-F]{64}$/;
const pad = a => "0x" + a.toLowerCase().slice(2).padStart(64, "0");

/** Convert a decimal string/number ("19.5") to integer base units (6 decimals for USDC). */
export function toUnits(amount, decimals = 6) {
  const s = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new PaidOnChainError("BAD_AMOUNT", `Invalid amount: ${amount}`);
  const [w, f = ""] = s.split(".");
  if (f.length > decimals) throw new PaidOnChainError("BAD_AMOUNT", `Too many decimals (max ${decimals})`);
  return BigInt(w + f.padEnd(decimals, "0"));
}

export class PaidOnChainError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function rpcCall(url, method, params, fetchImpl) {
  const r = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!r.ok) throw new PaidOnChainError("RPC_HTTP", `RPC HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new PaidOnChainError("RPC_ERROR", j.error.message || "RPC error");
  return j.result;
}

/**
 * Verify that transaction `tx` on `chain` paid at least `minAmount` USDC to `to`.
 * Resolves to { ok: true, paid, confirmations, from, blockNumber } or { ok: false, code, reason }.
 * Throws PaidOnChainError only for invalid inputs or RPC failures (callers should retry those).
 */
export async function verifyPayment({ chain = "base", tx, to, minAmount, minConfirmations = 3, token, rpc, fetch: fetchImpl = globalThis.fetch }) {
  const c = CHAINS[chain];
  if (!c && !(rpc && token)) throw new PaidOnChainError("BAD_CHAIN", `Unknown chain "${chain}". Pass rpc + token for custom chains.`);
  if (!TXH.test(String(tx || ""))) throw new PaidOnChainError("BAD_TX", "tx must be 0x + 64 hex characters");
  if (!ADDR.test(String(to || ""))) throw new PaidOnChainError("BAD_TO", "to must be a 0x address");
  const want = toUnits(minAmount);
  const url = rpc || c.rpc, tokenAddr = (token || c.usdc).toLowerCase();

  const rc = await rpcCall(url, "eth_getTransactionReceipt", [tx], fetchImpl);
  if (!rc) return { ok: false, code: "NOT_FOUND", reason: "Transaction not found (yet). Retry in a few seconds." };
  if (rc.status !== "0x1") return { ok: false, code: "FAILED_TX", reason: "Transaction reverted on-chain." };
  const head = BigInt(await rpcCall(url, "eth_blockNumber", [], fetchImpl));
  const confirmations = Number(head - BigInt(rc.blockNumber) + 1n);
  if (confirmations < minConfirmations) return { ok: false, code: "PENDING", reason: `${confirmations}/${minConfirmations} confirmations`, confirmations };

  const toTopic = pad(to);
  let paid = 0n, from = null;
  for (const l of rc.logs || []) {
    if (String(l.address).toLowerCase() !== tokenAddr) continue;          // must be the REAL token contract
    if (l.topics?.[0] !== TRANSFER_TOPIC || l.topics.length < 3) continue;
    if (String(l.topics[2]).toLowerCase() !== toTopic) continue;
    paid += BigInt(l.data);
    from = from || "0x" + String(l.topics[1]).slice(26);
  }
  if (paid === 0n) return { ok: false, code: "NO_TRANSFER", reason: "No matching token transfer to the recipient in this transaction." };
  if (paid < want) return { ok: false, code: "UNDERPAID", reason: `Paid ${fmt(paid)}, expected ${fmt(want)}`, paid: fmt(paid) };
  return { ok: true, paid: fmt(paid), confirmations, from, blockNumber: Number(BigInt(rc.blockNumber)) };
}

const fmt = u => { const s = u.toString().padStart(7, "0"); return (s.slice(0, -6) + "." + s.slice(-6)).replace(/\.?0+$/, "") || "0"; };

/** EIP-681 payment link for wallets (USDC transfer). */
export function paymentURI({ chain = "base", to, amount }) {
  const c = CHAINS[chain];
  if (!c) throw new PaidOnChainError("BAD_CHAIN", `Unknown chain "${chain}"`);
  if (!ADDR.test(String(to || ""))) throw new PaidOnChainError("BAD_TO", "to must be a 0x address");
  return `ethereum:${c.usdc}@${c.id}/transfer?address=${to}` + (amount != null ? `&uint256=${toUnits(amount)}` : "");
}
