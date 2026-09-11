import type { Capacity } from "./types.js";

const WAD = 10n ** 18n;

export function effectiveAquaCapacity(
  virtualBalance: bigint,
  realBalance: bigint,
  aquaAllowance: bigint,
  strategyActive = true,
): Capacity {
  const effectiveCapacity = strategyActive
    ? min(virtualBalance, min(realBalance, aquaAllowance))
    : 0n;
  return { virtualBalance, realBalance, aquaAllowance, effectiveCapacity, strategyActive };
}

export function canUseAqua(capacity: Capacity, requiredOutput: bigint): boolean {
  return capacity.strategyActive && capacity.effectiveCapacity >= requiredOutput;
}

/** Returns aggregate virtual depth divided by the maker's real output inventory, in WAD. */
export function sharedLiquidityRatioWad(totalVirtualDepth: bigint, realInventory: bigint): bigint {
  if (totalVirtualDepth < 0n) throw new RangeError("totalVirtualDepth cannot be negative");
  if (realInventory <= 0n) throw new RangeError("realInventory must be greater than zero");
  return (totalVirtualDepth * WAD) / realInventory;
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
