import test from "node:test";
import assert from "node:assert/strict";
import { verifyPayment, paymentURI, toUnits, CHAINS, TRANSFER_TOPIC } from "../src/index.js";

const ME = "0xB1a65c3a55Cb23B230b3e11C1Ea08504a3099c8e";
const pad = a => "0x" + a.toLowerCase().slice(2).padStart(64, "0");
const amt = n => "0x" + BigInt(n).toString(16).padStart(64, "0");
const log = (o = {}) => ({ address: CHAINS.base.usdc, topics: [TRANSFER_TOPIC, pad("0x1111111111111111111111111111111111111111"), pad(ME)], data: amt(19_000_000), ...o });
function mockFetch(receipt, head = "0x70") {
  return async (_u, opts) => { const b = JSON.parse(opts.body); return new Response(JSON.stringify({ result: b.method === "eth_blockNumber" ? head : receipt })); };
}
const TX = "0x" + "ab".repeat(32);
const base = { chain: "base", tx: TX, to: ME, minAmount: "19" };

test("valid payment", async () => {
  const r = await verifyPayment({ ...base, fetch: mockFetch({ status: "0x1", blockNumber: "0x64", logs: [log()] }) });
  assert.equal(r.ok, true); assert.equal(r.paid, "19"); assert.equal(r.confirmations, 13);
  assert.equal(r.from, "0x1111111111111111111111111111111111111111");
});
test("sums multiple transfers to recipient", async () => {
  const r = await verifyPayment({ ...base, fetch: mockFetch({ status: "0x1", blockNumber: "0x64", logs: [log({ data: amt(9_500_000) }), log({ data: amt(9_500_000) })] }) });
  assert.equal(r.ok, true); assert.equal(r.paid, "19");
});
test("underpaid", async () => {
  const r = await verifyPayment({ ...base, fetch: mockFetch({ status: "0x1", blockNumber: "0x64", logs: [log({ data: amt(5_000_000) })] }) });
  assert.equal(r.code, "UNDERPAID"); assert.equal(r.paid, "5");
});
test("fake token contract is ignored", async () => {
  const r = await verifyPayment({ ...base, fetch: mockFetch({ status: "0x1", blockNumber: "0x64", logs: [log({ address: "0x9999999999999999999999999999999999999999" })] }) });
  assert.equal(r.code, "NO_TRANSFER");
});
test("wrong recipient", async () => {
  const r = await verifyPayment({ ...base, fetch: mockFetch({ status: "0x1", blockNumber: "0x64", logs: [log({ topics: [TRANSFER_TOPIC, pad("0x11"), pad("0x2222222222222222222222222222222222222222")] })] }) });
  assert.equal(r.code, "NO_TRANSFER");
});
test("non-transfer event ignored", async () => {
  const r = await verifyPayment({ ...base, fetch: mockFetch({ status: "0x1", blockNumber: "0x64", logs: [log({ topics: ["0x" + "00".repeat(32), pad("0x11"), pad(ME)] })] }) });
  assert.equal(r.code, "NO_TRANSFER");
});
test("reverted tx", async () => {
  const r = await verifyPayment({ ...base, fetch: mockFetch({ status: "0x0", blockNumber: "0x64", logs: [log()] }) });
  assert.equal(r.code, "FAILED_TX");
});
test("not found", async () => {
  const r = await verifyPayment({ ...base, fetch: mockFetch(null) });
  assert.equal(r.code, "NOT_FOUND");
});
test("pending confirmations", async () => {
  const r = await verifyPayment({ ...base, fetch: mockFetch({ status: "0x1", blockNumber: "0x6f", logs: [log()] }) });
  assert.equal(r.code, "PENDING"); assert.equal(r.confirmations, 2);
});
test("invalid inputs throw", async () => {
  await assert.rejects(verifyPayment({ ...base, tx: "0x12" }), { code: "BAD_TX" });
  await assert.rejects(verifyPayment({ ...base, to: "nope" }), { code: "BAD_TO" });
  await assert.rejects(verifyPayment({ ...base, chain: "doge" }), { code: "BAD_CHAIN" });
  await assert.rejects(verifyPayment({ ...base, minAmount: "1.1234567" }), { code: "BAD_AMOUNT" });
});
test("rpc error surfaces", async () => {
  const f = async () => new Response(JSON.stringify({ error: { message: "rate limited" } }));
  await assert.rejects(verifyPayment({ ...base, fetch: f }), { code: "RPC_ERROR" });
});
test("toUnits + paymentURI", () => {
  assert.equal(toUnits("19.5"), 19_500_000n);
  assert.equal(paymentURI({ to: ME, amount: "5" }), `ethereum:${CHAINS.base.usdc}@8453/transfer?address=${ME}&uint256=5000000`);
});
