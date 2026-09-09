import assert from "node:assert/strict";
import test from "node:test";

import { effectiveAquaCapacity, canUseAqua } from "../src/capacity.js";
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
