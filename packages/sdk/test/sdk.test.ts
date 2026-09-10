import assert from "node:assert/strict";
import test from "node:test";
import type { PublicClient, WalletClient } from "viem";

import { acceptFirm, depositBond, executeFirm, expireFirm, withdrawBond } from "../src/actions.js";
import { effectiveAquaCapacity, canUseAqua } from "../src/capacity.js";
import { buildFirmTypedData, hashFirmQuote, verifyFirmQuote } from "../src/eip712.js";
import { buildAquaShipRequest, aquaStrategyHash } from "../src/aqua.js";
import { calculateFirmPremium, computeFirmPrice } from "../src/pricing.js";
import { buildFirmQuote } from "../src/quote.js";
import {
  checkFirmEligibility,
  commitmentStatus,
  getFirmDepth,
  getLiquidityReality,
  getPullableBackingAtBlock,
  getVirtualDepth,
  readAquaCapacity,
} from "../src/readers.js";
import {
  buildFirmInstructionArgs,
  buildFirmOrder,
  buildFirmProgram,
  buildFirmQuoteTakerTraits,
  decodeFirmInstructionArgs,
  encodeInstruction,
} from "../src/swapvm.js";
import { acceptRequest } from "../src/requests.js";

test("encodes the exact FirmDepth SwapVM program", () => {
  assert.equal(buildFirmProgram(), "0x52002100");
  assert.equal(encodeInstruction(0x21, "0x1234"), "0x21021234");
});

test("builds the exact hook-free Aqua maker order accepted by FirmExecutor", () => {
  const maker = "0x00000000000000000000000000000000000000a1";
  const tokenIn = "0x00000000000000000000000000000000000000f2";
  const tokenOut = "0x0000000000000000000000000000000000000003";
  const order = buildFirmOrder(maker, tokenIn, tokenOut);
  const useAquaFlag = 1n << 254n;
  const indexes = 0x0028002800280028n << 160n;

  assert.equal(order.maker, "0x00000000000000000000000000000000000000A1");
  assert.equal(order.traits, useAquaFlag | indexes | BigInt(maker));
  assert.equal(
    order.data,
    "0x000000000000000000000000000000000000000300000000000000000000000000000000000000f252002100",
  );
  assert.throws(() => buildFirmOrder(maker, tokenIn, tokenIn), RangeError);
});

test("encodes firm amount and commitment id for sequential dynamic opcodes", () => {
  const commitmentId = `0x${"ab".repeat(32)}` as const;
  const encoded = buildFirmInstructionArgs(625_000_000n, commitmentId);
  assert.equal(encoded.slice(0, 66), `0x${(625_000_000n).toString(16).padStart(64, "0")}`);
  assert.equal(encoded.slice(66), "ab".repeat(32));
  assert.deepEqual(decodeFirmInstructionArgs(encoded), { amountOut: 625_000_000n, commitmentId });
  assert.throws(() => decodeFirmInstructionArgs("0x1234"), RangeError);
});

test("builds pinned SwapVM static quote traits with exact slice offsets", () => {
  const amountOut = 625_000_000n;
  const commitmentId = `0x${"ab".repeat(32)}` as const;
  const traits = buildFirmQuoteTakerTraits({
    amountOut,
    commitmentId,
    tokenIn: "0x0000000000000000000000000000000000000001",
    tokenOut: "0x0000000000000000000000000000000000000002",
    deadline: 2_000_000_000n,
  });

  assert.equal(traits.slice(2, 42), "0065002500250025002500250025002500200020");
  assert.equal(traits.slice(42, 46), "00f1");
  assert.equal(traits.slice(46, 110), amountOut.toString(16).padStart(64, "0"));
  assert.equal(traits.slice(110, 120), (2_000_000_000n).toString(16).padStart(10, "0"));
  assert.equal(traits.slice(120, 184), amountOut.toString(16).padStart(64, "0"));
  assert.equal(traits.slice(184), "ab".repeat(32));
  assert.equal((traits.length - 2) / 2, 123);
});

test("computes capacity as virtual-real-allowance minimum", () => {
  const capacity = effectiveAquaCapacity(900n, 700n, 800n);
  assert.equal(capacity.effectiveCapacity, 700n);
  assert.equal(canUseAqua(capacity, 700n), true);
  assert.equal(canUseAqua(capacity, 701n), false);
  assert.equal(effectiveAquaCapacity(900n, 700n, 800n, false).effectiveCapacity, 0n);
});

test("rejects oversized instruction arguments and malformed ids", () => {
  assert.throws(() => encodeInstruction(0x21, `0x${"00".repeat(256)}`), RangeError);
  assert.throws(() => buildFirmInstructionArgs(1n, "0x1234"), RangeError);
  assert.throws(() => buildFirmInstructionArgs(0n), RangeError);
  assert.throws(() => buildFirmQuoteTakerTraits({
    amountOut: 1n,
    tokenIn: "0x0000000000000000000000000000000000000001",
    tokenOut: "0x0000000000000000000000000000000000000001",
  }), RangeError);
  assert.throws(() => buildFirmQuoteTakerTraits({
    amountOut: 1n,
    tokenIn: "0x0000000000000000000000000000000000000001",
    tokenOut: "0x0000000000000000000000000000000000000002",
    deadline: 2n ** 40n,
  }), RangeError);
});

test("matches the canonical 5, 30, and 120 second premium vectors", () => {
  const expected = [
    [5n, 398_182_068_806_247n, 88_956n, 10n, 388_517n, 477_483n, 136_423_714_285_715n],
    [30n, 975_342_893_301_088n, 217_899n, 65n, 388_517n, 606_481n, 173_280_285_714_286n],
    [120n, 1_950_685_786_602_176n, 435_798n, 262n, 388_517n, 824_577n, 235_593_428_571_429n],
  ] as const;

  for (const [ttl, sqrtTimeWad, optionalityOut, bondCarryOut, capacitySurchargeOut, premiumOut, premiumIn] of expected) {
    assert.deepEqual(calculateFirmPremium({
      amountIn: 200_000_000_000_000_000n,
      referenceAmountOut: 700_000_000n,
      minAmountOut: 690_000_000n,
      requiredBond: 690_000_000n,
      sigmaWad: 800_000_000_000_000_000n,
      annualCapitalRateWad: 100_000_000_000_000_000n,
      capacityKBps: 10n,
      utilizationAfterWad: 745_000_000_000_000_000n,
      minPremiumOut: 100_000n,
      ttl,
    }), {
      pricingVersion: 2,
      sqrtTimeWad,
      optionalityOut,
      bondCarryOut,
      capacitySurchargeOut,
      premiumOut,
      premiumIn,
    });
  }
  assert.equal(computeFirmPrice, calculateFirmPremium);
});

test("builds a complete quote with the exact acceptance-time premium", () => {
  const currentTimestamp = 2_000_000_000n;
  const quote = buildFirmQuote({
    maker: "0x0000000000000000000000000000000000000001",
    taker: "0x0000000000000000000000000000000000000002",
    executor: "0x0000000000000000000000000000000000000003",
    swapRouter: "0x0000000000000000000000000000000000000004",
    orderHash: `0x${"11".repeat(32)}`,
    tokenIn: "0x0000000000000000000000000000000000000005",
    tokenOut: "0x0000000000000000000000000000000000000006",
    amountIn: 100_000_000_000_000_000n,
    referenceAmountOut: 200_000_000n,
    minAmountOut: 200_000_000n,
    requiredBond: 200_000_000n,
    premiumToken: "0x0000000000000000000000000000000000000005",
    sigmaWad: 0n,
    annualCapitalRateWad: 0n,
    capacityKBps: 0,
    utilizationAfterWad: 200_000_000_000_000_000n,
    minPremiumOut: 100_000n,
    expiry: currentTimestamp + 30n,
    nonce: 7n,
  }, currentTimestamp);
  assert.equal(quote.pricingVersion, 2);
  assert.equal(quote.premiumAmount, 50_000_000_000_000n);
});

test("rejects pricing inputs outside the onchain bounds", () => {
  const inputs = {
    amountIn: 1n,
    referenceAmountOut: 1n,
    minAmountOut: 1n,
    requiredBond: 1n,
    sigmaWad: 0n,
    annualCapitalRateWad: 0n,
    capacityKBps: 0n,
    utilizationAfterWad: 0n,
    minPremiumOut: 0n,
    ttl: 1n,
  } as const;

  assert.throws(() => calculateFirmPremium({ ...inputs, ttl: 301n }), RangeError);
  assert.throws(() => calculateFirmPremium({ ...inputs, requiredBond: 0n }), RangeError);
  assert.throws(() => calculateFirmPremium({ ...inputs, utilizationAfterWad: 10n ** 18n + 1n }), RangeError);
});

test("builds Aqua ship calldata through the official Aqua SDK", () => {
  const request = buildAquaShipRequest(
    "0x0000000000000000000000000000000000000001",
    "0x0000000000000000000000000000000000000002",
    "0x1234",
    [{ token: "0x0000000000000000000000000000000000000003", amount: 10n }],
  );
  assert.equal(request.address, "0x0000000000000000000000000000000000000001");
  assert.equal(request.data.slice(0, 10), "0xf50b870f");
  assert.equal(aquaStrategyHash("0x1234").length, 66);
});

test("decodes only defined commitment statuses", () => {
  assert.equal(commitmentStatus(3), "FILLED_BOND");
  assert.throws(() => commitmentStatus(5), RangeError);
});

test("reads effective capacity from contract state", async () => {
  const tokenIn = "0x0000000000000000000000000000000000000004";
  const tokenOut = "0x0000000000000000000000000000000000000005";
  const client = {
    readContract: async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
      if (functionName === "rawBalances") return args[3] === tokenOut ? [900n, 2] : [0n, 2];
      if (functionName === "balanceOf") return 700n;
      if (functionName === "allowance") return 800n;
      throw new Error(`unexpected function ${functionName}`);
    },
  } as unknown as PublicClient;
  const capacity = await readAquaCapacity(client, {
    aqua: "0x0000000000000000000000000000000000000001",
    router: "0x0000000000000000000000000000000000000002",
    maker: "0x0000000000000000000000000000000000000003",
    orderHash: `0x${"11".repeat(32)}`,
    tokenIn,
    tokenOut,
  });
  assert.deepEqual(capacity, {
    virtualBalance: 900n,
    realBalance: 700n,
    aquaAllowance: 800n,
    effectiveCapacity: 700n,
    strategyActive: true,
  });
});

test("returns block-stamped Virtual, Pullable, and Firm depth", async () => {
  const query = {
    aqua: "0x0000000000000000000000000000000000000001",
    router: "0x0000000000000000000000000000000000000002",
    maker: "0x0000000000000000000000000000000000000003",
    orderHash: `0x${"11".repeat(32)}` as const,
    tokenIn: "0x0000000000000000000000000000000000000004",
    tokenOut: "0x0000000000000000000000000000000000000005",
  } as const;
  const client = {
    getBlockNumber: async () => 123n,
    readContract: async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
      if (functionName === "rawBalances") return args[3] === query.tokenOut ? [900n, 2] : [0n, 2];
      if (functionName === "balanceOf") return 700n;
      if (functionName === "allowance") return 800n;
      throw new Error(`unexpected function ${functionName}`);
    },
  } as unknown as PublicClient;
  assert.deepEqual(await getLiquidityReality(client, query), {
    blockNumber: 123n,
    virtualDepth: 900n,
    realBalance: 700n,
    aquaAllowance: 800n,
    pullableBacking: 700n,
    firmDepth: 700n,
    strategyActive: true,
  });
  assert.deepEqual(await getVirtualDepth(client, query), { blockNumber: 123n, value: 900n });
  assert.deepEqual(await getPullableBackingAtBlock(client, query), {
    blockNumber: 123n,
    value: 700n,
    realBalance: 700n,
    aquaAllowance: 800n,
  });
  assert.deepEqual(await getFirmDepth(client, query), { blockNumber: 123n, value: 700n });
});

test("checks the same capacity, bond, and static quote gates as acceptance", async () => {
  const orderHash = `0x${"33".repeat(32)}` as const;
  const query = {
    aqua: "0x0000000000000000000000000000000000000001",
    router: "0x0000000000000000000000000000000000000002",
    vault: "0x0000000000000000000000000000000000000007",
    maker: "0x0000000000000000000000000000000000000003",
    orderHash,
    tokenIn: "0x0000000000000000000000000000000000000004",
    tokenOut: "0x0000000000000000000000000000000000000005",
    requiredBond: 625n,
    requiredOutput: 625n,
    amountIn: 250n,
    order: {
      maker: "0x0000000000000000000000000000000000000003",
      traits: 1n,
      data: "0x1234",
    },
    takerTraits: "0x1234",
  } as const;
  const client = {
    getBlockNumber: async () => 456n,
    readContract: async ({ functionName, args, address }: { functionName: string; args: readonly unknown[]; address: string }) => {
      if (functionName === "rawBalances") return args[3] === query.tokenOut ? [900n, 2] : [0n, 2];
      if (functionName === "balanceOf") return 700n;
      if (functionName === "allowance") return 800n;
      if (functionName === "availableOf" && address === query.vault) return 700n;
      if (functionName === "quote") return [250n, 625n, orderHash];
      throw new Error(`unexpected function ${functionName}`);
    },
  } as unknown as PublicClient;
  const eligible = await checkFirmEligibility(client, query);
  assert.equal(eligible.eligible, true);
  assert.deepEqual(eligible.reasons, []);
  assert.equal(eligible.blockNumber, 456n);

  const insufficient = await checkFirmEligibility(client, { ...query, requiredBond: 701n });
  assert.equal(insufficient.eligible, false);
  assert.deepEqual(insufficient.reasons, ["INSUFFICIENT_BOND"]);
});

test("hashes every signed quote field deterministically", () => {
  const registry = "0x0000000000000000000000000000000000000010";
  const quote = {
    maker: "0x0000000000000000000000000000000000000001",
    taker: "0x0000000000000000000000000000000000000002",
    executor: "0x0000000000000000000000000000000000000003",
    swapRouter: "0x0000000000000000000000000000000000000006",
    orderHash: `0x${"11".repeat(32)}` as const,
    tokenIn: "0x0000000000000000000000000000000000000004",
    tokenOut: "0x0000000000000000000000000000000000000005",
    amountIn: 250000000000000000n,
    referenceAmountOut: 630000000n,
    minAmountOut: 625000000n,
    requiredBond: 625000000n,
    premiumToken: "0x0000000000000000000000000000000000000004",
    premiumAmount: 250000000000000n,
    pricingVersion: 2,
    sigmaWad: 800000000000000000n,
    annualCapitalRateWad: 100000000000000000n,
    capacityKBps: 10,
    utilizationAfterWad: 500000000000000000n,
    minPremiumOut: 100000n,
    pricingTtl: 30,
    expiry: 2000000000n,
    nonce: 1n,
  } as const;
  const digest = hashFirmQuote(registry, 31337, quote);
  assert.equal(digest, hashFirmQuote(registry, 31337, quote));
  assert.notEqual(digest, hashFirmQuote(registry, 31337, { ...quote, nonce: 2n }));
  assert.notEqual(digest, hashFirmQuote(registry, 31338, quote));
  assert.notEqual(digest, hashFirmQuote("0x0000000000000000000000000000000000000011", 31337, quote));
  assert.notEqual(digest, hashFirmQuote(registry, 31337, { ...quote, capacityKBps: 11 }));

  const order = buildFirmOrder(quote.maker, quote.tokenIn, quote.tokenOut);
  const request = acceptRequest(registry, quote, order, "0x1234");
  assert.deepEqual(request.args, [quote, order, "0x1234"]);
  assert.deepEqual(buildFirmTypedData(registry, 31337, quote).message, quote);
});

test("verifies EOA and ERC-1271 quotes through the public client", async () => {
  let received: Record<string, unknown> | undefined;
  const client = {
    verifyTypedData: async (parameters: Record<string, unknown>) => {
      received = parameters;
      return true;
    },
  } as unknown as PublicClient;
  const quote = buildFirmQuote({
    maker: "0x0000000000000000000000000000000000000001",
    taker: "0x0000000000000000000000000000000000000002",
    executor: "0x0000000000000000000000000000000000000003",
    swapRouter: "0x0000000000000000000000000000000000000004",
    orderHash: `0x${"22".repeat(32)}`,
    tokenIn: "0x0000000000000000000000000000000000000005",
    tokenOut: "0x0000000000000000000000000000000000000006",
    amountIn: 1n,
    referenceAmountOut: 1n,
    minAmountOut: 1n,
    requiredBond: 1n,
    premiumToken: "0x0000000000000000000000000000000000000005",
    sigmaWad: 0n,
    annualCapitalRateWad: 0n,
    capacityKBps: 0,
    utilizationAfterWad: 1n,
    minPremiumOut: 0n,
    expiry: 11n,
    nonce: 1n,
  }, 10n);
  assert.equal(await verifyFirmQuote(
    client,
    "0x0000000000000000000000000000000000000010",
    8453,
    quote,
    "0x1234",
  ), true);
  assert.equal(received?.address, quote.maker);
  assert.equal(received?.blockTag, "latest");
});

test("simulates every state-changing SDK action before wallet submission", async () => {
  const account = "0x0000000000000000000000000000000000000001";
  const registry = "0x0000000000000000000000000000000000000010";
  const executor = "0x0000000000000000000000000000000000000011";
  const vault = "0x0000000000000000000000000000000000000012";
  const quote = buildFirmQuote({
    maker: account,
    taker: "0x0000000000000000000000000000000000000002",
    executor,
    swapRouter: "0x0000000000000000000000000000000000000003",
    orderHash: `0x${"44".repeat(32)}`,
    tokenIn: "0x0000000000000000000000000000000000000004",
    tokenOut: "0x0000000000000000000000000000000000000005",
    amountIn: 1n,
    referenceAmountOut: 1n,
    minAmountOut: 1n,
    requiredBond: 1n,
    premiumToken: "0x0000000000000000000000000000000000000004",
    sigmaWad: 0n,
    annualCapitalRateWad: 0n,
    capacityKBps: 0,
    utilizationAfterWad: 1n,
    minPremiumOut: 0n,
    expiry: 2n,
    nonce: 1n,
  }, 1n);
  const order = buildFirmOrder(quote.maker, quote.tokenIn, quote.tokenOut);
  const commitmentId = `0x${"55".repeat(32)}` as const;
  const submitted: string[] = [];
  const clients = {
    account,
    publicClient: {
      simulateContract: async (request: { functionName: string }) => ({
        request,
        result: request.functionName === "accept"
          ? commitmentId
          : request.functionName === "execute" ? [3, 1n] : undefined,
      }),
    } as unknown as PublicClient,
    walletClient: {
      writeContract: async (request: { functionName: string }) => {
        submitted.push(request.functionName);
        return `0x${"66".repeat(32)}`;
      },
    } as unknown as WalletClient,
  };
  assert.equal((await acceptFirm(clients, registry, quote, order, "0x1234")).commitmentId, commitmentId);
  assert.deepEqual(await executeFirm(clients, executor, commitmentId, order), {
    hash: `0x${"66".repeat(32)}`,
    terminalStatus: 3,
    amountOut: 1n,
  });
  await expireFirm(clients, registry, commitmentId);
  await depositBond(clients, vault, 1n);
  await withdrawBond(clients, vault, 1n, account);
  assert.deepEqual(submitted, ["accept", "execute", "expire", "deposit", "withdraw"]);
});
