import assert from "node:assert/strict";
import test from "node:test";

import { effectiveAquaCapacity, canUseAqua } from "../src/capacity.js";
import { hashFirmQuote } from "../src/eip712.js";
import { buildFirmInstructionArgs, buildFirmProgram, encodeInstruction } from "../src/swapvm.js";

test("encodes the exact FirmDepth SwapVM program", () => {
  assert.equal(buildFirmProgram(), "0x52002100");
  assert.equal(encodeInstruction(0x21, "0x1234"), "0x21021234");
});

test("duplicates commitment id for sequential dynamic opcode consumption", () => {
  const commitmentId = `0x${"ab".repeat(32)}` as const;
  assert.equal(buildFirmInstructionArgs(commitmentId), `0x${"ab".repeat(64)}`);
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
  assert.throws(() => buildFirmInstructionArgs("0x1234"), RangeError);
});

test("hashes every signed quote field deterministically", () => {
  const registry = "0x0000000000000000000000000000000000000010";
  const quote = {
    maker: "0x0000000000000000000000000000000000000001",
    trader: "0x0000000000000000000000000000000000000002",
    executor: "0x0000000000000000000000000000000000000003",
    orderHash: `0x${"11".repeat(32)}` as const,
    tokenIn: "0x0000000000000000000000000000000000000004",
    tokenOut: "0x0000000000000000000000000000000000000005",
    amountIn: 250000000000000000n,
    minOut: 625000000n,
    premium: 2500000n,
    requiredBond: 625000000n,
    expiry: 2000000000n,
    nonce: 1n,
    chainId: 31337n,
  } as const;
  const digest = hashFirmQuote(registry, quote);
  assert.equal(digest, hashFirmQuote(registry, quote));
  assert.notEqual(digest, hashFirmQuote(registry, { ...quote, nonce: 2n }));
});
