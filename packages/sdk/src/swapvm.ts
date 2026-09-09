import { concatHex, numberToHex, size, type Hex } from "viem";

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

export function buildFirmInstructionArgs(commitmentId: Hex): Hex {
  if (size(commitmentId) !== 32) throw new RangeError("commitmentId must be bytes32");
  return concatHex([commitmentId, commitmentId]);
}
