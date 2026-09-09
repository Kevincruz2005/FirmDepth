import type { Capacity } from "./types.js";

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

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
