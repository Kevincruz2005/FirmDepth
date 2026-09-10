export const FIRM_PRICING_VERSION = 2 as const;
export const WAD = 10n ** 18n;
export const YEAR = 31_536_000n;
export const INV_SQRT_2PI_WAD = 398_942_280_401_432_678n;

const WAD_SQUARED = WAD * WAD;
const BPS = 10_000n;
const MAX_UINT256 = 2n ** 256n - 1n;
const MAX_TTL = 300n;
const MAX_SIGMA_WAD = 5n * WAD;
const MAX_ANNUAL_CAPITAL_RATE_WAD = 2n * WAD;
const MAX_CAPACITY_K_BPS = 2_000n;

export interface FirmPricingInputs {
  amountIn: bigint;
  referenceAmountOut: bigint;
  minAmountOut: bigint;
  requiredBond: bigint;
  sigmaWad: bigint;
  annualCapitalRateWad: bigint;
  capacityKBps: bigint;
  utilizationAfterWad: bigint;
  minPremiumOut: bigint;
  ttl: bigint;
}

export interface FirmPremiumQuote {
  pricingVersion: typeof FIRM_PRICING_VERSION;
  sqrtTimeWad: bigint;
  optionalityOut: bigint;
  bondCarryOut: bigint;
  capacitySurchargeOut: bigint;
  premiumOut: bigint;
  premiumIn: bigint;
}

export function calculateFirmPremium(inputs: FirmPricingInputs): FirmPremiumQuote {
  validateInputs(inputs);

  const sqrtTimeWad = integerSqrt(mulDivFloor(inputs.ttl, WAD_SQUARED, YEAR));
  const volatilityOut = mulDivFloor(inputs.referenceAmountOut, inputs.sigmaWad, WAD);
  const timeAdjustedOut = mulDivFloor(volatilityOut, sqrtTimeWad, WAD);
  const optionalityOut = mulDivFloor(timeAdjustedOut, INV_SQRT_2PI_WAD, WAD);

  const annualCarryOut = mulDivFloor(inputs.requiredBond, inputs.annualCapitalRateWad, WAD);
  const bondCarryOut = mulDivFloor(annualCarryOut, inputs.ttl, YEAR);

  const utilizationSquaredWad = mulDivFloor(
    inputs.utilizationAfterWad,
    inputs.utilizationAfterWad,
    WAD,
  );
  const capacityRateOut = mulDivFloor(inputs.referenceAmountOut, inputs.capacityKBps, BPS);
  const capacitySurchargeOut = mulDivFloor(capacityRateOut, utilizationSquaredWad, WAD);

  const calculatedPremiumOut = assertUint256(
    optionalityOut + bondCarryOut + capacitySurchargeOut,
    "calculatedPremiumOut",
  );
  const premiumOut = max(inputs.minPremiumOut, calculatedPremiumOut);
  const premiumIn = mulDivCeil(premiumOut, inputs.amountIn, inputs.referenceAmountOut);

  return {
    pricingVersion: FIRM_PRICING_VERSION,
    sqrtTimeWad,
    optionalityOut,
    bondCarryOut,
    capacitySurchargeOut,
    premiumOut,
    premiumIn,
  };
}

export const computeFirmPrice = calculateFirmPremium;

function validateInputs(inputs: FirmPricingInputs): void {
  for (const [name, value] of Object.entries(inputs)) assertUint256(value, name);
  if (inputs.amountIn === 0n) throw new RangeError("amountIn must be greater than zero");
  if (inputs.referenceAmountOut === 0n) throw new RangeError("referenceAmountOut must be greater than zero");
  if (inputs.minAmountOut === 0n) throw new RangeError("minAmountOut must be greater than zero");
  if (inputs.requiredBond < inputs.minAmountOut) throw new RangeError("requiredBond must cover minAmountOut");
  if (inputs.ttl === 0n || inputs.ttl > MAX_TTL) throw new RangeError("ttl must be between 1 and 300 seconds");
  if (inputs.sigmaWad > MAX_SIGMA_WAD) throw new RangeError("sigmaWad exceeds 5 WAD");
  if (inputs.annualCapitalRateWad > MAX_ANNUAL_CAPITAL_RATE_WAD) {
    throw new RangeError("annualCapitalRateWad exceeds 2 WAD");
  }
  if (inputs.capacityKBps > MAX_CAPACITY_K_BPS) throw new RangeError("capacityKBps exceeds 2000");
  if (inputs.utilizationAfterWad > WAD) throw new RangeError("utilizationAfterWad exceeds 1 WAD");
}

function mulDivFloor(x: bigint, y: bigint, denominator: bigint): bigint {
  return assertUint256((x * y) / denominator, "mulDiv result");
}

function mulDivCeil(x: bigint, y: bigint, denominator: bigint): bigint {
  const product = x * y;
  const result = product === 0n ? 0n : (product - 1n) / denominator + 1n;
  return assertUint256(result, "mulDiv ceil result");
}

function integerSqrt(value: bigint): bigint {
  if (value < 2n) return value;
  let estimate = value;
  let next = (estimate + 1n) >> 1n;
  while (next < estimate) {
    estimate = next;
    next = (estimate + value / estimate) >> 1n;
  }
  return estimate;
}

function assertUint256(value: bigint, name: string): bigint {
  if (value < 0n || value > MAX_UINT256) throw new RangeError(`${name} must fit in uint256`);
  return value;
}

function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
