export interface PremiumModel {
  baseRateBps: bigint;
  excessSlrRateBps: bigint;
  utilizationRateBps: bigint;
  maximumRateBps: bigint;
}

export interface PremiumQuote {
  premium: bigint;
  premiumRateBps: bigint;
  sharedLiquidityRatioBps: bigint;
  bondUtilizationBps: bigint;
}

const BPS = 10_000n;

export function calculateFirmPremium(
  minOut: bigint,
  virtualDepth: bigint,
  realInventory: bigint,
  lockedBond: bigint,
  totalBond: bigint,
  model: PremiumModel,
): PremiumQuote {
  if (minOut <= 0n) throw new RangeError("minOut must be greater than zero");
  for (const value of Object.values(model)) {
    if (value < 0n) throw new RangeError("premium model rates cannot be negative");
  }
  if (model.baseRateBps > model.maximumRateBps || model.maximumRateBps > BPS) {
    throw new RangeError("premium rate bounds are invalid");
  }

  const sharedLiquidityRatioBps = realInventory === 0n
    ? (virtualDepth === 0n ? 0n : BPS * 2n)
    : (virtualDepth * BPS) / realInventory;
  const excessSlrBps = sharedLiquidityRatioBps > BPS ? sharedLiquidityRatioBps - BPS : 0n;
  const bondUtilizationBps = totalBond === 0n
    ? (lockedBond === 0n ? 0n : BPS)
    : min(BPS, (lockedBond * BPS) / totalBond);

  const riskRate = model.baseRateBps
    + (excessSlrBps * model.excessSlrRateBps) / BPS
    + (bondUtilizationBps * model.utilizationRateBps) / BPS;
  const premiumRateBps = min(model.maximumRateBps, riskRate);
  const premium = ceilDiv(minOut * premiumRateBps, BPS);

  return { premium, premiumRateBps, sharedLiquidityRatioBps, bondUtilizationBps };
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return a === 0n ? 0n : (a - 1n) / b + 1n;
}
