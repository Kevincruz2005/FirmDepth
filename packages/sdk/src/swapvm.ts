import {
  concatHex,
  getAddress,
  hexToBigInt,
  numberToHex,
  padHex,
  size,
  slice,
  toHex,
  zeroHash,
  type Address,
  type Hex,
} from "viem";

import type { SwapVMOrder } from "./types.js";

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

/** Builds the exact Aqua-backed, hook-free maker order allowlisted by FirmExecutor. */
export function buildFirmOrder(maker: Address, tokenIn: Address, tokenOut: Address): SwapVMOrder {
  const normalizedMaker = getAddress(maker);
  const normalizedIn = getAddress(tokenIn);
  const normalizedOut = getAddress(tokenOut);
  if (normalizedIn === normalizedOut) throw new RangeError("tokenIn and tokenOut must differ");

  const [tokenA, tokenB] = BigInt(normalizedIn) < BigInt(normalizedOut)
    ? [normalizedIn, normalizedOut]
    : [normalizedOut, normalizedIn];
  const hookDataStart = 40;
  const orderDataIndexes = BigInt(`0x${numberToHex(hookDataStart, { size: 2 }).slice(2).repeat(4)}`);
  const useAquaInsteadOfSignature = 1n << 254n;
  const traits = useAquaInsteadOfSignature | (orderDataIndexes << 160n) | BigInt(normalizedMaker);

  return {
    maker: normalizedMaker,
    traits,
    data: concatHex([tokenA, tokenB, buildFirmProgram()]).toLowerCase() as Hex,
  };
}

export function buildFirmInstructionArgs(amountOut: bigint, commitmentId: Hex = zeroHash): Hex {
  if (amountOut <= 0n || amountOut > 2n ** 256n - 1n) {
    throw new RangeError("amountOut must fit in uint256 and be greater than zero");
  }
  if (size(commitmentId) !== 32) throw new RangeError("commitmentId must be bytes32");
  return concatHex([padHex(toHex(amountOut), { size: 32 }), commitmentId]);
}

export function decodeFirmInstructionArgs(data: Hex): { amountOut: bigint; commitmentId: Hex } {
  if (size(data) !== 64) throw new RangeError("Firm instruction arguments must be exactly 64 bytes");
  return {
    amountOut: hexToBigInt(slice(data, 0, 32)),
    commitmentId: slice(data, 32, 64),
  };
}

export interface FirmQuoteTakerTraits {
  amountOut: bigint;
  tokenIn: Address;
  tokenOut: Address;
  deadline?: bigint;
  commitmentId?: Hex;
}

export interface FirmExecutionTakerTraits extends FirmQuoteTakerTraits {
  taker: Address;
  recipient: Address;
  deadline: bigint;
  commitmentId: Hex;
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
  return buildFirmTraits({
    amountOut,
    tokenIn,
    tokenOut,
    deadline,
    commitmentId,
  });
}

/** Mirrors FirmExecutor._buildTakerTraits for byte-exact transaction inspection. */
export function buildFirmTakerTraits({
  amountOut,
  tokenIn,
  tokenOut,
  taker,
  recipient,
  deadline,
  commitmentId,
}: FirmExecutionTakerTraits): Hex {
  return buildFirmTraits({
    amountOut,
    tokenIn,
    tokenOut,
    taker: getAddress(taker),
    recipient: getAddress(recipient),
    deadline,
    commitmentId,
  });
}

interface FirmTraitsInput extends FirmQuoteTakerTraits {
  taker?: Address;
  recipient?: Address;
}

function buildFirmTraits({
  amountOut,
  tokenIn,
  tokenOut,
  taker,
  recipient,
  deadline = 0n,
  commitmentId = zeroHash,
}: FirmTraitsInput): Hex {
  if (deadline < 0n || deadline > 2n ** 40n - 1n) {
    throw new RangeError("deadline must fit in uint40");
  }

  const normalizedIn = getAddress(tokenIn);
  const normalizedOut = getAddress(tokenOut);
  if (normalizedIn === normalizedOut) throw new RangeError("tokenIn and tokenOut must differ");

  const threshold = padHex(toHex(amountOut), { size: 32 });
  const instructionArgs = buildFirmInstructionArgs(amountOut, commitmentId);
  const recipientData = taker !== undefined && recipient !== undefined && taker !== recipient
    ? recipient
    : "0x";
  const deadlineData = deadline === 0n ? "0x" : numberToHex(deadline, { size: 5 });

  const thresholdEnd = 32;
  const recipientEnd = thresholdEnd + size(recipientData);
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

  return concatHex([header, threshold, recipientData, deadlineData, instructionArgs]);
}

export interface DecodedFirmTakerTraits {
  flags: number;
  threshold: bigint;
  recipient: Address | null;
  deadline: bigint;
  instructionAmountOut: bigint;
  commitmentId: Hex;
}

/** Strictly decodes the hook-free runtime/static layout used by FirmDepth. */
export function decodeFirmTakerTraits(data: Hex): DecodedFirmTakerTraits {
  if (size(data) < 22) throw new RangeError("SwapVM taker traits header is truncated");
  const wireEnds = Array.from({ length: 10 }, (_, index) =>
    Number(hexToBigInt(slice(data, index * 2, index * 2 + 2))),
  );
  const ends = wireEnds.reverse();
  const flags = Number(hexToBigInt(slice(data, 20, 22)));
  if (flags !== 0x71 && flags !== 0xf1) {
    throw new RangeError("Firm traits flags do not match the exact-in hook-free execution policy");
  }
  const tail = slice(data, 22);
  if (ends.some((end, index) => end < (index === 0 ? 0 : ends[index - 1]!) || end > size(tail))) {
    throw new RangeError("SwapVM taker traits contain invalid slice offsets");
  }
  const [thresholdEnd, recipientEnd, deadlineEnd] = ends;
  if (thresholdEnd !== 32 || ![32, 52].includes(recipientEnd!) || ![recipientEnd, recipientEnd! + 5].includes(deadlineEnd!)) {
    throw new RangeError("Firm threshold, recipient, or deadline layout is invalid");
  }
  if (!ends.slice(3, 9).every((end) => end === deadlineEnd) || ends[9]! - ends[8]! !== 64 || ends[9] !== size(tail)) {
    throw new RangeError("Firm traits must contain no hooks, callbacks, or signature and exactly 64 instruction bytes");
  }
  const decodedArgs = decodeFirmInstructionArgs(slice(tail, ends[8]!, ends[9]!));
  return {
    flags,
    threshold: hexToBigInt(slice(tail, 0, thresholdEnd)),
    recipient: recipientEnd === thresholdEnd
      ? null
      : getAddress(slice(tail, thresholdEnd, recipientEnd)),
    deadline: deadlineEnd === recipientEnd
      ? 0n
      : hexToBigInt(slice(tail, recipientEnd, deadlineEnd)),
    instructionAmountOut: decodedArgs.amountOut,
    commitmentId: decodedArgs.commitmentId,
  };
}
