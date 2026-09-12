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

export interface QuoteScopedFirmCapacity {
  pullableDepth: bigint;
  availableBond: bigint;
  bondSupportedDepth: bigint;
  firmDepth: bigint;
  collateralRatioWad: bigint;
}

/**
 * New Firm output exposure admissible under one quote's collateral policy.
 * Acceptance requires the full requiredBond, including any overcollateralization.
 */
export function firmDepthForQuote(
  pullableDepth: bigint,
  availableBond: bigint,
  minAmountOut: bigint,
  requiredBond: bigint,
): QuoteScopedFirmCapacity {
  if (pullableDepth < 0n || availableBond < 0n) throw new RangeError("capacity values cannot be negative");
  if (minAmountOut <= 0n) throw new RangeError("minAmountOut must be greater than zero");
  if (requiredBond < minAmountOut) throw new RangeError("requiredBond must cover minAmountOut");
  const bondSupportedDepth = (availableBond * minAmountOut) / requiredBond;
  return {
    pullableDepth,
    availableBond,
    bondSupportedDepth,
    firmDepth: min(pullableDepth, bondSupportedDepth),
    collateralRatioWad: (requiredBond * WAD) / minAmountOut,
  };
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
