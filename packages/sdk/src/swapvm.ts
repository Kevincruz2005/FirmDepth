import {
  concatHex,
  getAddress,
  numberToHex,
  padHex,
  size,
  toHex,
  zeroHash,
  type Address,
  type Hex,
} from "viem";

export const FIRM_GUARD_OPCODE = 0x21;
export const FIRM_PRICE_OPCODE = 0x52;

export function encodeInstruction(opcode: number, args: Hex = "0x"): Hex {
  if (!Number.isInteger(opcode) || opcode < 0 || opcode > 0xff) {
    throw new RangeError("SwapVM opcode must fit in one byte");
  }
  const argsLength = size(args);
  if (argsLength > 0xff) throw new RangeError("SwapVM instruction arguments must fit in one byte");
  return concatHex([numberToHex(opcode, { size: 1 }), numberToHex(argsLength, { size: 1 }), args]);
}

export function buildFirmProgram(): Hex {
  return concatHex([
    encodeInstruction(FIRM_PRICE_OPCODE),
    encodeInstruction(FIRM_GUARD_OPCODE),
  ]);
}

export function buildFirmInstructionArgs(amountOut: bigint, commitmentId: Hex = zeroHash): Hex {
  if (amountOut <= 0n || amountOut > 2n ** 256n - 1n) {
    throw new RangeError("amountOut must fit in uint256 and be greater than zero");
  }
  if (size(commitmentId) !== 32) throw new RangeError("commitmentId must be bytes32");
  return concatHex([padHex(toHex(amountOut), { size: 32 }), commitmentId]);
}

export interface FirmQuoteTakerTraits {
  amountOut: bigint;
  tokenIn: Address;
  tokenOut: Address;
  deadline?: bigint;
  commitmentId?: Hex;
}

/**
 * Builds static-quote traits for the exact pinned SwapVM TakerTraitsLib layout.
 * Runtime execution traits remain contract-controlled in FirmExecutor.
 */
export function buildFirmQuoteTakerTraits({
  amountOut,
  tokenIn,
  tokenOut,
  deadline = 0n,
  commitmentId = zeroHash,
}: FirmQuoteTakerTraits): Hex {
  if (deadline < 0n || deadline > 2n ** 40n - 1n) {
    throw new RangeError("deadline must fit in uint40");
  }

  const normalizedIn = getAddress(tokenIn);
  const normalizedOut = getAddress(tokenOut);
  if (normalizedIn === normalizedOut) throw new RangeError("tokenIn and tokenOut must differ");

  const threshold = padHex(toHex(amountOut), { size: 32 });
  const instructionArgs = buildFirmInstructionArgs(amountOut, commitmentId);
  const deadlineData = deadline === 0n ? "0x" : numberToHex(deadline, { size: 5 });

  const thresholdEnd = 32;
  const recipientEnd = thresholdEnd;
  const deadlineEnd = recipientEnd + size(deadlineData);
  const instructionsEnd = deadlineEnd + size(instructionArgs);
  const sliceEnds = [
    instructionsEnd,
    deadlineEnd,
    deadlineEnd,
    deadlineEnd,
    deadlineEnd,
    deadlineEnd,
    deadlineEnd,
    deadlineEnd,
    recipientEnd,
    thresholdEnd,
  ];

  // Exact-in, strict threshold, taker-first transfer, Aqua push, and pair direction.
  const isAToB = BigInt(normalizedIn) < BigInt(normalizedOut);
  const flags = 0x0001 | 0x0010 | 0x0020 | 0x0040 | (isAToB ? 0x0080 : 0);
  const header = concatHex([
    ...sliceEnds.map((offset) => numberToHex(offset, { size: 2 })),
    numberToHex(flags, { size: 2 }),
  ]);

  return concatHex([header, threshold, deadlineData, instructionArgs]);
}
