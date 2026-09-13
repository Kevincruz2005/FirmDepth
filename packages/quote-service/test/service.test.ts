import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { firmQuoteTypedData } from "@firmdepth/sdk/eip712";
import { buildFirmOrder, buildSoftOrder, buildSoftTakerTraits } from "@firmdepth/sdk/swapvm";
import { getAddress, verifyTypedData, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createHandler, IpRateLimiter } from "../src/app.js";
import { parseManifest } from "../src/manifest.js";
import { createFirmQuote, parseQuoteRequest, QuoteError, SOFT_DEPLETED_MESSAGE } from "../src/quote-engine.js";
import type { SepoliaManifest } from "../src/types.js";

const privateKey = `0x${"11".repeat(32)}` as const;
const makerAccount = privateKeyToAccount(privateKey);
const addresses = {
  aqua: address(1), weth: address(2), usdc: address(3), bondVault: address(4),
  registry: address(5), firmRouter: address(6), executor: address(7),
};
const firmOrder = buildFirmOrder(makerAccount.address, addresses.weth, addresses.usdc);
const softOrder = buildSoftOrder(makerAccount.address, addresses.weth, addresses.usdc);
const firmHash = hash(1);
const softHash = hash(2);
const manifest = parseManifest({
  schemaVersion: "1", status: "ready", manifestRevision: hash(9),
  chain: { id: 11155111, name: "Sepolia", explorerUrl: "https://sepolia.etherscan.io" },
  deployment: { blockNumber: 90, deployedAt: "2026-09-12T00:00:00.000Z" },
  addresses,
  tokens: { weth: { symbol: "WETH", decimals: 18, provenance: "test" }, usdc: { symbol: "USDC", decimals: 6, provenance: "test" } },
  maker: makerAccount.address,
  policies: { pricingVersion: 2, maxQuoteTtl: 120, horizons: [5, 30, 120], minimumAmountIn: "1000000000000000", maximumAmountIn: "1000000000000000000", requiredBondBps: 12000, sigmaWad: "800000000000000000", annualCapitalRateWad: "100000000000000000", capacityKBps: 10, minPremiumOut: "100000" },
  opcodeConfiguration: { firmPrice: 82, firmGuard: 33, program: "0x52002100" },
  strategies: [
    { id: "soft-drain", label: "Soft", kind: "SOFT", order: serializeOrder(softOrder), orderHash: softHash, takerTraits: buildSoftTakerTraits(addresses.weth, addresses.usdc), suggestedAmountIn: "100000000000000000", virtualBalances: { weth: "0", usdc: "3000000000" } },
    { id: "firm-primary", label: "Firm", kind: "FIRM", order: serializeOrder(firmOrder), orderHash: firmHash, takerTraits: "0x", suggestedAmountIn: "100000000000000000", virtualBalances: { weth: "0", usdc: "3000000000" } },
  ],
  sourceRevisions: { firmDepth: "a", aqua: "b", swapVM: "c", aquaSDK: "d" },
  transactions: { deployment: [hash(3)], setup: [hash(4)] },
});

test("rejects pending manifests and accepts a complete ready manifest", () => {
  assert.equal(manifest.chain.id, 11155111);
  assert.throws(() => parseManifest({ schemaVersion: "1", status: "pending" }), /pending/);
});

test("enforces exact deployment, horizons, fields, and amount bounds", () => {
  const request = requestBody();
  assert.equal(parseQuoteRequest(request, manifest).pricingTtl, 30);
  assert.throws(() => parseQuoteRequest({ ...request, pricingTtl: 31 }, manifest), /horizon/);
  assert.throws(() => parseQuoteRequest({ ...request, registry: address(99) }, manifest), /registry/);
  assert.throws(() => parseQuoteRequest({ ...request, amountIn: "1" }, manifest), /limits/);
  assert.throws(() => parseQuoteRequest({ ...request, unexpected: true }, manifest), /schema/);
});

test("builds and signs a live-policy quote for all public TTLs", async () => {
  const client = fakeClient();
  for (const pricingTtl of [5, 30, 120] as const) {
    const request = parseQuoteRequest({ ...requestBody(), pricingTtl }, manifest);
    const envelope = await createFirmQuote(client, makerAccount, manifest, request);
    assert.equal(envelope.quote.pricingTtl, pricingTtl);
    assert.equal(envelope.quote.referenceAmountOut, 200_000_000n);
    assert.equal(envelope.quote.minAmountOut, 200_000_000n);
    assert.equal(envelope.quote.requiredBond, 240_000_000n);
    assert.equal(envelope.quote.expiry, 2_000_000_000n + BigInt(pricingTtl));
    assert.equal(await verifyTypedData({ address: makerAccount.address, ...firmQuoteTypedData(addresses.registry, 11155111, envelope.quote), signature: envelope.makerSignature }), true);
  }
});

test("rejects insufficient Bond, depleted capacity, and stale utilization", async () => {
  const request = parseQuoteRequest(requestBody(), manifest);
  await assert.rejects(createFirmQuote(fakeClient({ availableBond: 1n }), makerAccount, manifest, request), /INSUFFICIENT_BOND/);
  await assert.rejects(createFirmQuote(fakeClient({ virtualOutput: 1n }), makerAccount, manifest, request), /INSUFFICIENT_AQUA_CAPACITY/);
  await assert.rejects(createFirmQuote(fakeClient({ staleUtilization: true }), makerAccount, manifest, request), /utilization changed/);
});

test("reports zero-pullable Soft reference liquidity as an actionable conflict", async () => {
  const request = parseQuoteRequest(requestBody(), manifest);
  await assert.rejects(
    createFirmQuote(fakeClient({ virtualOutput: 0n }), makerAccount, manifest, request),
    (cause: unknown) => cause instanceof QuoteError && cause.statusCode === 409 && cause.message === SOFT_DEPLETED_MESSAGE,
  );
  await assert.rejects(
    createFirmQuote(fakeClient({ softQuoteError: new Error("execution reverted: TakerTraitsAmountOutMustBeGreaterThanZero(0) [0xf6ab88ca]") }), makerAccount, manifest, request),
    (cause: unknown) => cause instanceof QuoteError && cause.statusCode === 409 && cause.message === SOFT_DEPLETED_MESSAGE,
  );
});

test("rate limiter enforces a bounded per-IP burst", () => {
  const limiter = new IpRateLimiter(2, 1000);
  assert.equal(limiter.take("one", 0), true);
  assert.equal(limiter.take("one", 1), true);
  assert.equal(limiter.take("one", 2), false);
  assert.equal(limiter.take("one", 1000), true);
});

test("HTTP boundary applies CORS and never returns internal failures", async () => {
  const logs: Record<string, unknown>[] = [];
  const handler = createHandler({
    manifest,
    runtime: { schemaVersion: "2", manifestRevision: manifest.manifestRevision },
    corsOrigins: new Set(["http://127.0.0.1:4173"]),
    production: false,
    health: async () => ({ status: "ok", maker: manifest.maker }),
    quote: async () => { throw new Error("https://credential.example/private-rpc?key=secret"); },
    log: (entry) => logs.push(entry),
  });
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const location = server.address();
  assert(location && typeof location === "object");
  const url = `http://127.0.0.1:${location.port}`;
  try {
    const denied = await fetch(`${url}/runtime`, { headers: { origin: "https://evil.example" } });
    assert.equal(denied.status, 403);
    const health = await fetch(`${url}/health`, { headers: { origin: "http://127.0.0.1:4173" } });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("access-control-allow-origin"), "http://127.0.0.1:4173");
    const failure = await fetch(`${url}/quote/firm`, { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:4173" }, body: JSON.stringify(requestBody()) });
    assert.equal(failure.status, 500);
    assert.equal(JSON.stringify(await failure.json()).includes("secret"), false);
    assert.equal(JSON.stringify(logs).includes("secret"), false);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});

test("HTTP boundary preserves the actionable Soft-depletion 409", async () => {
  const handler = createHandler({
    manifest,
    runtime: {},
    corsOrigins: new Set(),
    production: false,
    health: async () => ({ status: "ok" }),
    quote: async () => { throw new QuoteError(409, SOFT_DEPLETED_MESSAGE); },
    log: () => undefined,
  });
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const location = server.address();
  assert(location && typeof location === "object");
  try {
    const response = await fetch(`http://127.0.0.1:${location.port}/quote/firm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody()),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json() as { error: string }).error, SOFT_DEPLETED_MESSAGE);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});

function requestBody() {
  return { chainId: 11155111, registry: addresses.registry, strategyId: "firm-primary", orderHash: firmHash, taker: address(8), amountIn: "100000000000000000", pricingTtl: 30 };
}

function fakeClient(options: { availableBond?: bigint; virtualOutput?: bigint; staleUtilization?: boolean; softQuoteError?: Error } = {}): PublicClient {
  let utilizationReads = 0;
  const client = {
    getChainId: async () => 11155111,
    getBytecode: async () => "0x01",
    getBlockNumber: async () => 100n,
    getBlock: async () => ({ number: 100n, timestamp: 2_000_000_000n, hash: hash(7) }),
    readContract: async ({ address: contract, functionName, args = [] }: { address: Address; functionName: string; args?: readonly unknown[] }) => {
      const relationships: Record<string, Address> = {
        [`${addresses.registry}:vault`]: addresses.bondVault,
        [`${addresses.registry}:premiumToken`]: addresses.weth,
        [`${addresses.registry}:tokenIn`]: addresses.weth,
        [`${addresses.registry}:tokenOut`]: addresses.usdc,
        [`${addresses.registry}:executor`]: addresses.executor,
        [`${addresses.bondVault}:bondToken`]: addresses.usdc,
        [`${addresses.bondVault}:registry`]: addresses.registry,
        [`${addresses.executor}:registry`]: addresses.registry,
        [`${addresses.executor}:aqua`]: addresses.aqua,
        [`${addresses.executor}:router`]: addresses.firmRouter,
        [`${addresses.firmRouter}:FIRM_REGISTRY`]: addresses.registry,
        [`${addresses.firmRouter}:BOND_VAULT`]: addresses.bondVault,
        [`${addresses.firmRouter}:AQUA`]: addresses.aqua,
        [`${addresses.firmRouter}:WETH`]: addresses.weth,
      };
      const relationship = relationships[`${getAddress(contract)}:${functionName}`];
      if (relationship) return relationship;
      if (functionName === "maxQuoteTtl") return 120n;
      if (functionName === "minimumValidNonce") return 0n;
      if (functionName === "nonceUsed") return false;
      if (functionName === "utilizationAfter") return options.staleUtilization && utilizationReads++ > 0 ? 200_000_000_000_000_000n : 100_000_000_000_000_000n;
      if (functionName === "availableOf") return options.availableBond ?? 10_000_000_000n;
      if (functionName === "balanceOf") return 10_000_000_000n;
      if (functionName === "allowance") return 10_000_000_000n;
      if (functionName === "rawBalances") return [args[3] === addresses.usdc ? options.virtualOutput ?? 10_000_000_000n : 0n, 2];
      if (functionName === "quote") {
        const quotedOrder = args[0] as { data: Hex };
        const amount = args[1] as bigint;
        const isSoft = quotedOrder.data === softOrder.data;
        if (isSoft && options.softQuoteError) throw options.softQuoteError;
        return [amount, 200_000_000n, isSoft ? softHash : firmHash];
      }
      throw new Error(`unexpected read ${functionName}`);
    },
  };
  return client as unknown as PublicClient;
}

function serializeOrder(order: { maker: Address; traits: bigint; data: Hex }) { return { maker: order.maker, traits: order.traits.toString(), data: order.data }; }
function address(value: number): Address { return getAddress(`0x${value.toString(16).padStart(40, "0")}`); }
function hash(value: number): Hex { return `0x${value.toString(16).padStart(64, "0")}`; }
